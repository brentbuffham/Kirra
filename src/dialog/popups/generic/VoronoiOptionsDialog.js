// src/dialog/popups/generic/VoronoiOptionsDialog.js
import { FloatingDialog } from "../../FloatingDialog.js";

/**
 * Step 1) Show the Voronoi Options dialog.
 * Triggered by right-click on the Voronoi display toggle label.
 * Contains voronoi display type, legend, and boundary options.
 * Syncs values with the hidden elements in sidenavRightHidden.
 */
export function showVoronoiOptionsDialog() {
	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	// Step 2) Read current values from existing elements
	var voronoiSelectEl = document.getElementById("voronoiSelect");
	var voronoiLegendSelectEl = document.getElementById("voronoiLegendSelect");
	var voronoiBoundarySwitchEl = document.getElementById("voronoiBoundarySwitch");

	var currentVoronoi = voronoiSelectEl ? voronoiSelectEl.value : "powderFactorDesigned";
	var currentLegend = voronoiLegendSelectEl ? voronoiLegendSelectEl.value : "minmax";
	var currentBoundary = voronoiBoundarySwitchEl ? voronoiBoundarySwitchEl.checked : false;

	// Step 3) Build content
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "10px";
	container.style.padding = "4px";

	// Step 4) Voronoi Display Options
	var voronoiLabel = document.createElement("label");
	voronoiLabel.style.fontSize = "11px";
	voronoiLabel.style.color = dark ? "#ccc" : "#333";
	voronoiLabel.style.fontWeight = "bold";
	voronoiLabel.textContent = "Voronoi Display:";
	container.appendChild(voronoiLabel);

	var voronoiSelect = document.createElement("select");
	voronoiSelect.style.fontSize = "11px";
	voronoiSelect.style.padding = "4px 6px";
	voronoiSelect.style.background = dark ? "#333" : "#fff";
	voronoiSelect.style.color = dark ? "#ccc" : "#333";
	voronoiSelect.style.border = dark ? "1px solid #555" : "1px solid #999";
	voronoiSelect.style.borderRadius = "3px";
	voronoiSelect.style.width = "100%";

	var voronoiOptions = [
		{ value: "powderFactor", text: "PF - Measured (mass/volume)" },
		{ value: "powderFactorDesigned", text: "PF - Designed (mass/volume)" },
		{ value: "mass", text: "Measured Mass" },
		{ value: "designedMass", text: "Designed Mass" },
		{ value: "volume", text: "Volume" },
		{ value: "area", text: "Area" },
		{ value: "measuredLength", text: "Measured Length" },
		{ value: "designedLength", text: "Designed Length" },
		{ value: "holeFiringTime", text: "Hole Firing Time" },
		{ value: "sdob", text: "Scaled Depth of Burial" }
	];
	for (var i = 0; i < voronoiOptions.length; i++) {
		var opt = document.createElement("option");
		opt.value = voronoiOptions[i].value;
		opt.textContent = voronoiOptions[i].text;
		if (voronoiOptions[i].value === currentVoronoi) opt.selected = true;
		voronoiSelect.appendChild(opt);
	}
	container.appendChild(voronoiSelect);

	// Step 5) Legend
	var legendLabel = document.createElement("label");
	legendLabel.style.fontSize = "11px";
	legendLabel.style.color = dark ? "#ccc" : "#333";
	legendLabel.style.fontWeight = "bold";
	legendLabel.textContent = "Legend:";
	container.appendChild(legendLabel);

	var legendSelect = document.createElement("select");
	legendSelect.style.fontSize = "11px";
	legendSelect.style.padding = "4px 6px";
	legendSelect.style.background = dark ? "#333" : "#fff";
	legendSelect.style.color = dark ? "#ccc" : "#333";
	legendSelect.style.border = dark ? "1px solid #555" : "1px solid #999";
	legendSelect.style.borderRadius = "3px";
	legendSelect.style.width = "100%";
	var legendOpts = [{ value: "minmax", text: "Min-Max" }, { value: "fixed", text: "Fixed" }];
	for (var l = 0; l < legendOpts.length; l++) {
		var lopt = document.createElement("option");
		lopt.value = legendOpts[l].value;
		lopt.textContent = legendOpts[l].text;
		if (legendOpts[l].value === currentLegend) lopt.selected = true;
		legendSelect.appendChild(lopt);
	}
	container.appendChild(legendSelect);

	// Step 6) Boundary checkbox
	var boundaryRow = document.createElement("div");
	boundaryRow.style.display = "flex";
	boundaryRow.style.alignItems = "center";
	boundaryRow.style.gap = "6px";

	var boundaryCheck = document.createElement("input");
	boundaryCheck.type = "checkbox";
	boundaryCheck.checked = currentBoundary;
	boundaryCheck.style.cursor = "pointer";

	var boundaryLabel = document.createElement("label");
	boundaryLabel.style.fontSize = "11px";
	boundaryLabel.style.color = dark ? "#ccc" : "#333";
	boundaryLabel.style.cursor = "pointer";
	boundaryLabel.textContent = "Use Toe Radii Boundary";
	boundaryLabel.addEventListener("click", function () { boundaryCheck.checked = !boundaryCheck.checked; });

	boundaryRow.appendChild(boundaryCheck);
	boundaryRow.appendChild(boundaryLabel);
	container.appendChild(boundaryRow);

	// Step 7) Apply changes immediately on change events
	voronoiSelect.addEventListener("change", function () {
		if (voronoiSelectEl) {
			voronoiSelectEl.value = voronoiSelect.value;
			voronoiSelectEl.dispatchEvent(new Event("change"));
		}
	});
	legendSelect.addEventListener("change", function () {
		if (voronoiLegendSelectEl) {
			voronoiLegendSelectEl.value = legendSelect.value;
			voronoiLegendSelectEl.dispatchEvent(new Event("change"));
		}
	});
	boundaryCheck.addEventListener("change", function () {
		if (voronoiBoundarySwitchEl) {
			voronoiBoundarySwitchEl.checked = boundaryCheck.checked;
			voronoiBoundarySwitchEl.dispatchEvent(new Event("change"));
		}
	});

	// Step 8) Show dialog
	var dialog = new FloatingDialog({
		title: "Voronoi Options",
		content: container,
		layoutType: "compact",
		width: 320,
		height: 280,
		passthroughKeys: true,
		showConfirm: false,
		showCancel: true,
		cancelText: "Close"
	});
	dialog.show();
}

// Step 9) Wire right-click on Voronoi toggle label
document.addEventListener("DOMContentLoaded", function () {
	var voronoiLabel = document.querySelector("label[for='display16']");
	if (voronoiLabel) {
		voronoiLabel.addEventListener("contextmenu", function (e) {
			e.preventDefault();
			showVoronoiOptionsDialog();
		});
	}
});

// Step 10) Expose globally
window.showVoronoiOptionsDialog = showVoronoiOptionsDialog;
