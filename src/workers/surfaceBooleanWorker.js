/**
 * surfaceBooleanWorker.js - Web Worker for surface boolean operations
 *
 * Handles two operations off the main thread:
 *   1. computeSplits: intersect, classify, split, dedup, propagate normals
 *   2. mergeSplits: mesh repair pipeline (weld, degenerate removal, stitching, capping)
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'computeSplits', payload: { surfaceA, surfaceB } }
 *       surfaceA/B: { id, name, points, triangles }
 *     { type: 'mergeSplits', payload: { splits, config } }
 *       splits: Array of { id, surfaceId, label, triangles, color, kept }
 *       config: { closeMode, snapTolerance, removeDegenerate, ... }
 *
 *   Worker → Main:
 *     { type: 'progress', percent, message }
 *     { type: 'result', data: { ... } }
 *     { type: 'error', message }
 */

import {
	extractTriangles,
	intersectSurfacePairTagged,
	countOpenEdges,
	ensureZUpNormals,
	buildSpatialGrid,
	buildSpatialGridOnAxes,
	queryGrid,
	queryGridOnAxes,
	estimateAvgEdge
} from "../helpers/SurfaceIntersectionHelper.js";

import {
	deduplicateSeamVertices,
	weldVertices,
	weldedToSoup,
	removeDegenerateTriangles,
	cleanCrossingTriangles,
	removeOverlappingTriangles,
	stitchByProximity,
	capBoundaryLoopsSequential,
	forceCloseIndexedMesh,
	logBoundaryStats,
	computeBounds
} from "../helpers/MeshRepairHelper.js";

import Delaunator from "delaunator";
import Constrainautor from "@kninnug/constrainautor";

// ────────────────────────────────────────────────────────
// Vertex/edge key helpers (copied from SurfaceBooleanHelper)
// ────────────────────────────────────────────────────────

var CUT_KEY_PREC = 6;

function cutVKey(v) {
	return v.x.toFixed(CUT_KEY_PREC) + "," + v.y.toFixed(CUT_KEY_PREC) + "," + v.z.toFixed(CUT_KEY_PREC);
}

// ────────────────────────────────────────────────────────
// Jitter offsets for ray-casting
// ────────────────────────────────────────────────────────

var JITTERS = {
	z: [
		{ da: 0.0000537, db: 0.0000241 },
		{ da: -0.0000319, db: 0.0000673 },
		{ da: 0.0000157, db: -0.0000489 }
	],
	x: [
		{ da: 0.0000443, db: -0.0000317 },
		{ da: -0.0000261, db: 0.0000559 },
		{ da: 0.0000189, db: 0.0000371 }
	],
	y: [
		{ da: -0.0000397, db: 0.0000283 },
		{ da: 0.0000521, db: -0.0000447 },
		{ da: -0.0000173, db: 0.0000613 }
	]
};

// ────────────────────────────────────────────────────────
// Ray-casting classification (from SurfaceBooleanHelper)
// ────────────────────────────────────────────────────────

function castRayOnAxis(pa, pb, pr, candidates, otherTris, axis) {
	var countPos = 0;
	for (var c = 0; c < candidates.length; c++) {
		var tri = otherTris[candidates[c]];
		var a0, b0, r0, a1, b1, r1, a2, b2, r2;
		if (axis === "z") {
			a0 = tri.v0.x; b0 = tri.v0.y; r0 = tri.v0.z;
			a1 = tri.v1.x; b1 = tri.v1.y; r1 = tri.v1.z;
			a2 = tri.v2.x; b2 = tri.v2.y; r2 = tri.v2.z;
		} else if (axis === "x") {
			a0 = tri.v0.y; b0 = tri.v0.z; r0 = tri.v0.x;
			a1 = tri.v1.y; b1 = tri.v1.z; r1 = tri.v1.x;
			a2 = tri.v2.y; b2 = tri.v2.z; r2 = tri.v2.x;
		} else {
			a0 = tri.v0.x; b0 = tri.v0.z; r0 = tri.v0.y;
			a1 = tri.v1.x; b1 = tri.v1.z; r1 = tri.v1.y;
			a2 = tri.v2.x; b2 = tri.v2.z; r2 = tri.v2.y;
		}
		var e1a = a1 - a0, e1b = b1 - b0;
		var e2a = a2 - a0, e2b = b2 - b0;
		var det = e1a * e2b - e2a * e1b;
		if (Math.abs(det) < 1e-12) continue;
		var invDet = 1.0 / det;
		var ta = pa - a0, tb = pb - b0;
		var u = (ta * e2b - e2a * tb) * invDet;
		if (u < -1e-6 || u > 1 + 1e-6) continue;
		var v = (e1a * tb - ta * e1b) * invDet;
		if (v < -1e-6 || u + v > 1 + 1e-6) continue;
		var hitR = r0 + u * (r1 - r0) + v * (r2 - r0);
		if (hitR > pr) countPos++;
	}
	return countPos;
}

function classifyPointOnAxis(point, otherTris, grid, cellSize, axis) {
	var pa, pb, pr;
	if (axis === "z") { pa = point.x; pb = point.y; pr = point.z; }
	else if (axis === "x") { pa = point.y; pb = point.z; pr = point.x; }
	else { pa = point.x; pb = point.z; pr = point.y; }

	var jitters = JITTERS[axis];
	var votes = 0;
	for (var j = 0; j < jitters.length; j++) {
		var qa = pa + jitters[j].da;
		var qb = pb + jitters[j].db;
		var candidates;
		if (axis === "z") {
			candidates = queryGrid(grid, { minX: qa, minY: qb, maxX: qa, maxY: qb }, cellSize);
		} else if (axis === "x") {
			candidates = queryGridOnAxes(grid, qa, qb, cellSize);
		} else {
			candidates = queryGridOnAxes(grid, qa, qb, cellSize);
		}
		var hits = castRayOnAxis(qa, qb, pr, candidates, otherTris, axis);
		votes += (hits % 2 === 1) ? 1 : -1;
	}
	return votes > 0 ? 1 : -1;
}

function classifyPointMultiAxis(point, otherTris, grids) {
	var voteZ = classifyPointOnAxis(point, otherTris, grids.xy.grid, grids.xy.cellSize, "z");
	var voteX = classifyPointOnAxis(point, otherTris, grids.yz.grid, grids.yz.cellSize, "x");
	var voteY = classifyPointOnAxis(point, otherTris, grids.xz.grid, grids.xz.cellSize, "y");
	var total = voteZ + voteX + voteY;
	return total > 0 ? 1 : -1;
}

// ────────────────────────────────────────────────────────
// Flood-fill classification
// ────────────────────────────────────────────────────────

function classifyByFloodFill(tris, crossedMap, otherTris, otherGrids) {
	var n = tris.length;
	var classification = new Int8Array(n);
	var PREC = 6;

	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	var adjacency = new Array(n);
	var vertToTris = {};
	for (var i = 0; i < n; i++) {
		adjacency[i] = [];
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		for (var vi = 0; vi < 3; vi++) {
			var key = vKey(verts[vi]);
			if (!vertToTris[key]) vertToTris[key] = [];
			vertToTris[key].push(i);
		}
	}
	for (var key in vertToTris) {
		var group = vertToTris[key];
		for (var a = 0; a < group.length; a++) {
			for (var b = a + 1; b < group.length; b++) {
				adjacency[group[a]].push(group[b]);
				adjacency[group[b]].push(group[a]);
			}
		}
	}

	var visited = new Uint8Array(n);
	for (var seed = 0; seed < n; seed++) {
		if (visited[seed] || crossedMap[seed]) continue;

		var tri = tris[seed];
		var centroid = {
			x: (tri.v0.x + tri.v1.x + tri.v2.x) / 3,
			y: (tri.v0.y + tri.v1.y + tri.v2.y) / 3,
			z: (tri.v0.z + tri.v1.z + tri.v2.z) / 3
		};
		var seedClass = classifyPointMultiAxis(centroid, otherTris, otherGrids);

		var queue = [seed];
		visited[seed] = 1;
		classification[seed] = seedClass;

		while (queue.length > 0) {
			var current = queue.shift();
			var neighbors = adjacency[current];
			for (var ni = 0; ni < neighbors.length; ni++) {
				var nb = neighbors[ni];
				if (visited[nb] || crossedMap[nb]) continue;
				visited[nb] = 1;
				classification[nb] = seedClass;
				queue.push(nb);
			}
		}
	}

	return classification;
}

// ────────────────────────────────────────────────────────
// Straddling triangle splitting + classification
// ────────────────────────────────────────────────────────

function splitStraddlingAndClassify(tris, classifications, crossedMap, otherTris, otherGrids) {
	var insideList = [];
	var outsideList = [];

	var vertexClassMap = {};
	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	for (var i = 0; i < tris.length; i++) {
		if (crossedMap[i]) continue;
		var cls = classifications[i];
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		for (var vi = 0; vi < 3; vi++) {
			var key = vKey(verts[vi]);
			if (!vertexClassMap[key]) vertexClassMap[key] = cls;
		}
	}

	for (var i = 0; i < tris.length; i++) {
		if (!crossedMap[i]) {
			if (classifications[i] >= 0) {
				insideList.push(tris[i]);
			} else {
				outsideList.push(tris[i]);
			}
			continue;
		}

		var subTris = retriangulateWithSteinerPoints(tris[i], crossedMap[i]);

		for (var st = 0; st < subTris.length; st++) {
			var sub = subTris[st];
			var cx = (sub.v0.x + sub.v1.x + sub.v2.x) / 3;
			var cy = (sub.v0.y + sub.v1.y + sub.v2.y) / 3;
			var cz = (sub.v0.z + sub.v1.z + sub.v2.z) / 3;

			var subVerts = [sub.v0, sub.v1, sub.v2];
			var subClass = 0;
			for (var sv = 0; sv < 3; sv++) {
				var sKey = vKey(subVerts[sv]);
				if (vertexClassMap[sKey]) {
					subClass = vertexClassMap[sKey];
					break;
				}
			}

			if (subClass === 0) {
				subClass = classifyPointMultiAxis({ x: cx, y: cy, z: cz }, otherTris, otherGrids);
			}

			if (subClass >= 0) {
				insideList.push(sub);
			} else {
				outsideList.push(sub);
			}
		}
	}

	return { inside: insideList, outside: outsideList };
}

// ────────────────────────────────────────────────────────
// Re-triangulation with Steiner points
// ────────────────────────────────────────────────────────

function retriangulateWithSteinerPoints(tri, segments) {
	if (!segments || segments.length === 0) return [tri];

	var e1x = tri.v1.x - tri.v0.x, e1y = tri.v1.y - tri.v0.y, e1z = tri.v1.z - tri.v0.z;
	var e2x = tri.v2.x - tri.v0.x, e2y = tri.v2.y - tri.v0.y, e2z = tri.v2.z - tri.v0.z;

	var e1Len = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
	if (e1Len < 1e-12) return [tri];
	var lux = e1x / e1Len, luy = e1y / e1Len, luz = e1z / e1Len;

	var lnx = e1y * e2z - e1z * e2y;
	var lny = e1z * e2x - e1x * e2z;
	var lnz = e1x * e2y - e1y * e2x;
	var lnLen = Math.sqrt(lnx * lnx + lny * lny + lnz * lnz);
	if (lnLen < 1e-12) return [tri];

	var lvx = lny * luz - lnz * luy;
	var lvy = lnz * lux - lnx * luz;
	var lvz = lnx * luy - lny * lux;
	var lvLen = Math.sqrt(lvx * lvx + lvy * lvy + lvz * lvz);
	if (lvLen < 1e-12) return [tri];
	lvx /= lvLen; lvy /= lvLen; lvz /= lvLen;

	var lox = tri.v0.x, loy = tri.v0.y, loz = tri.v0.z;

	function toLocal(p) {
		var dx = p.x - lox, dy = p.y - loy, dz = p.z - loz;
		return [dx * lux + dy * luy + dz * luz, dx * lvx + dy * lvy + dz * lvz];
	}

	var l0 = toLocal(tri.v0);
	var l1 = toLocal(tri.v1);
	var l2 = toLocal(tri.v2);

	var triArea2 = Math.abs((l1[0] - l0[0]) * (l2[1] - l0[1]) - (l2[0] - l0[0]) * (l1[1] - l0[1]));
	if (triArea2 < 1e-14) return [tri];

	function baryInside(u, v) {
		var d00 = (l1[0] - l0[0]) * (l1[0] - l0[0]) + (l1[1] - l0[1]) * (l1[1] - l0[1]);
		var d01 = (l1[0] - l0[0]) * (l2[0] - l0[0]) + (l1[1] - l0[1]) * (l2[1] - l0[1]);
		var d11 = (l2[0] - l0[0]) * (l2[0] - l0[0]) + (l2[1] - l0[1]) * (l2[1] - l0[1]);
		var d20 = (u - l0[0]) * (l1[0] - l0[0]) + (v - l0[1]) * (l1[1] - l0[1]);
		var d21 = (u - l0[0]) * (l2[0] - l0[0]) + (v - l0[1]) * (l2[1] - l0[1]);
		var denom = d00 * d11 - d01 * d01;
		if (Math.abs(denom) < 1e-15) return false;
		var bv = (d11 * d20 - d01 * d21) / denom;
		var bw = (d00 * d21 - d01 * d20) / denom;
		var bu = 1.0 - bv - bw;
		var eps = -0.02;
		return bu >= eps && bv >= eps && bw >= eps;
	}

	var allPts = [l0, l1, l2];
	var steinerKeys = {};
	var SPREC = 6;

	for (var si = 0; si < segments.length; si++) {
		var seg = segments[si];
		var ends = [seg.p0, seg.p1];
		for (var ei = 0; ei < 2; ei++) {
			var loc = toLocal(ends[ei]);
			if (!baryInside(loc[0], loc[1])) continue;
			var sKey = loc[0].toFixed(SPREC) + "," + loc[1].toFixed(SPREC);
			if (steinerKeys[sKey]) continue;
			steinerKeys[sKey] = true;
			allPts.push(loc);
		}
	}

	if (allPts.length <= 3) return [tri];

	try {
		var flat = new Float64Array(allPts.length * 2);
		for (var fi = 0; fi < allPts.length; fi++) {
			flat[fi * 2] = allPts[fi][0];
			flat[fi * 2 + 1] = allPts[fi][1];
		}

		var del = new Delaunator(flat);

		var constraintEdges = [];
		for (var si2 = 0; si2 < segments.length; si2++) {
			var seg2 = segments[si2];
			var loc0 = toLocal(seg2.p0);
			var loc1 = toLocal(seg2.p1);

			var idx0 = -1, idx1 = -1;
			var bestD0 = 1e-6, bestD1 = 1e-6;
			for (var pi = 3; pi < allPts.length; pi++) {
				var d0 = Math.abs(allPts[pi][0] - loc0[0]) + Math.abs(allPts[pi][1] - loc0[1]);
				var d1 = Math.abs(allPts[pi][0] - loc1[0]) + Math.abs(allPts[pi][1] - loc1[1]);
				if (d0 < bestD0) { bestD0 = d0; idx0 = pi; }
				if (d1 < bestD1) { bestD1 = d1; idx1 = pi; }
			}
			if (idx0 >= 0 && idx1 >= 0 && idx0 !== idx1) {
				constraintEdges.push([idx0, idx1]);
			}
		}

		if (constraintEdges.length > 0) {
			try {
				var con = new Constrainautor(del);
				for (var ce = 0; ce < constraintEdges.length; ce++) {
					try {
						con.constrainOne(constraintEdges[ce][0], constraintEdges[ce][1]);
					} catch (e) { /* skip failed constraints */ }
				}
				con.delpieces();
			} catch (e) { /* use unconstrained */ }
		}

		var subTris = [];
		for (var ti = 0; ti < del.triangles.length; ti += 3) {
			var i0 = del.triangles[ti];
			var i1 = del.triangles[ti + 1];
			var i2 = del.triangles[ti + 2];

			var cx = (allPts[i0][0] + allPts[i1][0] + allPts[i2][0]) / 3;
			var cy = (allPts[i0][1] + allPts[i1][1] + allPts[i2][1]) / 3;
			if (!baryInside(cx, cy)) continue;

			var area2 = Math.abs(
				(allPts[i1][0] - allPts[i0][0]) * (allPts[i2][1] - allPts[i0][1]) -
				(allPts[i2][0] - allPts[i0][0]) * (allPts[i1][1] - allPts[i0][1])
			);
			if (area2 < triArea2 * 1e-6) continue;

			function to3D(localPt) {
				return {
					x: lox + localPt[0] * lux + localPt[1] * lvx,
					y: loy + localPt[0] * luy + localPt[1] * lvy,
					z: loz + localPt[0] * luz + localPt[1] * lvz
				};
			}

			subTris.push({ v0: to3D(allPts[i0]), v1: to3D(allPts[i1]), v2: to3D(allPts[i2]) });
		}

		return subTris.length > 0 ? subTris : [tri];
	} catch (e) {
		return [tri];
	}
}

// ────────────────────────────────────────────────────────
// Normal propagation
// ────────────────────────────────────────────────────────

function propagateNormals(tris) {
	if (tris.length === 0) return tris;

	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	var adjacency = new Array(tris.length);
	var vertToTris = {};
	for (var i = 0; i < tris.length; i++) {
		adjacency[i] = [];
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		for (var vi = 0; vi < 3; vi++) {
			var key = vKey(verts[vi]);
			if (!vertToTris[key]) vertToTris[key] = [];
			vertToTris[key].push(i);
		}
	}
	for (var key in vertToTris) {
		var group = vertToTris[key];
		for (var a = 0; a < group.length; a++) {
			for (var b = a + 1; b < group.length; b++) {
				adjacency[group[a]].push(group[b]);
				adjacency[group[b]].push(group[a]);
			}
		}
	}

	var result = new Array(tris.length);
	var visited = new Uint8Array(tris.length);

	for (var seed = 0; seed < tris.length; seed++) {
		if (visited[seed]) continue;

		var tri = tris[seed];
		var e1 = { x: tri.v1.x - tri.v0.x, y: tri.v1.y - tri.v0.y, z: tri.v1.z - tri.v0.z };
		var e2 = { x: tri.v2.x - tri.v0.x, y: tri.v2.y - tri.v0.y, z: tri.v2.z - tri.v0.z };
		var nz = e1.x * e2.y - e1.y * e2.x;

		if (nz < 0) {
			result[seed] = { v0: tri.v0, v1: tri.v2, v2: tri.v1 };
		} else {
			result[seed] = tri;
		}
		visited[seed] = 1;

		var queue = [seed];
		while (queue.length > 0) {
			var current = queue.shift();
			var neighbors = adjacency[current];
			for (var ni = 0; ni < neighbors.length; ni++) {
				var nb = neighbors[ni];
				if (visited[nb]) continue;
				visited[nb] = 1;
				result[nb] = tris[nb];
				queue.push(nb);
			}
		}
	}

	return result;
}

// ────────────────────────────────────────────────────────
// No-intersection fallback
// ────────────────────────────────────────────────────────

function buildNoIntersectionResult(trisA, trisB, surfaceIdA, surfaceIdB, nameA, nameB) {
	var splits = [];
	if (trisA.length > 0) {
		splits.push({ id: "A_whole", surfaceId: surfaceIdA, label: nameA + " [whole]", triangles: trisA, color: "#FF0000", kept: true });
	}
	if (trisB.length > 0) {
		splits.push({ id: "B_whole", surfaceId: surfaceIdB, label: nameB + " [whole]", triangles: trisB, color: "#00FF00", kept: true });
	}
	return { splits: splits, surfaceIdA: surfaceIdA, surfaceIdB: surfaceIdB, taggedSegments: [] };
}

// ────────────────────────────────────────────────────────
// Worker message handler
// ────────────────────────────────────────────────────────

self.onmessage = function(e) {
	var msg = e.data;

	function sendProgress(percent, message) {
		self.postMessage({ type: "progress", percent: percent, message: message });
	}

	try {
		if (msg.type === "computeSplits") {
			var payload = msg.payload;
			var surfaceA = payload.surfaceA;
			var surfaceB = payload.surfaceB;

			sendProgress(5, "Extracting triangles...");
			var trisA = extractTriangles(surfaceA);
			var trisB = extractTriangles(surfaceB);

			if (trisA.length === 0 || trisB.length === 0) {
				self.postMessage({ type: "result", data: { error: "One or both surfaces have no triangles" } });
				return;
			}

			sendProgress(10, "Finding intersections (" + trisA.length + " x " + trisB.length + " tris)...");
			var taggedSegments = intersectSurfacePairTagged(trisA, trisB);

			if (taggedSegments.length === 0) {
				sendProgress(100, "No intersection found");
				self.postMessage({
					type: "result",
					data: buildNoIntersectionResult(trisA, trisB, surfaceA.id, surfaceB.id, surfaceA.name || surfaceA.id, surfaceB.name || surfaceB.id)
				});
				return;
			}

			sendProgress(30, taggedSegments.length + " intersection segments, building crossed sets...");
			var crossedSetA = {};
			var crossedSetB = {};
			for (var s = 0; s < taggedSegments.length; s++) {
				var seg = taggedSegments[s];
				if (!crossedSetA[seg.idxA]) crossedSetA[seg.idxA] = [];
				crossedSetA[seg.idxA].push(seg);
				if (!crossedSetB[seg.idxB]) crossedSetB[seg.idxB] = [];
				crossedSetB[seg.idxB].push(seg);
			}

			sendProgress(40, "Building spatial grids...");
			var avgEdgeA = estimateAvgEdge(trisA);
			var avgEdgeB = estimateAvgEdge(trisB);
			var cellSizeA = Math.max(avgEdgeA * 2, 0.1);
			var cellSizeB = Math.max(avgEdgeB * 2, 0.1);

			var getY = function(v) { return v.y; };
			var getZ = function(v) { return v.z; };
			var getX = function(v) { return v.x; };

			var gridsA = {
				xy: { grid: buildSpatialGrid(trisA, cellSizeA), cellSize: cellSizeA },
				yz: { grid: buildSpatialGridOnAxes(trisA, cellSizeA, getY, getZ), cellSize: cellSizeA },
				xz: { grid: buildSpatialGridOnAxes(trisA, cellSizeA, getX, getZ), cellSize: cellSizeA }
			};
			var gridsB = {
				xy: { grid: buildSpatialGrid(trisB, cellSizeB), cellSize: cellSizeB },
				yz: { grid: buildSpatialGridOnAxes(trisB, cellSizeB, getY, getZ), cellSize: cellSizeB },
				xz: { grid: buildSpatialGridOnAxes(trisB, cellSizeB, getX, getZ), cellSize: cellSizeB }
			};

			sendProgress(55, "Classifying triangles (flood fill)...");
			var classA = classifyByFloodFill(trisA, crossedSetA, trisB, gridsB);
			var classB = classifyByFloodFill(trisB, crossedSetB, trisA, gridsA);

			sendProgress(70, "Splitting straddling triangles...");
			var groupsA = splitStraddlingAndClassify(trisA, classA, crossedSetA, trisB, gridsB);
			var groupsB = splitStraddlingAndClassify(trisB, classB, crossedSetB, trisA, gridsA);

			sendProgress(85, "Deduplicating and propagating normals...");
			if (groupsA.inside.length > 0) groupsA.inside = deduplicateSeamVertices(groupsA.inside, 1e-4);
			if (groupsA.outside.length > 0) groupsA.outside = deduplicateSeamVertices(groupsA.outside, 1e-4);
			if (groupsB.inside.length > 0) groupsB.inside = deduplicateSeamVertices(groupsB.inside, 1e-4);
			if (groupsB.outside.length > 0) groupsB.outside = deduplicateSeamVertices(groupsB.outside, 1e-4);

			if (groupsA.inside.length > 0) groupsA.inside = propagateNormals(groupsA.inside);
			if (groupsA.outside.length > 0) groupsA.outside = propagateNormals(groupsA.outside);
			if (groupsB.inside.length > 0) groupsB.inside = propagateNormals(groupsB.inside);
			if (groupsB.outside.length > 0) groupsB.outside = propagateNormals(groupsB.outside);

			sendProgress(95, "Building split groups...");
			var nameA = surfaceA.name || surfaceA.id;
			var nameB = surfaceB.name || surfaceB.id;
			var splits = [];

			if (groupsA.inside.length > 0) splits.push({ id: "A_inside", surfaceId: surfaceA.id, label: nameA + " [inside]", triangles: groupsA.inside, color: "#FF0000", kept: true });
			if (groupsA.outside.length > 0) splits.push({ id: "A_outside", surfaceId: surfaceA.id, label: nameA + " [outside]", triangles: groupsA.outside, color: "#FF8800", kept: true });
			if (groupsB.inside.length > 0) splits.push({ id: "B_inside", surfaceId: surfaceB.id, label: nameB + " [inside]", triangles: groupsB.inside, color: "#00FF00", kept: true });
			if (groupsB.outside.length > 0) splits.push({ id: "B_outside", surfaceId: surfaceB.id, label: nameB + " [outside]", triangles: groupsB.outside, color: "#00CCFF", kept: true });

			sendProgress(100, "Complete!");
			self.postMessage({
				type: "result",
				data: {
					splits: splits,
					surfaceIdA: surfaceA.id,
					surfaceIdB: surfaceB.id,
					taggedSegments: taggedSegments
				}
			});

		} else if (msg.type === "mergeSplits") {
			var payload = msg.payload;
			var splits = payload.splits;
			var config = payload.config;

			var closeMode = config.closeMode || "none";
			var snapTol = config.snapTolerance || 0;

			sendProgress(5, "Collecting kept triangles...");
			var keptTriangles = [];
			for (var s = 0; s < splits.length; s++) {
				if (splits[s].kept) {
					for (var t = 0; t < splits[s].triangles.length; t++) {
						keptTriangles.push(splits[s].triangles[t]);
					}
				}
			}

			if (keptTriangles.length === 0) {
				self.postMessage({ type: "result", data: { error: "No triangles kept" } });
				return;
			}

			var removeDegenerate = config.removeDegenerate !== false;
			var removeSlivers = !!config.removeSlivers;
			var cleanCrossings = !!config.cleanCrossings;
			var sliverRatio = config.sliverRatio || 0.01;
			var minArea = config.minArea || 1e-6;

			// Seam dedup
			sendProgress(10, "Deduplicating seams...");
			var soup = closeMode === "raw" ? keptTriangles : deduplicateSeamVertices(keptTriangles, 1e-4);

			// Weld
			sendProgress(20, "Welding vertices...");
			var welded = weldVertices(soup, snapTol);
			soup = weldedToSoup(welded.triangles);

			// Degenerate removal
			if (removeDegenerate || removeSlivers) {
				sendProgress(30, "Removing degenerates...");
				var effectiveSliver = removeSlivers ? sliverRatio : 0;
				soup = removeDegenerateTriangles(soup, minArea, effectiveSliver);
			}

			// Clean crossings
			if (cleanCrossings) {
				sendProgress(40, "Cleaning crossings...");
				var prevLen = soup.length + 1;
				var cleanPass = 0;
				while (soup.length < prevLen && cleanPass < 5) {
					prevLen = soup.length;
					soup = cleanCrossingTriangles(soup);
					if (removeDegenerate || removeSlivers) {
						soup = removeDegenerateTriangles(soup, minArea, removeSlivers ? sliverRatio : 0);
					}
					cleanPass++;
				}
			}

			// Remove overlapping
			if (config.removeOverlapping) {
				sendProgress(50, "Removing overlaps...");
				soup = removeOverlappingTriangles(soup, config.overlapTolerance || 0.5);
			}

			// Stitch
			if (closeMode === "stitch") {
				sendProgress(55, "Stitching boundaries...");
				var stitchTris = stitchByProximity(soup, config.stitchTolerance || 1.0);
				for (var st = 0; st < stitchTris.length; st++) soup.push(stitchTris[st]);
			}

			// Final weld
			sendProgress(65, "Final weld...");
			var finalWelded = weldVertices(soup, snapTol);
			var worldPoints = finalWelded.points;
			var triangles = finalWelded.triangles;

			// Sequential capping (stitch mode)
			if (closeMode === "stitch") {
				sendProgress(75, "Capping boundaries...");
				var postSoup = weldedToSoup(triangles);
				postSoup = capBoundaryLoopsSequential(postSoup, snapTol, 3);
				var cappedWeld = weldVertices(postSoup, snapTol);
				worldPoints = cappedWeld.points;
				triangles = cappedWeld.triangles;

				// Post-cap cleanup
				sendProgress(85, "Post-cap cleanup...");
				var postCapSoup = weldedToSoup(triangles);
				var postCapChanged = false;
				var postCapStats = countOpenEdges(postCapSoup);
				if (postCapStats.overShared > 0) {
					postCapSoup = cleanCrossingTriangles(postCapSoup);
					postCapChanged = true;
				}
				if (config.removeOverlapping) {
					var preCount = postCapSoup.length;
					postCapSoup = removeOverlappingTriangles(postCapSoup, config.overlapTolerance || 0.5);
					if (postCapSoup.length < preCount) postCapChanged = true;
				}
				if (removeDegenerate || removeSlivers) {
					var preCount2 = postCapSoup.length;
					postCapSoup = removeDegenerateTriangles(postCapSoup, minArea, removeSlivers ? sliverRatio : 0);
					if (postCapSoup.length < preCount2) postCapChanged = true;
				}
				if (postCapChanged) {
					var postCapWeld = weldVertices(postCapSoup, snapTol);
					worldPoints = postCapWeld.points;
					triangles = postCapWeld.triangles;
				}

				// Safety net
				var safetyCheckSoup = weldedToSoup(triangles);
				var safetyStats = countOpenEdges(safetyCheckSoup);
				if (safetyStats.openEdges > 0) {
					var forceClosed = forceCloseIndexedMesh(worldPoints, triangles);
					worldPoints = forceClosed.points;
					triangles = forceClosed.triangles;
				}
			}

			// Compute bounds
			var bounds = computeBounds(worldPoints);

			sendProgress(100, "Complete!");
			self.postMessage({
				type: "result",
				data: {
					resultType: "merge",
					worldPoints: worldPoints,
					triangles: triangles,
					meshBounds: bounds
				}
			});

		} else {
			self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
		}
	} catch (err) {
		self.postMessage({ type: "error", message: err.message || String(err) });
	}
};
