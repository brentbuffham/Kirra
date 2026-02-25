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
	ensureZUpNormals,
	buildSpatialGrid,
	queryGrid,
	buildSpatialGridOnAxes,
	queryGridOnAxes,
	estimateAvgEdge
} from "./SurfaceIntersectionHelper.js";
import {
	dist3,
	triangleArea3D,
	computeBounds,
	deduplicateSeamVertices,
	weldVertices,
	weldedToSoup,
	removeDegenerateTriangles,
	extractBoundaryLoops,
	cleanCrossingTriangles,
	removeOverlappingTriangles,
	stitchByProximity,
	triangulateLoop,
	logBoundaryStats,
	capBoundaryLoops,
	capBoundaryLoopsSequential,
	forceCloseIndexedMesh,
	weldBoundaryVertices
} from "./MeshRepairHelper.js";

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
// Ray-casting inside/outside classification
// ────────────────────────────────────────────────────────

/**
 * Classify a point on a single axis by casting rays in both +/- directions.
 *
 * For each axis (z, x, y), does barycentric test in the appropriate 2D projection:
 *   axis='z': project to XY, count hits above/below in Z
 *   axis='x': project to YZ, count hits in +X/-X
 *   axis='y': project to XZ, count hits in +Y/-Y
 *
 * @param {{x,y,z}} point
 * @param {Array} otherTris
 * @param {Object} grid - spatial grid for the relevant 2D projection
 * @param {number} cellSize
 * @param {string} axis - 'z', 'x', or 'y'
 * @returns {{countPos: number, countNeg: number}}
 */
function classifyPointOnAxis(point, otherTris, grid, cellSize, axis) {
	var countPos = 0;

	// Pick the 2 projection axes (a, b) and the ray axis (r)
	var pa, pb, pr;
	var candidates;

	if (axis === "z") {
		pa = point.x; pb = point.y; pr = point.z;
		var bb = { minX: pa, maxX: pa, minY: pb, maxY: pb };
		candidates = queryGrid(grid, bb, cellSize);
	} else {
		// For x-axis ray: grid is on YZ, query at (point.y, point.z)
		// For y-axis ray: grid is on XZ, query at (point.x, point.z)
		if (axis === "x") {
			pa = point.y; pb = point.z; pr = point.x;
		} else {
			pa = point.x; pb = point.z; pr = point.y;
		}
		candidates = queryGridOnAxes(grid, pa, pb, cellSize);
	}

	for (var c = 0; c < candidates.length; c++) {
		var tri = otherTris[candidates[c]];

		// Extract the 2 projection coords + ray coord for each vertex
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

		// Barycentric test in (a, b) projection
		var d = (b1 - b2) * (a0 - a2) + (a2 - a1) * (b0 - b2);
		if (Math.abs(d) < 1e-12) continue; // degenerate projection

		var u = ((b1 - b2) * (pa - a2) + (a2 - a1) * (pb - b2)) / d;
		var v = ((b2 - b0) * (pa - a2) + (a0 - a2) * (pb - b2)) / d;
		var w = 1 - u - v;

		if (u < -1e-10 || v < -1e-10 || w < -1e-10) continue; // outside triangle

		// Interpolate ray-axis coord at (pa, pb) on the triangle's plane
		var rHit = u * r0 + v * r1 + w * r2;

		if (rHit > pr) countPos++;
	}

	return countPos;
}

/**
 * Multi-axis point classification using majority vote across all 3 axes.
 *
 * Casts +Z, +X, and +Y rays and classifies by majority vote:
 *   - Each axis with hits > 0 votes: odd count → inside, even count → outside
 *   - If 2+ axes vote "inside" → inside (handles any wall angle)
 *   - If only 1 axis votes "inside" and 1+ vote "outside" → outside (prevents false positives)
 *   - If only 1 axis has hits at all → trust that single result
 *   - If 0 axes have hits → outside
 *
 * This handles any geometry angle (0°–90° walls) without thresholds.
 *
 * @param {{x,y,z}} point
 * @param {Array} otherTris
 * @param {Object} grids - { xy: {grid, cellSize}, yz: {grid, cellSize}, xz: {grid, cellSize} }
 * @returns {number} 1 = inside, -1 = outside
 */
function classifyPointMultiAxis(point, otherTris, grids) {
	var zCount = classifyPointOnAxis(point, otherTris, grids.xy.grid, grids.xy.cellSize, "z");
	var xCount = classifyPointOnAxis(point, otherTris, grids.yz.grid, grids.yz.cellSize, "x");
	var yCount = classifyPointOnAxis(point, otherTris, grids.xz.grid, grids.xz.cellSize, "y");

	var insideVotes = 0;
	var outsideVotes = 0;

	if (zCount > 0) {
		if (zCount % 2 === 1) insideVotes++;
		else outsideVotes++;
	}
	if (xCount > 0) {
		if (xCount % 2 === 1) insideVotes++;
		else outsideVotes++;
	}
	if (yCount > 0) {
		if (yCount % 2 === 1) insideVotes++;
		else outsideVotes++;
	}

	// Majority vote: 2+ inside → inside; otherwise outside
	if (insideVotes >= 2) return 1;
	if (outsideVotes >= 1) return -1;

	// Only one axis had hits and it voted inside — trust it
	if (insideVotes === 1) return 1;

	// No axes had any hits → outside
	return -1;
}

/**
 * Classify triangles using flood fill from intersection boundary.
 *
 * Non-crossed triangles are partitioned into connected components via shared
 * edges (excluding edges shared with crossed triangles). Each component is
 * classified by a single seed triangle using multi-axis ray casting against
 * the other surface, then that classification is propagated to the entire
 * component.
 *
 * @param {Array} tris - Triangle soup to classify
 * @param {Object} crossedMap - Map of triIndex -> [taggedSegments]
 * @param {Array} otherTris - Other surface triangles
 * @param {Object} otherGrids - { xy: {grid, cellSize}, yz: {grid, cellSize}, xz: {grid, cellSize} }
 * @returns {Int8Array} Classification per triangle: 1=inside, -1=outside
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

/**
 * Separate triangles into inside/outside groups.
 * Non-crossed triangles go directly by classification.
 * Crossed (straddling) triangles are split first, then each sub-triangle
 * classified via multi-axis ray casting against the other surface.
 *
 * @param {Array} tris - Triangle soup
 * @param {Int8Array} classifications - Per-triangle classification
 * @param {Object} crossedMap - Map of triIndex -> [taggedSegments]
 * @param {Array} otherTris - Other surface triangles
 * @param {Object} otherGrids - { xy: {grid, cellSize}, yz: {grid, cellSize}, xz: {grid, cellSize} }
 * @returns {{ inside: Array, outside: Array }}
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
 *   3) Build crossed triangle sets from intersection tags
 *   4) Build spatial grids + pre-compute data for signed-distance
 *   5) Flood-fill classify: connected non-crossed regions get one seed classification
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

	// Step 3) Build crossed triangle sets from tagged segments
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

	// Step 4) Build spatial grids for multi-axis ray-cast classification
	//   3 grids per surface: XY (Z-ray), YZ (X-ray), XZ (Y-ray)
	var avgEdgeA = estimateAvgEdge(trisA);
	var avgEdgeB = estimateAvgEdge(trisB);
	var cellSizeA = Math.max(avgEdgeA * 2, 0.1);
	var cellSizeB = Math.max(avgEdgeB * 2, 0.1);

	var gridsA = {
		xy: { grid: buildSpatialGrid(trisA, cellSizeA), cellSize: cellSizeA },
		yz: { grid: buildSpatialGridOnAxes(trisA, cellSizeA, function(v) { return v.y; }, function(v) { return v.z; }), cellSize: cellSizeA },
		xz: { grid: buildSpatialGridOnAxes(trisA, cellSizeA, function(v) { return v.x; }, function(v) { return v.z; }), cellSize: cellSizeA }
	};
	var gridsB = {
		xy: { grid: buildSpatialGrid(trisB, cellSizeB), cellSize: cellSizeB },
		yz: { grid: buildSpatialGridOnAxes(trisB, cellSizeB, function(v) { return v.y; }, function(v) { return v.z; }), cellSize: cellSizeB },
		xz: { grid: buildSpatialGridOnAxes(trisB, cellSizeB, function(v) { return v.x; }, function(v) { return v.z; }), cellSize: cellSizeB }
	};

	// Step 5) Flood-fill classify: each connected non-crossed region gets one seed.
	// Seed classification uses majority vote across all 3 axes (+Z, +X, +Y) —
	// handles any wall angle without thresholds.
	var classA = classifyByFloodFill(trisA, crossedSetA, trisB, gridsB);
	var classB = classifyByFloodFill(trisB, crossedSetB, trisA, gridsA);

	// Step 6) Split straddling triangles and classify sub-triangles.
	// Sub-triangles inherit classification from adjacent non-crossed triangles
	// via vertex adjacency (no ray-casting at the boundary).
	var groupsA = splitStraddlingAndClassify(trisA, classA, crossedSetA, trisB, gridsB);
	var groupsB = splitStraddlingAndClassify(trisB, classB, crossedSetB, trisA, gridsA);

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
 * Re-triangulate a crossed triangle by inserting all intersection segment
 * endpoints as Steiner points and running Constrained Delaunay Triangulation.
 *
 * This handles the case where a large triangle is crossed by many small
 * triangles on the other surface — producing many short segments whose
 * endpoints lie interior to the large triangle. The old merge-two-endpoints
 * approach failed for these cases.
 *
 * Steps:
 *   1. Build local 2D frame + barycentric validator
 *   2. Collect unique segment endpoints, validate inside triangle
 *   3. Run Delaunator, constrain segment edges (NOT boundary edges)
 *   4. Filter sub-triangles by barycentric centroid test + area check
 *
 * @param {Object} tri - {v0, v1, v2}
 * @param {Array} segments - Array of {p0, p1, ...} from Moller intersection
 * @returns {Array} Sub-triangles [{v0, v1, v2}, ...] or [tri] on failure
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

/**
 * Split a single triangle by a single intersection segment.
 * Finds where the segment line crosses the triangle edges,
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
 * 2D line-segment intersection test.
 * Returns {t, u} where t is parameter on segment AB and u is parameter on line CD.
 * Returns null if parallel or t not in [0,1].
 * t is bounded to [0,1] (crossing must be on the triangle edge).
 * u is unbounded (line extension of CD finds triangle edge crossings).
 * Sliver prevention is handled upstream by merging segments before splitting.
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
	if (t < -1e-10 || t > 1.0 + 1e-10) return null;

	// u is unbounded — we use the line extension of CD to find triangle edge crossings.
	// Sliver prevention is handled upstream by merging segments before splitting.

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
			child.material.opacity = kept ? 0.15 : 0.05;
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
 * Merge kept splits into a new surface and store it.
 */
export function applyMerge(splits, config) {
	// Abort if WebGL context already lost
	if (window.threeRenderer && window.threeRenderer.contextLost) {
		console.error("SurfaceBooleanHelper: WebGL context lost — aborting merge");
		return null;
	}

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

	// Trigger redraw (skip 3D render if WebGL context was lost during operation)
	window.threeKADNeedsRebuild = true;
	if (window.threeRenderer && window.threeRenderer.contextLost) {
		console.warn("SurfaceBooleanHelper: WebGL context lost during operation — surface saved but 3D render skipped");
	} else if (typeof window.drawData === "function") {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}

	console.log("SurfaceBooleanHelper: applied " + surfaceId + " (" + triangles.length + " triangles)");
	return surfaceId;
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
		opacity: visible ? 0.15 : 0.05,
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



// getOrCreateSurfaceLayer imported from LayerHelper.js
// Mesh repair functions imported from MeshRepairHelper.js
