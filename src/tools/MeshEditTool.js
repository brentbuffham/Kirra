// src/tools/MeshEditTool.js
// =============================================================================
// MESH EDIT TOOL — Triangle/Vertex Edit for Surface Meshes
// =============================================================================
// Two selection modes:
//   Face mode:   click to select individual triangles → Delete, Invert
//   Vertex mode: click to select individual vertices (magenta points) →
//                Delete (tris sharing verts), Invert, Weld, Move
// Sub-modes: Insert (3-pick), Move (click+drag)
// Created: 2026-03-02, Reworked: 2026-03-06

import * as THREE from "three";
import { extractTriangles } from "../helpers/SurfaceIntersectionHelper.js";
import { capBoundaryLoopsSequential, detectMeshProblems } from "../helpers/MeshRepairHelper.js";
import { drawSurfaceThreeJS } from "../draw/canvas3DDrawing.js";
import { UndoableAction, ActionTypes } from "./UndoManager.js";
import { MeshLine, MeshLineMaterial } from "../helpers/meshLineModified.js";

// =============================================================================
// STATE VARIABLES
// =============================================================================

var isMeshEditActive = false;
var editSurfaceId = null;
var editSurface = null;
var editMode = "face"; // "face" or "vertex"
var selectedIndices = new Set(); // soup indices of selected triangles (face mode)
var selectedVertices = []; // [{x, y, z}, ...] world-coord vertex positions (vertex mode)
var hoveredIndex = -1; // soup index of hovered triangle
var editSoup = []; // triangle soup [{v0, v1, v2}, ...]
var meshFaceToSoupIndex = []; // Three.js face → soup index mapping
var soupToSurfaceIndex = []; // soup index → surface.triangles index
var autoRepair = false;
var showNormals = false;
var showOpenEdges = false;
var normalsArrowsMesh = null; // THREE.LineSegments for normal arrows
var openEdgesGroup = null; // THREE.Group for pink open-edge fat lines

// Sub-mode for operations requiring sequential picks: null | "insert" | "move"
var activeSubMode = null;

// Insert mode state
var insertPicks = []; // [{x,y,z}, ...] up to 3 vertex positions
var insertPreviewMesh = null;

// Move mode state
var moveVertex = null; // {x,y,z} original position
var moveVertexDragging = false;
var moveVertexOriginal = null; // snapshot for undo
var moveAffectedIndices = []; // soup indices sharing this vertex
var moveAdjacentPlane = null; // {normal, point} for plane constraint
var moveHighlightMesh = null;

// Three.js overlay objects
var highlightGroup = null;
var hoverMesh = null;
var selectionMesh = null;
var selectionWire = null;
var wireframeOverlay = null; // Full-mesh edge wireframe overlay
var vertexPointsMesh = null; // THREE.Points for magenta vertex rendering
var vertexAffectedMesh = null; // faint red tris sharing selected vertices

// Toolbar dialog reference
var toolbarDialog = null;

// References to toolbar buttons (for active state / enable-disable)
var faceBtn = null;
var vertBtn = null;
var insertBtn = null;
var moveBtn = null;
var weldBtn = null;
var deleteBtn = null;
var invertBtn = null;
var clearBtn = null;

// Event handler references (for removal)
var onMouseMove = null;
var onClick = null;
var onKeyDown = null;
var onMouseUp = null;

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
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			selectedIndices.clear();
			selectedVertices = [];
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	refresh() {
		refreshSurface(this.surfaceId, this.surface);
	}
}

// =============================================================================
// INVERT TRIANGLES UNDO ACTION
// =============================================================================

class InvertTrianglesAction extends UndoableAction {
	constructor(surface, surfaceIndices, description) {
		super("INVERT_TRIANGLES", false, false);
		this.affectsSurfaces = true;
		this.surfaceId = surface.id;
		this.surface = surface;
		this.surfaceIndices = surfaceIndices; // indices into surface.triangles
		this.description = description || "Invert " + surfaceIndices.length + " triangle(s)";
	}

	execute() {
		// Already applied before pushing
	}

	undo() {
		invertTrianglesAtIndices(this.surface, this.surfaceIndices);
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	redo() {
		invertTrianglesAtIndices(this.surface, this.surfaceIndices);
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	refresh() {
		refreshSurface(this.surfaceId, this.surface);
	}
}

function invertTrianglesAtIndices(surface, indices) {
	for (var i = 0; i < indices.length; i++) {
		var tri = surface.triangles[indices[i]];
		if (tri && tri.vertices && tri.vertices.length >= 3) {
			var tmp = tri.vertices[1];
			tri.vertices[1] = tri.vertices[2];
			tri.vertices[2] = tmp;
		}
	}
}

// =============================================================================
// INSERT TRIANGLES UNDO ACTION
// =============================================================================

class InsertTrianglesAction extends UndoableAction {
	constructor(surface, insertedTriangles, description) {
		super("INSERT_TRIANGLES", false, false);
		this.affectsSurfaces = true;
		this.surfaceId = surface.id;
		this.surface = surface;
		this.insertedTriangles = insertedTriangles;
		this.insertCount = insertedTriangles.length;
		this.description = description || "Insert " + this.insertCount + " triangle(s)";
	}

	execute() { }

	undo() {
		this.surface.triangles.splice(this.surface.triangles.length - this.insertCount, this.insertCount);
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			selectedIndices.clear();
			selectedVertices = [];
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	redo() {
		for (var i = 0; i < this.insertedTriangles.length; i++) {
			this.surface.triangles.push(JSON.parse(JSON.stringify(this.insertedTriangles[i])));
		}
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	refresh() {
		refreshSurface(this.surfaceId, this.surface);
	}
}

// =============================================================================
// MOVE VERTEX UNDO ACTION
// =============================================================================

class MoveVertexAction extends UndoableAction {
	constructor(surface, affectedSurfaceIndices, oldVertexPositions, newVertexPositions, description) {
		super("MOVE_VERTEX", false, false);
		this.affectsSurfaces = true;
		this.surfaceId = surface.id;
		this.surface = surface;
		this.changes = [];
		for (var i = 0; i < affectedSurfaceIndices.length; i++) {
			this.changes.push(affectedSurfaceIndices[i]);
		}
		this.description = description || "Move vertex";
	}

	execute() { }

	undo() {
		for (var i = 0; i < this.changes.length; i++) {
			var c = this.changes[i];
			var tri = this.surface.triangles[c.surfIndex];
			if (tri && tri.vertices && tri.vertices[c.vertIndex]) {
				tri.vertices[c.vertIndex].x = c.oldPos.x;
				tri.vertices[c.vertIndex].y = c.oldPos.y;
				tri.vertices[c.vertIndex].z = c.oldPos.z;
			}
		}
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	redo() {
		for (var i = 0; i < this.changes.length; i++) {
			var c = this.changes[i];
			var tri = this.surface.triangles[c.surfIndex];
			if (tri && tri.vertices && tri.vertices[c.vertIndex]) {
				tri.vertices[c.vertIndex].x = c.newPos.x;
				tri.vertices[c.vertIndex].y = c.newPos.y;
				tri.vertices[c.vertIndex].z = c.newPos.z;
			}
		}
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	refresh() {
		refreshSurface(this.surfaceId, this.surface);
	}
}

// =============================================================================
// WELD VERTICES UNDO ACTION — supports N vertices → centroid
// =============================================================================

class WeldVerticesAction extends UndoableAction {
	constructor(surface, affectedChanges, removedEntries, description) {
		super("WELD_VERTICES", false, false);
		this.affectsSurfaces = true;
		this.surfaceId = surface.id;
		this.surface = surface;
		// Vertex position changes: [{surfIndex, vertIndex, oldPos, newPos}, ...]
		this.affectedChanges = affectedChanges;
		// Removed degenerate triangles: [{index, triangle}, ...] sorted ascending
		this.removedEntries = removedEntries;
		this.description = description || "Weld vertices";
	}

	execute() { }

	undo() {
		// Re-insert removed triangles
		for (var i = 0; i < this.removedEntries.length; i++) {
			var entry = this.removedEntries[i];
			this.surface.triangles.splice(entry.index, 0, entry.triangle);
		}
		// Restore old positions
		for (var j = 0; j < this.affectedChanges.length; j++) {
			var c = this.affectedChanges[j];
			var tri = this.surface.triangles[c.surfIndex];
			if (tri && tri.vertices && tri.vertices[c.vertIndex]) {
				tri.vertices[c.vertIndex].x = c.oldPos.x;
				tri.vertices[c.vertIndex].y = c.oldPos.y;
				tri.vertices[c.vertIndex].z = c.oldPos.z;
			}
		}
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			selectedIndices.clear();
			selectedVertices = [];
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	redo() {
		// Re-apply position changes
		for (var j = 0; j < this.affectedChanges.length; j++) {
			var c = this.affectedChanges[j];
			var tri = this.surface.triangles[c.surfIndex];
			if (tri && tri.vertices && tri.vertices[c.vertIndex]) {
				tri.vertices[c.vertIndex].x = c.newPos.x;
				tri.vertices[c.vertIndex].y = c.newPos.y;
				tri.vertices[c.vertIndex].z = c.newPos.z;
			}
		}
		// Re-remove degenerate triangles (descending)
		for (var i = this.removedEntries.length - 1; i >= 0; i--) {
			this.surface.triangles.splice(this.removedEntries[i].index, 1);
		}
		this.refresh();
		if (isMeshEditActive && editSurfaceId === this.surfaceId) {
			selectedIndices.clear();
			selectedVertices = [];
			rebuildSoupAndMap();
			updateSelectionHighlight();
		}
	}

	refresh() {
		refreshSurface(this.surfaceId, this.surface);
	}
}

// =============================================================================
// SHARED REFRESH HELPER
// =============================================================================

function refreshSurface(surfaceId, surface) {
	if (typeof window.invalidateSurfaceCache === "function") {
		window.invalidateSurfaceCache(surfaceId);
	}

	var renderer = window.threeRenderer;
	if (renderer && renderer.surfaceMeshMap) {
		var oldMesh = renderer.surfaceMeshMap.get(surfaceId);
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
			renderer.surfaceMeshMap.delete(surfaceId);
		}
	}

	if (surface && renderer) {
		var minZ = surface.meshBounds ? surface.meshBounds.minZ : 0;
		var maxZ = surface.meshBounds ? surface.meshBounds.maxZ : 100;
		if (surface.minLimit != null) minZ = surface.minLimit;
		if (surface.maxLimit != null) maxZ = surface.maxLimit;
		drawSurfaceThreeJS(surfaceId, surface.triangles || [], minZ, maxZ,
			surface.gradient || "default", surface.transparency || 1.0, surface);
	}

	if (window.saveSurfaceToDB) {
		window.saveSurfaceToDB(surfaceId).catch(function (err) {
			console.warn("MeshEditTool: save after undo/redo failed:", err);
		});
	}

	if (window.debouncedUpdateTreeView) {
		window.debouncedUpdateTreeView();
	}

	requestRender();
}

// =============================================================================
// START / CANCEL
// =============================================================================

function startMeshEditMode(surfaceId) {
	if (isMeshEditActive) {
		console.warn("MeshEditTool: already active, cancelling first");
		cancelMeshEditMode();
	}

	if (!window.threeInitialized || !window.threeRenderer) {
		if (window.showModalMessage) {
			window.showModalMessage("3D Required", "Switch to 3D view to use mesh editing.");
		}
		return;
	}

	var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceId) : null;
	if (!surface) {
		if (window.showModalMessage) {
			window.showModalMessage("No Surface", "Surface not found: " + surfaceId);
		}
		return;
	}

	if (surface.isTexturedMesh && surface.threeJSMesh) {
		if (window.showModalMessage) {
			window.showModalMessage("Not Supported", "Mesh editing is not supported for textured OBJ meshes.");
		}
		return;
	}

	if (!surface.triangles || surface.triangles.length === 0) {
		if (window.showModalMessage) {
			window.showModalMessage("Empty Surface", "This surface has no triangles to edit.");
		}
		return;
	}

	isMeshEditActive = true;
	editSurfaceId = surfaceId;
	editSurface = surface;
	editMode = "face";
	selectedIndices.clear();
	selectedVertices = [];
	hoveredIndex = -1;
	autoRepair = false;

	window.isMeshEditActive = true;

	rebuildSoupAndMap();

	var scene = window.threeRenderer.scene;
	highlightGroup = new THREE.Group();
	highlightGroup.name = "meshEditHighlights";
	highlightGroup.renderOrder = 999;
	scene.add(highlightGroup);

	var canvas = getThreeCanvas();
	var container = canvas ? canvas.parentElement : null;
	if (container) {
		onMouseMove = handleMouseMove;
		onClick = handleClick;
		onKeyDown = handleKeyDown;
		onMouseUp = handleMouseUp;
		document.addEventListener("mousemove", onMouseMove);
		container.addEventListener("click", onClick, true);
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("mouseup", onMouseUp);
	}

	showToolbar();
	updateStatusForMode();

	console.log("MeshEditTool: started for " + surfaceId + " (" + editSoup.length + " triangles)");
}

function cancelMeshEditMode() {
	if (!isMeshEditActive) return;

	var canvas = getThreeCanvas();
	var container = canvas ? canvas.parentElement : null;
	if (onMouseMove) document.removeEventListener("mousemove", onMouseMove);
	if (onClick && container) container.removeEventListener("click", onClick, true);
	if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
	if (onMouseUp) document.removeEventListener("mouseup", onMouseUp);
	onMouseMove = null;
	onClick = null;
	onKeyDown = null;
	onMouseUp = null;

	clearHighlights();
	if (highlightGroup) {
		var scene = window.threeRenderer && window.threeRenderer.scene;
		if (scene) scene.remove(highlightGroup);
		highlightGroup = null;
	}

	if (toolbarDialog) {
		toolbarDialog.close();
		toolbarDialog = null;
	}

	isMeshEditActive = false;
	editSurfaceId = null;
	editSurface = null;
	selectedIndices.clear();
	selectedVertices = [];
	hoveredIndex = -1;
	editSoup = [];
	meshFaceToSoupIndex = [];
	soupToSurfaceIndex = [];
	activeSubMode = null;
	insertPicks = [];
	moveVertex = null;
	moveVertexDragging = false;
	moveVertexOriginal = null;
	moveAffectedIndices = [];
	moveAdjacentPlane = null;
	clearInsertPreview();
	clearMoveHighlight();
	clearVertexHighlight();

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
	rebuildWireframeOverlay();
	updateNormalsOverlay();
	updateOpenEdgesOverlay();
}

function buildIndexMap() {
	meshFaceToSoupIndex = [];
	soupToSurfaceIndex = [];
	var triangles = editSurface.triangles;
	var points = editSurface.points;
	if (!triangles) return;

	var soupIdx = 0;

	for (var i = 0; i < triangles.length; i++) {
		var tri = triangles[i];
		var v0, v1, v2;
		var soupValid = false;
		var meshValid = false;

		if (tri.vertices && Array.isArray(tri.vertices) && tri.vertices.length >= 3) {
			v0 = tri.vertices[0];
			v1 = tri.vertices[1];
			v2 = tri.vertices[2];
			if (v0 && v1 && v2) {
				soupValid = true;
				if (!isNaN(v0.x) && !isNaN(v0.y) && !isNaN(v0.z) &&
					!isNaN(v1.x) && !isNaN(v1.y) && !isNaN(v1.z) &&
					!isNaN(v2.x) && !isNaN(v2.y) && !isNaN(v2.z)) {
					meshValid = true;
				}
			}
		} else if (tri.a !== undefined && tri.b !== undefined && tri.c !== undefined && points) {
			v0 = points[tri.a];
			v1 = points[tri.b];
			v2 = points[tri.c];
			if (v0 && v1 && v2) {
				soupValid = true;
			}
			meshValid = false;
		} else if (tri.indices && Array.isArray(tri.indices) && tri.indices.length >= 3 && points) {
			v0 = points[tri.indices[0]];
			v1 = points[tri.indices[1]];
			v2 = points[tri.indices[2]];
			if (v0 && v1 && v2) {
				soupValid = true;
			}
			meshValid = false;
		}

		if (meshValid) {
			meshFaceToSoupIndex.push(soupIdx);
		}

		if (soupValid) {
			soupToSurfaceIndex.push(i);
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

	var rect = canvas.getBoundingClientRect();
	if (event.clientX < rect.left || event.clientX > rect.right ||
		event.clientY < rect.top || event.clientY > rect.bottom) {
		return -1;
	}

	mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	renderer.camera.updateMatrixWorld(true);
	raycaster.setFromCamera(mouse, renderer.camera);

	var meshObj = renderer.surfaceMeshMap.get(editSurfaceId);
	if (!meshObj) return -1;

	var intersects = raycaster.intersectObject(meshObj, true);
	if (intersects.length === 0) return -1;

	var hit = intersects[0];
	if (!hit.point) return -1;

	// Use Three.js faceIndex directly via the meshFaceToSoupIndex mapping.
	// This selects the exact triangle hit rather than the nearest centroid,
	// which fixes selection of slivers and narrow triangles.
	if (hit.faceIndex !== undefined && hit.faceIndex < meshFaceToSoupIndex.length) {
		return meshFaceToSoupIndex[hit.faceIndex];
	}

	// Fallback: point-in-triangle test against soup using the world hit point
	var ox = window.threeLocalOriginX || 0;
	var oy = window.threeLocalOriginY || 0;
	var hitWorldX = hit.point.x + ox;
	var hitWorldY = hit.point.y + oy;
	var hitWorldZ = hit.point.z;

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

/**
 * Get the 3D world hit point from the current raycaster state.
 */
function getWorldHitPoint() {
	var renderer = window.threeRenderer;
	var meshObj = renderer ? renderer.surfaceMeshMap.get(editSurfaceId) : null;
	if (!meshObj) return null;

	var intersects = [];
	meshObj.traverse(function (child) {
		if (child.isMesh) {
			var hits = raycaster.intersectObject(child, false);
			for (var h = 0; h < hits.length; h++) intersects.push(hits[h]);
		}
	});
	intersects.sort(function (a, b) { return a.distance - b.distance; });
	if (intersects.length === 0) return null;

	var hitPoint = intersects[0].point;
	var ox = window.threeLocalOriginX || 0;
	var oy = window.threeLocalOriginY || 0;
	return { x: hitPoint.x + ox, y: hitPoint.y + oy, z: hitPoint.z };
}

/**
 * Find the nearest vertex of a soup triangle to a world point.
 */
function findNearestVertexOfTri(soupTri, worldHit) {
	var verts = [soupTri.v0, soupTri.v1, soupTri.v2];
	var bestVert = null;
	var bestDist = Infinity;
	for (var vi = 0; vi < 3; vi++) {
		var dx = verts[vi].x - worldHit.x;
		var dy = verts[vi].y - worldHit.y;
		var dz = verts[vi].z - worldHit.z;
		var d = dx * dx + dy * dy + dz * dz;
		if (d < bestDist) {
			bestDist = d;
			bestVert = verts[vi];
		}
	}
	return bestVert;
}

function handleMouseMove(event) {
	if (!isMeshEditActive) return;

	// Handle move mode dragging
	if (activeSubMode === "move" && moveVertexDragging && moveVertex) {
		handleMoveDrag(event);
		return;
	}

	var soupIdx = raycastSurface(event);

	if (soupIdx !== hoveredIndex) {
		hoveredIndex = soupIdx;
		updateHoverHighlight();
	}
}

function handleClick(event) {
	if (!isMeshEditActive) return;
	if (event.button !== 0) return;

	// Handle sub-mode clicks
	if (activeSubMode === "insert") {
		handleInsertClick(event);
		return;
	}
	if (activeSubMode === "move") {
		handleMoveClick(event);
		return;
	}

	// Re-raycast on click to get current face
	var clickedIdx = raycastSurface(event);
	if (clickedIdx < 0 || clickedIdx >= editSoup.length) return;

	event.stopPropagation();
	hoveredIndex = clickedIdx;

	if (editMode === "face") {
		// Face mode: select/deselect individual triangle
		if (event.shiftKey) {
			if (selectedIndices.has(hoveredIndex)) {
				selectedIndices.delete(hoveredIndex);
			} else {
				selectedIndices.add(hoveredIndex);
			}
		} else {
			selectedIndices.clear();
			selectedIndices.add(hoveredIndex);
		}
		updateSelectionHighlight();
	} else if (editMode === "vertex") {
		// Vertex mode: find nearest vertex → add to selectedVertices
		var hitTri = editSoup[hoveredIndex];
		if (!hitTri) return;

		var worldHit = getWorldHitPoint();
		var targetVert = worldHit ? findNearestVertexOfTri(hitTri, worldHit) : hitTri.v0;
		if (!targetVert) return;

		var vertPos = { x: targetVert.x, y: targetVert.y, z: targetVert.z };
		var tol2 = 0.001 * 0.001;

		if (event.shiftKey) {
			// Toggle vertex in/out of selection
			var existingIdx = findVertexInSelection(vertPos, tol2);
			if (existingIdx >= 0) {
				selectedVertices.splice(existingIdx, 1);
			} else {
				selectedVertices.push(vertPos);
			}
		} else {
			// Replace selection with single vertex
			selectedVertices = [vertPos];
		}
		updateVertexHighlight();
	}

	updateToolbarCount();
	updateButtonStates();
	updateStatusForSelection();
}

/**
 * Find index of a vertex in selectedVertices by position match.
 */
function findVertexInSelection(vert, tol2) {
	for (var i = 0; i < selectedVertices.length; i++) {
		if (vertexMatch(selectedVertices[i], vert, tol2)) return i;
	}
	return -1;
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

/**
 * Get soup indices of all triangles sharing any of the selected vertices.
 */
function getAffectedTriIndices() {
	var tol2 = 0.001 * 0.001;
	var affectedSet = new Set();
	for (var vi = 0; vi < selectedVertices.length; vi++) {
		var tris = findTrisSharingVertex(selectedVertices[vi], tol2);
		for (var ti = 0; ti < tris.length; ti++) {
			affectedSet.add(tris[ti]);
		}
	}
	return affectedSet;
}

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

function handleKeyDown(event) {
	if (!isMeshEditActive) return;

	// Don't capture keyboard when focus is in an input/textarea
	var tag = event.target && event.target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

	if (event.key === "Escape") {
		if (activeSubMode) {
			exitSubMode();
			event.preventDefault();
			return;
		}
		if (editMode === "face" && selectedIndices.size > 0) {
			selectedIndices.clear();
			updateSelectionHighlight();
			updateToolbarCount();
			updateButtonStates();
			updateStatusForMode();
		} else if (editMode === "vertex" && selectedVertices.length > 0) {
			selectedVertices = [];
			updateVertexHighlight();
			updateToolbarCount();
			updateButtonStates();
			updateStatusForMode();
		} else {
			cancelMeshEditMode();
		}
		event.preventDefault();
		return;
	}

	// Enter confirms insert mode picks
	if (event.key === "Enter" && activeSubMode === "insert" && insertPicks.length === 3) {
		commitInsertTriangle();
		event.preventDefault();
		return;
	}

	if (event.key === "Delete" || event.key === "Backspace") {
		if (editMode === "face" && selectedIndices.size > 0) {
			deleteSelectedTriangles();
		} else if (editMode === "vertex" && selectedVertices.length > 0) {
			deleteTrianglesForSelectedVertices();
		}
		event.preventDefault();
		return;
	}

	// Ctrl+A: select all
	if ((event.ctrlKey || event.metaKey) && event.key === "a") {
		if (editMode === "face") {
			selectedIndices.clear();
			for (var i = 0; i < editSoup.length; i++) {
				selectedIndices.add(i);
			}
			updateSelectionHighlight();
		}
		// Vertex mode: select all unique vertices
		if (editMode === "vertex") {
			selectAllVertices();
		}
		updateToolbarCount();
		updateButtonStates();
		updateStatusForSelection();
		event.preventDefault();
		return;
	}

	// Mode shortcuts (only when no sub-mode active)
	if (!activeSubMode) {
		if (event.key === "f" || event.key === "F") {
			switchToFaceMode();
			event.preventDefault();
			return;
		}
		if (event.key === "v" || event.key === "V") {
			switchToVertexMode();
			event.preventDefault();
			return;
		}
	}

	// Action shortcuts
	if (event.key === "w" || event.key === "W") {
		if (editMode === "vertex" && selectedVertices.length >= 2 && !activeSubMode) {
			weldSelectedVertices();
			event.preventDefault();
			return;
		}
	}
	if (event.key === "m" || event.key === "M") {
		if (editMode === "vertex" && !activeSubMode) {
			toggleMoveSubMode();
			event.preventDefault();
			return;
		}
	}
	if (event.key === "i" || event.key === "I") {
		toggleInsertSubMode();
		event.preventDefault();
		return;
	}
}

function selectAllVertices() {
	var tol2 = 0.001 * 0.001;
	selectedVertices = [];
	for (var i = 0; i < editSoup.length; i++) {
		var t = editSoup[i];
		var verts = [t.v0, t.v1, t.v2];
		for (var vi = 0; vi < 3; vi++) {
			if (findVertexInSelection(verts[vi], tol2) < 0) {
				selectedVertices.push({ x: verts[vi].x, y: verts[vi].y, z: verts[vi].z });
			}
		}
	}
	updateVertexHighlight();
}

// =============================================================================
// MODE SWITCHING
// =============================================================================

function switchToFaceMode() {
	if (editMode === "face") return;
	editMode = "face";
	// Clear vertex selection, keep face selection empty
	selectedVertices = [];
	clearVertexHighlight();
	selectedIndices.clear();
	updateSelectionHighlight();
	updateToolbarCount();
	updateButtonStates();
	updateModeButtons();
	updateStatusForMode();
	if (activeSubMode) exitSubMode();
}

function switchToVertexMode() {
	if (editMode === "vertex") return;
	editMode = "vertex";
	// Clear face selection
	selectedIndices.clear();
	updateSelectionHighlight();
	selectedVertices = [];
	updateVertexHighlight();
	updateToolbarCount();
	updateButtonStates();
	updateModeButtons();
	updateStatusForMode();
	if (activeSubMode) exitSubMode();
}

function updateModeButtons() {
	if (faceBtn) setTargetButtonActive(faceBtn, editMode === "face");
	if (vertBtn) setTargetButtonActive(vertBtn, editMode === "vertex");
}

// =============================================================================
// STATUS MESSAGES
// =============================================================================

function updateStatusForMode() {
	if (!window.updateStatusMessage) return;
	if (editMode === "face") {
		window.updateStatusMessage("Face mode: click to select, Shift+click to multi-select");
	} else {
		window.updateStatusMessage("Vertex mode: click to select vertices, Shift+click to multi-select");
	}
}

function updateStatusForSelection() {
	if (!window.updateStatusMessage) return;
	if (editMode === "face") {
		var n = selectedIndices.size;
		if (n > 0) {
			window.updateStatusMessage(n + " face" + (n !== 1 ? "s" : "") + " selected — Delete, Invert, or Shift+click more");
		} else {
			updateStatusForMode();
		}
	} else {
		var nv = selectedVertices.length;
		if (nv > 0) {
			window.updateStatusMessage(nv + " vert" + (nv !== 1 ? "s" : "") + " selected — Weld, Move, Delete, or Shift+click more");
		} else {
			updateStatusForMode();
		}
	}
}

// =============================================================================
// DELETION
// =============================================================================

function deleteSelectedTriangles() {
	if (selectedIndices.size === 0) return;

	var sortedAsc = Array.from(selectedIndices).sort(function (a, b) { return a - b; });

	var surfaceIndicesAsc = [];
	for (var i = 0; i < sortedAsc.length; i++) {
		var soupIdx = sortedAsc[i];
		var surfIdx = soupToSurfaceIndex[soupIdx];
		if (surfIdx !== undefined && surfIdx < editSurface.triangles.length) {
			surfaceIndicesAsc.push(surfIdx);
		}
	}
	surfaceIndicesAsc.sort(function (a, b) { return a - b; });

	var deletedEntries = [];
	for (var si = 0; si < surfaceIndicesAsc.length; si++) {
		deletedEntries.push({
			index: surfaceIndicesAsc[si],
			triangle: JSON.parse(JSON.stringify(editSurface.triangles[surfaceIndicesAsc[si]]))
		});
	}

	for (var d = surfaceIndicesAsc.length - 1; d >= 0; d--) {
		editSurface.triangles.splice(surfaceIndicesAsc[d], 1);
	}

	selectedIndices.clear();
	hoveredIndex = -1;

	var action = new DeleteTrianglesAction(editSurface, deletedEntries,
		"Delete " + deletedEntries.length + " triangle" + (deletedEntries.length !== 1 ? "s" : ""));
	pushUndoAction(action);

	applyMeshChanges();

	if (autoRepair) runAutoRepair();

	console.log("MeshEditTool: deleted " + deletedEntries.length + " triangles");
}

/**
 * Delete triangles sharing any selected vertex (vertex mode delete).
 */
function deleteTrianglesForSelectedVertices() {
	if (selectedVertices.length === 0) return;

	var affected = getAffectedTriIndices();
	if (affected.size === 0) return;

	// Temporarily put affected into selectedIndices and call deleteSelectedTriangles
	selectedIndices = affected;
	deleteSelectedTriangles();
	selectedVertices = [];
	updateVertexHighlight();
	updateToolbarCount();
	updateButtonStates();
}

function pushUndoAction(action) {
	if (window.undoManager) {
		window.undoManager.undoStack.push(action);
		window.undoManager.redoStack = [];
		if (window.undoManager.updateButtonStates) window.undoManager.updateButtonStates();
	}
}

function applyMeshChanges() {
	if (typeof window.invalidateSurfaceCache === "function") {
		window.invalidateSurfaceCache(editSurfaceId);
	}

	// Dispose ALL overlay objects (wireframe, selection, hover, vertex points)
	// so stale geometry from the old mesh state doesn't persist.
	clearHighlights();

	// Also dispose any stale CleanMeshDialog overlays (its wireframe persists
	// in a separate group named "cleanMeshHighlights")
	clearExternalOverlays();

	var renderer = window.threeRenderer;
	if (renderer && renderer.surfaceMeshMap) {
		var oldMesh = renderer.surfaceMeshMap.get(editSurfaceId);
		if (oldMesh) {
			if (renderer.surfacesGroup) {
				renderer.surfacesGroup.remove(oldMesh);
			}
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

	if (window.saveSurfaceToDB) {
		window.saveSurfaceToDB(editSurfaceId).catch(function (err) {
			console.error("MeshEditTool: failed to save surface:", err);
		});
	}

	var surface = editSurface;
	if (surface && renderer) {
		var tris = surface.triangles || [];
		var minZ = Infinity, maxZ = -Infinity;
		if (surface.meshBounds) {
			minZ = surface.meshBounds.minZ;
			maxZ = surface.meshBounds.maxZ;
		} else {
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

	if (highlightGroup && renderer && renderer.scene) {
		if (!highlightGroup.parent) {
			renderer.scene.add(highlightGroup);
		}
	}

	requestRender();

	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}

	rebuildSoupAndMap();
	updateSelectionHighlight();
	updateVertexHighlight();
	updateToolbarCount();
	updateButtonStates();
}

function runAutoRepair() {
	var soup = extractTriangles(editSurface);
	if (soup.length === 0) return;

	var result = capBoundaryLoopsSequential(soup, 0.001, 3);
	if (result && result.length > soup.length) {
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
// OPERATIONS: INVERT, INSERT, MOVE, WELD
// =============================================================================

function exitSubMode() {
	activeSubMode = null;
	insertPicks = [];
	moveVertex = null;
	moveVertexDragging = false;
	moveVertexOriginal = null;
	moveAffectedIndices = [];
	moveAdjacentPlane = null;
	clearInsertPreview();
	clearMoveHighlight();
	updateSubModeButtons();
	updateStatusForSelection();
	requestRender();
}

function updateSubModeButtons() {
	if (insertBtn) setTargetButtonActive(insertBtn, activeSubMode === "insert");
	if (moveBtn) setTargetButtonActive(moveBtn, activeSubMode === "move");
}

// ── INVERT NORMAL ──

function invertSelectedTriangles() {
	// In face mode, invert selected faces
	// In vertex mode, invert faces sharing selected vertices
	var soupIndices;
	if (editMode === "vertex" && selectedVertices.length > 0) {
		soupIndices = Array.from(getAffectedTriIndices());
	} else {
		soupIndices = Array.from(selectedIndices);
	}
	if (soupIndices.length === 0) return;

	soupIndices.sort(function (a, b) { return a - b; });
	var surfaceIndices = [];
	for (var i = 0; i < soupIndices.length; i++) {
		var surfIdx = soupToSurfaceIndex[soupIndices[i]];
		if (surfIdx !== undefined) surfaceIndices.push(surfIdx);
	}

	if (surfaceIndices.length === 0) return;

	invertTrianglesAtIndices(editSurface, surfaceIndices);

	var action = new InvertTrianglesAction(editSurface, surfaceIndices,
		"Invert " + surfaceIndices.length + " triangle(s)");
	pushUndoAction(action);

	applyMeshChanges();
	console.log("MeshEditTool: inverted " + surfaceIndices.length + " triangles");
}

// ── INSERT TRIANGLE (sub-mode) ──

function toggleInsertSubMode() {
	if (activeSubMode === "insert") {
		exitSubMode();
	} else {
		exitSubMode();
		activeSubMode = "insert";
		insertPicks = [];
		updateSubModeButtons();
		if (window.updateStatusMessage) {
			window.updateStatusMessage("Insert: pick vertex 1/3 (Enter to confirm, Esc to cancel)");
		}
	}
}

function handleInsertClick(event) {
	event.stopPropagation();

	var clickedIdx = raycastSurface(event);
	if (clickedIdx < 0) return;

	var worldHit = getWorldHitPoint();
	if (!worldHit) return;

	var hitTri = editSoup[clickedIdx];
	if (!hitTri) return;

	var bestVert = findNearestVertexOfTri(hitTri, worldHit);
	if (!bestVert) return;

	var vertPos = { x: bestVert.x, y: bestVert.y, z: bestVert.z };

	// Don't add duplicate
	for (var pi = 0; pi < insertPicks.length; pi++) {
		if (vertexMatch(insertPicks[pi], vertPos, 1e-8)) return;
	}

	insertPicks.push(vertPos);
	updateInsertPreview();

	if (insertPicks.length === 3) {
		// Auto-commit on 3rd pick
		commitInsertTriangle();
	} else {
		if (window.updateStatusMessage) {
			window.updateStatusMessage("Insert: pick vertex " + (insertPicks.length + 1) + "/3 (Esc to cancel)");
		}
	}
}

function commitInsertTriangle() {
	if (insertPicks.length !== 3) return;

	var countBefore = editSurface.triangles.length;

	var newTri = {
		vertices: [
			{ x: insertPicks[0].x, y: insertPicks[0].y, z: insertPicks[0].z },
			{ x: insertPicks[1].x, y: insertPicks[1].y, z: insertPicks[1].z },
			{ x: insertPicks[2].x, y: insertPicks[2].y, z: insertPicks[2].z }
		]
	};

	editSurface.triangles.push(newTri);

	var action = new InsertTrianglesAction(editSurface, [JSON.parse(JSON.stringify(newTri))],
		"Insert 1 triangle");
	pushUndoAction(action);

	var picks = insertPicks.slice(); // save for post-commit highlight
	insertPicks = [];
	clearInsertPreview();

	try {
		applyMeshChanges();
	} catch (err) {
		console.error("MeshEditTool: applyMeshChanges failed after insert:", err);
	}

	// Select the newly inserted face so the user sees it highlighted
	// The new triangle is the last one in the soup after rebuild
	var newSoupIdx = editSoup.length - 1;
	if (newSoupIdx >= 0) {
		// Switch to face mode temporarily to show the new triangle highlighted
		var prevMode = editMode;
		editMode = "face";
		selectedIndices.clear();
		selectedIndices.add(newSoupIdx);
		updateSelectionHighlight();
		updateModeButtons();
		updateToolbarCount();
		updateButtonStates();
	}

	var countAfter = editSurface.triangles.length;
	console.log("MeshEditTool: inserted 1 triangle (faces: " + countBefore + " → " + countAfter + ")");

	if (window.updateStatusMessage) {
		window.updateStatusMessage("Inserted triangle (" + countAfter + " faces). Click [Insert] to add more, Esc to exit.");
	}
	// Exit insert sub-mode after commit so user sees the result
	activeSubMode = null;
	updateSubModeButtons();
}

function updateInsertPreview() {
	clearInsertPreview();
	if (insertPicks.length < 2) {
		showPickMarkers();
		requestRender();
		return;
	}

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;

	if (insertPicks.length >= 2) {
		// Show green edge lines between picks
		var edgePositions = new Float32Array(insertPicks.length * 2 * 3);
		var edgeIdx = 0;
		for (var ei = 0; ei < insertPicks.length - 1; ei++) {
			var lA = toLocal ? toLocal(insertPicks[ei].x, insertPicks[ei].y) : { x: insertPicks[ei].x, y: insertPicks[ei].y };
			var lB = toLocal ? toLocal(insertPicks[ei + 1].x, insertPicks[ei + 1].y) : { x: insertPicks[ei + 1].x, y: insertPicks[ei + 1].y };
			edgePositions[edgeIdx++] = lA.x; edgePositions[edgeIdx++] = lA.y; edgePositions[edgeIdx++] = insertPicks[ei].z;
			edgePositions[edgeIdx++] = lB.x; edgePositions[edgeIdx++] = lB.y; edgePositions[edgeIdx++] = insertPicks[ei + 1].z;
		}
		// Close edge if 3 picks
		if (insertPicks.length === 3) {
			var lC0 = toLocal ? toLocal(insertPicks[2].x, insertPicks[2].y) : { x: insertPicks[2].x, y: insertPicks[2].y };
			var lC1 = toLocal ? toLocal(insertPicks[0].x, insertPicks[0].y) : { x: insertPicks[0].x, y: insertPicks[0].y };
			var closePositions = new Float32Array(6);
			closePositions[0] = lC0.x; closePositions[1] = lC0.y; closePositions[2] = insertPicks[2].z;
			closePositions[3] = lC1.x; closePositions[4] = lC1.y; closePositions[5] = insertPicks[0].z;

			var closeGeom = new THREE.BufferGeometry();
			closeGeom.setAttribute("position", new THREE.BufferAttribute(closePositions, 3));
			var closeMat = new THREE.LineBasicMaterial({ color: 0x00FF00, linewidth: 2, depthTest: false, depthWrite: false });
			var closeLine = new THREE.LineSegments(closeGeom, closeMat);
			closeLine.renderOrder = 999;
			closeLine.frustumCulled = false;
			closeLine.userData.isPickMarker = true;
			if (highlightGroup) highlightGroup.add(closeLine);
		}

		var edgeGeom = new THREE.BufferGeometry();
		edgeGeom.setAttribute("position", new THREE.BufferAttribute(edgePositions.slice(0, edgeIdx), 3));
		var edgeMat = new THREE.LineBasicMaterial({ color: 0x00FF00, linewidth: 2, depthTest: false, depthWrite: false });
		var edgeLine = new THREE.LineSegments(edgeGeom, edgeMat);
		edgeLine.renderOrder = 999;
		edgeLine.frustumCulled = false;
		edgeLine.userData.isPickMarker = true;
		if (highlightGroup) highlightGroup.add(edgeLine);
	}

	if (insertPicks.length === 3) {
		// Show preview triangle (green, semi-transparent)
		var positions = new Float32Array(9);
		for (var i = 0; i < 3; i++) {
			var lv = toLocal ? toLocal(insertPicks[i].x, insertPicks[i].y) : { x: insertPicks[i].x, y: insertPicks[i].y };
			positions[i * 3] = lv.x;
			positions[i * 3 + 1] = lv.y;
			positions[i * 3 + 2] = insertPicks[i].z;
		}

		var geom = new THREE.BufferGeometry();
		geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		var mat = new THREE.MeshBasicMaterial({
			color: 0x00FF00,
			transparent: true,
			opacity: 0.4,
			side: THREE.DoubleSide,
			depthTest: false,
			depthWrite: false
		});
		insertPreviewMesh = new THREE.Mesh(geom, mat);
		insertPreviewMesh.renderOrder = 999;
		insertPreviewMesh.frustumCulled = false;
		if (highlightGroup) highlightGroup.add(insertPreviewMesh);
	}

	showPickMarkers();
	requestRender();
}

function showPickMarkers() {
	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	for (var i = 0; i < insertPicks.length; i++) {
		var lv = toLocal ? toLocal(insertPicks[i].x, insertPicks[i].y) : { x: insertPicks[i].x, y: insertPicks[i].y };
		var sphereGeom = new THREE.SphereGeometry(0.3, 8, 8);
		var sphereMat = new THREE.MeshBasicMaterial({
			color: 0x00FF00,
			depthTest: false,
			depthWrite: false
		});
		var sphere = new THREE.Mesh(sphereGeom, sphereMat);
		sphere.position.set(lv.x, lv.y, insertPicks[i].z);
		sphere.renderOrder = 999;
		sphere.frustumCulled = false;
		sphere.userData.isPickMarker = true;
		if (highlightGroup) highlightGroup.add(sphere);
	}
}

function clearInsertPreview() {
	if (insertPreviewMesh && highlightGroup) {
		highlightGroup.remove(insertPreviewMesh);
		if (insertPreviewMesh.geometry) insertPreviewMesh.geometry.dispose();
		if (insertPreviewMesh.material) insertPreviewMesh.material.dispose();
		insertPreviewMesh = null;
	}
	// Remove pick markers (spheres and edge lines)
	if (highlightGroup) {
		var toRemove = [];
		highlightGroup.traverse(function (child) {
			if (child.userData && child.userData.isPickMarker) toRemove.push(child);
		});
		for (var i = 0; i < toRemove.length; i++) {
			highlightGroup.remove(toRemove[i]);
			if (toRemove[i].geometry) toRemove[i].geometry.dispose();
			if (toRemove[i].material) toRemove[i].material.dispose();
		}
	}
}

// ── MOVE VERTEX (sub-mode) ──

function toggleMoveSubMode() {
	if (activeSubMode === "move") {
		exitSubMode();
	} else {
		exitSubMode();
		activeSubMode = "move";
		updateSubModeButtons();
		if (window.updateStatusMessage) {
			window.updateStatusMessage("Move: click a vertex to pick, then drag to reposition");
		}
	}
}

function handleMoveClick(event) {
	event.stopPropagation();

	if (moveVertexDragging) return;

	var clickedIdx = raycastSurface(event);
	if (clickedIdx < 0) return;

	var worldHit = getWorldHitPoint();
	if (!worldHit) return;

	var hitTri = editSoup[clickedIdx];
	if (!hitTri) return;

	var bestVert = findNearestVertexOfTri(hitTri, worldHit);
	if (!bestVert) return;

	moveVertex = bestVert;
	moveVertexOriginal = { x: bestVert.x, y: bestVert.y, z: bestVert.z };
	moveVertexDragging = true;

	var tol2 = 0.001 * 0.001;
	moveAffectedIndices = findTrisSharingVertex(bestVert, tol2);

	// Compute adjacent plane for constraint
	if (moveAffectedIndices.length > 0) {
		var firstTri = editSoup[moveAffectedIndices[0]];
		var ux = firstTri.v1.x - firstTri.v0.x;
		var uy = firstTri.v1.y - firstTri.v0.y;
		var uz = firstTri.v1.z - firstTri.v0.z;
		var vx = firstTri.v2.x - firstTri.v0.x;
		var vy = firstTri.v2.y - firstTri.v0.y;
		var vz = firstTri.v2.z - firstTri.v0.z;
		var nx = uy * vz - uz * vy;
		var ny = uz * vx - ux * vz;
		var nz = ux * vy - uy * vx;
		var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (nLen > 0) {
			nx /= nLen; ny /= nLen; nz /= nLen;
		}
		moveAdjacentPlane = {
			normal: { x: nx, y: ny, z: nz },
			point: { x: firstTri.v0.x, y: firstTri.v0.y, z: firstTri.v0.z }
		};
	}

	showMoveHighlight(bestVert);

	if (window.updateStatusMessage) {
		window.updateStatusMessage("Move: drag to reposition, release to commit");
	}
}

function handleMoveDrag(event) {
	if (!moveVertex || !moveAdjacentPlane) return;

	var renderer = window.threeRenderer;
	if (!renderer) return;

	var canvas = getThreeCanvas();
	if (!canvas) return;

	var rect = canvas.getBoundingClientRect();
	mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	renderer.camera.updateMatrixWorld(true);
	raycaster.setFromCamera(mouse, renderer.camera);

	var pn = moveAdjacentPlane.normal;
	var pp = moveAdjacentPlane.point;
	var ro = raycaster.ray.origin;
	var rd = raycaster.ray.direction;

	var denom = pn.x * rd.x + pn.y * rd.y + pn.z * rd.z;
	if (Math.abs(denom) < 1e-10) return;

	var t = ((pn.x * (pp.x - ro.x) + pn.y * (pp.y - ro.y) + pn.z * (pp.z - ro.z)) / denom);
	if (t < 0) return;

	var ox = window.threeLocalOriginX || 0;
	var oy = window.threeLocalOriginY || 0;
	var newX = ro.x + rd.x * t + ox;
	var newY = ro.y + rd.y * t + oy;
	var newZ = ro.z + rd.z * t;

	var tol2 = 0.001 * 0.001;
	for (var i = 0; i < moveAffectedIndices.length; i++) {
		var tri = editSoup[moveAffectedIndices[i]];
		var verts = [tri.v0, tri.v1, tri.v2];
		for (var vi = 0; vi < 3; vi++) {
			if (vertexMatch(verts[vi], moveVertex, tol2)) {
				verts[vi].x = newX;
				verts[vi].y = newY;
				verts[vi].z = newZ;
			}
		}
	}

	moveVertex.x = newX;
	moveVertex.y = newY;
	moveVertex.z = newZ;

	showMoveHighlight(moveVertex);
	requestRender();
}

function handleMouseUp(event) {
	if (!isMeshEditActive) return;
	if (activeSubMode !== "move" || !moveVertexDragging) return;

	moveVertexDragging = false;

	if (!moveVertexOriginal || !moveVertex) {
		exitSubMode();
		return;
	}

	var dx = moveVertex.x - moveVertexOriginal.x;
	var dy = moveVertex.y - moveVertexOriginal.y;
	var dz = moveVertex.z - moveVertexOriginal.z;
	if (dx * dx + dy * dy + dz * dz < 1e-10) {
		clearMoveHighlight();
		moveVertex = null;
		moveVertexOriginal = null;
		moveAffectedIndices = [];
		return;
	}

	var tol2 = 0.001 * 0.001;
	var changes = [];
	for (var i = 0; i < moveAffectedIndices.length; i++) {
		var soupIdx = moveAffectedIndices[i];
		var surfIdx = soupToSurfaceIndex[soupIdx];
		if (surfIdx === undefined) continue;

		var surfTri = editSurface.triangles[surfIdx];
		if (!surfTri || !surfTri.vertices) continue;

		for (var vi = 0; vi < 3; vi++) {
			var sv = surfTri.vertices[vi];
			if (vertexMatch(sv, moveVertexOriginal, tol2)) {
				changes.push({
					surfIndex: surfIdx,
					vertIndex: vi,
					oldPos: { x: moveVertexOriginal.x, y: moveVertexOriginal.y, z: moveVertexOriginal.z },
					newPos: { x: moveVertex.x, y: moveVertex.y, z: moveVertex.z }
				});
				sv.x = moveVertex.x;
				sv.y = moveVertex.y;
				sv.z = moveVertex.z;
			}
		}
	}

	if (changes.length > 0) {
		var action = new MoveVertexAction(editSurface, changes, null, null, "Move vertex");
		pushUndoAction(action);
	}

	clearMoveHighlight();
	moveVertex = null;
	moveVertexOriginal = null;
	moveAffectedIndices = [];

	applyMeshChanges();
	console.log("MeshEditTool: moved vertex (" + changes.length + " triangle verts updated)");
}

function showMoveHighlight(vert) {
	clearMoveHighlight();
	if (!vert || !highlightGroup) return;

	// Magenta point matching KAD vertex selection
	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	var lv = toLocal ? toLocal(vert.x, vert.y) : { x: vert.x, y: vert.y };

	var positions = new Float32Array(3);
	positions[0] = lv.x;
	positions[1] = lv.y;
	positions[2] = vert.z;

	var geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	var mat = new THREE.PointsMaterial({
		color: 0xFF44FF,
		size: 14,
		sizeAttenuation: false,
		transparent: true,
		opacity: 0.9,
		depthTest: true,
		depthWrite: false
	});
	moveHighlightMesh = new THREE.Points(geom, mat);
	moveHighlightMesh.renderOrder = 9999;
	moveHighlightMesh.frustumCulled = false;
	highlightGroup.add(moveHighlightMesh);
}

function clearMoveHighlight() {
	if (moveHighlightMesh && highlightGroup) {
		highlightGroup.remove(moveHighlightMesh);
		if (moveHighlightMesh.geometry) moveHighlightMesh.geometry.dispose();
		if (moveHighlightMesh.material) moveHighlightMesh.material.dispose();
		moveHighlightMesh = null;
	}
}

// ── WELD (action on selectedVertices) ──

function weldSelectedVertices() {
	if (selectedVertices.length < 2) {
		if (window.updateStatusMessage) {
			window.updateStatusMessage("Weld: select 2+ vertices first");
		}
		return;
	}

	// Compute centroid of all selected vertices
	var cx = 0, cy = 0, cz = 0;
	for (var i = 0; i < selectedVertices.length; i++) {
		cx += selectedVertices[i].x;
		cy += selectedVertices[i].y;
		cz += selectedVertices[i].z;
	}
	cx /= selectedVertices.length;
	cy /= selectedVertices.length;
	cz /= selectedVertices.length;

	var centroid = { x: cx, y: cy, z: cz };
	var tol2 = 0.001 * 0.001;

	// Move all selected vertices to centroid in surface.triangles
	var changes = [];
	for (var si = 0; si < editSurface.triangles.length; si++) {
		var tri = editSurface.triangles[si];
		if (!tri || !tri.vertices) continue;
		for (var vi = 0; vi < 3; vi++) {
			for (var sv = 0; sv < selectedVertices.length; sv++) {
				if (vertexMatch(tri.vertices[vi], selectedVertices[sv], tol2)) {
					changes.push({
						surfIndex: si,
						vertIndex: vi,
						oldPos: { x: tri.vertices[vi].x, y: tri.vertices[vi].y, z: tri.vertices[vi].z },
						newPos: { x: centroid.x, y: centroid.y, z: centroid.z }
					});
					tri.vertices[vi].x = centroid.x;
					tri.vertices[vi].y = centroid.y;
					tri.vertices[vi].z = centroid.z;
					break; // matched this vertex, move on to next tri vertex
				}
			}
		}
	}

	// Find and remove degenerate triangles (where 2+ vertices are now identical)
	var removedEntries = [];
	for (var di = editSurface.triangles.length - 1; di >= 0; di--) {
		var dt = editSurface.triangles[di];
		if (!dt || !dt.vertices || dt.vertices.length < 3) continue;
		if (vertexMatch(dt.vertices[0], dt.vertices[1], tol2) ||
			vertexMatch(dt.vertices[1], dt.vertices[2], tol2) ||
			vertexMatch(dt.vertices[0], dt.vertices[2], tol2)) {
			removedEntries.unshift({
				index: di,
				triangle: JSON.parse(JSON.stringify(dt))
			});
			editSurface.triangles.splice(di, 1);
		}
	}

	var action = new WeldVerticesAction(editSurface, changes, removedEntries,
		"Weld " + selectedVertices.length + " vertices (" + changes.length + " refs, " + removedEntries.length + " degenerate removed)");
	pushUndoAction(action);

	selectedIndices.clear();
	selectedVertices = [];
	clearVertexHighlight();
	applyMeshChanges();

	if (window.updateStatusMessage) {
		window.updateStatusMessage("Welded — " + changes.length + " refs updated, " + removedEntries.length + " degenerate removed");
	}
	console.log("MeshEditTool: welded " + selectedVertices.length + " vertices — " + changes.length + " refs, " + removedEntries.length + " degenerate tris removed");
}

// =============================================================================
// HIGHLIGHT RENDERING
// =============================================================================

function rebuildWireframeOverlay() {
	clearWireframeOverlay();
	if (!highlightGroup || editSoup.length === 0) return;

	wireframeOverlay = buildTriEdges(editSoup, 0x000000);
	if (wireframeOverlay) {
		wireframeOverlay.name = "meshEditWireframe";
		wireframeOverlay.material.depthTest = true;
		wireframeOverlay.material.depthWrite = false;
		wireframeOverlay.material.opacity = 0.7;
		wireframeOverlay.material.transparent = true;
		wireframeOverlay.material.polygonOffset = true;
		wireframeOverlay.material.polygonOffsetFactor = -1;
		wireframeOverlay.material.polygonOffsetUnits = -1;
		wireframeOverlay.renderOrder = 997;
		highlightGroup.add(wireframeOverlay);
	}
	requestRender();
}

function clearWireframeOverlay() {
	// Remove tracked reference
	if (wireframeOverlay && highlightGroup) {
		highlightGroup.remove(wireframeOverlay);
		if (wireframeOverlay.geometry) wireframeOverlay.geometry.dispose();
		if (wireframeOverlay.material) wireframeOverlay.material.dispose();
		wireframeOverlay = null;
	}
	// Safety sweep: remove ALL meshEditWireframe objects from highlight group
	// AND also from the scene root (in case highlightGroup was detached/reattached)
	var targets = [highlightGroup];
	var scene = window.threeRenderer && window.threeRenderer.scene;
	if (scene) targets.push(scene);
	for (var t = 0; t < targets.length; t++) {
		var parent = targets[t];
		if (!parent) continue;
		var stale = [];
		for (var i = 0; i < parent.children.length; i++) {
			var child = parent.children[i];
			if (child.name === "meshEditWireframe") {
				stale.push(child);
			}
		}
		for (var j = 0; j < stale.length; j++) {
			parent.remove(stale[j]);
			if (stale[j].geometry) stale[j].geometry.dispose();
			if (stale[j].material) stale[j].material.dispose();
		}
	}
}

function clearHighlights() {
	if (!highlightGroup) return;

	highlightGroup.traverse(function (child) {
		if (child.geometry) child.geometry.dispose();
		if (child.material) child.material.dispose();
	});

	while (highlightGroup.children.length > 0) {
		highlightGroup.remove(highlightGroup.children[0]);
	}

	hoverMesh = null;
	selectionMesh = null;
	selectionWire = null;
	wireframeOverlay = null;
	vertexPointsMesh = null;
	vertexAffectedMesh = null;
	normalsArrowsMesh = null;
	openEdgesGroup = null;
}

/**
 * Remove stale overlays from OTHER tools (e.g. CleanMeshDialog's wireframe)
 * that persist in the scene after mesh edits.
 */
function clearExternalOverlays() {
	var scene = window.threeRenderer && window.threeRenderer.scene;
	if (!scene) return;
	var stale = [];
	for (var i = 0; i < scene.children.length; i++) {
		var child = scene.children[i];
		if (child.name === "cleanMeshHighlights" || child.name === "meshCheckHighlights") {
			stale.push(child);
		}
	}
	for (var j = 0; j < stale.length; j++) {
		stale[j].traverse(function (obj) {
			if (obj.geometry) obj.geometry.dispose();
			if (obj.material) obj.material.dispose();
		});
		scene.remove(stale[j]);
	}
}

// ── NORMAL ARROWS ──

function updateNormalsOverlay() {
	clearNormalsOverlay();
	if (!showNormals || !highlightGroup || editSoup.length === 0) {
		requestRender();
		return;
	}

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	var arrowLength = 2.4;
	// Sample up to 2000 triangles for performance
	var step = Math.max(1, Math.floor(editSoup.length / 2000));
	var positions = [];
	var colors = [];

	for (var i = 0; i < editSoup.length; i += step) {
		var t = editSoup[i];
		var cx = (t.v0.x + t.v1.x + t.v2.x) / 3;
		var cy = (t.v0.y + t.v1.y + t.v2.y) / 3;
		var cz = (t.v0.z + t.v1.z + t.v2.z) / 3;
		// Normal (cross product)
		var ux = t.v1.x - t.v0.x, uy = t.v1.y - t.v0.y, uz = t.v1.z - t.v0.z;
		var vx = t.v2.x - t.v0.x, vy = t.v2.y - t.v0.y, vz = t.v2.z - t.v0.z;
		var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (nl < 1e-12) continue;
		nx /= nl; ny /= nl; nz /= nl;
		var lc = toLocal ? toLocal(cx, cy) : { x: cx, y: cy };
		positions.push(lc.x, lc.y, cz);
		positions.push(lc.x + nx * arrowLength, lc.y + ny * arrowLength, cz + nz * arrowLength);
		// Red at base, blue at tip
		colors.push(1, 0, 0);
		colors.push(0, 0, 1);
	}

	if (positions.length === 0) return;

	var geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
	geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
	var mat = new THREE.LineBasicMaterial({
		vertexColors: true,
		linewidth: 1,
		depthTest: false,
		depthWrite: false,
		transparent: true
	});
	normalsArrowsMesh = new THREE.LineSegments(geom, mat);
	normalsArrowsMesh.name = "meshEditNormals";
	normalsArrowsMesh.renderOrder = 998;
	normalsArrowsMesh.frustumCulled = false;
	highlightGroup.add(normalsArrowsMesh);
	requestRender();
}

function clearNormalsOverlay() {
	if (normalsArrowsMesh && highlightGroup) {
		highlightGroup.remove(normalsArrowsMesh);
		if (normalsArrowsMesh.geometry) normalsArrowsMesh.geometry.dispose();
		if (normalsArrowsMesh.material) normalsArrowsMesh.material.dispose();
		normalsArrowsMesh = null;
	}
}

// ── OPEN EDGES (pink fat lines) ──

function updateOpenEdgesOverlay() {
	clearOpenEdgesOverlay();
	if (!showOpenEdges || !highlightGroup || editSoup.length === 0) {
		requestRender();
		return;
	}

	var problems = detectMeshProblems(editSoup);
	if (!problems.openEdges || problems.openEdges.length === 0) {
		requestRender();
		return;
	}

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	openEdgesGroup = new THREE.Group();
	openEdgesGroup.name = "meshEditOpenEdges";
	openEdgesGroup.renderOrder = 999;
	openEdgesGroup.frustumCulled = false;

	for (var i = 0; i < problems.openEdges.length; i++) {
		var e = problems.openEdges[i];
		var p0 = toLocal ? toLocal(e.v0.x, e.v0.y) : { x: e.v0.x, y: e.v0.y };
		var p1 = toLocal ? toLocal(e.v1.x, e.v1.y) : { x: e.v1.x, y: e.v1.y };

		var points = [
			new THREE.Vector3(p0.x, p0.y, e.v0.z),
			new THREE.Vector3(p1.x, p1.y, e.v1.z)
		];

		var line = new MeshLine();
		var geom = new THREE.BufferGeometry().setFromPoints(points);
		line.setGeometry(geom);

		var material = new MeshLineMaterial({
			color: new THREE.Color(0xFF00FF),
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
		mesh.frustumCulled = false;
		openEdgesGroup.add(mesh);
	}

	highlightGroup.add(openEdgesGroup);
	requestRender();
}

function clearOpenEdgesOverlay() {
	if (openEdgesGroup && highlightGroup) {
		highlightGroup.remove(openEdgesGroup);
		openEdgesGroup.traverse(function (child) {
			if (child.geometry) child.geometry.dispose();
			if (child.material) child.material.dispose();
		});
		openEdgesGroup = null;
	}
}

function updateHoverHighlight() {
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

	// Don't show hover on already-selected triangle (face mode)
	if (editMode === "face" && selectedIndices.has(hoveredIndex)) {
		requestRender();
		return;
	}

	var tri = editSoup[hoveredIndex];
	hoverMesh = buildSingleTriMesh([tri], 0xFFFF00, 0.4);
	if (hoverMesh) {
		highlightGroup.add(hoverMesh);
	}

	requestRender();
}

function updateSelectionHighlight() {
	// Remove old face selection meshes
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

	if (editMode !== "face" || selectedIndices.size === 0) {
		requestRender();
		return;
	}

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

	selectionMesh = buildSingleTriMesh(selTris, 0xFF0000, 0.5);
	if (selectionMesh) {
		highlightGroup.add(selectionMesh);
	}

	selectionWire = buildTriEdges(selTris, 0xFF0000);
	if (selectionWire) {
		highlightGroup.add(selectionWire);
	}

	requestRender();
}

/**
 * Render vertex selection: magenta points + faint red on affected triangles.
 */
function updateVertexHighlight() {
	clearVertexHighlight();
	if (selectedVertices.length === 0) {
		requestRender();
		return;
	}

	if (!highlightGroup) return;

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;

	// 1. Magenta points for selected vertices
	var positions = new Float32Array(selectedVertices.length * 3);
	for (var i = 0; i < selectedVertices.length; i++) {
		var p = selectedVertices[i];
		var lp = toLocal ? toLocal(p.x, p.y) : { x: p.x, y: p.y };
		positions[i * 3] = lp.x;
		positions[i * 3 + 1] = lp.y;
		positions[i * 3 + 2] = p.z;
	}

	var pointGeom = new THREE.BufferGeometry();
	pointGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

	var pointMat = new THREE.PointsMaterial({
		color: 0xFF44FF,
		size: 12,
		sizeAttenuation: false,
		transparent: true,
		opacity: 0.9,
		depthTest: true,
		depthWrite: false
	});

	vertexPointsMesh = new THREE.Points(pointGeom, pointMat);
	vertexPointsMesh.renderOrder = 9999;
	vertexPointsMesh.frustumCulled = false;
	highlightGroup.add(vertexPointsMesh);

	// 2. Faint red highlight on affected triangles
	var affected = getAffectedTriIndices();
	if (affected.size > 0) {
		var affectedTris = [];
		affected.forEach(function (idx) {
			if (idx >= 0 && idx < editSoup.length) {
				affectedTris.push(editSoup[idx]);
			}
		});
		if (affectedTris.length > 0) {
			vertexAffectedMesh = buildSingleTriMesh(affectedTris, 0xFF0000, 0.2);
			if (vertexAffectedMesh) {
				highlightGroup.add(vertexAffectedMesh);
			}
		}
	}

	requestRender();
}

function clearVertexHighlight() {
	if (vertexPointsMesh && highlightGroup) {
		highlightGroup.remove(vertexPointsMesh);
		if (vertexPointsMesh.geometry) vertexPointsMesh.geometry.dispose();
		if (vertexPointsMesh.material) vertexPointsMesh.material.dispose();
		vertexPointsMesh = null;
	}
	if (vertexAffectedMesh && highlightGroup) {
		highlightGroup.remove(vertexAffectedMesh);
		if (vertexAffectedMesh.geometry) vertexAffectedMesh.geometry.dispose();
		if (vertexAffectedMesh.material) vertexAffectedMesh.material.dispose();
		vertexAffectedMesh = null;
	}
}

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

function buildTriEdges(tris, color) {
	if (!tris || tris.length === 0) return null;

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	var positions = new Float32Array(tris.length * 18);

	for (var i = 0; i < tris.length; i++) {
		var t = tris[i];
		var lv0 = toLocal ? toLocal(t.v0.x, t.v0.y) : { x: t.v0.x, y: t.v0.y };
		var lv1 = toLocal ? toLocal(t.v1.x, t.v1.y) : { x: t.v1.x, y: t.v1.y };
		var lv2 = toLocal ? toLocal(t.v2.x, t.v2.y) : { x: t.v2.x, y: t.v2.y };
		var base = i * 18;
		positions[base] = lv0.x; positions[base + 1] = lv0.y; positions[base + 2] = t.v0.z;
		positions[base + 3] = lv1.x; positions[base + 4] = lv1.y; positions[base + 5] = t.v1.z;
		positions[base + 6] = lv1.x; positions[base + 7] = lv1.y; positions[base + 8] = t.v1.z;
		positions[base + 9] = lv2.x; positions[base + 10] = lv2.y; positions[base + 11] = t.v2.z;
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

function createTargetButton(iconSrc, title, onClickFn) {
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

	btn.addEventListener("click", onClickFn);
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

function setButtonEnabled(btn, enabled) {
	btn.disabled = !enabled;
	btn.style.opacity = enabled ? "1" : "0.35";
	btn.style.pointerEvents = enabled ? "auto" : "none";
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

	// ── Mode buttons ──

	faceBtn = createTargetButton("icons/triangle-minus.png",
		"Face mode (F): select individual triangles",
		function () { switchToFaceMode(); });

	vertBtn = createTargetButton("icons/pointer-x.png",
		"Vertex mode (V): select individual vertices",
		function () { switchToVertexMode(); });

	updateModeButtons();

	var sep1 = document.createElement("span");
	sep1.textContent = "|";
	sep1.className = "labelWhite12";
	sep1.style.opacity = "0.4";

	// ── Action buttons ──

	deleteBtn = document.createElement("button");
	deleteBtn.className = "floating-dialog-btn";
	deleteBtn.textContent = "Delete";
	deleteBtn.title = "Delete selected (Del)";
	deleteBtn.style.padding = "2px 8px";
	deleteBtn.addEventListener("click", function () {
		if (editMode === "face") {
			deleteSelectedTriangles();
		} else {
			deleteTrianglesForSelectedVertices();
		}
	});

	invertBtn = document.createElement("button");
	invertBtn.className = "floating-dialog-btn";
	invertBtn.textContent = "Invert";
	invertBtn.title = "Invert normal (flip winding) of selected triangle(s)";
	invertBtn.style.padding = "2px 8px";
	invertBtn.addEventListener("click", function () {
		invertSelectedTriangles();
	});

	weldBtn = document.createElement("button");
	weldBtn.className = "floating-dialog-btn";
	weldBtn.textContent = "Weld";
	weldBtn.title = "Weld selected vertices to centroid (W) — vertex mode, 2+ verts";
	weldBtn.style.padding = "2px 8px";
	weldBtn.addEventListener("click", function () {
		weldSelectedVertices();
	});

	moveBtn = document.createElement("button");
	moveBtn.className = "floating-dialog-btn";
	moveBtn.textContent = "Move";
	moveBtn.title = "Move vertex: click+drag (M) — vertex mode";
	moveBtn.style.padding = "2px 8px";
	moveBtn.addEventListener("click", function () {
		toggleMoveSubMode();
	});

	insertBtn = document.createElement("button");
	insertBtn.className = "floating-dialog-btn";
	insertBtn.textContent = "Insert";
	insertBtn.title = "Insert triangle: pick 3 vertices (I)";
	insertBtn.style.padding = "2px 8px";
	insertBtn.addEventListener("click", function () {
		toggleInsertSubMode();
	});

	var sep2 = document.createElement("span");
	sep2.textContent = "|";
	sep2.className = "labelWhite12";
	sep2.style.opacity = "0.4";

	// Count label
	var countLabel = document.createElement("span");
	countLabel.id = "meshEditCount";
	countLabel.className = "labelWhite12";
	countLabel.textContent = "0 selected";

	// Clear button
	clearBtn = document.createElement("button");
	clearBtn.className = "floating-dialog-btn";
	clearBtn.textContent = "Clear";
	clearBtn.style.padding = "2px 8px";
	clearBtn.addEventListener("click", function () {
		selectedIndices.clear();
		selectedVertices = [];
		updateSelectionHighlight();
		updateVertexHighlight();
		updateToolbarCount();
		updateButtonStates();
		updateStatusForMode();
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

	// Normals checkbox
	var normalsLabel = document.createElement("label");
	normalsLabel.className = "labelWhite12";
	normalsLabel.style.display = "flex";
	normalsLabel.style.alignItems = "center";
	normalsLabel.style.gap = "4px";
	normalsLabel.style.cursor = "pointer";

	var normalsCb = document.createElement("input");
	normalsCb.type = "checkbox";
	normalsCb.checked = showNormals;
	normalsCb.addEventListener("change", function () {
		showNormals = normalsCb.checked;
		updateNormalsOverlay();
	});

	var normalsText = document.createElement("span");
	normalsText.textContent = "Normals";

	normalsLabel.appendChild(normalsCb);
	normalsLabel.appendChild(normalsText);

	// Assemble: [Face] [Vert] | [Delete] [Invert] [Weld] [Move] [Insert] | count [Clear] [Auto-repair] [Normals]
	content.appendChild(faceBtn);
	content.appendChild(vertBtn);
	content.appendChild(sep1);
	content.appendChild(deleteBtn);
	content.appendChild(invertBtn);
	content.appendChild(weldBtn);
	content.appendChild(moveBtn);
	content.appendChild(insertBtn);
	content.appendChild(sep2);
	content.appendChild(countLabel);
	content.appendChild(clearBtn);
	// Open Edges checkbox
	var openEdgesLabel = document.createElement("label");
	openEdgesLabel.className = "labelWhite12";
	openEdgesLabel.style.display = "flex";
	openEdgesLabel.style.alignItems = "center";
	openEdgesLabel.style.gap = "4px";
	openEdgesLabel.style.cursor = "pointer";

	var openEdgesCb = document.createElement("input");
	openEdgesCb.type = "checkbox";
	openEdgesCb.checked = showOpenEdges;
	openEdgesCb.addEventListener("change", function () {
		showOpenEdges = openEdgesCb.checked;
		updateOpenEdgesOverlay();
	});

	var openEdgesText = document.createElement("span");
	openEdgesText.textContent = "Open Edges";

	openEdgesLabel.appendChild(openEdgesCb);
	openEdgesLabel.appendChild(openEdgesText);

	content.appendChild(repairLabel);
	content.appendChild(normalsLabel);
	content.appendChild(openEdgesLabel);

	toolbarDialog = new window.FloatingDialog({
		title: "Mesh Edit",
		content: content,
		width: 760,
		height: 80,
		showConfirm: false,
		showCancel: true,
		cancelText: "Close",
		onCancel: function () {
			cancelMeshEditMode();
		}
	});
	toolbarDialog.show();

	updateButtonStates();
}

function updateToolbarCount() {
	var countEl = document.getElementById("meshEditCount");
	if (!countEl) return;
	if (editMode === "face") {
		countEl.textContent = selectedIndices.size + " face" + (selectedIndices.size !== 1 ? "s" : "");
	} else {
		countEl.textContent = selectedVertices.length + " vert" + (selectedVertices.length !== 1 ? "s" : "");
	}
}

function updateButtonStates() {
	var hasSelection = (editMode === "face" && selectedIndices.size > 0) ||
		(editMode === "vertex" && selectedVertices.length > 0);

	if (deleteBtn) setButtonEnabled(deleteBtn, hasSelection);
	if (invertBtn) setButtonEnabled(invertBtn, hasSelection);
	if (clearBtn) setButtonEnabled(clearBtn, hasSelection);

	// Weld: vertex mode + 2+ vertices
	if (weldBtn) setButtonEnabled(weldBtn, editMode === "vertex" && selectedVertices.length >= 2);

	// Move: vertex mode only
	if (moveBtn) setButtonEnabled(moveBtn, editMode === "vertex");

	// Insert: always available
	if (insertBtn) setButtonEnabled(insertBtn, true);
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
