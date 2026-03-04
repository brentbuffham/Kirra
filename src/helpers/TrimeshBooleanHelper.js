/**
 * TrimeshBooleanHelper.js
 *
 * Helper functions for the trimesh-boolean NPM library integration.
 * Delegates computation to trimeshBooleanWorker.js, provides preview
 * mesh creation and surface storage following the same patterns as
 * SurfaceBooleanHelper.js.
 */

import * as THREE from "three";
import { MeshLine, MeshLineMaterial } from "./meshLineModified.js";
import { AddSurfaceAction } from "../tools/UndoActions.js";
import { getOrCreateSurfaceLayer } from "./LayerHelper.js";
import { extractTriangles } from "./SurfaceIntersectionHelper.js";
import { weldVertices, weldedToSoup, computeBounds } from "./MeshRepairHelper.js";

// ────────────────────────────────────────────────────────
// Web Worker communication
// ────────────────────────────────────────────────────────

function runTrimeshWorker(messageType, payload) {
	return new Promise(function (resolve, reject) {
		var worker = new Worker(
			new URL("../workers/trimeshBooleanWorker.js", import.meta.url),
			{ type: "module" }
		);

		function handler(e) {
			var msg = e.data;
			if (msg.type === "progress") {
				console.log("TrimeshBoolean Worker: [" + msg.percent + "%] " + msg.message);
			} else if (msg.type === "result") {
				worker.removeEventListener("message", handler);
				worker.removeEventListener("error", errHandler);
				worker.terminate();
				resolve(msg.data);
			} else if (msg.type === "error") {
				worker.removeEventListener("message", handler);
				worker.removeEventListener("error", errHandler);
				worker.terminate();
				reject(new Error(msg.message));
			}
		}

		function errHandler(err) {
			worker.removeEventListener("message", handler);
			worker.removeEventListener("error", errHandler);
			worker.terminate();
			reject(new Error("Worker error: " + (err.message || String(err))));
		}

		worker.addEventListener("message", handler);
		worker.addEventListener("error", errHandler);

		worker.postMessage({ type: messageType, payload: payload });
	});
}

// ────────────────────────────────────────────────────────
// Split computation
// ────────────────────────────────────────────────────────

/**
 * Split two surfaces using the trimesh-boolean library.
 * Returns components (per-connected-component splits) and intersection segments.
 *
 * @param {string} surfaceIdA
 * @param {string} surfaceIdB
 * @param {number} [smallThreshold=50]
 * @returns {Promise<{ components: Array, segments: Array, surfaceIdA: string, surfaceIdB: string }|null>}
 */
export async function computeTrimeshSplit(surfaceIdA, surfaceIdB, smallThreshold) {
	var surfA = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceIdA) : null;
	var surfB = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceIdB) : null;

	if (!surfA || !surfB) {
		console.error("TrimeshBooleanHelper: surface not found");
		return null;
	}

	var soupA = extractTriangles(surfA);
	var soupB = extractTriangles(surfB);

	if (soupA.length === 0 || soupB.length === 0) {
		console.error("TrimeshBooleanHelper: one or both surfaces have no triangles");
		return null;
	}

	console.log("TrimeshBooleanHelper: splitting " + soupA.length + " + " + soupB.length + " triangles");

	try {
		var result = await runTrimeshWorker("splitMeshPair", {
			soupA: soupA,
			soupB: soupB,
			smallThreshold: smallThreshold !== undefined ? smallThreshold : 50
		});

		if (!result || !result.components || result.components.length === 0) {
			return null;
		}

		return {
			components: result.components,
			segments: result.segments || [],
			surfaceIdA: surfaceIdA,
			surfaceIdB: surfaceIdB
		};
	} catch (err) {
		console.error("TrimeshBooleanHelper: split failed:", err);
		return null;
	}
}

// ────────────────────────────────────────────────────────
// Preview mesh creation (matches SurfaceBooleanHelper style)
// ────────────────────────────────────────────────────────

/**
 * Build a positions Float32Array from a soup of {v0, v1, v2} triangles.
 */
function soupToPositions(soup) {
	var positions = [];
	for (var i = 0; i < soup.length; i++) {
		var local0 = window.worldToThreeLocal(soup[i].v0.x, soup[i].v0.y);
		var local1 = window.worldToThreeLocal(soup[i].v1.x, soup[i].v1.y);
		var local2 = window.worldToThreeLocal(soup[i].v2.x, soup[i].v2.y);
		positions.push(
			local0.x, local0.y, soup[i].v0.z,
			local1.x, local1.y, soup[i].v1.z,
			local2.x, local2.y, soup[i].v2.z
		);
	}
	return positions;
}

/**
 * Create a colored preview mesh group from triangle soup.
 * Same visual style as SurfaceBooleanHelper.trianglesToMesh.
 */
function trianglesToMesh(tris, color, visible) {
	var positions = soupToPositions(tris);

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.computeVertexNormals();

	var group = new THREE.Group();
	group.userData.originalColor = color;

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

/**
 * Create preview meshes for an array of splits.
 * Each split has { soup, color, kept }.
 *
 * @param {Array} splits
 * @returns {THREE.Group}
 */
export function createComponentPreviewMeshes(splits) {
	var group = new THREE.Group();
	group.name = "trimeshBooleanPreview";
	group.userData = { isPreview: true };

	for (var s = 0; s < splits.length; s++) {
		var split = splits[s];
		var mesh = trianglesToMesh(split.soup || split.triangles, split.color, split.kept);
		mesh.userData.splitIndex = s;
		group.add(mesh);
	}

	return group;
}

/**
 * Create fat yellow MeshLine intersection polylines.
 * Same as SurfaceBooleanHelper.createIntersectionPolylineMesh.
 *
 * @param {Array} taggedSegments - Array of { p0, p1, idxA, idxB }
 * @returns {THREE.Group|null}
 */
export function createSegmentLineMesh(taggedSegments) {
	if (!taggedSegments || taggedSegments.length === 0) return null;

	var group = new THREE.Group();
	group.name = "intersectionPolyline";
	group.renderOrder = 999;
	group.userData = { isPreview: true };

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
 * Update a split preview mesh's appearance based on kept state.
 * Same as SurfaceBooleanHelper.updateSplitMeshAppearance.
 */
export function updateSplitMeshAppearance(mesh, kept) {
	if (!mesh) return;

	var originalColor = mesh.userData.originalColor || "#4488FF";
	mesh.visible = true;

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

// ────────────────────────────────────────────────────────
// Merge and store result surface
// ────────────────────────────────────────────────────────

/**
 * Merge kept splits into a new surface and store it.
 *
 * @param {Array} splits - Array of { soup, kept, ... }
 * @param {Object} config - { gradient, closeMode, snapTolerance, stitchTolerance, ... }
 * @returns {Promise<string|null>} New surface ID or null
 */
export async function applyTrimeshMerge(splits, config) {
	if (window.threeRenderer && window.threeRenderer.contextLost) {
		console.error("TrimeshBooleanHelper: WebGL context lost — aborting merge");
		return null;
	}

	// Collect kept splits' soup arrays
	var picks = [];
	for (var i = 0; i < splits.length; i++) {
		if (!splits[i].kept) continue;
		picks.push({ soup: splits[i].soup || splits[i].triangles });
	}

	if (picks.length === 0) {
		console.warn("TrimeshBooleanHelper: no kept splits to merge");
		return null;
	}

	console.log("TrimeshBooleanHelper: merging " + picks.length + " components...");

	try {
		// Step 1: Merge components via worker
		var merged = await runTrimeshWorker("mergeComponents", { picks: picks });

		if (!merged || !merged.soup || merged.soup.length === 0) {
			console.warn("TrimeshBooleanHelper: merge returned empty result");
			return null;
		}

		// Step 2: Apply repair pipeline if close mode is not raw
		var worldPoints, triangles, finalSoup;
		if (config.closeMode && config.closeMode !== "raw") {
			console.log("TrimeshBooleanHelper: running repair pipeline (mode=" + config.closeMode + ")...");
			var repairConfig = {
				closeMode: config.closeMode,
				snapTolerance: config.snapTolerance || 0,
				stitchTolerance: config.stitchTolerance || 1.0,
				removeDegenerate: config.removeDegenerate !== false,
				sliverRatio: config.removeSlivers ? (config.sliverRatio || 0.01) : 0,
				cleanCrossings: !!config.cleanCrossings,
				removeOverlapping: !!config.removeOverlapping,
				overlapTolerance: config.overlapTolerance || 0.5
			};
			var repaired = await runTrimeshWorker("repairMesh", {
				soup: merged.soup,
				config: repairConfig
			});
			if (repaired && repaired.points && repaired.triangles) {
				// Use the library's already-welded result directly
				worldPoints = repaired.points;
				triangles = repaired.triangles;
				finalSoup = repaired.soup || merged.soup;
			} else {
				// Fallback: weld merged soup
				var welded = weldVertices(merged.soup, config.snapTolerance || 0.001);
				worldPoints = welded.points;
				triangles = welded.triangles;
				finalSoup = merged.soup;
			}
		} else {
			// Raw mode: use merge result directly (already welded by mergeComponents)
			worldPoints = merged.points;
			triangles = merged.triangles;
			finalSoup = merged.soup;
		}

		var bounds = computeBounds(finalSoup);

		// Step 4: Store result surface
		var shortId = Math.random().toString(36).substring(2, 6);
		var surfaceId = "TRIM_" + shortId;
		var layerId = getOrCreateSurfaceLayer("Trimesh Booleans");

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

		window.loadedSurfaces.set(surfaceId, surface);

		var layer = window.allSurfaceLayers ? window.allSurfaceLayers.get(layerId) : null;
		if (layer && layer.entities) layer.entities.add(surfaceId);

		if (typeof window.saveSurfaceToDB === "function") {
			window.saveSurfaceToDB(surfaceId).catch(function (err) {
				console.error("TrimeshBooleanHelper: Failed to save surface:", err);
			});
		}

		if (window.undoManager) {
			var action = new AddSurfaceAction(surface);
			window.undoManager.pushAction(action);
		}

		window.threeKADNeedsRebuild = true;
		if (window.threeRenderer && window.threeRenderer.contextLost) {
			console.warn("TrimeshBooleanHelper: WebGL context lost — surface saved but 3D render skipped");
		} else if (typeof window.drawData === "function") {
			window.drawData(window.allBlastHoles, window.selectedHole);
		}
		if (typeof window.debouncedUpdateTreeView === "function") {
			window.debouncedUpdateTreeView();
		}

		console.log("TrimeshBooleanHelper: applied " + surfaceId + " (" + triangles.length + " triangles)");
		return surfaceId;
	} catch (err) {
		console.error("TrimeshBooleanHelper: Merge error:", err);
		return null;
	}
}
