/**
 * SurfaceIntersectionHelper.js
 *
 * Computes triangle-mesh intersections between 2+ loaded surfaces
 * and outputs closed KAD polygon entities at their intersection lines.
 */

import { AddKADEntityAction } from "../tools/UndoActions.js";
import { showWorkerProgressDialog } from "../dialog/popups/generic/WorkerProgressDialog.js";

/**
 * Compute surface intersections and create KAD polyline entities.
 *
 * @param {Object} config
 * @param {string[]} config.surfaceIds - IDs of surfaces to intersect
 * @param {number} config.vertexSpacing - Simplification tolerance (0 = keep all)
 * @param {boolean} config.closedPolygons - Whether to close polylines
 * @param {string} config.color - Hex color for result polylines
 * @param {number} config.lineWidth - Line width
 * @param {string} config.layerName - Target KAD layer name
 */
export async function computeSurfaceIntersections(config) {
    if (!config || !config.surfaceIds || config.surfaceIds.length < 2) {
        console.error("SurfaceIntersectionHelper: Need at least 2 surface IDs");
        return;
    }

    console.log("Computing surface intersections for " + config.surfaceIds.length + " surfaces...");

    // Step 1) Collect surface data on main thread (needs window.loadedSurfaces)
    var surfaces = [];
    for (var i = 0; i < config.surfaceIds.length; i++) {
        var surfId = config.surfaceIds[i];
        var surface = window.loadedSurfaces.get(surfId);
        if (!surface) {
            console.warn("Surface not found: " + surfId);
            continue;
        }
        // Send serializable surface data to worker
        surfaces.push({ id: surfId, points: surface.points, triangles: surface.triangles });
    }

    if (surfaces.length < 2) {
        console.error("Need at least 2 surfaces with triangles");
        return;
    }

    // Step 2) Show progress dialog and delegate heavy computation to Web Worker
    var progressDialog = showWorkerProgressDialog("Surface Intersection", {
        initialMessage: "Computing intersections for " + surfaces.length + " surfaces..."
    });

    try {
        var result = await computeInWorker(surfaces, config, progressDialog);

        if (result.noIntersection) {
            progressDialog.close();
            showInfo("No intersections found between the selected surfaces.");
            return;
        }

        if (!result.polylines || result.polylines.length === 0) {
            progressDialog.close();
            showInfo("Intersections found but all polylines were too short after simplification.");
            return;
        }

        console.log("Worker returned " + result.polylines.length + " polyline(s) from " + result.segmentCount + " segments");

        // Step 3) Create KAD poly entities on main thread (needs window state)
        createKADEntities(result.polylines, config);

        progressDialog.complete(result.polylines.length + " polyline(s) created");
    } catch (err) {
        console.error("Surface intersection worker error:", err);
        progressDialog.fail("Intersection failed: " + err.message);
        showInfo("Surface intersection failed: " + err.message);
    }
}

/**
 * Run surface intersection computation in a Web Worker.
 */
function computeInWorker(surfaces, config, progressDialog) {
    return new Promise(function(resolve, reject) {
        var worker = new Worker(
            new URL("../workers/surfaceIntersectionWorker.js", import.meta.url),
            { type: "module" }
        );

        function handler(e) {
            var msg = e.data;
            if (msg.type === "progress") {
                if (progressDialog) progressDialog.update(msg.percent, msg.message);
            } else if (msg.type === "result") {
                worker.removeEventListener("message", handler);
                worker.removeEventListener("error", errHandler);
                worker.terminate();
                resolve(msg.data);
            } else if (msg.type === "error") {
                worker.removeEventListener("message", handler);
                worker.removeEventListener("error", errHandler);
                worker.terminate();
                reject(new Error(msg.message));
            }
        }

        function errHandler(err) {
            worker.removeEventListener("message", handler);
            worker.removeEventListener("error", errHandler);
            worker.terminate();
            reject(new Error("Worker error: " + (err.message || String(err))));
        }

        worker.addEventListener("message", handler);
        worker.addEventListener("error", errHandler);

        worker.postMessage({
            type: "intersect",
            payload: { surfaces: surfaces, config: { vertexSpacing: config.vertexSpacing || 0 } }
        });
    });
}

// ────────────────────────────────────────────────────────
// Step 1) Extract triangles from a surface
// ────────────────────────────────────────────────────────

/**
 * Extract triangles as flat vertex arrays from surface data.
 * Handles all triangle formats in the codebase.
 *
 * @param {Object} surface
 * @returns {Array} Array of {v0, v1, v2} where each is {x, y, z}
 */
export function extractTriangles(surface) {
    var tris = [];
    var triangles = surface.triangles;
    var points = surface.points;

    if (!triangles || !Array.isArray(triangles) || triangles.length === 0) {
        return tris;
    }

    for (var i = 0; i < triangles.length; i++) {
        var tri = triangles[i];
        var v0, v1, v2;

        if (tri.vertices && Array.isArray(tri.vertices) && tri.vertices.length >= 3) {
            // Format: {vertices: [{x,y,z}, ...]}
            v0 = tri.vertices[0];
            v1 = tri.vertices[1];
            v2 = tri.vertices[2];
        } else if (tri.a !== undefined && tri.b !== undefined && tri.c !== undefined && points) {
            // Format: {a, b, c} index refs to surface.points[]
            v0 = points[tri.a];
            v1 = points[tri.b];
            v2 = points[tri.c];
        } else if (tri.indices && Array.isArray(tri.indices) && tri.indices.length >= 3 && points) {
            // Format: {indices: [0,1,2]}
            v0 = points[tri.indices[0]];
            v1 = points[tri.indices[1]];
            v2 = points[tri.indices[2]];
        } else {
            continue;
        }

        if (v0 && v1 && v2) {
            tris.push({
                v0: { x: v0.x, y: v0.y, z: v0.z },
                v1: { x: v1.x, y: v1.y, z: v1.z },
                v2: { x: v2.x, y: v2.y, z: v2.z }
            });
        }
    }

    return tris;
}

// ────────────────────────────────────────────────────────
// Step 2) Bounding box utilities
// ────────────────────────────────────────────────────────

export function computeBBox(tris) {
    var minX = Infinity, minY = Infinity, minZ = Infinity;
    var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (var i = 0; i < tris.length; i++) {
        var t = tris[i];
        var verts = [t.v0, t.v1, t.v2];
        for (var j = 0; j < 3; j++) {
            var v = verts[j];
            if (v.x < minX) minX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.z < minZ) minZ = v.z;
            if (v.x > maxX) maxX = v.x;
            if (v.y > maxY) maxY = v.y;
            if (v.z > maxZ) maxZ = v.z;
        }
    }

    return { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ };
}

export function bboxOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY &&
           a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function triBBox(tri) {
    return {
        minX: Math.min(tri.v0.x, tri.v1.x, tri.v2.x),
        minY: Math.min(tri.v0.y, tri.v1.y, tri.v2.y),
        minZ: Math.min(tri.v0.z, tri.v1.z, tri.v2.z),
        maxX: Math.max(tri.v0.x, tri.v1.x, tri.v2.x),
        maxY: Math.max(tri.v0.y, tri.v1.y, tri.v2.y),
        maxZ: Math.max(tri.v0.z, tri.v1.z, tri.v2.z)
    };
}

// ────────────────────────────────────────────────────────
// Step 3) Spatial grid acceleration
// ────────────────────────────────────────────────────────

export function buildSpatialGrid(tris, cellSize) {
    var grid = {};

    for (var i = 0; i < tris.length; i++) {
        var bb = triBBox(tris[i]);
        var x0 = Math.floor(bb.minX / cellSize);
        var y0 = Math.floor(bb.minY / cellSize);
        var x1 = Math.floor(bb.maxX / cellSize);
        var y1 = Math.floor(bb.maxY / cellSize);

        for (var gx = x0; gx <= x1; gx++) {
            for (var gy = y0; gy <= y1; gy++) {
                var key = gx + "," + gy;
                if (!grid[key]) grid[key] = [];
                grid[key].push(i);
            }
        }
    }

    return grid;
}

export function queryGrid(grid, bb, cellSize) {
    var x0 = Math.floor(bb.minX / cellSize);
    var y0 = Math.floor(bb.minY / cellSize);
    var x1 = Math.floor(bb.maxX / cellSize);
    var y1 = Math.floor(bb.maxY / cellSize);

    var seen = {};
    var result = [];

    for (var gx = x0; gx <= x1; gx++) {
        for (var gy = y0; gy <= y1; gy++) {
            var key = gx + "," + gy;
            var cell = grid[key];
            if (!cell) continue;
            for (var c = 0; c < cell.length; c++) {
                var idx = cell[c];
                if (!seen[idx]) {
                    seen[idx] = true;
                    result.push(idx);
                }
            }
        }
    }

    return result;
}

/**
 * Build a spatial grid on arbitrary two axes.
 * getA/getB extract the two bucketing coordinates from a vertex.
 *
 * @param {Array} tris - Array of {v0, v1, v2}
 * @param {number} cellSize
 * @param {function} getA - e.g. v => v.y for YZ grid
 * @param {function} getB - e.g. v => v.z for YZ grid
 * @returns {Object} grid hash
 */
export function buildSpatialGridOnAxes(tris, cellSize, getA, getB) {
    var grid = {};

    for (var i = 0; i < tris.length; i++) {
        var t = tris[i];
        var verts = [t.v0, t.v1, t.v2];

        var minA = Infinity, maxA = -Infinity;
        var minB = Infinity, maxB = -Infinity;
        for (var j = 0; j < 3; j++) {
            var a = getA(verts[j]), b = getB(verts[j]);
            if (a < minA) minA = a;
            if (a > maxA) maxA = a;
            if (b < minB) minB = b;
            if (b > maxB) maxB = b;
        }

        var a0 = Math.floor(minA / cellSize);
        var b0 = Math.floor(minB / cellSize);
        var a1 = Math.floor(maxA / cellSize);
        var b1 = Math.floor(maxB / cellSize);

        for (var ga = a0; ga <= a1; ga++) {
            for (var gb = b0; gb <= b1; gb++) {
                var key = ga + "," + gb;
                if (!grid[key]) grid[key] = [];
                grid[key].push(i);
            }
        }
    }

    return grid;
}

/**
 * Query a grid built by buildSpatialGridOnAxes for a single point.
 *
 * @param {Object} grid
 * @param {number} a - first axis coordinate of the query point
 * @param {number} b - second axis coordinate of the query point
 * @param {number} cellSize
 * @returns {Array} triangle indices
 */
export function queryGridOnAxes(grid, a, b, cellSize) {
    var ga = Math.floor(a / cellSize);
    var gb = Math.floor(b / cellSize);
    var key = ga + "," + gb;
    var cell = grid[key];
    return cell ? cell : [];
}

// ────────────────────────────────────────────────────────
// Step 4) Moller triangle-triangle intersection
// ────────────────────────────────────────────────────────

export function intersectSurfacePair(trisA, trisB) {
    var segments = [];

    // Compute average edge length for grid cell size
    var avgEdge = estimateAvgEdge(trisB);
    var cellSize = Math.max(avgEdge * 2, 0.1);

    // Build grid on surface B
    var gridB = buildSpatialGrid(trisB, cellSize);

    // For each triangle in A, find candidate triangles in B
    for (var i = 0; i < trisA.length; i++) {
        var triA = trisA[i];
        var bbA = triBBox(triA);

        var candidates = queryGrid(gridB, bbA, cellSize);

        for (var c = 0; c < candidates.length; c++) {
            var triB = trisB[candidates[c]];

            var seg = triTriIntersection(triA, triB);
            if (seg) {
                segments.push(seg);
            }
        }
    }

    return segments;
}

/**
 * Like intersectSurfacePair but returns segments tagged with source triangle indices.
 * Each result: { p0: {x,y,z}, p1: {x,y,z}, idxA: number, idxB: number }
 */
export function intersectSurfacePairTagged(trisA, trisB) {
    var segments = [];

    var avgEdge = estimateAvgEdge(trisB);
    var cellSize = Math.max(avgEdge * 2, 0.1);
    var gridB = buildSpatialGrid(trisB, cellSize);

    for (var i = 0; i < trisA.length; i++) {
        var triA = trisA[i];
        var bbA = triBBox(triA);
        var candidates = queryGrid(gridB, bbA, cellSize);

        for (var c = 0; c < candidates.length; c++) {
            var j = candidates[c];
            var triB = trisB[j];
            var seg = triTriIntersection(triA, triB);
            if (seg) {
                segments.push({ p0: seg.p0, p1: seg.p1, idxA: i, idxB: j });
            }
        }
    }

    return segments;
}

export function estimateAvgEdge(tris) {
    if (tris.length === 0) return 1.0;
    var total = 0;
    var count = Math.min(tris.length, 100); // Sample first 100
    for (var i = 0; i < count; i++) {
        var t = tris[i];
        total += dist3D(t.v0, t.v1);
        total += dist3D(t.v1, t.v2);
        total += dist3D(t.v2, t.v0);
    }
    return total / (count * 3);
}

export function dist3D(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Moller triangle-triangle intersection.
 * Returns intersection line segment {p0, p1} or null.
 */
export function triTriIntersection(triA, triB) {
    // Compute plane of triangle B
    var nB = triNormal(triB);
    var dB = -(nB.x * triB.v0.x + nB.y * triB.v0.y + nB.z * triB.v0.z);

    // Signed distances of triA vertices to plane B
    var dA0 = nB.x * triA.v0.x + nB.y * triA.v0.y + nB.z * triA.v0.z + dB;
    var dA1 = nB.x * triA.v1.x + nB.y * triA.v1.y + nB.z * triA.v1.z + dB;
    var dA2 = nB.x * triA.v2.x + nB.y * triA.v2.y + nB.z * triA.v2.z + dB;

    // All on same side → no intersection
    if (dA0 > 0 && dA1 > 0 && dA2 > 0) return null;
    if (dA0 < 0 && dA1 < 0 && dA2 < 0) return null;

    // Compute plane of triangle A
    var nA = triNormal(triA);
    var dA = -(nA.x * triA.v0.x + nA.y * triA.v0.y + nA.z * triA.v0.z);

    // Signed distances of triB vertices to plane A
    var dB0 = nA.x * triB.v0.x + nA.y * triB.v0.y + nA.z * triB.v0.z + dA;
    var dB1 = nA.x * triB.v1.x + nA.y * triB.v1.y + nA.z * triB.v1.z + dA;
    var dB2 = nA.x * triB.v2.x + nA.y * triB.v2.y + nA.z * triB.v2.z + dA;

    // All on same side → no intersection
    if (dB0 > 0 && dB1 > 0 && dB2 > 0) return null;
    if (dB0 < 0 && dB1 < 0 && dB2 < 0) return null;

    // Check near-parallel planes
    var dotN = nA.x * nB.x + nA.y * nB.y + nA.z * nB.z;
    if (Math.abs(dotN) > 0.9999) return null;

    // Intersection line direction
    var lineDir = cross(nA, nB);
    var lineDirLen = Math.sqrt(lineDir.x * lineDir.x + lineDir.y * lineDir.y + lineDir.z * lineDir.z);
    if (lineDirLen < 1e-12) return null;
    lineDir.x /= lineDirLen;
    lineDir.y /= lineDirLen;
    lineDir.z /= lineDirLen;

    // Find a point on the intersection line FIRST (needed for relative projection)
    var linePoint = findLinePoint(nA, dA, nB, dB, lineDir);
    if (!linePoint) return null;

    // Project triA/triB edges onto intersection line to find intervals (relative to linePoint)
    var intervalA = computeTriInterval(triA, lineDir, linePoint, dA0, dA1, dA2);
    if (!intervalA) return null;

    var intervalB = computeTriInterval(triB, lineDir, linePoint, dB0, dB1, dB2);
    if (!intervalB) return null;

    // Overlap of intervals
    var overlapMin = Math.max(intervalA.min, intervalB.min);
    var overlapMax = Math.min(intervalA.max, intervalB.max);

    if (overlapMin >= overlapMax - 1e-10) return null;

    // Convert parametric overlap back to 3D
    var p0 = {
        x: linePoint.x + lineDir.x * overlapMin,
        y: linePoint.y + lineDir.y * overlapMin,
        z: linePoint.z + lineDir.z * overlapMin
    };
    var p1 = {
        x: linePoint.x + lineDir.x * overlapMax,
        y: linePoint.y + lineDir.y * overlapMax,
        z: linePoint.z + lineDir.z * overlapMax
    };

    // Skip degenerate segments
    if (dist3D(p0, p1) < 1e-8) return null;

    return { p0: p0, p1: p1 };
}

/**
 * Moller triangle-triangle intersection with signed-distance data.
 * Returns { dA: [d0,d1,d2], dB: [d0,d1,d2], segLen } or null.
 * dA = signed distances of triA's vertices to plane(triB)
 * dB = signed distances of triB's vertices to plane(triA)
 * segLen = length of the intersection segment
 */
export function triTriIntersectionDetailed(triA, triB) {
    var nB = triNormal(triB);
    var dB = -(nB.x * triB.v0.x + nB.y * triB.v0.y + nB.z * triB.v0.z);

    var dA0 = nB.x * triA.v0.x + nB.y * triA.v0.y + nB.z * triA.v0.z + dB;
    var dA1 = nB.x * triA.v1.x + nB.y * triA.v1.y + nB.z * triA.v1.z + dB;
    var dA2 = nB.x * triA.v2.x + nB.y * triA.v2.y + nB.z * triA.v2.z + dB;

    if (dA0 > 0 && dA1 > 0 && dA2 > 0) return null;
    if (dA0 < 0 && dA1 < 0 && dA2 < 0) return null;

    var nA = triNormal(triA);
    var dA = -(nA.x * triA.v0.x + nA.y * triA.v0.y + nA.z * triA.v0.z);

    var dB0 = nA.x * triB.v0.x + nA.y * triB.v0.y + nA.z * triB.v0.z + dA;
    var dB1 = nA.x * triB.v1.x + nA.y * triB.v1.y + nA.z * triB.v1.z + dA;
    var dB2 = nA.x * triB.v2.x + nA.y * triB.v2.y + nA.z * triB.v2.z + dA;

    if (dB0 > 0 && dB1 > 0 && dB2 > 0) return null;
    if (dB0 < 0 && dB1 < 0 && dB2 < 0) return null;

    var dotN = nA.x * nB.x + nA.y * nB.y + nA.z * nB.z;
    if (Math.abs(dotN) > 0.9999) return null;

    var lineDir = cross(nA, nB);
    var lineDirLen = Math.sqrt(lineDir.x * lineDir.x + lineDir.y * lineDir.y + lineDir.z * lineDir.z);
    if (lineDirLen < 1e-12) return null;
    lineDir.x /= lineDirLen; lineDir.y /= lineDirLen; lineDir.z /= lineDirLen;

    var linePoint = findLinePoint(nA, dA, nB, dB, lineDir);
    if (!linePoint) return null;

    var intervalA = computeTriInterval(triA, lineDir, linePoint, dA0, dA1, dA2);
    if (!intervalA) return null;

    var intervalB = computeTriInterval(triB, lineDir, linePoint, dB0, dB1, dB2);
    if (!intervalB) return null;

    var overlapMin = Math.max(intervalA.min, intervalB.min);
    var overlapMax = Math.min(intervalA.max, intervalB.max);
    if (overlapMin >= overlapMax - 1e-10) return null;

    var segLen = overlapMax - overlapMin;
    if (segLen < 1e-8) return null;

    return {
        dA: [dA0, dA1, dA2],
        dB: [dB0, dB1, dB2],
        segLen: segLen
    };
}

export function triNormal(tri) {
    var e1 = { x: tri.v1.x - tri.v0.x, y: tri.v1.y - tri.v0.y, z: tri.v1.z - tri.v0.z };
    var e2 = { x: tri.v2.x - tri.v0.x, y: tri.v2.y - tri.v0.y, z: tri.v2.z - tri.v0.z };
    var n = cross(e1, e2);
    var len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (len < 1e-15) return { x: 0, y: 0, z: 1 };
    return { x: n.x / len, y: n.y / len, z: n.z / len };
}

export function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}

// ────────────────────────────────────────────────────────
// Normal alignment utilities
// ────────────────────────────────────────────────────────

/**
 * Enforce Kirra's Z-up convention on all triangles.
 * If a triangle's face normal points downward (z < 0), its winding
 * is reversed by swapping v1 and v2. Near-vertical faces (|z| < 0.01)
 * are left unchanged.
 *
 * Returns a NEW cloned array — never modifies the original.
 *
 * @param {Array} tris - Array of {v0, v1, v2}
 * @returns {Array} Cloned array with consistent Z-up normals
 */
export function ensureZUpNormals(tris) {
    var result = [];
    var flipped = 0;

    for (var i = 0; i < tris.length; i++) {
        var tri = tris[i];
        var v0 = { x: tri.v0.x, y: tri.v0.y, z: tri.v0.z };
        var v1 = { x: tri.v1.x, y: tri.v1.y, z: tri.v1.z };
        var v2 = { x: tri.v2.x, y: tri.v2.y, z: tri.v2.z };

        var n = triNormal({ v0: v0, v1: v1, v2: v2 });

        if (n.z < -0.01) {
            // Downward-facing — swap v1 and v2 to flip normal
            result.push({ v0: v0, v1: v2, v2: v1 });
            flipped++;
        } else {
            result.push({ v0: v0, v1: v1, v2: v2 });
        }
    }

    if (flipped > 0) {
        console.log("ensureZUpNormals: flipped " + flipped + "/" + tris.length + " triangles to Z-up");
    }

    return result;
}

/**
 * Count open (boundary) and non-manifold (over-shared) edges in a triangle soup.
 * Uses the same vertex-key pattern as extractBoundaryLoops in SurfaceBooleanHelper.
 *
 * @param {Array} tris - Array of {v0, v1, v2}
 * @returns {{ openEdges: number, overShared: number, total: number }}
 */
export function countOpenEdges(tris) {
    var edgeMap = {};
    var PREC = 6;

    function vKey(v) {
        return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
    }

    function edgeKey(ka, kb) {
        return ka < kb ? ka + "|" + kb : kb + "|" + ka;
    }

    for (var i = 0; i < tris.length; i++) {
        var tri = tris[i];
        var verts = [tri.v0, tri.v1, tri.v2];
        var keys = [vKey(verts[0]), vKey(verts[1]), vKey(verts[2])];

        for (var e = 0; e < 3; e++) {
            var ne = (e + 1) % 3;
            var ek = edgeKey(keys[e], keys[ne]);
            if (!edgeMap[ek]) {
                edgeMap[ek] = 0;
            }
            edgeMap[ek]++;
        }
    }

    var openEdges = 0;
    var overShared = 0;
    var total = 0;

    for (var ek2 in edgeMap) {
        total++;
        if (edgeMap[ek2] === 1) {
            openEdges++;
        } else if (edgeMap[ek2] > 2) {
            overShared++;
        }
    }

    return { openEdges: openEdges, overShared: overShared, total: total };
}

/**
 * Flip all triangle normals unconditionally by swapping v1 and v2.
 * Returns a NEW cloned array — never modifies the original.
 *
 * @param {Array} tris - Array of {v0, v1, v2}
 * @returns {Array} Cloned array with all normals inverted
 */
export function flipAllNormals(tris) {
    var result = [];

    for (var i = 0; i < tris.length; i++) {
        var tri = tris[i];
        result.push({
            v0: { x: tri.v0.x, y: tri.v0.y, z: tri.v0.z },
            v1: { x: tri.v2.x, y: tri.v2.y, z: tri.v2.z },
            v2: { x: tri.v1.x, y: tri.v1.y, z: tri.v1.z }
        });
    }

    return result;
}

/**
 * Compute the parametric interval where a triangle crosses the
 * intersection line, projected along lineDir.
 */
export function computeTriInterval(tri, lineDir, linePoint, d0, d1, d2) {
    var verts = [tri.v0, tri.v1, tri.v2];
    var dists = [d0, d1, d2];
    var params = [];

    // Find edges that cross the plane (sign change in distances)
    for (var i = 0; i < 3; i++) {
        var j = (i + 1) % 3;
        var di = dists[i];
        var dj = dists[j];

        if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
            // Edge crosses the plane
            var t = di / (di - dj);
            var pt = {
                x: verts[i].x + t * (verts[j].x - verts[i].x),
                y: verts[i].y + t * (verts[j].y - verts[i].y),
                z: verts[i].z + t * (verts[j].z - verts[i].z)
            };
            // Relative projection onto line (relative to linePoint for UTM precision)
            var param = (pt.x - linePoint.x) * lineDir.x + (pt.y - linePoint.y) * lineDir.y + (pt.z - linePoint.z) * lineDir.z;
            params.push(param);
        } else if (Math.abs(di) < 1e-10) {
            // Vertex on the plane — relative projection
            var param2 = (verts[i].x - linePoint.x) * lineDir.x + (verts[i].y - linePoint.y) * lineDir.y + (verts[i].z - linePoint.z) * lineDir.z;
            params.push(param2);
        }
    }
    // Also check if vertex 2 is on the plane (it's not checked as j in the loop for i=2)
    // Actually the loop does check all 3 edges (0-1, 1-2, 2-0), but vertex-on-plane
    // might produce duplicates. Deduplicate.

    if (params.length < 2) return null;

    // Deduplicate very close values
    params.sort(function(a, b) { return a - b; });

    return { min: params[0], max: params[params.length - 1] };
}

/**
 * Find a point on the intersection line of two planes.
 */
export function findLinePoint(nA, dA, nB, dB, lineDir) {
    // Find the dominant axis of lineDir to set it to 0
    var ax = Math.abs(lineDir.x);
    var ay = Math.abs(lineDir.y);
    var az = Math.abs(lineDir.z);

    var px, py, pz;

    if (az >= ax && az >= ay) {
        // Set z = 0, solve for x, y via Cramer's rule
        var det = nA.x * nB.y - nA.y * nB.x;
        if (Math.abs(det) < 1e-12) return null;
        px = (-dA * nB.y + dB * nA.y) / det;
        py = (nA.x * (-dB) - nB.x * (-dA)) / det;
        pz = 0;
    } else if (ay >= ax) {
        // Set y = 0, solve for x, z via Cramer's rule
        var det2 = nA.x * nB.z - nA.z * nB.x;
        if (Math.abs(det2) < 1e-12) return null;
        px = (-dA * nB.z + dB * nA.z) / det2;
        py = 0;
        pz = (nA.x * (-dB) - nB.x * (-dA)) / det2;
    } else {
        // Set x = 0, solve for y, z via Cramer's rule
        var det3 = nA.y * nB.z - nA.z * nB.y;
        if (Math.abs(det3) < 1e-12) return null;
        px = 0;
        py = (-dA * nB.z + dB * nA.z) / det3;
        pz = (nA.y * (-dB) - nB.y * (-dA)) / det3;
    }

    return { x: px, y: py, z: pz };
}

// ────────────────────────────────────────────────────────
// Step 5) Chain segments into polylines
// ────────────────────────────────────────────────────────

export function chainSegments(segments, threshold) {
    if (segments.length === 0) return [];

    // Build a spatial hash of segment endpoints for O(1) neighbor lookup
    var cellSize = threshold * 2;
    var endpointMap = {}; // hash -> [{segIdx, endIdx (0 or 1)}]

    function pointHash(p) {
        var cx = Math.floor(p.x / cellSize);
        var cy = Math.floor(p.y / cellSize);
        var cz = Math.floor(p.z / cellSize);
        return cx + "," + cy + "," + cz;
    }

    function nearbyKeys(p) {
        var cx = Math.floor(p.x / cellSize);
        var cy = Math.floor(p.y / cellSize);
        var cz = Math.floor(p.z / cellSize);
        var keys = [];
        for (var dx = -1; dx <= 1; dx++) {
            for (var dy = -1; dy <= 1; dy++) {
                for (var dz = -1; dz <= 1; dz++) {
                    keys.push((cx + dx) + "," + (cy + dy) + "," + (cz + dz));
                }
            }
        }
        return keys;
    }

    // Index all endpoints
    for (var i = 0; i < segments.length; i++) {
        var pts = [segments[i].p0, segments[i].p1];
        for (var e = 0; e < 2; e++) {
            var key = pointHash(pts[e]);
            if (!endpointMap[key]) endpointMap[key] = [];
            endpointMap[key].push({ segIdx: i, endIdx: e });
        }
    }

    var threshSq = threshold * threshold;
    var used = new Array(segments.length);
    for (var u = 0; u < used.length; u++) used[u] = false;

    // Find nearest unused segment endpoint to a query point
    function findNearest(queryPt, excludeSeg) {
        var keys = nearbyKeys(queryPt);
        var bestDist = threshSq;
        var bestSeg = -1;
        var bestEnd = -1;
        for (var k = 0; k < keys.length; k++) {
            var bucket = endpointMap[keys[k]];
            if (!bucket) continue;
            for (var b = 0; b < bucket.length; b++) {
                var entry = bucket[b];
                if (used[entry.segIdx] || entry.segIdx === excludeSeg) continue;
                var pt = entry.endIdx === 0 ? segments[entry.segIdx].p0 : segments[entry.segIdx].p1;
                var d = distSq3D(queryPt, pt);
                if (d < bestDist) {
                    bestDist = d;
                    bestSeg = entry.segIdx;
                    bestEnd = entry.endIdx;
                }
            }
        }
        return bestSeg >= 0 ? { segIdx: bestSeg, endIdx: bestEnd } : null;
    }

    var polylines = [];

    for (var s = 0; s < segments.length; s++) {
        if (used[s]) continue;
        used[s] = true;

        // Build chain as a deque (array grown from tail, then reversed front prepended at end)
        var tailChain = [segments[s].p0, segments[s].p1];
        var headChain = []; // will be reversed and prepended

        // Extend tail
        var extending = true;
        while (extending) {
            extending = false;
            var tail = tailChain[tailChain.length - 1];
            var match = findNearest(tail, -1);
            if (match) {
                used[match.segIdx] = true;
                var seg = segments[match.segIdx];
                // match.endIdx is the end that matched our tail; push the OTHER end
                if (match.endIdx === 0) {
                    tailChain.push(seg.p1);
                } else {
                    tailChain.push(seg.p0);
                }
                extending = true;
            }
        }

        // Extend head (grow headChain forward, reverse later)
        extending = true;
        while (extending) {
            extending = false;
            var head = headChain.length > 0 ? headChain[headChain.length - 1] : tailChain[0];
            var match2 = findNearest(head, -1);
            if (match2) {
                used[match2.segIdx] = true;
                var seg2 = segments[match2.segIdx];
                if (match2.endIdx === 0) {
                    headChain.push(seg2.p1);
                } else {
                    headChain.push(seg2.p0);
                }
                extending = true;
            }
        }

        // Combine: reverse headChain + tailChain
        if (headChain.length > 0) {
            headChain.reverse();
            var chain = headChain.concat(tailChain);
            polylines.push(chain);
        } else {
            polylines.push(tailChain);
        }
    }

    return polylines;
}

function distSq3D(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

// ────────────────────────────────────────────────────────
// Step 6) Simplify polyline by vertex spacing
// ────────────────────────────────────────────────────────

export function simplifyPolyline(points, spacing) {
    if (points.length <= 2 || spacing <= 0) return points;

    var result = [points[0]];
    var accumulated = 0;

    for (var i = 1; i < points.length - 1; i++) {
        accumulated += dist3D(points[i - 1], points[i]);
        if (accumulated >= spacing) {
            result.push(points[i]);
            accumulated = 0;
        }
    }

    // Always keep last point
    result.push(points[points.length - 1]);

    return result;
}

// ────────────────────────────────────────────────────────
// Step 7) Create KAD poly entities with undo batch
// ────────────────────────────────────────────────────────

export function createKADEntities(polylines, config) {
    // Step 7a) Begin batch
    if (window.undoManager && polylines.length > 1) {
        window.undoManager.beginBatch("Surface Intersection (" + polylines.length + " polygons)");
    }

    // Step 7b) Get or create layer in allDrawingLayers
    var activeLayerId = null;
    var activeLayer = null;
    if (window.allDrawingLayers) {
        for (var [layerId, layer] of window.allDrawingLayers) {
            if ((layer.layerName || layer.name) === config.layerName) {
                activeLayer = layer;
                activeLayerId = layerId;
                break;
            }
        }
        if (!activeLayer) {
            activeLayerId = "layer_" + Math.random().toString(36).substring(2, 6);
            activeLayer = {
                layerId: activeLayerId,
                layerName: config.layerName,
                type: "drawing",
                visible: true,
                entities: new Set()
            };
            window.allDrawingLayers.set(activeLayerId, activeLayer);
        }
    }

    // Step 7c) Create entity per polyline
    var isClosed = config.closedPolygons === true;
    var entType = isClosed ? "poly" : "line";

    polylines.forEach(function(points, idx) {
        var entityName = config.layerName + "_" + Math.random().toString(36).substring(2, 6) + "_" + idx;
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
                    lineWidth: config.lineWidth || 3,
                    color: config.color || "#FFCC00",
                    closed: isClosed,
                    visible: true
                };
            })
        };
        window.allKADDrawingsMap.set(entityName, entityData);
        if (activeLayer) activeLayer.entities.add(entityName);

        // Step 7d) Push undo
        if (window.undoManager) {
            var action = new AddKADEntityAction(entityName, JSON.parse(JSON.stringify(entityData)));
            window.undoManager.pushAction(action);
        }
    });

    // Step 7e) End batch
    if (window.undoManager && polylines.length > 1) {
        window.undoManager.endBatch();
    }

    // Step 8) Post-creation sequence
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
    // Dynamic import to avoid circular dependency
    import("../dialog/FloatingDialog.js").then(function(mod) {
        var content = document.createElement("div");
        content.style.padding = "15px";
        content.style.whiteSpace = "pre-wrap";
        content.textContent = message;

        var dialog = new mod.FloatingDialog({
            title: "Surface Intersection",
            content: content,
            width: 400,
            height: 200,
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
