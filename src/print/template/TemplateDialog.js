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
import { setTemplatePreview, clearTemplatePreview, captureMapViewRaster, getPrintBoundary, setPaperSizeAndOrientation, printCanvasHiRes, printPaperSize, printOrientation } from "../PrintSystem.js";
import { generateTrueVectorPDF } from "../PrintVectorPDF.js";
import { PrintCaptureManager } from "../PrintCaptureManager.js";

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

	// Load saved preferences from localStorage
	var prefs = loadTemplatePrefs();

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

	// Paper size and orientation options
	var paperSizeOptions = [
		{ value: "", label: "From Sheet" },
		{ value: "A4", label: "A4" },
		{ value: "A3", label: "A3" },
		{ value: "A2", label: "A2" },
		{ value: "A1", label: "A1" },
		{ value: "A0", label: "A0" },
		{ value: "Letter", label: "Letter" },
		{ value: "Legal", label: "Legal" },
		{ value: "Tabloid", label: "Tabloid" }
	];
	var orientationOptions = [
		{ value: "", label: "From Sheet" },
		{ value: "landscape", label: "Landscape" },
		{ value: "portrait", label: "Portrait" }
	];

	// Build form content
	var formFields = [
		{ name: "savedTemplate", label: "Saved Template", type: "select", options: [
			{ value: "__kirra_inbuilt__", label: "Kirra Inbuilt" },
			{ value: "", label: "-- Select or Import --" }
		], value: prefs.lastTemplate || "__kirra_inbuilt__" },
		{ name: "sheetSelect", label: "Sheet", type: "select", options: [{ value: "", label: "All Sheets" }], value: "" },
		{ name: "paperSizeOverride", label: "Paper Size", type: "select", options: paperSizeOptions, value: "" },
		{ name: "orientationOverride", label: "Orientation", type: "select", options: orientationOptions, value: "" },
		{ name: "blastName", label: "Blast Name", type: "text", value: prefs.blastName || "" },
		{ name: "designer", label: "Designer", type: "text", value: prefs.designer || "" },
		{ name: "entityFilter", label: "Entity Filter", type: "select", options: entityOptions, value: "" },
		{ name: "outputFormat", label: "Output Format", type: "select", options: [
			{ value: "pdf", label: "PDF Raster (High-Res Image)" },
			{ value: "pdf-vector", label: "PDF Vector (Scalable)" },
			{ value: "xlsx", label: "XLSX (Populated Spreadsheet)" }
		], value: prefs.outputFormat || "pdf" }
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

	// Track whether print preview was already on before dialog opened
	var printPreviewToggle = document.getElementById("addPrintPreviewToggle");
	var printPreviewWasOn = printPreviewToggle ? printPreviewToggle.checked : false;

	// Force print preview ON when dialog opens
	if (printPreviewToggle && !printPreviewToggle.checked) {
		printPreviewToggle.checked = true;
		printPreviewToggle.dispatchEvent(new Event("change"));
	}

	// Create dialog with footer buttons via FloatingDialog options
	var dialog = new FloatingDialog({
		title: "Print",
		content: formContent,
		width: 480,
		height: 460,
		showConfirm: true,
		confirmText: "Print",
		showCancel: true,
		onCancel: function () {
			// Clear the template preview overlay when dialog closes
			clearTemplatePreview();
			// Restore print preview state if it was off before dialog opened
			if (!printPreviewWasOn && printPreviewToggle) {
				printPreviewToggle.checked = false;
				printPreviewToggle.dispatchEvent(new Event("change"));
			}
			if (typeof window.drawData === "function") {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		},
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
			// Switch to template mode when importing
			if (savedSelect) savedSelect.value = "";
			toggleKirraInbuiltMode(false);
			loadTemplateFromFile(file);
		}
	});

	// Saved template selection
	if (savedSelect) {
		savedSelect.addEventListener("change", function () {
			var name = savedSelect.value;
			if (name === "__kirra_inbuilt__") {
				toggleKirraInbuiltMode(true);
			} else if (name) {
				toggleKirraInbuiltMode(false);
				loadTemplateFromSaved(name);
			} else {
				toggleKirraInbuiltMode(false);
			}
		});
	}

	// Sheet selector — update preview when sheet changes
	var sheetSelect = formContent.querySelector('[name="sheetSelect"]');
	if (sheetSelect) {
		sheetSelect.addEventListener("change", function () {
			if (!loadedTemplate) return;
			var selectedName = sheetSelect.value;
			var sheetCfg = null;
			if (selectedName) {
				for (var si = 0; si < loadedTemplate.sheets.length; si++) {
					if (loadedTemplate.sheets[si].name === selectedName) {
						sheetCfg = loadedTemplate.sheets[si].config;
						break;
					}
				}
			}
			if (!sheetCfg && loadedTemplate.sheets.length > 0) {
				sheetCfg = loadedTemplate.sheets[0].config;
				selectedName = loadedTemplate.sheets[0].name;
			}
			if (sheetCfg) {
				updatePaperDropdowns(sheetCfg);
				activateTemplatePreview(getEffectiveConfig(sheetCfg), selectedName);
			}
		});
	}

	// Paper size / orientation override — update preview when changed
	var paperSelect = formContent.querySelector('[name="paperSizeOverride"]');
	var orientSelect = formContent.querySelector('[name="orientationOverride"]');

	function onPaperOverrideChange() {
		var isInbuilt = savedSelect && savedSelect.value === "__kirra_inbuilt__";
		if (isInbuilt) {
			// In Kirra Inbuilt mode, directly sync with Kirra controls
			var ps = paperSelect ? paperSelect.value : "A3";
			var orient = orientSelect ? orientSelect.value : "landscape";
			setPaperSizeAndOrientation(ps, orient);
			return;
		}
		if (!loadedTemplate) return;
		var selectedSheet = sheetSelect ? sheetSelect.value : "";
		var sheetCfg = null;
		if (selectedSheet) {
			for (var si = 0; si < loadedTemplate.sheets.length; si++) {
				if (loadedTemplate.sheets[si].name === selectedSheet) { sheetCfg = loadedTemplate.sheets[si].config; break; }
			}
		}
		if (!sheetCfg && loadedTemplate.sheets.length > 0) sheetCfg = loadedTemplate.sheets[0].config;
		if (sheetCfg) {
			activateTemplatePreview(getEffectiveConfig(sheetCfg), selectedSheet || (loadedTemplate.sheets[0] && loadedTemplate.sheets[0].name) || "");
		}
	}
	if (paperSelect) paperSelect.addEventListener("change", onPaperOverrideChange);
	if (orientSelect) orientSelect.addEventListener("change", onPaperOverrideChange);

	/**
	 * Toggle UI between Kirra Inbuilt mode and XLSX template mode.
	 */
	function toggleKirraInbuiltMode(isInbuilt) {
		// Show/hide template-specific rows
		var sheetRow = formContent.querySelector('[name="sheetSelect"]');
		if (sheetRow && sheetRow.parentElement) sheetRow.parentElement.style.display = isInbuilt ? "none" : "";
		fileRow.style.display = isInbuilt ? "none" : "";

		// Update output format options — XLSX only available for templates
		var outputSelect = formContent.querySelector('[name="outputFormat"]');
		if (outputSelect) {
			for (var i = 0; i < outputSelect.options.length; i++) {
				if (outputSelect.options[i].value === "xlsx") {
					outputSelect.options[i].disabled = isInbuilt;
					if (isInbuilt && outputSelect.value === "xlsx") {
						outputSelect.value = "pdf";
					}
				}
			}
		}

		// Update paper size / orientation — remove "From Sheet" option for inbuilt
		var paperSel = formContent.querySelector('[name="paperSizeOverride"]');
		var orientSel = formContent.querySelector('[name="orientationOverride"]');
		if (isInbuilt) {
			// For Kirra Inbuilt, set dropdowns to current Kirra values
			if (paperSel) {
				if (paperSel.options[0] && paperSel.options[0].value === "") paperSel.options[0].style.display = "none";
				paperSel.value = printPaperSize || "A3";
			}
			if (orientSel) {
				if (orientSel.options[0] && orientSel.options[0].value === "") orientSel.options[0].style.display = "none";
				orientSel.value = printOrientation || "landscape";
			}
			// Sync Kirra print preview
			var ps = paperSel ? paperSel.value : "A3";
			var orient = orientSel ? orientSel.value : "landscape";
			setPaperSizeAndOrientation(ps, orient);
			clearTemplatePreview();

			loadedTemplate = null;
			loadedTemplateData = null;
			infoArea.textContent = "Kirra Inbuilt: Uses the built-in print pipeline.\nSupports 2D and 3D modes, Voronoi, surfaces, clipping.";
			infoArea.style.whiteSpace = "pre-wrap";
		} else {
			// For templates, restore "From Sheet" option
			if (paperSel && paperSel.options[0] && paperSel.options[0].value === "") paperSel.options[0].style.display = "";
			if (orientSel && orientSel.options[0] && orientSel.options[0].value === "") orientSel.options[0].style.display = "";
		}
	}

	// Auto-load last used saved template or default to Kirra Inbuilt
	if (prefs.lastTemplate && prefs.lastTemplate !== "__kirra_inbuilt__") {
		setTimeout(function () {
			if (savedSelect) savedSelect.value = prefs.lastTemplate;
			toggleKirraInbuiltMode(false);
			loadTemplateFromSaved(prefs.lastTemplate);
		}, 100);
	} else {
		// Default to Kirra Inbuilt
		setTimeout(function () {
			if (savedSelect) savedSelect.value = "__kirra_inbuilt__";
			toggleKirraInbuiltMode(true);
		}, 50);
	}

	// ── Internal functions ──

	function handleKirraInbuiltPrint() {
		var formData = getFormData(formContent);
		var ctx = options.context || {};

		// Save preferences
		saveTemplatePrefs({
			lastTemplate: "__kirra_inbuilt__",
			blastName: formData.blastName || "",
			designer: formData.designer || "",
			outputFormat: formData.outputFormat || "pdf"
		});

		// Get paper size and orientation from the dialog controls
		var ps = formData.paperSizeOverride || printPaperSize || "A3";
		var orient = formData.orientationOverride || printOrientation || "landscape";

		// Sync Kirra controls to match dialog settings
		setPaperSizeAndOrientation(ps, orient);

		// Detect 2D/3D mode
		var dimension2D3DBtn = document.getElementById("dimension2D-3DBtn");
		var isIn3DMode = dimension2D3DBtn && dimension2D3DBtn.checked === true;
		var mode = isIn3DMode ? "3D" : "2D";

		// Build user input for the inbuilt pipeline
		var userInput = {
			blastName: formData.blastName || "Untitled Blast",
			designer: formData.designer || "",
			fileName: (formData.blastName || "blast_report").replace(/[^a-zA-Z0-9_-]/g, "_"),
			paperSize: ps,
			orientation: orient,
			outputType: formData.outputFormat === "pdf-vector" ? "vector" : "raster"
		};

		// Build the enhanced print context matching what setupPrintEventHandlers creates
		var printContext = Object.assign({}, ctx, {
			getPrintBoundary: getPrintBoundary,
			mode: mode,
			is3DMode: isIn3DMode,
			printPaperSize: ps,
			printOrientation: orient,
			userInput: userInput
		});

		// Close dialog before printing
		dialog.close();

		// Clear template preview so inbuilt pipeline uses Kirra boundary
		clearTemplatePreview();

		if (userInput.outputType === "vector") {
			generateTrueVectorPDF(printContext, userInput, mode);
		} else {
			printCanvasHiRes(printContext);
		}
	}

	function refreshSavedTemplates() {
		listSavedTemplates().then(function (templates) {
			savedTemplates = templates;
			if (!savedSelect) return;
			// Preserve current selection
			var current = savedSelect.value;
			// Clear all options after the first two (Kirra Inbuilt + "-- Select or Import --")
			while (savedSelect.options.length > 2) savedSelect.remove(2);
			// Add saved templates before the "-- Select or Import --" option
			var importOption = savedSelect.options[1]; // "-- Select or Import --"
			for (var i = 0; i < templates.length; i++) {
				var opt = document.createElement("option");
				opt.value = templates[i].name;
				opt.textContent = templates[i].name + " (" + templates[i].savedAt.substring(0, 10) + ")";
				savedSelect.insertBefore(opt, importOption);
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

		// Populate paper size and orientation from the first sheet's config
		if (template.sheets.length > 0) {
			var firstCfg = template.sheets[0].config;
			updatePaperDropdowns(firstCfg);
			activateTemplatePreview(getEffectiveConfig(firstCfg), template.sheets[0].name);
		}
	}

	/**
	 * Update paper size / orientation dropdowns to show inherited values from the sheet.
	 * The "From Sheet Name" option label shows the detected value.
	 */
	function updatePaperDropdowns(sheetCfg) {
		var paperSelect = formContent.querySelector('[name="paperSizeOverride"]');
		var orientSelect = formContent.querySelector('[name="orientationOverride"]');
		if (paperSelect && paperSelect.options.length > 0) {
			paperSelect.options[0].textContent = "From Sheet (" + sheetCfg.paperSize + ")";
		}
		if (orientSelect && orientSelect.options.length > 0) {
			orientSelect.options[0].textContent = "From Sheet (" + sheetCfg.orientation + ")";
		}
	}

	/**
	 * Get effective config — sheet config with user overrides applied.
	 */
	function getEffectiveConfig(sheetCfg) {
		var paperOverride = formContent.querySelector('[name="paperSizeOverride"]');
		var orientOverride = formContent.querySelector('[name="orientationOverride"]');
		var ps = paperOverride && paperOverride.value ? paperOverride.value : sheetCfg.paperSize;
		var orient = orientOverride && orientOverride.value ? orientOverride.value : sheetCfg.orientation;

		// Recalculate dimensions if overridden
		if (ps !== sheetCfg.paperSize || orient !== sheetCfg.orientation) {
			var PAPER = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189], Letter: [216, 279], Legal: [216, 356], Tabloid: [279, 432] };
			var dims = PAPER[ps] || PAPER.A3;
			return {
				paperSize: ps,
				orientation: orient,
				widthMm: orient === "landscape" ? Math.max(dims[0], dims[1]) : Math.min(dims[0], dims[1]),
				heightMm: orient === "landscape" ? Math.min(dims[0], dims[1]) : Math.max(dims[0], dims[1])
			};
		}
		return sheetCfg;
	}

	function activateTemplatePreview(cfg, sheetName) {
		// Sync Kirra print boundary with the template's paper size/orientation
		// This updates the on-screen print preview so the user can zoom/pan within it
		setPaperSizeAndOrientation(cfg.paperSize, cfg.orientation);

		// Also set template preview for the simple paper rectangle overlay
		setTemplatePreview({
			widthMm: cfg.widthMm,
			heightMm: cfg.heightMm,
			orientation: cfg.orientation,
			paperSize: cfg.paperSize,
			sheetName: sheetName || ""
		});
	}

	function handleGenerate() {
		var isKirraInbuilt = savedSelect && savedSelect.value === "__kirra_inbuilt__";

		if (isKirraInbuilt) {
			handleKirraInbuiltPrint();
			return;
		}

		if (!loadedTemplate) {
			alert("Please import or select a template first.");
			return;
		}

		var formData = getFormData(formContent);

		// Save preferences for next session
		saveTemplatePrefs({
			lastTemplate: savedSelect ? savedSelect.value : "",
			blastName: formData.blastName || "",
			designer: formData.designer || "",
			outputFormat: formData.outputFormat || "pdf"
		});

		var evalOptions = {
			blastName: formData.blastName || "",
			designer: formData.designer || "",
			entityFilter: formData.entityFilter || null,
			scale: options.scale || 0
		};

		// Use selected sheet config for paper size, with override support
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
			var effCfg = getEffectiveConfig(configSheet.config);
			evalOptions.paperSize = effCfg.paperSize;
			evalOptions.orientation = effCfg.orientation;
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
			exportAsXLSX(loadedTemplate, evaluated).then(function (blob) {
				var fileName = (formData.blastName || "blast_report").replace(/[^a-zA-Z0-9_-]/g, "_") + ".xlsx";
				downloadBlob(blob, fileName);
			});
		} else {
			generatePDF(loadedTemplate, evaluated, formData, options.context || {});
		}
	}
}

/**
 * Generate PDF from evaluated template using jsPDF.
 * @param {Object} template - Parsed template
 * @param {Object} evaluated - Evaluated template
 * @param {Object} formData - Form data from dialog
 * @param {Object} appContext - Application context (from PrintSystem getContext())
 */
function generatePDF(template, evaluated, formData, appContext) {
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

		// Build render callbacks from app context
		var renderCallbacks = buildRenderCallbacks(appContext, firstConfig);

		renderToPDF(template, evaluated, doc, renderCallbacks);

		var fileName = (formData.blastName || "blast_report").replace(/[^a-zA-Z0-9_-]/g, "_") + ".pdf";
		doc.save(fileName);
	}).catch(function (err) {
		console.error("PDF generation error:", err);
		alert("Error generating PDF: " + err.message);
	});
}

/**
 * Build render callbacks for template PDF rendering.
 * Provides map view (raster/vector), north arrow, scale bar, logo, QR code.
 *
 * @param {Object} ctx - Application context from PrintSystem
 * @param {Object} pageConfig - { widthMm, heightMm, orientation }
 * @returns {Object} Map of render type to callback function
 */
function buildRenderCallbacks(ctx, pageConfig) {
	// Pre-capture north arrow
	var northArrowDataURL = null;
	if (ctx) {
		try {
			northArrowDataURL = PrintCaptureManager.captureNorthArrow({
				currentRotation: ctx.currentRotation || 0,
				darkModeEnabled: false // Always dark-on-white for print
			});
		} catch (e) {
			console.warn("[TemplateDialog] Failed to capture north arrow:", e.message);
		}
	}

	// Compute the actual print scale denominator (1:X) from the print boundary
	// This represents how world metres map to mm on the PDF page
	var computedScaleDenominator = 0;
	if (ctx && ctx.canvas && ctx.currentScale) {
		try {
			var boundary = getPrintBoundary(ctx.canvas);
			if (boundary) {
				var inner = {
					width: boundary.innerWidth !== undefined ? boundary.innerWidth : boundary.width * (1 - 2 * boundary.marginPercent),
					height: boundary.innerHeight !== undefined ? boundary.innerHeight : boundary.height * (1 - 2 * boundary.marginPercent)
				};
				// World metres visible in the boundary
				var worldWidthM = inner.width / ctx.currentScale;
				// PDF mm for the page width (approximate — mapView fills most of the page)
				var pageWidthMm = pageConfig.widthMm || 420;
				// Scale: 1mm on PDF = (worldWidthM / pageWidthMm) metres = (worldWidthM / pageWidthMm * 1000) mm
				computedScaleDenominator = Math.round((worldWidthM * 1000) / pageWidthMm);
			}
		} catch (e) { /* ignore */ }
	}
	// Shared state: mapView can update this with its actual computed scale
	var mapViewScaleMmPerUnit = 0;

	// Cache for raster captures — keyed by "widthxheight" to reuse same capture for same-size cells
	var rasterCache = {};

	return {
		/**
		 * mapView — Render the current map view into the cell.
		 * args[0]: "r" = raster (default), "v" = vector
		 */
		mapView: function (doc, x, y, w, h, args) {
			// Parse args: mapView(mode, fontPt)
			// mode: "r" = raster, "v" = vector (default: "r")
			// fontPt: label font size in points, e.g. "10pt" or "10" (optional)
			var mode = args && args[0] ? args[0].toLowerCase().replace(/[^a-z]/g, "") : "r";
			var fontPt = 0;
			for (var ai = 0; ai < (args ? args.length : 0); ai++) {
				var ptMatch = String(args[ai]).match(/(\d+(?:\.\d+)?)\s*pt?/i);
				if (ptMatch) { fontPt = parseFloat(ptMatch[1]); break; }
			}

			if (mode === "v") {
				var mvScale = renderMapViewVector(doc, x, y, w, h, ctx, fontPt || 0);
				if (mvScale > 0) mapViewScaleMmPerUnit = mvScale;
				return;
			}

			// Raster rendering — use drawDataForPrinting for clean offscreen render
			// fontPt reused as DPI hint for raster: e.g. mapView(r, 300) = 300 DPI
			var dpi = fontPt > 50 ? fontPt : 200; // If > 50, treat as DPI; otherwise default 200
			var cacheKey = Math.round(w) + "x" + Math.round(h) + "@" + dpi;
			var dataURL = rasterCache[cacheKey];

			if (!dataURL && ctx) {
				try {
					dataURL = captureMapViewRaster(ctx, w, h, dpi);
					if (dataURL) rasterCache[cacheKey] = dataURL;
					console.log("[TemplateDialog] Captured raster map view " + Math.round(w) + "x" + Math.round(h) + "mm");
				} catch (e) {
					console.warn("[TemplateDialog] Raster capture failed:", e.message);
				}
			}

			if (!dataURL) {
				doc.setDrawColor(180, 180, 180);
				doc.setLineWidth(0.3);
				doc.rect(x, y, w, h, "S");
				doc.setFontSize(8);
				doc.setTextColor(150, 150, 150);
				doc.text("[Map View — no data]", x + w / 2, y + h / 2, { align: "center" });
				return;
			}

			try {
				doc.addImage(dataURL, "PNG", x, y, w, h);
				// Compute scale from boundary for raster mode too
				if (!mapViewScaleMmPerUnit && ctx && ctx.canvas && ctx.currentScale) {
					try {
						var rBnd = getPrintBoundary(ctx.canvas);
						if (rBnd) {
							var rInner = rBnd.innerWidth !== undefined ? rBnd.innerWidth : rBnd.width * (1 - 2 * rBnd.marginPercent);
							var worldW = rInner / ctx.currentScale;
							if (worldW > 0) mapViewScaleMmPerUnit = w / worldW;
						}
					} catch (be) { /* ignore */ }
				}
			} catch (e) {
				console.warn("[TemplateDialog] Failed to embed map image:", e.message);
				doc.setFontSize(8);
				doc.setTextColor(200, 0, 0);
				doc.text("[Map render error]", x + w / 2, y + h / 2, { align: "center" });
			}
		},

		/**
		 * northArrow — Render a north arrow in the cell.
		 */
		northArrow: function (doc, x, y, w, h) {
			if (!northArrowDataURL) {
				doc.setFontSize(14);
				doc.setTextColor(0, 0, 0);
				doc.text("N", x + w / 2, y + h / 2, { align: "center" });
				return;
			}
			try {
				// Maintain aspect ratio (square north arrow centered in cell)
				var size = Math.min(w, h);
				var ox = x + (w - size) / 2;
				var oy = y + (h - size) / 2;
				doc.addImage(northArrowDataURL, "PNG", ox, oy, size, size);
			} catch (e) {
				doc.setFontSize(14);
				doc.setTextColor(0, 0, 0);
				doc.text("N", x + w / 2, y + h / 2, { align: "center" });
			}
		},

		/**
		 * scale — Render a scale bar in the cell.
		 */
		/**
		 * scale — Renders both a scale bar AND scale text.
		 * Backwards-compatible: fx:scale renders bar + text.
		 */
		scale: function (doc, x, y, w, h, args) {
			drawScaleBar(doc, x, y, w, h, computedScaleDenominator, mapViewScaleMmPerUnit, true);
		},

		/**
		 * scaleBar — Renders only a graphical scale bar.
		 */
		scaleBar: function (doc, x, y, w, h, args) {
			drawScaleBar(doc, x, y, w, h, computedScaleDenominator, mapViewScaleMmPerUnit, false);
		},

		/**
		 * scaleText — Renders only "1:XXXX" text.
		 */
		scaleText: function (doc, x, y, w, h, args) {
			var denom = computedScaleDenominator || 0;
			if (!denom && mapViewScaleMmPerUnit > 0) {
				denom = Math.round(1000 / mapViewScaleMmPerUnit);
			}
			if (!denom) {
				doc.setFontSize(8);
				doc.setTextColor(100, 100, 100);
				doc.text("[No scale]", x + w / 2, y + h / 2, { align: "center" });
				return;
			}
			doc.setFontSize(Math.min(h * 0.7 / 0.353, 14)); // Fit to cell height
			doc.setTextColor(0, 0, 0);
			doc.setFont("helvetica", "normal");
			doc.text("1:" + denom, x + w / 2, y + h / 2 + 1, { align: "center" });
		},

		/**
		 * logo — Render user logo from the logo element.
		 */
		logo: function (doc, x, y, w, h) {
			var logoImg = document.getElementById("logoImage") || document.querySelector("img[alt='Logo']");
			if (logoImg && logoImg.src && logoImg.src !== "") {
				try {
					doc.addImage(logoImg.src, "PNG", x, y, w, h);
					return;
				} catch (e) {
					console.warn("[TemplateDialog] Failed to embed logo:", e.message);
				}
			}
			// Fallback placeholder
			doc.setDrawColor(200, 200, 200);
			doc.setLineWidth(0.2);
			doc.rect(x, y, w, h, "S");
			doc.setFontSize(8);
			doc.setTextColor(180, 180, 180);
			doc.text("[Logo]", x + w / 2, y + h / 2, { align: "center" });
		},

		/**
		 * qrcode — Render QR code.
		 */
		qrcode: function (doc, x, y, w, h) {
			// Try synchronous load of QR image
			var qrImg = new Image();
			qrImg.src = "icons/kirra2d-qr-code.png";
			try {
				var qrCanvas = document.createElement("canvas");
				qrCanvas.width = 110;
				qrCanvas.height = 110;
				var qrCtx = qrCanvas.getContext("2d");
				qrCtx.drawImage(qrImg, 0, 0, 110, 110);
				var dataURL = qrCanvas.toDataURL("image/png");
				var size = Math.min(w, h);
				var ox = x + (w - size) / 2;
				var oy = y + (h - size) / 2;
				doc.addImage(dataURL, "PNG", ox, oy, size, size);
			} catch (e) {
				doc.setFontSize(8);
				doc.setTextColor(150, 150, 150);
				doc.text("[QR]", x + w / 2, y + h / 2, { align: "center" });
			}
		},

		/**
		 * legend — Placeholder for legend rendering.
		 */
		legend: function (doc, x, y, w, h, args) {
			doc.setDrawColor(200, 200, 200);
			doc.setLineWidth(0.2);
			doc.rect(x, y, w, h, "S");
			doc.setFontSize(8);
			doc.setTextColor(100, 100, 100);
			var legendType = args && args[0] ? args[0] : "legend";
			doc.text("[Legend: " + legendType + "]", x + w / 2, y + h / 2, { align: "center" });
		},

		/**
		 * connectorCount — Render connector count table.
		 */
		connectorCount: function (doc, x, y, w, h) {
			doc.setFontSize(7);
			doc.setTextColor(0, 0, 0);
			doc.text("Connector Count", x + w / 2, y + 3, { align: "center" });
			// Render from visible holes
			var holes = window.allBlastHoles || [];
			var groups = {};
			for (var i = 0; i < holes.length; i++) {
				var hole = holes[i];
				if (hole.visible === false) continue;
				if (!hole.fromHoleID) continue;
				var delay = hole.timingDelayMilliseconds !== undefined ? hole.timingDelayMilliseconds : "Unk";
				groups[delay] = (groups[delay] || 0) + 1;
			}
			var keys = Object.keys(groups).sort(function (a, b) {
				if (a === "Unk") return 1;
				if (b === "Unk") return -1;
				return parseFloat(a) - parseFloat(b);
			});
			var rowY = y + 6;
			var rowH = 3;
			doc.setFontSize(6);
			for (var k = 0; k < keys.length && rowY < y + h - 2; k++) {
				var label = keys[k] === "Unk" ? "Unknown" : keys[k] + "ms";
				doc.text(label + ": " + groups[keys[k]], x + 2, rowY);
				rowY += rowH;
			}
		},

		/**
		 * sectionView — Placeholder for hole section view.
		 */
		sectionView: function (doc, x, y, w, h, args) {
			doc.setDrawColor(200, 200, 200);
			doc.setLineWidth(0.2);
			doc.rect(x, y, w, h, "S");
			doc.setFontSize(8);
			doc.setTextColor(100, 100, 100);
			var holeId = args && args[0] ? args[0] : "?";
			doc.text("[Section: " + holeId + "]", x + w / 2, y + h / 2, { align: "center" });
		}
	};
}

/**
 * Get a nice round scale bar length for the given approximate world width.
 * @param {number} approxWidth - Approximate width in metres
 * @returns {number} Nice round length in metres
 */
/**
 * Draw a scale bar into a PDF cell.
 * @param {Object} doc - jsPDF instance
 * @param {number} x, y, w, h - Cell bounds in mm
 * @param {number} scaleDenom - Pre-computed scale denominator (e.g. 1000 for 1:1000)
 * @param {number} mmPerUnit - mm per world-unit from mapView rendering
 * @param {boolean} showText - Whether to also show "1:XXXX" text
 */
function drawScaleBar(doc, x, y, w, h, scaleDenom, mmPerUnit, showText) {
	// Determine scale: prefer mmPerUnit from actual mapView, fallback to pre-computed
	var effectiveMmPerUnit = mmPerUnit;
	if (!effectiveMmPerUnit && scaleDenom > 0) {
		effectiveMmPerUnit = 1000 / scaleDenom; // convert 1:X to mm/unit
	}
	if (!effectiveMmPerUnit || effectiveMmPerUnit <= 0) {
		doc.setFontSize(8);
		doc.setTextColor(100, 100, 100);
		doc.text("[No scale]", x + w / 2, y + h / 2, { align: "center" });
		return;
	}

	var padding = 2;
	var barWidth = w - padding * 2;
	var barY = showText ? y + h * 0.35 : y + h * 0.5;
	var barH = Math.min(h * 0.15, 2.5);

	// World metres that fit in the available bar width
	var worldWidth = barWidth / effectiveMmPerUnit;
	var niceLen = getNiceScaleLength(worldWidth);
	var barLenMm = niceLen * effectiveMmPerUnit;
	if (barLenMm > barWidth) barLenMm = barWidth; // clamp

	doc.setDrawColor(0, 0, 0);
	doc.setFillColor(0, 0, 0);
	doc.setLineWidth(0.3);

	// Bar
	doc.rect(x + padding, barY - barH / 2, barLenMm, barH, "FD");

	// Ticks
	doc.line(x + padding, barY - barH, x + padding, barY + barH);
	doc.line(x + padding + barLenMm, barY - barH, x + padding + barLenMm, barY + barH);

	// Distance labels
	doc.setFontSize(6);
	doc.setTextColor(0, 0, 0);
	doc.setFont("helvetica", "normal");
	doc.text("0", x + padding, barY + barH + 2.5, { align: "center" });
	doc.text(niceLen + " m", x + padding + barLenMm, barY + barH + 2.5, { align: "center" });

	// Scale text
	if (showText) {
		var denom = scaleDenom || Math.round(1000 / effectiveMmPerUnit);
		doc.setFontSize(7);
		doc.text("1:" + denom, x + w / 2, y + h - 1, { align: "center" });
	}
}

function getNiceScaleLength(approxWidth) {
	var niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
	var target = approxWidth * 0.6; // Scale bar should be ~60% of available width
	for (var i = 0; i < niceSteps.length; i++) {
		if (niceSteps[i] >= target) return niceSteps[i];
	}
	return niceSteps[niceSteps.length - 1];
}

/**
 * Render map view as vector primitives directly into jsPDF.
 * Draws blast holes, connectors, and labels using jsPDF vector commands.
 *
 * @param {Object} doc - jsPDF instance
 * @param {number} x - Cell X position (mm)
 * @param {number} y - Cell Y position (mm)
 * @param {number} w - Cell width (mm)
 * @param {number} h - Cell height (mm)
 * @param {Object} ctx - Application context
 * @param {number} [fontPt=0] - Label font size in points (0 = auto)
 */
function renderMapViewVector(doc, x, y, w, h, ctx, fontPt) {
	if (!ctx || !ctx.canvas) {
		doc.setDrawColor(180, 180, 180);
		doc.rect(x, y, w, h, "S");
		doc.setFontSize(8);
		doc.setTextColor(150, 150, 150);
		doc.text("[Vector — no context]", x + w / 2, y + h / 2, { align: "center" });
		return 0;
	}

	var allHoles = ctx.allBlastHoles || window.allBlastHoles || [];
	var visibleHoles = allHoles.filter(function (hole) { return hole.visible !== false; });
	if (visibleHoles.length === 0) {
		doc.setFontSize(8);
		doc.setTextColor(150, 150, 150);
		doc.text("[No visible holes]", x + w / 2, y + h / 2, { align: "center" });
		return 0;
	}

	// Calculate world bounds from the print preview boundary
	var canvas = ctx.canvas;
	var scale = ctx.currentScale || 1;
	var centroidX = ctx.centroidX || 0;
	var centroidY = ctx.centroidY || 0;

	// Get print preview boundary from the screen canvas
	var boundary = null;
	try {
		boundary = getPrintBoundary(canvas);
	} catch (e) { /* ignore */ }

	// Fall back to computing bounds from hole extents
	var minX, maxX, minY, maxY;
	if (boundary) {
		var inner = {
			x: boundary.innerX !== undefined ? boundary.innerX : boundary.x + boundary.width * boundary.marginPercent,
			y: boundary.innerY !== undefined ? boundary.innerY : boundary.y + boundary.height * boundary.marginPercent,
			width: boundary.innerWidth !== undefined ? boundary.innerWidth : boundary.width * (1 - 2 * boundary.marginPercent),
			height: boundary.innerHeight !== undefined ? boundary.innerHeight : boundary.height * (1 - 2 * boundary.marginPercent)
		};
		var wx1 = (inner.x - canvas.width / 2) / scale + centroidX;
		var wy1 = -(inner.y + inner.height - canvas.height / 2) / scale + centroidY;
		var wx2 = (inner.x + inner.width - canvas.width / 2) / scale + centroidX;
		var wy2 = -(inner.y - canvas.height / 2) / scale + centroidY;
		minX = Math.min(wx1, wx2); maxX = Math.max(wx1, wx2);
		minY = Math.min(wy1, wy2); maxY = Math.max(wy1, wy2);
	} else {
		// Compute from hole extents with padding
		minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
		for (var i = 0; i < visibleHoles.length; i++) {
			var hole = visibleHoles[i];
			if (hole.startXLocation < minX) minX = hole.startXLocation;
			if (hole.startXLocation > maxX) maxX = hole.startXLocation;
			if (hole.startYLocation < minY) minY = hole.startYLocation;
			if (hole.startYLocation > maxY) maxY = hole.startYLocation;
		}
		var pad = Math.max(maxX - minX, maxY - minY) * 0.05;
		minX -= pad; maxX += pad; minY -= pad; maxY += pad;
	}

	var dataW = maxX - minX;
	var dataH = maxY - minY;
	if (dataW <= 0 || dataH <= 0) return 0;

	// Fit data into cell with aspect ratio preservation
	var scaleX = w / dataW;
	var scaleY = h / dataH;
	var printScale = Math.min(scaleX, scaleY);
	var scaledW = dataW * printScale;
	var scaledH = dataH * printScale;
	var offsetX = x + (w - scaledW) / 2;
	var offsetY = y + (h - scaledH) / 2;
	var dataCenterX = minX + dataW / 2;
	var dataCenterY = minY + dataH / 2;

	function worldToPDF(wx, wy) {
		var cx = offsetX + scaledW / 2;
		var cy = offsetY + scaledH / 2;
		return [
			(wx - dataCenterX) * printScale + cx,
			-(wy - dataCenterY) * printScale + cy
		];
	}

	// Clip region
	var clipRect = { x: x, y: y, width: w, height: h };

	function isInside(px, py) {
		return px >= x && px <= x + w && py >= y && py <= y + h;
	}

	function clipLine(x1, y1, x2, y2) {
		// Cohen-Sutherland clipping
		var INSIDE = 0, LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;
		var xmin = clipRect.x, ymin = clipRect.y;
		var xmax = clipRect.x + clipRect.width, ymax = clipRect.y + clipRect.height;
		function code(px, py) {
			var c = INSIDE;
			if (px < xmin) c |= LEFT; else if (px > xmax) c |= RIGHT;
			if (py < ymin) c |= TOP; else if (py > ymax) c |= BOTTOM;
			return c;
		}
		var c1 = code(x1, y1), c2 = code(x2, y2);
		while (true) {
			if (!(c1 | c2)) return { x1: x1, y1: y1, x2: x2, y2: y2 };
			if (c1 & c2) return null;
			var cx, cy, co = c1 ? c1 : c2;
			if (co & TOP) { cx = x1 + (x2 - x1) * (ymin - y1) / (y2 - y1); cy = ymin; }
			else if (co & BOTTOM) { cx = x1 + (x2 - x1) * (ymax - y1) / (y2 - y1); cy = ymax; }
			else if (co & RIGHT) { cy = y1 + (y2 - y1) * (xmax - x1) / (x2 - x1); cx = xmax; }
			else { cy = y1 + (y2 - y1) * (xmin - x1) / (x2 - x1); cx = xmin; }
			if (co === c1) { x1 = cx; y1 = cy; c1 = code(x1, y1); }
			else { x2 = cx; y2 = cy; c2 = code(x2, y2); }
		}
	}

	// Get display options
	var displayOptions = ctx.getDisplayOptions ? ctx.getDisplayOptions() : {};

	// Build hole map for connector lookups
	var holeMap = new Map();
	for (var hi = 0; hi < visibleHoles.length; hi++) {
		var h2 = visibleHoles[hi];
		holeMap.set((h2.entityName || "") + ":::" + (h2.holeID || ""), h2);
	}

	// Draw connectors first (below holes)
	if (displayOptions.connector) {
		for (var ci = 0; ci < visibleHoles.length; ci++) {
			var ch = visibleHoles[ci];
			if (!ch.fromHoleID) continue;
			var parts = ch.fromHoleID.split(":::");
			if (parts.length !== 2) continue;
			var fromHole = holeMap.get(parts[0] + ":::" + parts[1]);
			if (!fromHole) continue;

			var cStart = worldToPDF(fromHole.startXLocation, fromHole.startYLocation);
			var cEnd = worldToPDF(ch.startXLocation, ch.startYLocation);
			var connColor = ch.colorHexDecimal || "#888888";
			var rgb = hexToRgbArray(connColor);

			doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
			doc.setFillColor(rgb[0], rgb[1], rgb[2]);

			// Arrow size
			var arrowLen = 1.2;
			var curve = ch.connectorCurve || 0;

			if (curve === 0) {
				var cl = clipLine(cStart[0], cStart[1], cEnd[0], cEnd[1]);
				if (cl) {
					doc.setLineWidth(0.15);
					doc.line(cl.x1, cl.y1, cl.x2, cl.y2);
				}
			} else {
				// Bezier curve segments
				var cmx = (cStart[0] + cEnd[0]) / 2;
				var cmy = (cStart[1] + cEnd[1]) / 2;
				var cdx = cEnd[0] - cStart[0];
				var cdy = cEnd[1] - cStart[1];
				var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
				if (cdist > 0) {
					var cf = (curve / 90) * cdist * 0.5;
					var cpx = cmx + (-cdy / cdist) * cf;
					var cpy = cmy + (cdx / cdist) * cf;
					doc.setLineWidth(0.15);
					var prevCX = cStart[0], prevCY = cStart[1];
					for (var cs = 1; cs <= 16; cs++) {
						var ct = cs / 16;
						var cnx = (1 - ct) * (1 - ct) * cStart[0] + 2 * (1 - ct) * ct * cpx + ct * ct * cEnd[0];
						var cny = (1 - ct) * (1 - ct) * cStart[1] + 2 * (1 - ct) * ct * cpy + ct * ct * cEnd[1];
						var csl = clipLine(prevCX, prevCY, cnx, cny);
						if (csl) doc.line(csl.x1, csl.y1, csl.x2, csl.y2);
						prevCX = cnx; prevCY = cny;
					}
				}
			}

			// Arrowhead
			if (isInside(cEnd[0], cEnd[1])) {
				var aAngle = Math.atan2(cEnd[1] - cStart[1], cEnd[0] - cStart[0]);
				if (curve !== 0) {
					// Use tangent at endpoint for curved connectors
					var cmx2 = (cStart[0] + cEnd[0]) / 2;
					var cmy2 = (cStart[1] + cEnd[1]) / 2;
					var cdx2 = cEnd[0] - cStart[0];
					var cdy2 = cEnd[1] - cStart[1];
					var cdist2 = Math.sqrt(cdx2 * cdx2 + cdy2 * cdy2);
					if (cdist2 > 0) {
						var cf2 = (curve / 90) * cdist2 * 0.5;
						var cpx2 = cmx2 + (-cdy2 / cdist2) * cf2;
						var cpy2 = cmy2 + (cdx2 / cdist2) * cf2;
						aAngle = Math.atan2(2 * (cEnd[1] - cpy2), 2 * (cEnd[0] - cpx2));
					}
				}
				var ax1 = cEnd[0] - arrowLen * Math.cos(aAngle - Math.PI / 6);
				var ay1 = cEnd[1] - arrowLen * Math.sin(aAngle - Math.PI / 6);
				var ax2 = cEnd[0] - arrowLen * Math.cos(aAngle + Math.PI / 6);
				var ay2 = cEnd[1] - arrowLen * Math.sin(aAngle + Math.PI / 6);
				doc.triangle(cEnd[0], cEnd[1], ax1, ay1, ax2, ay2, "F");
			}

			// Delay text
			if (ch.timingDelayMilliseconds != null && displayOptions.delayValue) {
				var dMid = [(cStart[0] + cEnd[0]) / 2, (cStart[1] + cEnd[1]) / 2];
				if (isInside(dMid[0], dMid[1])) {
					doc.setTextColor(rgb[0], rgb[1], rgb[2]);
					doc.setFontSize(4);
					doc.setFont("helvetica", "bold");
					doc.text(String(ch.timingDelayMilliseconds), dMid[0], dMid[1] - 0.5, { align: "center" });
				}
			}
		}
	}

	// Draw holes — collar-to-toe tracks, toe circles, collar dots
	var holeScale = parseFloat(document.getElementById("holeSize")?.value || 3);
	var toeSize = parseFloat(document.getElementById("toeSlider")?.value || 3);

	for (var vi = 0; vi < visibleHoles.length; vi++) {
		var vh = visibleHoles[vi];
		var collar = worldToPDF(vh.startXLocation, vh.startYLocation);
		var grade = worldToPDF(vh.gradeXLocation, vh.gradeYLocation);
		var toe = worldToPDF(vh.endXLocation, vh.endYLocation);
		var collarIn = isInside(collar[0], collar[1]);

		// Collar-to-toe track
		if (vh.holeAngle > 0) {
			doc.setLineWidth(0.1);
			if (vh.subdrillAmount < 0) {
				var t1 = clipLine(collar[0], collar[1], toe[0], toe[1]);
				if (t1) { doc.setDrawColor(0, 0, 0); doc.line(t1.x1, t1.y1, t1.x2, t1.y2); }
				var t2 = clipLine(toe[0], toe[1], grade[0], grade[1]);
				if (t2) { doc.setDrawColor(255, 200, 200); doc.line(t2.x1, t2.y1, t2.x2, t2.y2); }
			} else {
				var t3 = clipLine(collar[0], collar[1], grade[0], grade[1]);
				if (t3) { doc.setDrawColor(0, 0, 0); doc.line(t3.x1, t3.y1, t3.x2, t3.y2); }
				var t4 = clipLine(grade[0], grade[1], toe[0], toe[1]);
				if (t4) { doc.setDrawColor(255, 0, 0); doc.line(t4.x1, t4.y1, t4.x2, t4.y2); }
			}
		}

		// Toe circle
		if (parseFloat(vh.holeLengthCalculated || 0).toFixed(1) !== "0.0") {
			var toeR = toeSize * printScale;
			if (toeR > 0.2 && isInside(toe[0], toe[1])) {
				doc.setDrawColor(0, 0, 0);
				doc.setLineWidth(0.1);
				doc.circle(toe[0], toe[1], Math.min(toeR, 3), "S");
			}
		}

		// Collar dot
		if (collarIn) {
			var collarR = (vh.holeDiameter / 1000 / 2) * holeScale * printScale * 0.14;
			collarR = Math.max(collarR, 0.4);
			collarR = Math.min(collarR, 2);
			doc.setFillColor(0, 0, 0);
			doc.circle(collar[0], collar[1], collarR, "F");
		}
	}

	// Draw labels (separate pass — on top of geometry)
	var fontSize = fontPt > 0 ? fontPt * 0.353 : 3.5; // pt to mm (1pt ≈ 0.353mm)
	var labelSpacing = fontSize * 0.45;

	for (var li = 0; li < visibleHoles.length; li++) {
		var lh = visibleHoles[li];
		var lCollar = worldToPDF(lh.startXLocation, lh.startYLocation);
		if (!isInside(lCollar[0], lCollar[1])) continue;

		var collarR2 = (lh.holeDiameter / 1000 / 2) * holeScale * printScale * 0.14;
		collarR2 = Math.max(collarR2, 0.4);
		var textOff = collarR2 * 2.5;

		doc.setFontSize(fontSize);
		doc.setFont("helvetica", "normal");

		// Right side labels
		var rx = lCollar[0] + textOff;
		var ry = lCollar[1] - textOff;

		if (displayOptions.holeID) {
			doc.setTextColor(0, 0, 0);
			doc.text(lh.holeID || "", rx, ry);
			ry += labelSpacing;
		}
		if (displayOptions.holeLen) {
			doc.setTextColor(0, 0, 67);
			doc.text(parseFloat(lh.holeLengthCalculated || 0).toFixed(1), rx, ry);
			ry += labelSpacing;
		}
		if (displayOptions.holeDia) {
			doc.setTextColor(0, 50, 0);
			doc.text(parseFloat(lh.holeDiameter || 0).toFixed(0), rx, ry);
			ry += labelSpacing;
		}
		if (displayOptions.holeType) {
			doc.setTextColor(53, 0, 72);
			doc.text(lh.holeType || "", rx, ry);
			ry += labelSpacing;
		}

		// Left side labels
		var lx = lCollar[0] - textOff;
		var ly = lCollar[1] - textOff;

		if (displayOptions.holeAng) {
			doc.setTextColor(67, 30, 0);
			doc.text(parseFloat(lh.holeAngle || 0).toFixed(0) + "deg", lx, ly, { align: "right" });
			ly += labelSpacing;
		}
		if (displayOptions.initiationTime) {
			var ft = lh.timingDelayMilliseconds;
			if (ft != null) {
				doc.setTextColor(255, 0, 0);
				doc.text(String(ft), lx, ly, { align: "right" });
				ly += labelSpacing;
			}
		}
	}

	return printScale; // mm per world-unit
}

/**
 * Convert hex color to RGB array [r, g, b].
 */
function hexToRgbArray(hex) {
	hex = (hex || "#000000").replace("#", "");
	if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	var num = parseInt(hex, 16);
	return isNaN(num) ? [0, 0, 0] : [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF];
}

/**
 * Show the formula reference dialog.
 */
// ── LocalStorage persistence for template dialog preferences ──

var TEMPLATE_PREFS_KEY = "kirra_templatePrintPrefs";

/**
 * Load saved preferences from localStorage.
 * @returns {Object} { lastTemplate, blastName, designer, outputFormat }
 */
function loadTemplatePrefs() {
	try {
		var raw = localStorage.getItem(TEMPLATE_PREFS_KEY);
		if (raw) return JSON.parse(raw);
	} catch (e) { /* ignore */ }
	return {};
}

/**
 * Save preferences to localStorage.
 * @param {Object} prefs
 */
function saveTemplatePrefs(prefs) {
	try {
		var existing = loadTemplatePrefs();
		for (var key in prefs) {
			if (prefs.hasOwnProperty(key)) existing[key] = prefs[key];
		}
		localStorage.setItem(TEMPLATE_PREFS_KEY, JSON.stringify(existing));
	} catch (e) { /* ignore */ }
}

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
