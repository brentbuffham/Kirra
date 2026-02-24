/**
 * MeshRepairHelper.js
 *
 * Shared mesh repair pipeline for post-CSG and post-boolean operations.
 * Extracted from SurfaceBooleanHelper.js for reuse by SolidCSGHelper.js.
 *
 * Functions: vertex dedup/welding, degenerate removal, boundary loop
 * extraction/capping, stitching, crossing cleanup, force-close, and
 * the high-level repairMesh() entry point.
 */

import Delaunator from "delaunator";
import Constrainautor from "@kninnug/constrainautor";
import { countOpenEdges } from "./SurfaceIntersectionHelper.js";

// ────────────────────────────────────────────────────────
// Utility helpers
// ────────────────────────────────────────────────────────

/**
 * 3D Euclidean distance between two points.
 * @param {Object} a - {x, y, z}
 * @param {Object} b - {x, y, z}
 * @returns {number}
 */
export function dist3(a, b) {
	var dx = a.x - b.x;
	var dy = a.y - b.y;
	var dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Compute the area of a triangle in 3D using the cross-product method.
 * @param {Object} tri - {v0, v1, v2}
 * @returns {number} Area in square metres
 */
export function triangleArea3D(tri) {
	var ux = tri.v1.x - tri.v0.x;
	var uy = tri.v1.y - tri.v0.y;
	var uz = tri.v1.z - tri.v0.z;
	var vx = tri.v2.x - tri.v0.x;
	var vy = tri.v2.y - tri.v0.y;
	var vz = tri.v2.z - tri.v0.z;
	var cx = uy * vz - uz * vy;
	var cy = uz * vx - ux * vz;
	var cz = ux * vy - uy * vx;
	return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Compute axis-aligned bounding box.
 * @param {Array} points - [{x, y, z}, ...]
 * @returns {Object} { minX, maxX, minY, maxY, minZ, maxZ }
 */
export function computeBounds(points) {
	var minX = Infinity, minY = Infinity, minZ = Infinity;
	var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	for (var i = 0; i < points.length; i++) {
		var p = points[i];
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.z < minZ) minZ = p.z;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
		if (p.z > maxZ) maxZ = p.z;
	}
	return { minX: minX, maxX: maxX, minY: minY, maxY: maxY, minZ: minZ, maxZ: maxZ };
}

// ────────────────────────────────────────────────────────
// Vertex deduplication — merge seam vertices at exact positions
// ────────────────────────────────────────────────────────

/**
 * Deduplicate triangle-soup vertices that share exact (within tolerance) positions.
 * CSG / split operations create duplicate vertices along seam edges — this merges them
 * so downstream edge-counting sees shared edges correctly.
 *
 * @param {Array} tris - Triangle soup [{v0,v1,v2}, ...]
 * @param {number} tolerance - Distance tolerance (default 1e-4m)
 * @returns {Array} Triangle soup with deduplicated vertices
 */
export function deduplicateSeamVertices(tris, tolerance) {
	if (!tris || tris.length === 0) return tris;
	if (tolerance === undefined) tolerance = 1e-4;

	var cellSize = tolerance * 3;
	var invCell = 1.0 / cellSize;
	var grid = {};
	var canonical = [];
	var mergedCount = 0;

	function getKey(x, y, z) {
		var cx = Math.floor(x * invCell);
		var cy = Math.floor(y * invCell);
		var cz = Math.floor(z * invCell);
		return cx + "," + cy + "," + cz;
	}

	function findOrRegister(vx, vy, vz) {
		var cx = Math.floor(vx * invCell);
		var cy = Math.floor(vy * invCell);
		var cz = Math.floor(vz * invCell);
		var tolSq = tolerance * tolerance;
		var bestDist = tolSq;
		var bestVert = null;

		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				for (var dz = -1; dz <= 1; dz++) {
					var key = (cx + dx) + "," + (cy + dy) + "," + (cz + dz);
					var bucket = grid[key];
					if (!bucket) continue;
					for (var b = 0; b < bucket.length; b++) {
						var cv = bucket[b];
						var ddx = cv.x - vx, ddy = cv.y - vy, ddz = cv.z - vz;
						var dSq = ddx * ddx + ddy * ddy + ddz * ddz;
						if (dSq < bestDist) {
							bestDist = dSq;
							bestVert = cv;
						}
					}
				}
			}
		}

		if (bestVert) {
			mergedCount++;
			return bestVert;
		}

		var newVert = { x: vx, y: vy, z: vz };
		var regKey = getKey(vx, vy, vz);
		if (!grid[regKey]) grid[regKey] = [];
		grid[regKey].push(newVert);
		canonical.push(newVert);
		return newVert;
	}

	var result = [];
	var degenerateRemoved = 0;

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var cv0 = findOrRegister(tri.v0.x, tri.v0.y, tri.v0.z);
		var cv1 = findOrRegister(tri.v1.x, tri.v1.y, tri.v1.z);
		var cv2 = findOrRegister(tri.v2.x, tri.v2.y, tri.v2.z);

		if (cv0 === cv1 || cv1 === cv2 || cv2 === cv0) {
			degenerateRemoved++;
			continue;
		}

		result.push({ v0: cv0, v1: cv1, v2: cv2 });
	}

	console.log("MeshRepairHelper: deduplicateSeamVertices — merged " + mergedCount +
		" vertices, removed " + degenerateRemoved + " degenerate tris" +
		" (" + canonical.length + " unique vertices)");

	return result;
}

// ────────────────────────────────────────────────────────
// Vertex welding — merge coincident points
// ────────────────────────────────────────────────────────

/**
 * Weld triangle soup into indexed mesh, merging vertices within tolerance.
 * Returns { points: [{x,y,z}], triangles: [{vertices:[{x,y,z},{x,y,z},{x,y,z}]}] }
 *
 * Uses spatial grid for O(n) welding instead of O(n²).
 */
export function weldVertices(tris, tolerance) {
	var points = [];
	var triangles = [];

	if (tolerance <= 0) {
		for (var i = 0; i < tris.length; i++) {
			var tri = tris[i];
			points.push(
				{ x: tri.v0.x, y: tri.v0.y, z: tri.v0.z },
				{ x: tri.v1.x, y: tri.v1.y, z: tri.v1.z },
				{ x: tri.v2.x, y: tri.v2.y, z: tri.v2.z }
			);
			triangles.push({
				vertices: [
					{ x: tri.v0.x, y: tri.v0.y, z: tri.v0.z },
					{ x: tri.v1.x, y: tri.v1.y, z: tri.v1.z },
					{ x: tri.v2.x, y: tri.v2.y, z: tri.v2.z }
				]
			});
		}
		return { points: points, triangles: triangles };
	}

	var cellSize = Math.max(tolerance * 2, 0.002);
	var grid = {};
	var tolSq = tolerance * tolerance;

	function getOrAddPoint(v) {
		var gx = Math.floor(v.x / cellSize);
		var gy = Math.floor(v.y / cellSize);
		var gz = Math.floor(v.z / cellSize);

		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				for (var dz = -1; dz <= 1; dz++) {
					var key = (gx + dx) + "," + (gy + dy) + "," + (gz + dz);
					var cell = grid[key];
					if (!cell) continue;
					for (var c = 0; c < cell.length; c++) {
						var p = points[cell[c]];
						var ddx = p.x - v.x, ddy = p.y - v.y, ddz = p.z - v.z;
						if (ddx * ddx + ddy * ddy + ddz * ddz <= tolSq) {
							return cell[c];
						}
					}
				}
			}
		}

		var idx = points.length;
		points.push({ x: v.x, y: v.y, z: v.z });
		var homeKey = gx + "," + gy + "," + gz;
		if (!grid[homeKey]) grid[homeKey] = [];
		grid[homeKey].push(idx);
		return idx;
	}

	for (var i2 = 0; i2 < tris.length; i2++) {
		var tri2 = tris[i2];
		var i0 = getOrAddPoint(tri2.v0);
		var i1 = getOrAddPoint(tri2.v1);
		var i22 = getOrAddPoint(tri2.v2);

		if (i0 === i1 || i1 === i22 || i0 === i22) continue;

		triangles.push({
			vertices: [
				{ x: points[i0].x, y: points[i0].y, z: points[i0].z },
				{ x: points[i1].x, y: points[i1].y, z: points[i1].z },
				{ x: points[i22].x, y: points[i22].y, z: points[i22].z }
			]
		});
	}

	return { points: points, triangles: triangles };
}

/**
 * Convert welded {points, triangles} back to triangle soup [{v0,v1,v2}, ...].
 * Each welded triangle has vertices: [{x,y,z}, {x,y,z}, {x,y,z}].
 *
 * @param {Array} weldedTriangles - Array of {vertices: [{x,y,z},{x,y,z},{x,y,z}]}
 * @returns {Array} Triangle soup [{v0, v1, v2}, ...]
 */
export function weldedToSoup(weldedTriangles) {
	var soup = [];
	for (var i = 0; i < weldedTriangles.length; i++) {
		var verts = weldedTriangles[i].vertices;
		soup.push({
			v0: { x: verts[0].x, y: verts[0].y, z: verts[0].z },
			v1: { x: verts[1].x, y: verts[1].y, z: verts[1].z },
			v2: { x: verts[2].x, y: verts[2].y, z: verts[2].z }
		});
	}
	return soup;
}

// ────────────────────────────────────────────────────────
// Degenerate / sliver triangle removal
// ────────────────────────────────────────────────────────

/**
 * Remove degenerate and sliver triangles from a triangle soup.
 *
 * Degenerate: area < minArea (default 1e-6 m²)
 * Sliver: minimum altitude / maximum edge length < sliverRatio (default 0.01)
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} [minArea=1e-6] - Minimum triangle area in m²
 * @param {number} [sliverRatio=0.01] - Min altitude / max edge threshold
 * @returns {Array} Filtered triangle soup
 */
export function removeDegenerateTriangles(tris, minArea, sliverRatio) {
	if (typeof minArea === "undefined") minArea = 1e-6;
	if (typeof sliverRatio === "undefined") sliverRatio = 0.01;

	var removed = 0;
	var result = [];

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var area = triangleArea3D(tri);

		if (area < minArea) {
			removed++;
			continue;
		}

		var e0 = dist3(tri.v0, tri.v1);
		var e1 = dist3(tri.v1, tri.v2);
		var e2 = dist3(tri.v2, tri.v0);
		var maxEdge = Math.max(e0, e1, e2);

		if (maxEdge > 0) {
			var minAlt = (2 * area) / maxEdge;
			if (minAlt / maxEdge < sliverRatio) {
				removed++;
				continue;
			}
		}

		result.push(tri);
	}

	if (removed > 0) {
		console.log("MeshRepairHelper: removeDegenerateTriangles — removed " +
			removed + " degenerate/sliver tris, " + result.length + " remain (was " + tris.length + ")");
	}

	return result;
}

// ────────────────────────────────────────────────────────
// Boundary loop extraction — reusable by stitch, curtain, cap
// ────────────────────────────────────────────────────────

/**
 * Extract boundary loops from triangle soup.
 * Boundary edges appear exactly once in the edge count map.
 * Returns { loops: [[ {x,y,z}, ... ]], boundaryEdgeCount: N, overSharedEdgeCount: N }
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @returns {Object}
 */
export function extractBoundaryLoops(tris) {
	var edgeMap = {};
	var PREC = 6;

	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	var halfEdges = {};

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		var keys = [vKey(verts[0]), vKey(verts[1]), vKey(verts[2])];

		for (var e = 0; e < 3; e++) {
			var ne = (e + 1) % 3;
			var ek = edgeKey(keys[e], keys[ne]);
			if (!edgeMap[ek]) {
				edgeMap[ek] = { count: 0, v0: verts[e], v1: verts[ne], k0: keys[e], k1: keys[ne] };
			}
			edgeMap[ek].count++;
			halfEdges[keys[e] + "|" + keys[ne]] = true;
		}
	}

	var boundaryEdges = [];
	var overSharedCount = 0;
	for (var ek2 in edgeMap) {
		if (edgeMap[ek2].count === 1) {
			boundaryEdges.push(edgeMap[ek2]);
		} else if (edgeMap[ek2].count > 2) {
			overSharedCount++;
		}
	}

	if (boundaryEdges.length === 0) {
		return { loops: [], boundaryEdgeCount: 0, overSharedEdgeCount: overSharedCount };
	}

	var adj = {};

	for (var b = 0; b < boundaryEdges.length; b++) {
		var be = boundaryEdges[b];
		var fromKey, toKey, fromVert, toVert;
		if (halfEdges[be.k0 + "|" + be.k1]) {
			fromKey = be.k1; toKey = be.k0;
			fromVert = be.v1; toVert = be.v0;
		} else {
			fromKey = be.k0; toKey = be.k1;
			fromVert = be.v0; toVert = be.v1;
		}
		if (!adj[fromKey]) adj[fromKey] = [];
		adj[fromKey].push({ key: toKey, vertex: toVert, fromVertex: fromVert });
	}

	var used = {};
	var loops = [];

	for (var startKey in adj) {
		if (used[startKey]) continue;

		var loop = [];
		var currentKey = startKey;
		var safety = boundaryEdges.length + 1;

		while (safety-- > 0) {
			if (used[currentKey]) break;
			used[currentKey] = true;

			var neighbors = adj[currentKey];
			if (!neighbors || neighbors.length === 0) break;

			var next = null;
			for (var n = 0; n < neighbors.length; n++) {
				if (!used[neighbors[n].key] || (neighbors[n].key === startKey && loop.length > 2)) {
					next = neighbors[n];
					break;
				}
			}

			if (!next) break;

			loop.push(next.fromVertex);
			currentKey = next.key;

			if (currentKey === startKey) break;
		}

		if (loop.length >= 3) {
			loops.push(loop);
		}
	}

	return { loops: loops, boundaryEdgeCount: boundaryEdges.length, overSharedEdgeCount: overSharedCount };
}

// ────────────────────────────────────────────────────────
// Crossing triangle cleanup — remove duplicates from splitting
// ────────────────────────────────────────────────────────

/**
 * Remove duplicate/conflicting triangles that cause over-shared edges (count > 2).
 *
 * Two-pass approach:
 *   Pass 1: For each over-shared edge, sort triangles by area (largest first),
 *           mark the smallest for removal until only 2 remain per edge.
 *   Pass 2: Also remove exact fingerprint duplicates among flagged triangles.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @returns {Array} Cleaned triangle soup
 */
export function cleanCrossingTriangles(tris) {
	var PREC = 6;

	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	var areas = [];
	var edgeToTris = {};
	var triKeys = [];

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		areas.push(triangleArea3D(tri));
		var k0 = vKey(tri.v0);
		var k1 = vKey(tri.v1);
		var k2 = vKey(tri.v2);
		triKeys.push([k0, k1, k2]);

		var edges = [edgeKey(k0, k1), edgeKey(k1, k2), edgeKey(k2, k0)];
		for (var e = 0; e < 3; e++) {
			if (!edgeToTris[edges[e]]) edgeToTris[edges[e]] = [];
			edgeToTris[edges[e]].push(i);
		}
	}

	var removeSet = {};
	var overSharedEdgeCount = 0;

	for (var ek in edgeToTris) {
		var triList = edgeToTris[ek];
		if (triList.length <= 2) continue;
		overSharedEdgeCount++;

		var sorted = triList.slice().sort(function (a, b) { return areas[b] - areas[a]; });
		for (var r = 2; r < sorted.length; r++) {
			removeSet[sorted[r]] = true;
		}
	}

	var seenFingerprints = {};
	var dupCount = 0;

	for (var j = 0; j < tris.length; j++) {
		if (removeSet[j]) continue;

		var keys = triKeys[j].slice().sort();
		var fingerprint = keys.join("||");
		if (seenFingerprints[fingerprint]) {
			removeSet[j] = true;
			dupCount++;
		} else {
			seenFingerprints[fingerprint] = true;
		}
	}

	var removedCount = Object.keys(removeSet).length;
	if (removedCount === 0) {
		console.log("MeshRepairHelper: cleanCrossingTriangles — no over-shared edges, nothing to clean");
		return tris;
	}

	var result = [];
	for (var k = 0; k < tris.length; k++) {
		if (!removeSet[k]) {
			result.push(tris[k]);
		}
	}

	console.log("MeshRepairHelper: cleanCrossingTriangles — " +
		overSharedEdgeCount + " over-shared edges, " +
		removedCount + " removed (" + dupCount + " fingerprint dups), " +
		result.length + " remain (was " + tris.length + ")");

	return result;
}

// ────────────────────────────────────────────────────────
// Overlapping triangle removal — internal wall cleanup
// ────────────────────────────────────────────────────────

/**
 * Remove overlapping triangles that form internal walls.
 *
 * Detection: Two triangles overlap when:
 *   - Their centroids are within `tolerance` in 3D
 *   - Their normals are nearly anti-parallel (dot product < -0.5)
 *   - They have similar areas (ratio > 0.3)
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} [tolerance=0.5] - Max centroid distance to consider overlap
 * @returns {Array} Cleaned triangle soup
 */
export function removeOverlappingTriangles(tris, tolerance) {
	if (typeof tolerance === "undefined") tolerance = 0.5;

	var centroids = [];
	var normals = [];
	var areas = [];

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		centroids.push({
			x: (tri.v0.x + tri.v1.x + tri.v2.x) / 3,
			y: (tri.v0.y + tri.v1.y + tri.v2.y) / 3,
			z: (tri.v0.z + tri.v1.z + tri.v2.z) / 3
		});
		var ux = tri.v1.x - tri.v0.x, uy = tri.v1.y - tri.v0.y, uz = tri.v1.z - tri.v0.z;
		var vx = tri.v2.x - tri.v0.x, vy = tri.v2.y - tri.v0.y, vz = tri.v2.z - tri.v0.z;
		var nx = uy * vz - uz * vy;
		var ny = uz * vx - ux * vz;
		var nz = ux * vy - uy * vx;
		var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (nLen > 0) { nx /= nLen; ny /= nLen; nz /= nLen; }
		normals.push({ x: nx, y: ny, z: nz });
		areas.push(0.5 * nLen);
	}

	var cellSize = Math.max(tolerance * 2, 0.1);
	var grid = {};

	function gKey(c) {
		return Math.floor(c.x / cellSize) + "," + Math.floor(c.y / cellSize) + "," + Math.floor(c.z / cellSize);
	}

	for (var gi = 0; gi < tris.length; gi++) {
		var gk = gKey(centroids[gi]);
		if (!grid[gk]) grid[gk] = [];
		grid[gk].push(gi);
	}

	var removeSet = {};
	var overlapCount = 0;
	var dupCount = 0;

	for (var si = 0; si < tris.length; si++) {
		if (removeSet[si]) continue;

		var sc = centroids[si];
		var gx = Math.floor(sc.x / cellSize);
		var gy = Math.floor(sc.y / cellSize);
		var gz = Math.floor(sc.z / cellSize);

		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				for (var dz = -1; dz <= 1; dz++) {
					var cell = grid[(gx + dx) + "," + (gy + dy) + "," + (gz + dz)];
					if (!cell) continue;

					for (var ci = 0; ci < cell.length; ci++) {
						var ti = cell[ci];
						if (ti <= si || removeSet[ti]) continue;

						var cdist = dist3(sc, centroids[ti]);
						if (cdist > tolerance) continue;

						var areaRatio = Math.min(areas[si], areas[ti]) / Math.max(areas[si], areas[ti]);
						if (areaRatio < 0.3) continue;

						var dot = normals[si].x * normals[ti].x +
							normals[si].y * normals[ti].y +
							normals[si].z * normals[ti].z;

						if (dot < -0.5) {
							if (areas[si] <= areas[ti]) {
								removeSet[si] = true;
							} else {
								removeSet[ti] = true;
							}
							overlapCount++;
						} else if (dot > 0.5) {
							if (areas[si] <= areas[ti]) {
								removeSet[si] = true;
							} else {
								removeSet[ti] = true;
							}
							dupCount++;
						}
					}
				}
			}
		}
	}

	var removedCount = Object.keys(removeSet).length;
	if (removedCount === 0) {
		console.log("MeshRepairHelper: removeOverlappingTriangles — no overlaps found (tol=" + tolerance.toFixed(3) + ")");
		return tris;
	}

	var result = [];
	for (var ri = 0; ri < tris.length; ri++) {
		if (!removeSet[ri]) result.push(tris[ri]);
	}

	console.log("MeshRepairHelper: removeOverlappingTriangles — " +
		"removed " + removedCount + " (" + overlapCount + " anti-parallel, " +
		dupCount + " near-dup), " + result.length + " remain (was " + tris.length + ", tol=" + tolerance.toFixed(3) + ")");

	return result;
}

// ────────────────────────────────────────────────────────
// Stitch by proximity — connect nearby boundary edges
// ────────────────────────────────────────────────────────

/**
 * Stitch open boundary edges that are close in 3D space.
 * Finds individual boundary edge endpoints within `stitchTolerance` and
 * connects them with quads (2 triangles each).
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} [stitchTolerance=1.0] - Max 3D distance to connect boundary edges
 * @returns {Array} Additional triangles from stitching
 */
export function stitchByProximity(tris, stitchTolerance) {
	if (typeof stitchTolerance === "undefined") stitchTolerance = 1.0;

	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}
	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	var edgeMap = {};
	var halfEdges = {};

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		var keys = [vKey(verts[0]), vKey(verts[1]), vKey(verts[2])];

		for (var e = 0; e < 3; e++) {
			var ne = (e + 1) % 3;
			var ek = edgeKey(keys[e], keys[ne]);
			if (!edgeMap[ek]) {
				edgeMap[ek] = { count: 0, v0: verts[e], v1: verts[ne], k0: keys[e], k1: keys[ne] };
			}
			edgeMap[ek].count++;
			halfEdges[keys[e] + "|" + keys[ne]] = true;
		}
	}

	var boundaryEdges = [];
	for (var ek2 in edgeMap) {
		if (edgeMap[ek2].count === 1) {
			var be = edgeMap[ek2];
			if (halfEdges[be.k0 + "|" + be.k1]) {
				boundaryEdges.push({ v0: be.v1, v1: be.v0, k0: be.k1, k1: be.k0 });
			} else {
				boundaryEdges.push({ v0: be.v0, v1: be.v1, k0: be.k0, k1: be.k1 });
			}
		}
	}

	if (boundaryEdges.length === 0) {
		console.log("MeshRepairHelper: stitchByProximity — no boundary edges");
		return [];
	}

	console.log("MeshRepairHelper: stitchByProximity — " + boundaryEdges.length +
		" boundary edges, tolerance=" + stitchTolerance.toFixed(4) + "m");

	var cellSize = Math.max(stitchTolerance * 3, 0.1);
	var vertGrid = {};

	function gridKey(v) {
		var gx = Math.floor(v.x / cellSize);
		var gy = Math.floor(v.y / cellSize);
		var gz = Math.floor(v.z / cellSize);
		return gx + "," + gy + "," + gz;
	}

	for (var bi = 0; bi < boundaryEdges.length; bi++) {
		var bEdge = boundaryEdges[bi];
		for (var vi = 0; vi < 2; vi++) {
			var vert = vi === 0 ? bEdge.v0 : bEdge.v1;
			var gk = gridKey(vert);
			if (!vertGrid[gk]) vertGrid[gk] = [];
			vertGrid[gk].push({ edgeIdx: bi, vertIdx: vi, vertex: vert });
		}
	}

	var usedEdges = {};
	var extraTris = [];
	var stitchedCount = 0;

	for (var si = 0; si < boundaryEdges.length; si++) {
		if (usedEdges[si]) continue;
		var srcEdge = boundaryEdges[si];

		var bestMatch = -1;
		var bestTotalDist = Infinity;
		var bestFlip = false;

		var gx0 = Math.floor(srcEdge.v0.x / cellSize);
		var gy0 = Math.floor(srcEdge.v0.y / cellSize);
		var gz0 = Math.floor(srcEdge.v0.z / cellSize);

		var candidates = {};
		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				for (var dz = -1; dz <= 1; dz++) {
					var checkKey = (gx0 + dx) + "," + (gy0 + dy) + "," + (gz0 + dz);
					var cell = vertGrid[checkKey];
					if (!cell) continue;
					for (var ci = 0; ci < cell.length; ci++) {
						var cand = cell[ci];
						if (cand.edgeIdx === si || usedEdges[cand.edgeIdx]) continue;
						candidates[cand.edgeIdx] = true;
					}
				}
			}
		}

		for (var candIdx in candidates) {
			var candEdge = boundaryEdges[candIdx];

			var d00 = dist3(srcEdge.v0, candEdge.v0);
			var d11 = dist3(srcEdge.v1, candEdge.v1);
			var d01 = dist3(srcEdge.v0, candEdge.v1);
			var d10 = dist3(srcEdge.v1, candEdge.v0);

			var totalSame = d00 + d11;
			var totalFlip = d01 + d10;

			if (totalSame <= totalFlip) {
				if (d00 <= stitchTolerance && d11 <= stitchTolerance && totalSame < bestTotalDist) {
					bestMatch = parseInt(candIdx);
					bestTotalDist = totalSame;
					bestFlip = false;
				}
			} else {
				if (d01 <= stitchTolerance && d10 <= stitchTolerance && totalFlip < bestTotalDist) {
					bestMatch = parseInt(candIdx);
					bestTotalDist = totalFlip;
					bestFlip = true;
				}
			}
		}

		if (bestMatch >= 0) {
			var matchEdge = boundaryEdges[bestMatch];
			usedEdges[si] = true;
			usedEdges[bestMatch] = true;
			stitchedCount++;

			var mV0 = bestFlip ? matchEdge.v1 : matchEdge.v0;
			var mV1 = bestFlip ? matchEdge.v0 : matchEdge.v1;

			extraTris.push({ v0: srcEdge.v0, v1: srcEdge.v1, v2: mV0 });
			extraTris.push({ v0: srcEdge.v1, v1: mV1, v2: mV0 });
		}
	}

	console.log("MeshRepairHelper: stitchByProximity — stitched " + stitchedCount +
		" edge pairs → " + extraTris.length + " stitch quad triangles (no capping)");

	return extraTris;
}

// ────────────────────────────────────────────────────────
// Loop triangulation — Constrained Delaunay
// ────────────────────────────────────────────────────────

/**
 * Ray-casting point-in-polygon test on a 2D loop stored as flat coords.
 * @private
 */
function _pointInLoop2D(px, py, coords, n) {
	var inside = false;
	for (var i = 0, j = n - 1; i < n; j = i++) {
		var xi = coords[i * 2], yi = coords[i * 2 + 1];
		var xj = coords[j * 2], yj = coords[j * 2 + 1];
		if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Triangulate a 3D polygon loop using ear-clipping projected onto the
 * best-fit 2D plane (the plane with the largest projected area).
 *
 * @param {Array} loop - Array of {x, y, z} vertices in order
 * @returns {Array} Array of {v0, v1, v2} triangles
 */
export function triangulateLoop(loop) {
	if (loop.length < 3) return [];
	if (loop.length === 3) {
		return [{ v0: loop[0], v1: loop[1], v2: loop[2] }];
	}
	if (loop.length === 4) {
		var d02 = dist3(loop[0], loop[2]);
		var d13 = dist3(loop[1], loop[3]);
		if (d02 <= d13) {
			return [
				{ v0: loop[0], v1: loop[1], v2: loop[2] },
				{ v0: loop[0], v1: loop[2], v2: loop[3] }
			];
		} else {
			return [
				{ v0: loop[0], v1: loop[1], v2: loop[3] },
				{ v0: loop[1], v1: loop[2], v2: loop[3] }
			];
		}
	}

	// Compute loop normal via Newell's method
	var nx = 0, ny = 0, nz = 0;
	for (var i = 0; i < loop.length; i++) {
		var curr = loop[i];
		var next = loop[(i + 1) % loop.length];
		nx += (curr.y - next.y) * (curr.z + next.z);
		ny += (curr.z - next.z) * (curr.x + next.x);
		nz += (curr.x - next.x) * (curr.y + next.y);
	}

	// Pick the 2D projection plane using shoelace area on all 3 planes
	var areaXY = 0, areaXZ = 0, areaYZ = 0;
	for (var sa = 0; sa < loop.length; sa++) {
		var saCurr = loop[sa];
		var saNext = loop[(sa + 1) % loop.length];
		areaXY += (saCurr.x * saNext.y - saNext.x * saCurr.y);
		areaXZ += (saCurr.x * saNext.z - saNext.x * saCurr.z);
		areaYZ += (saCurr.y * saNext.z - saNext.y * saCurr.z);
	}
	areaXY = Math.abs(areaXY);
	areaXZ = Math.abs(areaXZ);
	areaYZ = Math.abs(areaYZ);

	var projU, projV;
	if (areaXY >= areaXZ && areaXY >= areaYZ) {
		projU = function (p) { return p.x; };
		projV = function (p) { return p.y; };
	} else if (areaXZ >= areaYZ) {
		projU = function (p) { return p.x; };
		projV = function (p) { return p.z; };
	} else {
		projU = function (p) { return p.y; };
		projV = function (p) { return p.z; };
	}

	var n = loop.length;
	var coords = new Float64Array(n * 2);
	for (var j = 0; j < n; j++) {
		coords[j * 2] = projU(loop[j]);
		coords[j * 2 + 1] = projV(loop[j]);
	}

	var del, con;
	try {
		del = new Delaunator(coords);
		con = new Constrainautor(del);

		for (var ci = 0; ci < n; ci++) {
			var ni = (ci + 1) % n;
			try {
				con.constrainOne(ci, ni);
			} catch (e) {
				// Skip problematic constraint edges
			}
		}
	} catch (e) {
		console.warn("MeshRepairHelper: triangulateLoop — Constrainautor failed, using Delaunator only:", e.message);
		try {
			del = new Delaunator(coords);
		} catch (e2) {
			console.warn("MeshRepairHelper: triangulateLoop — Delaunator also failed:", e2.message);
			return [];
		}
	}

	var result = [];
	var tris = del.triangles;
	for (var k = 0; k < tris.length; k += 3) {
		var a = tris[k], b = tris[k + 1], c = tris[k + 2];

		var cx2 = (coords[a * 2] + coords[b * 2] + coords[c * 2]) / 3;
		var cy2 = (coords[a * 2 + 1] + coords[b * 2 + 1] + coords[c * 2 + 1]) / 3;

		if (_pointInLoop2D(cx2, cy2, coords, n)) {
			result.push({
				v0: loop[a],
				v1: loop[b],
				v2: loop[c]
			});
		}
	}

	// Validate cap triangle winding against the Newell loop normal
	var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (nLen > 1e-12) {
		var nnx = nx / nLen, nny = ny / nLen, nnz = nz / nLen;
		for (var wi = 0; wi < result.length; wi++) {
			var wt = result[wi];
			var ux = wt.v1.x - wt.v0.x, uy = wt.v1.y - wt.v0.y, uz = wt.v1.z - wt.v0.z;
			var vx = wt.v2.x - wt.v0.x, vy = wt.v2.y - wt.v0.y, vz = wt.v2.z - wt.v0.z;
			var tnx = uy * vz - uz * vy;
			var tny = uz * vx - ux * vz;
			var tnz = ux * vy - uy * vx;
			var dot = tnx * nnx + tny * nny + tnz * nnz;
			if (dot < 0) {
				var tmp = wt.v1;
				wt.v1 = wt.v2;
				wt.v2 = tmp;
			}
		}
	}

	return result;
}

// ────────────────────────────────────────────────────────
// Boundary diagnostics
// ────────────────────────────────────────────────────────

/**
 * Log boundary / closure diagnostics to console.
 *
 * @param {Array} tris - Triangle soup [{v0,v1,v2}, ...]
 * @param {string} closeMode - The closing mode used
 */
export function logBoundaryStats(tris, closeMode) {
	var result = extractBoundaryLoops(tris);
	var isClosed = result.boundaryEdgeCount === 0 && result.overSharedEdgeCount === 0;

	console.log("MeshRepairHelper: ── Post-close diagnostics ──");
	console.log("MeshRepairHelper:   closeMode = " + closeMode);
	console.log("MeshRepairHelper:   triangles = " + tris.length);
	console.log("MeshRepairHelper:   boundary edges = " + result.boundaryEdgeCount);
	console.log("MeshRepairHelper:   over-shared edges = " + result.overSharedEdgeCount);
	console.log("MeshRepairHelper:   loops = " + result.loops.length +
		(result.loops.length > 0 ? " (sizes: " + result.loops.map(function (l) { return l.length; }).join(", ") + ")" : ""));
	console.log("MeshRepairHelper:   closed = " + isClosed);
}

// ────────────────────────────────────────────────────────
// Boundary capping — close open surfaces
// ────────────────────────────────────────────────────────

/**
 * Find boundary edges, chain into loops, triangulate each loop to cap.
 * Returns array of cap triangles {v0, v1, v2}.
 */
export function capBoundaryLoops(tris) {
	var result = extractBoundaryLoops(tris);

	if (result.loops.length === 0) return [];

	console.log("MeshRepairHelper: " + result.boundaryEdgeCount + " boundary edges, " +
		result.loops.length + " loop(s), sizes: " +
		result.loops.map(function (l) { return l.length; }).join(", "));

	var capTris = [];
	for (var li = 0; li < result.loops.length; li++) {
		var loopTris = triangulateLoop(result.loops[li]);
		for (var lt = 0; lt < loopTris.length; lt++) {
			capTris.push(loopTris[lt]);
		}
	}

	return capTris;
}

/**
 * Sequential boundary capping: cap one loop at a time, re-weld + clean
 * non-manifold after each loop.
 *
 * @param {Array} soup - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} snapTol - Weld tolerance
 * @param {number} maxPasses - Max number of cap passes (default 3)
 * @returns {Array} Updated triangle soup with cap triangles integrated
 */
export function capBoundaryLoopsSequential(soup, snapTol, maxPasses) {
	if (!maxPasses) maxPasses = 3;
	var MAX_CAP_LOOP_VERTS = 500;

	for (var capPass = 0; capPass < maxPasses; capPass++) {
		var preStats = countOpenEdges(soup);
		if (preStats.overShared > 0) {
			console.log("MeshRepairHelper: capSequential pass " + (capPass + 1) +
				" — cleaning " + preStats.overShared + " non-manifold edges before cap");
			soup = cleanCrossingTriangles(soup);
			var cleaned = weldVertices(soup, snapTol);
			soup = weldedToSoup(cleaned.triangles);
		}

		var loopResult = extractBoundaryLoops(soup);
		if (loopResult.loops.length === 0) {
			console.log("MeshRepairHelper: capSequential — no boundary loops at pass " + (capPass + 1) + ", mesh is closed");
			break;
		}

		console.log("MeshRepairHelper: capSequential pass " + (capPass + 1) + " — " +
			loopResult.loops.length + " loop(s), sizes: " +
			loopResult.loops.map(function (l) { return l.length; }).join(", "));

		var totalCapTris = 0;

		for (var li = 0; li < loopResult.loops.length; li++) {
			var loop = loopResult.loops[li];
			if (loop.length < 3) continue;
			if (loop.length > MAX_CAP_LOOP_VERTS) {
				console.warn("MeshRepairHelper: capSequential — skipped loop[" + li +
					"]: " + loop.length + " verts exceeds limit (" + MAX_CAP_LOOP_VERTS + ")");
				continue;
			}

			var capTris = triangulateLoop(loop);
			if (capTris.length === 0) continue;

			for (var ct = 0; ct < capTris.length; ct++) {
				soup.push(capTris[ct]);
			}
			totalCapTris += capTris.length;

			console.log("MeshRepairHelper: capSequential — capped loop[" + li +
				"]: " + loop.length + " verts → " + capTris.length + " cap tris");

			var reWelded = weldVertices(soup, snapTol);
			soup = weldedToSoup(reWelded.triangles);

			var postStats = countOpenEdges(soup);
			if (postStats.overShared > 0) {
				soup = cleanCrossingTriangles(soup);
				var reCleaned = weldVertices(soup, snapTol);
				soup = weldedToSoup(reCleaned.triangles);
			}
		}

		if (totalCapTris === 0) {
			console.log("MeshRepairHelper: capSequential — no cappable loops at pass " + (capPass + 1));
			break;
		}

		console.log("MeshRepairHelper: capSequential pass " + (capPass + 1) +
			" — added " + totalCapTris + " cap tris total");
	}

	return soup;
}

// ────────────────────────────────────────────────────────
// Force-close indexed mesh — works on integer point indices
// ────────────────────────────────────────────────────────

/**
 * Operates on the INDEXED mesh (after weld). Uses integer point indices
 * to find boundary edges and close them — zero floating-point precision issues.
 *
 * @param {Array} points - [{x,y,z}, ...]
 * @param {Array} triangles - [{vertices: [{x,y,z},{x,y,z},{x,y,z}]}, ...]
 * @returns {Object} - { points, triangles } — updated indexed mesh
 */
export function forceCloseIndexedMesh(points, triangles) {
	var ptIndex = {};
	for (var pi = 0; pi < points.length; pi++) {
		var pk = points[pi].x + "," + points[pi].y + "," + points[pi].z;
		ptIndex[pk] = pi;
	}

	var idxTris = [];
	for (var ti = 0; ti < triangles.length; ti++) {
		var v = triangles[ti].vertices;
		var i0 = ptIndex[v[0].x + "," + v[0].y + "," + v[0].z];
		var i1 = ptIndex[v[1].x + "," + v[1].y + "," + v[1].z];
		var i2 = ptIndex[v[2].x + "," + v[2].y + "," + v[2].z];
		if (i0 !== undefined && i1 !== undefined && i2 !== undefined) {
			idxTris.push([i0, i1, i2]);
		}
	}

	var cellSize = 2.0;
	var grid = {};
	for (var gi = 0; gi < points.length; gi++) {
		var gp = points[gi];
		var gk = Math.floor(gp.x / cellSize) + "," + Math.floor(gp.y / cellSize) + "," + Math.floor(gp.z / cellSize);
		if (!grid[gk]) grid[gk] = [];
		grid[gk].push(gi);
	}

	var totalAdded = 0;
	var maxPasses = 30;

	for (var pass = 0; pass < maxPasses; pass++) {
		var edgeMap = {};
		for (var ei = 0; ei < idxTris.length; ei++) {
			var t = idxTris[ei];
			for (var e = 0; e < 3; e++) {
				var a = t[e], b = t[(e + 1) % 3];
				var ek = a < b ? a + "|" + b : b + "|" + a;
				edgeMap[ek] = (edgeMap[ek] || 0) + 1;
			}
		}

		var boundaryEdges = [];
		for (var bek in edgeMap) {
			if (edgeMap[bek] === 1) {
				var parts = bek.split("|");
				boundaryEdges.push([parseInt(parts[0]), parseInt(parts[1])]);
			}
		}

		if (boundaryEdges.length === 0) {
			console.log("MeshRepairHelper: forceCloseIndexedMesh — CLOSED after " +
				pass + " passes, " + totalAdded + " triangles added");
			break;
		}

		var newTris = [];
		var usedEdges = {};

		for (var bi = 0; bi < boundaryEdges.length; bi++) {
			var be = boundaryEdges[bi];
			var beKey = be[0] < be[1] ? be[0] + "|" + be[1] : be[1] + "|" + be[0];
			if (usedEdges[beKey]) continue;

			var p0 = points[be[0]];
			var p1 = points[be[1]];
			var mid = {
				x: (p0.x + p1.x) / 2,
				y: (p0.y + p1.y) / 2,
				z: (p0.z + p1.z) / 2
			};

			var mgx = Math.floor(mid.x / cellSize);
			var mgy = Math.floor(mid.y / cellSize);
			var mgz = Math.floor(mid.z / cellSize);

			var bestIdx = -1;
			var bestDist = Infinity;

			for (var dx = -1; dx <= 1; dx++) {
				for (var dy = -1; dy <= 1; dy++) {
					for (var dz = -1; dz <= 1; dz++) {
						var cell = grid[(mgx + dx) + "," + (mgy + dy) + "," + (mgz + dz)];
						if (!cell) continue;
						for (var ci = 0; ci < cell.length; ci++) {
							var cIdx = cell[ci];
							if (cIdx === be[0] || cIdx === be[1]) continue;

							var cp = points[cIdx];
							var ddx = mid.x - cp.x, ddy = mid.y - cp.y, ddz = mid.z - cp.z;
							var d2 = ddx * ddx + ddy * ddy + ddz * ddz;
							if (d2 >= bestDist) continue;

							var ek0 = be[0] < cIdx ? be[0] + "|" + cIdx : cIdx + "|" + be[0];
							var ek1 = be[1] < cIdx ? be[1] + "|" + cIdx : cIdx + "|" + be[1];
							if ((edgeMap[ek0] || 0) >= 2) continue;
							if ((edgeMap[ek1] || 0) >= 2) continue;

							var abx = p1.x - p0.x, aby = p1.y - p0.y, abz = p1.z - p0.z;
							var acx = cp.x - p0.x, acy = cp.y - p0.y, acz = cp.z - p0.z;
							var cx2 = aby * acz - abz * acy;
							var cy2 = abz * acx - abx * acz;
							var cz2 = abx * acy - aby * acx;
							var area = cx2 * cx2 + cy2 * cy2 + cz2 * cz2;
							if (area < 1e-12) continue;

							bestIdx = cIdx;
							bestDist = d2;
						}
					}
				}
			}

			if (bestIdx >= 0) {
				idxTris.push([be[0], be[1], bestIdx]);
				newTris.push([be[0], be[1], bestIdx]);
				usedEdges[beKey] = true;

				var nek0 = be[0] < bestIdx ? be[0] + "|" + bestIdx : bestIdx + "|" + be[0];
				var nek1 = be[1] < bestIdx ? be[1] + "|" + bestIdx : bestIdx + "|" + be[1];
				edgeMap[nek0] = (edgeMap[nek0] || 0) + 1;
				edgeMap[nek1] = (edgeMap[nek1] || 0) + 1;
				edgeMap[beKey] = 2;
			}
		}

		if (newTris.length === 0) {
			console.log("MeshRepairHelper: forceCloseIndexedMesh — no more closeable gaps after " +
				pass + " passes, " + totalAdded + " added, " + boundaryEdges.length + " boundary edges remain");
			break;
		}

		totalAdded += newTris.length;
		console.log("MeshRepairHelper: forceCloseIndexedMesh pass " + pass +
			" — added " + newTris.length + " tris (" + boundaryEdges.length + " boundary edges)");
	}

	var outTris = [];
	for (var oi = 0; oi < idxTris.length; oi++) {
		var t2 = idxTris[oi];
		outTris.push({
			vertices: [
				{ x: points[t2[0]].x, y: points[t2[0]].y, z: points[t2[0]].z },
				{ x: points[t2[1]].x, y: points[t2[1]].y, z: points[t2[1]].z },
				{ x: points[t2[2]].x, y: points[t2[2]].y, z: points[t2[2]].z }
			]
		});
	}

	return { points: points, triangles: outTris };
}

// ────────────────────────────────────────────────────────
// Boundary vertex weld — close seam gaps by snapping open-edge vertices
// ────────────────────────────────────────────────────────

/**
 * Weld boundary vertices (open-edge endpoints) to nearby boundary vertices
 * using a higher tolerance than the general weld.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} tolerance - Max 3D distance to snap boundary vertices
 * @returns {Array} Triangle soup with boundary vertices merged
 */
export function weldBoundaryVertices(tris, tolerance) {
	if (tolerance <= 0) return tris;

	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}
	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	var edgeMap = {};
	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		var keys = [vKey(verts[0]), vKey(verts[1]), vKey(verts[2])];
		for (var e = 0; e < 3; e++) {
			var ne = (e + 1) % 3;
			var ek = edgeKey(keys[e], keys[ne]);
			if (!edgeMap[ek]) edgeMap[ek] = { count: 0, k0: keys[e], k1: keys[ne], v0: verts[e], v1: verts[ne] };
			edgeMap[ek].count++;
		}
	}

	var boundaryVerts = {};
	for (var ek2 in edgeMap) {
		if (edgeMap[ek2].count === 1) {
			boundaryVerts[edgeMap[ek2].k0] = edgeMap[ek2].v0;
			boundaryVerts[edgeMap[ek2].k1] = edgeMap[ek2].v1;
		}
	}

	var bvKeys = Object.keys(boundaryVerts);
	if (bvKeys.length === 0) return tris;

	var cellSize = Math.max(tolerance * 2, 0.01);
	var grid = {};
	var tolSq = tolerance * tolerance;

	for (var bi = 0; bi < bvKeys.length; bi++) {
		var bv = boundaryVerts[bvKeys[bi]];
		var gk = Math.floor(bv.x / cellSize) + "," + Math.floor(bv.y / cellSize) + "," + Math.floor(bv.z / cellSize);
		if (!grid[gk]) grid[gk] = [];
		grid[gk].push(bvKeys[bi]);
	}

	var parent = {};
	for (var pi = 0; pi < bvKeys.length; pi++) {
		parent[bvKeys[pi]] = bvKeys[pi];
	}

	function find(k) {
		while (parent[k] !== k) {
			parent[k] = parent[parent[k]];
			k = parent[k];
		}
		return k;
	}

	function union(a, b) {
		var ra = find(a), rb = find(b);
		if (ra !== rb) parent[ra] = rb;
	}

	for (var si = 0; si < bvKeys.length; si++) {
		var sv = boundaryVerts[bvKeys[si]];
		var sgx = Math.floor(sv.x / cellSize);
		var sgy = Math.floor(sv.y / cellSize);
		var sgz = Math.floor(sv.z / cellSize);

		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				for (var dz = -1; dz <= 1; dz++) {
					var cell = grid[(sgx + dx) + "," + (sgy + dy) + "," + (sgz + dz)];
					if (!cell) continue;
					for (var ci = 0; ci < cell.length; ci++) {
						if (cell[ci] === bvKeys[si]) continue;
						var cv = boundaryVerts[cell[ci]];
						var ddx = sv.x - cv.x, ddy = sv.y - cv.y, ddz = sv.z - cv.z;
						if (ddx * ddx + ddy * ddy + ddz * ddz <= tolSq) {
							union(bvKeys[si], cell[ci]);
						}
					}
				}
			}
		}
	}

	var clusters = {};
	for (var ki = 0; ki < bvKeys.length; ki++) {
		var root = find(bvKeys[ki]);
		var v = boundaryVerts[bvKeys[ki]];
		if (!clusters[root]) {
			clusters[root] = { sumX: 0, sumY: 0, sumZ: 0, count: 0 };
		}
		clusters[root].sumX += v.x;
		clusters[root].sumY += v.y;
		clusters[root].sumZ += v.z;
		clusters[root].count++;
	}

	var mergeMap = {};
	var mergedCount = 0;
	for (var mi = 0; mi < bvKeys.length; mi++) {
		var root2 = find(bvKeys[mi]);
		var cl = clusters[root2];
		if (cl.count > 1) {
			mergeMap[bvKeys[mi]] = {
				x: cl.sumX / cl.count,
				y: cl.sumY / cl.count,
				z: cl.sumZ / cl.count
			};
			mergedCount++;
		}
	}

	if (mergedCount === 0) {
		console.log("MeshRepairHelper: weldBoundaryVertices — no boundary vertices within tolerance (" +
			tolerance.toFixed(3) + "m), " + bvKeys.length + " boundary verts checked");
		return tris;
	}

	function remap(v) {
		var k = vKey(v);
		if (mergeMap[k]) return mergeMap[k];
		return v;
	}

	var result = [];
	var collapsed = 0;
	for (var ri = 0; ri < tris.length; ri++) {
		var rv0 = remap(tris[ri].v0);
		var rv1 = remap(tris[ri].v1);
		var rv2 = remap(tris[ri].v2);

		var k0 = vKey(rv0), k1 = vKey(rv1), k2 = vKey(rv2);
		if (k0 === k1 || k1 === k2 || k0 === k2) {
			collapsed++;
			continue;
		}

		result.push({ v0: rv0, v1: rv1, v2: rv2 });
	}

	console.log("MeshRepairHelper: weldBoundaryVertices — merged " + mergedCount +
		" boundary verts into " + Object.keys(clusters).filter(function (k) { return clusters[k].count > 1; }).length +
		" clusters (tol=" + tolerance.toFixed(3) + "m), " + collapsed + " collapsed tris, " +
		result.length + " remain (was " + tris.length + ")");

	return result;
}

// ────────────────────────────────────────────────────────
// High-level repair pipeline
// ────────────────────────────────────────────────────────

/**
 * High-level mesh repair entry point. Runs a configurable pipeline
 * of dedup → weld → degenerate removal → stitch → cap → force-close.
 *
 * Each major step yields to the event loop via setTimeout(0) so the
 * caller's progress dialog can update.
 *
 * @param {Array} soup - Triangle soup [{v0, v1, v2}, ...]
 * @param {Object} config
 * @param {string}  [config.closeMode="none"] - "none" | "weld" | "stitch"
 * @param {number}  [config.snapTolerance=0] - Weld tolerance in metres
 * @param {number}  [config.stitchTolerance=1.0] - Stitch tolerance
 * @param {boolean} [config.removeDegenerate=true] - Remove degenerate/sliver tris
 * @param {Function} [onProgress] - Called with progress string, e.g. onProgress("Welding...")
 * @returns {Promise<Object>} { points, triangles, soup }
 */
export async function repairMesh(soup, config, onProgress) {
	if (!config) config = {};
	var closeMode = config.closeMode || "none";
	var snapTol = config.snapTolerance || 0;
	var stitchTol = config.stitchTolerance || 1.0;
	var removeDegenerate = config.removeDegenerate !== false;

	function progress(msg) {
		console.log("MeshRepairHelper: " + msg);
		if (typeof onProgress === "function") onProgress(msg);
	}

	// Yield to event loop so UI can update
	function yieldUI() {
		return new Promise(function (r) { setTimeout(r, 0); });
	}

	// Step 1: Deduplicate seam vertices
	progress("Deduplicating vertices...");
	await yieldUI();
	soup = deduplicateSeamVertices(soup, 1e-4);

	// Step 2: Weld vertices
	progress("Welding vertices...");
	await yieldUI();
	var welded = weldVertices(soup, snapTol);
	console.log("MeshRepairHelper: welded " + soup.length * 3 + " vertices → " +
		welded.points.length + " unique points (tol=" + snapTol + "m)");
	soup = weldedToSoup(welded.triangles);

	// Step 3: Remove degenerates
	if (removeDegenerate) {
		progress("Removing degenerate triangles...");
		await yieldUI();
		soup = removeDegenerateTriangles(soup, 1e-6, 0.01);
	}

	// Step 4: Stitch + cap (if closeMode === "stitch")
	if (closeMode === "stitch") {
		progress("Stitching boundaries...");
		await yieldUI();
		var stitchTris = stitchByProximity(soup, stitchTol);
		if (stitchTris.length > 0) {
			for (var st = 0; st < stitchTris.length; st++) {
				soup.push(stitchTris[st]);
			}
			console.log("MeshRepairHelper: stitchByProximity added " + stitchTris.length + " triangles");
		}

		// Final weld after stitch
		var finalWelded = weldVertices(soup, snapTol);
		var worldPoints = finalWelded.points;
		var triangles = finalWelded.triangles;

		// Sequential capping
		progress("Capping boundary loops...");
		await yieldUI();
		var postSoup = weldedToSoup(triangles);
		postSoup = capBoundaryLoopsSequential(postSoup, snapTol, 3);

		var cappedWeld = weldVertices(postSoup, snapTol);
		worldPoints = cappedWeld.points;
		triangles = cappedWeld.triangles;

		// Post-cap cleanup
		progress("Cleaning up post-cap mesh...");
		await yieldUI();
		var postCapSoup = weldedToSoup(triangles);
		var postCapChanged = false;

		var postCapStats = countOpenEdges(postCapSoup);
		if (postCapStats.overShared > 0) {
			postCapSoup = cleanCrossingTriangles(postCapSoup);
			postCapChanged = true;
		}

		if (removeDegenerate) {
			var preDegenCount = postCapSoup.length;
			postCapSoup = removeDegenerateTriangles(postCapSoup, 1e-6, 0.01);
			if (postCapSoup.length < preDegenCount) postCapChanged = true;
		}

		if (postCapChanged) {
			var postCapWeld = weldVertices(postCapSoup, snapTol);
			worldPoints = postCapWeld.points;
			triangles = postCapWeld.triangles;
		}

		// Safety net — forceCloseIndexedMesh
		progress("Force-closing gaps...");
		await yieldUI();
		var safetyCheckSoup = weldedToSoup(triangles);
		var safetyStats = countOpenEdges(safetyCheckSoup);
		if (safetyStats.openEdges > 0) {
			console.log("MeshRepairHelper: safety net — " + safetyStats.openEdges +
				" open edges remain, running forceCloseIndexedMesh");
			var forceClosed = forceCloseIndexedMesh(worldPoints, triangles);
			worldPoints = forceClosed.points;
			triangles = forceClosed.triangles;
		}

		// Final diagnostics
		var finalSoup = weldedToSoup(triangles);
		logBoundaryStats(finalSoup, closeMode);
		soup = finalSoup;

		progress("Repair complete.");
		return { points: worldPoints, triangles: triangles, soup: soup };
	}

	// For non-stitch modes, just do a final weld and return
	var finalWeld = weldVertices(soup, snapTol);
	logBoundaryStats(soup, closeMode);

	progress("Repair complete.");
	return { points: finalWeld.points, triangles: finalWeld.triangles, soup: soup };
}
