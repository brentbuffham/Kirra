/**
 * KADBooleanDialog.js
 *
 * Dialog for 2D boolean operations on KAD polygon entities.
 * Single dialog with pick-row UI for Subject (A) and Clip (B) selection.
 * Pick rows use [Label] [🎯] [Dropdown] pattern (shared via ScreenPickHelper).
 * Pre-populates from screen selection when 2+ polys are selected.
 * Uses FloatingDialog + createEnhancedFormContent.
 */

import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import { kadBoolean } from "../../../helpers/KADBooleanHelper.js";
import { createPickRow, enterKADPickMode, exitKADPickMode } from "../../../helpers/ScreenPickHelper.js";

// ────────────────────────────────────────────────────────
// Public: show the KAD Boolean dialog
// ────────────────────────────────────────────────────────

export function showKADBooleanDialog() {
	// Step 1) Gather all closed polys available
	var allPolys = getAllClosedPolys();

	if (allPolys.length < 2) {
		showInfoDialog("Need at least 2 closed KAD polygons.\nCreate polygons first, then use this tool.");
		return;
	}

	// Step 2) Gather selected closed poly entity names from screen selection
	var selectedPolys = getSelectedClosedPolys();

	// Step 3) Build pick-row options
	var polyOptions = allPolys.map(function (pe) {
		return { value: pe.name, text: pe.name + " (" + pe.pointCount + " pts)" };
	});

	// Pre-set defaults from selection
	var defaultA = selectedPolys.length > 0 ? selectedPolys[0] : polyOptions[0].value;
	var defaultB = polyOptions[0].value;
	if (selectedPolys.length >= 2) {
		defaultB = selectedPolys[1];
	} else {
		for (var i = 0; i < polyOptions.length; i++) {
			if (polyOptions[i].value !== defaultA) {
				defaultB = polyOptions[i].value;
				break;
			}
		}
	}

	// Step 4) Build container
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px 0";

	// Selection info header (if pre-selected)
	if (selectedPolys.length >= 2) {
		var dark = isDarkMode();
		var infoDiv = document.createElement("div");
		infoDiv.style.fontSize = "11px";
		infoDiv.style.color = dark ? "rgba(255,200,0,0.8)" : "rgba(180,120,0,0.9)";
		infoDiv.style.marginBottom = "4px";
		infoDiv.style.padding = "4px 8px";
		infoDiv.style.background = dark ? "rgba(0,0,0,0.2)" : "rgba(255,240,200,0.5)";
		infoDiv.style.borderRadius = "4px";
		infoDiv.textContent = selectedPolys.length + " polygons pre-selected from screen";
		container.appendChild(infoDiv);
	}

	// Pick row A — Subject
	var rowA = createPickRow("Subject (A)", polyOptions, defaultA, function () {
		enterKADPickMode(rowA, function (entityName) {
			rowA.select.value = entityName;
		});
	});
	container.appendChild(rowA.row);

	// Pick row B — Clip
	var rowB = createPickRow("Clip (B)", polyOptions, defaultB, function () {
		enterKADPickMode(rowB, function (entityName) {
			rowB.select.value = entityName;
		});
	});
	container.appendChild(rowB.row);

	// Step 5) Boolean form fields
	var boolFields = [
		{
			label: "Operation",
			name: "operation",
			type: "select",
			value: "union",
			options: [
				{ value: "union", text: "Union (A + B)" },
				{ value: "intersect", text: "Intersect (A ∩ B)" },
				{ value: "difference", text: "Difference (A - B)" },
				{ value: "xor", text: "XOR (A △ B)" }
			]
		},
		{
			label: "Output Color",
			name: "color",
			type: "color",
			value: "#FFCC00"
		},
		{
			label: "Line Width",
			name: "lineWidth",
			type: "number",
			value: 3, step: 1, min: 1, max: 10
		},
		{
			label: "Layer Name",
			name: "layerName",
			type: "text",
			value: "BOOLS"
		}
	];

	var formContent = createEnhancedFormContent(boolFields, false, false);
	container.appendChild(formContent);

	// Notes
	var notesDark = isDarkMode();
	var notesDiv = document.createElement("div");
	notesDiv.style.marginTop = "10px";
	notesDiv.style.fontSize = "10px";
	notesDiv.style.color = notesDark ? "#888" : "#666";
	notesDiv.innerHTML =
		"<strong>Operations:</strong><br>" +
		"&bull; <b>Union</b> — merge both polygons into outer boundary<br>" +
		"&bull; <b>Intersect</b> — keep only the overlapping region<br>" +
		"&bull; <b>Difference</b> — subtract B from A<br>" +
		"&bull; <b>XOR</b> — keep everything except the overlap<br>" +
		"<br><strong>Tip:</strong> Click the pick button then click a polygon on the canvas.";
	container.appendChild(notesDiv);

	// Step 6) Create dialog
	var dialog = new FloatingDialog({
		title: "KAD Boolean Operation",
		content: container,
		layoutType: "wide",
		width: 440,
		height: 460,
		showConfirm: true,
		showCancel: true,
		confirmText: "Execute",
		cancelText: "Cancel",
		onConfirm: function () {
			exitKADPickMode();

			var subjectName = rowA.select.value;
			var clipName = rowB.select.value;
			var data = getFormData(formContent);

			if (subjectName === clipName) {
				showInfoDialog("Subject and Clip must be different polygons.");
				return;
			}

			var resultCount = kadBoolean({
				entityNames: [subjectName, clipName],
				operation: data.operation,
				color: data.color || "#FFCC00",
				lineWidth: parseInt(data.lineWidth) || 3,
				layerName: data.layerName || "BOOLS"
			});

			if (resultCount > 0) {
				console.log("KAD Boolean: Created " + resultCount + " result polygon(s)");
			} else {
				showInfoDialog("Boolean operation produced no results.\nThe polygons may not overlap.");
			}
		},
		onCancel: function () {
			exitKADPickMode();
		}
	});

	dialog.show();
	initJSColor(formContent);
}

// ────────────────────────────────────────────────────────
// Selection helpers
// ────────────────────────────────────────────────────────

function getSelectedClosedPolys() {
	var result = [];
	var seen = {};

	// Multi-selection first (shift-click)
	var multi = window.selectedMultipleKADObjects || [];
	for (var i = 0; i < multi.length; i++) {
		var obj = multi[i];
		if (obj.entityType === "poly" && obj.entityName && !seen[obj.entityName]) {
			if (isClosedPoly(obj.entityName)) {
				result.push(obj.entityName);
				seen[obj.entityName] = true;
			}
		}
	}

	// Single selection
	var single = window.selectedKADObject;
	if (single && single.entityType === "poly" && single.entityName && !seen[single.entityName]) {
		if (isClosedPoly(single.entityName)) {
			result.push(single.entityName);
			seen[single.entityName] = true;
		}
	}

	return result;
}

function getAllClosedPolys() {
	var result = [];
	if (window.allKADDrawingsMap && window.allKADDrawingsMap.size > 0) {
		window.allKADDrawingsMap.forEach(function (entity, entityName) {
			if (entity.entityType === "poly" && entity.data && entity.data.length >= 3) {
				var firstPt = entity.data[0];
				if (firstPt && (firstPt.closed === true || firstPt.closed === undefined)) {
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
	var firstPt = entity.data[0];
	return firstPt && (firstPt.closed === true || firstPt.closed === undefined);
}

function isDarkMode() {
	return typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
}

function initJSColor(container) {
	setTimeout(function () {
		if (typeof jscolor !== "undefined") {
			jscolor.install();
			var colorInputs = container.querySelectorAll("[data-jscolor]");
			colorInputs.forEach(function (input) {
				if (input.jscolor) {
					input.jscolor.option("zIndex", 20000);
				}
			});
		}
	}, 200);
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
		title: "KAD Boolean",
		content: content,
		width: 400,
		height: 200,
		showConfirm: true,
		confirmText: "OK",
		showCancel: false
	});
	dialog.show();
}
