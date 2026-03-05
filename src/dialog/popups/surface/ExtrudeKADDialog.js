/**
 * ExtrudeKADDialog.js
 *
 * Dialog for extruding a closed KAD polygon into a 3D solid.
 * Single dialog with pick-row UI for polygon selection + live preview.
 * Uses FloatingDialog + createEnhancedFormContent.
 */

import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import { createPreviewMesh, applyExtrusion } from "../../../helpers/ExtrudeKADHelper.js";
import { createPickRow, enterKADPickMode, exitKADPickMode } from "../../../helpers/ScreenPickHelper.js";

var SETTINGS_KEY = "kirra_extrude_kad_settings";

function loadSavedSettings() {
	try {
		var json = localStorage.getItem(SETTINGS_KEY);
		return json ? JSON.parse(json) : null;
	} catch (e) {
		return null;
	}
}

function saveSettings(settings) {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch (e) {
		console.warn("Failed to save extrude KAD settings:", e);
	}
}

// ────────────────────────────────────────────────────────
// Module-level preview state
// ────────────────────────────────────────────────────────
var previewGroup = null;

function clearPreview() {
	if (!previewGroup) return;
	var scene = window.threeRenderer ? window.threeRenderer.scene : null;
	if (scene) {
		scene.remove(previewGroup);
	}
	// Dispose geometry + materials
	previewGroup.traverse(function (child) {
		if (child.geometry) child.geometry.dispose();
		if (child.material) child.material.dispose();
	});
	previewGroup = null;
}

function updatePreview(entity, params, color) {
	clearPreview();
	if (!window.threeRenderer || !window.threeRenderer.scene) return;

	try {
		previewGroup = createPreviewMesh(entity, params, color);
		if (previewGroup) {
			window.threeRenderer.scene.add(previewGroup);
			window.threeRenderer.render();
		}
	} catch (e) {
		console.error("ExtrudeKAD: preview failed:", e.message);
	}
}

// ────────────────────────────────────────────────────────
// Public: show the extrude dialog
// ────────────────────────────────────────────────────────

/**
 * Show the Extrude KAD to Solid dialog.
 * Single dialog with pick-row for polygon selection + extrusion parameters.
 * Pre-populates from current selection if a closed poly is selected.
 */
export function showExtrudeKADDialog() {
	// Step 1) Gather all closed poly entities
	var polyEntities = getAllClosedPolys();

	if (polyEntities.length === 0) {
		showInfoDialog("No closed KAD polygons found.\nCreate a polygon first, then use this tool.");
		return;
	}

	// Step 2) Determine default selection from current screen selection
	var defaultName = polyEntities[0].name;
	var kadObject = window.selectedKADObject;
	if (kadObject && kadObject.entityType === "poly" && kadObject.entityName) {
		if (isClosedPoly(kadObject.entityName)) {
			defaultName = kadObject.entityName;
		}
	}

	// Step 3) Build pick-row options
	var polyOptions = polyEntities.map(function (pe) {
		return { value: pe.name, text: pe.name + " (" + pe.pointCount + " pts)" };
	});

	// Step 4) Load saved settings
	var saved = loadSavedSettings();

	// Step 5) Build container
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px 0";

	// Pick row for polygon selection
	var polyRow = createPickRow("Polygon", polyOptions, defaultName, function () {
		enterKADPickMode(polyRow, function (entityName) {
			polyRow.select.value = entityName;
			// Update info and trigger preview
			updateInfoHeader(entityName);
			triggerPreviewUpdate();
		});
	});
	container.appendChild(polyRow.row);

	// Info header showing selected polygon details
	var dark = isDarkMode();
	var infoDiv = document.createElement("div");
	infoDiv.style.fontSize = "11px";
	infoDiv.style.color = dark ? "rgba(255,200,0,0.8)" : "rgba(180,120,0,0.9)";
	infoDiv.style.padding = "4px 8px";
	infoDiv.style.background = dark ? "rgba(0,0,0,0.2)" : "rgba(255,240,200,0.5)";
	infoDiv.style.borderRadius = "4px";
	container.appendChild(infoDiv);

	function updateInfoHeader(entityName) {
		var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
		if (entity && entity.data && entity.data.length > 0) {
			var z = (entity.data[0].pointZLocation || 0).toFixed(1);
			infoDiv.textContent = "Polygon: " + entityName + " (" + entity.data.length + " pts, Z=" + z + ")";
		} else {
			infoDiv.textContent = "Polygon: " + entityName;
		}
	}
	updateInfoHeader(defaultName);

	// Step 6) Extrusion form fields
	var fields = [
		{
			label: "Depth (m) +ve=up, -ve=down",
			name: "depth",
			type: "number",
			value: saved ? saved.depth : -10,
			step: 0.5,
			min: -1000,
			max: 1000,
			tooltip: "Extrusion depth: positive = up, negative = down"
		},
		{
			label: "Steps",
			name: "steps",
			type: "number",
			value: saved ? saved.steps : 1,
			step: 1,
			min: 1,
			max: 50,
			tooltip: "Side wall vertical subdivisions"
		},
		{
			label: "Solid Color",
			name: "solidColor",
			type: "color",
			value: saved ? saved.solidColor : "#4488FF",
			tooltip: "Color of the created extruded surface"
		}
	];

	var formContent = createEnhancedFormContent(fields, false, false);
	container.appendChild(formContent);

	// Notes
	var notesDiv = document.createElement("div");
	notesDiv.style.marginTop = "10px";
	notesDiv.style.fontSize = "10px";
	notesDiv.style.color = dark ? "#888" : "#666";
	notesDiv.innerHTML =
		"<strong>Notes:</strong><br>" +
		"&bull; Depth: +ve = extrude up, -ve = extrude down<br>" +
		"&bull; Steps subdivide the side walls vertically<br>" +
		"&bull; Preview updates live as you change values<br>" +
		"&bull; Supports irregular Z per vertex<br>" +
		"&bull; Solid Color becomes the surface colour on creation<br>" +
		"<br><strong>Tip:</strong> Click the pick button then click a polygon on the canvas.";
	container.appendChild(notesDiv);

	// Step 7) Debounced preview
	var previewDebounceTimer = null;
	var PREVIEW_DEBOUNCE_MS = 100;

	function getCurrentParams() {
		var data = getFormData(formContent);
		return {
			depth: data.depth !== "" && !isNaN(parseFloat(data.depth)) ? parseFloat(data.depth) : -10,
			steps: parseInt(data.steps) || 1,
			solidColor: data.solidColor || "#4488FF"
		};
	}

	function getCurrentEntity() {
		var entityName = polyRow.select.value;
		return window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
	}

	function triggerPreviewUpdate() {
		if (previewDebounceTimer) {
			clearTimeout(previewDebounceTimer);
		}
		previewDebounceTimer = setTimeout(function () {
			var entity = getCurrentEntity();
			if (entity) {
				var params = getCurrentParams();
				updatePreview(entity, params, params.solidColor);
			}
		}, PREVIEW_DEBOUNCE_MS);
	}

	// Step 8) Attach event listeners for live preview on all form inputs
	var allInputs = formContent.querySelectorAll("input, select");
	allInputs.forEach(function (input) {
		input.addEventListener("input", triggerPreviewUpdate);
		input.addEventListener("change", triggerPreviewUpdate);
	});

	// Also update preview when dropdown changes
	polyRow.select.addEventListener("change", function () {
		updateInfoHeader(polyRow.select.value);
		triggerPreviewUpdate();
	});

	// Step 9) Create dialog
	var dialog = new FloatingDialog({
		title: "Extrude KAD to Solid",
		content: container,
		layoutType: "wide",
		width: 420,
		height: 460,
		showConfirm: true,
		showCancel: true,
		confirmText: "Apply",
		cancelText: "Cancel",
		onConfirm: function () {
			exitKADPickMode();

			if (previewDebounceTimer) {
				clearTimeout(previewDebounceTimer);
				previewDebounceTimer = null;
			}

			clearPreview();

			var params = getCurrentParams();
			var entity = getCurrentEntity();

			if (!entity) {
				showInfoDialog("Selected polygon not found.");
				return;
			}

			saveSettings(params);

			try {
				var surfaceId = applyExtrusion(entity, params);
				if (surfaceId) {
					console.log("Extrude KAD applied: " + surfaceId);
				}
			} catch (e) {
				console.error("ExtrudeKAD: extrusion failed:", e);
				showInfoDialog("Extrusion failed: " + e.message);
			}
		},
		onCancel: function () {
			exitKADPickMode();

			if (previewDebounceTimer) {
				clearTimeout(previewDebounceTimer);
				previewDebounceTimer = null;
			}

			clearPreview();

			if (typeof window.redraw3D === "function") {
				window.redraw3D();
			} else if (typeof window.drawData === "function") {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		}
	});

	dialog.show();

	// Step 10) Initialize JSColor and trigger initial preview after dialog renders
	setTimeout(function () {
		if (typeof jscolor !== "undefined") {
			jscolor.install();
			var colorInputs = formContent.querySelectorAll("[data-jscolor]");
			colorInputs.forEach(function (input) {
				if (input.jscolor) {
					input.jscolor.option("zIndex", 20000);
					input.jscolor.onFineChange = function () {
						triggerPreviewUpdate();
					};
				}
			});
		}
		// Initial preview
		triggerPreviewUpdate();
	}, 200);
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function getAllClosedPolys() {
	var result = [];
	if (window.allKADDrawingsMap && window.allKADDrawingsMap.size > 0) {
		window.allKADDrawingsMap.forEach(function (entity, entityName) {
			if (entity.data && entity.data.length >= 3) {
				// entityType "poly" is always closed by definition;
				// for lines, check any point's closed flag (STR sets it on last point)
				var isClosed = entity.entityType === "poly" ||
					entity.data.some(function (pt) { return pt.closed === true; });
				if (isClosed) {
					result.push({
						name: entityName,
						pointCount: entity.data.length
					});
				}
			}
		});
	}
	return result;
}

function isClosedPoly(entityName) {
	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
	if (!entity || !entity.data || entity.data.length < 3) return false;
	// entityType "poly" is always closed; for lines, check any point's closed flag
	return entity.entityType === "poly" ||
		entity.data.some(function (pt) { return pt.closed === true; });
}

function isDarkMode() {
	return typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
}

// ────────────────────────────────────────────────────────
// Info dialog utility
// ────────────────────────────────────────────────────────

function showInfoDialog(message) {
	var content = document.createElement("div");
	content.style.padding = "15px";
	content.style.whiteSpace = "pre-wrap";
	content.textContent = message;

	var dialog = new FloatingDialog({
		title: "Extrude KAD to Solid",
		content: content,
		width: 400,
		height: 200,
		showConfirm: true,
		confirmText: "OK",
		showCancel: false
	});
	dialog.show();
}
