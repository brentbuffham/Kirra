/**
 * @fileoverview XLSX Template Engine for Kirra print templates.
 *
 * Workflow:
 *   1. User imports an .xlsx template file
 *   2. Engine reads cells, merged regions, styles, images, sheet config
 *   3. Cells with "fx:" prefix are evaluated against blast data
 *   4. Output: populated XLSX download, or rendered to jsPDF
 *
 * Template conventions:
 *   - Each sheet = one print page (multi-page templates use multiple sheets)
 *   - Sheet name encodes paper config: "A3-Landscape", "A4-Portrait", etc.
 *     Falls back to default if not parseable.
 *   - Cells starting with "fx:" are formula cells
 *   - Merged cell regions define the bounding box for render tokens (images/graphics)
 *   - Embedded images in XLSX are preserved and re-embedded in output
 *
 * Google Sheets compatible:
 *   - Uses only standard XLSX features (no macros, no VBA)
 *   - "fx:" prefix won't trigger Google Sheets formula parsing
 *   - Merged cells, conditional formatting, images all supported
 */

import ExcelJS from "exceljs";
import { isTemplateFormula, evaluateAllCells } from "./TemplateFormulaEvaluator.js";
import { buildTemplateContext } from "./TemplateVariables.js";

// Bundled reference template XLSX (Vite resolves this to a URL at build time)
import referenceTemplateUrl from "../../referenceFiles/XLSX/KirraCustomPrintTemplate.xlsx?url";

// ── Cell-ref helpers (replaces XLSX.utils) ──────────────────────────────

/**
 * Encode a {r, c} (0-indexed) to a cell reference like "A1".
 */
function encodeCell(pos) {
	var col = "";
	var c = pos.c;
	while (c >= 0) {
		col = String.fromCharCode((c % 26) + 65) + col;
		c = Math.floor(c / 26) - 1;
	}
	return col + (pos.r + 1);
}

/**
 * Decode a cell reference like "A1" to {r, c} (0-indexed).
 */
function decodeCell(ref) {
	var match = ref.match(/^([A-Z]+)(\d+)$/);
	if (!match) return { r: 0, c: 0 };
	var col = 0;
	for (var i = 0; i < match[1].length; i++) {
		col = col * 26 + (match[1].charCodeAt(i) - 64);
	}
	return { r: parseInt(match[2], 10) - 1, c: col - 1 };
}

/**
 * Decode a range string like "A1:Z10" to {s: {r,c}, e: {r,c}} (0-indexed).
 */
function decodeRange(rangeStr) {
	var parts = rangeStr.split(":");
	var s = decodeCell(parts[0]);
	var e = parts.length > 1 ? decodeCell(parts[1]) : { r: s.r, c: s.c };
	return { s: s, e: e };
}

// ── Paper size lookup ─────────────────────────────────────────────────

var PAPER_SIZES_MM = {
	A4: { width: 210, height: 297 },
	A3: { width: 297, height: 420 },
	A2: { width: 420, height: 594 },
	A1: { width: 594, height: 841 },
	A0: { width: 841, height: 1189 },
	Letter: { width: 216, height: 279 },
	Legal: { width: 216, height: 356 },
	Tabloid: { width: 279, height: 432 }
};

// ExcelJS paperSize numbers -> paper name
var EXCEL_PAPER_SIZE_MAP = {
	1: "Letter", 5: "Legal", 8: "A3", 9: "A4", 11: "A5",
	17: "Tabloid", 12: "B4", 13: "B5"
};

/**
 * Parse sheet config from ExcelJS worksheet pageSetup and sheet name.
 * Prefers actual XLSX pageSetup properties over sheet name parsing.
 *
 * @param {string} sheetName
 * @param {Object} [worksheet] - ExcelJS worksheet (optional, for reading pageSetup)
 * @returns {{ paperSize: string, orientation: string, widthMm: number, heightMm: number,
 *             margins: { left: number, right: number, top: number, bottom: number },
 *             scale: number, fitToPage: boolean, horizontalCentered: boolean, verticalCentered: boolean }}
 */
export function parseSheetConfig(sheetName, worksheet) {
	var name = (sheetName || "").trim().toUpperCase();

	// Defaults
	var paperSize = "A3";
	var orientation = "landscape";
	// Default margins in mm (converted from XLSX inches: 0.25" sides, 0.75" top/bottom)
	var margins = { left: 6.35, right: 6.35, top: 19.05, bottom: 19.05 };
	var scale = 100;
	var fitToPage = false;
	var horizontalCentered = false;
	var verticalCentered = false;

	// ── 1. Try reading actual XLSX pageSetup from the worksheet ──
	var hasPageSetup = false;
	if (worksheet && worksheet.pageSetup) {
		var ps = worksheet.pageSetup;

		// Paper size from XLSX numeric code
		if (ps.paperSize && EXCEL_PAPER_SIZE_MAP[ps.paperSize]) {
			paperSize = EXCEL_PAPER_SIZE_MAP[ps.paperSize];
			hasPageSetup = true;
		}

		// Orientation
		if (ps.orientation) {
			orientation = ps.orientation === "portrait" ? "portrait" : "landscape";
			hasPageSetup = true;
		}

		// Scale (percentage)
		if (ps.scale && ps.scale !== 100) {
			scale = ps.scale;
		}

		// Fit to page
		if (ps.fitToPage || ps.fitToWidth || ps.fitToHeight) {
			fitToPage = true;
		}

		// Centering
		if (ps.horizontalCentered) horizontalCentered = true;
		if (ps.verticalCentered) verticalCentered = true;

		// Margins (ExcelJS stores in inches, convert to mm: 1 inch = 25.4mm)
		if (ps.margins) {
			if (ps.margins.left != null) margins.left = ps.margins.left * 25.4;
			if (ps.margins.right != null) margins.right = ps.margins.right * 25.4;
			if (ps.margins.top != null) margins.top = ps.margins.top * 25.4;
			if (ps.margins.bottom != null) margins.bottom = ps.margins.bottom * 25.4;
		}
	}

	// ── 2. Fallback: parse sheet name if no pageSetup found ──
	if (!hasPageSetup) {
		for (var size in PAPER_SIZES_MM) {
			if (name.indexOf(size.toUpperCase()) !== -1) {
				paperSize = size;
				break;
			}
		}
		if (name.indexOf("PORT") !== -1 || name.indexOf("_P") !== -1) {
			orientation = "portrait";
		} else if (name.indexOf("LAND") !== -1 || name.indexOf("_L") !== -1) {
			orientation = "landscape";
		}
	}

	var dims = PAPER_SIZES_MM[paperSize] || PAPER_SIZES_MM.A3;
	var widthMm, heightMm;
	if (orientation === "landscape") {
		widthMm = Math.max(dims.width, dims.height);
		heightMm = Math.min(dims.width, dims.height);
	} else {
		widthMm = Math.min(dims.width, dims.height);
		heightMm = Math.max(dims.width, dims.height);
	}

	return {
		paperSize: paperSize, orientation: orientation,
		widthMm: widthMm, heightMm: heightMm,
		margins: margins, scale: scale, fitToPage: fitToPage,
		horizontalCentered: horizontalCentered, verticalCentered: verticalCentered
	};
}

// ── Template loading ──────────────────────────────────────────────────

/**
 * Load and parse an XLSX template file.
 *
 * @param {File|ArrayBuffer} source - File object or ArrayBuffer of XLSX data
 * @returns {Promise<Object>} Parsed template object
 */
export async function loadTemplate(source) {
	var data;
	if (source instanceof File) {
		data = await source.arrayBuffer();
	} else {
		data = source;
	}

	var workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(data);

	// Build template structure
	var template = {
		workbook: workbook,
		sheets: [],
		images: extractImages(workbook),
		fileName: source instanceof File ? source.name : "template.xlsx"
	};

	workbook.eachSheet(function (ws, sheetId) {
		var sheetName = ws.name;
		var config = parseSheetConfig(sheetName, ws);

		// Extract merges (ExcelJS stores as array of range strings like "A1:C3")
		var merges = [];
		if (ws.model && ws.model.merges) {
			for (var i = 0; i < ws.model.merges.length; i++) {
				merges.push(decodeRange(ws.model.merges[i]));
			}
		}

		// Extract cell data using our helpers (before row/col — we need cell refs to find used range)
		var cellData = extractCellValues(ws);

		// Determine actual used range from cell values and merges only
		var usedMaxRow = 0;
		var usedMaxCol = 0;
		for (var cellRef in cellData.cells) {
			if (cellData.cells.hasOwnProperty(cellRef)) {
				var pos = decodeCell(cellRef);
				if (pos.r + 1 > usedMaxRow) usedMaxRow = pos.r + 1;
				if (pos.c + 1 > usedMaxCol) usedMaxCol = pos.c + 1;
			}
		}
		// NOTE: styles intentionally excluded from used-range — ExcelJS reports
		// styles for ALL cells up to ws.rowCount/columnCount, which inflates the
		// used range back to the full sheet dimensions (e.g. 62 rows instead of 33).
		// Only cell VALUES and MERGES determine the actual content extent.

		// Also check merges for extent
		if (ws.model && ws.model.merges) {
			for (var mi = 0; mi < ws.model.merges.length; mi++) {
				var mRange = decodeRange(ws.model.merges[mi]);
				if (mRange.e.r + 1 > usedMaxRow) usedMaxRow = mRange.e.r + 1;
				if (mRange.e.c + 1 > usedMaxCol) usedMaxCol = mRange.e.c + 1;
			}
		}

		// Extract column widths (only used columns)
		var cols = [];
		var numCols = Math.max(usedMaxCol, 1);
		for (var c = 0; c < numCols; c++) {
			var colWidth = 10; // default
			try {
				var wsCol = ws.getColumn(c + 1);
				if (wsCol && wsCol.width != null) {
					colWidth = wsCol.width;
				}
			} catch (e) { /* use default */ }
			cols.push({ wch: colWidth });
		}

		// Extract row heights (only used rows)
		var rows = [];
		var numRows = Math.max(usedMaxRow, 1);
		for (var r = 1; r <= numRows; r++) {
			var row = ws.getRow(r);
			rows.push({ hpt: row.height || 20 });
		}

		// Extract embedded image positions
		var sheetImages = [];
		try {
			var wsImages = ws.getImages();
			for (var imgIdx = 0; imgIdx < wsImages.length; imgIdx++) {
				var img = wsImages[imgIdx];
				var imgModel = img.model || img;
				var tl = imgModel.range ? imgModel.range.tl : null;
				if (tl && imgModel.imageId !== undefined) {
					var br = imgModel.range.br || null;
					sheetImages.push({
						imageId: imgModel.imageId,
						tl: { col: tl.nativeCol || 0, colOff: tl.nativeColOff || 0, row: tl.nativeRow || 0, rowOff: tl.nativeRowOff || 0 },
						br: br ? { col: br.nativeCol || 0, colOff: br.nativeColOff || 0, row: br.nativeRow || 0, rowOff: br.nativeRowOff || 0 } : null,
						ext: imgModel.range.ext || null
					});
				}
			}
		} catch (imgErr) {
			console.warn("[TemplateEngine] Could not extract images from sheet '" + sheetName + "':", imgErr);
		}

		template.sheets.push({
			name: sheetName,
			worksheet: ws,
			config: config,
			merges: merges,
			cols: cols,
			rows: rows,
			cells: cellData.cells,
			formulaCells: cellData.formulaCells,
			cellStyles: cellData.cellStyles,
			images: sheetImages
		});
	});

	return template;
}

/**
 * Extract all cell values and formula cells from an ExcelJS worksheet.
 * @param {Object} ws - ExcelJS worksheet
 * @returns {{ cells: Object, formulaCells: string[], cellStyles: Object }}
 */
function extractCellValues(ws) {
	var cells = {};
	var formulaCells = [];
	var cellStyles = {};

	ws.eachRow({ includeEmpty: true }, function (row, rowNumber) {
		row.eachCell({ includeEmpty: true }, function (cell, colNumber) {
			var ref = encodeCell({ r: rowNumber - 1, c: colNumber - 1 });
			var val = getCellStringValue(cell);
			if (val) cells[ref] = val;

			// Store style for PDF rendering (including empty cells — borders, fills)
			if (cell.style && (cell.style.font || cell.style.border || cell.style.fill || cell.style.alignment)) {
				cellStyles[ref] = convertExcelJSStyle(cell.style);
			}

			if (val && isTemplateFormula(val)) {
				formulaCells.push(ref);
			}
		});
	});

	console.log("[TemplateEngine] Extracted " + Object.keys(cells).length + " cells, " +
		formulaCells.length + " formulas: " + formulaCells.map(function (r) { return r + "=" + cells[r]; }).join(", "));

	return { cells: cells, formulaCells: formulaCells, cellStyles: cellStyles };
}

/**
 * Get the string value of an ExcelJS cell.
 * Handles rich text, formulas, and plain values.
 */
function getCellStringValue(cell) {
	if (cell.value === null || cell.value === undefined) return "";
	// Rich text object
	if (typeof cell.value === "object" && cell.value.richText) {
		return cell.value.richText.map(function (part) { return part.text || ""; }).join("");
	}
	// Formula result
	if (typeof cell.value === "object" && cell.value.formula) {
		var result = cell.value.result;
		return result !== undefined && result !== null ? String(result) : "";
	}
	// Date
	if (cell.value instanceof Date) {
		return cell.value.toLocaleDateString("en-AU");
	}
	return String(cell.value);
}

/**
 * Convert ExcelJS style to a simpler format matching the old SheetJS style structure.
 * Used by PDF rendering.
 */
function convertExcelJSStyle(style) {
	var result = {};

	if (style.font) {
		result.font = {};
		if (style.font.size) result.font.sz = style.font.size;
		if (style.font.bold) result.font.bold = true;
		if (style.font.italic) result.font.italic = true;
		if (style.font.color) {
			result.font.color = {};
			if (style.font.color.argb) {
				result.font.color.rgb = style.font.color.argb;
			} else if (style.font.color.theme !== undefined) {
				// Theme colors - default to black
				result.font.color.rgb = "000000";
			}
		}
	}

	if (style.alignment) {
		result.alignment = {};
		if (style.alignment.horizontal) result.alignment.horizontal = style.alignment.horizontal;
		if (style.alignment.vertical) result.alignment.vertical = style.alignment.vertical;
	}

	// Extract border info
	if (style.border) {
		result.border = {};
		var sides = ["top", "bottom", "left", "right"];
		for (var bi = 0; bi < sides.length; bi++) {
			var side = sides[bi];
			var b = style.border[side];
			if (b && b.style && b.style !== "none") {
				// Resolve color: argb > indexed > theme > default black
				var bColor = "000000";
				if (b.color) {
					if (b.color.argb) {
						bColor = b.color.argb;
					}
					// indexed colors and theme colors default to black (already set)
				}
				result.border[side] = { style: b.style, color: bColor };
			}
		}
		if (Object.keys(result.border).length === 0) delete result.border;
	}

	if (style.fill && style.fill.fgColor) {
		result.fill = { fgColor: {} };
		if (style.fill.fgColor.argb) {
			result.fill.fgColor.rgb = style.fill.fgColor.argb;
		}
	}

	return result;
}

/**
 * Extract embedded images from workbook.
 * @param {Object} workbook - ExcelJS workbook
 * @returns {Object[]} Array of { name, data, type }
 */
function extractImages(workbook) {
	var images = [];

	if (workbook.model && workbook.model.media) {
		for (var i = 0; i < workbook.model.media.length; i++) {
			var media = workbook.model.media[i];
			images.push({
				name: media.name || "image_" + i,
				data: media.buffer,
				type: media.type === "png" ? "image/png" : "image/" + (media.extension || media.type || "png"),
				path: ""
			});
		}
	}

	return images;
}

// ── Template evaluation ───────────────────────────────────────────────

/**
 * Evaluate all formula cells in a template.
 *
 * @param {Object} template - Parsed template from loadTemplate()
 * @param {Object} [options] - Options passed to buildTemplateContext()
 * @returns {Object} Evaluated template with results per sheet
 */
export function evaluateTemplate(template, options) {
	var context = buildTemplateContext(options);

	console.log("[TemplateEngine] Evaluating template with " + context.visibleHoles.length + " visible holes, " +
		Object.keys(context.scalarVars).length + " scalar vars");
	console.log("[TemplateEngine] Scalar vars:", JSON.stringify(context.scalarVars, null, 2));

	var result = {
		sheets: [],
		context: context
	};

	for (var i = 0; i < template.sheets.length; i++) {
		var sheet = template.sheets[i];
		var evaluated = evaluateAllCells(sheet.cells, context);

		// Separate render cells from text cells
		var textCells = {};
		var renderCells = {};

		for (var ref in evaluated) {
			if (evaluated.hasOwnProperty(ref)) {
				var cell = evaluated[ref];
				if (cell.type === "render") {
					renderCells[ref] = cell.value;
				} else {
					textCells[ref] = cell.value;
				}
			}
		}

		console.log("[TemplateEngine] Sheet '" + sheet.name + "': " +
			Object.keys(textCells).length + " text cells, " +
			Object.keys(renderCells).length + " render cells");
		// Log evaluated formula results
		for (var eRef in textCells) {
			if (textCells.hasOwnProperty(eRef) && sheet.formulaCells && sheet.formulaCells.indexOf(eRef) !== -1) {
				console.log("[TemplateEngine]   " + eRef + ": " + sheet.cells[eRef] + " → " + JSON.stringify(textCells[eRef]));
			}
		}
		for (var rRef2 in renderCells) {
			if (renderCells.hasOwnProperty(rRef2)) {
				console.log("[TemplateEngine]   " + rRef2 + ": → [render:" + renderCells[rRef2].renderType + "]");
			}
		}

		result.sheets.push({
			name: sheet.name,
			config: sheet.config,
			textCells: textCells,
			renderCells: renderCells,
			merges: sheet.merges,
			cols: sheet.cols,
			rows: sheet.rows,
			cellStyles: sheet.cellStyles,
			worksheet: sheet.worksheet
		});
	}

	return result;
}

// ── XLSX output ───────────────────────────────────────────────────────

/**
 * Generate a populated XLSX file from an evaluated template.
 * Preserves original formatting, merges, and styles.
 *
 * @param {Object} template - Original parsed template
 * @param {Object} evaluated - Result from evaluateTemplate()
 * @returns {Promise<Blob>} XLSX file as Blob
 */
export async function exportAsXLSX(template, evaluated) {
	var wb = template.workbook;

	// Update cell values with evaluated results
	for (var i = 0; i < evaluated.sheets.length; i++) {
		var sheet = evaluated.sheets[i];
		var ws = wb.getWorksheet(sheet.name);
		if (!ws) continue;

		// Update text cells
		for (var ref in sheet.textCells) {
			if (sheet.textCells.hasOwnProperty(ref)) {
				var val = sheet.textCells[ref];
				var pos = decodeCell(ref);
				var cell = ws.getCell(pos.r + 1, pos.c + 1);
				cell.value = val;
			}
		}

		// Render cells get placeholder text
		for (var rRef in sheet.renderCells) {
			if (sheet.renderCells.hasOwnProperty(rRef)) {
				var render = sheet.renderCells[rRef];
				var rPos = decodeCell(rRef);
				var rCell = ws.getCell(rPos.r + 1, rPos.c + 1);
				rCell.value = "[" + render.renderType + "]";
			}
		}
	}

	// Generate XLSX buffer
	var buf = await wb.xlsx.writeBuffer();
	return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/**
 * Trigger download of a Blob as a file.
 * @param {Blob} blob
 * @param {string} fileName
 */
export function downloadBlob(blob, fileName) {
	var url = URL.createObjectURL(blob);
	var a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

// ── PDF output ────────────────────────────────────────────────────────

/**
 * Render an evaluated template to PDF using jsPDF.
 *
 * @param {Object} template - Original parsed template
 * @param {Object} evaluated - Result from evaluateTemplate()
 * @param {Object} jsPDFInstance - jsPDF instance (caller creates with correct page size)
 * @param {Object} [renderCallbacks] - Callbacks for rendering special tokens
 *   { legend: fn(jsPDF, x, y, w, h, args), northArrow: fn(...), ... }
 * @returns {Object} jsPDF instance with pages rendered
 */
export function renderToPDF(template, evaluated, jsPDFInstance, renderCallbacks) {
	var doc = jsPDFInstance;
	renderCallbacks = renderCallbacks || {};

	for (var i = 0; i < evaluated.sheets.length; i++) {
		if (i > 0) {
			var cfg = evaluated.sheets[i].config;
			doc.addPage([cfg.widthMm, cfg.heightMm], cfg.orientation === "landscape" ? "l" : "p");
		}

		var sheet = evaluated.sheets[i];

		// Find matching template sheet by name (not index) since evaluated.sheets may be filtered
		var matchedTemplate = null;
		for (var t = 0; t < template.sheets.length; t++) {
			if (template.sheets[t].name === sheet.name) {
				matchedTemplate = template.sheets[t];
				break;
			}
		}
		if (!matchedTemplate) matchedTemplate = template.sheets[i] || template.sheets[0];

		renderSheetToPDF(doc, sheet, matchedTemplate, renderCallbacks, template.images);
	}

	return doc;
}

/**
 * Render a single sheet to a PDF page.
 * Maps XLSX cell layout to PDF coordinates.
 *
 * @param {Object} doc - jsPDF instance
 * @param {Object} evalSheet - Evaluated sheet data
 * @param {Object} templateSheet - Original template sheet data
 * @param {Object} renderCallbacks - Render callbacks for special tokens
 */
function renderSheetToPDF(doc, evalSheet, templateSheet, renderCallbacks, templateImages) {
	var config = evalSheet.config;

	// Use XLSX page margins if available, otherwise default 2%
	var margins = config.margins || { left: config.widthMm * 0.02, right: config.widthMm * 0.02, top: config.heightMm * 0.02, bottom: config.heightMm * 0.02 };
	var marginX = margins.left;
	var marginY = margins.top;

	// Calculate column widths and row heights in mm
	var colWidths = calculateColumnWidthsMm(templateSheet, config.widthMm, margins);
	var rowHeights = calculateRowHeightsMm(templateSheet, config.heightMm, margins);

	// Calculate cumulative positions, starting from the page margin so content is centered
	var colX = [marginX];
	for (var c = 0; c < colWidths.length; c++) {
		colX.push(colX[c] + colWidths[c]);
	}
	var rowY = [marginY];
	for (var r = 0; r < rowHeights.length; r++) {
		rowY.push(rowY[r] + rowHeights[r]);
	}

	// Build merge map: for each cell, find its merged region bounds
	var mergeMap = buildMergeMap(evalSheet.merges);

	// Draw cell borders and backgrounds
	drawCellBorders(doc, evalSheet, colX, rowY, evalSheet.merges);

	// Track which merged origins have been rendered (skip duplicates from ExcelJS filling merged cells)
	var renderedMergeOrigins = {};

	// Draw text cells
	for (var ref in evalSheet.textCells) {
		if (!evalSheet.textCells.hasOwnProperty(ref)) continue;

		var val = evalSheet.textCells[ref];
		if (!val || val === "") continue;

		// Skip non-origin cells in merged regions
		var merge = mergeMap[ref];
		if (merge) {
			var originRef = encodeCell({ r: merge.s.r, c: merge.s.c });
			if (ref !== originRef) continue; // Not the origin — skip
			if (renderedMergeOrigins[originRef]) continue; // Already rendered
			renderedMergeOrigins[originRef] = true;
		}

		// Get cell bounds (accounting for merges)
		var bounds = getCellBounds(ref, colX, rowY, mergeMap);
		if (!bounds) continue;

		// Get cell style from stored styles
		var cellStyle = evalSheet.cellStyles ? evalSheet.cellStyles[ref] : null;

		// Draw text
		drawCellText(doc, val, bounds, cellStyle);
	}

	// Draw render cells (graphics)
	var renderedRenderOrigins = {};
	for (var rRef in evalSheet.renderCells) {
		if (!evalSheet.renderCells.hasOwnProperty(rRef)) continue;

		// Skip non-origin cells in merged regions
		var rMerge = mergeMap[rRef];
		if (rMerge) {
			var rOriginRef = encodeCell({ r: rMerge.s.r, c: rMerge.s.c });
			if (rRef !== rOriginRef) continue;
			if (renderedRenderOrigins[rOriginRef]) continue;
			renderedRenderOrigins[rOriginRef] = true;
		}

		var render = evalSheet.renderCells[rRef];
		var rBounds = getCellBounds(rRef, colX, rowY, mergeMap);
		if (!rBounds) continue;

		var callback = renderCallbacks[render.renderType];
		if (callback) {
			callback(doc, rBounds.x, rBounds.y, rBounds.width, rBounds.height, render.args);
		}
	}

	// Draw embedded XLSX images
	drawEmbeddedImages(doc, templateSheet, templateImages, colX, rowY);
}

/**
 * Draw embedded XLSX images onto the PDF page.
 * Maps image anchors (col/row positions) to PDF mm coordinates.
 *
 * @param {Object} doc - jsPDF instance
 * @param {Object} templateSheet - Template sheet with .images array
 * @param {Object[]} templateImages - Template-level image data array from extractImages()
 * @param {number[]} colX - Cumulative column X positions in mm
 * @param {number[]} rowY - Cumulative row Y positions in mm
 */
function drawEmbeddedImages(doc, templateSheet, templateImages, colX, rowY) {
	if (!templateSheet.images || templateSheet.images.length === 0) return;
	if (!templateImages || templateImages.length === 0) return;

	for (var i = 0; i < templateSheet.images.length; i++) {
		var imgAnchor = templateSheet.images[i];
		var mediaItem = templateImages[imgAnchor.imageId];
		if (!mediaItem || !mediaItem.data) continue;

		// Convert image buffer to data URL
		var dataUrl;
		try {
			var buffer = mediaItem.data;
			var bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer);
			var binary = "";
			for (var b = 0; b < bytes.length; b++) {
				binary += String.fromCharCode(bytes[b]);
			}
			var mimeType = mediaItem.type || "image/png";
			// jsPDF needs format string: PNG, JPEG, etc.
			var format = "PNG";
			if (mimeType.indexOf("jpeg") !== -1 || mimeType.indexOf("jpg") !== -1) format = "JPEG";
			else if (mimeType.indexOf("gif") !== -1) format = "GIF";
			dataUrl = "data:" + mimeType + ";base64," + btoa(binary);
		} catch (e) {
			console.warn("[TemplateEngine] Failed to convert image " + i + " to data URL:", e);
			continue;
		}

		// Calculate position from top-left anchor
		var tl = imgAnchor.tl;
		var x = interpolateAnchor(tl.col, tl.colOff, colX, templateSheet.cols, true);
		var y = interpolateAnchor(tl.row, tl.rowOff, rowY, templateSheet.rows, false);

		// Calculate size from bottom-right anchor or ext
		var w, h;
		if (imgAnchor.br) {
			var br = imgAnchor.br;
			var x2 = interpolateAnchor(br.col, br.colOff, colX, templateSheet.cols, true);
			var y2 = interpolateAnchor(br.row, br.rowOff, rowY, templateSheet.rows, false);
			w = x2 - x;
			h = y2 - y;
		} else if (imgAnchor.ext) {
			// ext is in EMU (English Metric Units): 1 inch = 914400 EMU, 1mm = 36000 EMU
			w = (imgAnchor.ext.width || 0) / 36000;
			h = (imgAnchor.ext.height || 0) / 36000;
		} else {
			// Fallback: span one cell
			var nextCol = Math.min(tl.col + 1, colX.length - 1);
			var nextRow = Math.min(tl.row + 1, rowY.length - 1);
			w = colX[nextCol] - colX[tl.col];
			h = rowY[nextRow] - rowY[tl.row];
		}

		if (w > 0 && h > 0) {
			try {
				doc.addImage(dataUrl, format, x, y, w, h);
			} catch (e) {
				console.warn("[TemplateEngine] Failed to add image " + i + " to PDF:", e);
			}
		}
	}
}

/**
 * Interpolate an anchor position (col/row + offset) to PDF mm coordinate.
 * @param {number} idx - Column or row index (0-based)
 * @param {number} offset - Sub-cell offset in EMU
 * @param {number[]} positions - Cumulative positions array (colX or rowY)
 * @param {Object[]} dimInfo - Column widths or row heights info
 * @param {boolean} isCol - true for columns, false for rows
 * @returns {number} Position in mm
 */
function interpolateAnchor(idx, offset, positions, dimInfo, isCol) {
	// Base position at the start of the cell
	var clampedIdx = Math.min(idx, positions.length - 1);
	var pos = positions[clampedIdx] || 0;

	// Add fractional offset within the cell
	if (offset && clampedIdx < positions.length - 1) {
		var cellSize = positions[clampedIdx + 1] - positions[clampedIdx];
		// Offset is in EMU; full cell width in EMU depends on column/row
		// ExcelJS uses nativeColOff/nativeRowOff in EMU (914400 EMU/inch)
		// Column width EMU ~ charWidth * 640000 (ExcelJS default)
		// Row height EMU ~ ptHeight * 10000 (ExcelJS default)
		var info = dimInfo && dimInfo[idx];
		var fullEmu;
		if (isCol) {
			var charWidth = info && info.wch ? info.wch : 10;
			fullEmu = charWidth * 640000 / 10; // approximate
		} else {
			var ptHeight = info && info.hpt ? info.hpt : 20;
			fullEmu = ptHeight * 10000;
		}
		if (fullEmu > 0) {
			pos += (offset / fullEmu) * cellSize;
		}
	}

	return pos;
}

/**
 * Calculate column widths in mm from column info.
 * @param {Object} sheet - Template sheet
 * @param {number} pageWidthMm - Total page width
 * @param {Object} [margins] - Page margins { left, right } in mm
 * @returns {number[]} Column widths in mm
 */
function calculateColumnWidthsMm(sheet, pageWidthMm, margins) {
	var cols = sheet.cols || [];
	var numCols = cols.length || 1;

	// Default: equal width
	var defaultWidth = pageWidthMm / numCols;
	var widths = [];

	// Column width is in "characters" (~1 unit each)
	// Convert to proportional mm
	var totalChars = 0;
	for (var c = 0; c < numCols; c++) {
		var colInfo = cols[c];
		var charWidth = colInfo && colInfo.wch ? colInfo.wch : 10;
		widths.push(charWidth);
		totalChars += charWidth;
	}

	// Scale to page width using XLSX margins
	var marginLeft = margins ? margins.left : pageWidthMm * 0.02;
	var marginRight = margins ? margins.right : pageWidthMm * 0.02;
	var usableWidth = pageWidthMm - marginLeft - marginRight;
	var result = [];
	for (var c = 0; c < numCols; c++) {
		result.push(totalChars > 0 ? (widths[c] / totalChars) * usableWidth : defaultWidth);
	}

	return result;
}

/**
 * Calculate row heights in mm from row info.
 * @param {Object} sheet - Template sheet
 * @param {number} pageHeightMm - Total page height
 * @param {Object} [margins] - Page margins { top, bottom } in mm
 * @returns {number[]} Row heights in mm
 */
function calculateRowHeightsMm(sheet, pageHeightMm, margins) {
	var rows = sheet.rows || [];
	var numRows = rows.length || 1;

	// Row height is in points (1pt = 0.353mm)
	var heights = [];
	var totalPts = 0;

	for (var r = 0; r < numRows; r++) {
		var rowInfo = rows[r];
		var ptHeight = rowInfo && rowInfo.hpt ? rowInfo.hpt : 20; // default 20pt
		heights.push(ptHeight);
		totalPts += ptHeight;
	}

	// Scale to page height using XLSX margins
	var marginTop = margins ? margins.top : pageHeightMm * 0.02;
	var marginBottom = margins ? margins.bottom : pageHeightMm * 0.02;
	var usableHeight = pageHeightMm - marginTop - marginBottom;
	var result = [];
	for (var r = 0; r < numRows; r++) {
		result.push(totalPts > 0 ? (heights[r] / totalPts) * usableHeight : pageHeightMm / numRows);
	}

	return result;
}

/**
 * Build a lookup map from cell reference to its merged region.
 * @param {Object[]} merges - Array of { s: {r,c}, e: {r,c} }
 * @returns {Object} { "A1": { s: {r,c}, e: {r,c} }, ... }
 */
function buildMergeMap(merges) {
	var map = {};
	for (var i = 0; i < merges.length; i++) {
		var m = merges[i];
		// Map every cell in the merge to the merge region
		for (var r = m.s.r; r <= m.e.r; r++) {
			for (var c = m.s.c; c <= m.e.c; c++) {
				var ref = encodeCell({ r: r, c: c });
				map[ref] = m;
			}
		}
	}
	return map;
}

/**
 * Get the bounding box for a cell (accounting for merges).
 * @param {string} ref - Cell reference (e.g. "A1")
 * @param {number[]} colX - Cumulative column X positions
 * @param {number[]} rowY - Cumulative row Y positions
 * @param {Object} mergeMap - Merge lookup
 * @returns {{ x: number, y: number, width: number, height: number }|null}
 */
function getCellBounds(ref, colX, rowY, mergeMap) {
	var pos = decodeCell(ref);
	var merge = mergeMap[ref];

	var startCol, endCol, startRow, endRow;
	if (merge) {
		// Only render content for the top-left cell of a merged region
		if (pos.r !== merge.s.r || pos.c !== merge.s.c) return null;
		startCol = merge.s.c;
		endCol = merge.e.c;
		startRow = merge.s.r;
		endRow = merge.e.r;
	} else {
		startCol = pos.c;
		endCol = pos.c;
		startRow = pos.r;
		endRow = pos.r;
	}

	// Bounds check
	if (startCol >= colX.length - 1 || startRow >= rowY.length - 1) return null;
	endCol = Math.min(endCol, colX.length - 2);
	endRow = Math.min(endRow, rowY.length - 2);

	return {
		x: colX[startCol],
		y: rowY[startRow],
		width: colX[endCol + 1] - colX[startCol],
		height: rowY[endRow + 1] - rowY[startRow]
	};
}

/**
 * Draw cell borders on the PDF.
 * @param {Object} doc - jsPDF instance
 * @param {Object} evalSheet - Evaluated sheet with cellStyles
 * @param {number[]} colX - Cumulative column X positions
 * @param {number[]} rowY - Cumulative row Y positions
 * @param {Object[]} merges - Merged regions
 */
function drawCellBorders(doc, evalSheet, colX, rowY, merges) {
	var numCols = colX.length - 1;
	var numRows = rowY.length - 1;
	var mergeMap = buildMergeMap(merges);
	var cellStyles = evalSheet.cellStyles || {};

	// Check if ANY cell has explicit borders — if not, draw default gridlines
	var hasAnyExplicitBorder = false;
	for (var checkRef in cellStyles) {
		if (cellStyles.hasOwnProperty(checkRef) && cellStyles[checkRef].border) {
			var b = cellStyles[checkRef].border;
			if (b.top || b.bottom || b.left || b.right) {
				hasAnyExplicitBorder = true;
				break;
			}
		}
	}

	for (var r = 0; r < numRows; r++) {
		for (var c = 0; c < numCols; c++) {
			var ref = encodeCell({ r: r, c: c });
			var merge = mergeMap[ref];

			// Skip non-origin cells in merged regions
			if (merge && (r !== merge.s.r || c !== merge.s.c)) continue;

			var bounds = getCellBounds(ref, colX, rowY, mergeMap);
			if (!bounds) continue;

			// Check for cell background fill
			var style = cellStyles[ref];
			if (style && style.fill && style.fill.fgColor && style.fill.fgColor.rgb) {
				var rgb = hexToRGB(style.fill.fgColor.rgb);
				doc.setFillColor(rgb[0], rgb[1], rgb[2]);
				doc.rect(bounds.x, bounds.y, bounds.width, bounds.height, "F");
			}

			if (hasAnyExplicitBorder) {
				// Draw explicitly defined borders from the Excel template
				if (style && style.border) {
					var bx = bounds.x, by = bounds.y, bw = bounds.width, bh = bounds.height;
					if (style.border.top) {
						var tc = hexToRGB(style.border.top.color);
						doc.setDrawColor(tc[0], tc[1], tc[2]);
						doc.setLineWidth(style.border.top.style === "thick" ? 0.5 : style.border.top.style === "medium" ? 0.3 : 0.15);
						doc.line(bx, by, bx + bw, by);
					}
					if (style.border.bottom) {
						var bc = hexToRGB(style.border.bottom.color);
						doc.setDrawColor(bc[0], bc[1], bc[2]);
						doc.setLineWidth(style.border.bottom.style === "thick" ? 0.5 : style.border.bottom.style === "medium" ? 0.3 : 0.15);
						doc.line(bx, by + bh, bx + bw, by + bh);
					}
					if (style.border.left) {
						var lc = hexToRGB(style.border.left.color);
						doc.setDrawColor(lc[0], lc[1], lc[2]);
						doc.setLineWidth(style.border.left.style === "thick" ? 0.5 : style.border.left.style === "medium" ? 0.3 : 0.15);
						doc.line(bx, by, bx, by + bh);
					}
					if (style.border.right) {
						var rc = hexToRGB(style.border.right.color);
						doc.setDrawColor(rc[0], rc[1], rc[2]);
						doc.setLineWidth(style.border.right.style === "thick" ? 0.5 : style.border.right.style === "medium" ? 0.3 : 0.15);
						doc.line(bx + bw, by, bx + bw, by + bh);
					}
				}
			} else {
				// No explicit borders in template — draw light default gridlines
				doc.setDrawColor(200, 200, 200);
				doc.setLineWidth(0.1);
				doc.rect(bounds.x, bounds.y, bounds.width, bounds.height, "S");
			}
		}
	}
}

/**
 * Draw text content in a cell.
 * @param {Object} doc - jsPDF instance
 * @param {string} text - Cell text
 * @param {Object} bounds - { x, y, width, height }
 * @param {Object|null} style - Cell style
 */
function drawCellText(doc, text, bounds, style) {
	if (!text) return;

	var fontSize = 10;
	var fontStyle = "normal";
	var textColor = [0, 0, 0];
	var align = "left";
	var vAlign = "middle";

	if (style) {
		// Font size
		if (style.font && style.font.sz) fontSize = style.font.sz; // jsPDF setFontSize takes points

		// Bold/italic
		if (style.font) {
			if (style.font.bold && style.font.italic) fontStyle = "bolditalic";
			else if (style.font.bold) fontStyle = "bold";
			else if (style.font.italic) fontStyle = "italic";
		}

		// Text color
		if (style.font && style.font.color && style.font.color.rgb) {
			textColor = hexToRGB(style.font.color.rgb);
		}

		// Alignment
		if (style.alignment) {
			if (style.alignment.horizontal === "center") align = "center";
			else if (style.alignment.horizontal === "right") align = "right";

			if (style.alignment.vertical === "top") vAlign = "top";
			else if (style.alignment.vertical === "bottom") vAlign = "bottom";
		}
	}

	doc.setFontSize(fontSize);
	doc.setFont("helvetica", fontStyle);
	doc.setTextColor(textColor[0], textColor[1], textColor[2]);

	// Calculate text position
	var padding = 1; // 1mm padding
	var textX = bounds.x + padding;
	if (align === "center") textX = bounds.x + bounds.width / 2;
	else if (align === "right") textX = bounds.x + bounds.width - padding;

	var textY = bounds.y + bounds.height / 2;
	if (vAlign === "top") textY = bounds.y + padding + fontSize * 0.353;
	else if (vAlign === "bottom") textY = bounds.y + bounds.height - padding;

	// Allow text to overflow cell bounds — the template designer controls column widths
	doc.text(String(text), textX, textY, { align: align });
}

/**
 * Convert hex color string to RGB array.
 * @param {string} hex - "RRGGBB" or "AARRGGBB"
 * @returns {number[]} [r, g, b]
 */
function hexToRGB(hex) {
	hex = hex.replace("#", "");
	// Handle ARGB format (8 chars)
	if (hex.length === 8) hex = hex.substring(2);
	var num = parseInt(hex, 16);
	return [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF];
}

// ── IndexedDB persistence ─────────────────────────────────────────────

var DB_NAME = "KirraDB";
var STORE_NAME = "printTemplates";

/**
 * Save a template to IndexedDB.
 * @param {string} name - Template display name
 * @param {ArrayBuffer} data - Raw XLSX data
 * @param {Object} [metadata] - Optional metadata (description, thumbnail, etc.)
 * @returns {Promise<void>}
 */
export async function saveTemplate(name, data, metadata) {
	var db = await openDB();
	return new Promise(function (resolve, reject) {
		var tx = db.transaction(STORE_NAME, "readwrite");
		var store = tx.objectStore(STORE_NAME);
		store.put({
			name: name,
			data: data,
			metadata: metadata || {},
			savedAt: new Date().toISOString()
		});
		tx.oncomplete = function () { resolve(); };
		tx.onerror = function () { reject(tx.error); };
	});
}

/**
 * Load a template from IndexedDB.
 * @param {string} name - Template name
 * @returns {Promise<Object|null>}
 */
export async function loadSavedTemplate(name) {
	var db = await openDB();
	return new Promise(function (resolve, reject) {
		var tx = db.transaction(STORE_NAME, "readonly");
		var store = tx.objectStore(STORE_NAME);
		var req = store.get(name);
		req.onsuccess = function () { resolve(req.result || null); };
		req.onerror = function () { reject(req.error); };
	});
}

/**
 * List all saved templates.
 * @returns {Promise<Object[]>} Array of { name, savedAt, metadata }
 */
export async function listSavedTemplates() {
	var db = await openDB();
	return new Promise(function (resolve, reject) {
		var tx = db.transaction(STORE_NAME, "readonly");
		var store = tx.objectStore(STORE_NAME);
		var req = store.getAll();
		req.onsuccess = function () {
			var templates = (req.result || []).map(function (t) {
				return { name: t.name, savedAt: t.savedAt, metadata: t.metadata };
			});
			resolve(templates);
		};
		req.onerror = function () { reject(req.error); };
	});
}

/**
 * Delete a saved template.
 * @param {string} name - Template name
 * @returns {Promise<void>}
 */
export async function deleteSavedTemplate(name) {
	var db = await openDB();
	return new Promise(function (resolve, reject) {
		var tx = db.transaction(STORE_NAME, "readwrite");
		var store = tx.objectStore(STORE_NAME);
		store.delete(name);
		tx.oncomplete = function () { resolve(); };
		tx.onerror = function () { reject(tx.error); };
	});
}

// ── Reference XLSX ────────────────────────────────────────────────────

/**
 * Fetch the bundled KirraCustomPrintTemplate.xlsx reference file.
 * This is the actual template designed in Excel with proper print layout,
 * page setup, margins, and centering — not a programmatically generated file.
 *
 * @returns {Promise<Blob>} XLSX file as Blob
 */
export async function generateReferenceXLSX() {
	var response = await fetch(referenceTemplateUrl);
	if (!response.ok) {
		throw new Error("Failed to fetch reference template: " + response.status);
	}
	return response.blob();
}

/**
 * Open/upgrade KirraDB to include printTemplates store.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
	return new Promise(function (resolve, reject) {
		// First try opening existing DB
		var req = indexedDB.open(DB_NAME);
		req.onsuccess = function () {
			var db = req.result;
			// Check if store exists
			if (db.objectStoreNames.contains(STORE_NAME)) {
				resolve(db);
			} else {
				// Need to upgrade
				var version = db.version + 1;
				db.close();
				var upgradeReq = indexedDB.open(DB_NAME, version);
				upgradeReq.onupgradeneeded = function (e) {
					var upgradeDb = e.target.result;
					if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) {
						upgradeDb.createObjectStore(STORE_NAME, { keyPath: "name" });
					}
				};
				upgradeReq.onsuccess = function () { resolve(upgradeReq.result); };
				upgradeReq.onerror = function () { reject(upgradeReq.error); };
			}
		};
		req.onerror = function () { reject(req.error); };
	});
}
