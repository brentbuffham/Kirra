/**
 * @fileoverview Template selection and management dialog for XLSX print templates.
 *
 * Uses FloatingDialog for consistent UI. Provides:
 *   - Template file import (.xlsx)
 *   - Template library dropdown (saved templates from IndexedDB)
 *   - Output format selection (XLSX or PDF)
 *   - Preview of template sheets (names, page sizes)
 *   - User input fields (blast name, designer)
 *   - Entity filter
 *   - Delete / rename saved templates
 */

import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../dialog/FloatingDialog.js";
import {
	loadTemplate,
	evaluateTemplate,
	exportAsXLSX,
	downloadBlob,
	renderToPDF,
	saveTemplate,
	listSavedTemplates,
	deleteSavedTemplate,
	generateReferenceXLSX
} from "./TemplateEngine.js";
import { getAvailableVariables } from "./TemplateVariables.js";

/**
 * Show the template print dialog.
 *
 * @param {Object} [options]
 * @param {Object} [options.renderCallbacks] - Callbacks for rendering special tokens to PDF
 * @param {number} [options.scale] - Current print scale
 */
export function showTemplatePrintDialog(options) {
	options = options || {};

	var savedTemplates = [];
	var loadedTemplate = null;
	var loadedTemplateData = null; // Raw ArrayBuffer for saving

	// Build entity list from loaded holes
	var allHoles = window.allBlastHoles || [];
	var entitySet = {};
	for (var i = 0; i < allHoles.length; i++) {
		if (allHoles[i].entityName) entitySet[allHoles[i].entityName] = true;
	}
	var entityNames = Object.keys(entitySet);

	// Entity filter options
	var entityOptions = [{ value: "", label: "All Entities" }];
	for (var j = 0; j < entityNames.length; j++) {
		entityOptions.push({ value: entityNames[j], label: entityNames[j] });
	}

	// Build form content (file type not supported by createEnhancedFormContent, added manually)
	var formFields = [
		{ name: "savedTemplate", label: "Saved Template", type: "select", options: [{ value: "", label: "-- Select or import --" }], value: "" },
		{ name: "sheetSelect", label: "Sheet", type: "select", options: [{ value: "", label: "All Sheets" }], value: "" },
		{ name: "blastName", label: "Blast Name", type: "text", value: "" },
		{ name: "designer", label: "Designer", type: "text", value: "" },
		{ name: "entityFilter", label: "Entity Filter", type: "select", options: entityOptions, value: "" },
		{ name: "outputFormat", label: "Output Format", type: "select", options: [
			{ value: "pdf", label: "PDF (Rendered Document)" },
			{ value: "xlsx", label: "XLSX (Populated Spreadsheet)" }
		], value: "pdf" }
	];

	var formContent = createEnhancedFormContent(formFields);

	// Insert file input manually after the saved template select
	var fileRow = document.createElement("div");
	fileRow.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0;padding:0 4px;";
	var fileLabel = document.createElement("label");
	fileLabel.textContent = "Import Template (.xlsx)";
	fileLabel.style.cssText = "font-size:12px;min-width:140px;";
	var fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.name = "templateFile";
	fileInput.accept = ".xlsx,.xls";
	fileInput.style.cssText = "font-size:12px;flex:1;";
	fileRow.appendChild(fileLabel);
	fileRow.appendChild(fileInput);
	// Insert after first child (savedTemplate row)
	var firstRow = formContent.querySelector('[name="savedTemplate"]');
	if (firstRow && firstRow.parentElement && firstRow.parentElement.nextSibling) {
		formContent.insertBefore(fileRow, firstRow.parentElement.nextSibling);
	} else {
		formContent.insertBefore(fileRow, formContent.firstChild);
	}

	// Add template info area below form
	var infoArea = document.createElement("div");
	infoArea.id = "templateInfoArea";
	infoArea.style.cssText = "margin-top:8px;padding:8px;background:#f0f0f0;border-radius:4px;font-size:12px;min-height:40px;";
	infoArea.textContent = "No template loaded. Import an .xlsx file or select a saved template.";
	formContent.appendChild(infoArea);

	// Create dialog with footer buttons via FloatingDialog options
	var dialog = new FloatingDialog({
		title: "Print PDF from Template",
		content: formContent,
		width: 480,
		height: 460,
		showConfirm: true,
		confirmText: "Print",
		showCancel: true,
		showOption1: true,
		option1Text: "Save to Library",
		showOption2: true,
		option2Text: "Formulas",
		showOption3: true,
		option3Text: "Reference XLSX",
		showOption4: true,
		option4Text: "Delete",
		onConfirm: function () {
			handleGenerate();
		},
		onOption1: function () {
			// Save to Library
			if (!loadedTemplate || !loadedTemplateData) {
				infoArea.textContent = "Load a template first before saving.";
				return false; // Don't close dialog
			}
			var name = prompt("Template name:", loadedTemplate.fileName.replace(/\.xlsx$/i, ""));
			if (!name) return false;
			saveTemplate(name, loadedTemplateData).then(function () {
				refreshSavedTemplates();
				infoArea.textContent = "Template saved as: " + name;
			});
			return false; // Don't close dialog
		},
		onOption2: function () {
			// Formula Reference
			showFormulaReference();
			return false; // Don't close dialog
		},
		onOption3: function () {
			// Download Reference XLSX
			generateReferenceXLSX().then(function (blob) {
				downloadBlob(blob, "Kirra_Template_Reference.xlsx");
			});
			return false; // Don't close dialog
		},
		onOption4: function () {
			// Delete Selected
			var name = savedSelect ? savedSelect.value : "";
			if (!name) {
				infoArea.textContent = "Select a saved template first.";
				return false;
			}
			if (!confirm("Delete template '" + name + "'?")) return false;
			deleteSavedTemplate(name).then(function () {
				refreshSavedTemplates();
				loadedTemplate = null;
				loadedTemplateData = null;
				infoArea.textContent = "Template deleted.";
			});
			return false; // Don't close dialog
		}
	});

	dialog.show();

	// ── Wire up interactions ──

	var savedSelect = formContent.querySelector('[name="savedTemplate"]');

	// Load saved templates list
	refreshSavedTemplates();

	// File import handler (fileInput created manually above)
	fileInput.addEventListener("change", function () {
		if (fileInput.files && fileInput.files.length > 0) {
			var file = fileInput.files[0];
			loadTemplateFromFile(file);
		}
	});

	// Saved template selection
	if (savedSelect) {
		savedSelect.addEventListener("change", function () {
			var name = savedSelect.value;
			if (name) {
				loadTemplateFromSaved(name);
			}
		});
	}

	// ── Internal functions ──

	function refreshSavedTemplates() {
		listSavedTemplates().then(function (templates) {
			savedTemplates = templates;
			if (!savedSelect) return;
			// Preserve current selection
			var current = savedSelect.value;
			// Clear options
			while (savedSelect.options.length > 1) savedSelect.remove(1);
			// Add saved templates
			for (var i = 0; i < templates.length; i++) {
				var opt = document.createElement("option");
				opt.value = templates[i].name;
				opt.textContent = templates[i].name + " (" + templates[i].savedAt.substring(0, 10) + ")";
				savedSelect.appendChild(opt);
			}
			// Restore selection
			if (current) savedSelect.value = current;
		});
	}

	function loadTemplateFromFile(file) {
		file.arrayBuffer().then(function (buf) {
			loadedTemplateData = buf;
			return loadTemplate(buf);
		}).then(function (template) {
			loadedTemplate = template;
			loadedTemplate.fileName = file.name;
			updateInfoArea(template);
		}).catch(function (err) {
			infoArea.textContent = "Error loading template: " + err.message;
			console.error("Template load error:", err);
		});
	}

	function loadTemplateFromSaved(name) {
		// Find in saved templates and load from IndexedDB
		var dbReq = indexedDB.open("KirraDB");
		dbReq.onsuccess = function () {
			var db = dbReq.result;
			if (!db.objectStoreNames.contains("printTemplates")) {
				infoArea.textContent = "No templates store found.";
				return;
			}
			var tx = db.transaction("printTemplates", "readonly");
			var store = tx.objectStore("printTemplates");
			var req = store.get(name);
			req.onsuccess = function () {
				if (!req.result || !req.result.data) {
					infoArea.textContent = "Template data not found.";
					return;
				}
				loadedTemplateData = req.result.data;
				loadTemplate(req.result.data).then(function (template) {
					loadedTemplate = template;
					loadedTemplate.fileName = name + ".xlsx";
					updateInfoArea(template);
				}).catch(function (err) {
					infoArea.textContent = "Error parsing template: " + err.message;
				});
			};
		};
	}

	function updateInfoArea(template) {
		var lines = [];
		lines.push("Template: " + template.fileName);
		lines.push("Sheets: " + template.sheets.length);
		for (var i = 0; i < template.sheets.length; i++) {
			var s = template.sheets[i];
			var cfg = s.config;
			lines.push("  " + (i + 1) + ". " + s.name + " (" + cfg.paperSize + " " + cfg.orientation + ", " + cfg.widthMm + "x" + cfg.heightMm + "mm)");
			lines.push("     Formulas: " + s.formulaCells.length + ", Cells: " + Object.keys(s.cells).length);
		}
		if (template.images.length > 0) {
			lines.push("Images: " + template.images.length);
		}
		infoArea.textContent = lines.join("\n");
		infoArea.style.whiteSpace = "pre-wrap";

		// Update sheet selector
		var sheetSelect = formContent.querySelector('[name="sheetSelect"]');
		if (sheetSelect) {
			while (sheetSelect.options.length > 1) sheetSelect.remove(1);
			for (var j = 0; j < template.sheets.length; j++) {
				var opt = document.createElement("option");
				opt.value = template.sheets[j].name;
				opt.textContent = template.sheets[j].name;
				sheetSelect.appendChild(opt);
			}
		}
	}

	function handleGenerate() {
		if (!loadedTemplate) {
			alert("Please import or select a template first.");
			return;
		}

		var formData = getFormData(formContent);
		var evalOptions = {
			blastName: formData.blastName || "",
			designer: formData.designer || "",
			entityFilter: formData.entityFilter || null,
			scale: options.scale || 0
		};

		// Use selected sheet config for paper size, or first sheet as fallback
		var selectedSheetName = formData.sheetSelect || "";
		var configSheet = null;
		if (selectedSheetName) {
			for (var si = 0; si < loadedTemplate.sheets.length; si++) {
				if (loadedTemplate.sheets[si].name === selectedSheetName) {
					configSheet = loadedTemplate.sheets[si];
					break;
				}
			}
		}
		if (!configSheet && loadedTemplate.sheets.length > 0) {
			configSheet = loadedTemplate.sheets[0];
		}
		if (configSheet) {
			evalOptions.paperSize = configSheet.config.paperSize;
			evalOptions.orientation = configSheet.config.orientation;
		}

		var evaluated = evaluateTemplate(loadedTemplate, evalOptions);

		// Filter to selected sheet if one is chosen
		var selectedSheet = formData.sheetSelect || "";
		if (selectedSheet) {
			evaluated.sheets = evaluated.sheets.filter(function (s) {
				return s.name === selectedSheet;
			});
		}

		if (formData.outputFormat === "xlsx") {
			// Generate populated XLSX (async)
			exportAsXLSX(loadedTemplate, evaluated).then(function (blob) {
				var fileName = (formData.blastName || "blast_report").replace(/[^a-zA-Z0-9_-]/g, "_") + ".xlsx";
				downloadBlob(blob, fileName);
			});
		} else {
			// Generate PDF
			generatePDF(loadedTemplate, evaluated, formData, options.renderCallbacks || {});
		}
	}
}

/**
 * Generate PDF from evaluated template using jsPDF.
 */
function generatePDF(template, evaluated, formData, renderCallbacks) {
	// Dynamic import jsPDF (already available in project)
	import("jspdf").then(function (module) {
		var jsPDF = module.jsPDF || module.default;

		// Use first sheet config for initial page
		var firstConfig = evaluated.sheets.length > 0 ? evaluated.sheets[0].config : { widthMm: 420, heightMm: 297, orientation: "landscape" };

		var doc = new jsPDF({
			orientation: firstConfig.orientation === "landscape" ? "l" : "p",
			unit: "mm",
			format: [firstConfig.widthMm, firstConfig.heightMm]
		});

		renderToPDF(template, evaluated, doc, renderCallbacks);

		var fileName = (formData.blastName || "blast_report").replace(/[^a-zA-Z0-9_-]/g, "_") + ".pdf";
		doc.save(fileName);
	}).catch(function (err) {
		console.error("PDF generation error:", err);
		alert("Error generating PDF: " + err.message);
	});
}

/**
 * Show the formula reference dialog.
 */
function showFormulaReference() {
	var vars = getAvailableVariables();

	var container = document.createElement("div");
	container.style.cssText = "max-height:500px;overflow-y:auto;font-size:12px;font-family:monospace;";

	// Group by type
	var groups = { scalar: "Scalar Variables", iterated: "Iterated Fields (use [i])", function: "Functions", operator: "Operators", render: "Render Functions (Graphics)" };

	for (var groupKey in groups) {
		var groupVars = vars.filter(function (v) { return v.type === groupKey; });
		if (groupVars.length === 0) continue;

		var heading = document.createElement("h4");
		heading.textContent = groups[groupKey];
		heading.style.cssText = "margin:12px 0 4px 0;padding-bottom:2px;border-bottom:1px solid #ccc;";
		container.appendChild(heading);

		var table = document.createElement("table");
		table.style.cssText = "width:100%;border-collapse:collapse;margin-bottom:8px;";

		for (var i = 0; i < groupVars.length; i++) {
			var v = groupVars[i];
			var row = document.createElement("tr");
			row.style.cssText = i % 2 === 0 ? "background:#f8f8f8;" : "";

			var nameCell = document.createElement("td");
			nameCell.style.cssText = "padding:2px 6px;font-weight:bold;white-space:nowrap;color:#0066cc;";
			nameCell.textContent = v.name;

			var descCell = document.createElement("td");
			descCell.style.cssText = "padding:2px 6px;";
			descCell.textContent = v.description;

			var exCell = document.createElement("td");
			exCell.style.cssText = "padding:2px 6px;color:#666;font-style:italic;";
			exCell.textContent = v.example || "";

			row.appendChild(nameCell);
			row.appendChild(descCell);
			row.appendChild(exCell);
			table.appendChild(row);
		}

		container.appendChild(table);
	}

	var refDialog = new FloatingDialog({
		title: "Template Formula Reference",
		content: container,
		width: 700,
		height: 560,
		showConfirm: false,
		showCancel: true,
		cancelText: "Close"
	});
	refDialog.show();
}
