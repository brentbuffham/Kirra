// src/helpers/SelfIntersectionHelper.js
// =============================================================================
// SELF-INTERSECTION DETECTION — Find crossing triangles within a single mesh
// =============================================================================
// Uses spatial grid acceleration + triTriIntersection from SurfaceIntersectionHelper.
// Created: 2026-03-06

import { triTriIntersection, triBBox, estimateAvgEdge } from "./SurfaceIntersectionHelper.js";
import { triangleArea3D } from "./MeshRepairHelper.js";

/**
 * Detect self-intersecting (crossing) triangle pairs within a single mesh.
 *
 * @param {Array} tris — Triangle soup [{v0, v1, v2}, ...]
 * @param {Function} [onProgress] — Optional progress callback(message)
 * @returns {{ count: number, pairs: Array<{idxA: number, idxB: number}> }}
 */
export function detectSelfIntersections(tris, onProgress) {
	if (!tris || tris.length === 0) {
		return { count: 0, pairs: [] };
	}

	if (typeof onProgress === "function") onProgress("Building spatial grid...");

	// Build 3D spatial grid from triangle bounding boxes
	var avgEdge = estimateAvgEdge(tris);
	var cellSize = avgEdge * 2;
	if (cellSize < 0.01) cellSize = 0.01;

	var bboxes = new Array(tris.length);
	var grid = {};

	for (var i = 0; i < tris.length; i++) {
		var bb = triBBox(tris[i]);
		bboxes[i] = bb;

		var x0 = Math.floor(bb.minX / cellSize);
		var y0 = Math.floor(bb.minY / cellSize);
		var z0 = Math.floor(bb.minZ / cellSize);
		var x1 = Math.floor(bb.maxX / cellSize);
		var y1 = Math.floor(bb.maxY / cellSize);
		var z1 = Math.floor(bb.maxZ / cellSize);

		for (var gx = x0; gx <= x1; gx++) {
			for (var gy = y0; gy <= y1; gy++) {
				for (var gz = z0; gz <= z1; gz++) {
					var key = gx + "," + gy + "," + gz;
					if (!grid[key]) grid[key] = [];
					grid[key].push(i);
				}
			}
		}
	}

	if (typeof onProgress === "function") onProgress("Testing triangle pairs...");

	// Build vertex-sharing adjacency to skip neighbours
	// Two triangles sharing a vertex are adjacent — they can't "cross"
	var tol2 = 1e-8; // squared tolerance for vertex matching
	var pairs = [];
	var tested = {}; // "min,max" → true to avoid duplicate pair tests

	for (var ti = 0; ti < tris.length; ti++) {
		var bbA = bboxes[ti];
		var triA = tris[ti];

		// Query 3D grid cells that overlap this triangle's bbox
		var ax0 = Math.floor(bbA.minX / cellSize);
		var ay0 = Math.floor(bbA.minY / cellSize);
		var az0 = Math.floor(bbA.minZ / cellSize);
		var ax1 = Math.floor(bbA.maxX / cellSize);
		var ay1 = Math.floor(bbA.maxY / cellSize);
		var az1 = Math.floor(bbA.maxZ / cellSize);

		var candidates = {};
		for (var cx = ax0; cx <= ax1; cx++) {
			for (var cy = ay0; cy <= ay1; cy++) {
				for (var cz = az0; cz <= az1; cz++) {
					var ckey = cx + "," + cy + "," + cz;
					var cell = grid[ckey];
					if (!cell) continue;
					for (var ci = 0; ci < cell.length; ci++) {
						var cIdx = cell[ci];
						if (cIdx > ti) candidates[cIdx] = true;
					}
				}
			}
		}

		var vertsA = [triA.v0, triA.v1, triA.v2];

		for (var cj in candidates) {
			var tj = parseInt(cj, 10);
			var pairKey = ti + "," + tj;
			if (tested[pairKey]) continue;
			tested[pairKey] = true;

			var triB = tris[tj];

			// Skip pairs sharing a vertex (adjacent triangles)
			if (sharesVertex(vertsA, triB, tol2)) continue;

			// AABB overlap check (Z axis too)
			var bbB = bboxes[tj];
			if (bbA.minX > bbB.maxX || bbA.maxX < bbB.minX ||
				bbA.minY > bbB.maxY || bbA.maxY < bbB.minY ||
				bbA.minZ > bbB.maxZ || bbA.maxZ < bbB.minZ) continue;

			// Run Moller tri-tri intersection test
			var result = triTriIntersection(triA, triB);
			if (result) {
				pairs.push({ idxA: ti, idxB: tj });
			}
		}
	}

	if (typeof onProgress === "function") {
		onProgress("Found " + pairs.length + " self-intersecting pairs");
	}

	return { count: pairs.length, pairs: pairs };
}

/**
 * Check if two triangles share a vertex (within tolerance).
 */
function sharesVertex(vertsA, triB, tol2) {
	var vertsB = [triB.v0, triB.v1, triB.v2];
	for (var a = 0; a < 3; a++) {
		for (var b = 0; b < 3; b++) {
			var dx = vertsA[a].x - vertsB[b].x;
			var dy = vertsA[a].y - vertsB[b].y;
			var dz = vertsA[a].z - vertsB[b].z;
			if (dx * dx + dy * dy + dz * dz < tol2) return true;
		}
	}
	return false;
}

/**
 * Remove self-intersecting triangles from a mesh.
 * For each crossing pair, removes the triangle with smaller area.
 *
 * @param {Array} tris — Triangle soup [{v0, v1, v2}, ...]
 * @param {Function} [onProgress] — Optional progress callback
 * @returns {Array} — Cleaned triangle soup
 */
export function removeSelfIntersections(tris, onProgress) {
	var result = detectSelfIntersections(tris, onProgress);
	if (result.count === 0) return tris;

	var removeSet = {};
	for (var p = 0; p < result.pairs.length; p++) {
		var pair = result.pairs[p];
		var areaA = triangleArea3D(tris[pair.idxA]);
		var areaB = triangleArea3D(tris[pair.idxB]);
		// Remove the smaller triangle from each pair
		if (areaA <= areaB) {
			removeSet[pair.idxA] = true;
		} else {
			removeSet[pair.idxB] = true;
		}
	}

	var cleaned = [];
	for (var i = 0; i < tris.length; i++) {
		if (!removeSet[i]) cleaned.push(tris[i]);
	}

	if (typeof onProgress === "function") {
		onProgress("Removed " + Object.keys(removeSet).length + " self-intersecting triangles");
	}

	return cleaned;
}

/**
 * Get the set of triangle indices involved in self-intersections.
 *
 * @param {Array} tris — Triangle soup
 * @returns {Set<number>} — Indices of crossing triangles
 */
export function getSelfIntersectingIndices(tris) {
	var result = detectSelfIntersections(tris);
	var indices = new Set();
	for (var p = 0; p < result.pairs.length; p++) {
		indices.add(result.pairs[p].idxA);
		indices.add(result.pairs[p].idxB);
	}
	return indices;
}
