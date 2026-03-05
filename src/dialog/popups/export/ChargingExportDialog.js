// ChargingExportDialog.js
// Handles charging CSV export format selection and routing to BlastHoleCSVWriter
// Created: 2026-02-15

import { chargingKey } from "../../../charging/HoleCharging.js";

/**
 * Show charging CSV export dialog with radio buttons for format and filename input.
 * Uses BlastHoleCSVWriter with charging formats (summary, detail, primers, timing).
 */
export function showChargingExportDialog() {
	// Step 1) Check for charging data
	if (!window.loadedCharging || window.loadedCharging.size === 0) {
		window.showModalMessage("No Charging Data", "No charging data loaded. Apply charging to holes first.", "warning");
		return;
	}

	// Step 2) Count holes with charging
	var chargedCount = 0;
	var visibleHoles = window.allBlastHoles.filter(function(h) { return window.isHoleVisible(h); });
	for (var i = 0; i < visibleHoles.length; i++) {
		if (window.loadedCharging.has(chargingKey(visibleHoles[i]))) {
			chargedCount++;
		}
	}

	if (chargedCount === 0) {
		window.showModalMessage("No Charged Holes", "No visible holes have charging data assigned.", "warning");
		return;
	}

	// Step 3) Generate default filenames
	var timestamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_");
	var entityName = visibleHoles.length > 0 && visibleHoles[0].entityName ? visibleHoles[0].entityName : "Blast";
	var defaultFilenames = {
		"charging-summary": "KAB_" + entityName + "_ChargingSummary_" + timestamp + ".csv",
		"charging-detail": "KAB_" + entityName + "_ChargingDetail_" + timestamp + ".csv",
		"charging-primers": "KAB_" + entityName + "_ChargingPrimers_" + timestamp + ".csv",
		"charging-timing": "KAB_" + entityName + "_ChargingTiming_" + timestamp + ".csv"
	};

	// Step 4) Build dialog content
	var contentHTML = '<div style="display: flex; flex-direction: column; gap: 15px; padding: 10px;">';

	// Info banner
	contentHTML += '<div style="background: var(--accent-bg, #1a3a5c); border-radius: 4px; padding: 8px 12px;">';
	contentHTML += '<span class="labelWhite15" style="margin: 0;">' + chargedCount + ' of ' + visibleHoles.length + ' visible holes have charging data</span>';
	contentHTML += '</div>';

	// Format selection
	contentHTML += '<div style="border: 1px solid var(--light-mode-border); border-radius: 4px; padding: 10px; background: var(--dark-mode-bg);">';
	contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-weight: bold;">Export Format:</p>';

	contentHTML += '<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">';
	contentHTML += '<input type="radio" id="chg-summary" name="chg-format" value="charging-summary" checked style="margin: 3px 0 0 0;">';
	contentHTML += '<label for="chg-summary" class="labelWhite15" style="margin: 0; cursor: pointer;"><strong>Summary</strong> - One row per hole with total mass, deck count, primer count, stem/charge lengths</label>';
	contentHTML += '</div>';

	contentHTML += '<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">';
	contentHTML += '<input type="radio" id="chg-detail" name="chg-format" value="charging-detail" style="margin: 3px 0 0 0;">';
	contentHTML += '<label for="chg-detail" class="labelWhite15" style="margin: 0; cursor: pointer;"><strong>Deck Detail</strong> - One row per deck per hole with depths, product, density, mass</label>';
	contentHTML += '</div>';

	contentHTML += '<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">';
	contentHTML += '<input type="radio" id="chg-primers" name="chg-format" value="charging-primers" style="margin: 3px 0 0 0;">';
	contentHTML += '<label for="chg-primers" class="labelWhite15" style="margin: 0; cursor: pointer;"><strong>Primers</strong> - One row per primer with detonator, booster, downhole delay details</label>';
	contentHTML += '</div>';

	contentHTML += '<div style="display: flex; align-items: flex-start; gap: 8px;">';
	contentHTML += '<input type="radio" id="chg-timing" name="chg-format" value="charging-timing" style="margin: 3px 0 0 0;">';
	contentHTML += '<label for="chg-timing" class="labelWhite15" style="margin: 0; cursor: pointer;"><strong>Timing</strong> - One row per explosive deck with surface delay, downhole delay, total fire time</label>';
	contentHTML += '</div>';

	contentHTML += '</div>';

	// Filename input
	contentHTML += '<div style="border: 1px solid var(--light-mode-border); border-radius: 4px; padding: 10px; background: var(--dark-mode-bg);">';
	contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-weight: bold;">Filename:</p>';
	contentHTML += '<input type="text" id="chg-filename" value="' + defaultFilenames["charging-summary"] + '" style="width: 100%; padding: 6px; border: 1px solid var(--light-mode-border); border-radius: 4px; background: var(--input-bg); color: var(--text-color); font-family: monospace; box-sizing: border-box;">';
	contentHTML += '</div>';

	contentHTML += '</div>';

	// Step 5) Create dialog using FloatingDialog
	var dialog = new window.FloatingDialog({
		title: "Export Charging CSV",
		content: contentHTML,
		layoutType: "default",
		width: 580,
		height: 430,
		showConfirm: true,
		showCancel: true,
		confirmText: "Export",
		cancelText: "Cancel",
		onConfirm: async function() {
			var formatRadio = document.querySelector('input[name="chg-format"]:checked');
			var format = formatRadio ? formatRadio.value : "charging-summary";
			var filename = document.getElementById("chg-filename").value.trim();

			if (!filename) {
				window.showModalMessage("Export Cancelled", "No filename provided", "warning");
				return;
			}

			if (!filename.toLowerCase().endsWith(".csv")) {
				filename += ".csv";
			}

			dialog.close();

			await exportChargingCSV(format, filename, visibleHoles);
		},
		onCancel: function() {
			dialog.close();
		}
	});

	dialog.show();

	// Step 6) Update filename when format changes
	var radioButtons = document.querySelectorAll('input[name="chg-format"]');
	var filenameInput = document.getElementById("chg-filename");
	radioButtons.forEach(function(radio) {
		radio.addEventListener("change", function() {
			filenameInput.value = defaultFilenames[radio.value];
		});
	});
}

/**
 * Execute the charging CSV export
 * @param {string} format - The charging format (charging-summary, charging-detail, etc.)
 * @param {string} filename - The output filename
 * @param {Array} visibleHoles - Pre-filtered visible holes array
 */
async function exportChargingCSV(format, filename, visibleHoles) {
	try {
		var Writer = window.fileManager.writers.get("blasthole-csv-35");
		if (!Writer) {
			throw new Error("CSV writer not found in FileManager");
		}

		var writer = new Writer({ format: format });
		var blob = await writer.write({
			holes: visibleHoles,
			chargingMap: window.loadedCharging
		});

		if (window.showSaveFilePicker) {
			try {
				var handle = await window.showSaveFilePicker({
					suggestedName: filename,
					types: [{
						description: "CSV Files",
						accept: { "text/csv": [".csv"] }
					}]
				});
				var writable = await handle.createWritable();
				await writable.write(blob);
				await writable.close();
				window.showModalMessage("Export Success", "Exported charging data to " + filename, "success");
			} catch (err) {
				if (err.name !== "AbortError") {
					throw err;
				}
			}
		} else {
			writer.downloadFile(blob, filename);
			window.showModalMessage("Export Success", "Exported charging data to " + filename, "success");
		}

		console.log("Charging CSV export complete: " + format + " -> " + filename);
	} catch (error) {
		console.error("Charging CSV export error:", error);
		window.showModalMessage("Export Failed", "Error: " + error.message, "error");
	}
}

// Expose globally for kirra.js to access
window.showChargingExportDialog = showChargingExportDialog;
