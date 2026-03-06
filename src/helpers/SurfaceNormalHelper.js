/**
 * SurfaceNormalHelper.js
 *
 * Reusable functions for surface normal operations and statistics.
 * Used by TreeView context menu actions (Flip Normals, Align Normals, Statistics).
 */

import {
	extractTriangles,
	triNormal,
	flipAllNormals,
	ensureZUpNormals
} from "./SurfaceIntersectionHelper.js";

/**
 * Flip all normals on a surface's triangles.
 * Returns new triangles array in the surface's original storage format.
 *
 * @param {Object} surface - Surface object from loadedSurfaces
 * @returns {Array} New triangles array with flipped normals
 */
export function flipSurfaceNormals(surface) {
	var tris = extractTriangles(surface);
	var flipped = flipAllNormals(tris);
	return soupToSurfaceTriangles(flipped);
}

/**
 * Align all normals on a surface to Z-up convention.
 * Returns result with count of flipped triangles.
 *
 * @param {Object} surface - Surface object from loadedSurfaces
 * @returns {{ triangles: Array, flippedCount: number, totalCount: number }}
 */
export function alignSurfaceNormals(surface) {
	var tris = extractTriangles(surface);
	var totalCount = tris.length;

	// Count how many need flipping
	var flippedCount = 0;
	for (var i = 0; i < tris.length; i++) {
		var n = triNormal(tris[i]);
		if (n.z < -0.01) {
			flippedCount++;
		}
	}

	var aligned = ensureZUpNormals(tris);
	return {
		triangles: soupToSurfaceTriangles(aligned),
		flippedCount: flippedCount,
		totalCount: totalCount
	};
}

/**
 * Set normals direction on a surface.
 *
 * For closed solids: uses signed volume (divergence theorem) to determine
 * current orientation, then flips if needed.
 *
 * For open surfaces: "in/out" is not meaningful, returns a message
 * suggesting Flip Normals or Align Normals instead.
 *
 * @param {Object} surface - Surface object from loadedSurfaces
 * @param {"out"|"in"} direction - Desired normal direction
 * @returns {{ triangles: Array, flipped: boolean, message: string }}
 */
export function setSurfaceNormalsDirection(surface, direction) {
	var tris = extractTriangles(surface);
	if (tris.length === 0) {
		return { triangles: surface.triangles, flippedCount: 0, message: "No triangles" };
	}

	// Check if surface is closed (watertight)
	var isClosed = typeof window.isSurfaceClosed === "function" && window.isSurfaceClosed(surface);
	if (!isClosed) {
		return {
			triangles: surface.triangles,
			flippedCount: 0,
			message: "Not a closed solid — use Flip or Align instead"
		};
	}

	// Compute centroid for numerical stability (large UTM coords)
	var n = tris.length;
	var cx = 0, cy = 0, cz = 0;
	for (var c = 0; c < n; c++) {
		cx += tris[c].v0.x + tris[c].v1.x + tris[c].v2.x;
		cy += tris[c].v0.y + tris[c].v1.y + tris[c].v2.y;
		cz += tris[c].v0.z + tris[c].v1.z + tris[c].v2.z;
	}
	var inv = 1.0 / (n * 3);
	cx *= inv; cy *= inv; cz *= inv;

	var wantOut = direction === "out";
	var flippedCount = 0;

	// Check each triangle's signed volume contribution individually.
	// Positive contribution = outward-facing normal, negative = inward-facing.
	for (var i = 0; i < n; i++) {
		var t = tris[i];
		var x0 = t.v0.x - cx, y0 = t.v0.y - cy, z0 = t.v0.z - cz;
		var x1 = t.v1.x - cx, y1 = t.v1.y - cy, z1 = t.v1.z - cz;
		var x2 = t.v2.x - cx, y2 = t.v2.y - cy, z2 = t.v2.z - cz;

		var sv = (x0 * (y1 * z2 - y2 * z1)
			- x1 * (y0 * z2 - y2 * z0)
			+ x2 * (y0 * z1 - y1 * z0));

		// sv > 0 means this triangle faces outward, sv < 0 means inward
		var facesOut = sv > 0;
		if (facesOut !== wantOut) {
			// Flip this triangle by swapping v1 and v2
			var tmp = t.v1;
			t.v1 = t.v2;
			t.v2 = tmp;
			flippedCount++;
		}
	}

	var label = direction === "out" ? "Out" : "In";
	return {
		triangles: soupToSurfaceTriangles(tris),
		flippedCount: flippedCount,
		message: flippedCount === 0
			? "Already all normals " + label
			: "Set " + flippedCount + "/" + n + " normals to " + label
	};
}

/**
 * Compute comprehensive statistics for a surface.
 *
 * @param {Object} surface - Surface object from loadedSurfaces
 * @returns {Object} Statistics row object
 */
export function computeSurfaceStatistics(surface) {
	var tris = extractTriangles(surface);
	var pointCount = surface.points ? surface.points.length : 0;

	// If no points array, count unique vertices from triangles
	if (pointCount === 0 && tris.length > 0) {
		var seen = {};
		var PREC = 6;
		for (var i = 0; i < tris.length; i++) {
			var verts = [tris[i].v0, tris[i].v1, tris[i].v2];
			for (var j = 0; j < 3; j++) {
				var key = verts[j].x.toFixed(PREC) + "," + verts[j].y.toFixed(PREC) + "," + verts[j].z.toFixed(PREC);
				seen[key] = true;
			}
		}
		pointCount = Object.keys(seen).length;
	}

	var edgeInfo = countEdges(tris);
	var edgeCount = edgeInfo.total;
	var faceCount = tris.length;
	var surfaceArea = compute3DSurfaceArea(tris);

	// Use existing global functions for volume and closed check
	var volume = 0;
	var isClosed = false;
	var openEdgeCount = edgeInfo.boundary;
	if (surface.triangles && surface.triangles.length > 0) {
		volume = computeVolumeFromTris(tris);
		isClosed = typeof window.isSurfaceClosed === "function" && window.isSurfaceClosed(surface);
	}

	var hasOpenEdges = openEdgeCount > 0;

	// Projected areas: Method B (sum all, /2 for closed) with Method A fallback
	var xyResult = computeProjectedArea(tris, "xy", isClosed, hasOpenEdges);
	var yzResult = computeProjectedArea(tris, "yz", isClosed, hasOpenEdges);
	var xzResult = computeProjectedArea(tris, "xz", isClosed, hasOpenEdges);

	// Log warning if falling back to Method A
	if (isClosed && hasOpenEdges) {
		console.warn("[SurfaceStats] " + (surface.name || surface.id) +
			": Closed with " + openEdgeCount + " open edges — using Method A (normal filtering) for projected area");
	}

	var normalDir = classifyNormalDirection(tris, isClosed, volume);

	return {
		name: surface.name || surface.id || "Unknown",
		points: pointCount,
		edges: edgeCount,
		faces: faceCount,
		normalDirection: normalDir,
		xyArea: xyResult.area,
		yzArea: yzResult.area,
		xzArea: xzResult.area,
		xyAreaMethod: xyResult.method,
		surfaceArea: surfaceArea,
		volume: Math.abs(volume),
		closed: isClosed ? "Yes" : "No",
		openEdgeCount: openEdgeCount
	};
}

/**
 * Count unique edges and open (boundary) edges from triangle soup.
 * An edge shared by exactly 2 triangles is interior (watertight).
 * An edge shared by 1 triangle is a boundary (open) edge.
 * An edge shared by >2 triangles is non-manifold.
 *
 * @returns {{ total: number, boundary: number, nonManifold: number }}
 */
function countEdges(tris) {
	var edgeCounts = {};
	var PREC = 6;

	function vKey(v) {
		return v.x.toFixed(PREC) + "," + v.y.toFixed(PREC) + "," + v.z.toFixed(PREC);
	}

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		var keys = [vKey(verts[0]), vKey(verts[1]), vKey(verts[2])];

		for (var e = 0; e < 3; e++) {
			var ne = (e + 1) % 3;
			var ka = keys[e];
			var kb = keys[ne];
			var ek = ka < kb ? ka + "|" + kb : kb + "|" + ka;
			edgeCounts[ek] = (edgeCounts[ek] || 0) + 1;
		}
	}

	var total = 0, boundary = 0, nonManifold = 0;
	var edgeKeys = Object.keys(edgeCounts);
	total = edgeKeys.length;
	for (var j = 0; j < edgeKeys.length; j++) {
		var count = edgeCounts[edgeKeys[j]];
		if (count === 1) boundary++;
		else if (count > 2) nonManifold++;
	}

	return { total: total, boundary: boundary, nonManifold: nonManifold };
}

/**
 * Classify normal direction of a surface.
 *
 * For closed solids: uses signed volume to determine "Out" (outward-facing)
 * or "In" (inward-facing).
 *
 * For open surfaces: computes area-weighted average normal to determine
 * dominant axis (Z+, Z-, Y+, Y-, X+, X-), or "Aligned" if consistent
 * but not axis-dominant, or "Chaos" if normals are inconsistent.
 *
 * @param {Array} tris - Triangle soup
 * @param {boolean} isClosed - Whether the mesh is closed
 * @param {number} signedVolume - Signed volume from divergence theorem
 * @returns {string} Classification label
 */
export function classifyNormalDirection(tris, isClosed, signedVolume) {
	if (tris.length === 0) return "N/A";

	// Compute area-weighted normal sum and total area
	var sumNx = 0, sumNy = 0, sumNz = 0;
	var totalArea = 0;

	for (var i = 0; i < tris.length; i++) {
		var v0 = tris[i].v0, v1 = tris[i].v1, v2 = tris[i].v2;
		// Cross product (unnormalized) = 2 * area * normal
		var ux = v1.x - v0.x, uy = v1.y - v0.y, uz = v1.z - v0.z;
		var vx = v2.x - v0.x, vy = v2.y - v0.y, vz = v2.z - v0.z;
		var cx = uy * vz - uz * vy;
		var cy = uz * vx - ux * vz;
		var cz = ux * vy - uy * vx;
		var area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
		if (area < 1e-12) continue;

		// Area-weighted normal contribution
		sumNx += cx * 0.5;
		sumNy += cy * 0.5;
		sumNz += cz * 0.5;
		totalArea += area;
	}

	if (totalArea < 1e-12) return "N/A";

	// For closed solids: signed volume determines in/out
	if (isClosed) {
		// Positive signed volume = outward normals (CCW winding convention)
		// Negative = inward normals
		if (signedVolume > 1e-6) return "Out";
		if (signedVolume < -1e-6) return "In";
		// Zero volume closed mesh — fall through to open analysis
	}

	// Consistency = |average_normal| / total_area
	// 1.0 = all normals perfectly aligned, 0.0 = random/cancelling
	var avgLen = Math.sqrt(sumNx * sumNx + sumNy * sumNy + sumNz * sumNz);
	var consistency = avgLen / totalArea;

	if (consistency < 0.15) {
		// Before declaring "Chaos", try signed volume for nearly-closed solids.
		// A mesh with Z+ top and Z- bottom has cancelling normals (low consistency)
		// but a meaningful signed volume that indicates outward/inward orientation.
		if (signedVolume > 1e-6) return isClosed ? "Out" : "~Out";
		if (signedVolume < -1e-6) return isClosed ? "In" : "~In";
		return "Chaos";
	}

	// Normalize the average normal to find dominant axis
	var nx = sumNx / avgLen;
	var ny = sumNy / avgLen;
	var nz = sumNz / avgLen;

	var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);

	// Check if strongly axis-aligned (dominant component > 0.7)
	if (az > 0.7 && az >= ax && az >= ay) {
		return nz > 0 ? "Z+" : "Z-";
	}
	if (ax > 0.7 && ax >= ay && ax >= az) {
		return nx > 0 ? "X+" : "X-";
	}
	if (ay > 0.7 && ay >= ax && ay >= az) {
		return ny > 0 ? "Y+" : "Y-";
	}

	// Consistent but not axis-aligned
	if (consistency > 0.5) return "Aligned";

	return "Chaos";
}

/**
 * Compute projected footprint area onto a plane.
 *
 * Method B (primary) — Projected Triangle Method:
 *   Sum |cross-product component| / 2 for ALL triangles.
 *   For a closed solid, top+bottom+sides all contribute, so divide by 2.
 *   Robust to mixed normals since |cz| is independent of winding direction.
 *
 * Method A (fallback) — Normal-Direction Filtering:
 *   Only count triangles whose normal faces the projection direction.
 *   No /2 correction needed. Used when mesh claims closed but has open edges
 *   (where the /2 in Method B would overcorrect).
 *
 * @param {Array} tris - Triangle soup
 * @param {string} plane - "xy", "yz", or "xz"
 * @param {boolean} isClosed - Whether the mesh is a closed solid
 * @param {boolean} hasOpenEdges - If true and isClosed, falls back to Method A
 * @returns {{ area: number, method: string }} Projected area and method used
 */
export function computeProjectedArea(tris, plane, isClosed, hasOpenEdges) {
	// Fallback to Method A if mesh claims closed but has open edges
	if (isClosed && hasOpenEdges) {
		var areaA = computeProjectedAreaByNormals(tris, plane);
		return { area: areaA, method: "A" };
	}

	// Method B: sum |cross-component|/2 for all triangles
	var area = 0;

	for (var i = 0; i < tris.length; i++) {
		var v0 = tris[i].v0;
		var v1 = tris[i].v1;
		var v2 = tris[i].v2;

		// Edge vectors from v0
		var dx1 = v1.x - v0.x, dy1 = v1.y - v0.y, dz1 = v1.z - v0.z;
		var dx2 = v2.x - v0.x, dy2 = v2.y - v0.y, dz2 = v2.z - v0.z;

		if (plane === "xy") {
			var cz = dx1 * dy2 - dy1 * dx2;
			area += Math.abs(cz) / 2.0;
		} else if (plane === "yz") {
			var cx = dy1 * dz2 - dz1 * dy2;
			area += Math.abs(cx) / 2.0;
		} else if (plane === "xz") {
			var cy = dz1 * dx2 - dx1 * dz2;
			area += Math.abs(cy) / 2.0;
		}
	}

	// For a closed solid, both sides contribute, so divide by 2
	if (isClosed) {
		area /= 2.0;
	}

	return { area: area, method: "B" };
}

/**
 * Method A — Normal-direction filtering (fallback).
 * Only counts triangles whose face normal points toward the projection direction.
 * No /2 correction needed since only one side is counted.
 */
function computeProjectedAreaByNormals(tris, plane) {
	var area = 0;

	for (var i = 0; i < tris.length; i++) {
		var v0 = tris[i].v0;
		var v1 = tris[i].v1;
		var v2 = tris[i].v2;

		var n = triNormal(tris[i]);

		if (plane === "xy") {
			if (n.z <= 0) continue;
			var cross2d = (v1.x - v0.x) * (v2.y - v0.y) - (v2.x - v0.x) * (v1.y - v0.y);
			area += Math.abs(cross2d) / 2.0;
		} else if (plane === "yz") {
			if (n.x <= 0) continue;
			var cross2d = (v1.y - v0.y) * (v2.z - v0.z) - (v2.y - v0.y) * (v1.z - v0.z);
			area += Math.abs(cross2d) / 2.0;
		} else if (plane === "xz") {
			if (n.y <= 0) continue;
			var cross2d = (v1.x - v0.x) * (v2.z - v0.z) - (v2.x - v0.x) * (v1.z - v0.z);
			area += Math.abs(cross2d) / 2.0;
		}
	}

	return area;
}

/**
 * Compute true 3D surface area (sum of actual triangle areas).
 */
export function compute3DSurfaceArea(tris) {
	var area = 0;

	for (var i = 0; i < tris.length; i++) {
		var v0 = tris[i].v0;
		var v1 = tris[i].v1;
		var v2 = tris[i].v2;

		var ux = v1.x - v0.x, uy = v1.y - v0.y, uz = v1.z - v0.z;
		var vx = v2.x - v0.x, vy = v2.y - v0.y, vz = v2.z - v0.z;

		var cx = uy * vz - uz * vy;
		var cy = uz * vx - ux * vz;
		var cz = ux * vy - uy * vx;

		area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
	}

	return area;
}

/**
 * Compute signed mesh volume from triangle soup using divergence theorem.
 *
 * Signed Tetrahedron Method:
 *   Each triangle forms a tetrahedron with the origin.
 *   signedVol = V0 . (V1 x V2) / 6  (scalar triple product)
 *   Sum across all triangles, take abs() for enclosed volume.
 *
 * Step 1) Translate to bounding box midpoint for floating-point precision
 *         with large UTM coordinates (origin-independent for closed meshes,
 *         but centering minimises error for nearly-closed meshes with tiny gaps).
 */
function computeVolumeFromTris(tris) {
	if (tris.length === 0) return 0;

	// Step 1) Compute bounding box midpoint for centering
	var minX = Infinity, minY = Infinity, minZ = Infinity;
	var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	var n = tris.length;
	for (var c = 0; c < n; c++) {
		var t = tris[c];
		var verts = [t.v0, t.v1, t.v2];
		for (var v = 0; v < 3; v++) {
			var p = verts[v];
			if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
			if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
		}
	}
	var ox = (minX + maxX) / 2;
	var oy = (minY + maxY) / 2;
	var oz = (minZ + maxZ) / 2;

	// Step 2) Scalar triple product: V0 . (V1 x V2) / 6
	var vol = 0;
	for (var i = 0; i < n; i++) {
		var x0 = tris[i].v0.x - ox, y0 = tris[i].v0.y - oy, z0 = tris[i].v0.z - oz;
		var x1 = tris[i].v1.x - ox, y1 = tris[i].v1.y - oy, z1 = tris[i].v1.z - oz;
		var x2 = tris[i].v2.x - ox, y2 = tris[i].v2.y - oy, z2 = tris[i].v2.z - oz;

		vol += (x0 * (y1 * z2 - y2 * z1)
			- x1 * (y0 * z2 - y2 * z0)
			+ x2 * (y0 * z1 - y1 * z0)) / 6.0;
	}

	return vol;
}

/**
 * Convert {v0, v1, v2} soup back to {vertices:[...]} format for storage.
 */
function soupToSurfaceTriangles(tris) {
	var result = [];

	for (var i = 0; i < tris.length; i++) {
		result.push({
			vertices: [
				{ x: tris[i].v0.x, y: tris[i].v0.y, z: tris[i].v0.z },
				{ x: tris[i].v1.x, y: tris[i].v1.y, z: tris[i].v1.z },
				{ x: tris[i].v2.x, y: tris[i].v2.y, z: tris[i].v2.z }
			]
		});
	}

	return result;
}
