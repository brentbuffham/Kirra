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
// Ray-casting classification (exact copy from SurfaceBooleanHelper)
// ────────────────────────────────────────────────────────

/**
 * Cast a single ray on one axis and count positive-direction hits.
 */
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

		var d = (b1 - b2) * (a0 - a2) + (a2 - a1) * (b0 - b2);
		if (Math.abs(d) < 1e-12) continue;

		var u = ((b1 - b2) * (pa - a2) + (a2 - a1) * (pb - b2)) / d;
		var v = ((b2 - b0) * (pa - a2) + (a0 - a2) * (pb - b2)) / d;
		var w = 1 - u - v;

		if (u < -1e-10 || v < -1e-10 || w < -1e-10) continue;

		var rHit = u * r0 + v * r1 + w * r2;
		if (rHit > pr) countPos++;
	}

	return countPos;
}

/**
 * Classify a point on a single axis by casting 3 jittered rays and taking
 * the majority vote.
 * @returns {number} 0 = no hits (no vote), 1 = inside (odd majority), 2 = outside (even majority)
 */
function classifyPointOnAxis(point, otherTris, grid, cellSize, axis) {
	var basePa, basePb, pr;
	if (axis === "z") {
		basePa = point.x; basePb = point.y; pr = point.z;
	} else if (axis === "x") {
		basePa = point.y; basePb = point.z; pr = point.x;
	} else {
		basePa = point.x; basePb = point.z; pr = point.y;
	}

	var jitters = JITTERS[axis];
	var insideVotes = 0;
	var hadHits = 0;

	for (var j = 0; j < 3; j++) {
		var pa = basePa + jitters[j].da;
		var pb = basePb + jitters[j].db;

		var candidates;
		if (axis === "z") {
			candidates = queryGrid(grid, { minX: pa, maxX: pa, minY: pb, maxY: pb }, cellSize);
		} else {
			candidates = queryGridOnAxes(grid, pa, pb, cellSize);
		}

		var count = castRayOnAxis(pa, pb, pr, candidates, otherTris, axis);

		if (count > 0) hadHits++;
		if (count % 2 === 1) insideVotes++;
	}

	// 3-state return: 0 = no hits (no vote), 1 = inside, 2 = outside
	if (hadHits === 0) return 0;
	return insideVotes >= 2 ? 1 : 2;
}

/**
 * Multi-axis point classification using majority vote across all 3 axes.
 * @returns {number} 1 = inside, -1 = outside
 */
function classifyPointMultiAxis(point, otherTris, grids) {
	var zCount = classifyPointOnAxis(point, otherTris, grids.xy.grid, grids.xy.cellSize, "z");
	var xCount = classifyPointOnAxis(point, otherTris, grids.yz.grid, grids.yz.cellSize, "x");
	var yCount = classifyPointOnAxis(point, otherTris, grids.xz.grid, grids.xz.cellSize, "y");

	// 0 = no hits (no vote), 1 = inside, 2 = outside
	var insideVotes = 0;
	var outsideVotes = 0;

	if (zCount === 1) insideVotes++;
	else if (zCount === 2) outsideVotes++;

	if (xCount === 1) insideVotes++;
	else if (xCount === 2) outsideVotes++;

	if (yCount === 1) insideVotes++;
	else if (yCount === 2) outsideVotes++;

	// Majority vote: 2+ inside → inside; otherwise outside
	if (insideVotes >= 2) return 1;
	if (outsideVotes >= 1) return -1;

	// Only one axis had hits and it voted inside — trust it
	if (insideVotes === 1) return 1;

	// No axes had any hits → outside
	return -1;
}

// ────────────────────────────────────────────────────────
// Flood-fill classification (exact copy from SurfaceBooleanHelper)
// ────────────────────────────────────────────────────────

/**
 * Classify triangles using flood fill from intersection boundary.
 *
 * Non-crossed triangles are partitioned into connected components via shared
 * edges (excluding edges shared with crossed triangles). Each component is
 * classified by a single seed triangle using multi-axis ray casting against
 * the other surface, then that classification is propagated to the entire
 * component.
 */
function classifyByFloodFill(tris, crossedMap, otherTris, otherGrids) {
	var n = tris.length;
	var result = new Int8Array(n);

	// Build edge adjacency for non-crossed triangles only
	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	var edgeToTris = {};
	for (var i = 0; i < n; i++) {
		if (crossedMap[i]) continue; // skip crossed triangles
		var tri = tris[i];
		var k0 = vKey(tri.v0), k1 = vKey(tri.v1), k2 = vKey(tri.v2);
		var edges = [
			k0 < k1 ? k0 + "|" + k1 : k1 + "|" + k0,
			k1 < k2 ? k1 + "|" + k2 : k2 + "|" + k1,
			k2 < k0 ? k2 + "|" + k0 : k0 + "|" + k2
		];
		for (var e = 0; e < 3; e++) {
			if (!edgeToTris[edges[e]]) edgeToTris[edges[e]] = [];
			edgeToTris[edges[e]].push(i);
		}
	}

	// Build neighbor list from shared edges (non-crossed only)
	var neighbors = new Array(n);
	for (var ni = 0; ni < n; ni++) neighbors[ni] = [];

	for (var ek in edgeToTris) {
		var triList = edgeToTris[ek];
		for (var a = 0; a < triList.length; a++) {
			for (var b = a + 1; b < triList.length; b++) {
				neighbors[triList[a]].push(triList[b]);
				neighbors[triList[b]].push(triList[a]);
			}
		}
	}

	// BFS flood fill — find connected components, classify each by one seed
	var visited = new Uint8Array(n);
	var componentCount = 0;

	for (var seed = 0; seed < n; seed++) {
		if (visited[seed] || crossedMap[seed]) continue;

		// Classify seed via multi-axis ray casting against other surface
		var seedTri = tris[seed];
		var cx = (seedTri.v0.x + seedTri.v1.x + seedTri.v2.x) / 3;
		var cy = (seedTri.v0.y + seedTri.v1.y + seedTri.v2.y) / 3;
		var cz = (seedTri.v0.z + seedTri.v1.z + seedTri.v2.z) / 3;
		var seedClass = classifyPointMultiAxis(
			{ x: cx, y: cy, z: cz },
			otherTris, otherGrids
		);

		// BFS: propagate seed classification to entire component
		var queue = [seed];
		visited[seed] = 1;
		result[seed] = seedClass;

		var head = 0;
		while (head < queue.length) {
			var curr = queue[head++];
			var nbrs = neighbors[curr];
			for (var ni2 = 0; ni2 < nbrs.length; ni2++) {
				var nb = nbrs[ni2];
				if (!visited[nb]) {
					visited[nb] = 1;
					result[nb] = seedClass;
					queue.push(nb);
				}
			}
		}

		componentCount++;
	}

	console.log("classifyByFloodFill: " + componentCount + " connected components in " + n + " triangles");
	return result;
}

// ────────────────────────────────────────────────────────
// Straddling triangle splitting + classification (exact copy from SurfaceBooleanHelper)
// ────────────────────────────────────────────────────────

/**
 * Separate triangles into inside/outside groups.
 * Non-crossed triangles go directly by classification.
 * Crossed (straddling) triangles are split first, then each sub-triangle
 * classified via multi-axis ray casting against the other surface.
 */
function splitStraddlingAndClassify(tris, classifications, crossedMap, otherTris, otherGrids) {
	var inside = [];
	var outside = [];

	var PREC = 6;
	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	// Step A: Build vertex-key → classification map from NON-CROSSED triangles.
	// Each original mesh vertex that belongs to at least one non-crossed triangle
	// gets the flood-fill classification of that triangle.
	var vertexClassMap = {};
	for (var i = 0; i < tris.length; i++) {
		if (crossedMap[i]) continue; // skip crossed triangles
		var cls = classifications[i];
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		for (var vi = 0; vi < 3; vi++) {
			var key = vKey(verts[vi]);
			if (vertexClassMap[key] === undefined) {
				vertexClassMap[key] = cls;
			}
		}
	}

	// Step B: Collect all Steiner point keys (intersection segment endpoints).
	// These vertices lie ON the intersection line — skip them for classification.
	var steinerKeys = {};
	for (var ci in crossedMap) {
		var segs = crossedMap[ci];
		for (var s = 0; s < segs.length; s++) {
			steinerKeys[vKey(segs[s].p0)] = true;
			steinerKeys[vKey(segs[s].p1)] = true;
		}
	}

	// Step C: Process each triangle
	var adjacencyHits = 0;
	var raycastFallbacks = 0;

	for (var ti = 0; ti < tris.length; ti++) {
		if (!crossedMap[ti]) {
			// Non-crossed: use pre-computed flood-fill classification
			if (classifications[ti] === 1) {
				inside.push(tris[ti]);
			} else {
				outside.push(tris[ti]);
			}
			continue;
		}

		// Crossed triangle: re-triangulate with intersection segment endpoints
		var segments = crossedMap[ti];
		var current = retriangulateWithSteinerPoints(tris[ti], segments);

		// Classify each sub-triangle by vertex adjacency:
		// Find the vertex NOT on the intersection line, then inherit classification
		// from the adjacent non-crossed triangle that shares that vertex.
		for (var j = 0; j < current.length; j++) {
			var sub = current[j];
			var subVerts = [sub.v0, sub.v1, sub.v2];

			// Look for a "free" vertex (not a Steiner point) that has a
			// known classification from an adjacent non-crossed triangle
			var foundClass = 0;
			for (var sv = 0; sv < 3; sv++) {
				var svKey = vKey(subVerts[sv]);
				if (steinerKeys[svKey]) continue; // vertex is ON the intersection line

				var adjClass = vertexClassMap[svKey];
				if (adjClass !== undefined) {
					foundClass = adjClass;
					break;
				}
			}

			if (foundClass !== 0) {
				adjacencyHits++;
			} else {
				// Fallback: no adjacent non-crossed triangle found for any free vertex.
				// This can happen when all original vertices of the parent triangle
				// are shared only by other crossed triangles. Use ray-casting.
				var cx = (sub.v0.x + sub.v1.x + sub.v2.x) / 3;
				var cy = (sub.v0.y + sub.v1.y + sub.v2.y) / 3;
				var cz = (sub.v0.z + sub.v1.z + sub.v2.z) / 3;
				foundClass = classifyPointMultiAxis(
					{ x: cx, y: cy, z: cz },
					otherTris, otherGrids
				);
				raycastFallbacks++;
			}

			if (foundClass === 1) {
				inside.push(sub);
			} else {
				outside.push(sub);
			}
		}
	}

	console.log("splitStraddlingAndClassify: " + adjacencyHits + " sub-tris classified by vertex adjacency, " +
		raycastFallbacks + " by ray-cast fallback");
	return { inside: inside, outside: outside };
}

// ────────────────────────────────────────────────────────
// Re-triangulation with Steiner points (exact copy from SurfaceBooleanHelper)
// ────────────────────────────────────────────────────────

/**
 * Re-triangulate a crossed triangle by inserting all intersection segment
 * endpoints as Steiner points and running Constrained Delaunay Triangulation.
 *
 * Steps:
 *   1. Build local 2D frame + barycentric validator
 *   2. Collect unique segment endpoints, validate inside triangle
 *   3. Run Delaunator, constrain segment edges (NOT boundary edges)
 *   4. Filter sub-triangles by barycentric centroid test + area check
 */
function retriangulateWithSteinerPoints(tri, segments) {
	if (!segments || segments.length === 0) return [tri];

	// ── Step 1: Build local 2D coordinate frame on triangle plane ──

	var e1x = tri.v1.x - tri.v0.x;
	var e1y = tri.v1.y - tri.v0.y;
	var e1z = tri.v1.z - tri.v0.z;
	var e2x = tri.v2.x - tri.v0.x;
	var e2y = tri.v2.y - tri.v0.y;
	var e2z = tri.v2.z - tri.v0.z;

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

	// Project 3D → local 2D
	function toLocal(p) {
		var dx = p.x - lox, dy = p.y - loy, dz = p.z - loz;
		return [dx * lux + dy * luy + dz * luz, dx * lvx + dy * lvy + dz * lvz];
	}

	// Triangle vertices in local 2D
	var l0 = toLocal(tri.v0); // (0, 0) by construction
	var l1 = toLocal(tri.v1);
	var l2 = toLocal(tri.v2);

	// Barycentric coordinate calculator in local 2D
	var baryD = (l1[1] - l2[1]) * (l0[0] - l2[0]) + (l2[0] - l1[0]) * (l0[1] - l2[1]);
	if (Math.abs(baryD) < 1e-12) return [tri]; // degenerate

	// Returns [u, v, w] barycentric coords; inside when all >= 0
	function baryCoords(pu, pv) {
		var u = ((l1[1] - l2[1]) * (pu - l2[0]) + (l2[0] - l1[0]) * (pv - l2[1])) / baryD;
		var v = ((l2[1] - l0[1]) * (pu - l2[0]) + (l0[0] - l2[0]) * (pv - l2[1])) / baryD;
		return [u, v, 1 - u - v];
	}

	// Triangle area in local 2D (for sub-triangle area filtering)
	var triArea2D = Math.abs(baryD) * 0.5;
	var MIN_AREA_RATIO = 1e-8; // discard sub-tris smaller than this fraction of original

	// ── Step 2: Collect unique segment endpoints, validate inside triangle ──

	var PREC = 6;
	var seen = {};
	var v0Key = tri.v0.x.toFixed(PREC) + "," + tri.v0.y.toFixed(PREC) + "," + tri.v0.z.toFixed(PREC);
	var v1Key = tri.v1.x.toFixed(PREC) + "," + tri.v1.y.toFixed(PREC) + "," + tri.v1.z.toFixed(PREC);
	var v2Key = tri.v2.x.toFixed(PREC) + "," + tri.v2.y.toFixed(PREC) + "," + tri.v2.z.toFixed(PREC);
	seen[v0Key] = true;
	seen[v1Key] = true;
	seen[v2Key] = true;

	var BARY_TOL = -1e-4; // allow points slightly outside due to float precision
	var validSteiner = [];

	// Track segment endpoint keys → index in pts array for constraining segment edges
	var keyToIndex = {};
	keyToIndex[v0Key] = 0;
	keyToIndex[v1Key] = 1;
	keyToIndex[v2Key] = 2;

	for (var s = 0; s < segments.length; s++) {
		var seg = segments[s];
		var endpts = [seg.p0, seg.p1];
		for (var e = 0; e < 2; e++) {
			var p = endpts[e];
			var key = p.x.toFixed(PREC) + "," + p.y.toFixed(PREC) + "," + p.z.toFixed(PREC);
			if (seen[key]) continue;
			seen[key] = true;

			// Validate: must be inside the triangle (barycentric check)
			var lp = toLocal(p);
			var bc = baryCoords(lp[0], lp[1]);
			if (bc[0] < BARY_TOL || bc[1] < BARY_TOL || bc[2] < BARY_TOL) {
				continue; // outside triangle — discard
			}

			validSteiner.push({ x: p.x, y: p.y, z: p.z, key: key });
		}
	}

	if (validSteiner.length === 0) return [tri];

	// Build pts array: indices 0,1,2 = original vertices, 3+ = Steiner
	var pts = [
		{ x: tri.v0.x, y: tri.v0.y, z: tri.v0.z },
		{ x: tri.v1.x, y: tri.v1.y, z: tri.v1.z },
		{ x: tri.v2.x, y: tri.v2.y, z: tri.v2.z }
	];
	for (var vi = 0; vi < validSteiner.length; vi++) {
		keyToIndex[validSteiner[vi].key] = pts.length;
		pts.push(validSteiner[vi]);
	}

	// ── Step 3: Project all to local 2D, run Delaunator ──

	var n = pts.length;
	var coords = new Float64Array(n * 2);
	for (var j = 0; j < n; j++) {
		var lj = toLocal(pts[j]);
		coords[j * 2] = lj[0];
		coords[j * 2 + 1] = lj[1];
	}

	var del;
	try {
		del = new Delaunator(coords);
	} catch (de) {
		console.warn("retriangulateWithSteinerPoints: Delaunator failed:", de.message);
		return [tri];
	}

	// Constrain segment edges (NOT boundary edges — those are the convex hull already).
	// Boundary constraints are harmful when Steiner points lie on boundary edges,
	// because constrainOne(0,1) would skip intermediate points on edge 0→1.
	try {
		var con = new Constrainautor(del);
		for (var cs = 0; cs < segments.length; cs++) {
			var cSeg = segments[cs];
			var k0 = cSeg.p0.x.toFixed(PREC) + "," + cSeg.p0.y.toFixed(PREC) + "," + cSeg.p0.z.toFixed(PREC);
			var k1 = cSeg.p1.x.toFixed(PREC) + "," + cSeg.p1.y.toFixed(PREC) + "," + cSeg.p1.z.toFixed(PREC);
			var idx0 = keyToIndex[k0];
			var idx1 = keyToIndex[k1];
			if (idx0 !== undefined && idx1 !== undefined && idx0 !== idx1) {
				try { con.constrainOne(idx0, idx1); } catch (ce2) { /* skip */ }
			}
		}
	} catch (ce) {
		// Constrainautor init failed — unconstrained Delaunator is still usable
	}

	// ── Step 4: Filter sub-triangles by barycentric centroid + area check ──

	var result = [];
	var delTris = del.triangles;
	for (var k = 0; k < delTris.length; k += 3) {
		var a = delTris[k], b = delTris[k + 1], c = delTris[k + 2];

		// Centroid in local 2D
		var cx = (coords[a * 2] + coords[b * 2] + coords[c * 2]) / 3;
		var cy = (coords[a * 2 + 1] + coords[b * 2 + 1] + coords[c * 2 + 1]) / 3;

		// Barycentric centroid test (more tolerant than ray-cast PIP for boundary)
		var cBary = baryCoords(cx, cy);
		if (cBary[0] < -1e-6 || cBary[1] < -1e-6 || cBary[2] < -1e-6) continue;

		// Area check — discard degenerate sub-triangles
		var au = coords[a * 2], av = coords[a * 2 + 1];
		var bu = coords[b * 2], bv = coords[b * 2 + 1];
		var cu = coords[c * 2], cv = coords[c * 2 + 1];
		var subArea = Math.abs((bu - au) * (cv - av) - (cu - au) * (bv - av)) * 0.5;
		if (subArea < triArea2D * MIN_AREA_RATIO) continue;

		result.push({
			v0: pts[a],
			v1: pts[b],
			v2: pts[c]
		});
	}

	if (result.length === 0) {
		console.warn("retriangulateWithSteinerPoints: no sub-triangles inside boundary, returning original");
		return [tri];
	}

	return result;
}

// ────────────────────────────────────────────────────────
// Normal propagation (exact copy from SurfaceBooleanHelper)
// ────────────────────────────────────────────────────────

/**
 * Propagate consistent winding order across a triangle mesh via BFS.
 * If the mesh is manifold (every edge shared by exactly 2 triangles),
 * BFS from a seed triangle and enforce consistent winding by checking
 * shared-edge direction. If not manifold, falls back to ensureZUpNormals.
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
