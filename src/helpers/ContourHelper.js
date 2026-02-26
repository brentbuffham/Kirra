/**
 * ContourHelper.js
 *
 * Generates contour lines from a triangulated surface by slicing
 * with horizontal planes at regular elevation intervals.
 * Outputs KAD line/poly entities.
 */

import {
    extractTriangles,
    computeBBox,
    chainSegments,
    simplifyPolyline
} from "./SurfaceIntersectionHelper.js";
import { AddKADEntityAction } from "../tools/UndoActions.js";

// ────────────────────────────────────────────────────────
// Plane-triangle intersection
// ────────────────────────────────────────────────────────

/**
 * Intersect a single triangle with a horizontal plane at planeZ.
 * Returns a segment {p0, p1} or null if no intersection.
 *
 * @param {{v0:{x,y,z}, v1:{x,y,z}, v2:{x,y,z}}} tri
 * @param {number} planeZ
 * @returns {{p0:{x,y,z}, p1:{x,y,z}}|null}
 */
function intersectTrianglePlane(tri, planeZ) {
    var va = tri.v0, vb = tri.v1, vc = tri.v2;

    // Signed distances from plane
    var da = va.z - planeZ;
    var db = vb.z - planeZ;
    var dc = vc.z - planeZ;

    // Classify each vertex: positive, negative, or on-plane
    var EPSILON = 1e-10;
    var sa = da > EPSILON ? 1 : (da < -EPSILON ? -1 : 0);
    var sb = db > EPSILON ? 1 : (db < -EPSILON ? -1 : 0);
    var sc = dc > EPSILON ? 1 : (dc < -EPSILON ? -1 : 0);

    // All on same side or all on plane → no intersection segment
    if (sa === sb && sb === sc) return null;

    // Collect intersection points from edges that cross the plane
    var points = [];
    var edges = [
        [va, vb, da, db, sa, sb],
        [vb, vc, db, dc, sb, sc],
        [vc, va, dc, da, sc, sa]
    ];

    for (var i = 0; i < 3; i++) {
        var v0 = edges[i][0], v1 = edges[i][1];
        var d0 = edges[i][2], d1 = edges[i][3];
        var s0 = edges[i][4], s1 = edges[i][5];

        if (s0 === 0 && s1 === 0) {
            // Both on plane — edge lies on plane, skip (coplanar)
            continue;
        } else if (s0 === 0) {
            // v0 is on the plane
            points.push({ x: v0.x, y: v0.y, z: planeZ });
        } else if (s1 === 0) {
            // v1 is on the plane
            points.push({ x: v1.x, y: v1.y, z: planeZ });
        } else if (s0 !== s1) {
            // Edge crosses the plane — interpolate
            var t = d0 / (d0 - d1);
            points.push({
                x: v0.x + t * (v1.x - v0.x),
                y: v0.y + t * (v1.y - v0.y),
                z: planeZ
            });
        }
    }

    // Deduplicate points that are essentially the same (vertex-on-plane counted twice)
    if (points.length > 2) {
        var unique = [points[0]];
        for (var j = 1; j < points.length; j++) {
            var dup = false;
            for (var k = 0; k < unique.length; k++) {
                var dx = points[j].x - unique[k].x;
                var dy = points[j].y - unique[k].y;
                if (dx * dx + dy * dy < EPSILON * EPSILON) {
                    dup = true;
                    break;
                }
            }
            if (!dup) unique.push(points[j]);
        }
        points = unique;
    }

    if (points.length === 2) {
        return { p0: points[0], p1: points[1] };
    }

    return null;
}

// ────────────────────────────────────────────────────────
// Main contour generation
// ────────────────────────────────────────────────────────

/**
 * Generate contour lines from a surface.
 *
 * @param {Object} config
 * @param {string} config.surfaceId - Surface to contour
 * @param {number} config.interval - Contour interval in meters
 * @param {number} config.minZ - Start elevation
 * @param {number} config.maxZ - End elevation
 * @param {number} config.vertexSpacing - Simplification tolerance (0 = keep all)
 * @param {boolean} config.closedPolygons - Close polylines
 * @param {string} config.color - Hex color
 * @param {number} config.lineWidth - Line width
 * @param {string} config.layerName - KAD layer name
 */
export function generateContours(config) {
    if (!config || !config.surfaceId) {
        console.error("ContourHelper: No surface ID provided");
        return;
    }

    var surface = window.loadedSurfaces.get(config.surfaceId);
    if (!surface) {
        console.error("ContourHelper: Surface not found: " + config.surfaceId);
        showInfo("Surface not found: " + config.surfaceId);
        return;
    }

    // Step 1) Extract triangles
    var tris = extractTriangles(surface);
    if (tris.length === 0) {
        showInfo("No triangles found in surface: " + config.surfaceId);
        return;
    }

    // Step 2) Get bounding box for Z range
    var bbox = computeBBox(tris);
    var minZ = config.minZ != null ? config.minZ : bbox.minZ;
    var maxZ = config.maxZ != null ? config.maxZ : bbox.maxZ;
    var interval = config.interval || 5;

    if (interval <= 0) {
        showInfo("Contour interval must be greater than 0.");
        return;
    }

    // Sanity check: limit contour count
    var numContours = Math.floor((maxZ - minZ) / interval) + 1;
    if (numContours > 5000) {
        showInfo("Too many contour levels (" + numContours + "). Increase the contour interval or narrow the elevation range.");
        return;
    }

    console.log("Generating contours: interval=" + interval + "m, Z range=[" + minZ.toFixed(2) + ", " + maxZ.toFixed(2) + "], levels=" + numContours + ", triangles=" + tris.length);

    var t0 = performance.now();

    // Step 3) Build Z-range index for triangles to avoid scanning all tris per level
    var triZRanges = new Array(tris.length);
    for (var t = 0; t < tris.length; t++) {
        var tri = tris[t];
        var zMin = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
        var zMax = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
        triZRanges[t] = { idx: t, zMin: zMin, zMax: zMax };
    }
    // Sort by zMin for efficient range queries
    triZRanges.sort(function(a, b) { return a.zMin - b.zMin; });

    // Step 4) Iterate contour elevations
    // Each entry: { elevation, polyline } so we can name entities by RL
    var contourResults = [];
    var totalSegments = 0;

    // Snap starting elevation to exact interval boundary
    var startZ = Math.ceil(minZ / interval) * interval;

    for (var z = startZ; z <= maxZ; z += interval) {
        // Collect segments for this elevation
        var segments = [];

        for (var ti = 0; ti < triZRanges.length; ti++) {
            var range = triZRanges[ti];
            // Skip triangles entirely below this level
            if (range.zMax < z) continue;
            // Stop when triangles are entirely above this level
            if (range.zMin > z) break;

            var seg = intersectTrianglePlane(tris[range.idx], z);
            if (seg) segments.push(seg);
        }

        if (segments.length === 0) continue;
        totalSegments += segments.length;

        // Step 5) Chain segments into polylines
        var threshold = 1e-6;
        var polylines = chainSegments(segments, threshold);

        // Step 6) Simplify if requested
        if (config.vertexSpacing > 0) {
            for (var pi = 0; pi < polylines.length; pi++) {
                polylines[pi] = simplifyPolyline(polylines[pi], config.vertexSpacing);
            }
        }

        for (var pj = 0; pj < polylines.length; pj++) {
            contourResults.push({ elevation: z, polyline: polylines[pj] });
        }
    }

    var elapsed = ((performance.now() - t0) / 1000).toFixed(2);

    if (contourResults.length === 0) {
        showInfo("No contour lines generated. The surface may not span the specified elevation range.");
        return;
    }

    // Step 7) Create KAD entities with elevation-based naming
    createContourEntities(contourResults, config);

    // Step 8) Summary
    var contourLevels = Math.round((maxZ - startZ) / interval) + 1;
    var message = "Generated " + contourResults.length + " contour line(s)\n" +
        "Elevation range: " + startZ.toFixed(2) + " to " + maxZ.toFixed(2) + " m\n" +
        "Contour interval: " + interval + " m (" + contourLevels + " levels)\n" +
        "Total segments: " + totalSegments + "\n" +
        "Time: " + elapsed + " s";
    console.log(message);
    showInfo(message);
}

// ────────────────────────────────────────────────────────
// Contour-specific KAD entity creation
// ────────────────────────────────────────────────────────

/**
 * Create KAD entities from contour results with elevation-based naming.
 * Entity names follow the pattern: RL{elevation}-{seq}-{uid}
 * Uses entityType "line" when closedPolygons is false, "poly" when true.
 *
 * @param {Array<{elevation: number, polyline: Array}>} contourResults
 * @param {Object} config
 */
function createContourEntities(contourResults, config) {
    var closedPolygons = config.closedPolygons === true;
    var entType = closedPolygons ? "poly" : "line";

    // Begin undo batch
    if (window.undoManager && contourResults.length > 1) {
        window.undoManager.beginBatch("Surface Contours (" + contourResults.length + " " + entType + "s)");
    }

    // Get or create layer
    var activeLayerId = null;
    var activeLayer = null;
    var layerName = config.layerName || "CONTOUR";
    if (window.allDrawingLayers) {
        for (var [layerId, layer] of window.allDrawingLayers) {
            if ((layer.layerName || layer.name) === layerName) {
                activeLayer = layer;
                activeLayerId = layerId;
                break;
            }
        }
        if (!activeLayer) {
            activeLayerId = "layer_" + Math.random().toString(36).substring(2, 6);
            activeLayer = {
                layerId: activeLayerId,
                layerName: layerName,
                type: "drawing",
                visible: true,
                entities: new Set()
            };
            window.allDrawingLayers.set(activeLayerId, activeLayer);
        }
    }

    // Track sequence number per elevation
    var elevationSeq = {};

    contourResults.forEach(function(result) {
        var elev = result.elevation;
        var points = result.polyline;

        // Format elevation for entity name (remove decimals if integer)
        var elevStr = (elev % 1 === 0) ? elev.toFixed(0) : elev.toFixed(1);

        // Sequence number per elevation
        if (!elevationSeq[elevStr]) elevationSeq[elevStr] = 0;
        elevationSeq[elevStr]++;
        var seq = String(elevationSeq[elevStr]).padStart(3, "0");

        var uid = Math.random().toString(36).substring(2, 6);
        var entityName = "RL" + elevStr + "-" + seq + "-" + uid;

        var entityData = {
            entityType: entType,
            layerId: activeLayerId,
            data: points.map(function(pt, i) {
                return {
                    entityName: entityName,
                    entityType: entType,
                    pointID: i + 1,
                    pointXLocation: pt.x,
                    pointYLocation: pt.y,
                    pointZLocation: pt.z,
                    lineWidth: config.lineWidth || 2,
                    color: config.color || "#FFCC00",
                    closed: closedPolygons,
                    visible: true
                };
            })
        };
        window.allKADDrawingsMap.set(entityName, entityData);
        if (activeLayer) activeLayer.entities.add(entityName);

        // Push undo
        if (window.undoManager) {
            var action = new AddKADEntityAction(entityName, JSON.parse(JSON.stringify(entityData)));
            window.undoManager.pushAction(action);
        }
    });

    // End undo batch
    if (window.undoManager && contourResults.length > 1) {
        window.undoManager.endBatch();
    }

    // Post-creation sequence
    window.threeKADNeedsRebuild = true;
    if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
    if (typeof window.debouncedSaveKAD === "function") window.debouncedSaveKAD();
    if (typeof window.debouncedSaveLayers === "function") window.debouncedSaveLayers();
    if (typeof window.debouncedUpdateTreeView === "function") window.debouncedUpdateTreeView();
}

// ────────────────────────────────────────────────────────
// Info dialog
// ────────────────────────────────────────────────────────

function showInfo(message) {
    import("../dialog/FloatingDialog.js").then(function(mod) {
        var content = document.createElement("div");
        content.style.padding = "15px";
        content.style.whiteSpace = "pre-wrap";
        content.textContent = message;

        var dialog = new mod.FloatingDialog({
            title: "Surface Contours",
            content: content,
            width: 420,
            height: 220,
            showConfirm: true,
            confirmText: "OK",
            showCancel: false
        });
        dialog.show();
    }).catch(function(err) {
        console.warn("Could not show info dialog:", err);
        alert(message);
    });
}
