/**
 * SurfaceBooleanHelper.js
 *
 * Interactive split-and-pick surface boolean (Vulcan TRIBOOL style).
 * Uses Moller tri-tri intersection to find intersection segments, chains
 * them into polylines, then classifies triangles as inside/outside using
 * geometric point-in-polygon / signed-side tests. Straddling triangles
 * (those crossed by intersection segments) are split at the intersection
 * edges, then each sub-triangle is classified by its centroid.
 */

import * as THREE from "three";
import Delaunator from "delaunator";
import Constrainautor from "@kninnug/constrainautor";
import { MeshLine, MeshLineMaterial } from "./meshLineModified.js";
import { AddSurfaceAction } from "../tools/UndoActions.js";
import { getOrCreateSurfaceLayer } from "./LayerHelper.js";
import {
	extractTriangles as ixExtractTriangles,
	intersectSurfacePairTagged,
	countOpenEdges,
	chainSegments,
	dist3D as ixDist3D,
	ensureZUpNormals
} from "./SurfaceIntersectionHelper.js";

// ────────────────────────────────────────────────────────
// Vertex/edge key helpers
// ────────────────────────────────────────────────────────

var CUT_KEY_PREC = 6;

function cutVKey(v) {
	return v.x.toFixed(CUT_KEY_PREC) + "," + v.y.toFixed(CUT_KEY_PREC) + "," + v.z.toFixed(CUT_KEY_PREC);
}

function cutEdgeKey(va, vb) {
	var ka = cutVKey(va);
	var kb = cutVKey(vb);
	return ka < kb ? ka + "|" + kb : kb + "|" + ka;
}

// ────────────────────────────────────────────────────────
// Polyline classification utilities
// ────────────────────────────────────────────────────────

/**
 * Check whether a polyline is closed (first ≈ last point).
 * @param {Array} polyline - Array of {x,y,z}
 * @param {number} threshold - Distance threshold
 * @returns {boolean}
 */
function isPolylineClosed(polyline, threshold) {
	if (polyline.length < 3) return false;
	var a = polyline[0];
	var b = polyline[polyline.length - 1];
	var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz) <= threshold;
}

/**
 * Ray-casting point-in-polygon test on XY projection of a closed 3D loop.
 * @param {number} px - Test point X
 * @param {number} py - Test point Y
 * @param {Array} loop - Array of {x,y,z} forming a closed polygon
 * @returns {boolean} true if (px,py) is inside the loop
 */
function classifyPointClosedLoop(px, py, loop) {
	var inside = false;
	var n = loop.length;
	for (var i = 0, j = n - 1; i < n; j = i++) {
		var xi = loop[i].x, yi = loop[i].y;
		var xj = loop[j].x, yj = loop[j].y;
		if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Classify a point relative to an open polyline using the signed cross product
 * of the closest segment. Positive = left side, negative = right side.
 *
 * @param {number} px - Test point X
 * @param {number} py - Test point Y
 * @param {Array} polyline - Array of {x,y,z}
 * @returns {number} Sign: +1 or -1
 */
function classifyPointOpenPolyline(px, py, polyline) {
	var bestDistSq = Infinity;
	var bestCross = 0;

	for (var i = 0; i < polyline.length - 1; i++) {
		var ax = polyline[i].x, ay = polyline[i].y;
		var bx = polyline[i + 1].x, by = polyline[i + 1].y;

		// Project point onto segment to find closest point
		var abx = bx - ax, aby = by - ay;
		var apx = px - ax, apy = py - ay;
		var abLenSq = abx * abx + aby * aby;

		if (abLenSq < 1e-20) continue; // degenerate segment

		var t = (apx * abx + apy * aby) / abLenSq;
		if (t < 0) t = 0;
		if (t > 1) t = 1;

		var closestX = ax + t * abx;
		var closestY = ay + t * aby;
		var dx = px - closestX, dy = py - closestY;
		var dSq = dx * dx + dy * dy;

		if (dSq < bestDistSq) {
			bestDistSq = dSq;
			// 2D cross product of segment direction × vector to point
			bestCross = abx * apy - aby * apx;
		}
	}

	return bestCross >= 0 ? 1 : -1;
}

/**
 * Classify a single centroid as "inside" (1) or "outside" (-1) relative
 * to the intersection polylines.
 *
 * Closed polylines use ray-casting PIP on XY projection.
 * Open polylines use signed cross product of the closest segment.
 *
 * @param {{x,y,z}} centroid
 * @param {Array} closedPolylines - Array of closed polyline arrays
 * @param {Array} openPolylines - Array of open polyline arrays
 * @returns {number} 1 = inside, -1 = outside
 */
function classifyCentroid(centroid, closedPolylines, openPolylines) {
	// Check closed polylines first — inside any closed loop → "inside"
	for (var c = 0; c < closedPolylines.length; c++) {
		if (classifyPointClosedLoop(centroid.x, centroid.y, closedPolylines[c])) {
			return 1; // inside
		}
	}

	// Check open polylines — closest segment determines side
	if (openPolylines.length > 0) {
		// Use the closest open polyline to determine classification
		var bestDistSq = Infinity;
		var bestSign = -1;

		for (var o = 0; o < openPolylines.length; o++) {
			var poly = openPolylines[o];
			for (var i = 0; i < poly.length - 1; i++) {
				var ax = poly[i].x, ay = poly[i].y;
				var bx = poly[i + 1].x, by = poly[i + 1].y;
				var abx = bx - ax, aby = by - ay;
				var apx = centroid.x - ax, apy = centroid.y - ay;
				var abLenSq = abx * abx + aby * aby;

				if (abLenSq < 1e-20) continue;

				var t = (apx * abx + apy * aby) / abLenSq;
				if (t < 0) t = 0;
				if (t > 1) t = 1;

				var closestX = ax + t * abx;
				var closestY = ay + t * aby;
				var dx = centroid.x - closestX, dy = centroid.y - closestY;
				var dSq = dx * dx + dy * dy;

				if (dSq < bestDistSq) {
					bestDistSq = dSq;
					bestSign = (abx * apy - aby * apx) >= 0 ? 1 : -1;
				}
			}
		}

		return bestSign;
	}

	return -1; // default: outside
}

/**
 * Classify all triangles' centroids against intersection polylines.
 *
 * @param {Array} tris - Triangle soup [{v0,v1,v2}, ...]
 * @param {Array} closedPolylines
 * @param {Array} openPolylines
 * @returns {Int8Array} Classification per triangle: 1=inside, -1=outside
 */
function classifyAllTriangles(tris, closedPolylines, openPolylines) {
	var result = new Int8Array(tris.length);
	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var cx = (tri.v0.x + tri.v1.x + tri.v2.x) / 3;
		var cy = (tri.v0.y + tri.v1.y + tri.v2.y) / 3;
		var cz = (tri.v0.z + tri.v1.z + tri.v2.z) / 3;
		result[i] = classifyCentroid({ x: cx, y: cy, z: cz }, closedPolylines, openPolylines);
	}
	return result;
}

/**
 * Separate triangles into inside/outside groups.
 * Non-crossed triangles go directly by classification.
 * Crossed (straddling) triangles are split first, then each sub-triangle classified.
 *
 * @param {Array} tris - Triangle soup
 * @param {Int8Array} classifications - Per-triangle classification
 * @param {Object} crossedMap - Map of triIndex -> [taggedSegments]
 * @param {Array} closedPolylines
 * @param {Array} openPolylines
 * @returns {{ inside: Array, outside: Array }}
 */
function splitStraddlingAndClassify(tris, classifications, crossedMap, closedPolylines, openPolylines) {
	var inside = [];
	var outside = [];

	for (var i = 0; i < tris.length; i++) {
		if (!crossedMap[i]) {
			// Non-crossed: use pre-computed classification
			if (classifications[i] === 1) {
				inside.push(tris[i]);
			} else {
				outside.push(tris[i]);
			}
			continue;
		}

		// Crossed triangle: split by each intersection segment
		var segments = crossedMap[i];
		var current = [tris[i]];

		for (var s = 0; s < segments.length; s++) {
			var seg = segments[s];
			var next = [];
			for (var t = 0; t < current.length; t++) {
				var subResult = splitOneTriangleBySegment(current[t], seg.p0, seg.p1, null);
				for (var r = 0; r < subResult.length; r++) {
					next.push(subResult[r]);
				}
			}
			current = next;
		}

		// Classify each sub-triangle by its centroid
		for (var j = 0; j < current.length; j++) {
			var sub = current[j];
			var cx = (sub.v0.x + sub.v1.x + sub.v2.x) / 3;
			var cy = (sub.v0.y + sub.v1.y + sub.v2.y) / 3;
			var cz = (sub.v0.z + sub.v1.z + sub.v2.z) / 3;
			var cls = classifyCentroid({ x: cx, y: cy, z: cz }, closedPolylines, openPolylines);
			if (cls === 1) {
				inside.push(sub);
			} else {
				outside.push(sub);
			}
		}
	}

	return { inside: inside, outside: outside };
}

/**
 * Propagate consistent winding order across a triangle mesh via BFS.
 * If the mesh is manifold (every edge shared by exactly 2 triangles),
 * BFS from a seed triangle and enforce consistent winding by checking
 * shared-edge direction. If not manifold, falls back to ensureZUpNormals.
 *
 * @param {Array} tris - Triangle soup [{v0,v1,v2}, ...]
 * @returns {Array} Triangle soup with consistent normals
 */
function propagateNormals(tris) {
	if (tris.length === 0) return tris;

	// Build half-edge-to-triangle adjacency
	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	// For each triangle, compute its 3 directed half-edges
	var edgeToTris = {}; // "ka|kb" (sorted) -> [{triIdx, directedFrom, directedTo}]
	var triVKeys = []; // triIdx -> [k0, k1, k2]

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var k0 = vKey(tri.v0), k1 = vKey(tri.v1), k2 = vKey(tri.v2);
		triVKeys.push([k0, k1, k2]);
		var edges = [
			{ from: k0, to: k1 },
			{ from: k1, to: k2 },
			{ from: k2, to: k0 }
		];
		for (var e = 0; e < 3; e++) {
			var sortedKey = edges[e].from < edges[e].to
				? edges[e].from + "|" + edges[e].to
				: edges[e].to + "|" + edges[e].from;
			if (!edgeToTris[sortedKey]) edgeToTris[sortedKey] = [];
			edgeToTris[sortedKey].push({
				triIdx: i,
				from: edges[e].from,
				to: edges[e].to
			});
		}
	}

	// Check manifoldness — every edge should have exactly 2 triangles
	var isManifold = true;
	for (var ek in edgeToTris) {
		if (edgeToTris[ek].length !== 2) {
			isManifold = false;
			break;
		}
	}

	if (!isManifold) {
		// Non-manifold: fall back to per-triangle Z-up normals
		return ensureZUpNormals(tris);
	}

	// Build per-triangle neighbor list via shared edges
	var neighbors = new Array(tris.length);
	for (var ni = 0; ni < tris.length; ni++) neighbors[ni] = [];

	for (var ek2 in edgeToTris) {
		var pair = edgeToTris[ek2];
		if (pair.length !== 2) continue;
		var t0 = pair[0], t1 = pair[1];
		neighbors[t0.triIdx].push({
			neighbor: t1.triIdx,
			// If both traverse this edge in the SAME direction, they're inconsistent
			sameDirection: (t0.from === t1.from)
		});
		neighbors[t1.triIdx].push({
			neighbor: t0.triIdx,
			sameDirection: (t0.from === t1.from)
		});
	}

	// BFS from seed (triangle 0), enforce consistent winding
	var flipped = new Uint8Array(tris.length); // 0=keep, 1=flip
	var visited = new Uint8Array(tris.length);
	visited[0] = 1; // seed keeps its winding

	var queue = [0];
	var head = 0;

	while (head < queue.length) {
		var cur = queue[head++];
		var nbrs = neighbors[cur];
		for (var n = 0; n < nbrs.length; n++) {
			var nb = nbrs[n];
			if (visited[nb.neighbor]) continue;
			visited[nb.neighbor] = 1;

			// Two adjacent triangles should traverse their shared edge in OPPOSITE directions.
			// If sameDirection is true, one needs flipping.
			var curFlipped = flipped[cur];
			if (nb.sameDirection) {
				// They traverse in the same direction → neighbor needs opposite flip state
				flipped[nb.neighbor] = curFlipped ? 0 : 1;
			} else {
				// They traverse in opposite directions → same flip state
				flipped[nb.neighbor] = curFlipped;
			}

			queue.push(nb.neighbor);
		}
	}

	// Apply flips
	var result = [];
	var flipCount = 0;
	for (var ri = 0; ri < tris.length; ri++) {
		var t = tris[ri];
		if (flipped[ri]) {
			result.push({
				v0: { x: t.v0.x, y: t.v0.y, z: t.v0.z },
				v1: { x: t.v2.x, y: t.v2.y, z: t.v2.z },
				v2: { x: t.v1.x, y: t.v1.y, z: t.v1.z }
			});
			flipCount++;
		} else {
			result.push({
				v0: { x: t.v0.x, y: t.v0.y, z: t.v0.z },
				v1: { x: t.v1.x, y: t.v1.y, z: t.v1.z },
				v2: { x: t.v2.x, y: t.v2.y, z: t.v2.z }
			});
		}
	}

	if (flipCount > 0) {
		console.log("propagateNormals: flipped " + flipCount + "/" + tris.length + " triangles for consistency");
	}

	return result;
}

/**
 * Build result when no intersection is found — each surface returned as one whole group.
 */
function buildNoIntersectionResult(trisA, trisB, surfaceIdA, surfaceIdB, surfaceA, surfaceB) {
	var nameA = surfaceA.name || surfaceIdA;
	var nameB = surfaceB.name || surfaceIdB;
	var splits = [];

	if (trisA.length > 0) {
		splits.push({
			id: "A_1",
			surfaceId: surfaceIdA,
			label: nameA + " [whole]",
			triangles: trisA,
			color: "#FF0000",
			kept: true
		});
	}
	if (trisB.length > 0) {
		splits.push({
			id: "B_1",
			surfaceId: surfaceIdB,
			label: nameB + " [whole]",
			triangles: trisB,
			color: "#00FF00",
			kept: true
		});
	}

	return {
		splits: splits,
		surfaceIdA: surfaceIdA,
		surfaceIdB: surfaceIdB,
		taggedSegments: []
	};
}

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Compute split groups for two surfaces using classify-then-split.
 *
 * Algorithm:
 *   1-2) Extract triangles, find Moller intersection segments
 *   3) Chain segments into polylines
 *   4) Classify polylines as closed or open
 *   5) Classify every triangle centroid (inside/outside)
 *   6) Split straddling triangles at intersection edges, classify sub-triangles
 *   7) Deduplicate seam vertices
 *   8) Propagate normals for consistent winding
 *   9) Build split groups
 *
 * @param {string} surfaceIdA - First surface ID
 * @param {string} surfaceIdB - Second surface ID
 * @returns {Object|null} { splits, surfaceIdA, surfaceIdB, taggedSegments }
 */
export function computeSplits(surfaceIdA, surfaceIdB) {
	var surfaceA = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceIdA) : null;
	var surfaceB = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceIdB) : null;

	if (!surfaceA || !surfaceB) {
		console.error("SurfaceBooleanHelper: One or both surfaces not found");
		return null;
	}

	// Step 1) Extract triangles
	var trisA = ixExtractTriangles(surfaceA);
	var trisB = ixExtractTriangles(surfaceB);

	if (trisA.length === 0 || trisB.length === 0) {
		console.error("SurfaceBooleanHelper: One or both surfaces have no triangles");
		return null;
	}

	console.log("Surface Boolean: A=" + trisA.length + " tris, B=" + trisB.length + " tris");

	// Step 2) Get tagged intersection segments
	var taggedSegments = intersectSurfacePairTagged(trisA, trisB);
	console.log("Surface Boolean: " + taggedSegments.length + " intersection segments found");

	if (taggedSegments.length === 0) {
		console.warn("SurfaceBooleanHelper: No intersection found — returning each surface as whole group");
		return buildNoIntersectionResult(trisA, trisB, surfaceIdA, surfaceIdB, surfaceA, surfaceB);
	}

	// Step 3) Chain segments into polylines
	var avgSegLen = 0;
	for (var sl = 0; sl < taggedSegments.length; sl++) {
		avgSegLen += ixDist3D(taggedSegments[sl].p0, taggedSegments[sl].p1);
	}
	avgSegLen = taggedSegments.length > 0 ? avgSegLen / taggedSegments.length : 1.0;
	var chainThreshold = Math.max(avgSegLen * 0.01, 0.001);

	var polylines = chainSegments(taggedSegments, chainThreshold);
	console.log("Surface Boolean: chained into " + polylines.length + " polyline(s)");

	// Step 4) Classify polylines as closed or open
	var closedPolylines = [];
	var openPolylines = [];
	var closureThreshold = avgSegLen * 0.5;

	for (var p = 0; p < polylines.length; p++) {
		if (polylines[p].length < 2) continue;
		if (isPolylineClosed(polylines[p], closureThreshold)) {
			closedPolylines.push(polylines[p]);
		} else {
			openPolylines.push(polylines[p]);
		}
	}
	console.log("Surface Boolean: " + closedPolylines.length + " closed, " +
		openPolylines.length + " open polyline(s)");

	// Step 3b) Build crossed triangle sets from tagged segments
	var crossedSetA = {};
	var crossedSetB = {};
	for (var s = 0; s < taggedSegments.length; s++) {
		var seg = taggedSegments[s];
		if (!crossedSetA[seg.idxA]) crossedSetA[seg.idxA] = [];
		crossedSetA[seg.idxA].push(seg);
		if (!crossedSetB[seg.idxB]) crossedSetB[seg.idxB] = [];
		crossedSetB[seg.idxB].push(seg);
	}

	var crossedCountA = Object.keys(crossedSetA).length;
	var crossedCountB = Object.keys(crossedSetB).length;
	console.log("Surface Boolean: crossed A=" + crossedCountA + ", crossed B=" + crossedCountB);

	// Step 5) Classify every triangle centroid
	var classA = classifyAllTriangles(trisA, closedPolylines, openPolylines);
	var classB = classifyAllTriangles(trisB, closedPolylines, openPolylines);

	// Step 6) Split straddling triangles and classify sub-triangles
	var groupsA = splitStraddlingAndClassify(trisA, classA, crossedSetA, closedPolylines, openPolylines);
	var groupsB = splitStraddlingAndClassify(trisB, classB, crossedSetB, closedPolylines, openPolylines);

	console.log("Surface Boolean: A inside=" + groupsA.inside.length + " outside=" + groupsA.outside.length +
		", B inside=" + groupsB.inside.length + " outside=" + groupsB.outside.length);

	// Step 7) Deduplicate seam vertices
	if (groupsA.inside.length > 0) groupsA.inside = deduplicateSeamVertices(groupsA.inside, 1e-4);
	if (groupsA.outside.length > 0) groupsA.outside = deduplicateSeamVertices(groupsA.outside, 1e-4);
	if (groupsB.inside.length > 0) groupsB.inside = deduplicateSeamVertices(groupsB.inside, 1e-4);
	if (groupsB.outside.length > 0) groupsB.outside = deduplicateSeamVertices(groupsB.outside, 1e-4);

	// Step 8) Propagate normals for consistent winding
	if (groupsA.inside.length > 0) groupsA.inside = propagateNormals(groupsA.inside);
	if (groupsA.outside.length > 0) groupsA.outside = propagateNormals(groupsA.outside);
	if (groupsB.inside.length > 0) groupsB.inside = propagateNormals(groupsB.inside);
	if (groupsB.outside.length > 0) groupsB.outside = propagateNormals(groupsB.outside);

	// Step 9) Build split groups
	var splits = [];
	var nameA = surfaceA.name || surfaceIdA;
	var nameB = surfaceB.name || surfaceIdB;

	if (groupsA.inside.length > 0) {
		splits.push({
			id: "A_inside",
			surfaceId: surfaceIdA,
			label: nameA + " [inside]",
			triangles: groupsA.inside,
			color: "#FF0000",
			kept: true
		});
	}
	if (groupsA.outside.length > 0) {
		splits.push({
			id: "A_outside",
			surfaceId: surfaceIdA,
			label: nameA + " [outside]",
			triangles: groupsA.outside,
			color: "#FF8800",
			kept: true
		});
	}
	if (groupsB.inside.length > 0) {
		splits.push({
			id: "B_inside",
			surfaceId: surfaceIdB,
			label: nameB + " [inside]",
			triangles: groupsB.inside,
			color: "#00FF00",
			kept: true
		});
	}
	if (groupsB.outside.length > 0) {
		splits.push({
			id: "B_outside",
			surfaceId: surfaceIdB,
			label: nameB + " [outside]",
			triangles: groupsB.outside,
			color: "#00CCFF",
			kept: true
		});
	}

	if (splits.length === 0) {
		console.warn("SurfaceBooleanHelper: No split groups created");
		return null;
	}

	console.log("Surface Boolean: " + splits.length + " split groups created");

	return {
		splits: splits,
		surfaceIdA: surfaceIdA,
		surfaceIdB: surfaceIdB,
		taggedSegments: taggedSegments
	};
}

// ────────────────────────────────────────────────────────
// Triangle splitting at intersection edges
// ────────────────────────────────────────────────────────

/**
 * Split a single triangle by a single intersection segment.
 * Finds where the segment (or its infinite extension) crosses the triangle edges,
 * then splits the triangle at those crossing points.
 *
 * @param {Object} tri - {v0, v1, v2}
 * @param {Object} segP0 - First endpoint of intersection segment {x,y,z}
 * @param {Object} segP1 - Second endpoint of intersection segment {x,y,z}
 * @param {Array} [cutEdgeKeysOut] - Output: edge keys that lie on the cut line
 * @returns {Array} 1 or 3 triangles
 */
function splitOneTriangleBySegment(tri, segP0, segP1, cutEdgeKeysOut) {
	// Find crossings of the segment line with the triangle's 3 edges.
	// CRITICAL: Work in the triangle's local 2D coordinate frame, NOT world XY.
	// Using world XY causes incorrect splits on steep/vertical pit-wall triangles
	// because the XY projection distorts the geometry.
	var verts = [tri.v0, tri.v1, tri.v2];
	var edges = [
		{ a: 0, b: 1 },
		{ a: 1, b: 2 },
		{ a: 2, b: 0 }
	];

	// Build a local 2D coordinate frame on the triangle plane:
	//   U = normalize(V1 - V0)
	//   N = cross(V1-V0, V2-V0)
	//   V = cross(N, U), normalized
	var e1x = tri.v1.x - tri.v0.x;
	var e1y = tri.v1.y - tri.v0.y;
	var e1z = tri.v1.z - tri.v0.z;
	var e2x = tri.v2.x - tri.v0.x;
	var e2y = tri.v2.y - tri.v0.y;
	var e2z = tri.v2.z - tri.v0.z;

	// U axis = normalize(e1)
	var e1Len = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
	if (e1Len < 1e-12) return [tri]; // degenerate triangle
	var ux = e1x / e1Len, uy = e1y / e1Len, uz = e1z / e1Len;

	// Normal = cross(e1, e2)
	var nx = e1y * e2z - e1z * e2y;
	var ny = e1z * e2x - e1x * e2z;
	var nz = e1x * e2y - e1y * e2x;
	var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (nLen < 1e-12) return [tri]; // degenerate triangle

	// V axis = cross(N, U), normalized
	var vx = ny * uz - nz * uy;
	var vy = nz * ux - nx * uz;
	var vz = nx * uy - ny * ux;
	var vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
	if (vLen < 1e-12) return [tri];
	vx /= vLen; vy /= vLen; vz /= vLen;

	// Project a 3D point to local 2D: dot with U and V axes, relative to V0
	var ox = tri.v0.x, oy = tri.v0.y, oz = tri.v0.z;
	function toLocal(p) {
		var dx = p.x - ox, dy = p.y - oy, dz = p.z - oz;
		return {
			u: dx * ux + dy * uy + dz * uz,
			v: dx * vx + dy * vy + dz * vz
		};
	}

	// Project all vertices and segment endpoints to local 2D
	var lv = [toLocal(verts[0]), toLocal(verts[1]), toLocal(verts[2])];
	var ls0 = toLocal(segP0);
	var ls1 = toLocal(segP1);

	var crossings = [];
	var EDGE_EPS = 0.001;

	for (var e = 0; e < 3; e++) {
		var la = lv[edges[e].a];
		var lb = lv[edges[e].b];

		var hit = segSegIntersection2D(
			la.u, la.v, lb.u, lb.v,
			ls0.u, ls0.v, ls1.u, ls1.v
		);

		if (hit === null) continue;

		var t = hit.t;

		// Skip crossings near edge endpoints to avoid slivers
		if (t < EDGE_EPS || t > 1.0 - EDGE_EPS) continue;

		// Interpolate 3D crossing point along the ORIGINAL 3D edge
		var crossPt = lerpVert(verts[edges[e].a], verts[edges[e].b], t);

		crossings.push({
			edgeIdx: e,
			t: t,
			point: crossPt
		});
	}

	// Deduplicate crossings that are very close in space
	crossings = deduplicateCrossings(crossings);

	// Need exactly 2 crossings on 2 different edges to split
	if (crossings.length !== 2) {
		return [tri];
	}

	if (crossings[0].edgeIdx === crossings[1].edgeIdx) {
		return [tri];
	}

	if (cutEdgeKeysOut) {
		cutEdgeKeysOut.push(cutEdgeKey(crossings[0].point, crossings[1].point));
	}
	return splitTriangleAtCrossings(tri, crossings[0], crossings[1]);
}

/**
 * 2D segment-segment intersection test.
 * Returns {t, u} where t is parameter on segment AB and u is parameter on segment CD.
 * Returns null if segments are parallel or don't intersect.
 * t in [0,1] means intersection is on segment AB.
 * u can be any value (we use the line extension of CD).
 */
function segSegIntersection2D(ax, ay, bx, by, cx, cy, dx, dy) {
	var dABx = bx - ax;
	var dABy = by - ay;
	var dCDx = dx - cx;
	var dCDy = dy - cy;

	var denom = dABx * dCDy - dABy * dCDx;
	if (Math.abs(denom) < 1e-12) return null;

	var dACx = cx - ax;
	var dACy = cy - ay;

	var t = (dACx * dCDy - dACy * dCDx) / denom;
	var u = (dACx * dABy - dACy * dABx) / denom;

	// t must be in [0,1] (on the triangle edge)
	// u can be anything (we use the extended line of the intersection segment)
	if (t < -1e-10 || t > 1.0 + 1e-10) return null;

	return { t: Math.max(0, Math.min(1, t)), u: u };
}

/**
 * Remove duplicate crossings that are very close in 3D space.
 */
function deduplicateCrossings(crossings) {
	if (crossings.length <= 1) return crossings;

	var result = [crossings[0]];
	var DIST_SQ_THRESH = 1e-12;

	for (var i = 1; i < crossings.length; i++) {
		var isDup = false;
		for (var j = 0; j < result.length; j++) {
			var dx = crossings[i].point.x - result[j].point.x;
			var dy = crossings[i].point.y - result[j].point.y;
			var dz = crossings[i].point.z - result[j].point.z;
			if (dx * dx + dy * dy + dz * dz < DIST_SQ_THRESH) {
				isDup = true;
				break;
			}
		}
		if (!isDup) result.push(crossings[i]);
	}

	return result;
}

/**
 * Split a triangle at two edge crossings into 3 sub-triangles.
 *
 * Given crossings on two different edges, the vertex shared by those
 * two edges is the "lone" vertex. The split creates:
 *   T1: (V_lone, Pa, Pb)     — the lone-side triangle
 *   T2: (Pa, V_a, V_b)       — quad part 1
 *   T3: (Pa, V_b, Pb)        — quad part 2
 *
 * Where V_a and V_b are the other two vertices (not V_lone).
 */
function splitTriangleAtCrossings(tri, crossing0, crossing1) {
	var verts = [tri.v0, tri.v1, tri.v2];
	var edges = [
		{ a: 0, b: 1 },
		{ a: 1, b: 2 },
		{ a: 2, b: 0 }
	];

	var e0 = edges[crossing0.edgeIdx];
	var e1 = edges[crossing1.edgeIdx];
	var Pa = crossing0.point;
	var Pb = crossing1.point;

	// Find the lone vertex: shared by both crossed edges
	var loneIdx = -1;
	if (e0.a === e1.a || e0.a === e1.b) {
		loneIdx = e0.a;
	} else if (e0.b === e1.a || e0.b === e1.b) {
		loneIdx = e0.b;
	}

	if (loneIdx === -1) {
		// Crossed edges don't share a vertex — shouldn't happen with 2 crossings
		// on different edges of same triangle, but handle gracefully
		return [tri];
	}

	// Pa is on the edge containing loneIdx as one endpoint
	// Make sure Pa is on the edge from loneIdx
	// crossing0 is on edge e0 (verts[e0.a] to verts[e0.b])
	// crossing1 is on edge e1 (verts[e1.a] to verts[e1.b])
	// We need: Pa on edge from loneIdx, Pb on the other edge from loneIdx
	// Pa = point on the edge of crossing that has loneIdx, similarly Pb

	// The other two vertex indices
	var otherA = -1, otherB = -1;
	if (loneIdx === 0) { otherA = 1; otherB = 2; }
	else if (loneIdx === 1) { otherA = 2; otherB = 0; }
	else { otherA = 0; otherB = 1; }

	// Figure out which crossing is on which edge relative to loneIdx
	// crossing0 is on edge e0. If e0 contains otherA, then Pa is between lone and otherA
	var PaOnEdgeToA, PbOnEdgeToA;
	if (e0.a === otherA || e0.b === otherA) {
		PaOnEdgeToA = true;
	} else {
		PaOnEdgeToA = false;
	}

	var pToA, pToB;
	if (PaOnEdgeToA) {
		pToA = Pa;
		pToB = Pb;
	} else {
		pToA = Pb;
		pToB = Pa;
	}

	var vLone = verts[loneIdx];
	var vA = verts[otherA];
	var vB = verts[otherB];

	// T1: lone-side triangle
	var t1 = { v0: vLone, v1: pToA, v2: pToB };
	// T2, T3: quad on the other side, split into 2 triangles
	var t2 = { v0: pToA, v1: vA, v2: vB };
	var t3 = { v0: pToA, v1: vB, v2: pToB };

	return [t1, t2, t3];
}



/**
 * Linearly interpolate between two vertices.
 */
function lerpVert(a, b, t) {
	return {
		x: a.x + t * (b.x - a.x),
		y: a.y + t * (b.y - a.y),
		z: a.z + t * (b.z - a.z)
	};
}



// ────────────────────────────────────────────────────────
// Public: Preview mesh creation
// ────────────────────────────────────────────────────────

/**
 * Create 3D preview meshes for split groups.
 */
export function createSplitPreviewMeshes(splits) {
	var group = new THREE.Group();
	group.name = "surfaceBooleanPreview";
	group.userData = { isPreview: true };

	for (var s = 0; s < splits.length; s++) {
		var split = splits[s];
		var mesh = trianglesToMesh(split.triangles, split.color, split.kept);
		mesh.name = "split_" + split.id;
		mesh.userData.splitId = split.id;
		mesh.userData.splitIndex = s;
		mesh.userData.isPreview = true;
		group.add(mesh);
	}

	return group;
}

/**
 * Create a 3D fat-line mesh showing the intersection polyline.
 * Uses MeshLine (project's existing fat-line library) for platform-independent
 * thick lines. Rendered on top with depthTest=false.
 *
 * @param {Array} taggedSegments - [{p0, p1, idxA, idxB}, ...]
 * @returns {THREE.Group|null}
 */
export function createIntersectionPolylineMesh(taggedSegments) {
	if (!taggedSegments || taggedSegments.length === 0) return null;

	var group = new THREE.Group();
	group.name = "intersectionPolyline";
	group.renderOrder = 999;
	group.userData = { isPreview: true };

	// Build polyline points — each segment is a separate fat line
	for (var i = 0; i < taggedSegments.length; i++) {
		var seg = taggedSegments[i];
		var l0 = window.worldToThreeLocal(seg.p0.x, seg.p0.y);
		var l1 = window.worldToThreeLocal(seg.p1.x, seg.p1.y);

		var points = [
			new THREE.Vector3(l0.x, l0.y, seg.p0.z),
			new THREE.Vector3(l1.x, l1.y, seg.p1.z)
		];

		var line = new MeshLine();
		var geom = new THREE.BufferGeometry().setFromPoints(points);
		line.setGeometry(geom);

		var material = new MeshLineMaterial({
			color: new THREE.Color(0xFFFF00),
			lineWidth: 3,
			resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
			depthTest: false,
			depthWrite: false,
			transparent: true,
			opacity: 1.0,
			sizeAttenuation: false
		});

		var mesh = new THREE.Mesh(line, material);
		mesh.renderOrder = 999;
		group.add(mesh);
	}

	return group;
}

/**
 * Update a split mesh's visibility/appearance based on kept state.
 */
export function updateSplitMeshAppearance(mesh, kept) {
	if (!mesh) return;

	var originalColor = mesh.userData.originalColor || "#4488FF";
	mesh.visible = true;

	// mesh is a Group containing solidFill (Mesh) + wireframe (LineSegments)
	mesh.traverse(function (child) {
		if (!child.material) return;
		if (child.name === "solidFill") {
			child.material.opacity = kept ? 0.3 : 0.08;
			child.material.color.set(kept ? originalColor : "#444444");
			child.material.needsUpdate = true;
		} else if (child.name === "wireframe") {
			child.material.opacity = kept ? 0.7 : 0.15;
			child.material.color.set(kept ? originalColor : "#444444");
			child.material.needsUpdate = true;
		}
	});
}

/**
 * Deduplicate seam vertices in triangle soup using a spatial grid.
 * Both surfaces produce crossing points that are nearly identical but not
 * the same object. This merges vertices within tolerance so seam edges
 * share exact positions.
 *
 * @param {Array} tris - Triangle soup [{v0,v1,v2}, ...]
 * @param {number} tolerance - Distance tolerance (default 1e-4m)
 * @returns {Array} Triangle soup with deduplicated vertices
 */
function deduplicateSeamVertices(tris, tolerance) {
	if (!tris || tris.length === 0) return tris;
	if (tolerance === undefined) tolerance = 1e-4;

	var cellSize = tolerance * 3;
	var invCell = 1.0 / cellSize;
	var grid = {};
	var canonical = []; // array of canonical vertex objects
	var mergedCount = 0;

	function getKey(x, y, z) {
		var cx = Math.floor(x * invCell);
		var cy = Math.floor(y * invCell);
		var cz = Math.floor(z * invCell);
		return cx + "," + cy + "," + cz;
	}

	function findOrRegister(vx, vy, vz) {
		// Check 3×3×3 neighborhood for existing canonical vertex
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

		// Register new canonical vertex
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

		// Skip degenerate triangles where vertices collapsed to same object
		if (cv0 === cv1 || cv1 === cv2 || cv2 === cv0) {
			degenerateRemoved++;
			continue;
		}

		result.push({ v0: cv0, v1: cv1, v2: cv2 });
	}

	console.log("deduplicateSeamVertices — merged " + mergedCount +
		" vertices, removed " + degenerateRemoved + " degenerate tris" +
		" (" + canonical.length + " unique vertices)");

	return result;
}

/**
 * Merge kept splits into a new surface and store it.
 */
export function applyMerge(splits, config) {
	var closeMode = config.closeMode || "none";
	var snapTol = config.snapTolerance || 0;

	// ── Step 1: Collect kept triangles ──
	var keptTriangles = [];
	for (var s = 0; s < splits.length; s++) {
		if (splits[s].kept) {
			for (var t = 0; t < splits[s].triangles.length; t++) {
				keptTriangles.push(splits[s].triangles[t]);
			}
		}
	}

	if (keptTriangles.length === 0) {
		console.warn("SurfaceBooleanHelper: No triangles kept");
		return null;
	}

	// Cleanup settings (all optional, defaults to off)
	var removeDegenerate = config.removeDegenerate !== false; // default on
	var removeSlivers = !!config.removeSlivers; // default off
	var cleanCrossings = !!config.cleanCrossings; // default off
	var sliverRatio = config.sliverRatio || 0.01;
	var minArea = config.minArea || 1e-6;

	console.log("SurfaceBooleanHelper: applyMerge — " + keptTriangles.length +
		" kept tris, closeMode=" + closeMode + ", snapTol=" + snapTol +
		", removeDegenerate=" + removeDegenerate + ", removeSlivers=" + removeSlivers +
		", cleanCrossings=" + cleanCrossings + ", sliverRatio=" + sliverRatio);

	// ── Step 1b: Deduplicate seam vertices (skip for "raw" mode = tear at seam) ──
	var soup;
	if (closeMode === "raw") {
		soup = keptTriangles;
	} else {
		soup = deduplicateSeamVertices(keptTriangles, 1e-4);
	}

	// ── Step 2: Weld vertices (user snap tolerance) ──
	var welded = weldVertices(soup, snapTol);
	console.log("SurfaceBooleanHelper: welded " + soup.length * 3 + " vertices → " +
		welded.points.length + " unique points (tol=" + snapTol + "m)");

	// Convert back to soup for subsequent operations
	soup = weldedToSoup(welded.triangles);

	// ── Step 3: Remove degenerate / sliver triangles (if enabled) ──
	if (removeDegenerate || removeSlivers) {
		var effectiveSliver = removeSlivers ? sliverRatio : 0;
		soup = removeDegenerateTriangles(soup, minArea, effectiveSliver);
	}

	// ── Step 4: Clean crossing triangles (if enabled, iterative) ──
	if (cleanCrossings) {
		var prevLen = soup.length + 1;
		var cleanPass = 0;
		while (soup.length < prevLen && cleanPass < 5) {
			prevLen = soup.length;
			soup = cleanCrossingTriangles(soup);
			if (removeDegenerate || removeSlivers) {
				var effectiveSliver2 = removeSlivers ? sliverRatio : 0;
				soup = removeDegenerateTriangles(soup, minArea, effectiveSliver2);
			}
			cleanPass++;
		}
		if (cleanPass > 1) {
			console.log("SurfaceBooleanHelper: iterative clean took " + cleanPass + " passes");
		}
	}

	// ── Step 4b: Remove overlapping triangles / internal walls (if enabled) ──
	if (config.removeOverlapping) {
		var overlapTol = config.overlapTolerance || 0.5;
		soup = removeOverlappingTriangles(soup, overlapTol);
	}

	// ── Step 5: Stitch boundary edges by proximity (if mode = "stitch") ──
	if (closeMode === "stitch") {
		var stitchTol = config.stitchTolerance || 1.0;
		var stitchTris = stitchByProximity(soup, stitchTol);
		if (stitchTris.length > 0) {
			for (var st = 0; st < stitchTris.length; st++) {
				soup.push(stitchTris[st]);
			}
			console.log("SurfaceBooleanHelper: stitchByProximity added " + stitchTris.length + " triangles");
		}
	}

	// ── Step 6: Final weld ──
	var finalWelded = weldVertices(soup, snapTol);
	var worldPoints = finalWelded.points;
	var triangles = finalWelded.triangles;

	console.log("SurfaceBooleanHelper: final weld → " + worldPoints.length +
		" points, " + triangles.length + " triangles");

	// ── Step 6b: Post-weld sequential capping (stitch mode only) ──
	if (closeMode === "stitch") {
		var postSoup = weldedToSoup(triangles);

		// Use sequential capping: cap one loop at a time with non-manifold
		// cleanup before each pass (Fix 2 + Fix 3)
		postSoup = capBoundaryLoopsSequential(postSoup, snapTol, 3);

		// Update final output with capped result
		var cappedWeld = weldVertices(postSoup, snapTol);
		worldPoints = cappedWeld.points;
		triangles = cappedWeld.triangles;

		console.log("SurfaceBooleanHelper: after sequential capping → " +
			worldPoints.length + " points, " + triangles.length + " triangles");
	}

	// ── Step 6c: Post-cap cleanup (stitch mode only) ──
	if (closeMode === "stitch") {
		var postCapSoup = weldedToSoup(triangles);
		var postCapChanged = false;

		// Check for non-manifold edges introduced by capping
		var postCapStats = countOpenEdges(postCapSoup);
		if (postCapStats.overShared > 0) {
			console.log("SurfaceBooleanHelper: post-cap cleanup — " + postCapStats.overShared + " non-manifold edges, cleaning crossings");
			postCapSoup = cleanCrossingTriangles(postCapSoup);
			postCapChanged = true;
		}

		// Remove overlapping triangles (catches stitch+cap duplicates)
		if (config.removeOverlapping) {
			var postCapOverlapTol = config.overlapTolerance || 0.5;
			var preOverlapCount = postCapSoup.length;
			postCapSoup = removeOverlappingTriangles(postCapSoup, postCapOverlapTol);
			if (postCapSoup.length < preOverlapCount) postCapChanged = true;
		}

		// Remove degenerates if enabled
		if (removeDegenerate || removeSlivers) {
			var effectiveSliver3 = removeSlivers ? sliverRatio : 0;
			var preDegenCount = postCapSoup.length;
			postCapSoup = removeDegenerateTriangles(postCapSoup, minArea, effectiveSliver3);
			if (postCapSoup.length < preDegenCount) postCapChanged = true;
		}

		// Re-weld if anything was cleaned
		if (postCapChanged) {
			var postCapWeld = weldVertices(postCapSoup, snapTol);
			worldPoints = postCapWeld.points;
			triangles = postCapWeld.triangles;
			console.log("SurfaceBooleanHelper: post-cap cleanup → " +
				worldPoints.length + " points, " + triangles.length + " triangles");
		}
	}

	// ── Step 6d: Safety net — forceCloseIndexedMesh if still open ──
	if (closeMode === "stitch") {
		var safetyCheckSoup = weldedToSoup(triangles);
		var safetyStats = countOpenEdges(safetyCheckSoup);
		if (safetyStats.openEdges > 0) {
			console.log("SurfaceBooleanHelper: safety net — " + safetyStats.openEdges +
				" open edges remain, running forceCloseIndexedMesh");
			var forceClosed = forceCloseIndexedMesh(worldPoints, triangles);
			worldPoints = forceClosed.points;
			triangles = forceClosed.triangles;
			console.log("SurfaceBooleanHelper: after forceClose → " +
				worldPoints.length + " points, " + triangles.length + " triangles");
		}
	}

	// ── Step 7: Log boundary stats ──
	var finalSoup = weldedToSoup(triangles);
	logBoundaryStats(finalSoup, closeMode);

	// ── Step 8b: Open-edge diagnostic via countOpenEdges ──
	var edgeStats = countOpenEdges(finalSoup);
	console.log("SurfaceBooleanHelper: result — " + edgeStats.openEdges + " open edges, " + edgeStats.overShared + " non-manifold");

	// ── Step 9: Store result surface ──
	var bounds = computeBounds(worldPoints);

	var shortId = Math.random().toString(36).substring(2, 6);
	var surfaceId = "BOOL_SURFACE_" + shortId;
	var layerId = getOrCreateSurfaceLayer("Surface Booleans");

	var surface = {
		id: surfaceId,
		name: surfaceId,
		layerId: layerId,
		type: "triangulated",
		points: worldPoints,
		triangles: triangles,
		visible: true,
		gradient: config.gradient || "default",
		transparency: 1.0,
		meshBounds: bounds,
		isTexturedMesh: false
	};

	// Store and persist
	window.loadedSurfaces.set(surfaceId, surface);

	// Add to layer
	var layer = window.allSurfaceLayers ? window.allSurfaceLayers.get(layerId) : null;
	if (layer && layer.entities) layer.entities.add(surfaceId);

	if (typeof window.saveSurfaceToDB === "function") {
		window.saveSurfaceToDB(surfaceId).catch(function (err) {
			console.error("Failed to save boolean surface:", err);
		});
	}

	// Undo support
	if (window.undoManager) {
		var action = new AddSurfaceAction(surface);
		window.undoManager.pushAction(action);
	}

	// Trigger redraw
	window.threeKADNeedsRebuild = true;
	if (typeof window.drawData === "function") {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}

	console.log("SurfaceBooleanHelper: applied " + surfaceId + " (" + triangles.length + " triangles)");
	return surfaceId;
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
function weldVertices(tris, tolerance) {
	var points = [];
	var triangles = [];

	if (tolerance <= 0) {
		// No welding — fast path: store vertices per triangle (original behavior)
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

	// Spatial grid for fast nearest-vertex lookup
	var cellSize = Math.max(tolerance * 2, 0.002);
	var grid = {}; // "gx,gy,gz" -> [pointIndex, ...]
	var tolSq = tolerance * tolerance;

	function getOrAddPoint(v) {
		var gx = Math.floor(v.x / cellSize);
		var gy = Math.floor(v.y / cellSize);
		var gz = Math.floor(v.z / cellSize);

		// Search nearby cells
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

		// New unique point
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

		// Skip degenerate triangles where welding collapsed vertices
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
function extractBoundaryLoops(tris) {
	// Step 1) Build edge count map — boundary edges appear exactly once
	var edgeMap = {}; // "x1,y1,z1|x2,y2,z2" -> { count, v0, v1 }
	var PREC = 6;

	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	// Also build a directed half-edge map for winding order
	var halfEdges = {}; // "ka|kb" -> true (directed: ka → kb exists as a triangle edge)

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
			// Record directed half-edge
			halfEdges[keys[e] + "|" + keys[ne]] = true;
		}
	}

	// Step 2) Collect boundary edges (count === 1) and count over-shared edges (count > 2)
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

	// Step 3) Build adjacency for boundary vertices and chain into loops
	// Determine correct winding: boundary edge direction should be OPPOSITE to the
	// existing half-edge (so the cap triangle normals face outward)
	var adj = {}; // vertexKey -> [{ key: neighborKey, vertex: {x,y,z} }]

	for (var b = 0; b < boundaryEdges.length; b++) {
		var be = boundaryEdges[b];
		// The existing mesh has half-edge k0→k1, so boundary should go k1→k0
		// for consistent outward normals on the cap
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

	// Chain into loops
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

			// Pick first unused neighbor
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

			// Closed the loop?
			if (currentKey === startKey) break;
		}

		if (loop.length >= 3) {
			loops.push(loop);
		}
	}

	return { loops: loops, boundaryEdgeCount: boundaryEdges.length, overSharedEdgeCount: overSharedCount };
}

// ────────────────────────────────────────────────────────
// Boundary capping — close open surfaces (thin wrapper)
// ────────────────────────────────────────────────────────

/**
 * Find boundary edges, chain into loops, triangulate each loop to cap.
 * Returns array of cap triangles {v0, v1, v2}.
 */
function capBoundaryLoops(tris) {
	var result = extractBoundaryLoops(tris);

	if (result.loops.length === 0) return [];

	console.log("SurfaceBooleanHelper: " + result.boundaryEdgeCount + " boundary edges, " +
		result.loops.length + " loop(s), sizes: " +
		result.loops.map(function (l) { return l.length; }).join(", "));

	// Triangulate each loop using ear-clipping
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
 * non-manifold after each loop. This avoids the double-cap problem where
 * capping all loops at once can create overlapping triangles.
 *
 * @param {Array} soup - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} snapTol - Weld tolerance
 * @param {number} maxPasses - Max number of cap passes (default 3)
 * @returns {Array} Updated triangle soup with cap triangles integrated
 */
function capBoundaryLoopsSequential(soup, snapTol, maxPasses) {
	if (!maxPasses) maxPasses = 3;
	var MAX_CAP_LOOP_VERTS = 500;

	for (var capPass = 0; capPass < maxPasses; capPass++) {
		// Check for non-manifold edges before extracting loops
		var preStats = countOpenEdges(soup);
		if (preStats.overShared > 0) {
			console.log("SurfaceBooleanHelper: capSequential pass " + (capPass + 1) +
				" — cleaning " + preStats.overShared + " non-manifold edges before cap");
			soup = cleanCrossingTriangles(soup);
			// Re-weld after cleaning
			var cleaned = weldVertices(soup, snapTol);
			soup = weldedToSoup(cleaned.triangles);
		}

		var loopResult = extractBoundaryLoops(soup);
		if (loopResult.loops.length === 0) {
			console.log("SurfaceBooleanHelper: capSequential — no boundary loops at pass " + (capPass + 1) + ", mesh is closed");
			break;
		}

		console.log("SurfaceBooleanHelper: capSequential pass " + (capPass + 1) + " — " +
			loopResult.loops.length + " loop(s), sizes: " +
			loopResult.loops.map(function (l) { return l.length; }).join(", "));

		var totalCapTris = 0;

		// Cap one loop at a time
		for (var li = 0; li < loopResult.loops.length; li++) {
			var loop = loopResult.loops[li];
			if (loop.length < 3) continue;
			if (loop.length > MAX_CAP_LOOP_VERTS) {
				console.warn("SurfaceBooleanHelper: capSequential — skipped loop[" + li +
					"]: " + loop.length + " verts exceeds limit (" + MAX_CAP_LOOP_VERTS + ")");
				continue;
			}

			var capTris = triangulateLoop(loop);
			if (capTris.length === 0) continue;

			// Add cap triangles to soup
			for (var ct = 0; ct < capTris.length; ct++) {
				soup.push(capTris[ct]);
			}
			totalCapTris += capTris.length;

			console.log("SurfaceBooleanHelper: capSequential — capped loop[" + li +
				"]: " + loop.length + " verts → " + capTris.length + " cap tris");

			// Re-weld after each loop cap to integrate vertices
			var reWelded = weldVertices(soup, snapTol);
			soup = weldedToSoup(reWelded.triangles);

			// Clean non-manifold if introduced by this cap
			var postStats = countOpenEdges(soup);
			if (postStats.overShared > 0) {
				soup = cleanCrossingTriangles(soup);
				var reCleaned = weldVertices(soup, snapTol);
				soup = weldedToSoup(reCleaned.triangles);
			}
		}

		if (totalCapTris === 0) {
			console.log("SurfaceBooleanHelper: capSequential — no cappable loops at pass " + (capPass + 1));
			break;
		}

		console.log("SurfaceBooleanHelper: capSequential pass " + (capPass + 1) +
			" — added " + totalCapTris + " cap tris total");
	}

	return soup;
}

/**
 * Triangulate a 3D polygon loop using ear-clipping projected onto the
 * best-fit 2D plane (the plane with the largest projected area).
 *
 * @param {Array} loop - Array of {x, y, z} vertices in order
 * @returns {Array} Array of {v0, v1, v2} triangles
 */
function triangulateLoop(loop) {
	if (loop.length < 3) return [];
	if (loop.length === 3) {
		return [{ v0: loop[0], v1: loop[1], v2: loop[2] }];
	}
	// Direct quad split for 4-vertex loops — Delaunator/Constrainautor fails on
	// degenerate 2D projections of near-collinear quads. Split along the shorter
	// diagonal to avoid thin slivers.
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

	// Compute loop normal via Newell's method (needed for winding validation)
	var nx = 0, ny = 0, nz = 0;
	for (var i = 0; i < loop.length; i++) {
		var curr = loop[i];
		var next = loop[(i + 1) % loop.length];
		nx += (curr.y - next.y) * (curr.z + next.z);
		ny += (curr.z - next.z) * (curr.x + next.x);
		nz += (curr.x - next.x) * (curr.y + next.y);
	}

	// Pick the 2D projection plane using shoelace area on all 3 planes — pick largest
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

	// Build flat coords array for Delaunator
	var n = loop.length;
	var coords = new Float64Array(n * 2);
	for (var j = 0; j < n; j++) {
		coords[j * 2] = projU(loop[j]);
		coords[j * 2 + 1] = projV(loop[j]);
	}

	// Constrained Delaunay triangulation
	var del, con;
	try {
		del = new Delaunator(coords);
		con = new Constrainautor(del);

		// Constrain all boundary loop edges
		for (var ci = 0; ci < n; ci++) {
			var ni = (ci + 1) % n;
			try {
				con.constrainOne(ci, ni);
			} catch (e) {
				// Skip problematic constraint edges
			}
		}
	} catch (e) {
		console.warn("SurfaceBooleanHelper: triangulateLoop — Constrainautor failed, using Delaunator only:", e.message);
		try {
			del = new Delaunator(coords);
		} catch (e2) {
			console.warn("SurfaceBooleanHelper: triangulateLoop — Delaunator also failed:", e2.message);
			return [];
		}
	}

	// Filter triangles: only keep those whose centroid is inside the boundary loop
	var result = [];
	var tris = del.triangles;
	for (var k = 0; k < tris.length; k += 3) {
		var a = tris[k], b = tris[k + 1], c = tris[k + 2];

		// Centroid in 2D
		var cx = (coords[a * 2] + coords[b * 2] + coords[c * 2]) / 3;
		var cy = (coords[a * 2 + 1] + coords[b * 2 + 1] + coords[c * 2 + 1]) / 3;

		// Point-in-polygon test (ray casting) against the loop
		if (_pointInLoop2D(cx, cy, coords, n)) {
			result.push({
				v0: loop[a],
				v1: loop[b],
				v2: loop[c]
			});
		}
	}

	// Fix 4: Validate cap triangle winding against the Newell loop normal
	// If a cap tri's normal is anti-parallel to the loop normal, flip v1↔v2
	var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (nLen > 1e-12) {
		var nnx = nx / nLen, nny = ny / nLen, nnz = nz / nLen;
		for (var wi = 0; wi < result.length; wi++) {
			var wt = result[wi];
			// Compute triangle normal via cross product
			var ux = wt.v1.x - wt.v0.x, uy = wt.v1.y - wt.v0.y, uz = wt.v1.z - wt.v0.z;
			var vx = wt.v2.x - wt.v0.x, vy = wt.v2.y - wt.v0.y, vz = wt.v2.z - wt.v0.z;
			var tnx = uy * vz - uz * vy;
			var tny = uz * vx - ux * vz;
			var tnz = ux * vy - uy * vx;
			// Dot with loop normal — if negative, winding is reversed
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

/**
 * Ray-casting point-in-polygon test on a 2D loop stored as flat coords.
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
 * 2D point-in-triangle test for ear clipping.
 */
function pointInTri2D(px, py, ax, ay, bx, by, cx, cy) {
	var d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
	var d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
	var d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
	var hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
	var hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
	return !(hasNeg && hasPos);
}

// ────────────────────────────────────────────────────────
// Internal: Mesh creation for preview
// ────────────────────────────────────────────────────────

function trianglesToMesh(tris, color, visible) {
	var positions = [];
	for (var i = 0; i < tris.length; i++) {
		var local0 = window.worldToThreeLocal(tris[i].v0.x, tris[i].v0.y);
		var local1 = window.worldToThreeLocal(tris[i].v1.x, tris[i].v1.y);
		var local2 = window.worldToThreeLocal(tris[i].v2.x, tris[i].v2.y);
		positions.push(
			local0.x, local0.y, tris[i].v0.z,
			local1.x, local1.y, tris[i].v1.z,
			local2.x, local2.y, tris[i].v2.z
		);
	}

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.computeVertexNormals();

	var group = new THREE.Group();
	group.userData.originalColor = color;

	// Semi-transparent solid fill (matches extrude preview style)
	var solidMaterial = new THREE.MeshBasicMaterial({
		color: new THREE.Color(color || "#4488FF"),
		transparent: true,
		opacity: visible ? 0.3 : 0.08,
		side: THREE.DoubleSide,
		depthWrite: false
	});
	var solidMesh = new THREE.Mesh(geometry.clone(), solidMaterial);
	solidMesh.name = "solidFill";
	group.add(solidMesh);

	// Wireframe overlay
	var wireGeometry = new THREE.WireframeGeometry(geometry);
	var wireMaterial = new THREE.LineBasicMaterial({
		color: new THREE.Color(color || "#4488FF"),
		transparent: true,
		opacity: visible ? 0.7 : 0.15
	});
	var wireframe = new THREE.LineSegments(wireGeometry, wireMaterial);
	wireframe.name = "wireframe";
	group.add(wireframe);

	return group;
}

function computeBounds(points) {
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
// Utility helpers
// ────────────────────────────────────────────────────────

/**
 * 3D Euclidean distance between two points.
 * @param {Object} a - {x, y, z}
 * @param {Object} b - {x, y, z}
 * @returns {number}
 */
function dist3(a, b) {
	var dx = a.x - b.x;
	var dy = a.y - b.y;
	var dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Convert welded {points, triangles} back to triangle soup [{v0,v1,v2}, ...].
 * Each welded triangle has vertices: [{x,y,z}, {x,y,z}, {x,y,z}].
 *
 * @param {Array} weldedTriangles - Array of {vertices: [{x,y,z},{x,y,z},{x,y,z}]}
 * @returns {Array} Triangle soup [{v0, v1, v2}, ...]
 */
function weldedToSoup(weldedTriangles) {
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

/**
 * Log boundary / closure diagnostics to console.
 *
 * @param {Array} tris - Triangle soup [{v0,v1,v2}, ...]
 * @param {string} closeMode - The closing mode used
 */
function logBoundaryStats(tris, closeMode) {
	var result = extractBoundaryLoops(tris);
	var isClosed = result.boundaryEdgeCount === 0 && result.overSharedEdgeCount === 0;

	console.log("SurfaceBooleanHelper: ── Post-close diagnostics ──");
	console.log("SurfaceBooleanHelper:   closeMode = " + closeMode);
	console.log("SurfaceBooleanHelper:   triangles = " + tris.length);
	console.log("SurfaceBooleanHelper:   boundary edges = " + result.boundaryEdgeCount);
	console.log("SurfaceBooleanHelper:   over-shared edges = " + result.overSharedEdgeCount);
	console.log("SurfaceBooleanHelper:   loops = " + result.loops.length +
		(result.loops.length > 0 ? " (sizes: " + result.loops.map(function (l) { return l.length; }).join(", ") + ")" : ""));
	console.log("SurfaceBooleanHelper:   closed = " + isClosed);
}

// ────────────────────────────────────────────────────────
// Degenerate / sliver triangle removal
// ────────────────────────────────────────────────────────

/**
 * Compute the area of a triangle in 3D using the cross-product method.
 * @param {Object} tri - {v0, v1, v2}
 * @returns {number} Area in square metres
 */
function triangleArea3D(tri) {
	var ux = tri.v1.x - tri.v0.x;
	var uy = tri.v1.y - tri.v0.y;
	var uz = tri.v1.z - tri.v0.z;
	var vx = tri.v2.x - tri.v0.x;
	var vy = tri.v2.y - tri.v0.y;
	var vz = tri.v2.z - tri.v0.z;
	// cross product
	var cx = uy * vz - uz * vy;
	var cy = uz * vx - ux * vz;
	var cz = ux * vy - uy * vx;
	return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Remove degenerate and sliver triangles from a triangle soup.
 *
 * Degenerate: area < minArea (default 1e-6 m²)
 * Sliver: minimum altitude / maximum edge length < sliverRatio (default 0.01)
 *
 * The minimum altitude test catches long-thin triangles that have non-trivial
 * area but are effectively 1D — these cause over-shared edges, internal walls,
 * and prevent clean boundary loops.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} [minArea=1e-6] - Minimum triangle area in m²
 * @param {number} [sliverRatio=0.01] - Min altitude / max edge threshold
 * @returns {Array} Filtered triangle soup
 */
function removeDegenerateTriangles(tris, minArea, sliverRatio) {
	if (typeof minArea === "undefined") minArea = 1e-6;
	if (typeof sliverRatio === "undefined") sliverRatio = 0.01;

	var removed = 0;
	var result = [];

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var area = triangleArea3D(tri);

		// Remove near-zero-area triangles
		if (area < minArea) {
			removed++;
			continue;
		}

		// Compute edge lengths
		var e0 = dist3(tri.v0, tri.v1);
		var e1 = dist3(tri.v1, tri.v2);
		var e2 = dist3(tri.v2, tri.v0);
		var maxEdge = Math.max(e0, e1, e2);

		// Minimum altitude = 2 * area / maxEdge
		// If this is very small relative to maxEdge, it's a sliver
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
		console.log("SurfaceBooleanHelper: removeDegenerateTriangles — removed " +
			removed + " degenerate/sliver tris, " + result.length + " remain (was " + tris.length + ")");
	}

	return result;
}

// ────────────────────────────────────────────────────────
// Stitch by proximity — connect nearby boundary edges
// ────────────────────────────────────────────────────────

/**
 * Stitch open boundary edges that are close in 3D space.
 *
 * Instead of pairing entire loops and zipping them (which creates massive
 * spanning triangles), this finds individual boundary edge endpoints that
 * are within `stitchTolerance` of each other and connects them with quads.
 *
 * Algorithm:
 *   1. Extract all boundary edges (edges with count === 1)
 *   2. Build a spatial grid of boundary edge midpoints
 *   3. For each boundary edge, find nearby boundary edges
 *   4. If two boundary edges share close endpoints (within tolerance),
 *      connect them with 2 triangles (a quad)
 *   5. After proximity stitching, flat-cap any remaining small loops
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} [stitchTolerance=1.0] - Max 3D distance to connect boundary edges
 * @returns {Array} Additional triangles from stitching
 */
function stitchByProximity(tris, stitchTolerance) {
	if (typeof stitchTolerance === "undefined") stitchTolerance = 1.0;

	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}
	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	// Step 1) Build edge count map — boundary edges appear exactly once
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

	// Collect boundary edges
	var boundaryEdges = [];
	for (var ek2 in edgeMap) {
		if (edgeMap[ek2].count === 1) {
			var be = edgeMap[ek2];
			// Orient: boundary direction opposite to existing half-edge
			if (halfEdges[be.k0 + "|" + be.k1]) {
				boundaryEdges.push({ v0: be.v1, v1: be.v0, k0: be.k1, k1: be.k0 });
			} else {
				boundaryEdges.push({ v0: be.v0, v1: be.v1, k0: be.k0, k1: be.k1 });
			}
		}
	}

	if (boundaryEdges.length === 0) {
		console.log("SurfaceBooleanHelper: stitchByProximity — no boundary edges");
		return [];
	}

	console.log("SurfaceBooleanHelper: stitchByProximity — " + boundaryEdges.length +
		" boundary edges, tolerance=" + stitchTolerance.toFixed(4) + "m");

	// Step 2) Build spatial grid of boundary vertex endpoints for fast lookup
	var cellSize = Math.max(stitchTolerance * 3, 0.1);
	var vertGrid = {}; // cellKey -> [{ edgeIdx, vertIdx (0 or 1), vertex }]

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

	// Step 3) For each boundary vertex, find close boundary vertices from OTHER edges
	// and build a merge map: vertexKey → merged vertex position
	var mergeMap = {}; // vertexKey -> targetVertexKey
	var usedEdges = {}; // edgeIdx -> true (already stitched)
	var extraTris = [];
	var stitchedCount = 0;

	for (var si = 0; si < boundaryEdges.length; si++) {
		if (usedEdges[si]) continue;
		var srcEdge = boundaryEdges[si];

		// Find a nearby boundary edge where BOTH endpoints are within tolerance
		var bestMatch = -1;
		var bestTotalDist = Infinity;
		var bestFlip = false;

		// Check nearby cells for v0
		var gk0 = gridKey(srcEdge.v0);
		var gx0 = Math.floor(srcEdge.v0.x / cellSize);
		var gy0 = Math.floor(srcEdge.v0.y / cellSize);
		var gz0 = Math.floor(srcEdge.v0.z / cellSize);

		// Collect candidate edges from nearby vertices
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

		// Check each candidate edge: both endpoints must be within tolerance
		for (var candIdx in candidates) {
			var candEdge = boundaryEdges[candIdx];

			// Try both orientations: (src.v0↔cand.v0, src.v1↔cand.v1) and (src.v0↔cand.v1, src.v1↔cand.v0)
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

			// Build quad between the two edges (2 triangles)
			// srcEdge: v0→v1, matchEdge: v0→v1 (or flipped)
			var mV0 = bestFlip ? matchEdge.v1 : matchEdge.v0;
			var mV1 = bestFlip ? matchEdge.v0 : matchEdge.v1;

			// Quad: srcEdge.v0, srcEdge.v1, mV1, mV0
			// Triangle 1: srcEdge.v0, srcEdge.v1, mV0
			extraTris.push({ v0: srcEdge.v0, v1: srcEdge.v1, v2: mV0 });
			// Triangle 2: srcEdge.v1, mV1, mV0
			extraTris.push({ v0: srcEdge.v1, v1: mV1, v2: mV0 });
		}
	}

	console.log("SurfaceBooleanHelper: stitchByProximity — stitched " + stitchedCount +
		" edge pairs → " + extraTris.length + " stitch quad triangles (no capping)");

	return extraTris;
}

// ────────────────────────────────────────────────────────
// Curtain walls + bottom cap — extrude boundary to floor
// ────────────────────────────────────────────────────────

/**
 * Extrude remaining open boundary edges vertically down to a floor plane,
 * then triangulate the bottom cap with earcut.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} floorOffset - Metres below the minimum Z of the mesh
 * @returns {Array} Additional triangles (curtain walls + bottom cap)
 */
function buildCurtainAndCap(tris, floorOffset) {
	var result = extractBoundaryLoops(tris);
	if (result.loops.length === 0) {
		console.log("SurfaceBooleanHelper: buildCurtainAndCap — no boundary loops to curtain");
		return [];
	}

	// Compute floorZ from all triangle vertices
	var minZ = Infinity;
	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		if (tri.v0.z < minZ) minZ = tri.v0.z;
		if (tri.v1.z < minZ) minZ = tri.v1.z;
		if (tri.v2.z < minZ) minZ = tri.v2.z;
	}
	var floorZ = minZ - (floorOffset || 10);

	console.log("SurfaceBooleanHelper: buildCurtainAndCap — " + result.loops.length +
		" loop(s), floorZ=" + floorZ.toFixed(2));

	var extraTris = [];

	for (var li = 0; li < result.loops.length; li++) {
		var loop = result.loops[li];

		// Build curtain walls: for each boundary edge A→B, create 2 triangles (vertical quad)
		var floorVerts = []; // floor-level vertices for bottom cap
		for (var j = 0; j < loop.length; j++) {
			var a = loop[j];
			var b = loop[(j + 1) % loop.length];

			// Top vertices are the boundary vertices
			// Bottom vertices are at floorZ with same XY
			var aBot = { x: a.x, y: a.y, z: floorZ };
			var bBot = { x: b.x, y: b.y, z: floorZ };

			// Quad: A-top → B-top → B-bot → A-bot
			// Triangle 1: A-top, B-top, B-bot  (winding: outward)
			extraTris.push({ v0: a, v1: b, v2: bBot });
			// Triangle 2: A-top, B-bot, A-bot
			extraTris.push({ v0: a, v1: bBot, v2: aBot });

			floorVerts.push(aBot);
		}

		// Bottom cap: triangulate the floor polygon using Constrained Delaunay
		// Floor is flat at floorZ, so use triangulateLoop which projects to best-fit plane
		var capTris = triangulateLoop(floorVerts);
		for (var ci = 0; ci < capTris.length; ci++) {
			// Reverse winding so normals face downward
			extraTris.push({
				v0: capTris[ci].v2,
				v1: capTris[ci].v1,
				v2: capTris[ci].v0
			});
		}

		console.log("SurfaceBooleanHelper:   loop[" + li + "]: " + loop.length +
			" edges → " + (loop.length * 2) + " wall tris + " +
			capTris.length + " cap tris");
	}

	return extraTris;
}

// ────────────────────────────────────────────────────────
// Force-close indexed mesh — works on integer point indices
// ────────────────────────────────────────────────────────

/**
 * Operates on the INDEXED mesh (after weld). Uses integer point indices
 * to find boundary edges and close them — zero floating-point precision issues.
 *
 * For each boundary edge, finds the nearest point index (by 3D distance)
 * that won't create an over-shared edge, and adds a closing triangle.
 * Iterates until closed or no more progress.
 *
 * @param {Array} points - [{x,y,z}, ...]
 * @param {Array} triangles - [{vertices: [{x,y,z},{x,y,z},{x,y,z}]}, ...]
 * @returns {Object} - { points, triangles } — updated indexed mesh
 */
function forceCloseIndexedMesh(points, triangles) {
	// Convert to index-based representation for integer operations
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

	// Build spatial grid for fast nearest-point lookup
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
			console.log("SurfaceBooleanHelper: forceCloseIndexedMesh — CLOSED after " +
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
			console.log("SurfaceBooleanHelper: forceCloseIndexedMesh — no more closeable gaps after " +
				pass + " passes, " + totalAdded + " added, " + boundaryEdges.length + " boundary edges remain");
			break;
		}

		totalAdded += newTris.length;
		console.log("SurfaceBooleanHelper: forceCloseIndexedMesh pass " + pass +
			" — added " + newTris.length + " tris (" + boundaryEdges.length + " boundary edges)");
	}

	// Convert back to vertices format
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
// Generate closing triangles — fill boundary gaps locally
// ────────────────────────────────────────────────────────

/**
 * For each boundary edge, find the nearest vertex (not already connected)
 * that can form a valid closing triangle. Iterates until no more gaps can
 * be filled or a pass adds no new triangles.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} maxDist - Maximum search distance for closing vertex
 * @returns {Array} - Updated triangle soup with closing triangles added
 */
function generateClosingTriangles(tris, maxDist) {
	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}
	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}
	function dist3sq(a, b) {
		var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
		return dx * dx + dy * dy + dz * dz;
	}
	function triArea(a, b, c) {
		var abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
		var acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
		var cx = aby * acz - abz * acy;
		var cy = abz * acx - abx * acz;
		var cz = abx * acy - aby * acx;
		return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
	}

	var maxDistSq = maxDist * maxDist;
	var totalAdded = 0;
	var maxPasses = 20;

	for (var pass = 0; pass < maxPasses; pass++) {
		// Build edge count map and vertex position map
		var edgeMap = {};  // edgeKey -> count
		var vertPos = {};  // vKey -> {x,y,z}

		for (var i = 0; i < tris.length; i++) {
			var tri = tris[i];
			var verts = [tri.v0, tri.v1, tri.v2];
			var keys = [vKey(verts[0]), vKey(verts[1]), vKey(verts[2])];

			for (var e = 0; e < 3; e++) {
				vertPos[keys[e]] = verts[e];
				var ne = (e + 1) % 3;
				var ek = edgeKey(keys[e], keys[ne]);
				edgeMap[ek] = (edgeMap[ek] || 0) + 1;
			}
		}

		// Collect boundary edges (count === 1)
		var boundaryEdges = [];
		var boundaryVertKeys = {};

		for (var ek2 in edgeMap) {
			if (edgeMap[ek2] === 1) {
				var parts = ek2.split("|");
				boundaryEdges.push({ k0: parts[0], k1: parts[1] });
				boundaryVertKeys[parts[0]] = true;
				boundaryVertKeys[parts[1]] = true;
			}
		}

		if (boundaryEdges.length === 0) {
			console.log("SurfaceBooleanHelper: generateClosingTriangles — mesh is closed after " +
				pass + " passes, " + totalAdded + " triangles added");
			return tris;
		}

		// Build spatial grid of ALL vertices for fast nearest-neighbor lookup
		var cellSize = Math.max(maxDist, 1.0);
		var grid = {};
		var allKeys = Object.keys(vertPos);
		for (var vi = 0; vi < allKeys.length; vi++) {
			var vp = vertPos[allKeys[vi]];
			var gk = Math.floor(vp.x / cellSize) + "," + Math.floor(vp.y / cellSize) + "," + Math.floor(vp.z / cellSize);
			if (!grid[gk]) grid[gk] = [];
			grid[gk].push(allKeys[vi]);
		}

		// For each boundary edge, find the best closing vertex
		var newTris = [];
		var usedEdges = {}; // prevent double-closing an edge in one pass

		for (var bi = 0; bi < boundaryEdges.length; bi++) {
			var be = boundaryEdges[bi];
			var bek = edgeKey(be.k0, be.k1);
			if (usedEdges[bek]) continue;

			var v0 = vertPos[be.k0];
			var v1 = vertPos[be.k1];

			// Midpoint of boundary edge
			var mid = {
				x: (v0.x + v1.x) / 2,
				y: (v0.y + v1.y) / 2,
				z: (v0.z + v1.z) / 2
			};

			// Search nearby cells for candidate vertex
			var bestKey = null;
			var bestDistSq = Infinity;
			var mgx = Math.floor(mid.x / cellSize);
			var mgy = Math.floor(mid.y / cellSize);
			var mgz = Math.floor(mid.z / cellSize);

			for (var dx = -1; dx <= 1; dx++) {
				for (var dy = -1; dy <= 1; dy++) {
					for (var dz = -1; dz <= 1; dz++) {
						var cell = grid[(mgx + dx) + "," + (mgy + dy) + "," + (mgz + dz)];
						if (!cell) continue;
						for (var ci = 0; ci < cell.length; ci++) {
							var ck = cell[ci];
							// Skip the edge's own vertices
							if (ck === be.k0 || ck === be.k1) continue;

							var cv = vertPos[ck];
							var d2 = dist3sq(mid, cv);
							if (d2 > maxDistSq) continue;
							if (d2 >= bestDistSq) continue;

							// Check the two new edges wouldn't be over-shared (>2 uses)
							var ek0c = edgeKey(be.k0, ck);
							var ek1c = edgeKey(be.k1, ck);
							var c0 = edgeMap[ek0c] || 0;
							var c1 = edgeMap[ek1c] || 0;
							if (c0 >= 2 || c1 >= 2) continue;

							// Check triangle has reasonable area (not degenerate)
							var area = triArea(v0, v1, cv);
							if (area < 1e-6) continue;

							bestKey = ck;
							bestDistSq = d2;
						}
					}
				}
			}

			if (bestKey !== null) {
				var cv2 = vertPos[bestKey];
				newTris.push({ v0: v0, v1: v1, v2: cv2 });

				// Update edge counts so we don't double-close in this pass
				usedEdges[bek] = true;
				var ek0c2 = edgeKey(be.k0, bestKey);
				var ek1c2 = edgeKey(be.k1, bestKey);
				edgeMap[ek0c2] = (edgeMap[ek0c2] || 0) + 1;
				edgeMap[ek1c2] = (edgeMap[ek1c2] || 0) + 1;
				edgeMap[bek] = 2; // boundary edge now shared by 2 tris
			}
		}

		if (newTris.length === 0) {
			console.log("SurfaceBooleanHelper: generateClosingTriangles — no more closeable gaps after " +
				pass + " passes, " + totalAdded + " triangles added, " +
				boundaryEdges.length + " boundary edges remain");
			return tris;
		}

		// Append new triangles
		for (var ni = 0; ni < newTris.length; ni++) {
			tris.push(newTris[ni]);
		}
		totalAdded += newTris.length;
		console.log("SurfaceBooleanHelper: generateClosingTriangles pass " + pass +
			" — added " + newTris.length + " closing tris (" + boundaryEdges.length + " boundary edges were open)");
	}

	console.log("SurfaceBooleanHelper: generateClosingTriangles — finished " + maxPasses +
		" passes, " + totalAdded + " triangles added total");
	return tris;
}

// ────────────────────────────────────────────────────────
// Crossing triangle cleanup — remove duplicates from splitting
// ────────────────────────────────────────────────────────

/**
 * Remove duplicate/conflicting triangles that cause over-shared edges (count > 2).
 * These typically result from triangle splitting where sub-triangles overlap.
 *
 * Two-pass approach:
 *   Pass 1: For each over-shared edge, sort its triangles by area (largest first)
 *           and mark the smallest ones for removal until only 2 remain per edge.
 *   Pass 2: Also remove exact fingerprint duplicates among flagged triangles.
 *
 * This is more aggressive than fingerprint-only dedup — it catches near-overlapping
 * slivers that share edges but aren't vertex-identical.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @returns {Array} Cleaned triangle soup
 */
function cleanCrossingTriangles(tris) {
	var PREC = 6;

	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	// Step 1) Precompute areas and build edge→[triIndex] map
	var areas = [];
	var edgeToTris = {}; // edgeKey -> [triIndex, ...]
	var triKeys = []; // per-triangle: [vKey0, vKey1, vKey2]

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

	// Step 2) For each over-shared edge, mark smallest-area triangles for removal
	var removeSet = {}; // triIndex -> true
	var overSharedEdgeCount = 0;

	for (var ek in edgeToTris) {
		var triList = edgeToTris[ek];
		if (triList.length <= 2) continue;
		overSharedEdgeCount++;

		// Sort by area descending — keep the 2 largest, mark rest for removal
		var sorted = triList.slice().sort(function (a, b) { return areas[b] - areas[a]; });
		for (var r = 2; r < sorted.length; r++) {
			removeSet[sorted[r]] = true;
		}
	}

	// Step 3) Also remove exact fingerprint duplicates (catches vertex-identical copies)
	var seenFingerprints = {};
	var dupCount = 0;

	for (var j = 0; j < tris.length; j++) {
		if (removeSet[j]) continue; // already marked

		var keys = triKeys[j].slice().sort();
		var fingerprint = keys.join("||");
		if (seenFingerprints[fingerprint]) {
			removeSet[j] = true;
			dupCount++;
		} else {
			seenFingerprints[fingerprint] = true;
		}
	}

	// Step 4) Build result
	var removedCount = Object.keys(removeSet).length;
	if (removedCount === 0) {
		console.log("SurfaceBooleanHelper: cleanCrossingTriangles — no over-shared edges, nothing to clean");
		return tris;
	}

	var result = [];
	for (var k = 0; k < tris.length; k++) {
		if (!removeSet[k]) {
			result.push(tris[k]);
		}
	}

	console.log("SurfaceBooleanHelper: cleanCrossingTriangles — " +
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
 * After boolean merge, triangles from both surfaces can overlap at the
 * intersection seam, creating internal partition walls (visible as stepped
 * faces inside the solid). This function detects and removes them.
 *
 * Detection: Two triangles overlap when:
 *   - Their centroids are within `tolerance` in 3D
 *   - Their normals are nearly anti-parallel (dot product < -0.5)
 *   - They have similar areas (ratio > 0.3)
 *
 * For each overlapping pair, the smaller triangle is removed.
 * If normals are nearly parallel (dot > 0.5) and centroids close, it's a
 * near-duplicate — the smaller one is also removed.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} [tolerance=0.5] - Max centroid distance to consider overlap
 * @returns {Array} Cleaned triangle soup
 */
function removeOverlappingTriangles(tris, tolerance) {
	if (typeof tolerance === "undefined") tolerance = 0.5;

	// Precompute centroids, normals, areas
	var centroids = [];
	var normals = [];
	var areas = [];

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		// Centroid
		centroids.push({
			x: (tri.v0.x + tri.v1.x + tri.v2.x) / 3,
			y: (tri.v0.y + tri.v1.y + tri.v2.y) / 3,
			z: (tri.v0.z + tri.v1.z + tri.v2.z) / 3
		});
		// Normal (unnormalized cross product)
		var ux = tri.v1.x - tri.v0.x, uy = tri.v1.y - tri.v0.y, uz = tri.v1.z - tri.v0.z;
		var vx = tri.v2.x - tri.v0.x, vy = tri.v2.y - tri.v0.y, vz = tri.v2.z - tri.v0.z;
		var nx = uy * vz - uz * vy;
		var ny = uz * vx - ux * vz;
		var nz = ux * vy - uy * vx;
		var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (nLen > 0) { nx /= nLen; ny /= nLen; nz /= nLen; }
		normals.push({ x: nx, y: ny, z: nz });
		// Area
		areas.push(0.5 * nLen);
	}

	// Build spatial grid of centroids
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

	// Find overlapping pairs
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

						// Check centroid distance
						var cdist = dist3(sc, centroids[ti]);
						if (cdist > tolerance) continue;

						// Check area similarity (ratio > 0.3)
						var areaRatio = Math.min(areas[si], areas[ti]) / Math.max(areas[si], areas[ti]);
						if (areaRatio < 0.3) continue;

						// Check normal relationship
						var dot = normals[si].x * normals[ti].x +
							normals[si].y * normals[ti].y +
							normals[si].z * normals[ti].z;

						if (dot < -0.5) {
							// Anti-parallel normals → internal wall pair
							// Remove the smaller triangle
							if (areas[si] <= areas[ti]) {
								removeSet[si] = true;
							} else {
								removeSet[ti] = true;
							}
							overlapCount++;
						} else if (dot > 0.5) {
							// Parallel normals, close centroids → near-duplicate
							// Remove the smaller triangle
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
		console.log("SurfaceBooleanHelper: removeOverlappingTriangles — no overlaps found (tol=" + tolerance.toFixed(3) + ")");
		return tris;
	}

	var result = [];
	for (var ri = 0; ri < tris.length; ri++) {
		if (!removeSet[ri]) result.push(tris[ri]);
	}

	console.log("SurfaceBooleanHelper: removeOverlappingTriangles — " +
		"removed " + removedCount + " (" + overlapCount + " anti-parallel, " +
		dupCount + " near-dup), " + result.length + " remain (was " + tris.length + ", tol=" + tolerance.toFixed(3) + ")");

	return result;
}

// ────────────────────────────────────────────────────────
// Boundary vertex weld — close seam gaps by snapping open-edge vertices
// ────────────────────────────────────────────────────────

/**
 * Weld boundary vertices (open-edge endpoints) to nearby boundary vertices
 * using a higher tolerance than the general weld. This closes seam gaps at
 * the intersection without distorting interior geometry.
 *
 * Only vertices on boundary edges (count=1) are candidates for snapping.
 * Interior vertices are untouched.
 *
 * @param {Array} tris - Triangle soup [{v0, v1, v2}, ...]
 * @param {number} tolerance - Max 3D distance to snap boundary vertices
 * @returns {Array} Triangle soup with boundary vertices merged
 */
function weldBoundaryVertices(tris, tolerance) {
	if (tolerance <= 0) return tris;

	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}
	function edgeKey(ka, kb) {
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	// Step 1) Build edge count map and collect boundary vertices
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

	// Collect unique boundary vertex keys and their positions
	var boundaryVerts = {}; // vKey -> {x, y, z}
	for (var ek2 in edgeMap) {
		if (edgeMap[ek2].count === 1) {
			boundaryVerts[edgeMap[ek2].k0] = edgeMap[ek2].v0;
			boundaryVerts[edgeMap[ek2].k1] = edgeMap[ek2].v1;
		}
	}

	var bvKeys = Object.keys(boundaryVerts);
	if (bvKeys.length === 0) return tris;

	// Step 2) Build spatial grid of boundary vertices
	var cellSize = Math.max(tolerance * 2, 0.01);
	var grid = {};
	var tolSq = tolerance * tolerance;

	for (var bi = 0; bi < bvKeys.length; bi++) {
		var bv = boundaryVerts[bvKeys[bi]];
		var gk = Math.floor(bv.x / cellSize) + "," + Math.floor(bv.y / cellSize) + "," + Math.floor(bv.z / cellSize);
		if (!grid[gk]) grid[gk] = [];
		grid[gk].push(bvKeys[bi]);
	}

	// Step 3) Build merge map: for each boundary vertex, find nearest boundary vertex
	// within tolerance. Use union-find to group them into clusters.
	var parent = {};
	for (var pi = 0; pi < bvKeys.length; pi++) {
		parent[bvKeys[pi]] = bvKeys[pi];
	}

	function find(k) {
		while (parent[k] !== k) {
			parent[k] = parent[parent[k]]; // path compression
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

	// Step 4) Compute cluster centroids (average position of merged vertices)
	var clusters = {}; // rootKey -> { sumX, sumY, sumZ, count }
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

	// Build final merge map: original vKey → new position
	var mergeMap = {}; // vKey -> {x, y, z}
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
		console.log("SurfaceBooleanHelper: weldBoundaryVertices — no boundary vertices within tolerance (" +
			tolerance.toFixed(3) + "m), " + bvKeys.length + " boundary verts checked");
		return tris;
	}

	// Step 5) Apply merge map to all triangles
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

		// Skip degenerate triangles where merging collapsed vertices
		var k0 = vKey(rv0), k1 = vKey(rv1), k2 = vKey(rv2);
		if (k0 === k1 || k1 === k2 || k0 === k2) {
			collapsed++;
			continue;
		}

		result.push({ v0: rv0, v1: rv1, v2: rv2 });
	}

	console.log("SurfaceBooleanHelper: weldBoundaryVertices — merged " + mergedCount +
		" boundary verts into " + Object.keys(clusters).filter(function (k) { return clusters[k].count > 1; }).length +
		" clusters (tol=" + tolerance.toFixed(3) + "m), " + collapsed + " collapsed tris, " +
		result.length + " remain (was " + tris.length + ")");

	return result;
}

// getOrCreateSurfaceLayer imported from LayerHelper.js
