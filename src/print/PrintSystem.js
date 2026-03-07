///------------------ PRINT TEMPLATE SYSTEM ------------------///
// #region PRINT
// This module handles print preview, boundary calculations, and PDF generation
// GeoPDF support has been removed - standard PDF output only

import { jsPDF } from "jspdf";
import { drawDataForPrinting, printSurfaceSVG, printBoundarySVG, printDataSVG } from "./PrintRendering.js";
import { printHeader, printFooter, printHeaderSVG, printFooterSVG } from "./PrintStats.js";
import { generateTrueVectorPDF } from "./PrintVectorPDF.js";
import { getTemplate, getPaperDimensions, PAPER_SIZES } from "./PrintTemplates.js";
import { PrintLayoutManager } from "./PrintLayoutManager.js";
import { showPrintDialog } from "./PrintDialog.js";
import { PrintCaptureManager } from "./PrintCaptureManager.js";
import { getBlastStatisticsPerEntity } from "../helpers/BlastStatistics.js";
import { getActiveLegends } from "../overlay/index.js";

// ============== PRINT STATE VARIABLES ==============
export var printMode = false;
export var printOrientation = "landscape"; // 'landscape' or 'portrait'
export var printPaperSize = "A4"; // 'A4', 'A3', 'A2', 'A1', 'A0'
export var isPrinting = false;

// Paper size ratios (width:height in mm - landscape dimensions)
export var paperRatios = PAPER_SIZES;

// Print canvas for high-res output
export var printCanvas = document.createElement("canvas");
export var printCtx = printCanvas.getContext("2d");

// 3D print boundary overlay element
var printBoundary3DOverlay = null;

// Cached layout manager for current settings
var cachedLayoutManager = null;

// Template preview mode — simple paper rectangle for XLSX template printing
var templatePreviewConfig = null; // { widthMm, heightMm, orientation, paperSize, sheetName }

// ============== LAYOUT MANAGER HELPERS ==============

// Step 1) Get or create layout manager for current settings
function getLayoutManager(mode) {
    mode = mode || "2D";
    
    // Step 1a) Get paper dimensions
    var paperDims = getPaperDimensions(printPaperSize, printOrientation);
    
    // Step 1b) Get template
    var template = getTemplate(mode, printOrientation);
    
    // Step 1c) Create layout manager
    return new PrintLayoutManager(template, paperDims.width, paperDims.height);
}

// ============== PRINT BOUNDARY CALCULATIONS ==============

// Step 2) Calculate print-safe boundary on canvas (UNIFIED for 2D and 3D)
// CRITICAL: Must use SAME calculation as drawPrintBoundary() for WYSIWYG consistency
// Uses calculateFullPreviewPositions() to match what user sees in preview
// Step 2) Returns the print boundary for coordinate transformation
export function getPrintBoundary(canvas) {
    // Step 2a) Check if print preview is active - check BOTH the variable AND the checkbox
    // This fixes issues where printMode variable gets out of sync with UI state
    var toggle = document.getElementById("addPrintPreviewToggle");
    var isPreviewActive = printMode || (toggle && toggle.checked);

    if (!isPreviewActive) return null;

    // Step 2b) Template preview mode — simple paper rectangle
    if (templatePreviewConfig) {
        var cfg = templatePreviewConfig;
        var pageAspect = cfg.widthMm / cfg.heightMm;
        var margin = 30;
        var availW = canvas.width - margin * 2;
        var availH = canvas.height - margin * 2;
        var canvasAspect = availW / availH;
        var pw, ph;
        if (canvasAspect > pageAspect) {
            ph = availH; pw = ph * pageAspect;
        } else {
            pw = availW; ph = pw / pageAspect;
        }
        var px = (canvas.width - pw) / 2;
        var py = (canvas.height - ph) / 2;
        var inX = pw * 0.02;
        var inY = ph * 0.02;
        return {
            x: px, y: py, width: pw, height: ph,
            innerX: px + inX, innerY: py + inY,
            innerWidth: pw - inX * 2, innerHeight: ph - inY * 2,
            marginPercent: 0.02
        };
    }

    // Step 2c) Default Kirra preview mode
    var dimension2D3DBtn = document.getElementById("dimension2D-3DBtn");
    var isIn3DMode = dimension2D3DBtn && dimension2D3DBtn.checked === true;
    var mode = isIn3DMode ? "3D" : "2D";

    // Step 2d) Get layout manager
    var layoutMgr = getLayoutManager(mode);

    // Step 2e) Calculate FULL preview positions (same as drawPrintBoundary uses)
    var preview = layoutMgr.calculateFullPreviewPositions(canvas.width, canvas.height, 30);

    // Step 2f) Return both map zone (outer) and mapInner (data area) for coordinate transformation
    var mapZone = preview.map;
    var mapInner = preview.mapInner;

    var marginXDiff = mapInner.x - mapZone.x;
    var marginPercent = mapZone.width > 0 ? marginXDiff / mapZone.width : 0;

    return {
        x: mapZone.x,
        y: mapZone.y,
        width: mapZone.width,
        height: mapZone.height,
        innerX: mapInner.x,
        innerY: mapInner.y,
        innerWidth: mapInner.width,
        innerHeight: mapInner.height,
        marginPercent: marginPercent
    };
}

// Step 3) Draw full template preview on 2D canvas
// Two modes:
//   Default (Kirra): Map zone + footer zone with labeled columns
//   Template (XLSX): Simple paper rectangle with content area
export function drawPrintBoundary(ctx, canvas) {
    // Step 3a) Check if print preview is active
    var toggle = document.getElementById("addPrintPreviewToggle");
    var isPreviewActive = printMode || (toggle && toggle.checked);

    if (!isPreviewActive) return;
    if (isPrinting) return;

    ctx.save();

    // Step 3b) Template preview mode — simple paper rectangle
    if (templatePreviewConfig) {
        drawTemplatePreview(ctx, canvas);
        ctx.restore();
        return;
    }

    // Step 3c) Default Kirra preview mode — full template layout
    drawDefaultPreview(ctx, canvas);
    ctx.restore();
}

// Step 3d) Draw XLSX template preview — simple paper rectangle with content area
function drawTemplatePreview(ctx, canvas) {
    var cfg = templatePreviewConfig;
    var pageW = cfg.widthMm;
    var pageH = cfg.heightMm;
    var pageAspect = pageW / pageH;
    var margin = 30;

    // Fit page rectangle into canvas maintaining aspect ratio
    var availW = canvas.width - margin * 2;
    var availH = canvas.height - margin * 2;
    var canvasAspect = availW / availH;

    var previewW, previewH;
    if (canvasAspect > pageAspect) {
        previewH = availH;
        previewW = previewH * pageAspect;
    } else {
        previewW = availW;
        previewH = previewW / pageAspect;
    }

    var px = (canvas.width - previewW) / 2;
    var py = (canvas.height - previewH) / 2;

    // Page outline — thin grey
    ctx.strokeStyle = "#999999";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(px, py, previewW, previewH);

    // Content / map area — 2% inset (matching PDF margins)
    var insetX = previewW * 0.02;
    var insetY = previewH * 0.02;
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(px + insetX, py + insetY, previewW - insetX * 2, previewH - insetY * 2);

    // Orientation indicator in center
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var orientLabel = cfg.orientation === "portrait" ? "PORTRAIT" : "LANDSCAPE";
    ctx.fillText(orientLabel, px + previewW / 2, py + previewH / 2);

    // Label bar at top
    var labelText = "Template: " + cfg.paperSize + " " + cfg.orientation;
    if (cfg.sheetName) labelText += " — " + cfg.sheetName;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(px, py - 22, Math.min(labelText.length * 7 + 20, previewW), 20);
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(labelText, px + 5, py - 8);
}

// Step 3e) Draw default Kirra template preview — map zone + footer with labeled columns
function drawDefaultPreview(ctx, canvas) {
    var dimension2D3DBtn = document.getElementById("dimension2D-3DBtn");
    var isIn3DMode = dimension2D3DBtn && dimension2D3DBtn.checked === true;
    var mode = isIn3DMode ? "3D" : "2D";

    var layoutMgr = getLayoutManager(mode);
    var preview = layoutMgr.calculateFullPreviewPositions(canvas.width, canvas.height, 30);

    // Map zone outline — the PRINT BOUNDARY (black solid line)
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(preview.map.x, preview.map.y, preview.map.width, preview.map.height);

    // "[MAP]" label in center
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("[MAP]", preview.map.x + preview.map.width / 2, preview.map.y + preview.map.height / 2);

    // Footer zone outline
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1;
    ctx.strokeRect(preview.footer.x, preview.footer.y, preview.footer.width, preview.footer.height);

    // Footer column borders and labels
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000000";

    for (var i = 0; i < preview.footerColumns.length; i++) {
        var col = preview.footerColumns[i];
        ctx.strokeStyle = "#666666";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(col.x, col.y, col.width, col.height);

        var colLabel = "";
        if (col.id === "navIndicator" || col.id === "navLogoColumn") {
            colLabel = mode === "3D" ? "[XYZ GIZMO]" : "[NORTH ARROW]";
        } else if (col.id === "connectorCount") {
            colLabel = "CONNECTOR\nCOUNT";
        } else if (col.id === "legend") {
            colLabel = "LEGEND";
        } else if (col.id === "blastStatistics") {
            colLabel = "BLAST\nSTATISTICS";
        } else if (col.id === "logo") {
            colLabel = "[LOGO]\nblastingapps.com";
        }

        if (colLabel) {
            var lines = colLabel.split("\n");
            var lineHeight = 12;
            var startY = col.y + col.height / 2 - (lines.length - 1) * lineHeight / 2;
            for (var l = 0; l < lines.length; l++) {
                ctx.fillText(lines[l], col.x + col.width / 2, startY + l * lineHeight);
            }
        }
    }

    // Title block rows
    for (var j = 0; j < preview.titleBlockRows.length; j++) {
        var row = preview.titleBlockRows[j];
        ctx.strokeStyle = "#666666";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(row.x, row.y, row.width, row.height);

        var rowLabel = "";
        if (row.id === "title") rowLabel = "TITLE\n[BLASTNAME]";
        else if (row.id === "date") rowLabel = "DATE\n[DATE/TIME]";
        else if (row.id === "scaleDesigner") rowLabel = "Scale: [CALC]\nDesigner: [ENTRY]";

        if (rowLabel) {
            var rLines = rowLabel.split("\n");
            var rLineHeight = 10;
            var rStartY = row.y + row.height / 2 - (rLines.length - 1) * rLineHeight / 2;
            ctx.font = "9px Arial";
            for (var rl = 0; rl < rLines.length; rl++) {
                ctx.fillText(rLines[rl], row.x + row.width / 2, rStartY + rl * rLineHeight);
            }
        }
    }

    // Nav/logo rows for portrait mode
    if (preview.navLogoRows) {
        for (var k = 0; k < preview.navLogoRows.length; k++) {
            var navRow = preview.navLogoRows[k];
            ctx.strokeStyle = "#666666";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(navRow.x, navRow.y, navRow.width, navRow.height);

            var navLabel = "";
            if (navRow.id === "navIndicator") navLabel = mode === "3D" ? "[XYZ]" : "[N]";
            else if (navRow.id === "logo") navLabel = "[QR]";

            if (navLabel) {
                ctx.font = "8px Arial";
                ctx.fillText(navLabel, navRow.x + navRow.width / 2, navRow.y + navRow.height / 2);
            }
        }
    }

    // Print preview label
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(preview.page.x, preview.page.y - 22, 200, 20);
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Print Preview: " + printPaperSize + " " + printOrientation + " (" + mode + ")", preview.page.x + 5, preview.page.y - 8);
}

// ============== 3D PRINT BOUNDARY OVERLAY SYSTEM ==============

// Step 4) Toggle 3D print preview mode
export function toggle3DPrintPreview(enabled, paperSize, orientation, threeRenderer) {
	if (enabled) {
		create3DPrintBoundaryOverlay(paperSize, orientation, threeRenderer);
	} else {
		remove3DPrintBoundaryOverlay();
	}
}

// Step 5) Create overlay canvas showing print boundaries for 3D mode
function create3DPrintBoundaryOverlay(paperSize, orientation, threeRenderer) {
    // Step 5a) Remove existing overlay if any
	remove3DPrintBoundaryOverlay();
	
    // Step 5b) Get Three.js canvas
    var threeCanvas = threeRenderer.getCanvas();
    var rect = threeCanvas.getBoundingClientRect();
    
    // Step 5c) Create overlay canvas
    var overlayCanvas = document.createElement("canvas");
	overlayCanvas.id = "print-boundary-3d";
	overlayCanvas.width = rect.width;
	overlayCanvas.height = rect.height;
	overlayCanvas.style.position = "absolute";
	overlayCanvas.style.left = threeCanvas.offsetLeft + "px";
	overlayCanvas.style.top = threeCanvas.offsetTop + "px";
	overlayCanvas.style.width = rect.width + "px";
	overlayCanvas.style.height = rect.height + "px";
	overlayCanvas.style.pointerEvents = "none";
	overlayCanvas.style.zIndex = "4"; // Above Three.js canvas
	
    // Step 5d) Get layout manager
    var layoutMgr = getLayoutManager("3D");
    
    // Step 5e) Calculate full template preview positions
    var preview = layoutMgr.calculateFullPreviewPositions(rect.width, rect.height, 30);
    
    // Step 5f) Draw template preview - only black template boundary (matches 2D behavior)
    // Red page outline and blue inner zone removed for consistency with 2D preview
    var ctx = overlayCanvas.getContext("2d");
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    // Map zone outline - the PRINT BOUNDARY (black solid line)
    // This is the only boundary shown - data will be clipped to this area
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(preview.map.x, preview.map.y, preview.map.width, preview.map.height);
    
    // Draw "[MAP]" label in center of map zone (same as 2D)
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("[MAP]", preview.map.x + preview.map.width / 2, preview.map.y + preview.map.height / 2);
    
    // Footer zone outline
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1;
    ctx.strokeRect(preview.footer.x, preview.footer.y, preview.footer.width, preview.footer.height);
    
    // Footer column borders
    ctx.strokeStyle = "#666666";
    ctx.lineWidth = 0.5;
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000000";
    
    for (var i = 0; i < preview.footerColumns.length; i++) {
        var col = preview.footerColumns[i];
        ctx.strokeRect(col.x, col.y, col.width, col.height);
        
        // Draw column label based on ID (same as 2D)
        var colLabel = "";
        if (col.id === "navIndicator" || col.id === "navLogoColumn") {
            colLabel = "[XYZ GIZMO]";
        } else if (col.id === "connectorCount") {
            colLabel = "CONNECTOR\nCOUNT";
        } else if (col.id === "legend") {
            colLabel = "LEGEND";
        } else if (col.id === "blastStatistics") {
            colLabel = "BLAST\nSTATISTICS";
        } else if (col.id === "logo") {
            colLabel = "[LOGO]\nblastingapps.com";
        }
        
        if (colLabel) {
            var lines = colLabel.split("\n");
            var lineHeight = 12;
            var startY = col.y + col.height / 2 - (lines.length - 1) * lineHeight / 2;
            for (var l = 0; l < lines.length; l++) {
                ctx.fillText(lines[l], col.x + col.width / 2, startY + l * lineHeight);
            }
        }
    }
    
    // Title block row borders
    for (var j = 0; j < preview.titleBlockRows.length; j++) {
        var row = preview.titleBlockRows[j];
        ctx.strokeRect(row.x, row.y, row.width, row.height);
        
        // Draw row label (same as 2D)
        var rowLabel = "";
        if (row.id === "title") {
            rowLabel = "TITLE\n[BLASTNAME]";
        } else if (row.id === "date") {
            rowLabel = "DATE\n[DATE/TIME]";
        } else if (row.id === "scaleDesigner") {
            rowLabel = "Scale: [CALC]\nDesigner: [ENTRY]";
        }
        
        if (rowLabel) {
            var rLines = rowLabel.split("\n");
            var rLineHeight = 10;
            var rStartY = row.y + row.height / 2 - (rLines.length - 1) * rLineHeight / 2;
            ctx.font = "9px Arial";
            for (var rl = 0; rl < rLines.length; rl++) {
                ctx.fillText(rLines[rl], row.x + row.width / 2, rStartY + rl * rLineHeight);
            }
        }
    }
    
    // Nav/logo rows for portrait
    if (preview.navLogoRows) {
        for (var k = 0; k < preview.navLogoRows.length; k++) {
            var navRow = preview.navLogoRows[k];
            ctx.strokeRect(navRow.x, navRow.y, navRow.width, navRow.height);
            
            // Draw row label (same as 2D)
            var navLabel = "";
            if (navRow.id === "navIndicator") {
                navLabel = "[XYZ]";
            } else if (navRow.id === "logo") {
                navLabel = "[QR]";
            }
            
            if (navLabel) {
                ctx.font = "8px Arial";
                ctx.fillText(navLabel, navRow.x + navRow.width / 2, navRow.y + navRow.height / 2);
            }
        }
    }
    
    // Print preview label (positioned relative to map zone instead of page)
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(preview.map.x, preview.map.y - 22, 200, 20);
    ctx.fillStyle = "white";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Print Preview: " + paperSize + " " + orientation + " (3D)", preview.map.x + 5, preview.map.y - 8);
    
    // Step 5g) Insert into DOM
	threeCanvas.parentElement.appendChild(overlayCanvas);
	printBoundary3DOverlay = overlayCanvas;
	
    // Step 5h) Store boundary info for capture (use map zone - matches black border shown)
	overlayCanvas.boundaryInfo = {
        x: preview.map.x,
        y: preview.map.y,
        width: preview.map.width,
        height: preview.map.height,
        innerMargin: 0,
		paperSize: paperSize,
		orientation: orientation
	};
}

// Step 6) Remove 3D print boundary overlay
export function remove3DPrintBoundaryOverlay() {
	if (printBoundary3DOverlay && printBoundary3DOverlay.parentElement) {
		printBoundary3DOverlay.parentElement.removeChild(printBoundary3DOverlay);
		printBoundary3DOverlay = null;
	}
}

// Step 7) Get 3D print boundary info (for capture system)
export function get3DPrintBoundary() {
	if (!printBoundary3DOverlay) return null;
	return printBoundary3DOverlay.boundaryInfo;
}

// Step 8) Set paper size and update boundaries
export function setPrintPaperSize(size) {
	printPaperSize = size;
    cachedLayoutManager = null; // Clear cache
	
	// Update 3D boundary if in preview mode
	if (printMode && window.is3DMode && window.threeRenderer) {
		toggle3DPrintPreview(true, printPaperSize, printOrientation, window.threeRenderer);
	}
}

// Step 9) Set orientation and update boundaries
export function setPrintOrientation(orientation) {
	printOrientation = orientation;
    cachedLayoutManager = null; // Clear cache
	
	// Update 3D boundary if in preview mode
	if (printMode && window.is3DMode && window.threeRenderer) {
		toggle3DPrintPreview(true, printPaperSize, printOrientation, window.threeRenderer);
	}
}

// Step 9b) Set template preview mode — shows a simple paper rectangle for XLSX template printing
export function setTemplatePreview(config) {
	templatePreviewConfig = config; // { widthMm, heightMm, orientation, paperSize, sheetName }
	// Also enable print mode so the preview draws
	printMode = true;
	var toggle = document.getElementById("addPrintPreviewToggle");
	if (toggle) toggle.checked = true;
	// Trigger redraw
	if (typeof window.drawData === "function") {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
}

// Step 9c) Clear template preview mode
export function clearTemplatePreview() {
	templatePreviewConfig = null;
}

// Step 9d) Check if template preview is active
export function isTemplatePreview() {
	return templatePreviewConfig !== null;
}

/**
 * Capture the current map view as a high-resolution raster image.
 * Uses drawDataForPrinting to render holes, surfaces, images, KADs
 * onto a clean offscreen canvas at print resolution.
 *
 * @param {Object} context - Application context (same as printToPDF context)
 * @param {number} targetWidthMm - Target width in mm (for aspect ratio and DPI calc)
 * @param {number} targetHeightMm - Target height in mm
 * @param {number} [dpi=200] - DPI for raster output (200 is good for embedded images)
 * @returns {string|null} PNG data URL, or null on failure
 */
export function captureMapViewRaster(context, targetWidthMm, targetHeightMm, dpi) {
	dpi = dpi || 200;
	var mmToPx = dpi / 25.4;

	// Save original print canvas state
	var origWidth = printCanvas.width;
	var origHeight = printCanvas.height;
	var origCtx = printCtx;

	try {
		// Resize print canvas to target size
		var pxW = Math.round(targetWidthMm * mmToPx);
		var pxH = Math.round(targetHeightMm * mmToPx);

		// Safety check
		var MAX_SIDE = 8192;
		if (pxW > MAX_SIDE) { var ratio = MAX_SIDE / pxW; pxW = MAX_SIDE; pxH = Math.round(pxH * ratio); }
		if (pxH > MAX_SIDE) { var ratio2 = MAX_SIDE / pxH; pxH = MAX_SIDE; pxW = Math.round(pxW * ratio2); }

		printCanvas.width = pxW;
		printCanvas.height = pxH;
		printCtx = printCanvas.getContext("2d");

		// White background
		printCtx.imageSmoothingEnabled = true;
		printCtx.imageSmoothingQuality = "high";
		printCtx.fillStyle = "white";
		printCtx.fillRect(0, 0, pxW, pxH);

		// Define print area as the full canvas
		var printArea = { x: 0, y: 0, width: pxW, height: pxH };

		// Clip to print area
		printCtx.save();
		printCtx.beginPath();
		printCtx.rect(0, 0, pxW, pxH);
		printCtx.clip();

		// Render data using the existing print rendering pipeline
		// Suppress overlay text (hole count, scale, date) for template raster captures
		var captureContext = Object.assign({}, context, { suppressOverlayText: true });
		drawDataForPrinting(printCtx, printArea, captureContext);

		printCtx.restore();

		// Capture
		var dataURL = printCanvas.toDataURL("image/png", 1.0);

		return (dataURL && dataURL.length > 100) ? dataURL : null;
	} catch (e) {
		console.warn("[PrintSystem] captureMapViewRaster failed:", e.message);
		return null;
	} finally {
		// Restore original print canvas
		printCanvas.width = origWidth;
		printCanvas.height = origHeight;
		printCtx = origCtx || printCanvas.getContext("2d");
	}
}

// ============== PRINT TO PDF ==============

// Step 10) Main print to PDF function
export function printToPDF(context) {
    // Step 10a) Detect current mode (2D or 3D)
    var dimension2D3DBtn = document.getElementById("dimension2D-3DBtn");
    var isIn3DMode = dimension2D3DBtn && dimension2D3DBtn.checked === true;
    var mode = isIn3DMode ? "3D" : "2D";
    
    // Step 10b) Enhance context with necessary print functions
    var enhancedContext = Object.assign({}, context, {
		getPrintBoundary: getPrintBoundary,
		get3DPrintBoundary: get3DPrintBoundary,
		mode: mode,
        is3DMode: isIn3DMode,
        printPaperSize: printPaperSize,
        printOrientation: printOrientation
    });
    
    // Step 10c) Show print dialog with user input
    showPrintDialog(mode, enhancedContext, function(userInput) {
        // Step 10d) Add paper settings to userInput
        userInput.paperSize = printPaperSize;
        userInput.orientation = printOrientation;
        
        // Step 10e) Generate PDF based on output type
		if (userInput.outputType === "vector") {
            // Vector PDF using jsPDF drawing commands
            generateTrueVectorPDF(
                Object.assign({}, enhancedContext, {
				printPaperSize: printPaperSize,
				printOrientation: printOrientation,
				userInput: userInput,
				mode: mode
                }),
                userInput,
                mode
            );
		} else {
            // Raster PDF (high-res PNG to PDF)
            printCanvasHiRes(
                Object.assign({}, enhancedContext, {
				printPaperSize: printPaperSize,
				printOrientation: printOrientation,
				userInput: userInput,
				mode: mode
                })
            );
		}
	});
}

// Step 11) High-resolution raster PDF generation with template layout
export function printCanvasHiRes(context) {
    var allBlastHoles = context.allBlastHoles;
    var allKADDrawingsMap = context.allKADDrawingsMap;
    var allAvailableSurfaces = context.allAvailableSurfaces;
    var showModalMessage = context.showModalMessage;
    var FloatingDialog = context.FloatingDialog;
    var userInput = context.userInput || { blastName: "Untitled Blast", designer: "" };
    var mode = context.mode || "2D";

    // Step 11a) Check for data - allow printing if surfaces or images are loaded
    var loadedSurfaces = context.loadedSurfaces;
    var loadedImages = context.loadedImages;
    var hasSurfaces = (loadedSurfaces && loadedSurfaces.size > 0) || (allAvailableSurfaces && allAvailableSurfaces.length > 0);
    var hasImages = loadedImages && loadedImages.size > 0;
    var hasBlastHoles = allBlastHoles && allBlastHoles.length > 0;
    var hasKAD = allKADDrawingsMap && allKADDrawingsMap.size > 0;

    if (!hasBlastHoles && !hasKAD && !hasSurfaces && !hasImages) {
        showModalMessage("No Data", "No data available for printing", "warning");
		return;
	}

    // Step 11b) Create progress dialog
    var progressContent = document.createElement("div");
	progressContent.style.textAlign = "center";
    progressContent.innerHTML = '<p>Generating High-Resolution PDF</p>' +
        '<p>Please wait, this may take a moment...</p>' +
        '<div style="width: 100%; background-color: #333; border-radius: 5px; margin: 20px 0;">' +
        '<div id="pdfProgressBar" style="width: 0%; height: 20px; background-color: #4CAF50; border-radius: 5px; transition: width 0.3s;"></div>' +
        '</div>' +
        '<p id="pdfProgressText">Starting...</p>';

    var progressDialog = new FloatingDialog({
		title: "PDF Generation",
		content: progressContent,
		layoutType: "standard",
		width: 350,
		height: 200,
		showConfirm: false,
		showCancel: false,
        allowOutsideClick: false
	});

	progressDialog.show();

    var bar = document.getElementById("pdfProgressBar");
    var text = document.getElementById("pdfProgressText");

    // Step 11b2) Pre-load QR code image before starting rendering
    var qrCodeImage = new Image();
    qrCodeImage.crossOrigin = "anonymous";
    qrCodeImage.onload = function() {
        // QR code loaded successfully, proceed with rendering
        startRasterRendering(qrCodeImage);
    };
    qrCodeImage.onerror = function() {
        // QR code failed to load, proceed without it
        console.warn("QR code image failed to load, proceeding without it");
        startRasterRendering(null);
    };
    qrCodeImage.src = "icons/kirra2d-qr-code.png";
    
    // Set a timeout in case image never loads or errors
    setTimeout(function() {
        if (!qrCodeImage.complete) {
            console.warn("QR code image loading timed out");
            startRasterRendering(null);
        }
    }, 2000);
    
    function startRasterRendering(preloadedQRCode) {
        try {
            var dpi = 300;
            var mmToPx = dpi / 25.4;

            // Step 11c) Get paper dimensions
            var paperDims = getPaperDimensions(printPaperSize, printOrientation);
            var pageWidth = paperDims.width;
            var pageHeight = paperDims.height;

            // Step 11d) Safety check for maximum canvas size
            var MAX_CANVAS_SIDE = 16384;
			if (pageWidth * mmToPx > MAX_CANVAS_SIDE || pageHeight * mmToPx > MAX_CANVAS_SIDE) {
                throw new Error("The selected paper size (" + printPaperSize + ") creates an image too large for the browser.");
			}

            // Step 11e) Resize print canvas
			printCanvas.width = pageWidth * mmToPx;
			printCanvas.height = pageHeight * mmToPx;
			printCtx = printCanvas.getContext("2d");

			printCtx.imageSmoothingEnabled = true;
			printCtx.imageSmoothingQuality = "high";
			printCtx.fillStyle = "white";
			printCtx.fillRect(0, 0, printCanvas.width, printCanvas.height);

            // Step 11f) Get layout manager for template positions
            var layoutMgr = getLayoutManager(mode);
            var mapZone = layoutMgr.getMapZone();
            var mapInnerZone = layoutMgr.getMapInnerZone();
            var footerZone = layoutMgr.getFooterZone();
            var footerColumns = layoutMgr.getFooterColumns();
            var titleBlockRows = layoutMgr.getTitleBlockRows();
            var navLogoRows = layoutMgr.getNavLogoRows();

            // Step 11g) Convert mm to pixels for print area
            // Use mapZone (black template boundary) for BOTH clipping AND data positioning
            // Data fills up to the black border, clipping at the black border
            var printArea = {
                x: mapZone.x * mmToPx,
                y: mapZone.y * mmToPx,
                width: mapZone.width * mmToPx,
                height: mapZone.height * mmToPx
            };

					bar.style.width = "20%";
            text.textContent = "Drawing template...";

            setTimeout(function() {
                try {
                    // Step 11h) Draw map zone border
                    printCtx.strokeStyle = "#000000";
                    printCtx.lineWidth = 2;
                    printCtx.strokeRect(mapZone.x * mmToPx, mapZone.y * mmToPx, mapZone.width * mmToPx, mapZone.height * mmToPx);
                    
                    // Step 11i) Draw footer zone border
                    printCtx.strokeRect(footerZone.x * mmToPx, footerZone.y * mmToPx, footerZone.width * mmToPx, footerZone.height * mmToPx);
                    
                    // Step 11j) Draw footer column borders
                    printCtx.lineWidth = 1;
                    for (var c = 0; c < footerColumns.length; c++) {
                        var col = footerColumns[c];
                        printCtx.strokeRect(col.x * mmToPx, col.y * mmToPx, col.width * mmToPx, col.height * mmToPx);
                    }
                    
                    // Step 11k) Draw title block row borders
                    for (var r = 0; r < titleBlockRows.length; r++) {
                        var row = titleBlockRows[r];
                        printCtx.strokeRect(row.x * mmToPx, row.y * mmToPx, row.width * mmToPx, row.height * mmToPx);
                    }
                    
                    // Step 11l) Draw nav/logo row borders (portrait mode)
                    if (navLogoRows) {
                        for (var n = 0; n < navLogoRows.length; n++) {
                            var navRow = navLogoRows[n];
                            printCtx.strokeRect(navRow.x * mmToPx, navRow.y * mmToPx, navRow.width * mmToPx, navRow.height * mmToPx);
                        }
                    }
                    
                    // Step 11m) Draw navigation indicator (North Arrow or XYZ Gizmo)
                    console.log("[Raster Nav] Getting nav indicator cell, mode:", mode);
                    var navCell = layoutMgr.getNavIndicatorCell();
                    console.log("[Raster Nav] navCell:", navCell ? JSON.stringify(navCell) : "null");
                    
                    if (navCell) {
                        // Use 60% of cell size to prevent cutting off (same as vector PDF)
                        var navSizeMM = Math.min(navCell.width, navCell.height) * 0.6;
                        var navSize = navSizeMM * mmToPx;
                        var navCenterX = (navCell.x + navCell.width / 2) * mmToPx;
                        var navCenterY = (navCell.y + navCell.height / 2) * mmToPx;
                        
                        console.log("[Raster Nav] Drawing nav indicator, mode:", mode, "is3D:", mode === "3D");
                        
                        if (mode === "2D") {
                            // Draw North Arrow directly (more reliable than Image object)
                            printCtx.save();
                            printCtx.translate(navCenterX, navCenterY);
                            printCtx.rotate(-(context.currentRotation || 0)); // Counter-rotate canvas rotation
                            
                            // Draw arrow shape scaled to navSize
                            var arrowScale = navSize / 120; // Original arrow canvas was 120x120
                            printCtx.fillStyle = "#000000";
                            printCtx.beginPath();
                            printCtx.moveTo(0, -30 * arrowScale);      // Arrow point (top)
                            printCtx.lineTo(-12 * arrowScale, 25 * arrowScale);     // Left wing
                            printCtx.lineTo(0, 15 * arrowScale);       // Center notch
                            printCtx.lineTo(12 * arrowScale, 25 * arrowScale);      // Right wing
                            printCtx.closePath();
                            printCtx.fill();
                            
                            // Draw "N" label above arrow
                            printCtx.font = "bold " + (18 * arrowScale) + "px Arial";
                            printCtx.textAlign = "center";
                            printCtx.textBaseline = "bottom";
                            printCtx.fillText("N", 0, -35 * arrowScale);
                            
                            printCtx.restore();
                        } else {
                            // For 3D mode, capture gizmo and draw canvas directly (synchronous)
                            console.log("[Raster Nav] 3D mode - capturing gizmo...");
                            console.log("[Raster Nav] context has cameraControls:", !!context.cameraControls);
                            try {
                                var gizmoResult = PrintCaptureManager.captureXYZGizmo(context);
                                console.log("[Raster Nav] Gizmo capture result:", gizmoResult ? "success" : "null");
                                if (gizmoResult && gizmoResult.canvas) {
                                    var navX = (navCell.x + (navCell.width - navSizeMM) / 2) * mmToPx;
                                    var navY = (navCell.y + (navCell.height - navSizeMM) / 2) * mmToPx;
                                    
                                    // Draw canvas directly - this is synchronous!
                                    console.log("[Raster Nav] Drawing gizmo canvas at:", navX, navY, "size:", navSize);
                                    printCtx.drawImage(gizmoResult.canvas, navX, navY, navSize, navSize);
                                    console.log("[Raster Nav] Gizmo drawn successfully");
                                } else {
                                    // Fallback text for 3D
                                    console.log("[Raster Nav] No gizmo canvas, drawing fallback text");
                                    printCtx.fillStyle = "#000000";
                                    printCtx.font = "bold " + (20 * mmToPx / 3) + "px Arial";
                                    printCtx.textAlign = "center";
                                    printCtx.textBaseline = "middle";
                                    printCtx.fillText("XYZ", navCenterX, navCenterY);
                                }
                            } catch (e) {
                                console.warn("Failed to capture XYZ gizmo:", e);
                                printCtx.fillStyle = "#000000";
                                printCtx.font = "bold " + (20 * mmToPx / 3) + "px Arial";
                                printCtx.textAlign = "center";
                                printCtx.textBaseline = "middle";
                                printCtx.fillText("XYZ", navCenterX, navCenterY);
                            }
                        }
                    }
                    
                    // Step 11n) Draw footer content (matching vector PDF)
                    var getVoronoiMetrics = context.getVoronoiMetrics;
                    
                    // Helper: hex to rgb
                    function hexToRgb(hex) {
                        if (!hex || typeof hex !== "string") return { r: 0, g: 0, b: 0 };
                        hex = hex.replace("#", "");
                        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
                        var r = parseInt(hex.substring(0, 2), 16);
                        var g = parseInt(hex.substring(2, 4), 16);
                        var b = parseInt(hex.substring(4, 6), 16);
                        return isNaN(r) ? { r: 0, g: 0, b: 0 } : { r: r, g: g, b: b };
                    }
                    
                    // Helper: get contrast color
                    function getContrastColor(bgColor) {
                        var rgb = hexToRgb(bgColor);
                        var luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
                        return luminance < 0.5 ? "#ffffff" : "#000000";
                    }
                    
                    // Step 11n1) Draw Connector Count (actual connectors grouped by delay)
                    var connectorCell = layoutMgr.getConnectorCountCell();
                    if (connectorCell && allBlastHoles && allBlastHoles.length > 0) {
                        try {
                            var stats = getBlastStatisticsPerEntity(allBlastHoles);
                            var entityNames = Object.keys(stats);

                            // Draw header
                            printCtx.fillStyle = "#000000";
                            printCtx.font = "bold " + (9 * mmToPx / 3) + "px Arial";
                            printCtx.textAlign = "center";
                            printCtx.fillText("CONNECTOR COUNT", (connectorCell.x + connectorCell.width / 2) * mmToPx, (connectorCell.y + 4) * mmToPx);

                            // Draw connector groups as colored rows (actual connectors, not all holes)
                            var rowY = connectorCell.y + 9;
                            var rowHeight = 3.5;
                            var padding = 1;

                            for (var e = 0; e < entityNames.length; e++) {
                                var entityStats = stats[entityNames[e]];
                                if (entityStats && entityStats.connectorGroups) {
                                    var delays = Object.keys(entityStats.connectorGroups).sort(function(a, b) {
                                        if (a === "Unknown") return 1;
                                        if (b === "Unknown") return -1;
                                        return parseFloat(a) - parseFloat(b);
                                    });

                                    for (var d = 0; d < delays.length && rowY < connectorCell.y + connectorCell.height - 3; d++) {
                                        var delay = delays[d];
                                        var group = entityStats.connectorGroups[delay];
                                        var bgColor = group.color || "#ffffff";
                                        var txtColor = getContrastColor(bgColor);
                                        
                                        // Draw colored background
                                        var bgRgb = hexToRgb(bgColor);
                                        printCtx.fillStyle = "rgb(" + bgRgb.r + "," + bgRgb.g + "," + bgRgb.b + ")";
                                        printCtx.fillRect((connectorCell.x + padding) * mmToPx, rowY * mmToPx, (connectorCell.width - padding * 2) * mmToPx, rowHeight * mmToPx);
                                        
                                        // Draw text
                                        var delayText = delay === "Unknown" ? "Unk" : delay + "ms";
                                        printCtx.fillStyle = txtColor;
                                        printCtx.font = (7 * mmToPx / 3) + "px Arial";
                                        printCtx.textAlign = "left";
                                        printCtx.fillText(delayText + ": " + group.count, (connectorCell.x + padding + 1) * mmToPx, (rowY + 2.5) * mmToPx);
                                        
                                        rowY += rowHeight + 0.5;
                                    }
                                }
                            }
                        } catch (e) {
                            printCtx.fillStyle = "#000000";
                            printCtx.font = "bold " + (9 * mmToPx / 3) + "px Arial";
                            printCtx.textAlign = "center";
                            printCtx.fillText("CONNECTOR COUNT", (connectorCell.x + connectorCell.width / 2) * mmToPx, (connectorCell.y + connectorCell.height / 2) * mmToPx);
                        }
                    } else if (connectorCell) {
                        printCtx.fillStyle = "#000000";
                        printCtx.font = "bold " + (9 * mmToPx / 3) + "px Arial";
                        printCtx.textAlign = "center";
                        printCtx.fillText("CONNECTOR COUNT", (connectorCell.x + connectorCell.width / 2) * mmToPx, (connectorCell.y + connectorCell.height / 2) * mmToPx);
                    }
                    
                    // Step 11n2) Draw Blast Statistics
                    var statsCell = layoutMgr.getBlastStatisticsCell();
                    if (statsCell && allBlastHoles && allBlastHoles.length > 0) {
                        try {
                            var blastStats = getBlastStatisticsPerEntity(allBlastHoles);
                            var entityKeys = Object.keys(blastStats);
                            
                            // Draw header
                            printCtx.fillStyle = "#000000";
                            printCtx.font = "bold " + (9 * mmToPx / 3) + "px Arial";
                            printCtx.textAlign = "center";
                            printCtx.fillText("BLAST STATISTICS", (statsCell.x + statsCell.width / 2) * mmToPx, (statsCell.y + 4) * mmToPx);
                            
                            // Draw statistics
                            var statY = statsCell.y + 9;
                            var lineHeight = 3;
                            printCtx.font = (7 * mmToPx / 3) + "px Arial";
                            printCtx.textAlign = "left";
                            
                            for (var ek = 0; ek < entityKeys.length && statY < statsCell.y + statsCell.height - 3; ek++) {
                                var es = blastStats[entityKeys[ek]];
                                if (es) {
                                    printCtx.fillText("Holes: " + es.holeCount, (statsCell.x + 2) * mmToPx, statY * mmToPx);
                                    statY += lineHeight;
                                    if (statY < statsCell.y + statsCell.height - 3) {
                                        printCtx.fillText("Burden: " + es.burden.toFixed(2) + "m", (statsCell.x + 2) * mmToPx, statY * mmToPx);
                                        statY += lineHeight;
                                    }
                                    if (statY < statsCell.y + statsCell.height - 3) {
                                        printCtx.fillText("Spacing: " + es.spacing.toFixed(2) + "m", (statsCell.x + 2) * mmToPx, statY * mmToPx);
                                        statY += lineHeight;
                                    }
                                    if (statY < statsCell.y + statsCell.height - 3) {
                                        printCtx.fillText("Drill: " + es.drillMetres.toFixed(1) + "m", (statsCell.x + 2) * mmToPx, statY * mmToPx);
                                        statY += lineHeight;
                                    }
                                    if (statY < statsCell.y + statsCell.height - 3) {
                                        printCtx.fillText("Volume: " + es.volume.toFixed(0) + "m3", (statsCell.x + 2) * mmToPx, statY * mmToPx);
                                        statY += lineHeight;
                                    }
                                }
                            }
                        } catch (e) {
                            printCtx.fillStyle = "#000000";
                            printCtx.font = "bold " + (9 * mmToPx / 3) + "px Arial";
                            printCtx.textAlign = "center";
                            printCtx.fillText("BLAST STATISTICS", (statsCell.x + statsCell.width / 2) * mmToPx, (statsCell.y + statsCell.height / 2) * mmToPx);
                        }
                    } else if (statsCell) {
                        printCtx.fillStyle = "#000000";
                        printCtx.font = "bold " + (9 * mmToPx / 3) + "px Arial";
                        printCtx.textAlign = "center";
                        printCtx.fillText("BLAST STATISTICS", (statsCell.x + statsCell.width / 2) * mmToPx, (statsCell.y + statsCell.height / 2) * mmToPx);
                    }

                    // Step 11n2b) Draw Legend in legend cell
                    var legendCell = layoutMgr.getLegendCell();
                    if (legendCell) {
                        var activeLegends = getActiveLegends();

                        // Draw header
                        printCtx.fillStyle = "#000000";
                        printCtx.font = "bold " + (9 * mmToPx / 3) + "px Arial";
                        printCtx.textAlign = "center";
                        printCtx.fillText("LEGEND", (legendCell.x + legendCell.width / 2) * mmToPx, (legendCell.y + 4) * mmToPx);

                        var legendY = legendCell.y + 8;
                        var legendRowHeight = 3;
                        var legendPadding = 1.5;
                        var swatchSize = 2.5;

                        if (activeLegends) {
                            // Draw Slope Legend
                            if (activeLegends.slope && activeLegends.slope.items && activeLegends.slope.items.length > 0) {
                                printCtx.font = "bold " + (6 * mmToPx / 3) + "px Arial";
                                printCtx.textAlign = "left";
                                printCtx.fillStyle = "#000000";
                                printCtx.fillText("Slope", (legendCell.x + legendPadding) * mmToPx, legendY * mmToPx);
                                legendY += legendRowHeight;

                                for (var si = 0; si < activeLegends.slope.items.length && legendY < legendCell.y + legendCell.height - 2; si++) {
                                    var sItem = activeLegends.slope.items[si];
                                    // Draw color swatch
                                    printCtx.fillStyle = sItem.color || "#888";
                                    printCtx.fillRect((legendCell.x + legendPadding) * mmToPx, (legendY - swatchSize * 0.7) * mmToPx, swatchSize * mmToPx, swatchSize * mmToPx);
                                    // Draw label
                                    printCtx.fillStyle = "#000000";
                                    printCtx.font = (5 * mmToPx / 3) + "px Arial";
                                    printCtx.fillText(sItem.label || "", (legendCell.x + legendPadding + swatchSize + 1) * mmToPx, legendY * mmToPx);
                                    legendY += legendRowHeight * 0.8;
                                }
                                legendY += legendRowHeight * 0.5;
                            }

                            // Draw Relief Legend
                            if (activeLegends.relief && activeLegends.relief.items && activeLegends.relief.items.length > 0) {
                                printCtx.font = "bold " + (6 * mmToPx / 3) + "px Arial";
                                printCtx.textAlign = "left";
                                printCtx.fillStyle = "#000000";
                                printCtx.fillText("Relief", (legendCell.x + legendPadding) * mmToPx, legendY * mmToPx);
                                legendY += legendRowHeight;

                                for (var ri = 0; ri < activeLegends.relief.items.length && legendY < legendCell.y + legendCell.height - 2; ri++) {
                                    var rItem = activeLegends.relief.items[ri];
                                    // Draw color swatch
                                    printCtx.fillStyle = rItem.color || "#888";
                                    printCtx.fillRect((legendCell.x + legendPadding) * mmToPx, (legendY - swatchSize * 0.7) * mmToPx, swatchSize * mmToPx, swatchSize * mmToPx);
                                    // Draw label
                                    printCtx.fillStyle = "#000000";
                                    printCtx.font = (5 * mmToPx / 3) + "px Arial";
                                    printCtx.fillText(rItem.label || "", (legendCell.x + legendPadding + swatchSize + 1) * mmToPx, legendY * mmToPx);
                                    legendY += legendRowHeight * 0.8;
                                }
                                legendY += legendRowHeight * 0.5;
                            }

                            // Draw Voronoi Legend (gradient)
                            if (activeLegends.voronoi && activeLegends.voronoi.title) {
                                printCtx.font = "bold " + (6 * mmToPx / 3) + "px Arial";
                                printCtx.textAlign = "left";
                                printCtx.fillStyle = "#000000";
                                printCtx.fillText(activeLegends.voronoi.title, (legendCell.x + legendPadding) * mmToPx, legendY * mmToPx);
                                legendY += legendRowHeight;

                                // Draw gradient bar
                                var gradientWidth = (legendCell.width - legendPadding * 2) * 0.6;
                                var gradientHeight = 2.5;
                                var gradX = (legendCell.x + legendPadding) * mmToPx;
                                var gradY = legendY * mmToPx;

                                if (activeLegends.voronoi.colorStops && activeLegends.voronoi.colorStops.length > 0) {
                                    var gradient = printCtx.createLinearGradient(gradX, gradY, gradX + gradientWidth * mmToPx, gradY);
                                    for (var cs = 0; cs < activeLegends.voronoi.colorStops.length; cs++) {
                                        var stop = activeLegends.voronoi.colorStops[cs];
                                        gradient.addColorStop(stop.position || cs / (activeLegends.voronoi.colorStops.length - 1), stop.color || "#888");
                                    }
                                    printCtx.fillStyle = gradient;
                                } else {
                                    printCtx.fillStyle = "#888";
                                }
                                printCtx.fillRect(gradX, gradY, gradientWidth * mmToPx, gradientHeight * mmToPx);

                                // Draw min/max labels
                                printCtx.fillStyle = "#000000";
                                printCtx.font = (5 * mmToPx / 3) + "px Arial";
                                printCtx.textAlign = "left";
                                var minLabel = activeLegends.voronoi.minVal !== undefined ? activeLegends.voronoi.minVal.toFixed(1) : "Min";
                                var maxLabel = activeLegends.voronoi.maxVal !== undefined ? activeLegends.voronoi.maxVal.toFixed(1) : "Max";
                                printCtx.fillText(minLabel, gradX, (legendY + gradientHeight + 2) * mmToPx);
                                printCtx.textAlign = "right";
                                printCtx.fillText(maxLabel, gradX + gradientWidth * mmToPx, (legendY + gradientHeight + 2) * mmToPx);

                                legendY += gradientHeight + legendRowHeight * 1.5;
                            }

                            // Draw Surface Legends
                            if (activeLegends.surfaces && activeLegends.surfaces.length > 0) {
                                printCtx.font = "bold " + (6 * mmToPx / 3) + "px Arial";
                                printCtx.textAlign = "left";
                                printCtx.fillStyle = "#000000";
                                printCtx.fillText("Surfaces", (legendCell.x + legendPadding) * mmToPx, legendY * mmToPx);
                                legendY += legendRowHeight;

                                for (var surf = 0; surf < activeLegends.surfaces.length && legendY < legendCell.y + legendCell.height - 2; surf++) {
                                    var surfData = activeLegends.surfaces[surf];
                                    if (surfData && surfData.name) {
                                        printCtx.fillStyle = "#000000";
                                        printCtx.font = (5 * mmToPx / 3) + "px Arial";
                                        printCtx.fillText(surfData.name.substring(0, 15), (legendCell.x + legendPadding) * mmToPx, legendY * mmToPx);
                                        legendY += legendRowHeight * 0.8;
                                    }
                                }
                            }
                        }
                    }

                    // Step 11n3) Draw Logo/QR code using pre-loaded image
                    var logoCell = layoutMgr.getLogoCell();
                    if (logoCell) {
                        // Use pre-loaded QR code image
                        if (preloadedQRCode && preloadedQRCode.complete && preloadedQRCode.naturalWidth > 0) {
                            var qrSize = Math.min(logoCell.width, logoCell.height) * 0.6 * mmToPx;
                            var qrX = (logoCell.x + (logoCell.width - logoCell.width * 0.6) / 2) * mmToPx;
                            var qrY = (logoCell.y + (logoCell.height - logoCell.height * 0.6) / 2 - 2) * mmToPx;
                            try {
                                printCtx.drawImage(preloadedQRCode, qrX, qrY, qrSize, qrSize);
                            } catch (e) {
                                console.warn("Could not draw QR code:", e);
                            }
                        }
                        
                        // URL below
                        printCtx.fillStyle = "#000000";
                        printCtx.font = (5 * mmToPx / 3) + "px Arial";
                        printCtx.textAlign = "center";
                        printCtx.fillText("blastingapps.com", (logoCell.x + logoCell.width / 2) * mmToPx, (logoCell.y + logoCell.height - 2) * mmToPx);
                    }
                    
                    // Step 11n4) Title block rows (no square braces)
                    printCtx.fillStyle = "#000000";
                    for (var tr = 0; tr < titleBlockRows.length; tr++) {
                        var trow = titleBlockRows[tr];
                        printCtx.textAlign = "left";
                        
                        if (trow.id === "title") {
                            printCtx.font = "bold " + (10 * mmToPx / 3) + "px Arial";
                            printCtx.fillText("TITLE", (trow.x + 2) * mmToPx, (trow.y + trow.height * 0.35) * mmToPx);
                            var blastNames = [];
                            if (allBlastHoles) {
                                allBlastHoles.forEach(function(hole) {
                                    if (hole.entityName && blastNames.indexOf(hole.entityName) === -1) {
                                        blastNames.push(hole.entityName);
                                    }
                                });
                            }
                            var displayName = blastNames.join(", ") || userInput.blastName || "Untitled";
                            printCtx.font = (8 * mmToPx / 3) + "px Arial";
                            printCtx.fillText(displayName, (trow.x + 2) * mmToPx, (trow.y + trow.height * 0.7) * mmToPx);
                        } else if (trow.id === "date") {
                            printCtx.font = "bold " + (8 * mmToPx / 3) + "px Arial";
                            printCtx.fillText("DATE", (trow.x + 2) * mmToPx, (trow.y + trow.height * 0.35) * mmToPx);
                            var now = new Date();
                            var dateStr = now.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
                            var timeStr = now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
                            printCtx.font = (7 * mmToPx / 3) + "px Arial";
                            printCtx.fillText(dateStr + " " + timeStr, (trow.x + 2) * mmToPx, (trow.y + trow.height * 0.7) * mmToPx);
                        } else if (trow.id === "scaleDesigner") {
                            printCtx.font = (8 * mmToPx / 3) + "px Arial";
                            printCtx.fillText("Scale: 1:1000", (trow.x + 2) * mmToPx, (trow.y + trow.height * 0.25) * mmToPx);
                            printCtx.fillText("Designer: " + (userInput.designer || ""), (trow.x + 2) * mmToPx, (trow.y + trow.height * 0.65) * mmToPx);
                        }
                    }
                    
                    bar.style.width = "40%";
                    text.textContent = "Drawing data...";

                    setTimeout(function() {
                        // Step 11o) Draw data in print area with clipping to black boundary
                        // Both clipping and data positioning use printArea (mapZone = black template border)
                        printCtx.save();
                        printCtx.beginPath();
                        printCtx.rect(printArea.x, printArea.y, printArea.width, printArea.height);
                        printCtx.clip();
                        
                        // Step 11o1) Check if 3D mode - capture WebGL canvas instead of 2D rendering
                        if (mode === "3D" && context.threeRenderer) {
                            try {
                                // Step 11o2) Get the WebGL canvas and renderer
                                var threeCanvas = context.threeRenderer.getCanvas();
                                var renderer = context.threeRenderer.renderer;
                                
                                if (threeCanvas && renderer) {
                                    // Step 11o3) Get print boundary info for cropping
                                    var boundary3D = get3DPrintBoundary();
                                    var canvasRect = threeCanvas.getBoundingClientRect();
                                    
                                    // High-res multiplier for raster PDF (3x for print quality)
                                    var hiResMultiplier = 3;
                                    
                                    // Save original renderer state
                                    var originalPixelRatio = renderer.getPixelRatio();
                                    var displayWidth = canvasRect.width;
                                    var displayHeight = canvasRect.height;
                                    
                                    // Calculate hi-res dimensions
                                    var hiResWidth = Math.round(displayWidth * hiResMultiplier);
                                    var hiResHeight = Math.round(displayHeight * hiResMultiplier);
                                    
                                    console.log("[3D Raster] Rendering at: " + hiResWidth + "x" + hiResHeight);
                                    
                                    // Resize renderer to high resolution
                                    renderer.setPixelRatio(1);
                                    renderer.setSize(hiResWidth, hiResHeight, false);
                                    
                                    // Update camera projection
                                    var camera = context.threeRenderer.camera;
                                    if (camera && camera.isOrthographicCamera) {
                                        camera.updateProjectionMatrix();
                                    }
                                    
                                    // Force render at high resolution
                                    context.threeRenderer.render();
                                    
                                    var hiResCanvas = renderer.domElement;
                                    
                                    if (boundary3D && boundary3D.width > 0 && boundary3D.height > 0) {
                                        // Scale boundary from display to hi-res coords
                                        var srcX = boundary3D.x * hiResMultiplier;
                                        var srcY = boundary3D.y * hiResMultiplier;
                                        var srcW = boundary3D.width * hiResMultiplier;
                                        var srcH = boundary3D.height * hiResMultiplier;
                                        
                                        // Step 11o4) Draw cropped hi-res 3D view into print area
                                        printCtx.drawImage(
                                            hiResCanvas,
                                            srcX, srcY,
                                            srcW, srcH,
                                            printArea.x, printArea.y,
                                            printArea.width, printArea.height
                                        );
                                    } else {
                                        // No boundary - draw full hi-res canvas into print area
                                        printCtx.drawImage(
                                            hiResCanvas,
                                            0, 0,
                                            hiResCanvas.width, hiResCanvas.height,
                                            printArea.x, printArea.y,
                                            printArea.width, printArea.height
                                        );
                                    }
                                    
                                    // Restore original renderer size
                                    renderer.setPixelRatio(originalPixelRatio);
                                    renderer.setSize(displayWidth, displayHeight, false);
                                    context.threeRenderer.render();
                                    
                                    console.log("[3D Raster] Renderer restored");
                                }
                            } catch (e) {
                                console.warn("Failed to capture 3D view for raster PDF:", e);
                            }
                        } else {
                            // 2D mode - use existing drawDataForPrinting function
                            // Add activeLegends to context for legend rendering
                            context.activeLegends = getActiveLegends();
                            drawDataForPrinting(printCtx, printArea, context);
                        }
                        
                        printCtx.restore();

						bar.style.width = "80%";
                        text.textContent = "Generating image...";

                        setTimeout(function() {
                            // Step 11p) Generate PDF
                            var imgData = printCanvas.toDataURL("image/png", 1.0);

                            if (!imgData || imgData.length < 100 || imgData === "data:,") {
                                throw new Error("Failed to generate canvas image.");
                            }

                            var orientation = printOrientation === "landscape" ? "l" : "p";
                            var pdf = new jsPDF(orientation, "mm", printPaperSize.toLowerCase());
                            pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
                            // Use user-provided filename or auto-generated default
                            var saveFileName = userInput.fileName ? userInput.fileName + ".pdf" : "kirra-blast-raster-" + new Date().toISOString().split("T")[0] + ".pdf";
                            pdf.save(saveFileName);

						bar.style.width = "100%";
                            text.textContent = "Complete!";

                            setTimeout(function() {
							progressDialog.close();
                                showModalMessage("Success", "Raster PDF created successfully!", "success");
						}, 300);
                        }, 100);
                    }, 100);
					} catch (error) {
                    progressDialog.close();
                    console.error("PDF Generation Error:", error);
                    showModalMessage("PDF Creation Failed", "Error: " + error.message, "error");
                }
            }, 250);
        } catch (error) {
						progressDialog.close();
            console.error("PDF Generation Error:", error);
            showModalMessage("PDF Creation Failed", "Error: " + error.message, "error");
        }
    } // end startRasterRendering
}

// Step 12) Deprecated function kept for backward compatibility
export function printCanvasHiResRaster(context) {
    printCanvasHiRes(context);
}

// ============== UI EVENT HANDLERS ==============

// Step 13) Change paper size
export function changePaperSize(drawDataCallback) {
    var paperSizeSelect = document.getElementById("paperSize");
    if (paperSizeSelect) {
        printPaperSize = paperSizeSelect.value;
        cachedLayoutManager = null;
        if (printMode && drawDataCallback) {
            drawDataCallback(); // Redraw with new paper size
        }
    }
}

// Step 14) Change orientation
export function changeOrientation(drawDataCallback) {
    var orientationSelect = document.getElementById("orientation");
    if (orientationSelect) {
        printOrientation = orientationSelect.value;
        cachedLayoutManager = null;
        if (printMode && drawDataCallback) {
            drawDataCallback(); // Redraw with new orientation
        }
    }
}

// Step 15) Toggle print preview mode
export function togglePrintMode(updateStatusMessageCallback, drawDataCallback) {
    printMode = !printMode;

    // Sync the checkbox state
    var toggle = document.getElementById("addPrintPreviewToggle");
    if (toggle) toggle.checked = printMode;

    // Detect current mode
    var dimension2D3DBtn = document.getElementById("dimension2D-3DBtn");
    var isIn3DMode = dimension2D3DBtn && dimension2D3DBtn.checked === true;

    if (printMode) {
        // Entering print preview mode
        if (isIn3DMode) {
            // 3D mode - show overlay
            if (window.threeRenderer) {
                toggle3DPrintPreview(true, printPaperSize, printOrientation, window.threeRenderer);
                if (updateStatusMessageCallback) {
                    updateStatusMessageCallback("3D Print Preview Mode ON - Template shows what will be printed");
                }
            }
        } else {
            // 2D mode - redraw with template preview
            if (updateStatusMessageCallback) {
                updateStatusMessageCallback("Print Preview Mode ON - Position elements within the map zone");
            }
            if (drawDataCallback) {
                drawDataCallback();
            }
        }
    } else {
        // Exiting print preview mode
        if (isIn3DMode) {
            remove3DPrintBoundaryOverlay();
            if (updateStatusMessageCallback) {
                updateStatusMessageCallback("3D Print Preview Mode OFF");
            }
        } else {
            if (updateStatusMessageCallback) {
                updateStatusMessageCallback("Print Preview Mode OFF");
            }
            if (drawDataCallback) {
                drawDataCallback();
            }
        }
    }
}

// Step 16) Setup print event handlers
export function setupPrintEventHandlers(contextOrGetter) {
	// If it's a function, call it to get context; otherwise use it directly
    var getContext = typeof contextOrGetter === "function" ? contextOrGetter : function() { return contextOrGetter; };

    var printPreviewToggle = document.getElementById("addPrintPreviewToggle");
	if (printPreviewToggle) {
        printPreviewToggle.addEventListener("change", function() {
            var ctx = getContext();
			togglePrintMode(ctx.updateStatusMessage, ctx.drawData);
		});
	}

    var paperSizeSelect = document.getElementById("paperSize");
	if (paperSizeSelect) {
        paperSizeSelect.addEventListener("change", function() {
            var ctx = getContext();
			changePaperSize(ctx.drawData);
		});
	}

    var orientationSelect = document.getElementById("orientation");
	if (orientationSelect) {
        orientationSelect.addEventListener("change", function() {
            var ctx = getContext();
			changeOrientation(ctx.drawData);
		});
	}

    var printToPDFBtn = document.getElementById("printToPDFBtn");
	if (printToPDFBtn) {
        printToPDFBtn.addEventListener("click", function() {
            var context = getContext();
            var printContext = {
				allBlastHoles: context.allBlastHoles,
				allKADDrawingsMap: context.allKADDrawingsMap,
				allAvailableSurfaces: context.allAvailableSurfaces,
				loadedSurfaces: context.loadedSurfaces,
				loadedImages: context.loadedImages,
				selectedHole: context.selectedHole,
				canvas: context.canvas,
				currentScale: context.currentScale,
				centroidX: context.centroidX,
				centroidY: context.centroidY,
                currentRotation: context.currentRotation,
				imageVisible: context.imageVisible,
				surfaceVisible: context.surfaceVisible,
				getDisplayOptions: context.getDisplayOptions,
				buildHoleMap: context.buildHoleMap,
				developerModeEnabled: context.developerModeEnabled,
				simplifyByPxDist: context.simplifyByPxDist,
				worldToCanvas: context.worldToCanvas,
				delaunayTriangles: context.delaunayTriangles,
				maxEdgeLength: context.maxEdgeLength,
				createBlastBoundaryPolygon: context.createBlastBoundaryPolygon,
				offsetPolygonClipper: context.offsetPolygonClipper,
				getAverageDistance: context.getAverageDistance,
				selectedVoronoiMetric: context.selectedVoronoiMetric,
				isVoronoiLegendFixed: context.isVoronoiLegendFixed,
				getVoronoiMetrics: context.getVoronoiMetrics,
				useToeLocation: context.useToeLocation,
				clipVoronoiCells: context.clipVoronoiCells,
				getPFColor: context.getPFColor,
				getMassColor: context.getMassColor,
				getVolumeColor: context.getVolumeColor,
				getAreaColor: context.getAreaColor,
				getLengthColor: context.getLengthColor,
				getHoleFiringTimeColor: context.getHoleFiringTimeColor,
				strokeColor: context.strokeColor,
				directionArrows: context.directionArrows,
				contourLinesArray: context.contourLinesArray,
				firstMovementSize: context.firstMovementSize,
				currentFontSize: context.currentFontSize,
				holeScale: context.holeScale,
				transparentFillColor: context.transparentFillColor,
				textFillColor: context.textFillColor,
				fillColor: context.fillColor,
				depthColor: context.depthColor,
				angleDipColor: context.angleDipColor,
                darkModeEnabled: context.darkModeEnabled,
				isAddingConnector: context.isAddingConnector,
				isAddingMultiConnector: context.isAddingMultiConnector,
				fromHoleStore: context.fromHoleStore,
				firstSelectedHole: context.firstSelectedHole,
				secondSelectedHole: context.secondSelectedHole,
				selectedMultipleHoles: context.selectedMultipleHoles,
				showSurfaceLegend: context.showSurfaceLegend,
				elevationToColor: context.elevationToColor,
				currentGradient: context.currentGradient,
				surfaceTextureData: context.surfaceTextureData,
				buildVersion: context.buildVersion,
				showModalMessage: context.showModalMessage,
				FloatingDialog: context.FloatingDialog,
                threeRenderer: context.threeRenderer,
                cameraControls: context.cameraControls,
				getDipAngle: context.getDipAngle,
				calculateTriangleCentroid: context.calculateTriangleCentroid,
				getBurdenRelief: context.getBurdenRelief
			};
			printToPDF(printContext);
		});
	}

	var printFromTemplateBtn = document.getElementById("printFromTemplateBtn");
	if (printFromTemplateBtn) {
		printFromTemplateBtn.addEventListener("click", function () {
			if (typeof window.showTemplatePrintDialog === "function") {
				var ctx = getContext();
				window.showTemplatePrintDialog({
					scale: printCanvas ? printCanvas.scale : 0,
					context: ctx
				});
			}
		});
	}
}

// #endregion PRINT

