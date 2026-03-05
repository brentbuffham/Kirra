///------------------ PRINT RENDERING FUNCTIONS ------------------///

import { printCanvas, printCtx, getPrintBoundary, printMode } from "./PrintSystem.js";
import * as SVG from "./SVGBuilder.js";
import { buildMassLabels } from "../draw/canvas2DDrawing.js";

const magnifyFont = 1.7;

export function drawDataForPrinting(printCtx, printArea, context) {
    // --- WYSIWYG LOGIC: Render exactly what's in the print boundary ---
    const {
        canvas,
        allBlastHoles,
        selectedHole,
        currentScale: originalScale,
        centroidX: originalCentroidX,
        centroidY: originalCentroidY,
        imageVisible: originalImageVisible,
        surfaceVisible: originalSurfaceVisible
    } = context;

    // Step 1) Get the on-screen print preview boundary
    const screenBoundary = getPrintBoundary(canvas);
    if (!screenBoundary) {
        throw new Error("Print Preview Mode must be active to generate a WYSIWYG print.");
    }

    // Step 2) Use the inner boundary for coordinate transformation
    // This is the area where data should be positioned (inside the black template border)
    const innerBoundary = {
        x: screenBoundary.innerX !== undefined ? screenBoundary.innerX : screenBoundary.x + screenBoundary.width * screenBoundary.marginPercent,
        y: screenBoundary.innerY !== undefined ? screenBoundary.innerY : screenBoundary.y + screenBoundary.height * screenBoundary.marginPercent,
        width: screenBoundary.innerWidth !== undefined ? screenBoundary.innerWidth : screenBoundary.width * (1 - 2 * screenBoundary.marginPercent),
        height: screenBoundary.innerHeight !== undefined ? screenBoundary.innerHeight : screenBoundary.height * (1 - 2 * screenBoundary.marginPercent)
    };

    // Step 3) Convert the inner boundary to world coordinates
    // This represents exactly what the user sees in the data area
    const world_x1 = (innerBoundary.x - canvas.width / 2) / originalScale + originalCentroidX;
    const world_y1 = -(innerBoundary.y + innerBoundary.height - canvas.height / 2) / originalScale + originalCentroidY;
    const world_x2 = (innerBoundary.x + innerBoundary.width - canvas.width / 2) / originalScale + originalCentroidX;
    const world_y2 = -(innerBoundary.y - canvas.height / 2) / originalScale + originalCentroidY;

    const minX = Math.min(world_x1, world_x2);
    const maxX = Math.max(world_x1, world_x2);
    const minY = Math.min(world_y1, world_y2);
    const maxY = Math.max(world_y1, world_y2);

    // Step 4) Calculate the scale to fit this world view into the PDF's printArea
    const dataWidth = maxX - minX;
    const dataHeight = maxY - minY;
    if (dataWidth <= 0 || dataHeight <= 0) return;

    const scaleX = printArea.width / dataWidth;
    const scaleY = printArea.height / dataHeight;
    const printScale = Math.min(scaleX, scaleY);

    const scaledWidth = dataWidth * printScale;
    const scaledHeight = dataHeight * printScale;
    // Center the scaled data within the printArea, accounting for printArea's x/y offset
    const offsetX = printArea.x + (printArea.width - scaledWidth) / 2;
    const offsetY = printArea.y + (printArea.height - scaledHeight) / 2;

    const printCentroidX = minX + dataWidth / 2;
    const printCentroidY = minY + dataHeight / 2;

    // Step 5) Create coordinate transformation function
    // This transforms world coordinates to print canvas coordinates
    function worldToPrint(worldX, worldY) {
        // offsetX/Y is the left/top edge of the scaled data area
        // We need to add scaledWidth/2 and scaledHeight/2 to get to the center
        // The center of the scaled data maps to the center of the printArea
        const centerX = offsetX + scaledWidth / 2;
        const centerY = offsetY + scaledHeight / 2;
        const x = (worldX - printCentroidX) * printScale + centerX;
        const y = -(worldY - printCentroidY) * printScale + centerY;
        return [x, y];
    }

    // --- TEMPORARY GLOBAL OVERRIDES ---
    const original_currentScale = originalScale;
    const original_centroidX = originalCentroidX;
    const original_centroidY = originalCentroidY;
    const original_canvas_width = canvas.width;
    const original_canvas_height = canvas.height;
    const original_worldToCanvas = window.worldToCanvas;
    const original_context_worldToCanvas = context.worldToCanvas;
    const original_imageVisible = originalImageVisible;
    const original_surfaceVisible = originalSurfaceVisible;

    // Set globals to print-specific values
    context.currentScale = printScale;
    context.centroidX = printCentroidX;
    context.centroidY = printCentroidY;
    // Don't modify the actual canvas dimensions - use printCanvas dimensions for context
    context.canvasWidth = printCanvas.width;
    context.canvasHeight = printCanvas.height;
    window.worldToCanvas = worldToPrint;
    context.worldToCanvas = worldToPrint; // Also set in context for functions that use it
    context.imageVisible = false;
    context.surfaceVisible = false;

    // --- RENDER EVERYTHING ---
    // Note: Clipping is already applied by PrintSystem.js before calling this function
    // The coordinate transformation handles positioning within the print area
    printData(allBlastHoles, selectedHole, context);

    // --- RESTORE GLOBALS ---
    context.currentScale = original_currentScale;
    context.centroidX = original_centroidX;
    context.centroidY = original_centroidY;
    canvas.width = original_canvas_width;
    canvas.height = original_canvas_height;
    window.worldToCanvas = original_worldToCanvas;
    if (original_context_worldToCanvas !== undefined) {
        context.worldToCanvas = original_context_worldToCanvas;
    }
    context.imageVisible = original_imageVisible;
    context.surfaceVisible = original_surfaceVisible;
}

//----------------- REPLICATION OF THE UX Canvas but for High Resolution Printing ------------------///
export function printVoronoiMetric(metrics, metricName, getColorForMetric) {
    for (let cell of metrics) {
        // Skip if the cell doesn't have a polygon or the metric is null/undefined
        if (!cell.polygon || cell[metricName] == null) continue;

        const color = getColorForMetric(cell[metricName]);

        printCtx.beginPath();
        printCtx.moveTo(cell.polygon[0][0], cell.polygon[0][1]);
        for (let j = 1; j < cell.polygon.length; j++) {
            printCtx.lineTo(cell.polygon[j][0], cell.polygon[j][1]);
        }
        printCtx.closePath();
        printCtx.fillStyle = color;
        printCtx.fill();
    }
}
// Fix printBlastBoundary function
/**
 * @deprecated Use printBlastBoundarySVG() for vector PDF generation
 */
export function printBlastBoundary(polygon, color) {
    // FIX: Use window.worldToCanvas instead of manual coordinate transformation
    const screenCoords = polygon.map((point) => {
        const [x, y] = window.worldToCanvas(point.x, point.y);
        return {
            x,
            y
        };
    });

    printCtx.beginPath();
    printCtx.moveTo(screenCoords[0].x, screenCoords[0].y);
    for (let i = 1; i < screenCoords.length; i++) {
        printCtx.lineTo(screenCoords[i].x, screenCoords[i].y);
    }
    printCtx.closePath();
    printCtx.strokeStyle = color;
    printCtx.lineWidth = 2;
    printCtx.stroke();
}

export function printBlastBoundarySVG(polygon, color) {
    const screenCoords = polygon.map((point) => {
        const [x, y] = window.worldToCanvas(point.x, point.y);
        return {x, y};
    });
    return SVG.createSVGPolyline(screenCoords, "none", color, 2, true);
}

/**
 * @deprecated Use printKADPointsSVG() for vector PDF generation
 */
export function printKADPoints(x, y, z, color) {
    printCtx.beginPath();
    printCtx.arc(x, y, 2, 0, 2 * Math.PI);
    printCtx.strokeStyle = color;
    printCtx.fillStyle = color;
    printCtx.stroke();
    printCtx.fill();
}

export function printKADPointsSVG(x, y, z, color) {
    return SVG.createSVGCircle(x, y, 2, color, color, 1);
}

/**
 * @deprecated Use printKADLinesSVG() for vector PDF generation
 */
export function printKADLines(sx, sy, ex, ey, sz, ez, lineWidth, color) {
    printCtx.beginPath();
    printCtx.moveTo(sx, sy);
    printCtx.lineTo(ex, ey);
    printCtx.strokeStyle = color;
    printCtx.lineWidth = lineWidth;
    printCtx.stroke();
}

export function printKADLinesSVG(sx, sy, ex, ey, sz, ez, lineWidth, color) {
    return SVG.createSVGLine(sx, sy, ex, ey, color, lineWidth);
}

/**
 * @deprecated Use printKADPolysSVG() for vector PDF generation
 */
export function printKADPolys(sx, sy, ex, ey, sz, ez, lineWidth, color, isClosed) {
    printCtx.beginPath();
    printCtx.moveTo(sx, sy);
    printCtx.lineTo(ex, ey);
    printCtx.strokeStyle = color;
    printCtx.lineWidth = lineWidth;
    printCtx.stroke();
    if (isClosed) {
        printCtx.closePath();
    }
}

export function printKADPolysSVG(sx, sy, ex, ey, sz, ez, lineWidth, color, isClosed) {
    return SVG.createSVGPolyline([{x: sx, y: sy}, {x: ex, y: ey}], "none", color, lineWidth, isClosed);
}

/**
 * @deprecated Use printKADCirclesSVG() for vector PDF generation
 */
export function printKADCircles(x, y, z, radius, lineWidth, strokeColor, context) {
    printCtx.strokeStyle = strokeColor;
    printCtx.beginPath();
    // Convert radius from world units to screen pixels
    const radiusInPixels = radius * context.currentScale;
    printCtx.arc(x, y, radiusInPixels, 0, 2 * Math.PI);
    printCtx.lineWidth = lineWidth;
    printCtx.stroke();
}

export function printKADCirclesSVG(x, y, z, radius, lineWidth, strokeColor, context) {
    const radiusInPixels = radius * context.currentScale;
    return SVG.createSVGCircle(x, y, radiusInPixels, "none", strokeColor, lineWidth);
}

/**
 * @deprecated Use printKADTextsSVG() for vector PDF generation
 */
export function printKADTexts(x, y, z, text, color, context) {
    //printCtx.fillStyle = color;
    printCtx.font = parseInt(context.currentFontSize * magnifyFont - 2) + "px Arial";
    printMultilineText(printCtx, text, x, y, context.currentFontSize * magnifyFont, "left", color, color, false);
}

export function printKADTextsSVG(x, y, z, text, color, context) {
    const fontSize = parseInt(context.currentFontSize * magnifyFont - 2);
    const lines = text.split("\n");
    let svgText = "";
    const lineHeight = context.currentFontSize * magnifyFont;
    for (let i = 0; i < lines.length; i++) {
        svgText += SVG.createSVGText(x, y + i * lineHeight, lines[i], color, fontSize + "", "Arial", "normal", "start", "auto");
    }
    return svgText;
}

/**
 * @deprecated Use printTrackSVG() for vector PDF generation
 * Kept for backward compatibility with raster PDF generation
 */
export function printTrack(lineStartX, lineStartY, lineEndX, lineEndY, gradeX, gradeY, color, subdrillAmount) {
    printCtx.lineWidth = 1;
    const printColor = "black";

    if (subdrillAmount < 0) {
        // NEGATIVE SUBDRILL: Draw only from start to toe (bypass grade)
        // Use 20% opacity for the entire line since it represents "over-drilling"
        printCtx.beginPath();
        printCtx.strokeStyle = printColor;
        printCtx.moveTo(lineStartX, lineStartY);
        printCtx.lineTo(lineEndX, lineEndY);
        printCtx.stroke();
        // Draw from grade to toe (subdrill portion - red)
        printCtx.beginPath();
        printCtx.strokeStyle = "rgba(255, 0, 0, 0.2)"; // Red line (full opacity)
        printCtx.moveTo(lineEndX, lineEndY);
        printCtx.lineTo(gradeX, gradeY);
        printCtx.stroke();
        // Draw grade marker with 20% opacity
        printCtx.beginPath();
        printCtx.arc(gradeX, gradeY, 3, 0, 2 * Math.PI);
        printCtx.fillStyle = `rgba(255, 0, 0, 0.2)`; // Red marker with 20% opacity
        printCtx.fill();
    } else {
        // POSITIVE SUBDRILL: Draw from start to grade (dark), then grade to toe (red)

        // Draw from start to grade point (bench drill portion - dark)
        printCtx.beginPath();
        printCtx.strokeStyle = printColor; // Dark line (full opacity)
        printCtx.moveTo(lineStartX, lineStartY);
        printCtx.lineTo(gradeX, gradeY);
        printCtx.stroke();

        // Draw from grade to toe (subdrill portion - red)
        printCtx.beginPath();
        printCtx.strokeStyle = "rgba(255, 0, 0, 1.0)"; // Red line (full opacity)
        printCtx.moveTo(gradeX, gradeY);
        printCtx.lineTo(lineEndX, lineEndY);
        printCtx.stroke();

        // Draw grade marker (full opacity)
        printCtx.beginPath();
        printCtx.arc(gradeX, gradeY, 3, 0, 2 * Math.PI);
        printCtx.fillStyle = "rgba(255, 0, 0, 1.0)"; // Red marker (full opacity)
        printCtx.fill();
    }
}

/**
 * @deprecated Use printHoleToeSVG() for vector PDF generation
 */
export function printHoleToe(x, y, fillColor, strokeColor, radius) {
    printCtx.beginPath();
    // Use the toeSizeInMeters directly to set the radius
    printCtx.lineWidth = 1;
    printCtx.arc(x, y, radius, 0, 2 * Math.PI);
    printCtx.fillStyle = fillColor;
    printCtx.strokeStyle = "black";
    printCtx.stroke();
    printCtx.fill();
}

export function printHoleToeSVG(x, y, fillColor, strokeColor, radius) {
    return SVG.createSVGCircle(x, y, radius, fillColor, "black", 1);
}

/**
 * @deprecated Use printHoleSVG() for vector PDF generation
 */
export function printHole(x, y, radius, strokeColor) {
    printCtx.strokeStyle = "black";
    printCtx.fillStyle = "black";
    printCtx.lineWidth = 1;
    printCtx.beginPath();
    const minRadius = 1.5;
    const drawRadius = radius > minRadius ? radius : minRadius;
    printCtx.arc(x, y, drawRadius, 0, 2 * Math.PI);
    printCtx.fill(); // fill the circle with the fill color
    printCtx.stroke(); // draw the circle border with the stroke color
}

export function printHoleSVG(x, y, radius, strokeColor) {
    const minRadius = 1.5;
    const drawRadius = radius > minRadius ? radius : minRadius;
    return SVG.createSVGCircle(x, y, drawRadius, "black", "black", 1);
}

export function printDummy(x, y, radius, strokeColor) {
    printCtx.strokeStyle = "black";
    printCtx.lineWidth = 2; // Adjust the line width as needed
    printCtx.beginPath();
    printCtx.moveTo(x - radius, y - radius);
    printCtx.lineTo(x + radius, y + radius);
    printCtx.moveTo(x - radius, y + radius);
    printCtx.lineTo(x + radius, y - radius);
    printCtx.stroke();
}

export function printNoDiameterHole(x, y, sideLength, strokeColor) {
    printCtx.strokeStyle = "black";
    printCtx.lineWidth = 2; // Adjust the line width as needed
    const halfSide = sideLength / 2;
    printCtx.beginPath();
    printCtx.moveTo(x - halfSide, y - halfSide);
    printCtx.lineTo(x + halfSide, y - halfSide);
    printCtx.lineTo(x + halfSide, y + halfSide);
    printCtx.lineTo(x - halfSide, y + halfSide);
    printCtx.closePath(); // Close the path to form a square
    printCtx.stroke();
}

export function printHiHole(x, y, radius, fillColor, strokeColor) {
    printCtx.strokeStyle = strokeColor;
    printCtx.beginPath();
    printCtx.arc(x, y, radius, 0, 2 * Math.PI);
    printCtx.fillStyle = fillColor;
    printCtx.fill(); // fill the circle with the fill color
    printCtx.lineWidth = 5;
    printCtx.stroke(); // draw the circle border with the stroke color
}

/**
 * @deprecated Use printTextSVG() for vector PDF generation
 */
export function printText(x, y, text, color, context) {
    printCtx.font = parseInt(context.currentFontSize * magnifyFont - 2) + "px Arial";
    printCtx.fillStyle = color;
    printCtx.fillText(text, x, y);
}

export function printTextSVG(x, y, text, color, context) {
    const fontSize = parseInt(context.currentFontSize * magnifyFont - 2);
    return SVG.createSVGText(x, y, text, color, fontSize + "", "Arial", "normal", "start", "auto");
}

/**
 * @deprecated Use printRightAlignedTextSVG() for vector PDF generation
 */
export function printRightAlignedText(x, y, text, color, context) {
    printCtx.font = parseInt(context.currentFontSize * magnifyFont - 2) + "px Arial";
    const textWidth = printCtx.measureText(text).width;
    printCtx.fillStyle = color;
    // Draw the text at an x position minus the text width for right alignment
    printText(x - textWidth, y, text, color, context);
}

export function printRightAlignedTextSVG(x, y, text, color, context) {
    const fontSize = parseInt(context.currentFontSize * magnifyFont - 2);
    // Approximate text width (rough estimate: 0.6 * fontSize * text.length)
    const textWidth = fontSize * 0.6 * text.length;
    return SVG.createSVGText(x - textWidth, y, text, color, fontSize + "", "Arial", "normal", "end", "auto");
}

export function printMultilineText(printCtx, text, x, y, lineHeight = 16, alignment = "left", textColor, boxColor, showBox = false) {
    if (!text) return; //if no text, return
    if (!printCtx) return; //if no context, return
    const lines = text.split("\n");
    //calculate the text width of the widest line NOT the the entire sting.
    let textWidth = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineWidth = printCtx.measureText(lines[i]).width;
        if (lineWidth > textWidth) {
            textWidth = lineWidth;
        }
    }
    //colorise the text
    printCtx.fillStyle = textColor;
    for (let i = 0; i < lines.length; i++) {
        if (alignment == "left") {
            printCtx.fillText(lines[i], x, y + i * lineHeight);
        } else if (alignment == "right") {
            printCtx.fillText(lines[i], x - textWidth, y + i * lineHeight);
        } else if (alignment == "center") {
            // Center each line individually based on its own width
            const lineWidth = printCtx.measureText(lines[i]).width;
            printCtx.fillText(lines[i], x - lineWidth / 2, y + i * lineHeight);
        }
    }

    if (showBox) {
        printCtx.strokeStyle = boxColor;
        printCtx.lineWidth = 1;
        printCtx.beginPath();
        printCtx.roundRect(x - 5 - textWidth / 2, y - 6 - lineHeight / 2, textWidth + 10, lines.length * lineHeight + 6, 4);
        printCtx.stroke();
    }
}

export function printDirectionArrow(startX, startY, endX, endY, fillColor, strokeColor, connScale, context) {
    try {
        // Set up the arrow parameters
        var arrowWidth = (context.firstMovementSize / 4) * context.currentScale; // Width of the arrowhead
        var arrowLength = 2 * (context.firstMovementSize / 4) * context.currentScale; // Length of the arrowhead
        var tailWidth = arrowWidth * 0.7; // Width of the tail (adjust as needed)
        const angle = Math.atan2(endY - startY, endX - startX); // Angle of the arrow

        // Set the stroke and fill colors
        printCtx.strokeStyle = "black"; // Stroke color (black outline)
        printCtx.fillStyle = fillColor; // Fill color (goldenrod)

        // Begin drawing the arrow as a single path
        printCtx.beginPath();

        // Move to the start point of the arrow
        printCtx.moveTo(startX + (tailWidth / 2) * Math.sin(angle), startY - (tailWidth / 2) * Math.cos(angle)); // Top-left corner of the tail

        // Draw to the end point of the tail (top-right corner)
        printCtx.lineTo(endX - arrowLength * Math.cos(angle) + (tailWidth / 2) * Math.sin(angle), endY - arrowLength * Math.sin(angle) - (tailWidth / 2) * Math.cos(angle));

        // Draw the right base of the arrowhead
        printCtx.lineTo(endX - arrowLength * Math.cos(angle) + arrowWidth * Math.sin(angle), endY - arrowLength * Math.sin(angle) - arrowWidth * Math.cos(angle));

        // Draw the tip of the arrowhead
        printCtx.lineTo(endX, endY);

        // Draw the left base of the arrowhead
        printCtx.lineTo(endX - arrowLength * Math.cos(angle) - arrowWidth * Math.sin(angle), endY - arrowLength * Math.sin(angle) + arrowWidth * Math.cos(angle));

        // Draw back to the bottom-right corner of the tail
        printCtx.lineTo(endX - arrowLength * Math.cos(angle) - (tailWidth / 2) * Math.sin(angle), endY - arrowLength * Math.sin(angle) + (tailWidth / 2) * Math.cos(angle));

        // Draw to the bottom-left corner of the tail
        printCtx.lineTo(startX - (tailWidth / 2) * Math.sin(angle), startY + (tailWidth / 2) * Math.cos(angle));

        printCtx.closePath();
        printCtx.fill(); // Fill the arrow with color
        printCtx.stroke(); // Outline the arrow with a stroke
    } catch (error) {
        console.error("Error while drawing arrow:", error);
    }
}

export function printArrow(startX, startY, endX, endY, color, connScale, connectorCurve, context) {
    //console.log("Drawing arrow from (" + startX + ", " + startY + ") to (" + endX + ", " + endY + ") with color " + color);
    try {
        // Step 1) Set up the arrow parameters
        var arrowWidth = (connScale / 4) * context.currentScale;
        var arrowLength = 2 * (connScale / 4) * context.currentScale;

        printCtx.strokeStyle = color;
        printCtx.fillStyle = color;
        printCtx.lineWidth = 2;

        // Step 2) Handle straight arrow (0 degrees)
        if (connectorCurve === 0) {
            // Draw straight line
            printCtx.beginPath();
            printCtx.moveTo(parseInt(startX), parseInt(startY));
            printCtx.lineTo(parseInt(endX), parseInt(endY));
            printCtx.stroke();

            // Calculate angle for arrowhead
            const angle = Math.atan2(startX - endX, startY - endY);
        } else {
            // Step 3) Draw curved arrow
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;
            const dx = endX - startX;
            const dy = endY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Step 4) Calculate control point based on angle in degrees
            const radians = (connectorCurve * Math.PI) / 180;
            const curveFactor = (connectorCurve / 90) * distance * 0.5; // Linear scaling instead of sine

            // Perpendicular vector for curve direction
            const perpX = -dy / distance;
            const perpY = dx / distance;

            const controlX = midX + perpX * curveFactor;
            const controlY = midY + perpY * curveFactor;

            // Step 5) Draw curved line using quadratic bezier
            printCtx.beginPath();
            printCtx.moveTo(parseInt(startX), parseInt(startY));
            printCtx.quadraticCurveTo(parseInt(controlX), parseInt(controlY), parseInt(endX), parseInt(endY));
            printCtx.stroke();
        }

        // Step 6) Draw arrowhead
        if (endX == startX && endY == startY) {
            // Draw house shape for self-referencing
            var size = (connScale / 4) * context.currentScale;
            printCtx.fillStyle = color;
            printCtx.beginPath();
            printCtx.moveTo(endX, endY);
            printCtx.lineTo(endX - size / 2, endY + size);
            printCtx.lineTo(endX - size / 2, endY + 1.5 * size);
            printCtx.lineTo(endX + size / 2, endY + 1.5 * size);
            printCtx.lineTo(endX + size / 2, endY + size);
            printCtx.closePath();
            printCtx.stroke();
        } else {
            // Step 7) Calculate arrowhead angle for curved or straight arrows
            let angle;
            if (connectorCurve !== 0) {
                // For curved arrows, calculate angle at the end point
                const dx = endX - startX;
                const dy = endY - startY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const curveFactor = (connectorCurve / 90) * distance * 0.5;
                const perpX = -dy / distance;
                const perpY = dx / distance;
                const controlX = (startX + endX) / 2 + perpX * curveFactor;
                const controlY = (startY + endY) / 2 + perpY * curveFactor;

                // Calculate tangent at end point (derivative of quadratic bezier at t=1)
                const tangentX = 2 * (endX - controlX);
                const tangentY = 2 * (endY - controlY);
                angle = Math.atan2(tangentY, tangentX);

                // Draw arrowhead for curved arrows
                printCtx.beginPath();
                printCtx.moveTo(parseInt(endX), parseInt(endY));
                printCtx.lineTo(endX - arrowLength * Math.cos(angle - Math.PI / 6), endY - arrowLength * Math.sin(angle - Math.PI / 6));
                printCtx.lineTo(endX - arrowLength * Math.cos(angle + Math.PI / 6), endY - arrowLength * Math.sin(angle + Math.PI / 6));
                printCtx.closePath();
                printCtx.fill();
            } else {
                // For straight arrows - use the original working calculation
                angle = Math.atan2(startX - endX, startY - endY);

                // Draw arrowhead for straight arrows (original working method)
                printCtx.beginPath();
                printCtx.moveTo(parseInt(endX), parseInt(endY));
                printCtx.lineTo(endX - arrowLength * Math.cos((Math.PI / 2) * 3 - angle) - arrowWidth * Math.sin((Math.PI / 2) * 3 - angle), endY - arrowLength * Math.sin((Math.PI / 2) * 3 - angle) + arrowWidth * Math.cos((Math.PI / 2) * 3 - angle));
                printCtx.lineTo(endX - arrowLength * Math.cos((Math.PI / 2) * 3 - angle) + arrowWidth * Math.sin((Math.PI / 2) * 3 - angle), endY - arrowLength * Math.sin((Math.PI / 2) * 3 - angle) - arrowWidth * Math.cos((Math.PI / 2) * 3 - angle));
                printCtx.closePath();
                printCtx.fill();
            }
        }
    } catch (error) {
        console.error("Error while printing arrow:", error);
    }
}

export function printArrowDelayText(startX, startY, endX, endY, color, text, connectorCurve, context) {
    // Step 1) Calculate text position and angle
    let textX, textY, textAngle;

    if (connectorCurve === 0) {
        // Straight arrow - use midpoint
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        textAngle = Math.atan2(endY - startY, endX - startX);

        // Calculate perpendicular offset to move text above the line
        const perpAngle = textAngle - Math.PI / 2; // 90 degrees counterclockwise
        const offsetDistance = (context.currentFontSize * magnifyFont - 2) * 0.1; // Much smaller offset

        textX = midX + Math.cos(perpAngle) * offsetDistance;
        textY = midY + Math.sin(perpAngle) * offsetDistance;
    } else {
        // Step 2) Curved arrow - calculate actual point on curve at t=0.5
        const dx = endX - startX;
        const dy = endY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const curveFactor = (connectorCurve / 90) * distance * 0.5;

        const perpX = -dy / distance;
        const perpY = dx / distance;

        // Control point
        const controlX = (startX + endX) / 2 + perpX * curveFactor;
        const controlY = (startY + endY) / 2 + perpY * curveFactor;

        // Calculate actual point on quadratic bezier curve at t=0.5 (midpoint)
        const t = 0.5;
        const oneMinusT = 1 - t;
        const curveX = oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * controlX + t * t * endX;
        const curveY = oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * controlY + t * t * endY;

        // Calculate tangent angle at t=0.5 for proper text rotation
        const tangentX = 2 * oneMinusT * (controlX - startX) + 2 * t * (endX - controlX);
        const tangentY = 2 * oneMinusT * (controlY - startY) + 2 * t * (endY - controlY);
        textAngle = Math.atan2(tangentY, tangentX);

        // Calculate perpendicular offset to move text above the curve
        const perpAngle = textAngle - Math.PI / 2; // 90 degrees counterclockwise from tangent
        const offsetDistance = (context.currentFontSize * magnifyFont - 2) * 0.1; // Much smaller offset

        textX = curveX + Math.cos(perpAngle) * offsetDistance;
        textY = curveY + Math.sin(perpAngle) * offsetDistance;
    }

    // Step 3) Draw the text above the curve/line
    printCtx.save();
    printCtx.translate(textX, textY);
    printCtx.rotate(textAngle);

    printCtx.fillStyle = color;
    printCtx.font = parseInt(context.currentFontSize * magnifyFont - 2) + "px Arial";

    // Center the text horizontally and position baseline properly
    const textWidth = printCtx.measureText(text).width;
    printCtx.fillText(text, -textWidth / 2, 0); // y=0 puts baseline at the translated position

    printCtx.restore();
}
// Fix printDelauanySlopeMap function
export function printDelauanySlopeMap(triangles, centroid, strokeColor, context) {
    if (!triangles || !Array.isArray(triangles) || triangles.length === 0) return;
    printCtx.strokeStyle = "black";
    printCtx.fillStyle = context.fillColor;
    printCtx.lineWidth = 1;
    console.log("drawDelauanySlopeMap: " + triangles.length);
    for (let i = 0; i < triangles.length; i++) {
        const triangle = triangles[i];
        const tAX = triangle[0][0];
        const tAY = triangle[0][1];
        const tAZ = triangle[0][2];
        const tBX = triangle[1][0];
        const tBY = triangle[1][1];
        const tBZ = triangle[1][2];
        const tCX = triangle[2][0];
        const tCY = triangle[2][1];
        const tCZ = triangle[2][2];

        let maxSlopeAngle = context.getDipAngle(triangle);

        // FIX: Use window.worldToCanvas instead of manual coordinate transformation
        const [aAX, aAY] = window.worldToCanvas(tAX, tAY);
        const [aBX, aBY] = window.worldToCanvas(tBX, tBY);
        const [aCX, aCY] = window.worldToCanvas(tCX, tCY);

        // ... rest of color calculation code stays the same ...

        // Define the color ranges and corresponding RGB values
        let triangleFillColor;
        if (maxSlopeAngle >= 0 && maxSlopeAngle < 5) {
            triangleFillColor = "rgb(51, 139, 255)";
        } else if (maxSlopeAngle >= 5 && maxSlopeAngle < 7) {
            triangleFillColor = "rgb(0, 102, 204)";
        } else if (maxSlopeAngle >= 7 && maxSlopeAngle < 9) {
            triangleFillColor = "rgb(0, 204, 204)";
        } else if (maxSlopeAngle >= 9 && maxSlopeAngle < 12) {
            triangleFillColor = "rgb(102, 204, 0)";
        } else if (maxSlopeAngle >= 12 && maxSlopeAngle < 15) {
            triangleFillColor = "rgb(204, 204, 0)";
        } else if (maxSlopeAngle >= 15 && maxSlopeAngle < 17) {
            triangleFillColor = "rgb(255, 128, 0)";
        } else if (maxSlopeAngle >= 17 && maxSlopeAngle < 20) {
            triangleFillColor = "rgb(255, 0, 0)";
        } else {
            triangleFillColor = "rgb(153, 0, 76)";
        }

        printCtx.fillStyle = triangleFillColor;
        printCtx.lineWidth = 1;

        printCtx.beginPath();
        printCtx.moveTo(aAX, aAY);
        printCtx.lineTo(aBX, aBY);
        printCtx.lineTo(aCX, aCY);
        printCtx.closePath();
        printCtx.stroke();
        printCtx.fill();
    }
}

// Fix printDelauanyBurdenRelief function
export function printDelauanyBurdenRelief(triangles, centroid, strokeColor, context) {
    if (!triangles || !Array.isArray(triangles) || triangles.length === 0) return;
    printCtx.strokeStyle = "black";
    printCtx.lineWidth = 1;

    for (let i = 0; i < triangles.length; i++) {
        const triangle = triangles[i];
        const tAX = triangle[0][0];
        const tAY = triangle[0][1];
        const tAZ = triangle[0][2];
        const tBX = triangle[1][0];
        const tBY = triangle[1][1];
        const tBZ = triangle[1][2];
        const tCX = triangle[2][0];
        const tCY = triangle[2][1];
        const tCZ = triangle[2][2];

        // ... burden relief calculation code stays the same ...
        const earliestTime = Math.min(tAZ, tBZ, tCZ);
        const latestTime = Math.max(tAZ, tBZ, tCZ);
        const timeDifference = latestTime - earliestTime;

        let p1, p2;
        if (earliestTime === tAZ) {
            p1 = {
                x: tAX,
                y: tAY
            };
        } else if (earliestTime === tBZ) {
            p1 = {
                x: tBX,
                y: tBY
            };
        } else {
            p1 = {
                x: tCX,
                y: tCY
            };
        }

        if (latestTime === tAZ) {
            p2 = {
                x: tAX,
                y: tAY
            };
        } else if (latestTime === tBZ) {
            p2 = {
                x: tBX,
                y: tBY
            };
        } else {
            p2 = {
                x: tCX,
                y: tCY
            };
        }

        const distance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        const burdenRelief = timeDifference / distance;

        // Color mapping based on timing relief
        let triangleFillColor;
        if (burdenRelief < 4) {
            triangleFillColor = "rgb(75, 20, 20)";
        } else if (burdenRelief < 7) {
            triangleFillColor = "rgb(255, 40, 40)";
        } else if (burdenRelief < 10) {
            triangleFillColor = "rgb(255, 120, 50)";
        } else if (burdenRelief < 13) {
            triangleFillColor = "rgb(255, 255, 50)";
        } else if (burdenRelief < 16) {
            triangleFillColor = "rgb(50, 255, 70)";
        } else if (burdenRelief < 19) {
            triangleFillColor = "rgb(50, 255, 200)";
        } else if (burdenRelief < 22) {
            triangleFillColor = "rgb(50, 230, 255)";
        } else if (burdenRelief < 25) {
            triangleFillColor = "rgb(50, 180, 255)";
        } else if (burdenRelief < 30) {
            triangleFillColor = "rgb(50, 100, 255)";
        } else if (burdenRelief < 40) {
            triangleFillColor = "rgb(50, 0, 255)";
        } else {
            triangleFillColor = "rgb(75, 0, 150)";
        }

        printCtx.fillStyle = triangleFillColor;

        // FIX: Use window.worldToCanvas instead of manual coordinate transformation
        const [aAX, aAY] = window.worldToCanvas(tAX, tAY);
        const [aBX, aBY] = window.worldToCanvas(tBX, tBY);
        const [aCX, aCY] = window.worldToCanvas(tCX, tCY);

        printCtx.beginPath();
        printCtx.moveTo(aAX, aAY);
        printCtx.lineTo(aBX, aBY);
        printCtx.lineTo(aCX, aCY);
        printCtx.closePath();
        printCtx.stroke();
        printCtx.fill();
    }
}

export function printReliefLegend(strokecolor) {
    //draw a legend at the bottom of the screen in the center
    //the legend should be for the drawDelauanyTriangles function

    const legend0to4 = "rgb(75, 20, 20)"; // fast
    const legend4to7 = "rgb(255, 40, 40)";
    const legend7to10 = "rgb(255, 120, 50)"; //
    const legend10to13 = "rgb(255, 255, 50)"; //
    const legend13to16 = "rgb(50, 255, 70)"; //
    const legend16to19 = "rgb(50, 255, 200)"; //
    const legend19to22 = "rgb(50, 230, 255)"; //
    const legend22to25 = "rgb(50, 180, 255)"; //
    const legend25to30 = "rgb(50, 100, 255)"; //
    const legend30to40 = "rgb(50, 0, 255)"; //
    const legend40above = "rgb(75, 0, 150)"; // slow

    //draw the legend
    printCtx.beginPath();
    printCtx.fill();

    printCtx.font = "14px Arial";
    printCtx.fontWeight = "bold";
    printCtx.fillStyle = "black";
    printCtx.fillText("Legend Relief", 10, printCanvas.height / 2 - 70);
    printCtx.fillText("0ms/m - 4ms/m", 10, printCanvas.height / 2 - 40);
    printCtx.fillText("4ms/m - 7ms/m", 10, printCanvas.height / 2 - 10);
    printCtx.fillText("7ms/m - 10ms/m", 10, printCanvas.height / 2 + 20);
    printCtx.fillText("10ms/m - 13ms/m", 10, printCanvas.height / 2 + 50);
    printCtx.fillText("13ms/m - 16ms/m", 10, printCanvas.height / 2 + 80);
    printCtx.fillText("16ms/m - 19ms/m", 10, printCanvas.height / 2 + 110);
    printCtx.fillText("19ms/m - 22ms/m", 10, printCanvas.height / 2 + 140);
    printCtx.fillText("22ms/m - 25ms/m", 10, printCanvas.height / 2 + 170);
    printCtx.fillText("25ms/m - 30ms/m", 10, printCanvas.height / 2 + 200);
    printCtx.fillText("30ms/m - 40ms/m", 10, printCanvas.height / 2 + 230);
    printCtx.fillText("40ms/m above", 10, printCanvas.height / 2 + 260);
    printCtx.fillStyle = legend0to4;
    printCtx.fillRect(130, printCanvas.height / 2 - 55, 20, 20);
    printCtx.fillStyle = legend4to7;
    printCtx.fillRect(130, printCanvas.height / 2 - 25, 20, 20);
    printCtx.fillStyle = legend7to10;
    printCtx.fillRect(130, printCanvas.height / 2 + 5, 20, 20);
    printCtx.fillStyle = legend10to13;
    printCtx.fillRect(130, printCanvas.height / 2 + 35, 20, 20);
    printCtx.fillStyle = legend13to16;
    printCtx.fillRect(130, printCanvas.height / 2 + 65, 20, 20);
    printCtx.fillStyle = legend16to19;
    printCtx.fillRect(130, printCanvas.height / 2 + 95, 20, 20);
    printCtx.fillStyle = legend19to22;
    printCtx.fillRect(130, printCanvas.height / 2 + 125, 20, 20);
    printCtx.fillStyle = legend22to25;
    printCtx.fillRect(130, printCanvas.height / 2 + 155, 20, 20);
    printCtx.fillStyle = legend25to30;
    printCtx.fillRect(130, printCanvas.height / 2 + 185, 20, 20);
    printCtx.fillStyle = legend30to40;
    printCtx.fillRect(130, printCanvas.height / 2 + 215, 20, 20);
    printCtx.fillStyle = legend40above;
    printCtx.fillRect(130, printCanvas.height / 2 + 245, 20, 20);
    printCtx.stroke();
}

export function printTriangleAngleText(triangle, centroid, strokeColor, context) {
    if (!triangle || !Array.isArray(triangle) || triangle.length !== 3) return;
    const triangleCentroid = context.calculateTriangleCentroid(triangle);
    let maxSlopeAngle = context.getDipAngle(triangle);

    // FIX: Use worldToCanvas and printText to draw on the correct (print) canvas
    const [x, y] = context.worldToCanvas(triangleCentroid.x, triangleCentroid.y);
    printText(x, y, parseFloat(maxSlopeAngle).toFixed(1), "black", context);
}

export function printTriangleBurdenReliefText(triangle, centroid, strokeColor, context) {
    if (!triangle || !Array.isArray(triangle) || triangle.length !== 3) return;
    const triangleCentroid = context.calculateTriangleCentroid(triangle);
    let burdenRelief = context.getBurdenRelief(triangle);

    // FIX: Use worldToCanvas and printText to draw on the correct (print) canvas
    const [x, y] = context.worldToCanvas(triangleCentroid.x, triangleCentroid.y);
    printText(x, y, parseFloat(burdenRelief).toFixed(1), "black", context);
}

export function printLegend(strokecolor) {
    const legend0to5 = "rgb(51, 139, 255)";
    const legend5to7 = "rgb(0, 102, 204)";
    const legend7to9 = "rgb(0, 204, 204)";
    const legend9to12 = "rgb(102, 204, 0)";
    const legend12to15 = "rgb(204, 204, 0)";
    const legend15to17 = "rgb(255, 128, 0)";
    const legend17to20 = "rgb(255, 0, 0)";
    const legend20above = "rgb(153, 0, 76)";
    //draw the legend
    printCtx.beginPath();
    printCtx.fill();
    printCtx.font = "14px Arial";
    printCtx.fontWeight = "bold";
    printCtx.fillStyle = strokecolor;
    printCtx.fillText("Legend Slope", 10, printCanvas.height / 2 - 70);
    printCtx.fillText("0\u00B0-5\u00B0", 10, printCanvas.height / 2 - 40);
    printCtx.fillText("5\u00B0-7\u00B0", 10, printCanvas.height / 2 - 10);
    printCtx.fillText("7\u00B0-9\u00B0", 10, printCanvas.height / 2 + 20);
    printCtx.fillText("9\u00B0-12\u00B0", 10, printCanvas.height / 2 + 50);
    printCtx.fillText("12\u00B0-15\u00B0", 10, printCanvas.height / 2 + 80);
    printCtx.fillText("15\u00B0-17\u00B0", 10, printCanvas.height / 2 + 110);
    printCtx.fillText("17\u00B0-20\u00B0", 10, printCanvas.height / 2 + 140);
    printCtx.fillText("20\u00B0+", 10, printCanvas.height / 2 + 170);
    printCtx.fillStyle = legend0to5;
    printCtx.fillRect(60, printCanvas.height / 2 - 55, 20, 20);
    printCtx.fillStyle = legend5to7;
    printCtx.fillRect(60, printCanvas.height / 2 - 25, 20, 20);
    printCtx.fillStyle = legend7to9;
    printCtx.fillRect(60, printCanvas.height / 2 + 5, 20, 20);
    printCtx.fillStyle = legend9to12;
    printCtx.fillRect(60, printCanvas.height / 2 + 35, 20, 20);
    printCtx.fillStyle = legend12to15;
    printCtx.fillRect(60, printCanvas.height / 2 + 65, 20, 20);
    printCtx.fillStyle = legend15to17;
    printCtx.fillRect(60, printCanvas.height / 2 + 95, 20, 20);
    printCtx.fillStyle = legend17to20;
    printCtx.fillRect(60, printCanvas.height / 2 + 125, 20, 20);
    printCtx.fillStyle = legend20above;
    printCtx.fillRect(60, printCanvas.height / 2 + 155, 20, 20);
    printCtx.stroke();
}

// Step 950a) Simple voronoi/gradient legend for active legend state
export function printVoronoiLegendSimple(title, minVal, maxVal) {
    var legendX = 10;
    var legendY = printCanvas.height / 2 - 70;
    var gradientWidth = 20;
    var gradientHeight = 160;

    printCtx.fillStyle = "black";
    printCtx.font = "14px Arial";
    printCtx.fontWeight = "bold";
    printCtx.fillText(title || "Legend", legendX, legendY - 15);

    // Create gradient for legend (Blue -> Cyan -> Green -> Yellow -> Red)
    var gradient = printCtx.createLinearGradient(0, legendY, 0, legendY + gradientHeight);
    gradient.addColorStop(0.0, "rgb(0, 0, 255)");
    gradient.addColorStop(0.25, "rgb(0, 255, 255)");
    gradient.addColorStop(0.5, "rgb(0, 255, 0)");
    gradient.addColorStop(0.75, "rgb(255, 255, 0)");
    gradient.addColorStop(1.0, "rgb(255, 0, 0)");

    printCtx.fillStyle = gradient;
    printCtx.fillRect(legendX, legendY, gradientWidth, gradientHeight);

    // Border
    printCtx.strokeStyle = "black";
    printCtx.lineWidth = 1;
    printCtx.strokeRect(legendX, legendY, gradientWidth, gradientHeight);

    // Min/Max labels
    printCtx.fillStyle = "black";
    printCtx.font = "12px Arial";
    var minText = minVal !== undefined && minVal !== null ? minVal.toFixed(2) : "0.00";
    var maxText = maxVal !== undefined && maxVal !== null ? maxVal.toFixed(2) : "1.00";
    printCtx.fillText(minText, legendX + gradientWidth + 5, legendY + gradientHeight);
    printCtx.fillText(maxText, legendX + gradientWidth + 5, legendY + 10);
}

//ENGINE
// Replace your existing printData function with this one
export function printData(allBlastHoles, selectedHole, context) {
    // This resizing logic can cause issues, we handle it in the print setup.
    // if (printCanvas) {
    // 	if (printCanvas.width !== printCanvas.clientWidth || printCanvas.height !== printCanvas.clientHeight) {
    // 		printCanvas.width = printCanvas.clientWidth;
    // 		printCanvas.height = printCanvas.clientHeight;
    // 	}
    // }

    if (printCtx) {
        // FIX: Do NOT clear the canvas here. The print setup already prepared it with a
        // white background. This function was likely clearing the main screen canvas by mistake.
        // clearCanvas();

        printCtx.imageSmoothingEnabled = false;
        const displayOptions = context.getDisplayOptions();
        let holeMap = new Map();
        if (allBlastHoles && Array.isArray(allBlastHoles) && allBlastHoles.length > 0) {
            holeMap = context.buildHoleMap(allBlastHoles);
        }

        //drawPrintBoundary(printCtx);
        // Draw background image FIRST (bottom layer) - only visible images
        printBackgroundImage(context);
        // Draw surface triangles SECOND - only visible surfaces, skip textured surfaces (they use images)
        printSurface(context);

        // In printData function, replace the printing logic with:
        for (const [name, entity] of context.allKADDrawingsMap.entries()) {
            // Skip non-visible entities
            if (entity.visible === false) continue;
            if (context.developerModeEnabled && entity.entityType === "point") {
                // Draw allBlastHoles - FIX: Use worldToCanvas for proper positioning within map zone
                entity.data.forEach((point) => {
                    const [screenX, screenY] = context.worldToCanvas(point.pointXLocation, point.pointYLocation);
                    let lineWidthForDisplay = point.lineWidth;
                    if (point.lineWidth < 2) {
                        lineWidthForDisplay = 4;
                    }
                    printKADPoints(screenX, screenY, point.pointZLocation, lineWidthForDisplay, point.color);
                });
            } else if (entity.entityType === "point") {
                // Apply pixel distance simplification to points for performance
                const originalPoints = entity.data;
                const simplifiedPoints = context.simplifyByPxDist(originalPoints, 3); // Slightly smaller threshold for points

                for (const pointData of simplifiedPoints) {
                    const [x, y] = context.worldToCanvas(pointData.pointXLocation, pointData.pointYLocation);
                    let lineWidthForDisplay = pointData.lineWidth;
                    if (pointData.lineWidth < 2) {
                        lineWidthForDisplay = 4;
                    }
                    printKADPoints(x, y, pointData.pointZLocation, lineWidthForDisplay, pointData.color);
                }
            } else if (entity.entityType === "circle") {
                // Draw circles - FIX: Use worldToCanvas for proper positioning within map zone
                entity.data.forEach((circle) => {
                    const [screenX, screenY] = context.worldToCanvas(circle.pointXLocation, circle.pointYLocation);
                    printKADCircles(screenX, screenY, circle.pointZLocation, circle.radius, circle.lineWidth, circle.color, context);
                });
            } else if (entity.entityType === "text") {
                // Draw text - FIX: Use worldToCanvas for proper positioning within map zone
                entity.data.forEach((textData) => {
                    if (textData && textData.text) {
                        const [screenX, screenY] = context.worldToCanvas(textData.pointXLocation, textData.pointYLocation);
                        printKADTexts(screenX, screenY, textData.pointZLocation, textData.text, textData.color, context);
                    }
                });
            } else if (context.developerModeEnabled && (entity.entityType === "line" || entity.entityType === "poly")) {
                // --- Developer Mode: Full quality, no simplification ---
                const points = entity.data;
                if (points.length < 2) continue;

                // Draw all segments without any simplification
                for (let i = 0; i < points.length - 1; i++) {
                    const currentPoint = points[i]; // FIRST point of segment
                    const nextPoint = points[i + 1]; // SECOND point of segment

                    const [sx, sy] = context.worldToCanvas(currentPoint.pointXLocation, currentPoint.pointYLocation);
                    const [ex, ey] = context.worldToCanvas(nextPoint.pointXLocation, nextPoint.pointYLocation);

                    // Use FIRST point properties
                    printKADPolys(sx, sy, ex, ey, currentPoint.pointZLocation, nextPoint.pointZLocation, currentPoint.lineWidth, currentPoint.color, false);
                }

                // Handle closing segment for polygons
                const isClosed = entity.entityType === "poly";
                if (isClosed && points.length > 2) {
                    const firstPoint = points[0];
                    const lastPoint = points[points.length - 1];
                    const [sx, sy] = context.worldToCanvas(lastPoint.pointXLocation, lastPoint.pointYLocation);
                    const [ex, ey] = context.worldToCanvas(firstPoint.pointXLocation, firstPoint.pointYLocation);

                    // Use last point properties for closing segment
                    printKADPolys(sx, sy, ex, ey, lastPoint.pointZLocation, firstPoint.pointZLocation, lastPoint.lineWidth, lastPoint.color, false);
                }
            } else if (!context.developerModeEnabled && (entity.entityType === "line" || entity.entityType === "poly")) {
                // --- Pixel-distance simplification for performance ---
                const originalPoints = entity.data;
                if (originalPoints.length < 2) continue;

                // Simplify by pixel distance
                let pointThreshold = 2;
                if (context.currentScale > 1) {
                    pointThreshold = 2;
                } else {
                    pointThreshold = 1;
                }

                const simplifiedPoints = context.simplifyByPxDist(originalPoints, pointThreshold);

                // Draw the simplified line/polygon
                for (let i = 0; i < simplifiedPoints.length - 1; i++) {
                    const currentPoint = simplifiedPoints[i];
                    const nextPoint = simplifiedPoints[i + 1];

                    const [sx, sy] = context.worldToCanvas(currentPoint.pointXLocation, currentPoint.pointYLocation);
                    const [ex, ey] = context.worldToCanvas(nextPoint.pointXLocation, nextPoint.pointYLocation);

                    // Use FIRST point properties
                    printKADPolys(sx, sy, ex, ey, currentPoint.pointZLocation, nextPoint.pointZLocation, currentPoint.lineWidth, currentPoint.color, false);
                }

                // Handle closing segment for polygons
                const isClosed = entity.entityType === "poly";
                if (isClosed && simplifiedPoints.length > 2) {
                    const firstPoint = simplifiedPoints[0];
                    const lastPoint = simplifiedPoints[simplifiedPoints.length - 1];
                    const [sx, sy] = context.worldToCanvas(lastPoint.pointXLocation, lastPoint.pointYLocation);
                    const [ex, ey] = context.worldToCanvas(firstPoint.pointXLocation, firstPoint.pointYLocation);

                    // Use last point properties for closing segment
                    printKADPolys(sx, sy, ex, ey, lastPoint.pointZLocation, firstPoint.pointZLocation, lastPoint.lineWidth, lastPoint.color, false);
                }
            }
        }

        // Filter visible holes for Voronoi calculations
        const visibleBlastHoles = allBlastHoles.filter((hole) => hole.visible !== false);
        
        // VORONOI PF & OVERLAYS
        const tri = context.delaunayTriangles(visibleBlastHoles, context.maxEdgeLength);
        const blastBoundaryPolygon = context.createBlastBoundaryPolygon(tri.resultTriangles);
        const offsetBoundaryPolygon = context.offsetPolygonClipper(blastBoundaryPolygon, context.getAverageDistance(visibleBlastHoles) / 2);

        // Voronoi Powder Factor
        if (displayOptions.voronoiPF) {
            // console.log("DEBUG: VORONOI PF");
            switch (context.selectedVoronoiMetric) {
                case "powderFactor":
                    // console.log("Drawing Powder Factor");
                    //get the min and max values for the PF if isVoronoiLegendFixed is false
                    let minPF, maxPF, intervalPF, deltaPF;

                    if (!context.isVoronoiLegendFixed) {
                        // console.log("DEBUG: VORONOI PF NOT FIXED");
                        const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                        const clippedCells = context.clipVoronoiCells(voronoiMetrics);
                        const values = clippedCells.map((c) => c.powderFactor).filter((v) => v != null && !isNaN(v));
                        minPF = 0; //values.length > 0 ? Math.min(...values) : 0;
                        maxPF = values.length > 0 ? Math.max(...values) : 3;
                        if (maxPF - minPF > 0) {
                            deltaPF = maxPF - minPF;
                            intervalPF = deltaPF / 4;
                        } else {
                            minPF = 0;
                            maxPF = 1;
                            intervalPF = 0.2;
                        }
                    } else {
                        // console.log("DEBUG: VORONOI PF FIXED");
                        minPF = 0;
                        maxPF = 3;
                        if (maxPF - minPF > 0) {
                            deltaPF = maxPF - minPF;
                            intervalPF = deltaPF > 0 ? Math.ceil(deltaPF / 10) : 0.5;
                        } else {
                            minPF = 0;
                            maxPF = 1;
                            intervalPF = 0.2;
                        }
                    }
                    printVoronoiLegendAndCells(visibleBlastHoles, context.selectedVoronoiMetric, (value) => context.getPFColor(value, minPF, maxPF), "Legend Powder Factor", minPF, maxPF, intervalPF, context);
                    break;
                case "mass":
                    // console.log("Drawing Mass");
                    let minMass, maxMass, intervalMass, deltaMass;

                    if (!context.isVoronoiLegendFixed) {
                        // console.log("DEBUG: VORONOI MASS NOT FIXED");
                        const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                        const clippedCells = context.clipVoronoiCells(voronoiMetrics);
                        const values = clippedCells.map((c) => c.mass).filter((v) => v != null && !isNaN(v));
                        minMass = values.length > 0 ? Math.min(...values) : 0;
                        maxMass = values.length > 0 ? Math.max(...values) : 500;
                        if (maxMass - minMass > 0) {
                            deltaMass = maxMass - minMass;
                            intervalMass = deltaMass / 4;
                        } else {
                            minMass = 0;
                            maxMass = 1;
                            intervalMass = 0.2;
                        }
                    } else {
                        // console.log("DEBUG: VORONOI MASS FIXED");
                        minMass = 0;
                        maxMass = 1000;
                        if (maxMass - minMass > 0) {
                            deltaMass = maxMass - minMass;
                            intervalMass = deltaMass > 0 ? Math.ceil(deltaMass / 10) : 250;
                        } else {
                            minMass = 0;
                            maxMass = 1;
                            intervalMass = 0.2;
                        }
                    }
                    printVoronoiLegendAndCells(visibleBlastHoles, context.selectedVoronoiMetric, (value) => context.getMassColor(value, minMass, maxMass), "Legend Mass", minMass, maxMass, intervalMass, context);
                    break;
                case "volume": {
                    // console.log("Drawing Volume");
                    let minVol, maxVol, intervalVol, deltaVol;

                    if (!context.isVoronoiLegendFixed) {
                        const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                        const clippedCells = context.clipVoronoiCells(voronoiMetrics);
                        const values = clippedCells.map((c) => c.volume).filter((v) => v != null && !isNaN(v));
                        minVol = values.length > 0 ? Math.min(...values) : 0;
                        maxVol = values.length > 0 ? Math.max(...values) : 100;
                        if (maxVol - minVol > 0) {
                            deltaVol = maxVol - minVol;
                            intervalVol = deltaVol / 10;
                        } else {
                            minVol = 0;
                            maxVol = 1;
                            intervalVol = 0.2;
                        }
                    } else {
                        minVol = 0;
                        maxVol = 5000;
                        if (maxVol - minVol > 0) {
                            deltaVol = maxVol - minVol;
                            intervalVol = 500;
                        } else {
                            minVol = 0;
                            maxVol = 1;
                            intervalVol = 0.2;
                        }
                    }
                    printVoronoiLegendAndCells(visibleBlastHoles, context.selectedVoronoiMetric, (value) => context.getVolumeColor(value, minVol, maxVol), "Legend Volume", minVol, maxVol, intervalVol, context);
                    break;
                }
                case "area": {
                    // console.log("Drawing Area");
                    let minArea, maxArea, intervalArea, deltaArea;

                    if (!context.isVoronoiLegendFixed) {
                        const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                        const clippedCells = context.clipVoronoiCells(voronoiMetrics);
                        const values = clippedCells.map((c) => c.area).filter((v) => v != null && !isNaN(v));
                        minArea = values.length > 0 ? Math.min(...values) : 0;
                        maxArea = values.length > 0 ? Math.max(...values) : 100;
                        if (maxArea - minArea > 0) {
                            deltaArea = maxArea - minArea;
                            intervalArea = deltaArea / 10;
                        } else {
                            minArea = 0;
                            maxArea = 1;
                            intervalArea = 0.2;
                        }
                    } else {
                        minArea = 0;
                        maxArea = 500;
                        if (maxArea - minArea > 0) {
                            deltaArea = maxArea - minArea;
                            intervalArea = 50;
                        } else {
                            minArea = 0;
                            maxArea = 1;
                            intervalArea = 0.2;
                        }
                    }
                    printVoronoiLegendAndCells(visibleBlastHoles, context.selectedVoronoiMetric, (value) => context.getAreaColor(value, minArea, maxArea), "Legend Area", minArea, maxArea, intervalArea, context);
                    break;
                }
                case "measuredLength": {
                    // console.log("Drawing Measured Length");
                    let minMLen, maxMLen, intervalMLen, deltaMLen;

                    if (!context.isVoronoiLegendFixed) {
                        const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                        const clippedCells = context.clipVoronoiCells(voronoiMetrics);
                        const values = clippedCells.map((c) => c.measuredLength).filter((v) => v != null && !isNaN(v));
                        minMLen = values.length > 0 ? Math.min(...values) : 0;
                        maxMLen = values.length > 0 ? Math.max(...values) : 50;
                        if (maxMLen - minMLen > 0) {
                            deltaMLen = maxMLen - minMLen;
                            intervalMLen = deltaMLen / 10;
                        } else if (maxMLen > 0) {
                            minMLen = 0;
                            maxMLen = maxMLen;
                            intervalMLen = (maxMLen - minMLen) / 10;
                        } else {
                            minMLen = 0;
                            maxMLen = 1;
                            intervalMLen = 0.2;
                        }
                    } else {
                        minMLen = 0;
                        maxMLen = 50;
                        if (maxMLen - minMLen > 0) {
                            deltaMLen = maxMLen - minMLen;
                            intervalMLen = 5;
                        } else if (maxMLen > 0) {
                            minMLen = 0;
                            maxMLen = maxMLen;
                            intervalMLen = (maxMLen - minMLen) / 10;
                        } else {
                            minMLen = 0;
                            maxMLen = 1;
                            intervalMLen = 0.2;
                        }
                    }
                    printVoronoiLegendAndCells(visibleBlastHoles, context.selectedVoronoiMetric, (value) => context.getLengthColor(value, minMLen, maxMLen), "Legend Measured Length", minMLen, maxMLen, intervalMLen, context);
                    break;
                }
                case "designedLength": {
                    // console.log("Drawing Designed Length");
                    let minDLen, maxDLen, intervalDLen, deltaDLen;

                    if (!context.isVoronoiLegendFixed) {
                        const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                        const clippedCells = context.clipVoronoiCells(voronoiMetrics);
                        const values = clippedCells.map((c) => c.designedLength).filter((v) => v != null && !isNaN(v));
                        minDLen = values.length > 0 ? Math.min(...values) : 0;
                        maxDLen = values.length > 0 ? Math.max(...values) : 50;
                        if (maxDLen - minDLen > 0) {
                            deltaDLen = maxDLen - minDLen;
                            intervalDLen = deltaDLen / 10;
                        } else if (maxDLen > 0) {
                            minDLen = 0;
                            maxDLen = maxDLen;
                            intervalDLen = (maxDLen - minDLen) / 10;
                        } else {
                            minDLen = 0;
                            maxDLen = 1;
                            intervalDLen = 0.2;
                        }
                    } else {
                        minDLen = 0;
                        maxDLen = 50;
                        if (maxDLen - minDLen > 0) {
                            deltaDLen = maxDLen - minDLen;
                            intervalDLen = 5;
                        } else if (maxDLen > 0) {
                            minDLen = 0;
                            maxDLen = maxDLen;
                            intervalDLen = (maxDLen - minDLen) / 10;
                        } else {
                            minDLen = 0;
                            maxDLen = 1;
                            intervalDLen = 0.2;
                        }
                    }
                    printVoronoiLegendAndCells(visibleBlastHoles, context.selectedVoronoiMetric, (value) => context.getLengthColor(value, minDLen, maxDLen), "Legend Designed Length", minDLen, maxDLen, intervalDLen, context);
                    break;
                }
                case "holeFiringTime": {
                    // console.log("Drawing Hole Firing Time");
                    let minHTime, maxHTime, intervalHTime, deltaHTime;

                    if (!context.isVoronoiLegendFixed) {
                        const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                        const clippedCells = context.clipVoronoiCells(voronoiMetrics);
                        const holeTimes = clippedCells.map((c) => c.holeFiringTime).filter((t) => t != null && !isNaN(t));
                        minHTime = holeTimes.length > 0 ? Math.min(...holeTimes) : 0;
                        maxHTime = holeTimes.length > 0 ? Math.max(...holeTimes) : 5000;
                        if (maxHTime - minHTime > 0) {
                            deltaHTime = maxHTime - minHTime;
                            intervalHTime = deltaHTime / 10;
                        } else {
                            minHTime = 0;
                            maxHTime = 1;
                            intervalHTime = 0.5;
                        }
                    } else {
                        minHTime = 0;
                        maxHTime = 5000;
                        if (maxHTime - minHTime > 0) {
                            deltaHTime = maxHTime - minHTime;
                            intervalHTime = deltaHTime > 0 ? Math.ceil(deltaHTime / 10) : 1000;
                        } else {
                            minHTime = 0;
                            maxHTime = 1;
                            intervalHTime = 0.5;
                        }
                    }
                    printVoronoiLegendAndCells(visibleBlastHoles, context.selectedVoronoiMetric, (value) => context.getHoleFiringTimeColor(value, minHTime, maxHTime), "Legend Hole Firing Time", minHTime, maxHTime, intervalHTime, context);
                    break;
                }
            }
        }

        // Slope Map
        if (displayOptions.slopeMap) {
            const centroid = {
                x: context.centroidX,
                y: context.centroidY
            };
            const { resultTriangles } = context.delaunayTriangles(visibleBlastHoles, context.maxEdgeLength);
            printDelauanySlopeMap(resultTriangles, centroid, context.strokeColor, context);
            for (const triangle of resultTriangles) {
                printTriangleAngleText(triangle, centroid, "black", context);
            }
            // Legend now rendered in footer cell - disabled legacy map overlay legend
            // printLegend("black");
        }

        // Burden Relief
        if (displayOptions.burdenRelief) {
            const centroid = {
                x: context.centroidX,
                y: context.centroidY
            };
            const { reliefTriangles } = context.delaunayTriangles(visibleBlastHoles, context.maxEdgeLength);
            printDelauanyBurdenRelief(reliefTriangles, centroid, context.strokeColor, context);
            for (const triangle of reliefTriangles) {
                printTriangleBurdenReliefText(triangle, centroid, "black", context);
            }
            // Legend now rendered in footer cell - disabled legacy map overlay legend
            // printReliefLegend("black");
        }

        // First Movement Direction Arrows
        if (displayOptions.firstMovement) {
            let connScale = document.getElementById("connSlider").value;
            for (const arrow of context.directionArrows) {
                const [startX, startY] = context.worldToCanvas(arrow[0], arrow[1]);
                const [endX, endY] = context.worldToCanvas(arrow[2], arrow[3]);
                printDirectionArrow(startX, startY, endX, endY, arrow[4], "black", arrow[5], context);
            }
        }

        // Contour Lines
        //TODO: use the webworker for contour lines.
        if (displayOptions.contour) {
            printCtx.lineWidth = 3;
            printCtx.strokeStyle = "magenta";
            for (const contourLines of context.contourLinesArray) {
                for (const line of contourLines) {
                    const [startX, startY] = context.worldToCanvas(line[0].x, line[0].y);
                    const [endX, endY] = context.worldToCanvas(line[1].x, line[1].y);
                    printCtx.beginPath();
                    printCtx.moveTo(startX, startY);
                    printCtx.lineTo(endX, endY);
                    printCtx.stroke();
                }
            }
        }

        // Main hole loop
        printCtx.lineWidth = 1;
        printCtx.strokeStyle = "black";
        printCtx.font = parseInt(context.currentFontSize * magnifyFont) + "px Arial";
        if (visibleBlastHoles && Array.isArray(visibleBlastHoles) && visibleBlastHoles.length > 0) {
            for (const hole of visibleBlastHoles) {
                const [x, y] = context.worldToCanvas(hole.startXLocation, hole.startYLocation);
                const [gradeX, gradeY] = context.worldToCanvas(hole.gradeXLocation, hole.gradeYLocation);
                const [lineEndX, lineEndY] = context.worldToCanvas(hole.endXLocation, hole.endYLocation);

                let toeSizeInMeters = document.getElementById("toeSlider").value;
                let connScale = document.getElementById("connSlider").value;

                // Draw collar-to-toe track if angled
                if (hole.holeAngle > 0) {
                    printTrack(x, y, lineEndX, lineEndY, gradeX, gradeY, "black", hole.subdrillAmount);
                }

                // FIX: Do not draw UI-specific highlights on the print version
                // handleHoleHighlighting(point, x, y);

                // Draw toe if hole length is not zero
                if (parseFloat(hole.holeLengthCalculated).toFixed(1) != 0.0) {
                    const radiusInPixels = toeSizeInMeters * context.currentScale;
                    printHoleToe(lineEndX, lineEndY, context.transparentFillColor, "black", radiusInPixels);
                }

                // Calculate text offsets
                const textOffset = parseInt((hole.holeDiameter / 1000) * context.holeScale * context.currentScale);
                const leftSideToe = parseInt(lineEndX) - textOffset;
                const rightSideToe = parseInt(lineEndX) + textOffset;
                const leftSideCollar = parseInt(x) - textOffset;
                const rightSideCollar = parseInt(x) + textOffset;
                const topSideToe = parseInt(lineEndY - textOffset);
                const middleSideToe = parseInt(lineEndY + textOffset + parseInt((context.currentFontSize * magnifyFont) / 4));
                const bottomSideToe = parseInt(lineEndY + textOffset + parseInt(context.currentFontSize * magnifyFont));
                const topSideCollar = parseInt(y - textOffset);
                const middleSideCollar = parseInt(y + parseInt((context.currentFontSize * magnifyFont) / 2));
                const bottomSideCollar = parseInt(y + textOffset + parseInt(context.currentFontSize * magnifyFont));

                // Draw text/labels based on displayOptions
                printHoleTextsAndConnectors(hole, x, y, lineEndX, lineEndY, {
                    leftSideToe,
                    rightSideToe,
                    leftSideCollar,
                    rightSideCollar,
                    topSideToe,
                    middleSideToe,
                    bottomSideToe,
                    topSideCollar,
                    middleSideCollar,
                    bottomSideCollar,
                    holeMap,
                    displayOptions
                }, context);

                // Draw main hole geometry, with selection highlight logic
                printHoleMainShape(hole, x, y, selectedHole, context);

                // Font slider/label only needs to be updated once, after loop
            }
        }

        // Holes Displayed Count
        printCtx.fillStyle = "black";
        printCtx.font = "16px Arial";
        if (!visibleBlastHoles || !Array.isArray(visibleBlastHoles) || visibleBlastHoles.length < 1) {
            printCtx.fillText("Holes Displayed: 0", 10, printCanvas.height - 85);
        } else {
            printCtx.fillText("Holes Displayed: " + visibleBlastHoles.length, 10, printCanvas.height - 85);
        }
        printCtx.fillText("Scale [ 1:" + context.currentScale.toFixed(4) + " ]", 10, printCanvas.height - 70);
        printCtx.fillStyle = "blue";
        printCtx.fillText("Version Build: " + context.buildVersion, 10, printCanvas.height - 55);
        const now = new Date();
        const dateNow =
            now.toLocaleDateString("en-AU", {
                year: "numeric",
                month: "long",
                day: "numeric"
            }) +
            " " +
            now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
        printCtx.fillStyle = "black";
        printCtx.fillText("Date: " + dateNow, 10, printCanvas.height - 35);

        // Step 1503) Legends are now rendered in the footer cell by PrintSystem.js
        // Legacy map overlay legends have been disabled - they were previously drawn here:
        // - printLegend("black") for slope
        // - printReliefLegend("black") for relief
        // - printVoronoiLegendSimple() for voronoi
        // - printSurfaceLegend() for surfaces
        // These are now handled by the template-based legend cell in the footer

        // These are DOM manipulations and should not be in a print function
        // fontSlider.value = (currentFontSize * magnifyFont);
        // fontLabel.textContent = "Font Size: " + parseFloat((currentFontSize * magnifyFont)).toFixed(1) + "px";
    } else {
        // Handle missing context
        return;
    }
}

export function printVoronoiLegendAndCells(visibleBlastHoles, selectedVoronoiMetric, getColorForMetric, legendLabel, minValue, maxValue, step, context) {
    const legendX = 10,
        legendY = printCanvas.height / 2 - 70,
        gradientWidth = 20,
        gradientHeight = 160;
    printCtx.fillStyle = "black";
    printCtx.font = "14px Arial";
    printCtx.fontWeight = "bold";
    printCtx.fillText(legendLabel || "Legend " + selectedVoronoiMetric, legendX, legendY - 15);

    // Create gradient for legend
    const gradient = printCtx.createLinearGradient(0, legendY, 0, legendY + gradientHeight);
    const stops = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
    stops.forEach(function (stop) {
        const value = minValue + stop * (maxValue - minValue);
        const color = getColorForMetric(value);
        if (typeof color !== "string" || color.includes("NaN")) {
            // fallback or skip this color stop
        } else {
            gradient.addColorStop(stop, color);
        }
    });
    printCtx.fillStyle = gradient;
    printCtx.fillRect(legendX + 50, legendY, gradientWidth, gradientHeight);

    printCtx.fillStyle = "black";
    printCtx.textAlign = "left";
    printCtx.textBaseline = "middle";
    // Draw tick marks and labels
    for (let v = minValue; v <= maxValue; v += step) {
        const y = legendY + ((v - minValue) / (maxValue - minValue)) * gradientHeight;
        printCtx.strokeStyle = "black";
        printCtx.beginPath();
        printCtx.moveTo(legendX + 50 + gradientWidth, y);
        printCtx.lineTo(legendX + 50 + gradientWidth + 8, y);
        printCtx.stroke();
        printCtx.fillText(v.toFixed(1), legendX, y);
    }

    const voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
    //modes available: min, max, average, mode

    const clippedCells = context.clipVoronoiCells(voronoiMetrics);

    for (const cell of clippedCells) {
        const value = cell[selectedVoronoiMetric];
        if (!cell.polygon || value == null) continue;
        printCtx.beginPath();
        for (let j = 0; j < cell.polygon.length; j++) {
            const pt = cell.polygon[j];
            const [x, y] = context.worldToCanvas(pt.x !== undefined ? pt.x : pt[0], pt.y !== undefined ? pt.y : pt[1]);
            if (j === 0) printCtx.moveTo(x, y);
            else printCtx.lineTo(x, y);
        }
        printCtx.closePath();
        printCtx.fillStyle = getColorForMetric(value);
        printCtx.fill();
        printCtx.strokeStyle = "black";
        printCtx.lineWidth = 1;
        printCtx.stroke();
    }
}

export function printHoleTextsAndConnectors(hole, x, y, lineEndX, lineEndY, printCtxObj, context) {
    const { leftSideToe, rightSideToe, leftSideCollar, rightSideCollar, topSideToe, middleSideToe, bottomSideToe, topSideCollar, middleSideCollar, bottomSideCollar, holeMap, displayOptions } = printCtxObj;

    if (displayOptions.holeID) {
        printText(rightSideCollar, topSideCollar, hole.holeID, "black", context);
    }
    if (displayOptions.holeDia) {
        printText(rightSideCollar, bottomSideCollar, parseFloat(hole.holeDiameter).toFixed(0), "rgb(0, 50, 0)", context);
    }
    if (displayOptions.holeLen) {
        printText(rightSideCollar, middleSideCollar, parseFloat(hole.holeLengthCalculated).toFixed(1), "rgb(0, 0, 67)", context);
    }
    if (displayOptions.holeAng) {
        printRightAlignedText(leftSideCollar, topSideCollar, parseFloat(hole.holeAngle).toFixed(0) + "°", "rgb(67, 30, 0)", context);
    }
    if (displayOptions.holeDip) {
        printRightAlignedText(leftSideToe, topSideToe, 90 - parseFloat(hole.holeAngle).toFixed(0) + "°", "rgb(67, 30, 0)", context);
    }
    if (displayOptions.holeBea) {
        printRightAlignedText(leftSideToe, bottomSideToe, parseFloat(hole.holeBearing).toFixed(1) + "°", "red", context);
    }
    if (displayOptions.holeSubdrill) {
        printRightAlignedText(leftSideToe, bottomSideToe, parseFloat(hole.subdrillAmount).toFixed(1), "blue", context);
    }
    if (displayOptions.initiationTime) {
        printRightAlignedText(leftSideCollar, middleSideCollar, hole.holeTime, "red", context);
    }
    if (displayOptions.connector && hole.fromHoleID) {
        const [splitEntityName, splitFromHoleID] = hole.fromHoleID.split(":::");
        const fromHole = holeMap.get(splitEntityName + ":::" + splitFromHoleID);
        if (fromHole) {
            const [startX, startY] = context.worldToCanvas(fromHole.startXLocation, fromHole.startYLocation);
            const connColor = hole.colorHexDecimal;
            const curve = hole.connectorCurve;
            let connScale = document.getElementById("connSlider").value;
            try {
                printArrow(startX, startY, x, y, connColor, connScale, curve, context);
            } catch (error) {
                console.error("Error printing arrow:", error);
            }
        }
    }
    if (displayOptions.delayValue && hole.fromHoleID) {
        const [splitEntityName, splitFromHoleID] = hole.fromHoleID.split(":::");
        const fromHole = holeMap.get(splitEntityName + ":::" + splitFromHoleID);
        if (fromHole) {
            const [startX, startY] = context.worldToCanvas(fromHole.startXLocation, fromHole.startYLocation);
            const connColor = hole.colorHexDecimal;
            const holeDelay = hole.timingDelayMilliseconds;
            const curve = hole.connectorCurve;
            printArrowDelayText(startX, startY, x, y, connColor, holeDelay, curve, context);
        }
    }
    if (displayOptions.xValue) {
        printRightAlignedText(leftSideCollar, topSideCollar, parseFloat(hole.startXLocation).toFixed(2), context.textFillColor, context);
    }
    if (displayOptions.yValue) {
        printRightAlignedText(leftSideCollar, middleSideCollar, parseFloat(hole.startYLocation).toFixed(2), context.textFillColor, context);
    }
    if (displayOptions.zValue) {
        printRightAlignedText(leftSideCollar, bottomSideCollar, parseFloat(hole.startZLocation).toFixed(2), context.textFillColor, context);
    }
    if (displayOptions.holeType) {
        printText(rightSideCollar, middleSideCollar, hole.holeType, "rgb(53, 0, 72)", context);
    }
    if (displayOptions.measuredLength) {
        printRightAlignedText(leftSideCollar, bottomSideToe, hole.measuredLength, "rgb(70, 0, 0)", context);
    }
    if (displayOptions.measuredMass) {
        printRightAlignedText(leftSideCollar, topSideToe, hole.measuredMass, "rgb(70, 0, 0)", context);
    }
    if (displayOptions.measuredComment) {
        printText(rightSideCollar, middleSideCollar, hole.measuredComment, "rgb(70, 0, 0)", context);
    }
    if (displayOptions.massPerHole) {
        var mLabels = buildMassLabels(hole);
        if (mLabels.perHole) {
            printRightAlignedText(leftSideCollar, middleSideToe, mLabels.perHole, "#FF0000", context);
        }
    }
    if (displayOptions.massPerDeck) {
        var dLabels = buildMassLabels(hole);
        var lineSpacing = context.currentFontSize || 10;
        for (var ml = 0; ml < dLabels.perDeck.length; ml++) {
            printRightAlignedText(leftSideCollar, middleSideToe + ml * lineSpacing, dLabels.perDeck[ml], "#FF0000", context);
        }
    }
}

export function printHoleMainShape(hole, x, y, selectedHole, context) {
    const diameterPx = parseInt((hole.holeDiameter / 1000) * context.currentScale * context.holeScale);

    let highlightType = null;
    let highlightColor1 = null,
        highlightColor2 = null,
        highlightText = null;

    // Check if we're in connector mode
    if (context.isAddingConnector || context.isAddingMultiConnector) {
        // First selected hole in connector mode (using fromHoleStore)
        if (context.fromHoleStore && context.fromHoleStore === hole) {
            highlightType = "first";
            highlightColor1 = "rgba(0, 255, 0, 0.2)";
            highlightColor2 = "rgba(0, 190, 0, .8)";
            highlightText = "1st Selected Hole: " + hole.holeID + " in: " + hole.entityName + " (Select second hole)";
        }
        // Second selected hole in connector mode (using firstSelectedHole/secondSelectedHole)
        else if (context.firstSelectedHole && context.firstSelectedHole === hole) {
            highlightType = "first";
            highlightColor1 = "rgba(0, 255, 0, 0.2)";
            highlightColor2 = "rgba(0, 190, 0, .8)";
            highlightText = "1st Selected Hole: " + hole.holeID + " in: " + hole.entityName;
        } else if (context.secondSelectedHole && context.secondSelectedHole === hole) {
            highlightType = "second";
            highlightColor1 = "rgba(255, 255, 0, 0.2)";
            highlightColor2 = "rgba(255, 200, 0, .8)";
            highlightText = "2nd Selected Hole: " + hole.holeID + " in: " + hole.entityName + " (Click to connect)";
        }
    }
    // Regular selection highlighting (NOT in connector mode)
    else if (selectedHole != null && selectedHole === hole) {
        highlightType = "selected";
        highlightColor1 = "rgba(255, 0, 150, 0.2)";
        highlightColor2 = "rgba(255, 0, 150, .8)";
        highlightText = "Editing Selected Hole: " + selectedHole.holeID + " in: " + selectedHole.entityName + " with Single Selection Mode \nEscape key to clear Selection";
    }
    // Multiple selection highlighting
    else if (context.selectedMultipleHoles != null && context.selectedMultipleHoles.find((p) => p.entityName === hole.entityName && p.holeID === hole.holeID)) {
        highlightType = "multi";
        highlightColor1 = "rgba(255, 0, 150, 0.2)";
        highlightColor2 = "rgba(255, 0, 150, .8)";
        if (hole === context.selectedMultipleHoles[0]) {
            highlightText = "Editing Selected Holes: {" + context.selectedMultipleHoles.map((h) => h.holeID).join(",") + "} \nEscape key to clear Selection";
        } else {
            highlightText = "";
        }
    }

    // Draw main hole/track shape (dummy, missing, or real)
    printCtx.lineWidth = 1;

    printCtx.strokeStyle = context.strokeColor;

    if (parseFloat(hole.holeLengthCalculated).toFixed(1) == 0.0) {
        printDummy(x, y, parseInt(0.2 * context.holeScale * context.currentScale), "black");
    } else if (hole.holeDiameter == 0) {
        printNoDiameterHole(x, y, 10, "black");
    } else {
        printHole(x, y, diameterPx, "black", "black");
    }
}
//Update printSurface function (around line 23909)
export function printSurface(context) {
    // Check if any surfaces are visible
    let hasSurfaces = false;
    let allMinZ = Infinity;
    let allMaxZ = -Infinity;

    // Check all loaded surfaces for visibility and calculate global Z range
    // Skip textured surfaces - they are rendered via printBackgroundImage as flattened images
    for (const [surfaceId, surface] of context.loadedSurfaces.entries()) {
        // Skip non-visible surfaces
        if (surface.visible === false) continue;
        // Skip textured surfaces - they use flattened images instead of triangles
        if (surface.isTexturedMesh) continue;
        
        if (surface.points && surface.points.length > 0) {
            hasSurfaces = true;

            // Find Z range for this surface
            surface.points.forEach((point) => {
                if (point.z < allMinZ) allMinZ = point.z;
                if (point.z > allMaxZ) allMaxZ = point.z;
            });
        }
    }

    if (!hasSurfaces) return;

    // Draw all visible surfaces with their individual gradients
    // (textured surfaces are already handled by printBackgroundImage)
    for (const [surfaceId, surface] of context.loadedSurfaces.entries()) {
        // Skip non-visible surfaces
        if (surface.visible === false) continue;
        // Skip textured surfaces - they use flattened images instead of triangles
        if (surface.isTexturedMesh) continue;
        
        if (surface.triangles && surface.triangles.length > 0) {
            surface.triangles.forEach((triangle) => {
                printTriangleWithGradient(triangle, allMinZ, allMaxZ, printCtx, surface.transparency || 1.0, surface.gradient || "default", context);
            });
        }
    }

    // Draw legend after all surfaces
    printSurfaceLegend(context);
}

export function printSurfaceLegend(context) {
    if (!context.showSurfaceLegend || context.loadedSurfaces.size === 0) return;

    // Get first visible surface for legend
    const visibleSurface = Array.from(context.loadedSurfaces.values()).find((s) => s.visible);
    if (!visibleSurface || !visibleSurface.triangles || visibleSurface.triangles.length === 0) return;

    // Calculate elevation range
    let minZ = Infinity;
    let maxZ = -Infinity;

    visibleSurface.points.forEach((point) => {
        if (point.z < minZ) minZ = point.z;
        if (point.z > maxZ) maxZ = point.z;
    });

    // Legend dimensions and position
    const legendWidth = 20;
    const legendHeight = 200;
    const legendX = printCanvas.width - legendWidth - 60;
    const legendY = 50;
    const steps = 50;

    // Draw color gradient
    for (let i = 0; i < steps; i++) {
        const ratio = i / (steps - 1);
        const y = legendY + legendHeight - (i * legendHeight) / steps;
        const height = legendHeight / steps + 1;

        printCtx.fillStyle = context.elevationToColor(minZ + ratio * (maxZ - minZ), minZ, maxZ);
        printCtx.fillRect(legendX, y, legendWidth, height);
    }

    // Draw elevation labels
    printCtx.fillStyle = context.strokeColor;
    printCtx.font = "12px Arial";
    printCtx.fontWeight = "bold";
    printCtx.textAlign = "left";

    const labelCount = 5;
    for (let i = 0; i < labelCount; i++) {
        const ratio = i / (labelCount - 1);
        const elevation = minZ + ratio * (maxZ - minZ);
        const y = legendY + legendHeight - ratio * legendHeight;

        // Draw tick mark
        printCtx.beginPath();
        printCtx.moveTo(legendX + legendWidth, y);
        printCtx.lineTo(legendX + legendWidth + 5, y);
        printCtx.stroke();

        // Draw elevation text
        printCtx.fillText(elevation.toFixed(1) + "m", legendX + legendWidth + 8, y + 4);
    }

    // Draw title
    printCtx.font = "14px Arial";
    printCtx.textAlign = "center";
    printCtx.fillText("Elevation", legendX + legendWidth / 2, legendY - 20);

    // Draw gradient name
    printCtx.font = "10px Arial";
    const gradientNames = {
        default: "Default",
        viridis: "Viridis",
        turbo: "Turbo",
        parula: "Parula",
        cividis: "Cividis",
        terrain: "Terrain"
    };
    printCtx.fillText(gradientNames[context.currentGradient] || "Default", legendX + legendWidth / 2, legendY + legendHeight + 30);

    // Reset text alignment
    printCtx.textAlign = "left";
}

export function printTriangleWithGradient(triangle, globalMinZ, globalMaxZ, targetCtx, alpha, gradient, context) {
    targetCtx = targetCtx || printCtx;
    alpha = alpha || 1.0;
    gradient = gradient || "default";
    const showWireFrame = false;
    const [p1, p2, p3] = triangle.vertices;

    // Convert to printCanvas coordinates
    const [x1, y1] = context.worldToCanvas(p1.x, p1.y);
    const [x2, y2] = context.worldToCanvas(p2.x, p2.y);
    const [x3, y3] = context.worldToCanvas(p3.x, p3.y);

    // Save context state
    targetCtx.save();

    // Set transparency
    targetCtx.globalAlpha = alpha;

    // Check if we have texture data (future enhancement)
    if (context.surfaceTextureData && context.surfaceTextureData.hasTextures) {
        targetCtx.beginPath();
        targetCtx.moveTo(x1, y1);
        targetCtx.lineTo(x2, y2);
        targetCtx.lineTo(x3, y3);
        targetCtx.closePath();

        const avgZ = (p1.z + p2.z + p3.z) / 3;
        targetCtx.fillStyle = context.elevationToColor(avgZ, globalMinZ, globalMaxZ, gradient);
        targetCtx.fill();

        if (showWireFrame) {
            targetCtx.strokeStyle = "rgba(0, 0, 0, 0.05)";
            targetCtx.lineWidth = 0.1;
            targetCtx.stroke();
        }
        targetCtx.restore(); // <-- FIX: restore before return
        return;
    }

    // Check if surface is flat
    if (globalMaxZ - globalMinZ < 0.001) {
        targetCtx.beginPath();
        targetCtx.moveTo(x1, y1);
        targetCtx.lineTo(x2, y2);
        targetCtx.lineTo(x3, y3);
        targetCtx.closePath();
        targetCtx.fillStyle = "rgba(255, 165, 0, 0.7)";
        targetCtx.fill();

        if (showWireFrame) {
            targetCtx.strokeStyle = "rgba(0, 0, 0, 0.1)";
            targetCtx.lineWidth = 0.1;
            targetCtx.stroke();
        }
        targetCtx.restore(); // <-- FIX: restore before return
        return;
    }

    // Create gradient based on elevation for non-flat surfaces
    const canvasGradient = targetCtx.createLinearGradient(x1, y1, x3, y3);

    const color1 = context.elevationToColor(p1.z, globalMinZ, globalMaxZ, gradient);
    const color2 = context.elevationToColor(p2.z, globalMinZ, globalMaxZ, gradient);
    const color3 = context.elevationToColor(p3.z, globalMinZ, globalMaxZ, gradient);

    canvasGradient.addColorStop(0, color1);
    canvasGradient.addColorStop(0.5, color2);
    canvasGradient.addColorStop(1, color3);

    targetCtx.beginPath();
    targetCtx.moveTo(x1, y1);
    targetCtx.lineTo(x2, y2);
    targetCtx.lineTo(x3, y3);
    targetCtx.closePath();
    targetCtx.fillStyle = canvasGradient;
    targetCtx.fill();

    if (showWireFrame) {
        targetCtx.strokeStyle = "rgba(0, 0, 0, 0.1)";
        targetCtx.lineWidth = 0.1;
        targetCtx.stroke();
    }
    targetCtx.restore();
}

export function drawCompleteBlastDataForPrint(printCtx, printArea, context) {
    // Filter visible holes
    const visibleBlastHoles = context.allBlastHoles.filter((hole) => hole.visible !== false);
    if (!visibleBlastHoles || visibleBlastHoles.length === 0) return;

    // Calculate data bounds locally
    let minX = Math.min(...visibleBlastHoles.map((p) => p.startXLocation));
    let maxX = Math.max(...visibleBlastHoles.map((p) => p.startXLocation));
    let minY = Math.min(...visibleBlastHoles.map((p) => p.startYLocation));
    let maxY = Math.max(...visibleBlastHoles.map((p) => p.startYLocation));

    const padding = Math.max(maxX - minX, maxY - minY) * 0.05;
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    // Calculate scale locally
    const dataWidth = maxX - minX;
    const dataHeight = maxY - minY;
    const scaleX = printArea.width / dataWidth;
    const scaleY = printArea.height / dataHeight;
    const printScale = Math.min(scaleX, scaleY) * 0.9;

    // Center data
    const scaledWidth = dataWidth * printScale;
    const scaledHeight = dataHeight * printScale;
    const offsetX = printArea.x + (printArea.width - scaledWidth) / 2;
    const offsetY = printArea.y + (printArea.height - scaledHeight) / 2;

    // Local coordinate conversion function
    function worldToPrintCanvas(worldX, worldY) {
        const printCentroidX = minX + dataWidth / 2;
        const printCentroidY = minY + dataHeight / 2;
        const x = (worldX - printCentroidX) * printScale + offsetX + scaledWidth / 2;
        const y = -(worldY - printCentroidY) * printScale + offsetY + scaledHeight / 2;
        return [x, y];
    }

    // Get display options
    const displayOptions = context.getDisplayOptions();
    const printHoleScale = parseFloat(document.getElementById("holeSize")?.value || 3);
    const printFontSize = Math.max(8, Math.min(24, (12 * printScale) / 50));

    printCtx.save();

    // Draw KAD objects first
    if (context.allKADDrawingsMap && context.allKADDrawingsMap.size > 0) {
        for (const [name, entity] of context.allKADDrawingsMap.entries()) {
            // Skip non-visible entities
            if (entity.visible === false) continue;
            
            if (entity.entityType === "point") {
                entity.data.forEach((point) => {
                    const [x, y] = worldToPrintCanvas(point.pointXLocation, point.pointYLocation);
                    printCtx.beginPath();
                    printCtx.arc(x, y, 2, 0, 2 * Math.PI);
                    printCtx.fillStyle = point.color || "black";
                    printCtx.fill();
                });
            } else if (entity.entityType === "line" || entity.entityType === "poly") {
                const entityPoints = entity.data;
                if (entityPoints.length < 2) continue;

                printCtx.strokeStyle = entityPoints[0].color || "black";
                printCtx.lineWidth = entityPoints[0].lineWidth || 1;
                printCtx.beginPath();

                for (let i = 0; i < entityPoints.length - 1; i++) {
                    const [sx, sy] = worldToPrintCanvas(entityPoints[i].pointXLocation, entityPoints[i].pointYLocation);
                    const [ex, ey] = worldToPrintCanvas(entityPoints[i + 1].pointXLocation, entityPoints[i + 1].pointYLocation);

                    if (i === 0) printCtx.moveTo(sx, sy);
                    printCtx.lineTo(ex, ey);
                }

                // Close polygon if needed
                if (entity.entityType === "poly" && entityPoints.length > 2) {
                    printCtx.closePath();
                }

                printCtx.stroke();
            }
        }
    }

    // Draw holes
    printCtx.lineWidth = 1;
    printCtx.strokeStyle = context.strokeColor;
    printCtx.font = parseInt(printFontSize) + "px Arial";

    for (const hole of visibleBlastHoles) {
        const [x, y] = worldToPrintCanvas(hole.startXLocation, hole.startYLocation);
        const [gradeX, gradeY] = worldToPrintCanvas(hole.gradeXLocation, hole.gradeYLocation);
        const [lineEndX, lineEndY] = worldToPrintCanvas(hole.endXLocation, hole.endYLocation);

        // Draw collar-to-toe track if angled
        if (hole.holeAngle > 0) {
            printCtx.lineWidth = 1;

            if (hole.subdrillAmount < 0) {
                // Negative subdrill
                printCtx.beginPath();
                printCtx.strokeStyle = context.strokeColor;
                printCtx.moveTo(x, y);
                printCtx.lineTo(lineEndX, lineEndY);
                printCtx.stroke();

                printCtx.beginPath();
                printCtx.strokeStyle = "rgba(255, 0, 0, 0.2)";
                printCtx.moveTo(lineEndX, lineEndY);
                printCtx.lineTo(gradeX, gradeY);
                printCtx.stroke();

                printCtx.beginPath();
                printCtx.arc(gradeX, gradeY, 3, 0, 2 * Math.PI);
                printCtx.fillStyle = "rgba(255, 0, 0, 0.2)";
                printCtx.fill();
            } else {
                // Positive subdrill
                printCtx.beginPath();
                printCtx.strokeStyle = context.strokeColor;
                printCtx.moveTo(x, y);
                printCtx.lineTo(gradeX, gradeY);
                printCtx.stroke();

                printCtx.beginPath();
                printCtx.strokeStyle = "rgba(255, 0, 0, 1.0)";
                printCtx.moveTo(gradeX, gradeY);
                printCtx.lineTo(lineEndX, lineEndY);
                printCtx.stroke();

                printCtx.beginPath();
                printCtx.arc(gradeX, gradeY, 3, 0, 2 * Math.PI);
                printCtx.fillStyle = "rgba(255, 0, 0, 1.0)";
                printCtx.fill();
            }
        }

        // Draw toe if hole length is not zero
        if (parseFloat(hole.holeLengthCalculated).toFixed(1) != 0.0) {
            const radiusInPixels = (document.getElementById("toeSlider")?.value || 3) * printScale;
            printCtx.beginPath();
            printCtx.lineWidth = 1;
            printCtx.arc(lineEndX, lineEndY, radiusInPixels, 0, 2 * Math.PI);
            printCtx.fillStyle = context.transparentFillColor;
            printCtx.strokeStyle = context.strokeColor;
            printCtx.stroke();
            printCtx.fill();
        }

        // Calculate text positions
        const textOffset = parseInt((hole.holeDiameter / 1000) * printHoleScale * printScale);
        const leftSideCollar = parseInt(x) - textOffset;
        const rightSideCollar = parseInt(x) + textOffset;
        const leftSideToe = parseInt(lineEndX) - textOffset;
        const topSideCollar = parseInt(y - textOffset);
        const middleSideCollar = parseInt(y + parseInt(printFontSize / 2));
        const bottomSideCollar = parseInt(y + textOffset + parseInt(printFontSize));
        const topSideToe = parseInt(lineEndY - textOffset);
        const bottomSideToe = parseInt(lineEndY + textOffset + parseInt(printFontSize));

        // Draw text labels based on display options
        printCtx.font = parseInt(printFontSize - 2) + "px Arial";

        if (displayOptions.holeID) {
            printCtx.fillStyle = context.textFillColor;
            printCtx.fillText(hole.holeID, rightSideCollar, topSideCollar);
        }
        if (displayOptions.holeDia) {
            printCtx.fillStyle = "green";
            printCtx.fillText(parseFloat(hole.holeDiameter).toFixed(0), rightSideCollar, middleSideCollar);
        }
        if (displayOptions.holeLen) {
            printCtx.fillStyle = context.depthColor;
            printCtx.fillText(parseFloat(hole.holeLengthCalculated).toFixed(1), rightSideCollar, bottomSideCollar);
        }
        if (displayOptions.holeAng) {
            printCtx.fillStyle = context.angleDipColor;
            const text = parseFloat(hole.holeAngle).toFixed(0);
            const textWidth = printCtx.measureText(text).width;
            printCtx.fillText(text, leftSideCollar - textWidth, topSideCollar);
        }
        if (displayOptions.holeDip) {
            printCtx.fillStyle = context.angleDipColor;
            const text = (90 - parseFloat(hole.holeAngle)).toFixed(0);
            const textWidth = printCtx.measureText(text).width;
            printCtx.fillText(text, leftSideToe - textWidth, topSideToe);
        }
        if (displayOptions.holeBea) {
            printCtx.fillStyle = "red";
            const text = parseFloat(hole.holeBearing).toFixed(1);
            const textWidth = printCtx.measureText(text).width;
            printCtx.fillText(text, leftSideToe - textWidth, bottomSideToe);
        }
        if (displayOptions.initiationTime) {
            printCtx.fillStyle = "red";
            const text = hole.holeTime;
            const textWidth = printCtx.measureText(text).width;
            printCtx.fillText(text, leftSideCollar - textWidth, middleSideCollar);
        }

        // Draw main hole shape
        const diameterPx = parseInt((hole.holeDiameter / 1000) * printScale * printHoleScale);

        printCtx.lineWidth = 1;
        printCtx.strokeStyle = context.strokeColor;

        if (parseFloat(hole.holeLengthCalculated).toFixed(1) == 0.0) {
            // Draw dummy (X shape)
            printCtx.lineWidth = 2;
            const radius = parseInt(0.2 * printHoleScale * printScale);
            printCtx.beginPath();
            printCtx.moveTo(x - radius, y - radius);
            printCtx.lineTo(x + radius, y + radius);
            printCtx.moveTo(x - radius, y + radius);
            printCtx.lineTo(x + radius, y - radius);
            printCtx.stroke();
        } else if (hole.holeDiameter == 0) {
            // Draw square for no diameter
            printCtx.lineWidth = 2;
            const halfSide = 5;
            printCtx.beginPath();
            printCtx.rect(x - halfSide, y - halfSide, halfSide * 2, halfSide * 2);
            printCtx.stroke();
        } else {
            // Draw normal hole (black filled circle)
            printCtx.beginPath();
            const minRadius = 1.5;
            const drawRadius = diameterPx > minRadius ? diameterPx : minRadius;
            printCtx.arc(x, y, drawRadius, 0, 2 * Math.PI);
            printCtx.fillStyle = context.fillColor;
            printCtx.fill();
            printCtx.stroke();
        }
    }

    printCtx.restore();
}

export function printBackgroundImage(context) {
    if (context.loadedImages.size === 0) return;

    context.loadedImages.forEach((image) => {
        // Only print visible images
        if (image.visible === false || !image.canvas) return;

        const bbox = image.bbox;
        if (bbox && bbox.length >= 4) {
            // FIX: Use window.worldToCanvas instead of non-existent worldToPrintCanvas
            const [x1, y1] = window.worldToCanvas(bbox[0], bbox[3]);
            const [x2, y2] = window.worldToCanvas(bbox[2], bbox[1]);

            printCtx.save();
            printCtx.globalAlpha = image.transparency !== undefined && image.transparency !== null ? image.transparency : 1.0;

            // Calculate proper dimensions for the image
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);

            printCtx.drawImage(image.canvas, Math.min(x1, x2), Math.min(y1, y2), width, height);
            printCtx.restore();
        }
    });
}

// ==================== SVG RENDERING FUNCTIONS ====================
// These functions generate SVG strings for vector PDF generation

export function printTrackSVG(lineStartX, lineStartY, lineEndX, lineEndY, gradeX, gradeY, color, subdrillAmount) {
    let svg = SVG.createSVGLine(lineStartX, lineStartY, lineEndX, lineEndY, color, 1);
    if (subdrillAmount < 0) {
        // Negative subdrill - draw red dashed line
        svg += SVG.createSVGLine(lineEndX, lineEndY, gradeX, gradeY, "rgba(255, 0, 0, 0.2)", 1, "5,5");
    }
    return svg;
}

export function printArrowSVG(startX, startY, endX, endY, color, connScale, connectorCurve, context) {
    const arrowWidth = (connScale / 4) * context.currentScale;
    const arrowLength = 2 * (connScale / 4) * context.currentScale;
    
    if (endX === startX && endY === startY) {
        // Self-referencing - house shape
        const size = (connScale / 4) * context.currentScale;
        const points = [
            {x: endX, y: endY},
            {x: endX - size / 2, y: endY + size},
            {x: endX - size / 2, y: endY + 1.5 * size},
            {x: endX + size / 2, y: endY + 1.5 * size},
            {x: endX + size / 2, y: endY + size}
        ];
        return SVG.createSVGPolyline(points, color, color, 2, true);
    }
    
    let pathData = "";
    let angle;
    
    if (connectorCurve === 0) {
        // Straight arrow
        pathData = "M " + startX + " " + startY + " L " + endX + " " + endY;
        angle = Math.atan2(startX - endX, startY - endY);
    } else {
        // Curved arrow
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const dx = endX - startX;
        const dy = endY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const radians = (connectorCurve * Math.PI) / 180;
        const curveFactor = (connectorCurve / 90) * distance * 0.5;
        const perpX = -dy / distance;
        const perpY = dx / distance;
        const controlX = midX + perpX * curveFactor;
        const controlY = midY + perpY * curveFactor;
        
        pathData = "M " + startX + " " + startY + " Q " + controlX + " " + controlY + " " + endX + " " + endY;
        
        // Calculate tangent at end point
        const tangentX = 2 * (endX - controlX);
        const tangentY = 2 * (endY - controlY);
        angle = Math.atan2(tangentY, tangentX);
    }
    
    // Add arrowhead
    const arrowX1 = endX - arrowLength * Math.cos(angle - Math.PI / 6);
    const arrowY1 = endY - arrowLength * Math.sin(angle - Math.PI / 6);
    const arrowX2 = endX - arrowLength * Math.cos(angle + Math.PI / 6);
    const arrowY2 = endY - arrowLength * Math.sin(angle + Math.PI / 6);
    
    pathData += " M " + arrowX1 + " " + arrowY1 + " L " + endX + " " + endY + " L " + arrowX2 + " " + arrowY2;
    
    return SVG.createSVGPath(pathData, color, color, 2);
}

export function printSurfaceSVG(context) {
    let svg = "";
    let hasSurfaces = false;
    let allMinZ = Infinity;
    let allMaxZ = -Infinity;
    
    // Check all loaded surfaces for visibility and calculate global Z range
    for (const [surfaceId, surface] of context.loadedSurfaces.entries()) {
        if (surface.visible === false) continue;
        if (surface.isTexturedMesh) continue;
        
        if (surface.points && surface.points.length > 0) {
            hasSurfaces = true;
            surface.points.forEach((point) => {
                if (point.z < allMinZ) allMinZ = point.z;
                if (point.z > allMaxZ) allMaxZ = point.z;
            });
        }
    }
    
    if (!hasSurfaces) return "";
    
    // Draw all visible surfaces with their individual gradients
    for (const [surfaceId, surface] of context.loadedSurfaces.entries()) {
        if (surface.visible === false) continue;
        if (surface.isTexturedMesh) continue;
        
        if (surface.triangles && surface.triangles.length > 0) {
            surface.triangles.forEach((triangle) => {
                svg += printTriangleWithGradientSVG(triangle, allMinZ, allMaxZ, surface.transparency || 1.0, surface.gradient || "default", context);
            });
        }
    }
    
    return svg;
}

export function printTriangleWithGradientSVG(triangle, globalMinZ, globalMaxZ, alpha, gradient, context) {
    const [p1, p2, p3] = triangle.vertices;
    const [x1, y1] = context.worldToCanvas(p1.x, p1.y);
    const [x2, y2] = context.worldToCanvas(p2.x, p2.y);
    const [x3, y3] = context.worldToCanvas(p3.x, p3.y);
    
    // Check if surface is flat
    if (globalMaxZ - globalMinZ < 0.001) {
        return SVG.createSVGPolyline([{x: x1, y: y1}, {x: x2, y: y2}, {x: x3, y: y3}], "rgba(255, 165, 0, 0.7)", "none", 0, true);
    }
    
    // Create gradient
    const gradientId = "grad_" + Math.random().toString(36).substr(2, 9);
    const color1 = context.elevationToColor(p1.z, globalMinZ, globalMaxZ, gradient);
    const color2 = context.elevationToColor(p2.z, globalMinZ, globalMaxZ, gradient);
    const color3 = context.elevationToColor(p3.z, globalMinZ, globalMaxZ, gradient);
    
    const stops = [
        {offset: "0%", color: color1},
        {offset: "50%", color: color2},
        {offset: "100%", color: color3}
    ];
    
    const gradientDef = SVG.createSVGLinearGradient(gradientId, stops, x1, y1, x3, y3);
    const trianglePath = SVG.createSVGPolyline([{x: x1, y: y1}, {x: x2, y: y2}, {x: x3, y: y3}], "url(#" + gradientId + ")", "none", 0, true);
    
    return gradientDef + trianglePath;
}

/**
 * @deprecated Use printBoundarySVG() for vector PDF generation
 */
export function drawPrintBoundary(ctx, canvas) {
    // Original implementation in PrintSystem.js
}

export function printBoundarySVG(boundary) {
    if (!boundary) return "";
    let svg = "";
    
    // Outer boundary (red dashed)
    svg += SVG.createSVGRect(boundary.x, boundary.y, boundary.width, boundary.height, "none", "#ff0000", 2, "10,5");
    
    // Inner boundary (blue dashed)
    const margin = boundary.width * boundary.marginPercent;
    svg += SVG.createSVGRect(boundary.x + margin, boundary.y + margin, boundary.width - margin * 2, boundary.height - margin * 2, "none", "#0066cc", 1, "5,3");
    
    return svg;
}

/**
 * SVG version of printData - generates SVG for all print elements
 * This mirrors the functionality of printData but generates SVG strings instead of drawing to canvas
 */
export function printDataSVG(allBlastHoles, selectedHole, context) {
    let svg = "";
    
    const displayOptions = context.getDisplayOptions();
    
    // Debug logging
    console.log("printDataSVG called:");
    console.log("  allBlastHoles param:", allBlastHoles ? allBlastHoles.length : 0);
    console.log("  context.allBlastHoles:", context.allBlastHoles ? context.allBlastHoles.length : 0);
    console.log("  allKADDrawingsMap:", context.allKADDrawingsMap ? context.allKADDrawingsMap.size : 0);
    console.log("  loadedSurfaces:", context.loadedSurfaces ? context.loadedSurfaces.size : 0);
    
    const visibleBlastHoles = allBlastHoles ? allBlastHoles.filter((hole) => hole.visible !== false) : [];
    console.log("  visibleBlastHoles after filter:", visibleBlastHoles.length);
    
    let holeMap = new Map();
    if (visibleBlastHoles && visibleBlastHoles.length > 0) {
        holeMap = context.buildHoleMap(visibleBlastHoles);
    }

    // Draw background images (as raster - handled separately)
    // Note: Images will be added as raster layer in PrintSystem.js

    // Draw surfaces
    svg += printSurfaceSVG(context);

    // Draw KAD entities
    if (context.allKADDrawingsMap && context.allKADDrawingsMap.size > 0) {
        for (const [name, entity] of context.allKADDrawingsMap.entries()) {
            if (entity.visible === false) continue;
            
            if (entity.entityType === "point") {
                const simplifiedPoints = context.simplifyByPxDist ? context.simplifyByPxDist(entity.data, 3) : entity.data;
                for (const pointData of simplifiedPoints) {
                    const [x, y] = context.worldToCanvas(pointData.pointXLocation, pointData.pointYLocation);
                    let lineWidthForDisplay = pointData.lineWidth || 2;
                    if (lineWidthForDisplay < 2) lineWidthForDisplay = 4;
                    svg += printKADPointsSVG(x, y, pointData.pointZLocation, pointData.color);
                }
            } else if (entity.entityType === "circle") {
                entity.data.forEach((circle) => {
                    const [x, y] = context.worldToCanvas(circle.pointXLocation, circle.pointYLocation);
                    svg += printKADCirclesSVG(x, y, circle.pointZLocation, circle.radius, circle.lineWidth, circle.color, context);
                });
            } else if (entity.entityType === "text") {
                entity.data.forEach((textData) => {
                    if (textData && textData.text) {
                        const [x, y] = context.worldToCanvas(textData.pointXLocation, textData.pointYLocation);
                        svg += printKADTextsSVG(x, y, textData.pointZLocation, textData.text, textData.color, context);
                    }
                });
            } else if (entity.entityType === "line" || entity.entityType === "poly") {
                const points = entity.data;
                if (points.length < 2) return;
                
                for (let i = 0; i < points.length - 1; i++) {
                    const [sx, sy] = context.worldToCanvas(points[i].pointXLocation, points[i].pointYLocation);
                    const [ex, ey] = context.worldToCanvas(points[i + 1].pointXLocation, points[i + 1].pointYLocation);
                    svg += printKADPolysSVG(sx, sy, ex, ey, points[i].pointZLocation, points[i + 1].pointZLocation, points[i].lineWidth || 1, points[i].color, false);
                }
                
                if (entity.entityType === "poly" && points.length > 2) {
                    const [sx, sy] = context.worldToCanvas(points[points.length - 1].pointXLocation, points[points.length - 1].pointYLocation);
                    const [ex, ey] = context.worldToCanvas(points[0].pointXLocation, points[0].pointYLocation);
                    svg += printKADPolysSVG(sx, sy, ex, ey, points[points.length - 1].pointZLocation, points[0].pointZLocation, points[0].lineWidth || 1, points[0].color, true);
                }
            }
        }
    }

    // Draw Voronoi overlays if enabled
    if (displayOptions.voronoiPF && context.selectedVoronoiMetric) {
        // Voronoi rendering would go here - simplified for now
        // Full implementation would call printVoronoiLegendAndCellsSVG
    }

    // Draw holes
    if (visibleBlastHoles && visibleBlastHoles.length > 0) {
        const toeSizeInMeters = parseFloat(document.getElementById("toeSlider")?.value || 3);
        const connScale = parseFloat(document.getElementById("connSlider")?.value || 17);
        
        for (const hole of visibleBlastHoles) {
            const [x, y] = context.worldToCanvas(hole.startXLocation, hole.startYLocation);
            const [gradeX, gradeY] = context.worldToCanvas(hole.gradeXLocation, hole.gradeYLocation);
            const [lineEndX, lineEndY] = context.worldToCanvas(hole.endXLocation, hole.endYLocation);

            // Draw track if angled
            if (hole.holeAngle > 0) {
                svg += printTrackSVG(x, y, lineEndX, lineEndY, gradeX, gradeY, "black", hole.subdrillAmount);
            }

            // Draw toe
            if (parseFloat(hole.holeLengthCalculated).toFixed(1) != 0.0) {
                const radiusInPixels = toeSizeInMeters * context.currentScale;
                svg += printHoleToeSVG(lineEndX, lineEndY, context.transparentFillColor || "rgba(255,255,255,0.5)", "black", radiusInPixels);
            }

            // Draw hole main shape
            const holeRadius = (hole.holeDiameter / 1000 / 2) * context.holeScale * context.currentScale;
            svg += printHoleSVG(x, y, holeRadius, "black");

            // Draw hole labels/text (simplified - full implementation would call printHoleTextsAndConnectorsSVG)
            if (displayOptions.holeID) {
                svg += printTextSVG(x + holeRadius + 5, y, hole.holeID, "black", context);
            }
        }
    }

    // Draw footer info text
    const fontSize = 16;
    const canvasHeight = context.canvasHeight || (context.canvas ? context.canvas.height : 1000);
    if (visibleBlastHoles && visibleBlastHoles.length > 0) {
        svg += SVG.createSVGText(10, canvasHeight - 85, "Holes Displayed: " + visibleBlastHoles.length, "black", fontSize + "", "Arial");
        svg += SVG.createSVGText(10, canvasHeight - 70, "Scale [ 1:" + context.currentScale.toFixed(4) + " ]", "black", fontSize + "", "Arial");
    }
    svg += SVG.createSVGText(10, canvasHeight - 55, "Version Build: " + (context.buildVersion || "unknown"), "blue", fontSize + "", "Arial");
    const now = new Date();
    const dateNow = now.toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" }) + " " + now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
    svg += SVG.createSVGText(10, canvasHeight - 35, "Date: " + dateNow, "black", fontSize + "", "Arial");

    return svg;
}
