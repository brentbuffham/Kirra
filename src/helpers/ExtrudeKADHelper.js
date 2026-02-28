/**
 * ExtrudeKADHelper.js
 *
 * Converts closed KAD polygon entities into 3D extruded solids.
 * Builds geometry manually (top cap, bottom cap, side walls) to avoid
 * THREE.ExtrudeGeometry's curveSegments subdivision which corrupts
 * straight-edged polygon triangulation.
 *
 * Geometry is positioned directly in Three.js local coordinates using
 * worldToThreeLocal(), matching the KAD polygon drawing pattern.
 * Handles per-vertex Z (irregular Z polygons) naturally.
 */

import * as THREE from "three";
import Delaunator from "delaunator";
import Constrainautor from "@kninnug/constrainautor";
import { AddSurfaceAction } from "../tools/UndoActions.js";
import { getOrCreateSurfaceLayer } from "./LayerHelper.js";

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Build extruded solid geometry from a closed KAD polygon entity.
 * Geometry is in Three.js local coordinates (same space as KAD polygon lines).
 *
 * @param {Object} entity - KAD entity (must be closed poly with >= 3 points)
 * @param {Object} params - Extrude parameters
 * @param {number} params.depth  - Signed extrusion distance (+ve = up, -ve = down, 0 = flat)
 * @param {number} params.steps  - Vertical subdivisions for side walls
 * @returns {{ geometry: THREE.BufferGeometry, baseZ: number } | null}
 */
export function buildExtrudeGeometry(entity, params) {
	if (!entity || !entity.data || entity.data.length < 3) {
		console.error("ExtrudeKADHelper: Entity must have at least 3 points");
		return null;
	}

	var points = entity.data;
	var n = points.length;

	// Step 1) Convert polygon points to Three.js local coordinates
	var verts = [];
	for (var i = 0; i < n; i++) {
		var local = window.worldToThreeLocal(
			points[i].pointXLocation,
			points[i].pointYLocation
		);
		verts.push({
			x: local.x,
			y: local.y,
			z: points[i].pointZLocation || 0
		});
	}

	// Step 2) Skip duplicate closing vertex if present
	var last = verts[n - 1];
	var first = verts[0];
	if (Math.abs(last.x - first.x) < 0.001 &&
		Math.abs(last.y - first.y) < 0.001 &&
		Math.abs(last.z - first.z) < 0.001) {
		verts.pop();
		n = verts.length;
	}

	if (n < 3) {
		console.error("ExtrudeKADHelper: Need at least 3 unique vertices");
		return null;
	}

	// Step 3) Ensure CCW winding order (required for correct face normals)
	if (!isCounterClockwise(verts)) {
		verts.reverse();
	}

	var baseZ = verts[0].z;
	var signedDepth = params.depth !== undefined && params.depth !== null ? params.depth : -10;
	var steps = Math.max(1, parseInt(params.steps) || 1);

	// Step 4) Triangulate the polygon face using Constrained Delaunay
	var faceIndices = delaunayTriangulatePolygon(verts);

	if (!faceIndices || faceIndices.length === 0) {
		console.error("ExtrudeKADHelper: Triangulation failed");
		return null;
	}

	// Step 5) Build geometry
	var positions = [];

	if (signedDepth === 0) {
		// Flat plane — single face at original Z per vertex
		for (var f = 0; f < faceIndices.length; f++) {
			var a = faceIndices[f][0];
			var b = faceIndices[f][1];
			var c = faceIndices[f][2];
			positions.push(
				verts[a].x, verts[a].y, verts[a].z,
				verts[b].x, verts[b].y, verts[b].z,
				verts[c].x, verts[c].y, verts[c].z
			);
		}
	} else {
		// Solid extrusion: top cap + bottom cap + side walls

		// Top cap (at original Z per vertex)
		// CCW winding viewed from above → outward normal points up
		for (var f = 0; f < faceIndices.length; f++) {
			var a = faceIndices[f][0];
			var b = faceIndices[f][1];
			var c = faceIndices[f][2];
			positions.push(
				verts[a].x, verts[a].y, verts[a].z,
				verts[b].x, verts[b].y, verts[b].z,
				verts[c].x, verts[c].y, verts[c].z
			);
		}

		// Bottom cap (at Z + signedDepth per vertex)
		// Reversed winding → outward normal points down
		for (var f = 0; f < faceIndices.length; f++) {
			var a = faceIndices[f][0];
			var b = faceIndices[f][1];
			var c = faceIndices[f][2];
			positions.push(
				verts[c].x, verts[c].y, verts[c].z + signedDepth,
				verts[b].x, verts[b].y, verts[b].z + signedDepth,
				verts[a].x, verts[a].y, verts[a].z + signedDepth
			);
		}

		// Side walls — subdivided by steps for smoother shading
		for (var i = 0; i < n; i++) {
			var j = (i + 1) % n;
			var topA = verts[i];
			var topB = verts[j];

			for (var s = 0; s < steps; s++) {
				var t0 = s / steps;
				var t1 = (s + 1) / steps;

				// Interpolated Z at each step level
				var zA0 = topA.z + signedDepth * t0;
				var zA1 = topA.z + signedDepth * t1;
				var zB0 = topB.z + signedDepth * t0;
				var zB1 = topB.z + signedDepth * t1;

				// Quad: (A,t0) → (A,t1) → (B,t1) → (B,t0)
				// Triangle 1: topA-step0, topA-step1, topB-step1
				positions.push(
					topA.x, topA.y, zA0,
					topA.x, topA.y, zA1,
					topB.x, topB.y, zB1
				);
				// Triangle 2: topA-step0, topB-step1, topB-step0
				positions.push(
					topA.x, topA.y, zA0,
					topB.x, topB.y, zB1,
					topB.x, topB.y, zB0
				);
			}
		}
	}

	// Step 6) Ensure outward normals — compute signed volume of the triangle soup.
	// Positive signed volume = outward normals (CCW convention).
	// If negative, reverse every triangle's winding order.
	if (signedDepth !== 0) {
		var vol = 0;
		for (var vi = 0; vi < positions.length; vi += 9) {
			var x0 = positions[vi], y0 = positions[vi + 1], z0 = positions[vi + 2];
			var x1 = positions[vi + 3], y1 = positions[vi + 4], z1 = positions[vi + 5];
			var x2 = positions[vi + 6], y2 = positions[vi + 7], z2 = positions[vi + 8];
			vol += (x0 * (y1 * z2 - y2 * z1) -
				x1 * (y0 * z2 - y2 * z0) +
				x2 * (y0 * z1 - y1 * z0)) / 6.0;
		}
		if (vol < 0) {
			// Flip every triangle: swap vertex 1 and vertex 2
			for (var fi = 0; fi < positions.length; fi += 9) {
				var tmp;
				tmp = positions[fi + 3]; positions[fi + 3] = positions[fi + 6]; positions[fi + 6] = tmp;
				tmp = positions[fi + 4]; positions[fi + 4] = positions[fi + 7]; positions[fi + 7] = tmp;
				tmp = positions[fi + 5]; positions[fi + 5] = positions[fi + 8]; positions[fi + 8] = tmp;
			}
		}
	}

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.computeVertexNormals();

	return {
		geometry: geometry,
		baseZ: baseZ
	};
}

/**
 * Create a preview mesh for the extrusion (wireframe + transparent fill).
 * Geometry is already in Three.js local coords — no position offset needed.
 *
 * @param {Object} entity  - KAD entity
 * @param {Object} params  - Extrude parameters
 * @param {string} color   - Hex color for preview
 * @returns {THREE.Group | null}
 */
export function createPreviewMesh(entity, params, color) {
	var result = buildExtrudeGeometry(entity, params);
	if (!result) return null;

	var group = new THREE.Group();
	group.name = "extrudePreview";
	group.userData = { isPreview: true };

	// Semi-transparent solid fill
	var solidMaterial = new THREE.MeshBasicMaterial({
		color: new THREE.Color(color || "#4488FF"),
		transparent: true,
		opacity: 0.3,
		side: THREE.DoubleSide,
		depthWrite: false
	});
	var solidMesh = new THREE.Mesh(result.geometry.clone(), solidMaterial);
	group.add(solidMesh);

	// Wireframe overlay
	var wireGeometry = new THREE.WireframeGeometry(result.geometry);
	var wireMaterial = new THREE.LineBasicMaterial({
		color: new THREE.Color(color || "#4488FF"),
		transparent: true,
		opacity: 0.7
	});
	var wireframe = new THREE.LineSegments(wireGeometry, wireMaterial);
	group.add(wireframe);

	return group;
}

/**
 * Apply the extrusion: build geometry, convert to surface, store and redraw.
 *
 * @param {Object} entity  - KAD entity
 * @param {Object} params  - Extrude parameters (including gradient)
 * @returns {string | null} - Surface ID of created surface, or null on failure
 */
export function applyExtrusion(entity, params) {
	var result = buildExtrudeGeometry(entity, params);
	if (!result) return null;

	var geometry = result.geometry;

	// Step 1) Extract vertex positions (geometry is non-indexed from manual build)
	var positions = geometry.attributes.position.array;
	var worldPoints = [];
	var triangles = [];

	// Step 2) Convert from Three.js local back to world coordinates
	for (var i = 0; i < positions.length; i += 3) {
		var world = window.threeLocalToWorld(positions[i], positions[i + 1]);
		worldPoints.push({
			x: world.x,
			y: world.y,
			z: positions[i + 2]
		});
	}

	// Step 3) Build triangles in {vertices: [{x,y,z},...]} format (required by saveSurfaceToDB)
	for (var t = 0; t < worldPoints.length; t += 3) {
		triangles.push({
			vertices: [
				{ x: worldPoints[t].x, y: worldPoints[t].y, z: worldPoints[t].z },
				{ x: worldPoints[t + 1].x, y: worldPoints[t + 1].y, z: worldPoints[t + 1].z },
				{ x: worldPoints[t + 2].x, y: worldPoints[t + 2].y, z: worldPoints[t + 2].z }
			]
		});
	}

	// Step 4) Compute bounds
	var bounds = computeBounds(worldPoints);

	// Step 5) Create surface object
	var entityName = entity.entityName || entity.data[0].entityName || "polygon";
	var shortId = Math.random().toString(36).substring(2, 6);
	var surfaceId = "EXTRUDED_" + entityName + "_" + shortId;

	// Step 5b) Get or create surface layer
	var layerId = getOrCreateSurfaceLayer("Extruded");

	var surface = {
		id: surfaceId,
		name: surfaceId,
		layerId: layerId,
		type: "triangulated",
		points: worldPoints,
		triangles: triangles,
		visible: true,
		gradient: "hillshade",
		hillshadeColor: params.solidColor || "#4488FF",
		transparency: 1.0,
		meshBounds: bounds,
		isTexturedMesh: false
	};

	// Step 6) Store in loadedSurfaces
	window.loadedSurfaces.set(surfaceId, surface);

	// Step 6a) Add to layer's entity set
	var layer = window.allSurfaceLayers ? window.allSurfaceLayers.get(layerId) : null;
	if (layer && layer.entities) layer.entities.add(surfaceId);

	// Step 6b) Undo support
	if (window.undoManager) {
		var action = new AddSurfaceAction(surface);
		window.undoManager.pushAction(action);
	}

	// Step 7) Save to IndexedDB
	if (typeof window.saveSurfaceToDB === "function") {
		window.saveSurfaceToDB(surfaceId).catch(function (err) {
			console.error("Failed to save extruded surface to DB:", err);
		});
	}

	// Step 8) Trigger redraw
	window.threeKADNeedsRebuild = true;
	if (typeof window.drawData === "function") {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}

	console.log("Extruded surface created: " + surfaceId + " (" + triangles.length + " triangles)");
	return surfaceId;
}

// ────────────────────────────────────────────────────────
// Internal utilities
// ────────────────────────────────────────────────────────

/**
 * Triangulate a closed polygon using Constrained Delaunay Triangulation.
 * Produces well-shaped triangles (no slivers) compared to ear-clipping.
 *
 * @param {Array} verts - Array of {x, y, z} polygon vertices (CCW order)
 * @returns {Array} Array of [a, b, c] index triplets, or null on failure
 */
function delaunayTriangulatePolygon(verts) {
	var n = verts.length;
	if (n < 3) return null;

	// Build flat coords array for Delaunator (XY only)
	var coords = new Float64Array(n * 2);
	for (var i = 0; i < n; i++) {
		coords[i * 2] = verts[i].x;
		coords[i * 2 + 1] = verts[i].y;
	}

	var del;
	try {
		del = new Delaunator(coords);
	} catch (e) {
		console.warn("ExtrudeKADHelper: Delaunator failed, falling back to ear-clip:", e.message);
		return delaunayFallback(verts);
	}

	// Constrain the polygon boundary edges
	try {
		var con = new Constrainautor(del);
		for (var i = 0; i < n; i++) {
			var j = (i + 1) % n;
			try { con.constrainOne(i, j); } catch (ce) { /* skip */ }
		}
	} catch (ce) {
		// Constrainautor init failed — unconstrained Delaunator still usable
	}

	// Filter triangles: keep only those whose centroid is inside the polygon
	var result = [];
	var tris = del.triangles;
	for (var k = 0; k < tris.length; k += 3) {
		var a = tris[k], b = tris[k + 1], c = tris[k + 2];

		// Centroid
		var cx = (coords[a * 2] + coords[b * 2] + coords[c * 2]) / 3;
		var cy = (coords[a * 2 + 1] + coords[b * 2 + 1] + coords[c * 2 + 1]) / 3;

		if (pointInPolygon(cx, cy, coords, n)) {
			result.push([a, b, c]);
		}
	}

	if (result.length === 0) {
		console.warn("ExtrudeKADHelper: CDT produced no interior triangles, falling back");
		return delaunayFallback(verts);
	}

	return result;
}

/**
 * Fallback to THREE.ShapeUtils ear-clipping if Delaunay fails.
 */
function delaunayFallback(verts) {
	var contour = [];
	for (var i = 0; i < verts.length; i++) {
		contour.push(new THREE.Vector2(verts[i].x, verts[i].y));
	}
	var indices = THREE.ShapeUtils.triangulateShape(contour, []);
	return indices && indices.length > 0 ? indices : null;
}

/**
 * Ray-casting point-in-polygon test (2D, XY plane).
 * @param {number} px - Test point X
 * @param {number} py - Test point Y
 * @param {Float64Array} coords - Flat [x0,y0,x1,y1,...] polygon vertices
 * @param {number} n - Number of vertices
 * @returns {boolean}
 */
function pointInPolygon(px, py, coords, n) {
	var inside = false;
	for (var i = 0, j = n - 1; i < n; j = i++) {
		var xi = coords[i * 2], yi = coords[i * 2 + 1];
		var xj = coords[j * 2], yj = coords[j * 2 + 1];

		if (((yi > py) !== (yj > py)) &&
			(px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Check if a 2D polygon is counter-clockwise (positive signed area).
 */
function isCounterClockwise(points) {
	var area = 0;
	for (var i = 0; i < points.length; i++) {
		var j = (i + 1) % points.length;
		area += points[i].x * points[j].y;
		area -= points[j].x * points[i].y;
	}
	return area > 0;
}

/**
 * Compute axis-aligned bounding box from points array.
 */
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

// getOrCreateSurfaceLayer imported from LayerHelper.js
