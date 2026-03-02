// src/tools/MeshEditTool.js
// =============================================================================
// MESH EDIT TOOL — Triangle/Vertex Delete for Surface Meshes
// =============================================================================
// Workflow:
// 1. User right-clicks surface → mesh check panel → clicks [Edit]
// 2. window.startMeshEditMode(surfaceId) activates the tool
// 3. Hover highlights triangles (yellow), click selects (red)
// 4. Delete key removes selected triangles, Ctrl+Z undoes
// Created: 2026-03-02

import * as THREE from "three";
import { extractTriangles } from "../helpers/SurfaceIntersectionHelper.js";
import { capBoundaryLoopsSequential } from "../helpers/MeshRepairHelper.js";
import { drawSurfaceThreeJS } from "../draw/canvas3DDrawing.js";
import { UndoableAction, ActionTypes } from "./UndoManager.js";

// =============================================================================
// STATE VARIABLES
// =============================================================================

var isMeshEditActive = false;
var editSurfaceId = null;
var editSurface = null;
var editMode = "face"; // "face" or "vertex"
var selectedIndices = new Set(); // soup indices of selected triangles
var hoveredIndex = -1; // soup index of hovered triangle
var editSoup = []; // triangle soup [{v0, v1, v2}, ...]
var meshFaceToSoupIndex = []; // Three.js face → soup index mapping
var soupToSurfaceIndex = []; // soup index → surface.triangles index
var autoRepair = false;

// Three.js overlay objects
var highlightGroup = null;
var hoverMesh = null;
var selectionMesh = null;
var selectionWire = null;

// Toolbar dialog reference
var toolbarDialog = null;

// Event handler references (for removal)
var onMouseMove = null;
var onClick = null;
var onKeyDown = null;

// Raycaster
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();

// =============================================================================
// DELETE TRIANGLES UNDO ACTION
// =============================================================================

class DeleteTrianglesAction extends UndoableAction {
	constructor(surface, deletedEntries, description) {
		super("DELETE_TRIANGLES", false, false);
		this.affectsSurfaces = true;
		this.surfaceId = surface.id;
		this.surface = surface;
		// deletedEntries: [{index, triangle}, ...] sorted ascending by index
		this.deletedEntries = deletedEntries;
		this.description = description || "Delete " + deletedEntries.length + " triangles";
	}

	execute() {
		// Already applied before pushing to undo stack
	}

	undo() {
		// Re-insert triangles at original indices (ascending order)
		for (var i = 0; i < this.deletedEntries.length; i++) {
			var entry = this.deletedEntries[i];
			this.surface.triangles.splice(entry.index, 0, entry.triangle);
		}
		this.refresh();
		// Rebuild soup and highlights if tool is still active
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	redo() {
		// Re-remove triangles (descending order)
		for (var i = this.deletedEntries.length - 1; i >= 0; i--) {
			var entry = this.deletedEntries[i];
			this.surface.triangles.splice(entry.index, 1);
		}
		this.refresh();
		// Rebuild soup and highlights if tool is still active
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			selectedIndices.clear();
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	refresh() {
		// Override base refresh to do a targeted single-surface rebuild
		// instead of full threeDataNeedsRebuild + drawData (which causes GPU exhaustion)
		if (typeof window.invalidateSurfaceCache === "function") {
			window.invalidateSurfaceCache(this.surfaceId);
		}

		// Remove old mesh and rebuild just this surface
		var renderer = window.threeRenderer;
		if (renderer && renderer.surfaceMeshMap) {
			var oldMesh = renderer.surfaceMeshMap.get(this.surfaceId);
			if (oldMesh) {
				if (renderer.surfacesGroup) renderer.surfacesGroup.remove(oldMesh);
				oldMesh.traverse(function (child) {
					if (child.geometry) child.geometry.dispose();
					if (child.material) {
						if (Array.isArray(child.material)) {
							child.material.forEach(function (m) { m.dispose(); });
						} else {
							child.material.dispose();
						}
					}
				});
				renderer.surfaceMeshMap.delete(this.surfaceId);
			}
		}

		// Rebuild just this surface in 3D
		var surface = this.surface;
		if (surface && renderer) {
			var minZ = surface.meshBounds ? surface.meshBounds.minZ : 0;
			var maxZ = surface.meshBounds ? surface.meshBounds.maxZ : 100;
			if (surface.minLimit != null) minZ = surface.minLimit;
			if (surface.maxLimit != null) maxZ = surface.maxLimit;
			drawSurfaceThreeJS(this.surfaceId, surface.triangles || [], minZ, maxZ,
				surface.gradient || "default", surface.transparency || 1.0, surface);
		}

		// Save to IndexedDB
		if (window.saveSurfaceToDB) {
			window.saveSurfaceToDB(this.surfaceId).catch(function (err) {
				console.warn("Surface save after undo/redo failed:", err);
			});
		}

		// Update tree view
		if (window.debouncedUpdateTreeView) {
			window.debouncedUpdateTreeView();
		}

		requestRender();
	}
}

// =============================================================================
// START / CANCEL
// =============================================================================

function startMeshEditMode(surfaceId) {
	// Guard: already active
	if (isMeshEditActive) {
		console.warn("MeshEditTool: already active, cancelling first");
		cancelMeshEditMode();
	}

	// Guard: 3D must be initialized
	if (!window.threeInitialized || !window.threeRenderer) {
		if (window.showModalMessage) {
			window.showModalMessage("3D Required", "Switch to 3D view to use mesh editing.");
		}
		return;
	}

	// Guard: surface must exist
	var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceId) : null;
	if (!surface) {
		if (window.showModalMessage) {
			window.showModalMessage("No Surface", "Surface not found: " + surfaceId);
		}
		return;
	}

	// Guard: reject textured OBJ meshes (they don't use triangle soup)
	if (surface.isTexturedMesh && surface.threeJSMesh) {
		if (window.showModalMessage) {
			window.showModalMessage("Not Supported", "Mesh editing is not supported for textured OBJ meshes.");
		}
		return;
	}

	// Guard: must have triangles
	if (!surface.triangles || surface.triangles.length === 0) {
		if (window.showModalMessage) {
			window.showModalMessage("Empty Surface", "This surface has no triangles to edit.");
		}
		return;
	}

	// Activate
	isMeshEditActive = true;
	editSurfaceId = surfaceId;
	editSurface = surface;
	editMode = "face";
	selectedIndices.clear();
	hoveredIndex = -1;
	autoRepair = false;

	window.isMeshEditActive = true;

	// Build soup and index map
	rebuildSoupAndMap();

	// Create highlight group
	var scene = window.threeRenderer.scene;
	highlightGroup = new THREE.Group();
	highlightGroup.name = "meshEditHighlights";
	highlightGroup.renderOrder = 999;
	scene.add(highlightGroup);

	// Attach event listeners
	// Use the canvasContainer (parent of threeCanvas) for click — matches existing 3D pattern
	// Use document for mousemove — matches handle3DMouseMove pattern in kirra.js
	var canvas = getThreeCanvas();
	var container = canvas ? canvas.parentElement : null;
	if (container) {
		onMouseMove = handleMouseMove;
		onClick = handleClick;
		onKeyDown = handleKeyDown;
		document.addEventListener("mousemove", onMouseMove);
		container.addEventListener("click", onClick, true); // capture phase, same as handle3DClick
		document.addEventListener("keydown", onKeyDown);
	}

	// Show toolbar
	showToolbar();

	if (window.updateStatusMessage) {
		window.updateStatusMessage("Mesh Edit: click triangles to select, Delete to remove");
	}

	console.log("MeshEditTool: started for " + surfaceId + " (" + editSoup.length + " triangles)");
}

function cancelMeshEditMode() {
	if (!isMeshEditActive) return;

	// Remove event listeners
	var canvas = getThreeCanvas();
	var container = canvas ? canvas.parentElement : null;
	if (onMouseMove) document.removeEventListener("mousemove", onMouseMove);
	if (onClick && container) container.removeEventListener("click", onClick, true);
	if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
	onMouseMove = null;
	onClick = null;
	onKeyDown = null;

	// Dispose highlight group
	clearHighlights();
	if (highlightGroup) {
		var scene = window.threeRenderer && window.threeRenderer.scene;
		if (scene) scene.remove(highlightGroup);
		highlightGroup = null;
	}

	// Close toolbar
	if (toolbarDialog) {
		toolbarDialog.close();
		toolbarDialog = null;
	}

	// Reset state
	isMeshEditActive = false;
	editSurfaceId = null;
	editSurface = null;
	selectedIndices.clear();
	hoveredIndex = -1;
	editSoup = [];
	meshFaceToSoupIndex = [];
	soupToSurfaceIndex = [];

	window.isMeshEditActive = false;

	if (window.updateStatusMessage) {
		window.updateStatusMessage("");
	}

	if (window.threeRenderer && window.threeRenderer.requestRender) {
		window.threeRenderer.requestRender();
	}

	console.log("MeshEditTool: cancelled");
}

// =============================================================================
// SOUP & INDEX MAP
// =============================================================================

function rebuildSoupAndMap() {
	editSoup = extractTriangles(editSurface);
	buildIndexMap();
}

/**
 * Build mapping from Three.js mesh face index to editSoup index.
 *
 * Both extractTriangles() and GeometryFactory.createSurface() iterate
 * surface.triangles and skip invalid entries. We need to know which soup
 * index each Three.js face corresponds to.
 *
 * Strategy: walk surface.triangles in order. For each entry, determine if
 * extractTriangles would emit a soup entry (soupValid) and if createSurface
 * would emit a face (meshValid). When both emit, record the mapping.
 */
function buildIndexMap() {
	meshFaceToSoupIndex = [];
	soupToSurfaceIndex = [];
	var triangles = editSurface.triangles;
	var points = editSurface.points;
	if (!triangles) return;

	var soupIdx = 0; // tracks extractTriangles output index

	for (var i = 0; i < triangles.length; i++) {
		var tri = triangles[i];
		var v0, v1, v2;
		var soupValid = false;
		var meshValid = false;

		if (tri.vertices && Array.isArray(tri.vertices) && tri.vertices.length >= 3) {
			// Format 1: {vertices: [{x,y,z}, ...]} — used by both extract and createSurface
			v0 = tri.vertices[0];
			v1 = tri.vertices[1];
			v2 = tri.vertices[2];
			if (v0 && v1 && v2) {
				soupValid = true;
				// createSurface skips NaN
				if (!isNaN(v0.x) && !isNaN(v0.y) && !isNaN(v0.z) &&
					!isNaN(v1.x) && !isNaN(v1.y) && !isNaN(v1.z) &&
					!isNaN(v2.x) && !isNaN(v2.y) && !isNaN(v2.z)) {
					meshValid = true;
				}
			}
		} else if (tri.a !== undefined && tri.b !== undefined && tri.c !== undefined && points) {
			// Format 2: {a, b, c} index refs
			v0 = points[tri.a];
			v1 = points[tri.b];
			v2 = points[tri.c];
			if (v0 && v1 && v2) {
				soupValid = true;
			}
			// createSurface does NOT handle this format — it only checks tri.vertices
			// So this triangle won't appear in the Three.js mesh
			meshValid = false;
		} else if (tri.indices && Array.isArray(tri.indices) && tri.indices.length >= 3 && points) {
			// Format 3: {indices: [...]} — extractTriangles handles, createSurface doesn't
			v0 = points[tri.indices[0]];
			v1 = points[tri.indices[1]];
			v2 = points[tri.indices[2]];
			if (v0 && v1 && v2) {
				soupValid = true;
			}
			meshValid = false;
		}

		if (meshValid) {
			// This triangle appears in both soup and Three.js mesh
			meshFaceToSoupIndex.push(soupIdx);
		}

		if (soupValid) {
			soupToSurfaceIndex.push(i); // soup index soupIdx → surface.triangles index i
			soupIdx++;
		}
	}

	console.log("MeshEditTool: indexMap built — " + meshFaceToSoupIndex.length +
		" mesh faces, " + soupIdx + " soup entries, " + triangles.length + " surface.triangles");
}

// =============================================================================
// RAYCASTING & FACE PICKING
// =============================================================================

function getThreeCanvas() {
	// Use renderer's own canvas to guarantee we match what InteractionManager uses
	if (window.threeRenderer && window.threeRenderer.getCanvas) {
		return window.threeRenderer.getCanvas();
	}
	return document.getElementById("threeCanvas") || null;
}

function raycastSurface(event) {
	var renderer = window.threeRenderer;
	if (!renderer) return -1;

	var canvas = getThreeCanvas();
	if (!canvas) return -1;

	// Use the same mouse normalization as InteractionManager.updateMousePosition
	var rect = canvas.getBoundingClientRect();

	// Check if mouse is over the 3D canvas
	if (event.clientX < rect.left || event.clientX > rect.right ||
		event.clientY < rect.top || event.clientY > rect.bottom) {
		return -1;
	}

	mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	renderer.camera.updateMatrixWorld(true);
	raycaster.setFromCamera(mouse, renderer.camera);

	// Raycast against the surface mesh
	var meshObj = renderer.surfaceMeshMap.get(editSurfaceId);
	if (!meshObj) return -1;

	// Use intersectObject with recursive=true for groups
	var intersects = raycaster.intersectObject(meshObj, true);

	if (intersects.length === 0) return -1;

	// Get the hit point in world coordinates (Three.js local → world)
	var hit = intersects[0];
	if (!hit.point) return -1;

	// Convert Three.js local hit point back to world coordinates
	var ox = window.threeLocalOriginX || 0;
	var oy = window.threeLocalOriginY || 0;
	var hitWorldX = hit.point.x + ox;
	var hitWorldY = hit.point.y + oy;
	var hitWorldZ = hit.point.z;

	// Find the closest soup triangle by centroid distance to the hit point
	// This is robust regardless of face index mapping
	var bestIdx = -1;
	var bestDist = Infinity;
	for (var i = 0; i < editSoup.length; i++) {
		var t = editSoup[i];
		var cx = (t.v0.x + t.v1.x + t.v2.x) / 3;
		var cy = (t.v0.y + t.v1.y + t.v2.y) / 3;
		var cz = (t.v0.z + t.v1.z + t.v2.z) / 3;
		var dx = cx - hitWorldX;
		var dy = cy - hitWorldY;
		var dz = cz - hitWorldZ;
		var d = dx * dx + dy * dy + dz * dz;
		if (d < bestDist) {
			bestDist = d;
			bestIdx = i;
		}
	}
	return bestIdx;
}

function handleMouseMove(event) {
	if (!isMeshEditActive) return;

	var soupIdx = raycastSurface(event);

	if (soupIdx !== hoveredIndex) {
		hoveredIndex = soupIdx;
		updateHoverHighlight();
	}
}

function handleClick(event) {
	if (!isMeshEditActive) return;
	if (event.button !== 0) return; // Left click only

	// Re-raycast on click to get current face (hover may be stale)
	var clickedIdx = raycastSurface(event);
	if (clickedIdx < 0 || clickedIdx >= editSoup.length) return;

	// Consume the event so other 3D click handlers don't process it
	event.stopPropagation();

	// Debug: log selected triangle to verify index mapping
	var debugTri = editSoup[clickedIdx];
	if (debugTri) {
		console.log("MeshEditTool: clicked soupIdx=" + clickedIdx + "/" + editSoup.length +
			" mapLen=" + meshFaceToSoupIndex.length +
			" v0=(" + debugTri.v0.x.toFixed(1) + "," + debugTri.v0.y.toFixed(1) + "," + debugTri.v0.z.toFixed(1) + ")" +
			" mouse=(" + mouse.x.toFixed(3) + "," + mouse.y.toFixed(3) + ")");
	}

	hoveredIndex = clickedIdx;

	if (editMode === "face") {
		// Face mode: select/deselect individual triangle
		if (event.shiftKey) {
			// Toggle
			if (selectedIndices.has(hoveredIndex)) {
				selectedIndices.delete(hoveredIndex);
			} else {
				selectedIndices.add(hoveredIndex);
			}
		} else {
			// Replace selection
			selectedIndices.clear();
			selectedIndices.add(hoveredIndex);
		}
	} else if (editMode === "vertex") {
		// Vertex mode: find closest vertex of hit triangle, select all tris sharing it
		var hitTri = editSoup[hoveredIndex];
		if (!hitTri) return;

		// Re-raycast to get 3D hit point (raycaster was set up by raycastSurface)
		var meshObj = window.threeRenderer.surfaceMeshMap.get(editSurfaceId);
		if (!meshObj) return;

		var intersects = [];
		meshObj.traverse(function (child) {
			if (child.isMesh) {
				var hits = raycaster.intersectObject(child, false);
				for (var h = 0; h < hits.length; h++) intersects.push(hits[h]);
			}
		});
		intersects.sort(function (a, b) { return a.distance - b.distance; });
		var hitPoint = intersects.length > 0 ? intersects[0].point : null;

		// Convert hit point back to world coords
		var ox = window.threeLocalOriginX || 0;
		var oy = window.threeLocalOriginY || 0;
		var worldHit = hitPoint ? { x: hitPoint.x + ox, y: hitPoint.y + oy, z: hitPoint.z } : null;

		// Find closest vertex of the hit triangle
		var targetVert = null;
		if (worldHit) {
			var verts = [hitTri.v0, hitTri.v1, hitTri.v2];
			var minDist = Infinity;
			for (var vi = 0; vi < 3; vi++) {
				var dx = verts[vi].x - worldHit.x;
				var dy = verts[vi].y - worldHit.y;
				var dz = verts[vi].z - worldHit.z;
				var d = dx * dx + dy * dy + dz * dz;
				if (d < minDist) {
					minDist = d;
					targetVert = verts[vi];
				}
			}
		} else {
			targetVert = hitTri.v0; // Fallback
		}

		// Select all triangles sharing this vertex (within tolerance)
		var tol = 0.001;
		var tol2 = tol * tol;
		var vertexTris = findTrisSharingVertex(targetVert, tol2);

		if (event.shiftKey) {
			// Add to selection
			for (var vti = 0; vti < vertexTris.length; vti++) {
				selectedIndices.add(vertexTris[vti]);
			}
		} else {
			// Replace selection
			selectedIndices.clear();
			for (var vti2 = 0; vti2 < vertexTris.length; vti2++) {
				selectedIndices.add(vertexTris[vti2]);
			}
		}
	}

	updateSelectionHighlight();
	updateToolbarCount();
}

function findTrisSharingVertex(vert, tol2) {
	var result = [];
	for (var i = 0; i < editSoup.length; i++) {
		var t = editSoup[i];
		if (vertexMatch(t.v0, vert, tol2) || vertexMatch(t.v1, vert, tol2) || vertexMatch(t.v2, vert, tol2)) {
			result.push(i);
		}
	}
	return result;
}

function vertexMatch(a, b, tol2) {
	var dx = a.x - b.x;
	var dy = a.y - b.y;
	var dz = a.z - b.z;
	return (dx * dx + dy * dy + dz * dz) < tol2;
}

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

function handleKeyDown(event) {
	if (!isMeshEditActive) return;

	if (event.key === "Escape") {
		if (selectedIndices.size > 0) {
			// Clear selection first
			selectedIndices.clear();
			updateSelectionHighlight();
			updateToolbarCount();
		} else {
			// Exit tool
			cancelMeshEditMode();
		}
		event.preventDefault();
		return;
	}

	if (event.key === "Delete" || event.key === "Backspace") {
		if (selectedIndices.size > 0) {
			deleteSelectedTriangles();
		}
		event.preventDefault();
		return;
	}

	// Ctrl+A: select all
	if ((event.ctrlKey || event.metaKey) && event.key === "a") {
		selectedIndices.clear();
		for (var i = 0; i < editSoup.length; i++) {
			selectedIndices.add(i);
		}
		updateSelectionHighlight();
		updateToolbarCount();
		event.preventDefault();
		return;
	}
}

// =============================================================================
// DELETION
// =============================================================================

function deleteSelectedTriangles() {
	if (selectedIndices.size === 0) return;

	// Build sorted array of soup indices to delete (ascending for undo storage)
	var sortedAsc = Array.from(selectedIndices).sort(function (a, b) { return a - b; });

	// Map soup indices → surface.triangles indices
	var surfaceIndicesAsc = [];
	for (var i = 0; i < sortedAsc.length; i++) {
		var soupIdx = sortedAsc[i];
		var surfIdx = soupToSurfaceIndex[soupIdx];
		if (surfIdx !== undefined && surfIdx < editSurface.triangles.length) {
			surfaceIndicesAsc.push(surfIdx);
		}
	}
	surfaceIndicesAsc.sort(function (a, b) { return a - b; });

	// Store entries for undo (surface.triangles index + triangle data)
	var deletedEntries = [];
	for (var si = 0; si < surfaceIndicesAsc.length; si++) {
		deletedEntries.push({
			index: surfaceIndicesAsc[si],
			triangle: JSON.parse(JSON.stringify(editSurface.triangles[surfaceIndicesAsc[si]]))
		});
	}

	// Remove triangles descending to preserve indices
	for (var d = surfaceIndicesAsc.length - 1; d >= 0; d--) {
		editSurface.triangles.splice(surfaceIndicesAsc[d], 1);
	}

	// Clear selection
	selectedIndices.clear();
	hoveredIndex = -1;

	// Push undo action
	var action = new DeleteTrianglesAction(editSurface, deletedEntries,
		"Delete " + deletedEntries.length + " triangle" + (deletedEntries.length !== 1 ? "s" : ""));
	if (window.undoManager) {
		// Push without executing (already applied)
		window.undoManager.undoStack.push(action);
		window.undoManager.redoStack = [];
		if (window.undoManager.updateButtonStates) {
			window.undoManager.updateButtonStates();
		}
	}

	// Apply mesh changes
	applyMeshChanges();

	// Auto-repair if checked
	if (autoRepair) {
		runAutoRepair();
	}

	console.log("MeshEditTool: deleted " + deletedEntries.length + " triangles");
}

function applyMeshChanges() {
	// Invalidate 2D cache
	if (typeof window.invalidateSurfaceCache === "function") {
		window.invalidateSurfaceCache(editSurfaceId);
	}

	// Remove the specific surface mesh from surfaceMeshMap so drawSurfaceThreeJS
	// rebuilds it (otherwise it sees "already in scene" and returns early)
	var renderer = window.threeRenderer;
	if (renderer && renderer.surfaceMeshMap) {
		var oldMesh = renderer.surfaceMeshMap.get(editSurfaceId);
		if (oldMesh) {
			if (renderer.surfacesGroup) {
				renderer.surfacesGroup.remove(oldMesh);
			}
			// Dispose geometry/materials
			oldMesh.traverse(function (child) {
				if (child.geometry) child.geometry.dispose();
				if (child.material) {
					if (Array.isArray(child.material)) {
						child.material.forEach(function (m) { m.dispose(); });
					} else {
						child.material.dispose();
					}
				}
			});
			renderer.surfaceMeshMap.delete(editSurfaceId);
		}
	}

	// Save to IndexedDB
	if (window.saveSurfaceToDB) {
		window.saveSurfaceToDB(editSurfaceId).catch(function (err) {
			console.error("MeshEditTool: failed to save surface:", err);
		});
	}

	// Targeted single-surface rebuild — avoids full drawData which triggers
	// analysis cache invalidation and volume recalculation (GPU exhaustion)
	var surface = editSurface;
	if (surface && renderer) {
		var tris = surface.triangles || [];
		var minZ = Infinity, maxZ = -Infinity;
		if (surface.meshBounds) {
			minZ = surface.meshBounds.minZ;
			maxZ = surface.meshBounds.maxZ;
		} else {
			// Compute bounds from soup
			for (var bi = 0; bi < editSoup.length; bi++) {
				var bt = editSoup[bi];
				var zvals = [bt.v0.z, bt.v1.z, bt.v2.z];
				for (var bj = 0; bj < 3; bj++) {
					if (zvals[bj] < minZ) minZ = zvals[bj];
					if (zvals[bj] > maxZ) maxZ = zvals[bj];
				}
			}
		}
		if (surface.minLimit != null) minZ = surface.minLimit;
		if (surface.maxLimit != null) maxZ = surface.maxLimit;
		var gradient = surface.gradient || "default";
		var transparency = surface.transparency || 1.0;
		drawSurfaceThreeJS(editSurfaceId, tris, minZ, maxZ, gradient, transparency, surface);
	}

	// Re-add highlight group to scene if it was removed
	if (highlightGroup && renderer && renderer.scene) {
		if (!highlightGroup.parent) {
			renderer.scene.add(highlightGroup);
		}
	}

	// Request render
	requestRender();

	// Update tree view
	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}

	// Rebuild soup and map for continued editing
	rebuildSoupAndMap();
	updateSelectionHighlight();
	updateToolbarCount();
}

function runAutoRepair() {
	var soup = extractTriangles(editSurface);
	if (soup.length === 0) return;

	var result = capBoundaryLoopsSequential(soup, 0.001, 3);
	if (result && result.length > soup.length) {
		// Convert back to surface format
		var newTris = [];
		for (var i = 0; i < result.length; i++) {
			newTris.push({
				vertices: [
					{ x: result[i].v0.x, y: result[i].v0.y, z: result[i].v0.z },
					{ x: result[i].v1.x, y: result[i].v1.y, z: result[i].v1.z },
					{ x: result[i].v2.x, y: result[i].v2.y, z: result[i].v2.z }
				]
			});
		}
		editSurface.triangles = newTris;
		applyMeshChanges();
		console.log("MeshEditTool: auto-repair added " + (result.length - soup.length) + " cap triangles");
	}
}

// =============================================================================
// HIGHLIGHT RENDERING
// =============================================================================

function clearHighlights() {
	if (!highlightGroup) return;

	highlightGroup.traverse(function (child) {
		if (child.geometry) child.geometry.dispose();
		if (child.material) child.material.dispose();
	});

	// Remove all children
	while (highlightGroup.children.length > 0) {
		highlightGroup.remove(highlightGroup.children[0]);
	}

	hoverMesh = null;
	selectionMesh = null;
	selectionWire = null;
}

function updateHoverHighlight() {
	// Remove old hover mesh
	if (hoverMesh) {
		highlightGroup.remove(hoverMesh);
		if (hoverMesh.geometry) hoverMesh.geometry.dispose();
		if (hoverMesh.material) hoverMesh.material.dispose();
		hoverMesh = null;
	}

	if (hoveredIndex < 0 || hoveredIndex >= editSoup.length) {
		requestRender();
		return;
	}

	// Don't show hover on already-selected triangle
	if (selectedIndices.has(hoveredIndex)) {
		requestRender();
		return;
	}

	var tri = editSoup[hoveredIndex];
	hoverMesh = buildSingleTriMesh([tri], 0xFFFF00, 0.4); // yellow, semi-transparent
	if (hoverMesh) {
		highlightGroup.add(hoverMesh);
	}

	requestRender();
}

function updateSelectionHighlight() {
	// Remove old selection meshes
	if (selectionMesh) {
		highlightGroup.remove(selectionMesh);
		if (selectionMesh.geometry) selectionMesh.geometry.dispose();
		if (selectionMesh.material) selectionMesh.material.dispose();
		selectionMesh = null;
	}
	if (selectionWire) {
		highlightGroup.remove(selectionWire);
		if (selectionWire.geometry) selectionWire.geometry.dispose();
		if (selectionWire.material) selectionWire.material.dispose();
		selectionWire = null;
	}

	if (selectedIndices.size === 0) {
		requestRender();
		return;
	}

	// Collect selected triangles
	var selTris = [];
	selectedIndices.forEach(function (idx) {
		if (idx >= 0 && idx < editSoup.length) {
			selTris.push(editSoup[idx]);
		}
	});

	if (selTris.length === 0) {
		requestRender();
		return;
	}

	// Red filled triangles
	selectionMesh = buildSingleTriMesh(selTris, 0xFF0000, 0.5);
	if (selectionMesh) {
		highlightGroup.add(selectionMesh);
	}

	// Red wireframe edges
	selectionWire = buildTriEdges(selTris, 0xFF0000);
	if (selectionWire) {
		highlightGroup.add(selectionWire);
	}

	requestRender();
}

/**
 * Build a Three.js Mesh from an array of soup triangles.
 * Uses the same pattern as SurfacesContextMenu.js buildTriHighlight.
 */
function buildSingleTriMesh(tris, color, opacity) {
	if (!tris || tris.length === 0) return null;

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	var positions = new Float32Array(tris.length * 9);

	for (var i = 0; i < tris.length; i++) {
		var t = tris[i];
		var lv0 = toLocal ? toLocal(t.v0.x, t.v0.y) : { x: t.v0.x, y: t.v0.y };
		var lv1 = toLocal ? toLocal(t.v1.x, t.v1.y) : { x: t.v1.x, y: t.v1.y };
		var lv2 = toLocal ? toLocal(t.v2.x, t.v2.y) : { x: t.v2.x, y: t.v2.y };
		positions[i * 9] = lv0.x;
		positions[i * 9 + 1] = lv0.y;
		positions[i * 9 + 2] = t.v0.z;
		positions[i * 9 + 3] = lv1.x;
		positions[i * 9 + 4] = lv1.y;
		positions[i * 9 + 5] = t.v1.z;
		positions[i * 9 + 6] = lv2.x;
		positions[i * 9 + 7] = lv2.y;
		positions[i * 9 + 8] = t.v2.z;
	}

	var geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

	var mat = new THREE.MeshBasicMaterial({
		color: color,
		transparent: true,
		opacity: opacity,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false
	});

	var mesh = new THREE.Mesh(geom, mat);
	mesh.renderOrder = 999;
	mesh.frustumCulled = false;
	return mesh;
}

/**
 * Build wireframe edge LineSegments from soup triangles.
 */
function buildTriEdges(tris, color) {
	if (!tris || tris.length === 0) return null;

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	// 3 edges per triangle, 2 points per edge, 3 coords per point
	var positions = new Float32Array(tris.length * 18);

	for (var i = 0; i < tris.length; i++) {
		var t = tris[i];
		var lv0 = toLocal ? toLocal(t.v0.x, t.v0.y) : { x: t.v0.x, y: t.v0.y };
		var lv1 = toLocal ? toLocal(t.v1.x, t.v1.y) : { x: t.v1.x, y: t.v1.y };
		var lv2 = toLocal ? toLocal(t.v2.x, t.v2.y) : { x: t.v2.x, y: t.v2.y };
		var base = i * 18;
		// Edge 0→1
		positions[base] = lv0.x; positions[base + 1] = lv0.y; positions[base + 2] = t.v0.z;
		positions[base + 3] = lv1.x; positions[base + 4] = lv1.y; positions[base + 5] = t.v1.z;
		// Edge 1→2
		positions[base + 6] = lv1.x; positions[base + 7] = lv1.y; positions[base + 8] = t.v1.z;
		positions[base + 9] = lv2.x; positions[base + 10] = lv2.y; positions[base + 11] = t.v2.z;
		// Edge 2→0
		positions[base + 12] = lv2.x; positions[base + 13] = lv2.y; positions[base + 14] = t.v2.z;
		positions[base + 15] = lv0.x; positions[base + 16] = lv0.y; positions[base + 17] = t.v0.z;
	}

	var geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

	var mat = new THREE.LineBasicMaterial({
		color: color,
		linewidth: 2,
		depthTest: false,
		depthWrite: false,
		transparent: true
	});

	var lines = new THREE.LineSegments(geom, mat);
	lines.renderOrder = 999;
	lines.frustumCulled = false;
	return lines;
}

function requestRender() {
	if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
		if (window.threeRenderer.requestRender) {
			window.threeRenderer.requestRender();
		}
	}
}

// =============================================================================
// TOOLBAR DIALOG
// =============================================================================

/**
 * Create a target-style icon button (same pattern as SurfaceBooleanDialog pick buttons).
 */
function createTargetButton(iconSrc, title, onClick) {
	var dark = document.body.classList.contains("dark-mode");
	var btn = document.createElement("button");
	btn.title = title;
	btn.style.width = "28px";
	btn.style.height = "28px";
	btn.style.padding = "2px";
	btn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
	btn.style.borderRadius = "4px";
	btn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
	btn.style.cursor = "pointer";
	btn.style.flexShrink = "0";
	btn.style.display = "flex";
	btn.style.alignItems = "center";
	btn.style.justifyContent = "center";

	var img = document.createElement("img");
	img.src = iconSrc;
	img.style.width = "20px";
	img.style.height = "20px";
	img.style.filter = dark ? "invert(0.8)" : "invert(0.2)";
	btn.appendChild(img);

	btn.addEventListener("click", onClick);
	return btn;
}

function setTargetButtonActive(btn, active) {
	if (active) {
		btn.style.background = "var(--selected-colour, #ff4444)";
		btn.style.borderColor = "#ff0000";
		btn.style.boxShadow = "inset 0 2px 4px rgba(0,0,0,0.3)";
	} else {
		var dark = document.body.classList.contains("dark-mode");
		btn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		btn.style.borderColor = dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
		btn.style.boxShadow = "none";
	}
}

function showToolbar() {
	if (toolbarDialog) {
		toolbarDialog.close();
		toolbarDialog = null;
	}

	var content = document.createElement("div");
	content.style.display = "flex";
	content.style.alignItems = "center";
	content.style.gap = "6px";
	content.style.padding = "4px";
	content.style.flexWrap = "wrap";

	// Face mode button (target-arrow style)
	var faceBtn = createTargetButton("icons/triangle-minus.png",
		"Face mode: click to select individual triangles",
		function () { editMode = "face"; updateModeButtons(); });

	// Vertex mode button (target-arrow style)
	var vertBtn = createTargetButton("icons/pointer-x.png",
		"Vertex mode: click to select all triangles sharing nearest vertex",
		function () { editMode = "vertex"; updateModeButtons(); });

	function updateModeButtons() {
		setTargetButtonActive(faceBtn, editMode === "face");
		setTargetButtonActive(vertBtn, editMode === "vertex");
	}

	updateModeButtons();

	// Separator
	var sep = document.createElement("span");
	sep.textContent = "|";
	sep.className = "labelWhite12";
	sep.style.opacity = "0.4";

	// Count label
	var countLabel = document.createElement("span");
	countLabel.id = "meshEditCount";
	countLabel.className = "labelWhite12";
	countLabel.textContent = "0 selected";

	// Delete button
	var deleteBtn = document.createElement("button");
	deleteBtn.className = "floating-dialog-btn";
	deleteBtn.textContent = "Delete";
	deleteBtn.style.padding = "2px 8px";
	deleteBtn.addEventListener("click", function () {
		deleteSelectedTriangles();
	});

	// Clear button
	var clearBtn = document.createElement("button");
	clearBtn.className = "floating-dialog-btn";
	clearBtn.textContent = "Clear";
	clearBtn.style.padding = "2px 8px";
	clearBtn.addEventListener("click", function () {
		selectedIndices.clear();
		updateSelectionHighlight();
		updateToolbarCount();
	});

	// Auto-repair checkbox
	var repairLabel = document.createElement("label");
	repairLabel.className = "labelWhite12";
	repairLabel.style.display = "flex";
	repairLabel.style.alignItems = "center";
	repairLabel.style.gap = "4px";
	repairLabel.style.cursor = "pointer";

	var repairCb = document.createElement("input");
	repairCb.type = "checkbox";
	repairCb.checked = autoRepair;
	repairCb.addEventListener("change", function () {
		autoRepair = repairCb.checked;
	});

	var repairText = document.createElement("span");
	repairText.textContent = "Auto-repair";

	repairLabel.appendChild(repairCb);
	repairLabel.appendChild(repairText);

	// Assemble
	content.appendChild(faceBtn);
	content.appendChild(vertBtn);
	content.appendChild(sep);
	content.appendChild(countLabel);
	content.appendChild(deleteBtn);
	content.appendChild(clearBtn);
	content.appendChild(repairLabel);

	toolbarDialog = new window.FloatingDialog({
		title: "Mesh Edit",
		content: content,
		width: 420,
		height: 80,
		showConfirm: false,
		showCancel: true,
		cancelText: "Close",
		onCancel: function () {
			cancelMeshEditMode();
		}
	});
	toolbarDialog.show();
}

function updateToolbarCount() {
	var countEl = document.getElementById("meshEditCount");
	if (countEl) {
		countEl.textContent = selectedIndices.size + " selected";
	}
}

// =============================================================================
// EXPOSE TO WINDOW
// =============================================================================

window.isMeshEditActive = false;
window.startMeshEditMode = startMeshEditMode;
window.cancelMeshEditMode = cancelMeshEditMode;

export {
	startMeshEditMode,
	cancelMeshEditMode
};
