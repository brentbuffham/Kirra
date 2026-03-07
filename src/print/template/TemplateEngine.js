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
import { buildTemplateContext, getAvailableVariables } from "./TemplateVariables.js";

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

/**
 * Parse sheet name to extract paper size and orientation.
 * Formats: "A3-Landscape", "A4 Portrait", "A3_L", "A4_P", or just "Sheet1" (default)
 *
 * @param {string} sheetName
 * @returns {{ paperSize: string, orientation: string, widthMm: number, heightMm: number }}
 */
export function parseSheetConfig(sheetName) {
	var name = (sheetName || "").trim().toUpperCase();

	// Try to find paper size
	var paperSize = "A3"; // default
	var orientation = "landscape"; // default

	for (var size in PAPER_SIZES_MM) {
		if (name.indexOf(size.toUpperCase()) !== -1) {
			paperSize = size;
			break;
		}
	}

	// Try to find orientation
	if (name.indexOf("PORT") !== -1 || name.indexOf("_P") !== -1) {
		orientation = "portrait";
	} else if (name.indexOf("LAND") !== -1 || name.indexOf("_L") !== -1) {
		orientation = "landscape";
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

	return { paperSize: paperSize, orientation: orientation, widthMm: widthMm, heightMm: heightMm };
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
		var config = parseSheetConfig(sheetName);

		// Extract merges (ExcelJS stores as array of range strings like "A1:C3")
		var merges = [];
		if (ws.model && ws.model.merges) {
			for (var i = 0; i < ws.model.merges.length; i++) {
				merges.push(decodeRange(ws.model.merges[i]));
			}
		}

		// Extract column widths (ExcelJS columns are 1-indexed)
		var cols = [];
		if (ws.columns) {
			for (var c = 0; c < ws.columns.length; c++) {
				var col = ws.columns[c];
				cols.push({ wch: col && col.width ? col.width : 10 });
			}
		}

		// Extract row heights
		var rows = [];
		var maxRow = ws.rowCount || 0;
		for (var r = 1; r <= maxRow; r++) {
			var row = ws.getRow(r);
			rows.push({ hpt: row.height || 20 });
		}

		// Extract cell data using our helpers
		var cellData = extractCellValues(ws);

		template.sheets.push({
			name: sheetName,
			worksheet: ws,
			config: config,
			merges: merges,
			cols: cols,
			rows: rows,
			cells: cellData.cells,
			formulaCells: cellData.formulaCells,
			cellStyles: cellData.cellStyles
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
		row.eachCell({ includeEmpty: false }, function (cell, colNumber) {
			var ref = encodeCell({ r: rowNumber - 1, c: colNumber - 1 });
			var val = getCellStringValue(cell);
			cells[ref] = val;

			// Store style for PDF rendering
			if (cell.style) {
				cellStyles[ref] = convertExcelJSStyle(cell.style);
			}

			if (isTemplateFormula(val)) {
				formulaCells.push(ref);
			}
		});
	});

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
		return cell.value.toLocaleDateString();
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

		renderSheetToPDF(doc, sheet, matchedTemplate, renderCallbacks);
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
function renderSheetToPDF(doc, evalSheet, templateSheet, renderCallbacks) {
	var config = evalSheet.config;

	// Calculate column widths and row heights in mm
	var colWidths = calculateColumnWidthsMm(templateSheet, config.widthMm);
	var rowHeights = calculateRowHeightsMm(templateSheet, config.heightMm);

	// Calculate cumulative positions
	var colX = [0];
	for (var c = 0; c < colWidths.length; c++) {
		colX.push(colX[c] + colWidths[c]);
	}
	var rowY = [0];
	for (var r = 0; r < rowHeights.length; r++) {
		rowY.push(rowY[r] + rowHeights[r]);
	}

	// Build merge map: for each cell, find its merged region bounds
	var mergeMap = buildMergeMap(evalSheet.merges);

	// Draw cell borders and backgrounds
	drawCellBorders(doc, evalSheet, colX, rowY, evalSheet.merges);

	// Draw text cells
	for (var ref in evalSheet.textCells) {
		if (!evalSheet.textCells.hasOwnProperty(ref)) continue;

		var val = evalSheet.textCells[ref];
		if (!val || val === "") continue;

		// Get cell bounds (accounting for merges)
		var bounds = getCellBounds(ref, colX, rowY, mergeMap);
		if (!bounds) continue;

		// Get cell style from stored styles
		var cellStyle = evalSheet.cellStyles ? evalSheet.cellStyles[ref] : null;

		// Draw text
		drawCellText(doc, val, bounds, cellStyle);
	}

	// Draw render cells (graphics)
	for (var rRef in evalSheet.renderCells) {
		if (!evalSheet.renderCells.hasOwnProperty(rRef)) continue;

		var render = evalSheet.renderCells[rRef];
		var rBounds = getCellBounds(rRef, colX, rowY, mergeMap);
		if (!rBounds) continue;

		var callback = renderCallbacks[render.renderType];
		if (callback) {
			callback(doc, rBounds.x, rBounds.y, rBounds.width, rBounds.height, render.args);
		}
	}
}

/**
 * Calculate column widths in mm from column info.
 * @param {Object} sheet - Template sheet
 * @param {number} pageWidthMm - Total page width
 * @returns {number[]} Column widths in mm
 */
function calculateColumnWidthsMm(sheet, pageWidthMm) {
	var cols = sheet.cols || [];
	var numCols = cols.length || 1;

	// Also check worksheet for actual column count
	var ws = sheet.worksheet;
	if (ws && ws.columnCount && ws.columnCount > numCols) {
		numCols = ws.columnCount;
	}

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

	// Scale to page width (with small margin)
	var margin = pageWidthMm * 0.02; // 2% margin each side
	var usableWidth = pageWidthMm - margin * 2;
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
 * @returns {number[]} Row heights in mm
 */
function calculateRowHeightsMm(sheet, pageHeightMm) {
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

	// Scale to page height (with margin)
	var margin = pageHeightMm * 0.02;
	var usableHeight = pageHeightMm - margin * 2;
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

	var margin = colX[colX.length - 1] * 0.02 / colX.length; // tiny margin offset

	return {
		x: colX[startCol] + margin,
		y: rowY[startRow] + margin,
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

	doc.setDrawColor(180, 180, 180); // Light grey borders
	doc.setLineWidth(0.1);

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

			// Draw border
			doc.rect(bounds.x, bounds.y, bounds.width, bounds.height, "S");
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
		if (style.font && style.font.sz) fontSize = style.font.sz * 0.75; // pt to approximate mm-friendly size

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

	// Truncate text to fit cell width
	var maxWidth = bounds.width - padding * 2;

	doc.text(String(text), textX, textY, {
		align: align,
		maxWidth: maxWidth > 0 ? maxWidth : undefined
	});
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

// ── Reference XLSX generator ──────────────────────────────────────────

/**
 * Generate a reference/how-to XLSX file with all supported formulas,
 * examples, and a sample template sheet.
 *
 * @returns {Promise<Blob>} XLSX file as Blob
 */
export async function generateReferenceXLSX() {
	var wb = new ExcelJS.Workbook();

	// ── Sheet 1: How-To Guide ──
	var howTo = [
		["KIRRA TEMPLATE ENGINE - HOW TO"],
		[""],
		["GETTING STARTED"],
		["1. Design your template layout in this spreadsheet (or Google Sheets)"],
		["2. Use merged cells for headings, images, and larger content areas"],
		["3. Put fx: prefix before any formula cell (e.g. fx:today())"],
		["4. Save as .xlsx and import into Kirra via File > Print from Template"],
		["5. Choose output: populated XLSX or rendered PDF"],
		[""],
		["SHEET NAMING CONVENTION"],
		["Sheet name controls paper size and orientation:"],
		["  A3-Landscape, A4-Portrait, A2-Landscape, A1_L, A4_P, etc."],
		["  Default: A3 Landscape if not specified"],
		["  Each sheet = one page in multi-page output"],
		[""],
		["FORMULA SYNTAX"],
		['  All formulas start with fx: prefix (won\'t trigger Excel/Sheets formulas)'],
		["  String concatenation: use & operator"],
		['  Example: fx:"Drill: " & round(sum(holeLength[i]),1) & " (m)"'],
		["  Result:  Drill: 1927.3 (m)"],
		[""],
		["ITERATION WITH [i]"],
		["  field[i] iterates over all visible blast holes"],
		["  Use inside aggregation functions: sum(), count(), avg(), etc."],
		["  Example: fx:sum(holeLength[i])  ->  sums all hole lengths"],
		["  Example: fx:avg(holeDiameter[i])  ->  average diameter"],
		["  Example: fx:countif(holeType[i], \"Production\")  ->  count production holes"],
		[""],
		["SPECIAL RENDER CELLS"],
		["  These produce graphics (images) in the merged cell area:"],
		["  fx:northArrow  -  North arrow indicator"],
		["  fx:scale  -  Scale bar"],
		["  fx:logo  -  User logo"],
		["  fx:qrcode  -  QR code"],
		["  fx:mapView  -  Current map/3D view screenshot"],
		["  fx:legend(relief, h)  -  Horizontal legend for burden relief"],
		["  fx:legend(slope, v)  -  Vertical legend for slope"],
		["  fx:connectorCount  -  Connector count table"],
		["  fx:sectionView(H001)  -  Hole section view"],
		[""],
		["IMAGES IN TEMPLATES"],
		["  Embed images directly in the XLSX (Insert > Image in Excel/Sheets)"],
		["  Images are preserved when the template is processed"],
		["  For dynamic images, use render functions (fx:logo, fx:mapView, etc.)"],
		[""],
		["GOOGLE SHEETS"],
		["  Fully compatible - fx: prefix does not trigger Sheets formulas"],
		["  Design in Google Sheets, download as .xlsx, import into Kirra"],
		["  Merged cells, conditional formatting, images all supported"]
	];
	var wsHowTo = wb.addWorksheet("How-To");
	wsHowTo.addRows(howTo);
	wsHowTo.getColumn(1).width = 90;

	// ── Sheet 2: Formula Reference ──
	var vars = getAvailableVariables();

	var refData = [
		["FORMULA REFERENCE", "", "", ""],
		["Name", "Type", "Description", "Example"]
	];

	// Group headers and entries
	var currentType = "";
	for (var i = 0; i < vars.length; i++) {
		var v = vars[i];
		if (v.type !== currentType) {
			currentType = v.type;
			var typeLabels = {
				scalar: "SCALAR VARIABLES",
				iterated: "ITERATED FIELDS (use [i])",
				"function": "FUNCTIONS",
				operator: "OPERATORS",
				render: "RENDER FUNCTIONS (Graphics)"
			};
			refData.push([""]);
			refData.push([typeLabels[currentType] || currentType.toUpperCase()]);
		}
		refData.push([v.name, v.type, v.description, v.example || ""]);
	}

	var wsRef = wb.addWorksheet("Formula Reference");
	wsRef.addRows(refData);
	wsRef.getColumn(1).width = 35;
	wsRef.getColumn(2).width = 12;
	wsRef.getColumn(3).width = 50;
	wsRef.getColumn(4).width = 45;

	// ── Sheet 3: Sample Template (A3-Landscape) ──
	var sample = [
		["fx:blastName", "", "", "", "", "", "", "fx:logo"],
		[""],
		["Entity:", "fx:entityNames", "", "Date:", 'fx:dateformat("DD/MM/YYYY")', "", "Designer:", "fx:designer"],
		[""],
		["DRILL SUMMARY", "", "", "", "CHARGING SUMMARY"],
		["Holes:", "fx:count(holeID[i])", "", "", "Products:", 'fx:productList(", ")'],
		["Total Drill:", 'fx:round(sum(holeLength[i]),1) & " m"', "", "", "Total Mass:", 'fx:round(totalMass,1) & " kg"'],
		["Avg Depth:", 'fx:round(avg(holeLength[i]),1) & " m"', "", "", "Powder Factor:", 'fx:round(powderFactor,2) & " kg/m3"'],
		["Avg Diameter:", 'fx:fixed(avg(holeDiameter[i]),0) & " mm"', "", "", "Connectors:", 'fx:connectorList(", ")'],
		[""],
		["HOLE TYPES", "", "", "", "TIMING"],
		['fx:groupCount(holeType[i], "\\n", "desc")', "", "", "", "Min Firing:", "fx:min(holeTime[i]) & \" ms\""],
		["", "", "", "", "Max Firing:", "fx:max(holeTime[i]) & \" ms\""],
		[""],
		["GEOMETRY", "", "", "", "VOLUME"],
		["Avg Burden:", 'fx:round(avg(burden[i]),2) & " m"', "", "", "Total Volume:", 'fx:round(totalVolume,1) & " m3"'],
		["Avg Spacing:", 'fx:round(avg(spacing[i]),2) & " m"', "", "", "Surface Area:", 'fx:round(totalSurfaceArea,1) & " m2"'],
		["Avg Angle:", 'fx:round(avg(holeAngle[i]),1) & " deg"'],
		[""],
		["", "", "fx:mapView"],
		[""],
		["", "", "", "", "", "", "fx:northArrow", "fx:scale"]
	];
	var wsSample = wb.addWorksheet("A3-Landscape");
	wsSample.addRows(sample);
	wsSample.getColumn(1).width = 16;
	wsSample.getColumn(2).width = 24;
	wsSample.getColumn(3).width = 12;
	wsSample.getColumn(4).width = 4;
	wsSample.getColumn(5).width = 16;
	wsSample.getColumn(6).width = 24;
	wsSample.getColumn(7).width = 12;
	wsSample.getColumn(8).width = 16;
	// Add some merges for the sample
	wsSample.mergeCells("A1:F1");    // Title merged
	wsSample.mergeCells("H1:H2");    // Logo area
	wsSample.mergeCells("C19:F21");  // Map view area

	// Generate XLSX buffer
	var buf = await wb.xlsx.writeBuffer();
	return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
