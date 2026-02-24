// src/tools/TransformTool.js
//=============================================================
// TRANSFORM TOOL - KAD OBJECTS ONLY
//=============================================================
// Translate and rotate selected KAD entities
// with live preview and 3D gizmo interaction
// Supports math.js formulas with "=" prefix
// Created: 2026-02-03

import {
	applyTransform,
	calculateCentroid,
	degreesToRadians
} from "../helpers/TransformMath.js";
import { TransformKADAction } from "./UndoActions.js";

// =============================================================================
// STATE VARIABLES
// =============================================================================

let isTransformToolActive = false;
let transformDialog = null;

// Original positions for Cancel/Undo
let originalKADPositions = new Map();  // kadKey -> {x, y, z}

// Current transform values (relative to centroid)
let transformTranslation = { x: 0, y: 0, z: 0 };
let transformRotation = { bearing: 0, pitch: 0, roll: 0 }; // In radians

// Selection centroid (computed from selection)
let selectionCentroid = { x: 0, y: 0, z: 0 };

// Preview flag
let previewEnabled = true;

// Dialog input references for bidirectional sync
let dialogInputs = {
	posX: null,
	posY: null,
	posZ: null,
	bearing: null,
	pitch: null,
	roll: null,
	preview: null
};

// Debounce timer for preview updates
let previewDebounceTimer = null;
const PREVIEW_DEBOUNCE_MS = 100;

// =============================================================================
// VALUE PARSING
// =============================================================================

/**
 * Parse a numeric value from input
 * @param {string|number} value - Input value
 * @param {number} defaultValue - Default value if parsing fails
 * @returns {number} - Parsed numeric value
 */
function parseNumber(value, defaultValue = 0) {
	const parsed = parseFloat(value);
	return isNaN(parsed) ? defaultValue : parsed;
}

// =============================================================================
// START TRANSFORM MODE
// =============================================================================

/**
 * Start the transform tool mode
 * Checks for KAD selection, computes centroid, stores originals, shows dialog
 */
function startTransformMode() {
	// Check if there's a KAD selection (NOT holes - this tool is KAD only)
	const hasKADSelection = window.selectedKADObject != null ||
		(window.selectedMultipleKADObjects && window.selectedMultipleKADObjects.length > 0);

	if (!hasKADSelection) {
		if (window.showModalMessage) {
			window.showModalMessage("No KAD Selection", "Please select KAD objects to transform.\nThis tool works with KAD entities only (points, lines, polygons, circles, text).", "warning");
		}
		// Uncheck the tool button
		const transformToolBtn = document.getElementById("transformTool");
		if (transformToolBtn) transformToolBtn.checked = false;
		return;
	}

	// Compute centroid from selection
	selectionCentroid = computeSelectionCentroid();
	if (!selectionCentroid) {
		if (window.showModalMessage) {
			window.showModalMessage("Error", "Could not compute selection centroid.", "error");
		}
		const transformToolBtn = document.getElementById("transformTool");
		if (transformToolBtn) transformToolBtn.checked = false;
		return;
	}

	// Store original positions for Cancel/Undo
	storeOriginalPositions();

	// Reset transform values
	transformTranslation = { x: 0, y: 0, z: 0 };
	transformRotation = { bearing: 0, pitch: 0, roll: 0 };
	previewEnabled = true;

	// Set active state
	isTransformToolActive = true;
	window.isTransformToolActive = true;

	// Deactivate other tools
	deactivateOtherTools();

	// Show the dialog (no 3D gizmo - dialog only for now)
	showTransformDialog();

	// Mark button as active
	const transformToolBtn = document.getElementById("transformTool");
	if (transformToolBtn) {
		transformToolBtn.checked = true;
	}

	if (window.updateStatusMessage) {
		window.updateStatusMessage("Transform KAD - modify position/rotation values");
	}

	console.log("Transform mode activated - centroid:", selectionCentroid);
}

// =============================================================================
// COMPUTE SELECTION CENTROID
// =============================================================================

/**
 * Calculate the centroid of all selected KAD entities
 * @returns {Object|null} - {x, y, z} centroid or null
 */
function computeSelectionCentroid() {
	const points = [];

	// Include single selected KAD object
	if (window.selectedKADObject) {
		const entity = getKADEntityFromSelection(window.selectedKADObject);
		if (entity && entity.data) {
			for (const pt of entity.data) {
				points.push({
					x: pt.pointXLocation,
					y: pt.pointYLocation,
					z: pt.pointZLocation || window.dataCentroidZ || 0
				});
			}
		}
	}

	// Include multi-selected KAD objects
	const multiKAD = window.selectedMultipleKADObjects || [];
	for (const kadObj of multiKAD) {
		const entity = getKADEntityFromSelection(kadObj);
		if (entity && entity.data) {
			for (const pt of entity.data) {
				points.push({
					x: pt.pointXLocation,
					y: pt.pointYLocation,
					z: pt.pointZLocation || window.dataCentroidZ || 0
				});
			}
		}
	}

	return calculateCentroid(points);
}

/**
 * Get KAD entity from selection object
 * @param {Object} kadObj - Selected KAD object with entityName
 * @returns {Object|null} - KAD entity from allKADDrawingsMap
 */
function getKADEntityFromSelection(kadObj) {
	if (!kadObj || !kadObj.entityName) return null;
	const map = window.allKADDrawingsMap;
	if (!map) return null;
	return map.get(kadObj.entityName);
}

// =============================================================================
// STORE/RESTORE ORIGINAL POSITIONS
// =============================================================================

/**
 * Store original positions of all selected KAD entities for Cancel/Undo
 */
function storeOriginalPositions() {
	originalKADPositions.clear();

	// Store single selected KAD
	if (window.selectedKADObject) {
		storeKADEntityPositions(window.selectedKADObject);
	}

	// Store multi-selected KADs
	const multiKAD = window.selectedMultipleKADObjects || [];
	for (const kadObj of multiKAD) {
		storeKADEntityPositions(kadObj);
	}

	console.log("Stored original KAD positions:", originalKADPositions.size, "points");
}

/**
 * Store positions of a KAD entity
 */
function storeKADEntityPositions(kadObj) {
	const entity = getKADEntityFromSelection(kadObj);
	if (!entity || !entity.data) return;

	for (const pt of entity.data) {
		const key = kadObj.entityName + ":::" + pt.pointID;
		originalKADPositions.set(key, {
			x: pt.pointXLocation,
			y: pt.pointYLocation,
			z: pt.pointZLocation || 0
		});
	}
}

/**
 * Restore original positions (for Cancel)
 */
function restoreOriginalPositions() {
	for (const [key, orig] of originalKADPositions) {
		const parts = key.split(":::");
		const entityName = parts[0];
		const pointID = parts[1];

		const entity = window.allKADDrawingsMap?.get(entityName);
		if (entity && entity.data) {
			const pt = entity.data.find(p => String(p.pointID) === String(pointID));
			if (pt) {
				pt.pointXLocation = orig.x;
				pt.pointYLocation = orig.y;
				pt.pointZLocation = orig.z;
			}
		}
	}

	console.log("Restored original KAD positions");
}

/**
 * Get current positions for undo/redo state capture
 */
function getCurrentPositions() {
	const kads = new Map();

	const captureKAD = (kadObj) => {
		const entity = getKADEntityFromSelection(kadObj);
		if (!entity || !entity.data) return;
		for (const pt of entity.data) {
			const key = kadObj.entityName + ":::" + pt.pointID;
			kads.set(key, {
				x: pt.pointXLocation,
				y: pt.pointYLocation,
				z: pt.pointZLocation || 0
			});
		}
	};

	if (window.selectedKADObject) captureKAD(window.selectedKADObject);
	(window.selectedMultipleKADObjects || []).forEach(captureKAD);

	return { kads };
}

// =============================================================================
// TRANSFORM DIALOG
// =============================================================================

/**
 * Show the Transform dialog with position and rotation inputs
 * Uses 4-column grid layout: Label | Input | Label | Input
 */
function showTransformDialog() {
	// Build entity name for title
	let entityName = "KAD";
	if (window.selectedKADObject) {
		entityName = window.selectedKADObject.entityName || "KAD";
	} else if (window.selectedMultipleKADObjects && window.selectedMultipleKADObjects.length > 0) {
		entityName = window.selectedMultipleKADObjects.length + " KAD objects";
	}

	// Create form content with 4-column grid layout
	const formContent = document.createElement("div");
	formContent.style.cssText = "padding: 10px;";

	// 4-column grid: Label | Input | Label | Input
	// Values are OFFSETS (0 = no change, 10 = move 10 units)
	const gridHtml = `
		<div style="display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 8px 12px; align-items: center;">
			<label for="transform-posX" style="font-size: 11px;">X Offset:</label>
			<input type="number" id="transform-posX" name="posX" value="0" step="0.1" style="width: 100%; padding: 4px; box-sizing: border-box;">
			<label for="transform-bearing" style="font-size: 11px;">Bearing:</label>
			<input type="number" id="transform-bearing" name="bearing" value="0" step="0.1" style="width: 100%; padding: 4px; box-sizing: border-box;">

			<label for="transform-posY" style="font-size: 11px;">Y Offset:</label>
			<input type="number" id="transform-posY" name="posY" value="0" step="0.1" style="width: 100%; padding: 4px; box-sizing: border-box;">
			<label for="transform-pitch" style="font-size: 11px;">Pitch:</label>
			<input type="number" id="transform-pitch" name="pitch" value="0" step="0.1" style="width: 100%; padding: 4px; box-sizing: border-box;">

			<label for="transform-posZ" style="font-size: 11px;">Z Offset:</label>
			<input type="number" id="transform-posZ" name="posZ" value="0" step="0.1" style="width: 100%; padding: 4px; box-sizing: border-box;">
			<label for="transform-roll" style="font-size: 11px;">Roll:</label>
			<input type="number" id="transform-roll" name="roll" value="0" step="0.1" style="width: 100%; padding: 4px; box-sizing: border-box;">
		</div>

		<div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #555;">
			<label style="display: flex; align-items: center; cursor: pointer; font-size: 11px;">
				<input type="checkbox" id="transform-preview" name="preview" checked style="width: 14px; height: 14px; margin-right: 8px;">
				Preview Transform
			</label>
		</div>
	`;

	formContent.innerHTML = gridHtml;

	// Create dialog
	transformDialog = new window.FloatingDialog({
		title: "Transform: " + entityName,
		content: formContent,
		layoutType: "default",
		showConfirm: true,
		showCancel: true,
		confirmText: "Apply",
		cancelText: "Cancel",
		width: 400,
		height: 180,
		onConfirm: function() {
			applyTransformPermanent();
		},
		onCancel: function() {
			cancelTransformMode();
		},
		onClose: function() {
			// If dialog closed via X button, treat as cancel
			if (isTransformToolActive) {
				cancelTransformMode();
			}
		}
	});

	transformDialog.show();

	// Get input references for updates (by ID for reliability)
	dialogInputs.posX = document.getElementById("transform-posX");
	dialogInputs.posY = document.getElementById("transform-posY");
	dialogInputs.posZ = document.getElementById("transform-posZ");
	dialogInputs.bearing = document.getElementById("transform-bearing");
	dialogInputs.pitch = document.getElementById("transform-pitch");
	dialogInputs.roll = document.getElementById("transform-roll");
	dialogInputs.preview = document.getElementById("transform-preview");

	// Add input event listeners for live preview
	const inputs = [dialogInputs.posX, dialogInputs.posY, dialogInputs.posZ,
		dialogInputs.bearing, dialogInputs.pitch, dialogInputs.roll];

	for (const input of inputs) {
		if (input) {
			input.addEventListener("input", handleDialogInputChange);
			input.addEventListener("change", handleDialogInputChange);
		}
	}

	if (dialogInputs.preview) {
		dialogInputs.preview.addEventListener("change", handlePreviewToggle);
	}
}

/**
 * Handle dialog input changes - update transform and apply preview (debounced)
 */
function handleDialogInputChange() {
	if (!isTransformToolActive) return;

	// Debounce preview updates
	if (previewDebounceTimer) {
		clearTimeout(previewDebounceTimer);
	}

	previewDebounceTimer = setTimeout(function() {
		// Read and evaluate current values from dialog (supports formulas)
		// Values are OFFSETS (0 = no change)
		const offsetX = parseNumber(dialogInputs.posX?.value, 0);
		const offsetY = parseNumber(dialogInputs.posY?.value, 0);
		const offsetZ = parseNumber(dialogInputs.posZ?.value, 0);

		const bearingDeg = parseNumber(dialogInputs.bearing?.value, 0);
		const pitchDeg = parseNumber(dialogInputs.pitch?.value, 0);
		const rollDeg = parseNumber(dialogInputs.roll?.value, 0);

		// Offsets are direct translation values
		transformTranslation.x = offsetX;
		transformTranslation.y = offsetY;
		transformTranslation.z = offsetZ;

		// Store rotation in radians
		transformRotation.bearing = degreesToRadians(bearingDeg);
		transformRotation.pitch = degreesToRadians(pitchDeg);
		transformRotation.roll = degreesToRadians(rollDeg);

		// Apply preview if enabled
		if (previewEnabled) {
			applyPreviewTransform();
		}
	}, PREVIEW_DEBOUNCE_MS);
}

/**
 * Handle preview checkbox toggle
 */
function handlePreviewToggle() {
	previewEnabled = dialogInputs.preview?.checked ?? true;

	if (previewEnabled) {
		// Apply current transform as preview
		applyPreviewTransform();
	} else {
		// Restore original positions (hide preview)
		restoreOriginalPositions();
		triggerRedraw();
	}
}


// =============================================================================
// APPLY TRANSFORM (PREVIEW & PERMANENT)
// =============================================================================

/**
 * Apply transform to all selected KAD entities (preview mode)
 * Uses original positions as base, applies current transform
 */
function applyPreviewTransform() {
	// Apply to KAD entities
	for (const [key, orig] of originalKADPositions) {
		const parts = key.split(":::");
		const entityName = parts[0];
		const pointID = parts[1];

		const entity = window.allKADDrawingsMap?.get(entityName);
		if (entity && entity.data) {
			const pt = entity.data.find(p => String(p.pointID) === String(pointID));
			if (pt) {
				const newPos = applyTransform(
					{ x: orig.x, y: orig.y, z: orig.z },
					selectionCentroid,
					transformTranslation,
					transformRotation
				);
				pt.pointXLocation = newPos.x;
				pt.pointYLocation = newPos.y;
				pt.pointZLocation = newPos.z;
			}
		}
	}

	// Trigger redraw
	triggerRedraw();
}

/**
 * Apply transform permanently and close dialog
 */
function applyTransformPermanent() {
	console.log("applyTransformPermanent called");

	// Clear any pending debounce timer
	if (previewDebounceTimer) {
		clearTimeout(previewDebounceTimer);
		previewDebounceTimer = null;
	}

	// Force immediate evaluation of current input values
	// Values are OFFSETS (0 = no change)
	const offsetX = parseNumber(dialogInputs.posX?.value, 0);
	const offsetY = parseNumber(dialogInputs.posY?.value, 0);
	const offsetZ = parseNumber(dialogInputs.posZ?.value, 0);
	const bearingDeg = parseNumber(dialogInputs.bearing?.value, 0);
	const pitchDeg = parseNumber(dialogInputs.pitch?.value, 0);
	const rollDeg = parseNumber(dialogInputs.roll?.value, 0);

	console.log("Transform values:", {
		offset: { x: offsetX, y: offsetY, z: offsetZ },
		rotation: { bearing: bearingDeg, pitch: pitchDeg, roll: rollDeg }
	});

	// Offsets are direct translation values
	transformTranslation.x = offsetX;
	transformTranslation.y = offsetY;
	transformTranslation.z = offsetZ;
	transformRotation.bearing = degreesToRadians(bearingDeg);
	transformRotation.pitch = degreesToRadians(pitchDeg);
	transformRotation.roll = degreesToRadians(rollDeg);

	// Capture before state for undo BEFORE applying
	const beforeState = {
		kads: new Map(originalKADPositions)
	};

	// Apply the final transform to all selected KAD points
	for (const [key, orig] of originalKADPositions) {
		const parts = key.split(":::");
		const entityName = parts[0];
		const pointID = parts[1];

		const entity = window.allKADDrawingsMap?.get(entityName);
		if (entity && entity.data) {
			const pt = entity.data.find(p => String(p.pointID) === String(pointID));
			if (pt) {
				const newPos = applyTransform(
					{ x: orig.x, y: orig.y, z: orig.z },
					selectionCentroid,
					transformTranslation,
					transformRotation
				);
				pt.pointXLocation = newPos.x;
				pt.pointYLocation = newPos.y;
				pt.pointZLocation = newPos.z;
				console.log(`Transformed ${key}: (${orig.x.toFixed(2)}, ${orig.y.toFixed(2)}) -> (${newPos.x.toFixed(2)}, ${newPos.y.toFixed(2)})`);
			}
		}
	}

	// Capture after state for undo
	const afterState = getCurrentPositions();

	// Register undo action
	if (window.undoManager) {
		const action = new TransformKADAction(
			beforeState.kads,
			afterState.kads,
			"Transform KAD entities"
		);
		window.undoManager.pushAction(action);
		console.log("Transform undo action registered:", beforeState.kads.size, "points");
	}

	// Save KAD to IndexedDB
	if (window.debouncedSaveKAD) {
		window.debouncedSaveKAD();
		console.log("KAD save triggered");
	}

	// Update tree view
	if (window.debouncedUpdateTreeView) {
		window.debouncedUpdateTreeView();
	}

	// Force redraw BEFORE cleanup
	window.threeKADNeedsRebuild = true;
	if (window.drawData) {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}

	// Cleanup
	cleanupTransformMode();

	// Delayed redraw to ensure 3D scene catches up after cleanup
	setTimeout(function () {
		window.threeKADNeedsRebuild = true;
		if (window.drawData) {
			window.drawData(window.allBlastHoles, window.selectedHole);
		}
	}, 50);

	if (window.updateStatusMessage) {
		window.updateStatusMessage("Transform applied successfully!");
		setTimeout(() => window.updateStatusMessage(""), 3000);
	}

	console.log("Transform applied permanently");
}

/**
 * Restore positions from a state object (for undo/redo)
 */
function restorePositionsFromState(state) {
	// Restore KADs
	for (const [key, orig] of state.kads) {
		const parts = key.split(":::");
		const entityName = parts[0];
		const pointID = parts[1];

		const entity = window.allKADDrawingsMap?.get(entityName);
		if (entity && entity.data) {
			const pt = entity.data.find(p => String(p.pointID) === String(pointID));
			if (pt) {
				pt.pointXLocation = orig.x;
				pt.pointYLocation = orig.y;
				pt.pointZLocation = orig.z;
			}
		}
	}
}

// =============================================================================
// CANCEL / CLEANUP
// =============================================================================

/**
 * Cancel transform mode - restore original positions and cleanup
 */
function cancelTransformMode() {
	if (!isTransformToolActive) return;

	// Clear debounce timer
	if (previewDebounceTimer) {
		clearTimeout(previewDebounceTimer);
		previewDebounceTimer = null;
	}

	// Restore original positions
	restoreOriginalPositions();

	// Cleanup
	cleanupTransformMode();

	// Trigger redraw
	triggerRedraw();

	if (window.updateStatusMessage) {
		window.updateStatusMessage("Transform cancelled");
		setTimeout(() => window.updateStatusMessage(""), 2000);
	}

	console.log("Transform mode cancelled");
}

/**
 * Cleanup transform mode (shared by Apply and Cancel)
 */
function cleanupTransformMode() {
	console.log("cleanupTransformMode called");

	// Clear debounce timer
	if (previewDebounceTimer) {
		clearTimeout(previewDebounceTimer);
		previewDebounceTimer = null;
	}

	// Close dialog (without triggering cancel again)
	if (transformDialog) {
		try {
			// Temporarily disable onClose to prevent recursion
			if (transformDialog.options) {
				transformDialog.options.onClose = null;
			}
			if (typeof transformDialog.close === "function") {
				transformDialog.close();
			} else if (transformDialog.dialogElement) {
				// Fallback: remove dialog element directly
				transformDialog.dialogElement.remove();
			}
		} catch (e) {
			console.warn("Error closing transform dialog:", e);
		}
		transformDialog = null;
	}

	// Reset state
	isTransformToolActive = false;
	window.isTransformToolActive = false;

	// Uncheck button
	const transformToolBtn = document.getElementById("transformTool");
	if (transformToolBtn) {
		transformToolBtn.checked = false;
	}

	// Clear stored positions
	originalKADPositions.clear();

	// Clear dialog input references
	dialogInputs = {
		posX: null, posY: null, posZ: null,
		bearing: null, pitch: null, roll: null,
		preview: null
	};
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Deactivate other conflicting tools
 */
function deactivateOtherTools() {
	// Deactivate selection tools
	window.isSelectionPointerActive = false;
	window.isPolygonSelectionActive = false;

	const selectPointerTool = document.getElementById("selectPointer");
	if (selectPointerTool) selectPointerTool.checked = false;

	const selectByPolygonTool = document.getElementById("selectByPolygon");
	if (selectByPolygonTool) selectByPolygonTool.checked = false;

	// Deactivate other modify tools
	const moveToTool = document.getElementById("moveToTool");
	if (moveToTool) moveToTool.checked = false;

	const offsetKADTool = document.getElementById("offsetKADTool");
	if (offsetKADTool) offsetKADTool.checked = false;
}

/**
 * Trigger canvas redraw
 */
function triggerRedraw() {
	window.threeDataNeedsRebuild = true;
	if (window.drawData) {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
}


// =============================================================================
// EXPORTS
// =============================================================================

// Expose to window for global access
window.isTransformToolActive = false;
window.startTransformMode = startTransformMode;
window.cancelTransformMode = cancelTransformMode;

// Update window state when internal state changes
Object.defineProperty(window, "isTransformToolActive", {
	get: () => isTransformToolActive,
	set: (val) => { isTransformToolActive = val; }
});

export {
	startTransformMode,
	cancelTransformMode
};
