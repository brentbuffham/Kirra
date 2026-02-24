/**
 * SolidCSGHelper.js
 *
 * 3D CSG boolean operations on surface meshes using THREE-CSGMesh.
 * Operations: Union, Intersect, Subtract, Reverse Subtract, Difference (XOR).
 *
 * Converts surface triangulations to THREE.Mesh, performs CSG,
 * then extracts result back to surface format for storage.
 *
 * Includes undo/redo via AddSurfaceAction.
 * Optional post-CSG mesh repair via MeshRepairHelper.
 */

import * as THREE from "three";
import CSG from "../lib/THREE-CSGMesh/three-csg.js";
import { AddSurfaceAction } from "../tools/UndoActions.js";
import { extractTriangles, ensureZUpNormals } from "./SurfaceIntersectionHelper.js";
import { getOrCreateSurfaceLayer } from "./LayerHelper.js";
import { computeBounds, weldedToSoup, repairMesh } from "./MeshRepairHelper.js";

// ────────────────────────────────────────────────────────
// Operation layer and label mapping
// ────────────────────────────────────────────────────────

var OPERATION_LABELS = {
	union: "UNION",
	intersect: "INTERSECT",
	subtract: "SUBTRACT",
	reverseSubtract: "REV_SUBTRACT",
	difference: "DIFFERENCE"
};

var LAYER_NAMES = {
	union: "Unions",
	intersect: "Intersects",
	subtract: "Subtracts",
	reverseSubtract: "Subtracts",
	difference: "Differences"
};

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Execute a CSG boolean operation on two surfaces.
 *
 * @param {Object} config
 * @param {string}   config.surfaceIdA    - ID of surface A in loadedSurfaces
 * @param {string}   config.surfaceIdB    - ID of surface B in loadedSurfaces
 * @param {string}   config.operation     - "union" | "intersect" | "subtract" | "reverseSubtract" | "difference"
 * @param {string}   config.gradient      - Gradient for result surface
 * @param {boolean}  [config.repairMesh]  - Run mesh repair pipeline on result
 * @param {string}   [config.closeMode]   - "none" | "weld" | "stitch" (for repair)
 * @param {number}   [config.snapTolerance]   - Weld tolerance (for repair)
 * @param {number}   [config.stitchTolerance] - Stitch tolerance (for repair)
 * @param {Function} [config.onProgress]  - Progress callback: onProgress(message)
 * @returns {Promise<string|null>} - Surface ID of result, or null on failure
 */
export async function solidCSG(config) {
	// Abort if WebGL context already lost
	if (window.threeRenderer && window.threeRenderer.contextLost) {
		console.error("SolidCSGHelper: WebGL context lost — aborting CSG");
		return null;
	}

	var onProgress = config.onProgress || function () {};

	try {
		var surfaceA = window.loadedSurfaces ? window.loadedSurfaces.get(config.surfaceIdA) : null;
		var surfaceB = window.loadedSurfaces ? window.loadedSurfaces.get(config.surfaceIdB) : null;

		if (!surfaceA || !surfaceB) {
			console.error("SolidCSGHelper: One or both surfaces not found");
			return null;
		}

		// Step 1) Build THREE.Mesh from each surface
		onProgress("Building meshes...");
		var meshA = surfaceToMesh(surfaceA);
		var meshB = surfaceToMesh(surfaceB);

		if (!meshA || !meshB) {
			console.error("SolidCSGHelper: Failed to create mesh from surface data");
			return null;
		}

		// Step 2) Ensure meshes have up-to-date world matrices
		meshA.updateMatrix();
		meshB.updateMatrix();

		// Step 3) Convert to CSG and perform operation
		onProgress("Computing CSG...");
		var csgA, csgB, csgResult;
		try {
			csgA = CSG.fromMesh(meshA);
			csgB = CSG.fromMesh(meshB);

			switch (config.operation) {
				case "union":
					csgResult = csgA.union(csgB);
					break;
				case "intersect":
					csgResult = csgA.intersect(csgB);
					break;
				case "subtract":
					csgResult = csgA.subtract(csgB);
					break;
				case "reverseSubtract":
					csgResult = csgB.subtract(csgA);
					break;
				case "difference":
					// XOR: (A - B) ∪ (B - A)
					var aMinusB = csgA.subtract(csgB);
					var bMinusA = csgB.subtract(csgA);
					csgResult = aMinusB.union(bMinusA);
					break;
				default:
					console.error("SolidCSGHelper: Unknown operation: " + config.operation);
					return null;
			}
		} catch (err) {
			console.error("SolidCSGHelper: CSG operation failed:", err);
			return null;
		}

		// Step 4) Convert CSG result back to THREE.Mesh
		var resultMesh;
		try {
			resultMesh = CSG.toMesh(csgResult, meshA.matrix, meshA.material);
		} catch (err) {
			console.error("SolidCSGHelper: Failed to convert CSG result to mesh:", err);
			return null;
		}

		var resultGeometry = resultMesh.geometry;
		if (!resultGeometry || !resultGeometry.attributes || !resultGeometry.attributes.position) {
			console.error("SolidCSGHelper: Result mesh has no geometry");
			return null;
		}

		// Step 5) Extract world-coordinate points and triangles from result
		var positions = resultGeometry.attributes.position.array;
		var index = resultGeometry.index ? resultGeometry.index.array : null;
		var worldPoints = [];
		var triangles = [];

		for (var i = 0; i < positions.length; i += 3) {
			var world = window.threeLocalToWorld(positions[i], positions[i + 1]);
			worldPoints.push({
				x: world.x,
				y: world.y,
				z: positions[i + 2]
			});
		}

		if (index) {
			for (var t = 0; t < index.length; t += 3) {
				triangles.push({
					vertices: [
						{ x: worldPoints[index[t]].x, y: worldPoints[index[t]].y, z: worldPoints[index[t]].z },
						{ x: worldPoints[index[t + 1]].x, y: worldPoints[index[t + 1]].y, z: worldPoints[index[t + 1]].z },
						{ x: worldPoints[index[t + 2]].x, y: worldPoints[index[t + 2]].y, z: worldPoints[index[t + 2]].z }
					]
				});
			}
		} else {
			for (var p = 0; p < worldPoints.length; p += 3) {
				triangles.push({
					vertices: [
						{ x: worldPoints[p].x, y: worldPoints[p].y, z: worldPoints[p].z },
						{ x: worldPoints[p + 1].x, y: worldPoints[p + 1].y, z: worldPoints[p + 1].z },
						{ x: worldPoints[p + 2].x, y: worldPoints[p + 2].y, z: worldPoints[p + 2].z }
					]
				});
			}
		}

		if (triangles.length === 0) {
			console.warn("SolidCSGHelper: Operation produced no triangles");
			return null;
		}

		// Step 5b) Mesh repair (if config.repairMesh is enabled)
		if (config.repairMesh) {
			onProgress("Repairing mesh...");
			// Yield to let progress dialog update
			await new Promise(function (r) { setTimeout(r, 0); });

			var soup = weldedToSoup(triangles);
			var repairResult = await repairMesh(soup, {
				closeMode: config.closeMode || "none",
				snapTolerance: config.snapTolerance || 0,
				stitchTolerance: config.stitchTolerance || 1.0,
				removeDegenerate: true
			}, onProgress);

			worldPoints = repairResult.points;
			triangles = repairResult.triangles;

			console.log("SolidCSGHelper: mesh repair complete — " +
				worldPoints.length + " points, " + triangles.length + " triangles");
		}

		// Step 6) Compute bounds
		var bounds = computeBounds(worldPoints);

		// Step 7) Create surface object
		var shortId = Math.random().toString(36).substring(2, 6);
		var opPrefix = OPERATION_LABELS[config.operation] || "CSG";
		var layerName = LAYER_NAMES[config.operation] || "CSG Results";
		var surfaceId = opPrefix + "_" + shortId;
		var layerId = getOrCreateSurfaceLayer(layerName);

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

		// Step 8) Store and persist
		window.loadedSurfaces.set(surfaceId, surface);

		// Step 8a) Add to layer's entity set
		var layer = window.allSurfaceLayers ? window.allSurfaceLayers.get(layerId) : null;
		if (layer && layer.entities) layer.entities.add(surfaceId);

		if (typeof window.saveSurfaceToDB === "function") {
			window.saveSurfaceToDB(surfaceId).catch(function (err) {
				console.error("Failed to save CSG result surface:", err);
			});
		}

		// Step 9) Undo support
		if (window.undoManager) {
			var action = new AddSurfaceAction(surface);
			window.undoManager.pushAction(action);
		}

		// Step 10) Trigger redraw (skip if WebGL context was lost during operation)
		window.threeKADNeedsRebuild = true;
		if (window.threeRenderer && window.threeRenderer.contextLost) {
			console.warn("SolidCSGHelper: WebGL context lost during operation — surface saved but 3D render skipped");
		} else if (typeof window.drawData === "function") {
			window.drawData(window.allBlastHoles, window.selectedHole);
		}
		if (typeof window.debouncedUpdateTreeView === "function") {
			window.debouncedUpdateTreeView();
		}

		// Step 11) Clean up temp meshes
		meshA.geometry.dispose();
		meshA.material.dispose();
		meshB.geometry.dispose();
		meshB.material.dispose();
		resultGeometry.dispose();

		console.log("CSG " + opPrefix + " complete: " + surfaceId + " (" + triangles.length + " triangles)");
		return surfaceId;

	} catch (err) {
		console.error("SolidCSGHelper: Unexpected error during CSG operation:", err);
		return null;
	}
}

// ────────────────────────────────────────────────────────
// Internal utilities
// ────────────────────────────────────────────────────────

/**
 * Convert a Kirra surface object to a THREE.Mesh in Three.js local coords.
 * Handles both {vertices:[{x,y,z},...]} triangle format and {a,b,c} index format.
 */
function surfaceToMesh(surface) {
	var tris = surface.triangles;
	var pts = surface.points;

	if (!tris || tris.length === 0) {
		console.error("SolidCSGHelper: Surface has no triangles");
		return null;
	}

	// Normalize triangles to {v0, v1, v2} format
	var normalizedTris = extractTriangles(surface);
	var closed = typeof window.isSurfaceClosed === "function" && window.isSurfaceClosed(surface);
	if (!closed) {
		// Open surfaces: force Z-up as best-effort (results may be unreliable)
		normalizedTris = ensureZUpNormals(normalizedTris);
	}
	// Closed solids: preserve original winding — normals should already be outward-facing

	var positions = [];

	for (var i = 0; i < normalizedTris.length; i++) {
		var tri = normalizedTris[i];
		var verts = [tri.v0, tri.v1, tri.v2];
		for (var j = 0; j < 3; j++) {
			var local = window.worldToThreeLocal(verts[j].x, verts[j].y);
			positions.push(local.x, local.y, verts[j].z);
		}
	}

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.computeVertexNormals();

	var material = new THREE.MeshBasicMaterial({ color: 0x888888 });
	var mesh = new THREE.Mesh(geometry, material);

	return mesh;
}
