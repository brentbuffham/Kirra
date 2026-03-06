/* prettier-ignore-file */
//=================================================
// PrintVectorPDF.js - Vector PDF Generation using jsPDF
//=================================================
// Generates true vector PDFs matching the template layout exactly
// GeoPDF support removed - standard PDF output only

import { jsPDF } from "jspdf";
import { getPrintBoundary } from "./PrintSystem.js";
import { getBlastStatisticsPerEntity } from "../helpers/BlastStatistics.js";
import { getTemplate, getPaperDimensions } from "./PrintTemplates.js";
import { PrintLayoutManager } from "./PrintLayoutManager.js";
import { PrintCaptureManager } from "./PrintCaptureManager.js";
import { getActiveLegends } from "../overlay/index.js";
import { buildMassLabels } from "../draw/canvas2DDrawing.js";
import ClipperLib from "clipper-lib";

// ============== LINE CLIPPING HELPERS ==============

// Cohen-Sutherland line clipping algorithm
// Clips a line segment to a rectangle - more efficient than Clipper for simple line-rect clipping
var INSIDE = 0, LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;

function computeOutCode(x, y, rect) {
    var code = INSIDE;
    if (x < rect.x) code |= LEFT;
    else if (x > rect.x + rect.width) code |= RIGHT;
    if (y < rect.y) code |= TOP;
    else if (y > rect.y + rect.height) code |= BOTTOM;
    return code;
}

// Clips line (x1,y1)-(x2,y2) to rectangle rect={x,y,width,height}
// Returns null if line is completely outside, or {x1,y1,x2,y2} of clipped line
function clipLineToRect(x1, y1, x2, y2, rect) {
    var xmin = rect.x, ymin = rect.y;
    var xmax = rect.x + rect.width, ymax = rect.y + rect.height;
    
    var outcode1 = computeOutCode(x1, y1, rect);
    var outcode2 = computeOutCode(x2, y2, rect);
    var accept = false;
    
    while (true) {
        if (!(outcode1 | outcode2)) {
            // Both points inside - trivially accept
            accept = true;
            break;
        } else if (outcode1 & outcode2) {
            // Both points share an outside zone - trivially reject
            break;
        } else {
            // Line may cross rectangle - compute intersection
            var x, y;
            var outcodeOut = outcode1 ? outcode1 : outcode2;
            
            if (outcodeOut & TOP) {
                x = x1 + (x2 - x1) * (ymin - y1) / (y2 - y1);
                y = ymin;
            } else if (outcodeOut & BOTTOM) {
                x = x1 + (x2 - x1) * (ymax - y1) / (y2 - y1);
                y = ymax;
            } else if (outcodeOut & RIGHT) {
                y = y1 + (y2 - y1) * (xmax - x1) / (x2 - x1);
                x = xmax;
            } else if (outcodeOut & LEFT) {
                y = y1 + (y2 - y1) * (xmin - x1) / (x2 - x1);
                x = xmin;
            }
            
            if (outcodeOut === outcode1) {
                x1 = x;
                y1 = y;
                outcode1 = computeOutCode(x1, y1, rect);
            } else {
                x2 = x;
                y2 = y;
                outcode2 = computeOutCode(x2, y2, rect);
            }
        }
    }
    
    if (accept) {
        return { x1: x1, y1: y1, x2: x2, y2: y2 };
    }
    return null;
}

// Check if a point is inside the map zone
function isPointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.width &&
           y >= rect.y && y <= rect.y + rect.height;
}

// Check if circle is fully inside rectangle (no clipping needed)
function isCircleFullyInRect(cx, cy, radius, rect) {
    return cx - radius >= rect.x && cx + radius <= rect.x + rect.width &&
           cy - radius >= rect.y && cy + radius <= rect.y + rect.height;
}

// Check if circle intersects rectangle (partially visible)
function doesCircleIntersectRect(cx, cy, radius, rect) {
    // Find closest point on rectangle to circle center
    var closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
    var closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
    var dx = cx - closestX;
    var dy = cy - closestY;
    return (dx * dx + dy * dy) <= (radius * radius);
}

// Draw a clipped circle using line segments
function drawClippedCircle(pdf, cx, cy, radius, rect, style) {
    // If fully inside, draw normally
    if (isCircleFullyInRect(cx, cy, radius, rect)) {
        pdf.circle(cx, cy, radius, style);
        return;
    }
    
    // If doesn't intersect at all, skip
    if (!doesCircleIntersectRect(cx, cy, radius, rect)) {
        return;
    }
    
    // Approximate circle with line segments and clip each
    var segments = 36; // 10 degree segments
    var angleStep = (2 * Math.PI) / segments;
    
    for (var i = 0; i < segments; i++) {
        var angle1 = i * angleStep;
        var angle2 = (i + 1) * angleStep;
        
        var x1 = cx + radius * Math.cos(angle1);
        var y1 = cy + radius * Math.sin(angle1);
        var x2 = cx + radius * Math.cos(angle2);
        var y2 = cy + radius * Math.sin(angle2);
        
        var clipped = clipLineToRect(x1, y1, x2, y2, rect);
        if (clipped) {
            pdf.line(clipped.x1, clipped.y1, clipped.x2, clipped.y2);
        }
    }
}

// Sutherland-Hodgman polygon clipping algorithm
// Clips a polygon to a rectangle, returns new polygon points array [[x,y], ...]
function clipPolygonToRect(polygon, rect) {
    if (!polygon || polygon.length < 3) return [];

    var minX = rect.x;
    var maxX = rect.x + rect.width;
    var minY = rect.y;
    var maxY = rect.y + rect.height;

    // Clip against each edge of the rectangle
    var output = polygon.slice();

    // Clip against left edge
    output = clipPolygonAgainstEdge(output, minX, null, 'left');
    if (output.length === 0) return [];

    // Clip against right edge
    output = clipPolygonAgainstEdge(output, maxX, null, 'right');
    if (output.length === 0) return [];

    // Clip against top edge
    output = clipPolygonAgainstEdge(output, null, minY, 'top');
    if (output.length === 0) return [];

    // Clip against bottom edge
    output = clipPolygonAgainstEdge(output, null, maxY, 'bottom');

    return output;
}

// Helper for Sutherland-Hodgman: clip polygon against one edge
function clipPolygonAgainstEdge(polygon, edgeX, edgeY, edge) {
    if (polygon.length === 0) return [];

    var output = [];
    var prev = polygon[polygon.length - 1];

    for (var i = 0; i < polygon.length; i++) {
        var curr = polygon[i];
        var prevInside = isInsideEdge(prev, edgeX, edgeY, edge);
        var currInside = isInsideEdge(curr, edgeX, edgeY, edge);

        if (currInside) {
            if (!prevInside) {
                // Entering: add intersection
                output.push(getEdgeIntersection(prev, curr, edgeX, edgeY, edge));
            }
            output.push(curr);
        } else if (prevInside) {
            // Leaving: add intersection
            output.push(getEdgeIntersection(prev, curr, edgeX, edgeY, edge));
        }

        prev = curr;
    }

    return output;
}

// Check if point is inside edge
function isInsideEdge(pt, edgeX, edgeY, edge) {
    switch (edge) {
        case 'left': return pt[0] >= edgeX;
        case 'right': return pt[0] <= edgeX;
        case 'top': return pt[1] >= edgeY;
        case 'bottom': return pt[1] <= edgeY;
    }
    return true;
}

// Get intersection of line segment with edge
function getEdgeIntersection(p1, p2, edgeX, edgeY, edge) {
    var dx = p2[0] - p1[0];
    var dy = p2[1] - p1[1];
    var t;

    switch (edge) {
        case 'left':
        case 'right':
            if (dx === 0) return [edgeX, p1[1]];
            t = (edgeX - p1[0]) / dx;
            return [edgeX, p1[1] + t * dy];
        case 'top':
        case 'bottom':
            if (dy === 0) return [p1[0], edgeY];
            t = (edgeY - p1[1]) / dy;
            return [p1[0] + t * dx, edgeY];
    }
    return p1;
}

// ============== HELPER FUNCTIONS ==============

// Step 1) Convert hex color to RGB
function hexToRgb(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    if (typeof hex !== "string") return { r: 0, g: 0, b: 0 };

    hex = hex.replace("#", "");

    // Expand shorthand hex
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
        return { r: 0, g: 0, b: 0 };
    }

    return { r: r, g: g, b: b };
}

// Step 2) Convert rgba string to RGB
function rgbaToRgb(rgba) {
    if (!rgba) return { r: 0, g: 0, b: 0, a: 1 };
    if (rgba.startsWith("#")) return hexToRgb(rgba);

    var match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return { r: 0, g: 0, b: 0, a: 1 };

    return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: match[4] ? parseFloat(match[4]) : 1
    };
}

// Step 3) Get luminance for contrast calculation
function getLuminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Step 4) Get contrast color (black or white)
function getContrastColor(bgColor) {
    var rgb = hexToRgb(bgColor);
    var luminance = getLuminance(rgb.r, rgb.g, rgb.b);
    return luminance < 0.5 ? "#ffffff" : "#000000";
}

// Step 5) Draw a cell border
function drawCellBorder(pdf, x, y, width, height, lineWidth) {
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(lineWidth || 0.2);
    pdf.rect(x, y, width, height, "S");
}

// Step 6) Draw text centered in a cell
function drawCenteredText(pdf, text, x, y, width, height, fontSize, bold) {
    pdf.setFontSize(fontSize || 8);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setTextColor(0, 0, 0);
    pdf.text(text, x + width / 2, y + height / 2, { align: "center", baseline: "middle" });
}

// Step 7) Draw multi-line text in a cell
function drawMultilineText(pdf, lines, x, y, width, height, fontSize, lineSpacing) {
    lineSpacing = lineSpacing || fontSize * 0.4;
    var totalHeight = lines.length * fontSize + (lines.length - 1) * lineSpacing;
    var startY = y + (height - totalHeight) / 2 + fontSize / 2;

    pdf.setFontSize(fontSize || 8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(0, 0, 0);

    for (var i = 0; i < lines.length; i++) {
        pdf.text(lines[i], x + width / 2, startY + i * (fontSize + lineSpacing), { align: "center" });
    }
}

// ============== LEGEND DRAWING FUNCTIONS ==============

// Step 7a) Default slope legend colors (from LegendPanel.js)
var defaultSlopeLegend = [
    { label: "0°-5°", color: "rgb(51, 139, 255)" },
    { label: "5°-7°", color: "rgb(0, 102, 204)" },
    { label: "7°-9°", color: "rgb(0, 204, 204)" },
    { label: "9°-12°", color: "rgb(102, 204, 0)" },
    { label: "12°-15°", color: "rgb(204, 204, 0)" },
    { label: "15°-17°", color: "rgb(255, 128, 0)" },
    { label: "17°-20°", color: "rgb(255, 0, 0)" },
    { label: "20°+", color: "rgb(153, 0, 76)" }
];

// Step 7b) Default relief legend colors (from LegendPanel.js)
var defaultReliefLegend = [
    { label: "0-4", color: "rgb(75, 20, 20)" },
    { label: "4-7", color: "rgb(255, 40, 40)" },
    { label: "7-10", color: "rgb(255, 120, 50)" },
    { label: "10-13", color: "rgb(255, 255, 50)" },
    { label: "13-16", color: "rgb(50, 255, 70)" },
    { label: "16-19", color: "rgb(50, 255, 200)" },
    { label: "19-22", color: "rgb(50, 230, 255)" },
    { label: "22-25", color: "rgb(50, 180, 255)" },
    { label: "25-30", color: "rgb(50, 100, 255)" },
    { label: "30-40", color: "rgb(0, 0, 180)" },
    { label: "40+", color: "rgb(75, 0, 150)" }
];

// Step 7c) Parse RGB string to {r, g, b}
function parseRgbString(rgbStr) {
    if (!rgbStr) return { r: 0, g: 0, b: 0 };
    var match = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
        return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
    }
    return { r: 0, g: 0, b: 0 };
}

// Step 7d) Draw slope legend on PDF
function drawSlopeLegendPDF(pdf, mapZone) {
    var legendX = mapZone.x + 5;
    var legendY = mapZone.y + 5;
    var legendWidth = 35;  // Standardized width for vertical alignment
    var legendHeight = 50;
    var itemHeight = 5;
    var padding = 2;

    var items = defaultSlopeLegend;

    // Background with border
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.2);
    pdf.rect(legendX, legendY, legendWidth, legendHeight, "FD");

    // Title
    pdf.setFontSize(6);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 0, 0);
    pdf.text("Slope (°)", legendX + legendWidth / 2, legendY + padding + 2, { align: "center" });

    // Legend items
    pdf.setFontSize(5);
    pdf.setFont("helvetica", "normal");
    var startY = legendY + padding + 6;

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var rgb = parseRgbString(item.color);
        var itemY = startY + i * itemHeight;

        // Color box
        pdf.setFillColor(rgb.r, rgb.g, rgb.b);
        pdf.rect(legendX + padding, itemY, 8, itemHeight - 1, "F");

        // Label
        pdf.setTextColor(0, 0, 0);
        pdf.text(item.label, legendX + padding + 10, itemY + itemHeight / 2, { baseline: "middle" });
    }

    return legendHeight;
}

// Step 7e) Draw relief legend on PDF
function drawReliefLegendPDF(pdf, mapZone, yOffset) {
    var legendX = mapZone.x + 5;
    var legendY = mapZone.y + 5 + (yOffset || 0);
    var legendWidth = 35;  // Standardized width for vertical alignment
    var legendHeight = 65;
    var itemHeight = 5;
    var padding = 2;

    var items = defaultReliefLegend;

    // Background with border
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.2);
    pdf.rect(legendX, legendY, legendWidth, legendHeight, "FD");

    // Title
    pdf.setFontSize(6);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 0, 0);
    pdf.text("Relief (ms/m)", legendX + legendWidth / 2, legendY + padding + 2, { align: "center" });

    // Legend items
    pdf.setFontSize(5);
    pdf.setFont("helvetica", "normal");
    var startY = legendY + padding + 6;

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var rgb = parseRgbString(item.color);
        var itemY = startY + i * itemHeight;

        // Color box
        pdf.setFillColor(rgb.r, rgb.g, rgb.b);
        pdf.rect(legendX + padding, itemY, 8, itemHeight - 1, "F");

        // Label
        pdf.setTextColor(0, 0, 0);
        pdf.text(item.label, legendX + padding + 10, itemY + itemHeight / 2, { baseline: "middle" });
    }

    return legendHeight;
}

// Step 7f) Draw voronoi/gradient legend on PDF with discrete color boxes (like relief legend)
// Uses 0.1 increments for labels
function drawVoronoiLegendPDF(pdf, mapZone, voronoiData, yOffset) {
    if (!voronoiData) return 0;

    var legendX = mapZone.x + 5;
    var legendY = mapZone.y + 5 + (yOffset || 0);
    var legendWidth = 45;  // Wider to fit longer titles like "Powder Factor (kg/m³)"
    var itemHeight = 4;    // Smaller to fit more items
    var padding = 2;

    // Get min/max values
    var minVal = voronoiData.minVal !== undefined ? voronoiData.minVal : 0;
    var maxVal = voronoiData.maxVal !== undefined ? voronoiData.maxVal : 1;
    var range = maxVal - minVal;

    // Build legend items with 0.1 increments
    var items = [];
    var increment = 0.1;
    var startVal = Math.floor(minVal * 10) / 10;  // Round down to nearest 0.1
    var endVal = Math.ceil(maxVal * 10) / 10;     // Round up to nearest 0.1

    // Limit number of items to prevent overflow (max ~15 items)
    var numItems = Math.round((endVal - startVal) / increment);
    if (numItems > 15) {
        increment = (endVal - startVal) / 15;
        increment = Math.ceil(increment * 10) / 10; // Round up to nice increment
    }

    // Helper function to get color for a value (interpolated from spectrum)
    function getSpectrumColor(val) {
        var ratio = range > 0 ? Math.min(Math.max((val - minVal) / range, 0), 1) : 0;
        var r, g, b;
        if (ratio < 0.2) {
            var t = ratio / 0.2;
            r = Math.round(148 * (1 - t));
            g = 0;
            b = Math.round(211 * (1 - t) + 255 * t);
        } else if (ratio < 0.4) {
            var t = (ratio - 0.2) / 0.2;
            r = 0;
            g = Math.round(255 * t);
            b = 255;
        } else if (ratio < 0.6) {
            var t = (ratio - 0.4) / 0.2;
            r = 0;
            g = 255;
            b = Math.round(255 * (1 - t));
        } else if (ratio < 0.8) {
            var t = (ratio - 0.6) / 0.2;
            r = Math.round(255 * t);
            g = 255;
            b = 0;
        } else {
            var t = (ratio - 0.8) / 0.2;
            r = 255;
            g = Math.round(255 * (1 - t));
            b = 0;
        }
        return { r: r, g: g, b: b };
    }

    for (var val = startVal; val < endVal; val += increment) {
        var lowVal = val;
        var highVal = Math.min(val + increment, endVal);
        var midVal = (lowVal + highVal) / 2;

        items.push({
            label: lowVal.toFixed(1) + "-" + highVal.toFixed(1),
            color: getSpectrumColor(midVal)
        });
    }

    // Calculate legend height based on items
    var legendHeight = 8 + items.length * itemHeight;

    // Background with border
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.2);
    pdf.rect(legendX, legendY, legendWidth, legendHeight, "FD");

    // Title
    pdf.setFontSize(5);  // Slightly smaller font to fit longer titles
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 0, 0);
    var title = voronoiData.title || "Legend";
    // No truncation - wider legend can fit full titles like "Powder Factor (kg/m³)"
    pdf.text(title, legendX + legendWidth / 2, legendY + padding + 2, { align: "center" });

    // Legend items (color boxes with labels)
    pdf.setFontSize(5);
    pdf.setFont("helvetica", "normal");
    var startY = legendY + padding + 6;

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var itemY = startY + i * itemHeight;

        // Color box
        pdf.setFillColor(item.color.r, item.color.g, item.color.b);
        pdf.rect(legendX + padding, itemY, 8, itemHeight - 1, "F");

        // Label
        pdf.setTextColor(0, 0, 0);
        pdf.text(item.label, legendX + padding + 10, itemY + itemHeight / 2, { baseline: "middle" });
    }

    return legendHeight;
}

// Step 7g) Get gradient color at position t (0-1)
function getGradientColor(t) {
    // Blue -> Cyan -> Green -> Yellow -> Red
    if (t < 0.25) {
        var p = t / 0.25;
        return { r: 0, g: Math.round(255 * p), b: 255 };
    } else if (t < 0.5) {
        var p = (t - 0.25) / 0.25;
        return { r: 0, g: 255, b: Math.round(255 * (1 - p)) };
    } else if (t < 0.75) {
        var p = (t - 0.5) / 0.25;
        return { r: Math.round(255 * p), g: 255, b: 0 };
    } else {
        var p = (t - 0.75) / 0.25;
        return { r: 255, g: Math.round(255 * (1 - p)), b: 0 };
    }
}

// Step 7g2) Get slope color for a given angle (matches AnalysisCache.js)
function getSlopeColorPDF(maxSlopeAngle) {
    if (maxSlopeAngle >= 0 && maxSlopeAngle < 5) {
        return { r: 51, g: 139, b: 255 };   // Cornflower blue
    } else if (maxSlopeAngle >= 5 && maxSlopeAngle < 7) {
        return { r: 0, g: 102, b: 204 };
    } else if (maxSlopeAngle >= 7 && maxSlopeAngle < 9) {
        return { r: 0, g: 204, b: 204 };
    } else if (maxSlopeAngle >= 9 && maxSlopeAngle < 12) {
        return { r: 102, g: 204, b: 0 };
    } else if (maxSlopeAngle >= 12 && maxSlopeAngle < 15) {
        return { r: 204, g: 204, b: 0 };
    } else if (maxSlopeAngle >= 15 && maxSlopeAngle < 17) {
        return { r: 255, g: 128, b: 0 };
    } else if (maxSlopeAngle >= 17 && maxSlopeAngle < 20) {
        return { r: 255, g: 0, b: 0 };
    } else {
        return { r: 153, g: 0, b: 76 };     // Dark pink
    }
}

// Step 7g3) Get relief color for a given burden relief value (matches AnalysisCache.js)
function getReliefColorPDF(burdenRelief) {
    if (burdenRelief < 4) {
        return { r: 75, g: 20, b: 20 };     // fast - dark red
    } else if (burdenRelief < 7) {
        return { r: 255, g: 40, b: 40 };    // red
    } else if (burdenRelief < 10) {
        return { r: 255, g: 120, b: 50 };   // orange
    } else if (burdenRelief < 13) {
        return { r: 255, g: 255, b: 50 };   // yellow
    } else if (burdenRelief < 16) {
        return { r: 50, g: 255, b: 70 };    // green
    } else if (burdenRelief < 19) {
        return { r: 50, g: 255, b: 200 };   // cyan-green
    } else if (burdenRelief < 22) {
        return { r: 50, g: 230, b: 255 };   // cyan
    } else if (burdenRelief < 25) {
        return { r: 50, g: 180, b: 255 };   // light blue
    } else if (burdenRelief < 30) {
        return { r: 50, g: 100, b: 255 };   // blue
    } else if (burdenRelief < 40) {
        return { r: 0, g: 0, b: 180 };      // navy
    } else {
        return { r: 75, g: 0, b: 150 };     // slow - purple
    }
}

// Step 7h) Surface gradient presets
var surfaceGradientColors = {
    "default": function(t) {
        return getGradientColor(t);
    },
    "viridis": function(t) {
        // Dark purple -> Blue-purple -> Teal -> Green -> Yellow
        if (t < 0.25) return { r: 68, g: 1 + Math.round(81 * t / 0.25), b: 84 + Math.round(55 * t / 0.25) };
        if (t < 0.5) return { r: 33, g: 82 + Math.round(62 * (t - 0.25) / 0.25), b: 139 - Math.round((-1) * (t - 0.25) / 0.25) };
        if (t < 0.75) return { r: 33 + Math.round(59 * (t - 0.5) / 0.25), g: 144 + Math.round(56 * (t - 0.5) / 0.25), b: 140 - Math.round(41 * (t - 0.5) / 0.25) };
        return { r: 92 + Math.round(161 * (t - 0.75) / 0.25), g: 200 + Math.round(31 * (t - 0.75) / 0.25), b: 99 - Math.round(62 * (t - 0.75) / 0.25) };
    },
    "turbo": function(t) {
        if (t < 0.25) return { r: 48 + Math.round(2 * t / 0.25), g: 18 + Math.round(118 * t / 0.25), b: 59 + Math.round(130 * t / 0.25) };
        if (t < 0.5) return { r: 50 + Math.round(44 * (t - 0.25) / 0.25), g: 136 + Math.round(65 * (t - 0.25) / 0.25), b: 189 - Math.round(91 * (t - 0.25) / 0.25) };
        if (t < 0.75) return { r: 94 + Math.round(159 * (t - 0.5) / 0.25), g: 201 + Math.round(30 * (t - 0.5) / 0.25), b: 98 - Math.round(61 * (t - 0.5) / 0.25) };
        return { r: 253 - Math.round(13 * (t - 0.75) / 0.25), g: 231 - Math.round(210 * (t - 0.75) / 0.25), b: 37 - Math.round(15 * (t - 0.75) / 0.25) };
    },
    "terrain": function(t) {
        // Dark green -> Green -> Pale green -> Brown -> Gray -> White
        if (t < 0.25) return { r: Math.round(65 * t / 0.25), g: 68 + Math.round(106 * t / 0.25), b: 27 + Math.round(91 * t / 0.25) };
        if (t < 0.4) return { r: 65 + Math.round(121 * (t - 0.25) / 0.15), g: 174 + Math.round(54 * (t - 0.25) / 0.15), b: 118 + Math.round(61 * (t - 0.25) / 0.15) };
        if (t < 0.55) return { r: 186 - Math.round(66 * (t - 0.4) / 0.15), g: 228 - Math.round(143 * (t - 0.4) / 0.15), b: 179 - Math.round(134 * (t - 0.4) / 0.15) };
        if (t < 0.7) return { r: 120 + Math.round(40 * (t - 0.55) / 0.15), g: 85 + Math.round(33 * (t - 0.55) / 0.15), b: 45 + Math.round(29 * (t - 0.55) / 0.15) };
        if (t < 0.85) return { r: 160 + Math.round(40 * (t - 0.7) / 0.15), g: 118 + Math.round(82 * (t - 0.7) / 0.15), b: 74 + Math.round(126 * (t - 0.7) / 0.15) };
        return { r: 200 + Math.round(55 * (t - 0.85) / 0.15), g: 200 + Math.round(55 * (t - 0.85) / 0.15), b: 200 + Math.round(55 * (t - 0.85) / 0.15) };
    }
};

// Step 7i) Draw surface elevation legend on PDF
function drawSurfaceLegendPDF(pdf, mapZone, surfaces, yOffset) {
    if (!surfaces || surfaces.length === 0) return 0;

    var legendX = mapZone.x + 5;
    var legendY = mapZone.y + 5 + (yOffset || 0);
    var legendWidth = 35;
    var entryHeight = 35;
    var totalHeight = 8 + surfaces.length * entryHeight;
    var padding = 2;

    // Background with border
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.2);
    pdf.rect(legendX, legendY, legendWidth, totalHeight, "FD");

    // Title
    pdf.setFontSize(6);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 0, 0);
    pdf.text("Elevation", legendX + legendWidth / 2, legendY + padding + 2, { align: "center" });

    // Draw each surface entry
    var entryY = legendY + 8;
    for (var s = 0; s < surfaces.length; s++) {
        var surface = surfaces[s];
        var gradientName = surface.gradient || "default";
        var isHillshade = (gradientName === "hillshade");

        // Surface name
        pdf.setFontSize(5);
        pdf.setFont("helvetica", "normal");
        var surfaceName = surface.name || "Surface";
        if (surfaceName.length > 12) surfaceName = surfaceName.substring(0, 12) + "...";
        pdf.text(surfaceName, legendX + padding, entryY + 3);

        if (isHillshade) {
            // Draw solid color swatch for hillshade
            var hillshadeColor = surface.hillshadeColor || "#808080";
            var rgb = hexToRgb(hillshadeColor);
            pdf.setFillColor(rgb.r, rgb.g, rgb.b);
            pdf.rect(legendX + padding, entryY + 6, 10, 20, "F");
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.1);
            pdf.rect(legendX + padding, entryY + 6, 10, 20, "S");
        } else {
            // Draw gradient bar
            var gradientFunc = surfaceGradientColors[gradientName] || surfaceGradientColors["default"];
            var gradientHeight = 20;
            var gradientWidth = 10;
            var numStrips = 15;
            var stripHeight = gradientHeight / numStrips;

            for (var i = 0; i < numStrips; i++) {
                var t = i / (numStrips - 1);
                var rgb = gradientFunc(t);
                pdf.setFillColor(rgb.r, rgb.g, rgb.b);
                pdf.rect(legendX + padding, entryY + 6 + gradientHeight - (i + 1) * stripHeight, gradientWidth, stripHeight, "F");
            }

            // Border around gradient
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.1);
            pdf.rect(legendX + padding, entryY + 6, gradientWidth, gradientHeight, "S");

            // Min/Max labels
            var minZ = surface.displayMinZ !== undefined ? surface.displayMinZ : (surface.actualMinZ !== undefined ? surface.actualMinZ : surface.minZ);
            var maxZ = surface.displayMaxZ !== undefined ? surface.displayMaxZ : (surface.actualMaxZ !== undefined ? surface.actualMaxZ : surface.maxZ);
            pdf.setFontSize(4);
            if (maxZ !== undefined) pdf.text(maxZ.toFixed(1) + "m", legendX + padding + gradientWidth + 2, entryY + 8);
            if (minZ !== undefined) pdf.text(minZ.toFixed(1) + "m", legendX + padding + gradientWidth + 2, entryY + 6 + gradientHeight - 2);
        }

        entryY += entryHeight;
    }

    return totalHeight;
}

// Step 7j) Draw all active legends on PDF
function drawLegendsOnPDF(pdf, mapZone, activeLegends, context) {
    if (!activeLegends) return;

    var yOffset = 0;

    // Draw slope legend if active
    if (activeLegends.slope) {
        yOffset += drawSlopeLegendPDF(pdf, mapZone) + 3;
    }

    // Draw relief legend if active
    if (activeLegends.relief) {
        var reliefHeight = drawReliefLegendPDF(pdf, mapZone, yOffset);
        yOffset += reliefHeight + 3;
    }

    // Draw voronoi legend if active
    if (activeLegends.voronoi) {
        var voronoiHeight = drawVoronoiLegendPDF(pdf, mapZone, activeLegends.voronoi, yOffset);
        yOffset += voronoiHeight + 3;
    }

    // Draw surface legends if active
    if (activeLegends.surfaces && activeLegends.surfaces.length > 0) {
        drawSurfaceLegendPDF(pdf, mapZone, activeLegends.surfaces, yOffset);
    }
}

// ============== MAIN VECTOR PDF GENERATION ==============

/**
 * Generate a true vector PDF matching the template layout exactly
 * @param {Object} context - Application context with all data
 * @param {Object} userInput - User input: {blastName, designer, notes, outputType}
 * @param {string} mode - "2D" or "3D"
 */
export function generateTrueVectorPDF(context, userInput, mode) {
    // Step 8) Handle call signatures
    if (!userInput && context.userInput) {
        userInput = context.userInput;
    }
    if (!mode && context.mode) {
        mode = context.mode;
    }
    if (!userInput) {
        userInput = {
            blastName: "Untitled Blast",
            designer: "",
            notes: "",
            outputType: "vector"
        };
    }
    if (!mode) {
        mode = context.is3DMode ? "3D" : "2D";
    }

    var allBlastHoles = context.allBlastHoles;
    var allKADDrawingsMap = context.allKADDrawingsMap;
    var allAvailableSurfaces = context.allAvailableSurfaces;
    var loadedSurfaces = context.loadedSurfaces;
    var loadedImages = context.loadedImages;
    var showModalMessage = context.showModalMessage;
    var FloatingDialog = context.FloatingDialog;
    var printPaperSize = context.printPaperSize;
    var printOrientation = context.printOrientation;
    var getVoronoiMetrics = context.getVoronoiMetrics;
    var buildVersion = context.buildVersion;
    var getDisplayOptions = context.getDisplayOptions;
    var simplifyByPxDist = context.simplifyByPxDist;

    // Step 9) Check for data - allow printing if surfaces or images are loaded
    var hasSurfaces = (loadedSurfaces && loadedSurfaces.size > 0) || (allAvailableSurfaces && allAvailableSurfaces.length > 0);
    var hasImages = loadedImages && loadedImages.size > 0;
    var hasBlastHoles = allBlastHoles && allBlastHoles.length > 0;
    var hasKAD = allKADDrawingsMap && allKADDrawingsMap.size > 0;

    if (!hasBlastHoles && !hasKAD && !hasSurfaces && !hasImages) {
        showModalMessage("No Data", "No data available for printing", "warning");
        return;
    }

    // Step 10) Create progress dialog
    var progressContent = document.createElement("div");
    progressContent.style.textAlign = "center";
    progressContent.innerHTML = '<p>Generating Vector PDF</p>' +
        '<p>Please wait...</p>' +
        '<div style="width: 100%; background-color: #333; border-radius: 5px; margin: 20px 0;">' +
        '<div id="pdfProgressBar" style="width: 0%; height: 20px; background-color: #4CAF50; border-radius: 5px; transition: width 0.3s;"></div>' +
        '</div>' +
        '<p id="pdfProgressText">Starting...</p>';

    var progressDialog = new FloatingDialog({
        title: "Vector PDF Generation",
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

    // Step 11) Pre-load QR code
    var qrCodeDataURL = null;
    var qrImg = new Image();
    qrImg.crossOrigin = "anonymous";
    qrImg.onload = function() {
        try {
            var qrCanvas = document.createElement("canvas");
            qrCanvas.width = 110;
            qrCanvas.height = 110;
            var qrCtx = qrCanvas.getContext("2d");
            qrCtx.drawImage(qrImg, 0, 0, 110, 110);
            qrCodeDataURL = qrCanvas.toDataURL("image/png");
        } catch (e) {
            console.warn("Failed to prepare QR code:", e);
        }
    };
    qrImg.onerror = function() {
        console.warn("QR code image not found");
    };
    qrImg.src = "icons/kirra2d-qr-code.png";

    // Step 12) Wait for QR code, then generate PDF
    setTimeout(function() {
        try {
            bar.style.width = "10%";
            text.textContent = "Setting up page...";

            // Step 12a) Get paper dimensions
            var paperDims = getPaperDimensions(printPaperSize, printOrientation);
            var pageWidth = paperDims.width;
            var pageHeight = paperDims.height;

            // Step 12b) Get template and layout manager
            var template = getTemplate(mode, printOrientation);
            var layoutMgr = new PrintLayoutManager(template, pageWidth, pageHeight);

            // Step 12c) Create PDF
            var orientation = printOrientation === "landscape" ? "l" : "p";
            var pdf = new jsPDF(orientation, "mm", printPaperSize.toLowerCase());

            // Step 12d) Get zone positions
            var mapZone = layoutMgr.getMapZone();
            var mapInnerZone = layoutMgr.getMapInnerZone();
            var footerZone = layoutMgr.getFooterZone();
            var footerColumns = layoutMgr.getFooterColumns();
            var titleBlockRows = layoutMgr.getTitleBlockRows();
            var navLogoRows = layoutMgr.getNavLogoRows();

            bar.style.width = "20%";
            text.textContent = "Drawing map zone...";

            // ============== MAP ZONE ==============
            
            // Step 13) Draw map zone border
            drawCellBorder(pdf, mapZone.x, mapZone.y, mapZone.width, mapZone.height, 0.3);

            // Step 13a) For 3D mode, capture WebGL canvas as image (WYSIWYG - camera orientation preserved)
            // 3D data cannot be re-rendered from world coordinates because camera could be at any angle
            var is3DMode = mode === "3D";
            var captured3DImage = null;
            var printScale = 1; // Default for footer scale calculation
            
            // Resolution multiplier for 3D capture (2 = 2x resolution, 3 = 3x, etc.)
            // Higher = better print quality but larger file size
            var hiResMultiplier = 3; // 3x resolution for print quality
            
            console.log("[3D Print] Mode: " + mode + ", is3DMode: " + is3DMode + ", threeRenderer available: " + !!context.threeRenderer);
            
            if (is3DMode && context.threeRenderer) {
                bar.style.width = "25%";
                text.textContent = "Capturing 3D view at " + hiResMultiplier + "x resolution...";
                
                try {
                    // Step 13b) Get the WebGL canvas and renderer
                    var threeCanvas = context.threeRenderer.getCanvas();
                    var renderer = context.threeRenderer.renderer;
                    var canvasRect = threeCanvas ? threeCanvas.getBoundingClientRect() : null;
                    
                    console.log("[3D Print] ThreeJS canvas display: " + (canvasRect ? (canvasRect.width + "x" + canvasRect.height) : "null"));
                    
                    if (threeCanvas && renderer) {
                        // Get print boundary info for cropping
                        var boundary3D = context.get3DPrintBoundary ? context.get3DPrintBoundary() : null;
                        console.log("[3D Print] Boundary3D (display coords): " + JSON.stringify(boundary3D));
                        
                        // Step 13b2) Save original renderer state
                        var originalWidth = threeCanvas.width;
                        var originalHeight = threeCanvas.height;
                        var originalPixelRatio = renderer.getPixelRatio();
                        var displayWidth = canvasRect.width;
                        var displayHeight = canvasRect.height;
                        
                        console.log("[3D Print] Original canvas: " + originalWidth + "x" + originalHeight + " @ pixelRatio " + originalPixelRatio);
                        
                        // Step 13b3) Resize renderer to high resolution
                        var hiResWidth = Math.round(displayWidth * hiResMultiplier);
                        var hiResHeight = Math.round(displayHeight * hiResMultiplier);
                        
                        console.log("[3D Print] Rendering at hi-res: " + hiResWidth + "x" + hiResHeight);
                        
                        // Temporarily resize renderer for high-res capture
                        renderer.setPixelRatio(1); // Set to 1 so setSize gives us exact dimensions
                        renderer.setSize(hiResWidth, hiResHeight, false); // false = don't update style
                        
                        // Update camera aspect/frustum if needed (orthographic camera)
                        var camera = context.threeRenderer.camera;
                        if (camera && camera.isOrthographicCamera) {
                            // For orthographic, the frustum is already set based on world units
                            // Just need to ensure the aspect ratio is maintained
                            camera.updateProjectionMatrix();
                        }
                        
                        // Step 13b4) Force render at high resolution
                        context.threeRenderer.render();
                        
                        // Step 13b5) Capture the high-res canvas
                        var hiResCanvas = renderer.domElement;
                        console.log("[3D Print] Hi-res canvas actual size: " + hiResCanvas.width + "x" + hiResCanvas.height);
                        
                        // Create crop canvas for the boundary region at high resolution
                        var cropCanvas = document.createElement("canvas");
                        var cropCtx = cropCanvas.getContext("2d");
                        
                        if (boundary3D && boundary3D.width > 0 && boundary3D.height > 0) {
                            // Scale boundary from display coords to hi-res coords
                            var srcX = boundary3D.x * hiResMultiplier;
                            var srcY = boundary3D.y * hiResMultiplier;
                            var srcW = boundary3D.width * hiResMultiplier;
                            var srcH = boundary3D.height * hiResMultiplier;
                            
                            console.log("[3D Print] Hi-res crop region: x=" + srcX.toFixed(0) + " y=" + srcY.toFixed(0) + " w=" + srcW.toFixed(0) + " h=" + srcH.toFixed(0));
                            
                            cropCanvas.width = srcW;
                            cropCanvas.height = srcH;
                            cropCtx.drawImage(
                                hiResCanvas,
                                srcX, srcY,
                                srcW, srcH,
                                0, 0,
                                srcW, srcH
                            );
                        } else {
                            // No boundary - use full hi-res canvas
                            cropCanvas.width = hiResCanvas.width;
                            cropCanvas.height = hiResCanvas.height;
                            cropCtx.drawImage(hiResCanvas, 0, 0);
                        }
                        
                        // Step 13b6) Restore original renderer size
                        renderer.setPixelRatio(originalPixelRatio);
                        renderer.setSize(displayWidth, displayHeight, false);
                        
                        // Re-render at original size to restore display
                        context.threeRenderer.render();
                        
                        console.log("[3D Print] Renderer restored to: " + renderer.domElement.width + "x" + renderer.domElement.height);
                        
                        // Step 13b7) Convert to data URL
                        captured3DImage = cropCanvas.toDataURL("image/png", 1.0);
                        console.log("[3D Print] Captured hi-res image: " + cropCanvas.width + "x" + cropCanvas.height + " (" + (captured3DImage.length / 1024).toFixed(0) + " KB)");
                        
                        // Calculate approximate print scale for footer display
                        if (context.cameraControls) {
                            var cameraState = context.cameraControls.getCameraState();
                            printScale = cameraState.scale || 1;
                            console.log("[3D Print] Camera scale: " + printScale);
                        }
                    }
                } catch (e) {
                    console.error("[3D Print] Failed to capture 3D view:", e);
                }
                
                // Step 13c) Insert 3D captured image into map zone
                if (captured3DImage && captured3DImage.length > 100) {
                    bar.style.width = "50%";
                    text.textContent = "Adding 3D view to PDF...";
                    
                    try {
                        // Add the captured image to fill the map zone
                        pdf.addImage(captured3DImage, "PNG", mapZone.x, mapZone.y, mapZone.width, mapZone.height);
                        console.log("[3D Print] Image added to PDF at mapZone: " + mapZone.x + "," + mapZone.y + " size: " + mapZone.width + "x" + mapZone.height);
                    } catch (e) {
                        console.error("[3D Print] Failed to add 3D image to PDF:", e);
                    }
                } else {
                    console.warn("[3D Print] No valid 3D image captured - map zone will be blank");
                }
                
                // Skip to footer section - 3D map content is from captured image
                bar.style.width = "70%";
                text.textContent = "Drawing footer...";
            } else if (is3DMode && !context.threeRenderer) {
                console.error("[3D Print] 3D mode but threeRenderer not available in context!");
            }
            
            // Step 14) Calculate WYSIWYG coordinate transformation (2D mode only)
            // For 3D mode, the captured WebGL image already contains all data
            var canvas = context.canvas;
            var screenBoundary = getPrintBoundary(canvas);
            
            // 2D mode requires print boundary for coordinate transformation
            if (!is3DMode && !screenBoundary) {
                throw new Error("Print Preview Mode must be active");
            }
            
            // Variables for 2D coordinate transformation (only used in 2D mode)
            var worldToPDF = null;
            var innerBoundary = null;
            
            if (!is3DMode && screenBoundary) {
                // Use the inner boundary for coordinate transformation
                // This is the area where data should be positioned (inside the black template border)
                innerBoundary = {
                    x: screenBoundary.innerX !== undefined ? screenBoundary.innerX : screenBoundary.x + screenBoundary.width * screenBoundary.marginPercent,
                    y: screenBoundary.innerY !== undefined ? screenBoundary.innerY : screenBoundary.y + screenBoundary.height * screenBoundary.marginPercent,
                    width: screenBoundary.innerWidth !== undefined ? screenBoundary.innerWidth : screenBoundary.width * (1 - 2 * screenBoundary.marginPercent),
                    height: screenBoundary.innerHeight !== undefined ? screenBoundary.innerHeight : screenBoundary.height * (1 - 2 * screenBoundary.marginPercent)
                };

                // Convert screen to world coordinates
                var world_x1 = (innerBoundary.x - canvas.width / 2) / context.currentScale + context.centroidX;
                var world_y1 = -(innerBoundary.y + innerBoundary.height - canvas.height / 2) / context.currentScale + context.centroidY;
                var world_x2 = (innerBoundary.x + innerBoundary.width - canvas.width / 2) / context.currentScale + context.centroidX;
                var world_y2 = -(innerBoundary.y - canvas.height / 2) / context.currentScale + context.centroidY;

                var minX = Math.min(world_x1, world_x2);
                var maxX = Math.max(world_x1, world_x2);
                var minY = Math.min(world_y1, world_y2);
                var maxY = Math.max(world_y1, world_y2);

                var dataWidth = maxX - minX;
                var dataHeight = maxY - minY;
                if (dataWidth <= 0 || dataHeight <= 0) {
                    throw new Error("Invalid data dimensions");
                }

                // Calculate scale to fit in map inner zone
                var scaleX = mapInnerZone.width / dataWidth;
                var scaleY = mapInnerZone.height / dataHeight;
                printScale = Math.min(scaleX, scaleY);

                var scaledWidth = dataWidth * printScale;
                var scaledHeight = dataHeight * printScale;
                var offsetX = mapInnerZone.x + (mapInnerZone.width - scaledWidth) / 2;
                var offsetY = mapInnerZone.y + (mapInnerZone.height - scaledHeight) / 2;

                var printCentroidX = minX + dataWidth / 2;
                var printCentroidY = minY + dataHeight / 2;

                // Step 15) World to PDF transformation function (2D mode only)
                worldToPDF = function(worldX, worldY) {
                    var centerX = offsetX + scaledWidth / 2;
                    var centerY = offsetY + scaledHeight / 2;
                    var x = (worldX - printCentroidX) * printScale + centerX;
                    var y = -(worldY - printCentroidY) * printScale + centerY;
                    return [x, y];
                };
            }

            // Note: Line clipping uses clipLineToRect() and isPointInRect() defined at top of file
            // For 3D mode, skip 2D data rendering (use captured WebGL image instead)
            
            if (!is3DMode) {
                bar.style.width = "30%";
                text.textContent = "Drawing background images...";

            // Step 16) Render background images as raster layer
            if (loadedImages && loadedImages.size > 0) {
                var dpi = 150; // Lower DPI for images to keep file size reasonable
                var mmToPx = dpi / 25.4;
                var imgCanvas = document.createElement("canvas");
                imgCanvas.width = mapZone.width * mmToPx;
                imgCanvas.height = mapZone.height * mmToPx;
                var imgCtx = imgCanvas.getContext("2d");
                imgCtx.fillStyle = "white";
                imgCtx.fillRect(0, 0, imgCanvas.width, imgCanvas.height);

                loadedImages.forEach(function(image) {
                    if (image.visible === false || !image.canvas) return;
                    var bbox = image.bbox;
                    if (bbox && bbox.length >= 4) {
                        var coords1 = worldToPDF(bbox[0], bbox[3]);
                        var coords2 = worldToPDF(bbox[2], bbox[1]);
                        var px1 = (coords1[0] - mapZone.x) * mmToPx;
                        var py1 = (coords1[1] - mapZone.y) * mmToPx;
                        var px2 = (coords2[0] - mapZone.x) * mmToPx;
                        var py2 = (coords2[1] - mapZone.y) * mmToPx;
                        var width = Math.abs(px2 - px1);
                        var height = Math.abs(py2 - py1);

                        imgCtx.save();
                        imgCtx.globalAlpha = image.transparency !== undefined ? image.transparency : 1.0;
                        imgCtx.drawImage(image.canvas, Math.min(px1, px2), Math.min(py1, py2), width, height);
                        imgCtx.restore();
                    }
                });

                try {
                    var imgData = imgCanvas.toDataURL("image/png", 0.9);
                    if (imgData && imgData.length > 100) {
                        pdf.addImage(imgData, "PNG", mapZone.x, mapZone.y, mapZone.width, mapZone.height);
                    }
                } catch (e) {
                    console.warn("Failed to add background images:", e);
                }
            }

            bar.style.width = "40%";
            text.textContent = "Drawing surfaces...";

            // Step 17) Draw surfaces as vector triangles
            if (loadedSurfaces && loadedSurfaces.size > 0) {
                var allMinZ = Infinity;
                var allMaxZ = -Infinity;

                loadedSurfaces.forEach(function(surface) {
                    if (surface.visible === false || surface.isTexturedMesh) return;
                    if (surface.points && surface.points.length > 0) {
                        surface.points.forEach(function(point) {
                            if (point.z < allMinZ) allMinZ = point.z;
                            if (point.z > allMaxZ) allMaxZ = point.z;
                        });
                    }
                });

                if (allMinZ !== Infinity && allMaxZ !== -Infinity) {
                    loadedSurfaces.forEach(function(surface) {
                        if (surface.visible === false || surface.isTexturedMesh) return;
                        if (surface.triangles && surface.triangles.length > 0) {
                            surface.triangles.forEach(function(triangle) {
                                var v1 = triangle.vertices[0];
                                var v2 = triangle.vertices[1];
                                var v3 = triangle.vertices[2];

                                var c1 = worldToPDF(v1.x, v1.y);
                                var c2 = worldToPDF(v2.x, v2.y);
                                var c3 = worldToPDF(v3.x, v3.y);

                                var avgZ = (v1.z + v2.z + v3.z) / 3;
                                var color = "#888888";
                                if (context.elevationToColor && allMaxZ > allMinZ) {
                                    color = context.elevationToColor(avgZ, allMinZ, allMaxZ);
                                }

                                var rgb = rgbaToRgb(color);
                                pdf.setFillColor(rgb.r, rgb.g, rgb.b);
                                pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
                                pdf.setLineWidth(0.05);
                                pdf.triangle(c1[0], c1[1], c2[0], c2[1], c3[0], c3[1], "FD");
                            });
                        }
                    });
                }
            }

            // Step 17a-pre) Define visibleBlastHoles and displayOptions early for slope/relief/voronoi
            var visibleBlastHoles = allBlastHoles ? allBlastHoles.filter(function(hole) { return hole.visible !== false; }) : [];
            var displayOptions = getDisplayOptions ? getDisplayOptions() : {};

            bar.style.width = "45%";
            text.textContent = "Drawing slope/relief/voronoi...";

            // Step 17a) Draw slope map triangles
            if (displayOptions.slopeMap && context.delaunayTriangles && visibleBlastHoles.length > 0) {
                try {
                    var triangleResult = context.delaunayTriangles(visibleBlastHoles, context.maxEdgeLength);
                    var resultTriangles = triangleResult.resultTriangles;

                    if (resultTriangles && resultTriangles.length > 0) {
                        for (var ti = 0; ti < resultTriangles.length; ti++) {
                            var triangle = resultTriangles[ti];
                            var tAX = triangle[0][0], tAY = triangle[0][1];
                            var tBX = triangle[1][0], tBY = triangle[1][1];
                            var tCX = triangle[2][0], tCY = triangle[2][1];

                            // Get dip angle for coloring
                            var maxSlopeAngle = context.getDipAngle ? context.getDipAngle(triangle) : 0;

                            // Get slope color based on angle
                            var slopeColor = getSlopeColorPDF(maxSlopeAngle);

                            // Transform to PDF coordinates
                            var c1 = worldToPDF(tAX, tAY);
                            var c2 = worldToPDF(tBX, tBY);
                            var c3 = worldToPDF(tCX, tCY);

                            // Draw filled triangle
                            pdf.setFillColor(slopeColor.r, slopeColor.g, slopeColor.b);
                            pdf.setDrawColor(100, 100, 100);
                            pdf.setLineWidth(0.05);
                            pdf.triangle(c1[0], c1[1], c2[0], c2[1], c3[0], c3[1], "FD");
                        }

                        // Draw slope angle text on triangles
                        pdf.setFontSize(3);
                        pdf.setTextColor(0, 0, 0);
                        for (var ti = 0; ti < resultTriangles.length; ti++) {
                            var triangle = resultTriangles[ti];
                            var centroidX = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
                            var centroidY = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;
                            var maxSlopeAngle = context.getDipAngle ? context.getDipAngle(triangle) : 0;
                            var centroidCoords = worldToPDF(centroidX, centroidY);
                            if (isPointInRect(centroidCoords[0], centroidCoords[1], mapZone)) {
                                pdf.text(parseFloat(maxSlopeAngle).toFixed(1), centroidCoords[0], centroidCoords[1], { align: "center" });
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to draw slope map:", e);
                }
            }

            // Step 17b) Draw burden relief map triangles
            if (displayOptions.burdenRelief && context.delaunayTriangles && visibleBlastHoles.length > 0) {
                try {
                    var triangleResult = context.delaunayTriangles(visibleBlastHoles, context.maxEdgeLength);
                    var reliefTriangles = triangleResult.reliefTriangles;

                    if (reliefTriangles && reliefTriangles.length > 0) {
                        for (var ti = 0; ti < reliefTriangles.length; ti++) {
                            var triangle = reliefTriangles[ti];
                            var tAX = triangle[0][0], tAY = triangle[0][1];
                            var tBX = triangle[1][0], tBY = triangle[1][1];
                            var tCX = triangle[2][0], tCY = triangle[2][1];

                            // Get burden relief for coloring
                            var burdenRelief = context.getBurdenRelief ? context.getBurdenRelief(triangle) : 0;

                            // Get relief color based on value
                            var reliefColor = getReliefColorPDF(burdenRelief);

                            // Transform to PDF coordinates
                            var c1 = worldToPDF(tAX, tAY);
                            var c2 = worldToPDF(tBX, tBY);
                            var c3 = worldToPDF(tCX, tCY);

                            // Draw filled triangle
                            pdf.setFillColor(reliefColor.r, reliefColor.g, reliefColor.b);
                            pdf.setDrawColor(100, 100, 100);
                            pdf.setLineWidth(0.05);
                            pdf.triangle(c1[0], c1[1], c2[0], c2[1], c3[0], c3[1], "FD");
                        }

                        // Draw burden relief text on triangles
                        pdf.setFontSize(3);
                        pdf.setTextColor(0, 0, 0);
                        for (var ti = 0; ti < reliefTriangles.length; ti++) {
                            var triangle = reliefTriangles[ti];
                            var centroidX = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
                            var centroidY = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;
                            var burdenRelief = context.getBurdenRelief ? context.getBurdenRelief(triangle) : 0;
                            var centroidCoords = worldToPDF(centroidX, centroidY);
                            if (isPointInRect(centroidCoords[0], centroidCoords[1], mapZone)) {
                                pdf.text(parseFloat(burdenRelief).toFixed(1), centroidCoords[0], centroidCoords[1], { align: "center" });
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to draw burden relief map:", e);
                }
            }

            // Step 17c) Draw voronoi cells
            if (displayOptions.voronoiPF && context.getVoronoiMetrics && context.clipVoronoiCells && visibleBlastHoles.length > 0) {
                try {
                    var voronoiMetrics = context.getVoronoiMetrics(visibleBlastHoles, context.useToeLocation);
                    var clippedCells = context.clipVoronoiCells(voronoiMetrics);

                    if (clippedCells && clippedCells.length > 0) {
                        // Determine which metric to use and get the matching color function from context
                        var selectedMetric = context.selectedVoronoiMetric || "powderFactor";
                        var isVoronoiLegendFixed = context.isVoronoiLegendFixed || false;

                        // Calculate min/max for the selected metric - MUST match app's logic in kirra.js
                        var values = clippedCells.map(function(c) { return c[selectedMetric]; }).filter(function(v) { return v != null && !isNaN(v); });
                        var minVal, maxVal;
                        var getColorFunc = null;

                        // Each metric has specific min/max rules - match exactly what kirra.js does
                        switch (selectedMetric) {
                            case "powderFactor":
                                getColorFunc = context.getPFColor;
                                if (isVoronoiLegendFixed) {
                                    minVal = 0; maxVal = 3;
                                } else {
                                    minVal = 0; // App always uses 0 for PF min (not actual min)
                                    maxVal = values.length > 0 ? Math.max.apply(null, values) : 3;
                                }
                                break;
                            case "mass":
                                getColorFunc = context.getMassColor;
                                if (isVoronoiLegendFixed) {
                                    minVal = 0; maxVal = 1000;
                                } else {
                                    minVal = values.length > 0 ? Math.min.apply(null, values) : 0;
                                    maxVal = values.length > 0 ? Math.max.apply(null, values) : 500;
                                }
                                break;
                            case "volume":
                                getColorFunc = context.getVolumeColor;
                                if (isVoronoiLegendFixed) {
                                    minVal = 0; maxVal = 250;
                                } else {
                                    minVal = values.length > 0 ? Math.min.apply(null, values) : 0;
                                    maxVal = values.length > 0 ? Math.max.apply(null, values) : 100;
                                }
                                break;
                            case "area":
                                getColorFunc = context.getAreaColor;
                                if (isVoronoiLegendFixed) {
                                    minVal = 0; maxVal = 250;
                                } else {
                                    minVal = values.length > 0 ? Math.min.apply(null, values) : 0;
                                    maxVal = values.length > 0 ? Math.max.apply(null, values) : 100;
                                }
                                break;
                            case "measuredLength":
                                getColorFunc = context.getLengthColor;
                                if (isVoronoiLegendFixed) {
                                    minVal = 0; maxVal = 30;
                                } else {
                                    minVal = values.length > 0 ? Math.min.apply(null, values) : 0;
                                    maxVal = values.length > 0 ? Math.max.apply(null, values) : 20;
                                }
                                break;
                            case "designedLength":
                                getColorFunc = context.getLengthColor;
                                if (isVoronoiLegendFixed) {
                                    minVal = 0; maxVal = 30;
                                } else {
                                    minVal = values.length > 0 ? Math.min.apply(null, values) : 0;
                                    maxVal = values.length > 0 ? Math.max.apply(null, values) : 20;
                                }
                                break;
                            case "holeFiringTime":
                                getColorFunc = context.getHoleFiringTimeColor;
                                if (isVoronoiLegendFixed) {
                                    minVal = 0; maxVal = 10000;
                                } else {
                                    minVal = values.length > 0 ? Math.min.apply(null, values) : 0;
                                    maxVal = values.length > 0 ? Math.max.apply(null, values) : 5000;
                                }
                                break;
                            default:
                                getColorFunc = context.getPFColor;
                                minVal = 0;
                                maxVal = values.length > 0 ? Math.max.apply(null, values) : 3;
                                break;
                        }

                        // Handle edge case where min equals max
                        if (maxVal - minVal <= 0) {
                            minVal = 0;
                            maxVal = 1;
                        }

                        for (var ci = 0; ci < clippedCells.length; ci++) {
                            var cell = clippedCells[ci];
                            if (!cell.polygon || cell[selectedMetric] == null) continue;

                            // Get color using the app's actual color function (returns "rgb(r,g,b)" string)
                            var colorStr = getColorFunc ? getColorFunc(cell[selectedMetric], minVal, maxVal) : "rgb(128,128,128)";
                            var cellColor = parseRgbString(colorStr);

                            // Convert polygon points to PDF coordinates (handle both {x,y} objects and [x,y] arrays)
                            var pdfPolygon = cell.polygon.map(function(pt) {
                                var x = pt.x !== undefined ? pt.x : pt[0];
                                var y = pt.y !== undefined ? pt.y : pt[1];
                                return worldToPDF(x, y);
                            });

                            // Clip polygon to map zone using Sutherland-Hodgman algorithm
                            var clippedPolygon = clipPolygonToRect(pdfPolygon, mapZone);

                            if (clippedPolygon.length >= 3) {
                                // Draw filled polygon
                                pdf.setFillColor(cellColor.r, cellColor.g, cellColor.b);
                                pdf.setDrawColor(100, 100, 100);
                                pdf.setLineWidth(0.05);

                                // Build polygon path using lines
                                var firstPt = clippedPolygon[0];
                                var pathSegments = [];
                                for (var pi = 1; pi < clippedPolygon.length; pi++) {
                                    pathSegments.push([clippedPolygon[pi][0] - clippedPolygon[pi-1][0], clippedPolygon[pi][1] - clippedPolygon[pi-1][1]]);
                                }
                                // Close the polygon
                                pathSegments.push([firstPt[0] - clippedPolygon[clippedPolygon.length-1][0], firstPt[1] - clippedPolygon[clippedPolygon.length-1][1]]);

                                pdf.lines(pathSegments, firstPt[0], firstPt[1], [1, 1], "FD", true);
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to draw voronoi cells:", e);
                }
            }

            bar.style.width = "50%";
            text.textContent = "Drawing KAD entities...";

            // Step 18) Draw KAD entities as vectors
            if (allKADDrawingsMap && allKADDrawingsMap.size > 0) {
                allKADDrawingsMap.forEach(function(entity, name) {
                    if (entity.visible === false) return;

                    if (entity.entityType === "point") {
                        var simplifiedPoints = simplifyByPxDist ? simplifyByPxDist(entity.data, 3) : entity.data;
                        simplifiedPoints.forEach(function(point) {
                            var coords = worldToPDF(point.pointXLocation, point.pointYLocation);
                            // Clip: only draw if point is inside mapZone
                            if (isPointInRect(coords[0], coords[1], mapZone)) {
                                var rgb = hexToRgb(point.color || "#000000");
                                pdf.setFillColor(rgb.r, rgb.g, rgb.b);
                                pdf.circle(coords[0], coords[1], 0.3, "F");
                            }
                        });
                    } else if (entity.entityType === "circle") {
                        entity.data.forEach(function(circle) {
                            var coords = worldToPDF(circle.pointXLocation, circle.pointYLocation);
                            var radiusMM = circle.radius * printScale;
                            // Use clipped circle drawing
                            var rgb = hexToRgb(circle.color || "#000000");
                            pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
                            pdf.setLineWidth((circle.lineWidth || 1) * 0.1);
                            drawClippedCircle(pdf, coords[0], coords[1], radiusMM, mapZone, "S");
                        });
                    } else if (entity.entityType === "text") {
                        entity.data.forEach(function(textData) {
                            if (textData && textData.text) {
                                var coords = worldToPDF(textData.pointXLocation, textData.pointYLocation);
                                // Clip: only draw if text position is inside mapZone
                                if (isPointInRect(coords[0], coords[1], mapZone)) {
                                    var rgb = hexToRgb(textData.color || "#000000");
                                    pdf.setTextColor(rgb.r, rgb.g, rgb.b);
                                    pdf.setFontSize(8);
                                    pdf.text(String(textData.text), coords[0], coords[1]);
                                }
                            }
                        });
                    } else if (entity.entityType === "line" || entity.entityType === "poly") {
                        var points = entity.data;
                        if (points.length >= 2) {
                            var rgb = hexToRgb(points[0].color || "#000000");
                            pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
                            pdf.setLineWidth((points[0].lineWidth || 1) * 0.1);

                            // Draw line segments with clipping to mapZone
                            for (var i = 0; i < points.length - 1; i++) {
                                var c1 = worldToPDF(points[i].pointXLocation, points[i].pointYLocation);
                                var c2 = worldToPDF(points[i + 1].pointXLocation, points[i + 1].pointYLocation);
                                var clipped = clipLineToRect(c1[0], c1[1], c2[0], c2[1], mapZone);
                                if (clipped) {
                                    pdf.line(clipped.x1, clipped.y1, clipped.x2, clipped.y2);
                                }
                            }

                            // Close polygon if poly type
                            if (entity.entityType === "poly" && points.length > 2) {
                                var cLast = worldToPDF(points[points.length - 1].pointXLocation, points[points.length - 1].pointYLocation);
                                var cFirst = worldToPDF(points[0].pointXLocation, points[0].pointYLocation);
                                var clippedClose = clipLineToRect(cLast[0], cLast[1], cFirst[0], cFirst[1], mapZone);
                                if (clippedClose) {
                                    pdf.line(clippedClose.x1, clippedClose.y1, clippedClose.x2, clippedClose.y2);
                                }
                            }
                        }
                    }
                });
            }

            bar.style.width = "60%";
            text.textContent = "Drawing blast holes...";

            // Step 19) Draw blast holes as vectors (visibleBlastHoles and displayOptions already defined above)
            var toeSizeInMeters = parseFloat(document.getElementById("toeSlider")?.value || 3);
            var printHoleScale = parseFloat(document.getElementById("holeSize")?.value || 3);

            visibleBlastHoles.forEach(function(hole) {
                var collarCoords = worldToPDF(hole.startXLocation, hole.startYLocation);
                var gradeCoords = worldToPDF(hole.gradeXLocation, hole.gradeYLocation);
                var toeCoords = worldToPDF(hole.endXLocation, hole.endYLocation);

                // Check if collar is inside mapZone (for elements that need it)
                var collarInside = isPointInRect(collarCoords[0], collarCoords[1], mapZone);
                var toeInside = isPointInRect(toeCoords[0], toeCoords[1], mapZone);

                // Draw collar-to-toe track if angled - use line clipping
                if (hole.holeAngle > 0) {
                    pdf.setLineWidth(0.1);
                    if (hole.subdrillAmount < 0) {
                        // Collar to toe line
                        var clip1 = clipLineToRect(collarCoords[0], collarCoords[1], toeCoords[0], toeCoords[1], mapZone);
                        if (clip1) {
                            pdf.setDrawColor(0, 0, 0);
                            pdf.line(clip1.x1, clip1.y1, clip1.x2, clip1.y2);
                        }
                        // Toe to grade line
                        var clip2 = clipLineToRect(toeCoords[0], toeCoords[1], gradeCoords[0], gradeCoords[1], mapZone);
                        if (clip2) {
                            pdf.setDrawColor(255, 200, 200);
                            pdf.line(clip2.x1, clip2.y1, clip2.x2, clip2.y2);
                        }
                    } else {
                        // Collar to grade line
                        var clip3 = clipLineToRect(collarCoords[0], collarCoords[1], gradeCoords[0], gradeCoords[1], mapZone);
                        if (clip3) {
                            pdf.setDrawColor(0, 0, 0);
                            pdf.line(clip3.x1, clip3.y1, clip3.x2, clip3.y2);
                        }
                        // Grade to toe line
                        var clip4 = clipLineToRect(gradeCoords[0], gradeCoords[1], toeCoords[0], toeCoords[1], mapZone);
                        if (clip4) {
                            pdf.setDrawColor(255, 0, 0);
                            pdf.line(clip4.x1, clip4.y1, clip4.x2, clip4.y2);
                        }
                    }
                }

                // Draw toe with clipping - visible portion only
                if (parseFloat(hole.holeLengthCalculated).toFixed(1) != "0.0") {
                    var toeRadius = toeSizeInMeters * printScale;
                    pdf.setDrawColor(0, 0, 0);
                    pdf.setLineWidth(0.15);
                    drawClippedCircle(pdf, toeCoords[0], toeCoords[1], toeRadius, mapZone, "S");
                }

                // Draw collar - only if collar is inside mapZone (GEOMETRY ONLY - labels drawn later)
                if (collarInside) {
                    var holeRadius = (hole.holeDiameter / 1000 / 2) * printHoleScale * printScale * 0.14;
                    holeRadius = Math.max(holeRadius, 0.5); // Minimum radius
                    pdf.setFillColor(0, 0, 0);
                    pdf.setDrawColor(0, 0, 0);
                    pdf.circle(collarCoords[0], collarCoords[1], holeRadius, "F");
                }
            });

            bar.style.width = "65%";
            text.textContent = "Drawing connectors...";

            // Step 19a) Draw connectors (arrows between holes) - with line clipping
            if (displayOptions.connector) {
                var connScale = parseFloat(document.getElementById("connSlider")?.value || 17);
                var holeMap = new Map();
                visibleBlastHoles.forEach(function(hole) {
                    var key = hole.entityName + ":::" + hole.holeID;
                    holeMap.set(key, hole);
                });

                visibleBlastHoles.forEach(function(hole) {
                    if (hole.fromHoleID) {
                        try {
                            var parts = hole.fromHoleID.split(":::");
                            if (parts.length === 2) {
                                var fromKey = parts[0] + ":::" + parts[1];
                                var fromHole = holeMap.get(fromKey);
                                if (fromHole) {
                                    var startCoords = worldToPDF(fromHole.startXLocation, fromHole.startYLocation);
                                    var endCoords = worldToPDF(hole.startXLocation, hole.startYLocation);
                                    var connColor = hole.colorHexDecimal || "#000000";
                                    var curve = hole.connectorCurve || 0;
                                    
                                    // Convert color to RGB
                                    var rgb = hexToRgb(connColor);
                                    pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
                                    pdf.setFillColor(rgb.r, rgb.g, rgb.b);
                                    
                                    // Calculate arrow size based on scale
                                    var arrowLength = (connScale / 4) * printScale * 2;
                                    var arrowWidth = (connScale / 4) * printScale;
                                    
                                    // Check if end point is inside for arrowhead
                                    var endInside = isPointInRect(endCoords[0], endCoords[1], mapZone);
                                    
                                    if (curve === 0) {
                                        // Straight connector - clip line to mapZone
                                        var clippedConn = clipLineToRect(startCoords[0], startCoords[1], endCoords[0], endCoords[1], mapZone);
                                        if (clippedConn) {
                                            pdf.setLineWidth(0.2);
                                            pdf.line(clippedConn.x1, clippedConn.y1, clippedConn.x2, clippedConn.y2);
                                        }

                                        // Draw arrowhead only if end point is inside mapZone
                                        if (endInside) {
                                            var angle = Math.atan2(endCoords[1] - startCoords[1], endCoords[0] - startCoords[0]);
                                            var arrowX1 = endCoords[0] - arrowLength * Math.cos(angle - Math.PI / 6);
                                            var arrowY1 = endCoords[1] - arrowLength * Math.sin(angle - Math.PI / 6);
                                            var arrowX2 = endCoords[0] - arrowLength * Math.cos(angle + Math.PI / 6);
                                            var arrowY2 = endCoords[1] - arrowLength * Math.sin(angle + Math.PI / 6);
                                            pdf.triangle(endCoords[0], endCoords[1], arrowX1, arrowY1, arrowX2, arrowY2, "F");
                                        }

                                        // Draw delay text at midpoint of connector
                                        var delayMs = hole.timingDelayMilliseconds;
                                        if (delayMs !== undefined && delayMs !== null && displayOptions.delayValue) {
                                            var midX = (startCoords[0] + endCoords[0]) / 2;
                                            var midY = (startCoords[1] + endCoords[1]) / 2;
                                            if (isPointInRect(midX, midY, mapZone)) {
                                                var txtColor = getContrastColor(connColor);
                                                var txtRgb = hexToRgb(txtColor);
                                                pdf.setTextColor(txtRgb.r, txtRgb.g, txtRgb.b);
                                                pdf.setFontSize(5);
                                                pdf.setFont("helvetica", "normal");
                                                pdf.text(String(delayMs), midX, midY - 0.5, { align: "center" });
                                            }
                                        }
                                    } else {
                                        // Curved connector - clip each segment
                                        var midX = (startCoords[0] + endCoords[0]) / 2;
                                        var midY = (startCoords[1] + endCoords[1]) / 2;
                                        var dx = endCoords[0] - startCoords[0];
                                        var dy = endCoords[1] - startCoords[1];
                                        var distance = Math.sqrt(dx * dx + dy * dy);
                                        
                                        var curveFactor = (curve / 90) * distance * 0.5;
                                        var perpX = -dy / distance;
                                        var perpY = dx / distance;
                                        var controlX = midX + perpX * curveFactor;
                                        var controlY = midY + perpY * curveFactor;
                                        
                                        // Draw curved path with clipping
                                        var segments = 20;
                                        pdf.setLineWidth(0.2);
                                        var prevX = startCoords[0];
                                        var prevY = startCoords[1];
                                        for (var s = 1; s <= segments; s++) {
                                            var t = s / segments;
                                            var x = (1 - t) * (1 - t) * startCoords[0] + 2 * (1 - t) * t * controlX + t * t * endCoords[0];
                                            var y = (1 - t) * (1 - t) * startCoords[1] + 2 * (1 - t) * t * controlY + t * t * endCoords[1];
                                            var clippedSeg = clipLineToRect(prevX, prevY, x, y, mapZone);
                                            if (clippedSeg) {
                                                pdf.line(clippedSeg.x1, clippedSeg.y1, clippedSeg.x2, clippedSeg.y2);
                                            }
                                            prevX = x;
                                            prevY = y;
                                        }
                                        
                                        // Draw arrowhead only if end point is inside mapZone
                                        if (endInside) {
                                            var tangentX = 2 * (endCoords[0] - controlX);
                                            var tangentY = 2 * (endCoords[1] - controlY);
                                            var angle = Math.atan2(tangentY, tangentX);
                                            var arrowX1 = endCoords[0] - arrowLength * Math.cos(angle - Math.PI / 6);
                                            var arrowY1 = endCoords[1] - arrowLength * Math.sin(angle - Math.PI / 6);
                                            var arrowX2 = endCoords[0] - arrowLength * Math.cos(angle + Math.PI / 6);
                                            var arrowY2 = endCoords[1] - arrowLength * Math.sin(angle + Math.PI / 6);
                                            pdf.triangle(endCoords[0], endCoords[1], arrowX1, arrowY1, arrowX2, arrowY2, "F");
                                        }

                                        // Draw delay text at control point of curved connector
                                        var delayMs2 = hole.timingDelayMilliseconds;
                                        if (delayMs2 !== undefined && delayMs2 !== null && displayOptions.delayValue) {
                                            if (isPointInRect(controlX, controlY, mapZone)) {
                                                var txtColor2 = getContrastColor(connColor);
                                                var txtRgb2 = hexToRgb(txtColor2);
                                                pdf.setTextColor(txtRgb2.r, txtRgb2.g, txtRgb2.b);
                                                pdf.setFontSize(5);
                                                pdf.setFont("helvetica", "normal");
                                                pdf.text(String(delayMs2), controlX, controlY - 0.5, { align: "center" });
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn("Failed to draw connector:", e);
                        }
                    }
                });
            }

            bar.style.width = "68%";
            text.textContent = "Drawing hole labels...";

            // Step 19a2) Draw hole labels (separate pass for z-ordering - labels on top of connectors)
            visibleBlastHoles.forEach(function(hole) {
                var collarCoords = worldToPDF(hole.startXLocation, hole.startYLocation);
                var toeCoords = worldToPDF(hole.endXLocation, hole.endYLocation);
                var collarInside = isPointInRect(collarCoords[0], collarCoords[1], mapZone);
                var toeInside = isPointInRect(toeCoords[0], toeCoords[1], mapZone);

                if (collarInside) {
                    var holeRadius = (hole.holeDiameter / 1000 / 2) * printHoleScale * printScale * 0.14;
                    holeRadius = Math.max(holeRadius, 0.5);
                    var textOffset = holeRadius * 2.5;
                    var fontSize = 4;
                    pdf.setFontSize(fontSize);
                    pdf.setFont("helvetica", "normal");

                    // Right side of collar labels (stacked top-down, matching raster positions)
                    var rightX = collarCoords[0] + textOffset;
                    var rightY = collarCoords[1] - textOffset;
                    var labelSpacing = fontSize * 0.4;

                    if (displayOptions.holeID) {
                        pdf.setTextColor(0, 0, 0);
                        pdf.text(hole.holeID || "", rightX, rightY);
                        rightY += labelSpacing;
                    }
                    if (displayOptions.holeLen) {
                        pdf.setTextColor(0, 0, 67);
                        pdf.text(parseFloat(hole.holeLengthCalculated).toFixed(1), rightX, rightY);
                        rightY += labelSpacing;
                    }
                    if (displayOptions.holeDia) {
                        pdf.setTextColor(0, 50, 0);
                        pdf.text(parseFloat(hole.holeDiameter).toFixed(0), rightX, rightY);
                        rightY += labelSpacing;
                    }
                    if (displayOptions.holeType) {
                        pdf.setTextColor(53, 0, 72);
                        pdf.text(hole.holeType || "", rightX, rightY);
                        rightY += labelSpacing;
                    }
                    if (displayOptions.rowID && hole.rowID) {
                        pdf.setTextColor(0, 100, 100);
                        pdf.text("R:" + hole.rowID, rightX, rightY);
                        rightY += labelSpacing;
                    }
                    if (displayOptions.posID && hole.posID) {
                        pdf.setTextColor(100, 0, 100);
                        pdf.text("P:" + hole.posID, rightX, rightY);
                        rightY += labelSpacing;
                    }
                    if (displayOptions.measuredComment && hole.measuredComment) {
                        pdf.setTextColor(70, 0, 0);
                        pdf.text(String(hole.measuredComment), rightX, rightY);
                        rightY += labelSpacing;
                    }

                    // Left side of collar labels (stacked top-down, right-aligned)
                    var leftX = collarCoords[0] - textOffset;
                    var leftY = collarCoords[1] - textOffset;

                    if (displayOptions.holeAng) {
                        pdf.setTextColor(67, 30, 0);
                        pdf.text(parseFloat(hole.holeAngle).toFixed(0) + "deg", leftX, leftY, { align: "right" });
                        leftY += labelSpacing;
                    }
                    if (displayOptions.initiationTime) {
                        pdf.setTextColor(255, 0, 0);
                        var timeStr = hole.holeTime != null ? String(hole.holeTime) : "";
                        if (timeStr) {
                            pdf.text(timeStr, leftX, leftY, { align: "right" });
                            leftY += labelSpacing;
                        }
                    }
                    if (displayOptions.xValue) {
                        pdf.setTextColor(0, 0, 0);
                        pdf.text("X:" + parseFloat(hole.startXLocation).toFixed(2), leftX, leftY, { align: "right" });
                        leftY += labelSpacing;
                    }
                    if (displayOptions.yValue) {
                        pdf.setTextColor(0, 0, 0);
                        pdf.text("Y:" + parseFloat(hole.startYLocation).toFixed(2), leftX, leftY, { align: "right" });
                        leftY += labelSpacing;
                    }
                    if (displayOptions.zValue) {
                        pdf.setTextColor(0, 0, 0);
                        pdf.text("Z:" + parseFloat(hole.startZLocation).toFixed(2), leftX, leftY, { align: "right" });
                        leftY += labelSpacing;
                    }
                    if (displayOptions.measuredLength && hole.measuredLength) {
                        pdf.setTextColor(70, 0, 0);
                        pdf.text("ML:" + parseFloat(hole.measuredLength).toFixed(1), leftX, leftY, { align: "right" });
                        leftY += labelSpacing;
                    }
                    if (displayOptions.measuredMass && hole.measuredMass) {
                        pdf.setTextColor(70, 0, 0);
                        pdf.text("MM:" + parseFloat(hole.measuredMass).toFixed(1), leftX, leftY, { align: "right" });
                        leftY += labelSpacing;
                    }
                    if (displayOptions.massPerHole) {
                        var mLabels = buildMassLabels(hole);
                        if (mLabels.perHole) {
                            pdf.setTextColor(255, 0, 0);
                            pdf.text(mLabels.perHole, leftX, leftY, { align: "right" });
                            leftY += labelSpacing;
                        }
                    }
                    if (displayOptions.massPerDeck) {
                        var dLabels = buildMassLabels(hole);
                        pdf.setTextColor(255, 0, 0);
                        for (var ml = 0; ml < dLabels.perDeck.length; ml++) {
                            pdf.text(dLabels.perDeck[ml], leftX, leftY, { align: "right" });
                            leftY += labelSpacing;
                        }
                    }
                }

                // Left side of toe labels (Dip, Bea, Subdrill)
                if (toeInside) {
                    var toeTextOffset = toeSizeInMeters * printScale * 1.5;
                    if (displayOptions.holeDip) {
                        pdf.setTextColor(128, 64, 0);
                        var dipAngle = 90 - parseFloat(hole.holeAngle);
                        pdf.text(dipAngle.toFixed(0) + "deg", toeCoords[0] - toeTextOffset, toeCoords[1] - toeTextOffset, { align: "right" });
                    }
                    if (displayOptions.holeBea) {
                        pdf.setTextColor(255, 0, 0);
                        pdf.text(parseFloat(hole.holeBearing).toFixed(1) + "deg", toeCoords[0] - toeTextOffset, toeCoords[1] + toeTextOffset, { align: "right" });
                    }
                    if (displayOptions.holeSubdrill) {
                        pdf.setTextColor(0, 0, 255);
                        pdf.text(parseFloat(hole.subdrillAmount || 0).toFixed(1), toeCoords[0] - toeTextOffset, toeCoords[1], { align: "right" });
                    }
                }
            });

            bar.style.width = "70%";
            text.textContent = "Drawing contour lines...";

            // Step 19b) Draw contour lines - with line clipping
            if (displayOptions.contour && context.contourLinesArray) {
                pdf.setDrawColor(255, 0, 255); // Magenta
                pdf.setLineWidth(0.3);
                
                for (var c = 0; c < context.contourLinesArray.length; c++) {
                    var contourLines = context.contourLinesArray[c];
                    if (contourLines && Array.isArray(contourLines)) {
                        for (var l = 0; l < contourLines.length; l++) {
                            var line = contourLines[l];
                            if (line && line.length >= 2) {
                                var startPt = line[0];
                                var endPt = line[1];
                                if (startPt && endPt) {
                                    var startCoords = worldToPDF(startPt.x !== undefined ? startPt.x : startPt[0], startPt.y !== undefined ? startPt.y : startPt[1]);
                                    var endCoords = worldToPDF(endPt.x !== undefined ? endPt.x : endPt[0], endPt.y !== undefined ? endPt.y : endPt[1]);
                                    // Clip contour line to mapZone
                                    var clippedContour = clipLineToRect(startCoords[0], startCoords[1], endCoords[0], endCoords[1], mapZone);
                                    if (clippedContour) {
                                        pdf.line(clippedContour.x1, clippedContour.y1, clippedContour.x2, clippedContour.y2);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            bar.style.width = "72%";
            text.textContent = "Drawing direction arrows...";

            // Step 19c) Draw first movement direction arrows
            if (displayOptions.firstMovement && context.directionArrows && context.directionArrows.length > 0) {
                var firstMovementSize = context.firstMovementSize || 10;
                var arrowBaseWidth = (firstMovementSize / 4) * printScale;
                var arrowHeadLength = 2 * (firstMovementSize / 4) * printScale;
                var tailWidth = arrowBaseWidth * 0.7;

                for (var da = 0; da < context.directionArrows.length; da++) {
                    var arrow = context.directionArrows[da];
                    if (arrow && arrow.length >= 5) {
                        var arrowStartCoords = worldToPDF(arrow[0], arrow[1]);
                        var arrowEndCoords = worldToPDF(arrow[2], arrow[3]);
                        var arrowColor = arrow[4] || "#FFD700"; // goldenrod default

                        // Check if arrow is visible in mapZone
                        var arrowMidX = (arrowStartCoords[0] + arrowEndCoords[0]) / 2;
                        var arrowMidY = (arrowStartCoords[1] + arrowEndCoords[1]) / 2;
                        if (!isPointInRect(arrowMidX, arrowMidY, mapZone)) continue;

                        var angle = Math.atan2(arrowEndCoords[1] - arrowStartCoords[1], arrowEndCoords[0] - arrowStartCoords[0]);

                        // Draw arrow shape as filled polygon
                        var arrowRgb = hexToRgb(arrowColor);
                        pdf.setFillColor(arrowRgb.r, arrowRgb.g, arrowRgb.b);
                        pdf.setDrawColor(0, 0, 0);
                        pdf.setLineWidth(0.1);

                        // Build arrow polygon points
                        var sx = arrowStartCoords[0], sy = arrowStartCoords[1];
                        var ex = arrowEndCoords[0], ey = arrowEndCoords[1];
                        var sinA = Math.sin(angle), cosA = Math.cos(angle);

                        // Arrow polygon: tail start top -> tail end top -> arrowhead base right -> tip -> arrowhead base left -> tail end bottom -> tail start bottom
                        var p1x = sx + (tailWidth / 2) * sinA, p1y = sy - (tailWidth / 2) * cosA;
                        var p2x = ex - arrowHeadLength * cosA + (tailWidth / 2) * sinA, p2y = ey - arrowHeadLength * sinA - (tailWidth / 2) * cosA;
                        var p3x = ex - arrowHeadLength * cosA + arrowBaseWidth * sinA, p3y = ey - arrowHeadLength * sinA - arrowBaseWidth * cosA;
                        var p4x = ex, p4y = ey; // tip
                        var p5x = ex - arrowHeadLength * cosA - arrowBaseWidth * sinA, p5y = ey - arrowHeadLength * sinA + arrowBaseWidth * cosA;
                        var p6x = ex - arrowHeadLength * cosA - (tailWidth / 2) * sinA, p6y = ey - arrowHeadLength * sinA + (tailWidth / 2) * cosA;
                        var p7x = sx - (tailWidth / 2) * sinA, p7y = sy + (tailWidth / 2) * cosA;

                        // Draw polygon using lines
                        pdf.lines([
                            [p2x - p1x, p2y - p1y],
                            [p3x - p2x, p3y - p2y],
                            [p4x - p3x, p4y - p3y],
                            [p5x - p4x, p5y - p4y],
                            [p6x - p5x, p6y - p5y],
                            [p7x - p6x, p7y - p6y],
                            [p1x - p7x, p1y - p7y]
                        ], p1x, p1y, [1, 1], "FD", true);
                    }
                }
            }

            } // End of if (!is3DMode) - 2D data rendering block

            bar.style.width = "75%";
            text.textContent = "Drawing footer...";

            // ============== FOOTER ZONE ==============

            // Step 20) Draw footer zone border
            drawCellBorder(pdf, footerZone.x, footerZone.y, footerZone.width, footerZone.height, 0.3);

            // Step 21) Draw footer column borders
            for (var c = 0; c < footerColumns.length; c++) {
                var col = footerColumns[c];
                drawCellBorder(pdf, col.x, col.y, col.width, col.height, 0.2);
            }

            // Step 22) Draw title block row borders
            for (var r = 0; r < titleBlockRows.length; r++) {
                var row = titleBlockRows[r];
                drawCellBorder(pdf, row.x, row.y, row.width, row.height, 0.2);
            }

            // Step 23) Draw nav/logo row borders (portrait mode)
            if (navLogoRows) {
                for (var n = 0; n < navLogoRows.length; n++) {
                    var navRow = navLogoRows[n];
                    drawCellBorder(pdf, navRow.x, navRow.y, navRow.width, navRow.height, 0.2);
                }
            }

            // Step 24) Render navigation indicator (North Arrow or XYZ Gizmo)
            var navCell = layoutMgr.getNavIndicatorCell();
            if (navCell) {
                try {
                    var navImageDataURL = null;
                    if (mode === "2D") {
                        // 2D returns dataURL directly
                        navImageDataURL = PrintCaptureManager.captureNorthArrow(context);
                    } else {
                        // 3D returns { canvas, dataURL } - extract the dataURL for jsPDF
                        var gizmoResult = PrintCaptureManager.captureXYZGizmo(context);
                        if (gizmoResult && gizmoResult.dataURL) {
                            navImageDataURL = gizmoResult.dataURL;
                        }
                        console.log("[Vector Nav] Gizmo capture result:", gizmoResult ? "success" : "null");
                    }
                    
                    if (navImageDataURL) {
                        // Use 60% of cell size to prevent cutting off
                        var navSize = Math.min(navCell.width, navCell.height) * 0.6;
                        var navX = navCell.x + (navCell.width - navSize) / 2;
                        var navY = navCell.y + (navCell.height - navSize) / 2;
                        console.log("[Vector Nav] Adding gizmo to PDF at:", navX, navY, "size:", navSize);
                        pdf.addImage(navImageDataURL, "PNG", navX, navY, navSize, navSize);
                    } else {
                        // Fallback text
                        console.log("[Vector Nav] No nav image, drawing fallback text");
                        drawCenteredText(pdf, mode === "2D" ? "N" : "XYZ", navCell.x, navCell.y, navCell.width, navCell.height, 14, true);
                    }
                } catch (e) {
                    console.warn("Failed to render navigation indicator:", e);
                    drawCenteredText(pdf, mode === "2D" ? "N" : "XYZ", navCell.x, navCell.y, navCell.width, navCell.height, 14, true);
                }
            }

            // Step 25) Render Connector Count (actual connectors grouped by delay)
            var connectorCell = layoutMgr.getConnectorCountCell();
            if (connectorCell && allBlastHoles && allBlastHoles.length > 0) {
                try {
                    var stats = getBlastStatisticsPerEntity(allBlastHoles);
                    var entityNames = Object.keys(stats);

                    // Draw header
                    pdf.setFontSize(9);
                    pdf.setFont("helvetica", "bold");
                    pdf.setTextColor(0, 0, 0);
                    pdf.text("CONNECTOR COUNT", connectorCell.x + connectorCell.width / 2, connectorCell.y + 4, { align: "center" });

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
                                pdf.setFillColor(bgRgb.r, bgRgb.g, bgRgb.b);
                                pdf.rect(connectorCell.x + padding, rowY, connectorCell.width - padding * 2, rowHeight, "F");
                                
                                // Draw text
                                var delayText = delay === "Unknown" ? "Unk" : delay + "ms";
                                var txtRgb = hexToRgb(txtColor);
                                pdf.setTextColor(txtRgb.r, txtRgb.g, txtRgb.b);
                                pdf.setFontSize(7);
                                pdf.setFont("helvetica", "normal");
                                pdf.text(delayText + ": " + group.count, connectorCell.x + padding + 1, rowY + 2.5);
                                
                                rowY += rowHeight + 0.5;
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to render connector count:", e);
                    drawCenteredText(pdf, "CONNECTOR\nCOUNT", connectorCell.x, connectorCell.y, connectorCell.width, connectorCell.height, 7, true);
                }
            } else {
                drawCenteredText(pdf, "CONNECTOR\nCOUNT", connectorCell.x, connectorCell.y, connectorCell.width, connectorCell.height, 7, true);
            }

            // Step 26) Render Blast Statistics
            var statsCell = layoutMgr.getBlastStatisticsCell();
            if (statsCell && allBlastHoles && allBlastHoles.length > 0) {
                try {
                    var blastStats = getBlastStatisticsPerEntity(allBlastHoles);
                    var entityKeys = Object.keys(blastStats);
                    
                    // Draw header
                    pdf.setFontSize(9);
                    pdf.setFont("helvetica", "bold");
                    pdf.setTextColor(0, 0, 0);
                    pdf.text("BLAST STATISTICS", statsCell.x + statsCell.width / 2, statsCell.y + 4, { align: "center" });
                    
                    // Draw statistics
                    var statY = statsCell.y + 9;
                    var lineHeight = 3;
                    pdf.setFontSize(7);
                    pdf.setFont("helvetica", "normal");
                    
                    for (var ek = 0; ek < entityKeys.length && statY < statsCell.y + statsCell.height - 3; ek++) {
                        var es = blastStats[entityKeys[ek]];
                        if (es) {
                            pdf.text("Holes: " + es.holeCount, statsCell.x + 2, statY);
                            statY += lineHeight;
                            if (statY < statsCell.y + statsCell.height - 3) {
                                pdf.text("Burden: " + es.burden.toFixed(2) + "m", statsCell.x + 2, statY);
                                statY += lineHeight;
                            }
                            if (statY < statsCell.y + statsCell.height - 3) {
                                pdf.text("Spacing: " + es.spacing.toFixed(2) + "m", statsCell.x + 2, statY);
                                statY += lineHeight;
                            }
                            if (statY < statsCell.y + statsCell.height - 3) {
                                pdf.text("Drill: " + es.drillMetres.toFixed(1) + "m", statsCell.x + 2, statY);
                                statY += lineHeight;
                            }
                            if (statY < statsCell.y + statsCell.height - 3) {
                                pdf.text("Volume: " + es.volume.toFixed(0) + "m3", statsCell.x + 2, statY);
                                statY += lineHeight;
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to render blast statistics:", e);
                    drawCenteredText(pdf, "BLAST\nSTATISTICS", statsCell.x, statsCell.y, statsCell.width, statsCell.height, 7, true);
                }
            } else {
                drawCenteredText(pdf, "BLAST\nSTATISTICS", statsCell.x, statsCell.y, statsCell.width, statsCell.height, 7, true);
            }

            // Step 26b) Render Legend in footer legend cell
            var legendCell = layoutMgr.getLegendCell();
            if (legendCell) {
                try {
                    var activeLegends = getActiveLegends();

                    // Draw header
                    pdf.setFontSize(9);
                    pdf.setFont("helvetica", "bold");
                    pdf.setTextColor(0, 0, 0);
                    pdf.text("LEGEND", legendCell.x + legendCell.width / 2, legendCell.y + 4, { align: "center" });

                    if (activeLegends) {
                        var legendY = legendCell.y + 8;
                        var legendRowHeight = 3;
                        var legendPadding = 1.5;
                        var swatchSize = 2.5;

                        // Draw Slope Legend
                        if (activeLegends.slope && activeLegends.slope.items && activeLegends.slope.items.length > 0) {
                            pdf.setFontSize(6);
                            pdf.setFont("helvetica", "bold");
                            pdf.text("Slope", legendCell.x + legendPadding, legendY);
                            legendY += legendRowHeight;

                            pdf.setFontSize(5);
                            pdf.setFont("helvetica", "normal");
                            for (var si = 0; si < activeLegends.slope.items.length && legendY < legendCell.y + legendCell.height - 2; si++) {
                                var sItem = activeLegends.slope.items[si];
                                var sRgb = parseRgbString(sItem.color || "rgb(128,128,128)");
                                // Draw color swatch
                                pdf.setFillColor(sRgb.r, sRgb.g, sRgb.b);
                                pdf.rect(legendCell.x + legendPadding, legendY - swatchSize * 0.7, swatchSize, swatchSize, "F");
                                // Draw label
                                pdf.setTextColor(0, 0, 0);
                                pdf.text(sItem.label || "", legendCell.x + legendPadding + swatchSize + 1, legendY);
                                legendY += legendRowHeight * 0.8;
                            }
                            legendY += legendRowHeight * 0.5;
                        }

                        // Draw Relief Legend
                        if (activeLegends.relief && activeLegends.relief.items && activeLegends.relief.items.length > 0) {
                            pdf.setFontSize(6);
                            pdf.setFont("helvetica", "bold");
                            pdf.setTextColor(0, 0, 0);
                            pdf.text("Relief", legendCell.x + legendPadding, legendY);
                            legendY += legendRowHeight;

                            pdf.setFontSize(5);
                            pdf.setFont("helvetica", "normal");
                            for (var ri = 0; ri < activeLegends.relief.items.length && legendY < legendCell.y + legendCell.height - 2; ri++) {
                                var rItem = activeLegends.relief.items[ri];
                                var rRgb = parseRgbString(rItem.color || "rgb(128,128,128)");
                                // Draw color swatch
                                pdf.setFillColor(rRgb.r, rRgb.g, rRgb.b);
                                pdf.rect(legendCell.x + legendPadding, legendY - swatchSize * 0.7, swatchSize, swatchSize, "F");
                                // Draw label
                                pdf.setTextColor(0, 0, 0);
                                pdf.text(rItem.label || "", legendCell.x + legendPadding + swatchSize + 1, legendY);
                                legendY += legendRowHeight * 0.8;
                            }
                            legendY += legendRowHeight * 0.5;
                        }

                        // Draw Voronoi Legend (discrete vertical boxes with 0.1 increments)
                        if (activeLegends.voronoi && activeLegends.voronoi.title) {
                            pdf.setFontSize(6);
                            pdf.setFont("helvetica", "bold");
                            pdf.setTextColor(0, 0, 0);
                            var vTitle = activeLegends.voronoi.title;
                            // Allow longer titles - truncate only if very long
                            if (vTitle.length > 28) vTitle = vTitle.substring(0, 25) + "...";
                            pdf.text(vTitle, legendCell.x + legendPadding, legendY);
                            legendY += legendRowHeight;

                            // Build discrete voronoi items with 0.1 increments
                            var vMinVal = activeLegends.voronoi.minVal !== undefined ? activeLegends.voronoi.minVal : 0;
                            var vMaxVal = activeLegends.voronoi.maxVal !== undefined ? activeLegends.voronoi.maxVal : 1;
                            var vRange = vMaxVal - vMinVal;
                            var vIncrement = 0.1;
                            var vStartVal = Math.floor(vMinVal * 10) / 10;
                            var vEndVal = Math.ceil(vMaxVal * 10) / 10;

                            // Limit items to fit in available space
                            var maxItems = Math.floor((legendCell.y + legendCell.height - legendY - 2) / (legendRowHeight * 0.8));
                            var numItems = Math.round((vEndVal - vStartVal) / vIncrement);
                            if (numItems > maxItems) {
                                vIncrement = (vEndVal - vStartVal) / maxItems;
                                vIncrement = Math.ceil(vIncrement * 10) / 10;
                            }

                            // Helper to get spectrum color
                            function getVoronoiSpectrumColor(val) {
                                var ratio = vRange > 0 ? Math.min(Math.max((val - vMinVal) / vRange, 0), 1) : 0;
                                var r, g, b;
                                if (ratio < 0.2) {
                                    var t = ratio / 0.2;
                                    r = Math.round(148 * (1 - t)); g = 0; b = Math.round(211 * (1 - t) + 255 * t);
                                } else if (ratio < 0.4) {
                                    var t = (ratio - 0.2) / 0.2;
                                    r = 0; g = Math.round(255 * t); b = 255;
                                } else if (ratio < 0.6) {
                                    var t = (ratio - 0.4) / 0.2;
                                    r = 0; g = 255; b = Math.round(255 * (1 - t));
                                } else if (ratio < 0.8) {
                                    var t = (ratio - 0.6) / 0.2;
                                    r = Math.round(255 * t); g = 255; b = 0;
                                } else {
                                    var t = (ratio - 0.8) / 0.2;
                                    r = 255; g = Math.round(255 * (1 - t)); b = 0;
                                }
                                return { r: r, g: g, b: b };
                            }

                            pdf.setFontSize(5);
                            pdf.setFont("helvetica", "normal");
                            for (var vVal = vStartVal; vVal < vEndVal && legendY < legendCell.y + legendCell.height - 2; vVal += vIncrement) {
                                var vLow = vVal;
                                var vHigh = Math.min(vVal + vIncrement, vEndVal);
                                var vMid = (vLow + vHigh) / 2;
                                var vLabel = vLow.toFixed(1) + "-" + vHigh.toFixed(1);
                                var vRgb = getVoronoiSpectrumColor(vMid);
                                // Draw color swatch
                                pdf.setFillColor(vRgb.r, vRgb.g, vRgb.b);
                                pdf.rect(legendCell.x + legendPadding, legendY - swatchSize * 0.7, swatchSize, swatchSize, "F");
                                // Draw label
                                pdf.setTextColor(0, 0, 0);
                                pdf.text(vLabel, legendCell.x + legendPadding + swatchSize + 1, legendY);
                                legendY += legendRowHeight * 0.8;
                            }
                            legendY += legendRowHeight * 0.5;
                        }

                        // Draw Surface Legends
                        if (activeLegends.surfaces && activeLegends.surfaces.length > 0) {
                            pdf.setFontSize(6);
                            pdf.setFont("helvetica", "bold");
                            pdf.setTextColor(0, 0, 0);
                            pdf.text("Surfaces", legendCell.x + legendPadding, legendY);
                            legendY += legendRowHeight;

                            pdf.setFontSize(5);
                            pdf.setFont("helvetica", "normal");
                            for (var surf = 0; surf < activeLegends.surfaces.length && legendY < legendCell.y + legendCell.height - 2; surf++) {
                                var surfData = activeLegends.surfaces[surf];
                                if (surfData && surfData.name) {
                                    var surfName = surfData.name;
                                    if (surfName.length > 12) surfName = surfName.substring(0, 12) + "...";
                                    pdf.text(surfName, legendCell.x + legendPadding, legendY);
                                    legendY += legendRowHeight * 0.8;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to render legend cell:", e);
                    drawCenteredText(pdf, "LEGEND", legendCell.x, legendCell.y, legendCell.width, legendCell.height, 7, true);
                }
            }

            // Step 27) Render Logo and URL
            var logoCell = layoutMgr.getLogoCell();
            if (logoCell) {
                if (qrCodeDataURL) {
                    try {
                        var qrSize = Math.min(logoCell.width, logoCell.height) * 0.6;
                        var qrX = logoCell.x + (logoCell.width - qrSize) / 2;
                        var qrY = logoCell.y + (logoCell.height - qrSize) / 2 - 2;
                        pdf.addImage(qrCodeDataURL, "PNG", qrX, qrY, qrSize, qrSize);
                        
                        // URL below QR
                        pdf.setFontSize(5);
                        pdf.setFont("helvetica", "normal");
                        pdf.setTextColor(0, 0, 0);
                        pdf.text("blastingapps.com", logoCell.x + logoCell.width / 2, logoCell.y + logoCell.height - 2, { align: "center" });
                    } catch (e) {
                        console.warn("Failed to render QR code:", e);
                        drawMultilineText(pdf, ["[QR]", "blastingapps.com"], logoCell.x, logoCell.y, logoCell.width, logoCell.height, 6);
                    }
                } else {
                    drawMultilineText(pdf, ["[QR]", "blastingapps.com"], logoCell.x, logoCell.y, logoCell.width, logoCell.height, 6);
                }
            }

            // Step 28) Render Title and Blast Name (no square braces)
            var titleRow = layoutMgr.getTitleCell();
            if (titleRow) {
                // Get blast names
                var blastNames = new Set();
                if (allBlastHoles && allBlastHoles.length > 0) {
                    allBlastHoles.forEach(function(hole) {
                        if (hole.entityName) {
                            blastNames.add(hole.entityName);
                        }
                    });
                }
                var blastNameList = Array.from(blastNames).join(", ");
                var displayBlastName = blastNameList || userInput.blastName || "Untitled Blast";
                
                pdf.setFontSize(10);
                pdf.setFont("helvetica", "bold");
                pdf.setTextColor(0, 0, 0);
                pdf.text("TITLE", titleRow.x + 2, titleRow.y + titleRow.height * 0.35);
                pdf.setFontSize(8);
                pdf.setFont("helvetica", "normal");
                pdf.text(displayBlastName, titleRow.x + 2, titleRow.y + titleRow.height * 0.7);
            }

            // Step 29) Render Date and Time (no square braces)
            var dateRow = layoutMgr.getDateCell();
            if (dateRow) {
                var now = new Date();
                var dateStr = now.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
                var timeStr = now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
                
                pdf.setFontSize(8);
                pdf.setFont("helvetica", "bold");
                pdf.setTextColor(0, 0, 0);
                pdf.text("DATE", dateRow.x + 2, dateRow.y + dateRow.height * 0.35);
                pdf.setFontSize(7);
                pdf.setFont("helvetica", "normal");
                pdf.text(dateStr + " " + timeStr, dateRow.x + 2, dateRow.y + dateRow.height * 0.7);
            }

            // Step 30) Render Scale and Designer (no square braces)
            var scaleDesignerRow = layoutMgr.getScaleDesignerCell();
            if (scaleDesignerRow) {
                var scaleRatio = layoutMgr.calculateScaleRatio(printScale);
                var designerName = userInput.designer || "";
                
                pdf.setFontSize(8);
                pdf.setFont("helvetica", "normal");
                pdf.setTextColor(0, 0, 0);
                
                // Scale in top half
                pdf.text("Scale:", scaleDesignerRow.x + 2, scaleDesignerRow.y + scaleDesignerRow.height * 0.25);
                pdf.text(scaleRatio, scaleDesignerRow.x + 15, scaleDesignerRow.y + scaleDesignerRow.height * 0.25);
                
                // Designer in bottom half
                pdf.text("Designer:", scaleDesignerRow.x + 2, scaleDesignerRow.y + scaleDesignerRow.height * 0.65);
                pdf.text(designerName, scaleDesignerRow.x + 18, scaleDesignerRow.y + scaleDesignerRow.height * 0.65);
            }

            bar.style.width = "95%";
            text.textContent = "Finalizing...";

            // Step 31) Add version footer
            if (buildVersion) {
                pdf.setFontSize(5);
                pdf.setFont("helvetica", "normal");
                pdf.setTextColor(128, 128, 128);
                pdf.text("Kirra v" + buildVersion, pageWidth - 2, pageHeight - 2, { align: "right" });
            }

            bar.style.width = "100%";
            text.textContent = "Complete!";

            // Step 32) Save PDF using user-provided or auto-generated filename
            var fileName = userInput.fileName ? userInput.fileName + ".pdf" : "kirra-blast-" + mode + "-" + new Date().toISOString().split("T")[0] + ".pdf";
            pdf.save(fileName);

            setTimeout(function() {
                progressDialog.close();
                showModalMessage("Success", "Vector PDF created successfully!", "success");
            }, 300);

        } catch (error) {
            progressDialog.close();
            console.error("Vector PDF Generation Error:", error);
            showModalMessage("PDF Creation Failed", "Error: " + error.message, "error");
        }
    }, 500); // Wait for QR code to load
}

