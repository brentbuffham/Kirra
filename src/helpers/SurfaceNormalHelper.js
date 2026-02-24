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
		return { triangles: surface.triangles, flipped: false, message: "No triangles" };
	}

	// Check if surface is closed (watertight)
	var isClosed = typeof window.isSurfaceClosed === "function" && window.isSurfaceClosed(surface);
	if (!isClosed) {
		return {
			triangles: surface.triangles,
			flipped: false,
			message: "Not a closed solid — use Flip or Align instead"
		};
	}

	var vol = computeVolumeFromTris(tris);

	// Positive signed volume = outward normals (CCW convention)
	// Negative signed volume = inward normals
	var currentlyOut = vol > 0;
	var wantOut = direction === "out";

	if (currentlyOut === wantOut) {
		var label = direction === "out" ? "Out" : "In";
		return {
			triangles: surface.triangles,
			flipped: false,
			message: "Already normals " + label
		};
	}

	// Need to flip
	var flipped = flipAllNormals(tris);
	var label = direction === "out" ? "Out" : "In";
	return {
		triangles: soupToSurfaceTriangles(flipped),
		flipped: true,
		message: "Flipped to normals " + label
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

	var edgeCount = countUniqueEdges(tris);
	var faceCount = tris.length;
	var xyArea = computeProjectedArea(tris, "xy");
	var yzArea = computeProjectedArea(tris, "yz");
	var xzArea = computeProjectedArea(tris, "xz");
	var surfaceArea = compute3DSurfaceArea(tris);

	// Use existing global functions for volume and closed check
	var volume = 0;
	var isClosed = false;
	if (surface.triangles && surface.triangles.length > 0) {
		volume = computeVolumeFromTris(tris);
		isClosed = typeof window.isSurfaceClosed === "function" && window.isSurfaceClosed(surface);
	}

	var normalDir = classifyNormalDirection(tris, isClosed, volume);

	return {
		name: surface.name || surface.id || "Unknown",
		points: pointCount,
		edges: edgeCount,
		faces: faceCount,
		normalDirection: normalDir,
		xyArea: xyArea,
		yzArea: yzArea,
		xzArea: xzArea,
		surfaceArea: surfaceArea,
		volume: Math.abs(volume),
		closed: isClosed ? "Yes" : "No"
	};
}

/**
 * Count unique edges from triangle soup.
 */
function countUniqueEdges(tris) {
	var edgeSet = {};
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
			edgeSet[ek] = true;
		}
	}

	return Object.keys(edgeSet).length;
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
 * Only includes front-facing triangles (normals facing the projection direction)
 * to avoid double-counting both sides of a closed solid.
 *   XY: faces with normal.z > 0 (looking down from above)
 *   YZ: faces with normal.x > 0 (looking from East)
 *   XZ: faces with normal.y > 0 (looking from North)
 *
 * @param {Array} tris - Triangle soup
 * @param {string} plane - "xy", "yz", or "xz"
 * @returns {number} Projected footprint area
 */
export function computeProjectedArea(tris, plane) {
	var area = 0;

	for (var i = 0; i < tris.length; i++) {
		var v0 = tris[i].v0;
		var v1 = tris[i].v1;
		var v2 = tris[i].v2;

		// Compute face normal to determine facing direction
		var n = triNormal(tris[i]);

		if (plane === "xy") {
			// Only include faces with upward-facing normals (z > 0)
			if (n.z <= 0) continue;
			var cross2d = (v1.x - v0.x) * (v2.y - v0.y) - (v2.x - v0.x) * (v1.y - v0.y);
			area += Math.abs(cross2d) / 2.0;
		} else if (plane === "yz") {
			// Only include faces with normals pointing in +X direction
			if (n.x <= 0) continue;
			var cross2d = (v1.y - v0.y) * (v2.z - v0.z) - (v2.y - v0.y) * (v1.z - v0.z);
			area += Math.abs(cross2d) / 2.0;
		} else if (plane === "xz") {
			// Only include faces with normals pointing in +Y direction
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
 */
function computeVolumeFromTris(tris) {
	if (tris.length === 0) return 0;

	// Translate to local centroid to avoid floating-point issues with large UTM coordinates.
	// The divergence theorem is origin-independent for a perfectly closed mesh,
	// but with tiny gaps the error is proportional to distance from origin.
	// Centering keeps errors proportional to mesh size, not UTM offset.
	var cx = 0, cy = 0, cz = 0;
	var n = tris.length;
	for (var c = 0; c < n; c++) {
		cx += tris[c].v0.x + tris[c].v1.x + tris[c].v2.x;
		cy += tris[c].v0.y + tris[c].v1.y + tris[c].v2.y;
		cz += tris[c].v0.z + tris[c].v1.z + tris[c].v2.z;
	}
	var inv = 1.0 / (n * 3);
	cx *= inv; cy *= inv; cz *= inv;

	var vol = 0;
	for (var i = 0; i < n; i++) {
		var x0 = tris[i].v0.x - cx, y0 = tris[i].v0.y - cy, z0 = tris[i].v0.z - cz;
		var x1 = tris[i].v1.x - cx, y1 = tris[i].v1.y - cy, z1 = tris[i].v1.z - cz;
		var x2 = tris[i].v2.x - cx, y2 = tris[i].v2.y - cy, z2 = tris[i].v2.z - cz;

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
