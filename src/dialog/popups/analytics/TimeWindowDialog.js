// src/dialog/popups/analytics/TimeWindowDialog.js
import { FloatingDialog } from "../../FloatingDialog.js";

// ────────────────────────────────────────────────────────
// Module-scoped state
// ────────────────────────────────────────────────────────
var timeWindowDialog = null;

/**
 * Step 1) Show the Time Window dialog.
 * Contains a time chart, time range / offset sliders, and chart mode dropdown.
 * Syncs values with the hidden elements in sidenavRightHidden.
 */
export function showTimeWindowDialog() {
	// Step 1) Close existing dialog if already open
	if (timeWindowDialog) {
		timeWindowDialog.closeSilently();
		timeWindowDialog = null;
	}

	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	// Step 2) Build content
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px";

	// Step 3) Chart container
	var chartDiv = document.createElement("div");
	chartDiv.id = "timeWindowChartContainer";
	chartDiv.style.width = "100%";
	chartDiv.style.minHeight = "150px";
	container.appendChild(chartDiv);

	// Step 4) Move the existing timeChart element into this dialog if it exists
	var existingChart = document.getElementById("timeChart");
	if (existingChart) {
		chartDiv.appendChild(existingChart);
	}

	// Step 5) Time Range slider
	var trLabel = document.createElement("label");
	trLabel.style.fontSize = "11px";
	trLabel.style.color = dark ? "#ccc" : "#333";
	var trRangeEl = document.getElementById("timeRange");
	var trVal = trRangeEl ? trRangeEl.value : "8";
	trLabel.textContent = "Time Window: " + trVal + " ms";

	var trSlider = document.createElement("input");
	trSlider.type = "range";
	trSlider.min = "1";
	trSlider.max = "250";
	trSlider.value = trVal;
	trSlider.step = "1";
	trSlider.style.width = "80%";
	trSlider.addEventListener("input", function () {
		trLabel.textContent = "Time Window: " + trSlider.value + " ms";
		var orig = document.getElementById("timeRange");
		if (orig) {
			orig.value = trSlider.value;
			orig.dispatchEvent(new Event("input"));
		}
	});
	container.appendChild(trLabel);
	container.appendChild(trSlider);

	// Step 6) Time Offset slider
	var toLabel = document.createElement("label");
	toLabel.style.fontSize = "11px";
	toLabel.style.color = dark ? "#ccc" : "#333";
	var toOffsetEl = document.getElementById("timeOffset");
	var toVal = toOffsetEl ? toOffsetEl.value : "0";
	toLabel.textContent = "Time Offset: " + toVal + " ms";

	var toSlider = document.createElement("input");
	toSlider.type = "range";
	toSlider.min = "0";
	toSlider.max = "50";
	toSlider.value = toVal;
	toSlider.step = "1";
	toSlider.style.width = "80%";
	toSlider.addEventListener("input", function () {
		toLabel.textContent = "Time Offset: " + toSlider.value + " ms";
		var orig = document.getElementById("timeOffset");
		if (orig) {
			orig.value = toSlider.value;
			orig.dispatchEvent(new Event("input"));
		}
	});
	container.appendChild(toLabel);
	container.appendChild(toSlider);

	// Step 7) Chart Mode dropdown
	var modeRow = document.createElement("div");
	modeRow.style.display = "flex";
	modeRow.style.alignItems = "center";
	modeRow.style.gap = "6px";

	var modeLabel = document.createElement("label");
	modeLabel.style.fontSize = "11px";
	modeLabel.style.color = dark ? "#ccc" : "#333";
	modeLabel.textContent = "Chart Mode:";

	var modeSelect = document.createElement("select");
	modeSelect.style.fontSize = "11px";
	modeSelect.style.padding = "2px 4px";
	modeSelect.style.background = dark ? "#333" : "#fff";
	modeSelect.style.color = dark ? "#ccc" : "#333";
	modeSelect.style.border = dark ? "1px solid #555" : "1px solid #999";
	modeSelect.style.borderRadius = "3px";
	modeSelect.style.flex = "1";

	var modeOptions = [
		{ value: "holeCount", text: "Surface Hole Count" },
		{ value: "measuredMass", text: "Measured Mass" },
		{ value: "massPerHole", text: "Mass Per Hole" },
		{ value: "deckCount", text: "Deck Count" },
		{ value: "massPerDeck", text: "Mass Per Deck" }
	];
	var currentMode = "holeCount";
	var existingMode = document.getElementById("timeChartMode");
	if (existingMode) currentMode = existingMode.value;

	for (var i = 0; i < modeOptions.length; i++) {
		var opt = document.createElement("option");
		opt.value = modeOptions[i].value;
		opt.textContent = modeOptions[i].text;
		if (modeOptions[i].value === currentMode) opt.selected = true;
		modeSelect.appendChild(opt);
	}
	modeSelect.addEventListener("change", function () {
		var orig = document.getElementById("timeChartMode");
		if (orig) {
			orig.value = modeSelect.value;
			orig.dispatchEvent(new Event("change"));
		}
	});

	modeRow.appendChild(modeLabel);
	modeRow.appendChild(modeSelect);
	container.appendChild(modeRow);

	// Step 8) Create the dialog
	timeWindowDialog = new FloatingDialog({
		title: "Time Window",
		content: container,
		width: 700,
		height: 620,
		passthroughKeys: true,
		showConfirm: false,
		showCancel: true,
		cancelText: "Close",
		showOption1: true,
		option1Text: "Refresh Time",
		onOption1: function () {
			// Step 8a) Force recalculate hole time / downhole timing
			if (typeof window.onTimingChanged === "function") {
				window.onTimingChanged();
			}
			// Step 8b) Refresh the chart after recalculation
			setTimeout(function () {
				if (typeof window.timeChart === "function") {
					window.timeChart();
				}
			}, 50);
			return false;
		},
		onCancel: function () {
			timeWindowDialog = null;
		}
	});
	timeWindowDialog.show();

	// Step 9) Trigger chart redraw after dialog is visible
	setTimeout(function () {
		if (typeof window.timeChart === "function") {
			window.timeChart();
		}
	}, 100);
}

// Step 10) Wire button on DOMContentLoaded
document.addEventListener("DOMContentLoaded", function () {
	var timeWindowBtn = document.getElementById("timeWindowBtn");
	if (timeWindowBtn) {
		timeWindowBtn.addEventListener("click", showTimeWindowDialog);
	}
});

// Step 11) Expose globally
window.showTimeWindowDialog = showTimeWindowDialog;
