// src/dialog/popups/generic/CreateRadiiDialog.js
import { FloatingDialog } from "../../FloatingDialog.js";

/**
 * Step 1) Show the Create Radii from Blast Holes dialog.
 * Contains inputs for Radii Steps and Polygon Radius.
 * On confirm, syncs values to hidden elements and triggers the existing handler.
 */
export function showCreateRadiiDialog() {
	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px";

	// Step 2) Input row factory
	function makeInputRow(labelText, defaultVal, placeholder) {
		var row = document.createElement("div");
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "8px";
		var lbl = document.createElement("label");
		lbl.style.fontSize = "11px";
		lbl.style.color = dark ? "#ccc" : "#333";
		lbl.style.minWidth = "80px";
		lbl.textContent = labelText;
		var inp = document.createElement("input");
		inp.type = "number";
		inp.value = defaultVal;
		inp.step = "1";
		inp.min = "1";
		inp.placeholder = placeholder;
		inp.style.flex = "1";
		inp.style.fontSize = "11px";
		inp.style.padding = "4px 6px";
		inp.style.borderRadius = "4px";
		inp.style.border = dark ? "1px solid #555" : "1px solid #999";
		inp.style.background = dark ? "#333" : "#fff";
		inp.style.color = dark ? "#ccc" : "#333";
		row.appendChild(lbl);
		row.appendChild(inp);
		return { row: row, input: inp };
	}

	// Step 3) Create input rows
	var stepsRow = makeInputRow("Radii Steps:", "36", "Steps");
	var radiusRow = makeInputRow("Radius (m):", "300", "Radius");
	container.appendChild(stepsRow.row);
	container.appendChild(radiusRow.row);

	// Step 4) Create the dialog
	var dialog = new FloatingDialog({
		title: "Create Radii from Holes",
		content: container,
		layoutType: "compact",
		width: 300,
		height: 150,
		showConfirm: true,
		showCancel: true,
		confirmText: "Create",
		cancelText: "Cancel",
		onConfirm: function () {
			// Step 5) Sync values to the hidden elements used by existing handler
			var radiiStepsEl = document.getElementById("radiiSteps");
			var polyRadiusEl = document.getElementById("drawingPolygonRadius");
			if (radiiStepsEl) radiiStepsEl.value = stepsRow.input.value;
			if (polyRadiusEl) polyRadiusEl.value = radiusRow.input.value;
			// Step 6) Trigger the existing handler
			var origBtn = document.getElementById("createRadiiFromBlastHoles");
			if (origBtn) origBtn.click();
		}
	});
	dialog.show();
}

// Step 7) Wire button on DOMContentLoaded
document.addEventListener("DOMContentLoaded", function () {
	var createRadiiBtn = document.getElementById("createRadiiFromBlastHolesBtn");
	if (createRadiiBtn) {
		createRadiiBtn.addEventListener("click", showCreateRadiiDialog);
	}
});

// Step 8) Expose globally
window.showCreateRadiiDialog = showCreateRadiiDialog;
