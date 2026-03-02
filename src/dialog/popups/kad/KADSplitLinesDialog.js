/**
 * KADSplitLinesDialog.js
 *
 * Dialog + interactive vertex-picking mode for splitting KAD lines and polygons.
 * - Lines: click one vertex → split at that point
 * - Polys: click two vertices → split into two open lines
 *
 * Follows the ReorderKAD interactive mode pattern.
 * Uses FloatingDialog for confirmation.
 */

import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import { splitKADLine, splitKADPoly } from "../../../helpers/SplitKADLinesHelper.js";

// ────────────────────────────────────────────────────────
// Module-scoped interactive state
// ────────────────────────────────────────────────────────

var isSplitKADActive = false;
var splitEntityName = null;
var splitEntityType = null; // "line" or "poly"
var splitStep = 0;          // 0=idle, 1=waiting for first vertex, 2=waiting for second (poly only)
var splitIndexA = null;
var splitIndexB = null;

// ────────────────────────────────────────────────────────
// Public: show the KAD Split Lines dialog (entry point)
// ────────────────────────────────────────────────────────

export function showKADSplitLinesDialog() {
	// Validate: need a pre-selected line or poly
	var selected = window.selectedKADObject;
	if (!selected || (selected.entityType !== "line" && selected.entityType !== "poly")) {
		showInfoDialog("Select a line or polygon first, then click Split.");
		return;
	}

	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(selected.entityName) : null;
	if (!entity || !entity.data) {
		showInfoDialog("Selected entity not found.");
		return;
	}

	if (selected.entityType === "line" && entity.data.length < 3) {
		showInfoDialog("Line must have at least 3 points to split.");
		return;
	}

	if (selected.entityType === "poly" && entity.data.length < 4) {
		showInfoDialog("Polygon must have at least 4 points to split.");
		return;
	}

	// Enter interactive mode
	startSplitKADMode(selected.entityName, selected.entityType);
}

// ────────────────────────────────────────────────────────
// Interactive mode control
// ────────────────────────────────────────────────────────

function startSplitKADMode(entityName, entityType) {
	isSplitKADActive = true;
	splitEntityName = entityName;
	splitEntityType = entityType;
	splitStep = 1;
	splitIndexA = null;
	splitIndexB = null;

	// Expose to window for kirra.js click dispatch
	window.isSplitKADActive = true;

	// Activate KAD selection mode and pointer tool
	activateKADSelection();

	// Show button as active
	var btn = document.getElementById("kadSplitLinesBtn");
	if (btn) btn.classList.add("active");

	if (entityType === "line") {
		updateStatus("Click on a middle vertex to split the line (Esc to cancel)");
	} else {
		updateStatus("Click on the first split vertex (Esc to cancel)");
	}

	console.log("SplitKAD mode started for " + entityType + ": " + entityName);
}

function cancelSplitKADMode() {
	isSplitKADActive = false;
	splitEntityName = null;
	splitEntityType = null;
	splitStep = 0;
	splitIndexA = null;
	splitIndexB = null;

	window.isSplitKADActive = false;

	// Clear selection highlights
	window.selectedPoint = null;
	window.selectedKADObject = null;

	var btn = document.getElementById("kadSplitLinesBtn");
	if (btn) btn.classList.remove("active");

	updateStatus("");
	if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);

	console.log("SplitKAD mode cancelled");
}

/**
 * Handle click during split mode.
 * Called from kirra.js main click handler.
 * @param {Object} clickedKADObject - From getClickedKADObject()
 * @returns {boolean} true if click was consumed
 */
function handleSplitKADClick(clickedKADObject) {
	if (!isSplitKADActive) return false;

	if (!clickedKADObject) {
		updateStatus("Click on a vertex in: " + splitEntityName + " (Esc to cancel)");
		return true;
	}

	// Must be same entity
	if (clickedKADObject.entityName !== splitEntityName) {
		updateStatus("Click on a vertex in: " + splitEntityName);
		return true;
	}

	// Must be vertex selection
	if (clickedKADObject.selectionType !== "vertex") {
		updateStatus("Click directly on a vertex, not a segment");
		return true;
	}

	var idx = clickedKADObject.elementIndex;
	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(splitEntityName) : null;
	if (!entity || !entity.data) {
		cancelSplitKADMode();
		return true;
	}

	var n = entity.data.length;

	if (splitEntityType === "line") {
		// Line: single vertex split
		if (idx <= 0 || idx >= n - 1) {
			updateStatus("Cannot split at first or last point. Pick a middle vertex.");
			return true;
		}

		splitIndexA = idx;

		// Highlight — set both selectedKADObject and selectedPoint for 2D/3D highlights
		highlightVertex(splitEntityName, splitEntityType, idx, entity.data[idx]);
		if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);

		// Show confirmation dialog
		showSplitConfirmDialog();
		return true;

	} else if (splitEntityType === "poly") {
		if (splitStep === 1) {
			// First vertex
			splitIndexA = idx;
			splitStep = 2;

			highlightVertex(splitEntityName, splitEntityType, idx, entity.data[idx]);
			if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);

			updateStatus("Click on the second split vertex (Esc to cancel)");
			return true;

		} else if (splitStep === 2) {
			// Second vertex
			if (idx === splitIndexA) {
				updateStatus("Must select a different vertex for the second split point");
				return true;
			}

			splitIndexB = idx;

			highlightVertex(splitEntityName, splitEntityType, idx, entity.data[idx]);
			if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);

			// Show confirmation dialog
			showSplitConfirmDialog();
			return true;
		}
	}

	return true;
}

// ────────────────────────────────────────────────────────
// Confirmation dialog
// ────────────────────────────────────────────────────────

function showSplitConfirmDialog() {
	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(splitEntityName) : null;
	if (!entity) {
		cancelSplitKADMode();
		return;
	}

	var container = document.createElement("div");

	// Summary
	var summaryDiv = document.createElement("div");
	summaryDiv.style.fontSize = "12px";
	summaryDiv.style.marginBottom = "10px";
	summaryDiv.style.padding = "6px 8px";
	summaryDiv.style.borderRadius = "4px";

	if (splitEntityType === "line") {
		var pt = entity.data[splitIndexA];
		summaryDiv.textContent = "Split line \"" + splitEntityName + "\" at vertex " +
			(splitIndexA + 1) + " of " + entity.data.length +
			" (" + pt.pointXLocation.toFixed(2) + ", " + pt.pointYLocation.toFixed(2) + ")";
	} else {
		var ptA = entity.data[splitIndexA];
		var ptB = entity.data[splitIndexB];
		summaryDiv.textContent = "Split polygon \"" + splitEntityName + "\" at vertices " +
			(splitIndexA + 1) + " and " + (splitIndexB + 1) + " of " + entity.data.length;
	}
	container.appendChild(summaryDiv);

	// Settings
	var fields = [
		{
			label: "Delete Original",
			name: "deleteOriginal",
			type: "checkbox",
			value: true,
			tooltip: "Remove original entity after splitting"
		}
	];

	var formContent = createEnhancedFormContent(fields, false, false);
	container.appendChild(formContent);

	// Tip for polys
	if (splitEntityType === "poly") {
		var tipDiv = document.createElement("div");
		tipDiv.style.marginTop = "10px";
		tipDiv.style.fontSize = "10px";
		tipDiv.style.color = "#999";
		tipDiv.textContent = "Tip: Use Reorder KAD to change the start point before splitting for different results.";
		container.appendChild(tipDiv);
	}

	var dialog = new FloatingDialog({
		title: "Split KAD " + (splitEntityType === "line" ? "Line" : "Polygon"),
		content: container,
		layoutType: "default",
		width: 400,
		height: 250,
		showConfirm: true,
		showCancel: true,
		confirmText: "Execute",
		cancelText: "Cancel",
		onConfirm: function () {
			var formData = getFormData(formContent);
			var deleteOriginal = formData.deleteOriginal === "true" || formData.deleteOriginal === true;

			var result;
			if (splitEntityType === "line") {
				result = splitKADLine({
					entityName: splitEntityName,
					splitIndex: splitIndexA,
					deleteOriginal: deleteOriginal
				});
			} else {
				result = splitKADPoly({
					entityName: splitEntityName,
					indexA: splitIndexA,
					indexB: splitIndexB,
					deleteOriginal: deleteOriginal
				});
			}

			if (result.success) {
				console.log("KAD Split: " + result.message);
			} else {
				showInfoDialog(result.message);
			}

			cancelSplitKADMode();
		},
		onCancel: function () {
			cancelSplitKADMode();
		}
	});

	dialog.show();
}

// ────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────

function updateStatus(msg) {
	if (typeof window.updateStatusMessage === "function") {
		window.updateStatusMessage(msg);
	}
}

function showInfoDialog(message) {
	var content = document.createElement("div");
	content.style.padding = "15px";
	content.style.whiteSpace = "pre-wrap";
	content.textContent = message;

	var dialog = new FloatingDialog({
		title: "Split KAD",
		content: content,
		width: 400,
		height: 200,
		showConfirm: true,
		confirmText: "OK",
		showCancel: false
	});
	dialog.show();
}

/**
 * Set selectedKADObject and selectedPoint so the highlight system
 * draws the pink vertex sphere in both 2D canvas and 3D Three.js.
 */
function highlightVertex(entityName, entityType, elementIndex, dataPoint) {
	if (!dataPoint) return;
	window.selectedKADObject = {
		entityName: entityName,
		entityType: entityType,
		elementIndex: elementIndex,
		selectionType: "vertex",
		pointXLocation: dataPoint.pointXLocation,
		pointYLocation: dataPoint.pointYLocation
	};
	window.selectedPoint = dataPoint;
}

/**
 * Activate KAD radio and selection pointer so interactive picking works.
 */
function activateKADSelection() {
	// Check the KAD radio (or Vertices radio — both work for vertex picking)
	var kadRadio = window.selectKADRadio || document.getElementById("selectKAD");
	if (kadRadio) kadRadio.checked = true;

	var pointerTool = document.getElementById("selectPointer");
	if (pointerTool && !pointerTool.checked) {
		pointerTool.checked = true;
		pointerTool.dispatchEvent(new Event("change"));
	}
}

// ────────────────────────────────────────────────────────
// Window exposures for kirra.js integration
// ────────────────────────────────────────────────────────

window.handleSplitKADClick = handleSplitKADClick;
window.cancelSplitKADMode = cancelSplitKADMode;
