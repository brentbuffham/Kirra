// src/dialog/popups/surface/CleanMeshDialog.js
// =============================================================================
// CLEAN MESH DIALOG — Unified diagnostics, repair, and surgical editing
// =============================================================================
// Created: 2026-03-06

import { extractTriangles, countOpenEdges } from "../../../helpers/SurfaceIntersectionHelper.js";
import {
	detectMeshProblems, countUnweldedVertices, weldVertices, weldedToSoup,
	removeDegenerateTriangles, cleanCrossingTriangles, removeOverlappingTriangles,
	deduplicateSeamVertices, repairMesh
} from "../../../helpers/MeshRepairHelper.js";
import {
	computeSurfaceStatistics, classifyNormalDirection,
	flipSurfaceNormals, alignSurfaceNormals, setSurfaceNormalsDirection
} from "../../../helpers/SurfaceNormalHelper.js";
import { detectSelfIntersections, removeSelfIntersections } from "../../../helpers/SelfIntersectionHelper.js";
import { flashHighlight, clearHighlight } from "../../../helpers/SurfaceHighlightHelper.js";
import { drawSurfaceThreeJS } from "../../../draw/canvas3DDrawing.js";
import * as THREE from "three";

// Module-level highlight group for crossing tri overlays + wireframe
var highlightGroup = null;
var wireframeOverlay = null;
var crossingOverlay = null;

// Module-level pick mode state
var pickCallback = null;
var highlightedSurfaceId = null;

// =============================================================================
// PICK MODE — same pattern as TrimeshBooleanDialog
// =============================================================================

function isDarkMode() {
	return typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
}

function getThreeCanvas() {
	return window.threeRenderer ? window.threeRenderer.getCanvas() : null;
}

function raycastSurface(event, canvas) {
	var tr = window.threeRenderer;
	if (!tr || !tr.scene || !tr.camera || !tr.surfaceMeshMap) return null;

	var rect = canvas.getBoundingClientRect();
	var mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	var mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	var raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), tr.camera);

	var meshes = [];
	tr.surfaceMeshMap.forEach(function (mesh, surfaceId) {
		if (mesh && mesh.visible) {
			mesh.traverse(function (child) {
				if (child.isMesh) {
					child.userData._pickSurfaceId = surfaceId;
					meshes.push(child);
				}
			});
		}
	});

	var hits = raycaster.intersectObjects(meshes, false);
	if (hits.length > 0) {
		return hits[0].object.userData._pickSurfaceId || null;
	}
	return null;
}

function enterPickMode(pickRow, onPicked) {
	exitPickMode();

	pickRow.pickBtn.style.background = "rgba(255,60,60,0.4)";
	pickRow.pickBtn.style.borderColor = "#FF4444";

	var canvas = getThreeCanvas();
	if (!canvas) return;

	canvas.style.cursor = "crosshair";

	pickCallback = function (e) {
		e.stopPropagation();

		var surfaceId = raycastSurface(e, canvas);
		if (surfaceId) {
			onPicked(surfaceId);
			showPickHighlight(surfaceId);
		}

		exitPickMode();
		var dark = isDarkMode();
		pickRow.pickBtn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		pickRow.pickBtn.style.borderColor = dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
	};

	canvas.addEventListener("pointerup", pickCallback, { once: true, capture: true });
}

function exitPickMode() {
	var canvas = getThreeCanvas();
	if (canvas) {
		canvas.style.cursor = "";
		if (pickCallback) {
			canvas.removeEventListener("pointerup", pickCallback, { capture: true });
		}
	}
	pickCallback = null;
}

function showPickHighlight(surfaceId) {
	clearPickHighlight();
	flashHighlight(surfaceId, { color: 0x00FF88, opacity: 0.25 });
	highlightedSurfaceId = surfaceId;
}

function clearPickHighlight() {
	if (highlightedSurfaceId) {
		clearHighlight(highlightedSurfaceId);
		highlightedSurfaceId = null;
	}
}

function createPickRow(label, options, defaultValue, onPick) {
	var dark = isDarkMode();
	var row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.gap = "8px";
	row.style.marginBottom = "6px";

	var labelEl = document.createElement("label");
	labelEl.textContent = label;
	labelEl.className = "labelWhite12";
	labelEl.style.minWidth = "55px";
	labelEl.style.fontWeight = "bold";
	labelEl.style.flexShrink = "0";

	var pickBtn = document.createElement("button");
	pickBtn.type = "button";
	pickBtn.title = "Pick a surface from 3D view";
	pickBtn.style.width = "28px";
	pickBtn.style.height = "28px";
	pickBtn.style.padding = "2px";
	pickBtn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
	pickBtn.style.borderRadius = "4px";
	pickBtn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
	pickBtn.style.cursor = "pointer";
	pickBtn.style.flexShrink = "0";
	pickBtn.style.display = "flex";
	pickBtn.style.alignItems = "center";
	pickBtn.style.justifyContent = "center";

	var pickImg = document.createElement("img");
	pickImg.src = "icons/target-arrow.png";
	pickImg.style.width = "20px";
	pickImg.style.height = "20px";
	pickImg.style.filter = dark ? "invert(0.8)" : "invert(0.2)";
	pickBtn.appendChild(pickImg);

	pickBtn.addEventListener("click", onPick);

	var select = document.createElement("select");
	select.style.flex = "1";
	select.style.padding = "4px 6px";
	select.style.fontSize = "12px";
	select.style.borderRadius = "4px";
	select.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid #999";
	select.style.background = dark ? "rgba(30,30,30,0.9)" : "#fff";
	select.style.color = dark ? "#eee" : "#333";
	select.style.minWidth = "0";

	for (var i = 0; i < options.length; i++) {
		var opt = document.createElement("option");
		opt.value = options[i].value;
		opt.textContent = options[i].text;
		if (options[i].value === defaultValue) opt.selected = true;
		select.appendChild(opt);
	}

	row.appendChild(labelEl);
	row.appendChild(pickBtn);
	row.appendChild(select);

	return { row: row, select: select, pickBtn: pickBtn };
}

// =============================================================================
// MAIN DIALOG
// =============================================================================

/**
 * Show the Clean Mesh dialog.
 * @param {string} [surfaceId] — Optional initial surface. If omitted, selects first visible.
 */
export function showCleanMeshDialog(surfaceId) {
	// Build surface options for dropdown
	var surfaceOptions = [];
	var firstVisibleId = null;
	if (window.loadedSurfaces) {
		window.loadedSurfaces.forEach(function (s, id) {
			if (!(s.isTexturedMesh && s.threeJSMesh) && s.triangles && s.triangles.length > 0) {
				surfaceOptions.push({ value: id, text: s.name || id });
				if (!firstVisibleId && s.visible) firstVisibleId = id;
			}
		});
	}

	if (surfaceOptions.length === 0) {
		if (window.showModalMessage) window.showModalMessage("No Surface", "No editable surfaces loaded.");
		return;
	}

	// Default to provided surfaceId, or first visible
	var activeSurfaceId = surfaceId || firstVisibleId || surfaceOptions[0].value;
	var surface = window.loadedSurfaces.get(activeSurfaceId);

	// ── Build dialog content ──
	var content = document.createElement("div");
	content.style.display = "flex";
	content.style.flexDirection = "column";
	content.style.gap = "8px";
	content.style.padding = "4px";
	content.style.overflowY = "auto";

	// ── Pick Row (target + dropdown) ──
	var pickRow = createPickRow("Surface", surfaceOptions, activeSurfaceId, function () {
		enterPickMode(pickRow, function (pickedId) {
			// Update dropdown and active surface
			pickRow.select.value = pickedId;
			switchSurface(pickedId);
		});
	});
	content.appendChild(pickRow.row);

	// When dropdown changes, switch surface
	pickRow.select.addEventListener("change", function () {
		switchSurface(pickRow.select.value);
	});

	function switchSurface(newId) {
		var newSurface = window.loadedSurfaces ? window.loadedSurfaces.get(newId) : null;
		if (!newSurface) return;
		activeSurfaceId = newId;
		surface = newSurface;
		clearHighlights();
		clearPickHighlight();
		lastSelfIntersections = null;
		runCheck();
	}

	// ── Diagnostics Section ──
	var diagSection = createSection("Diagnostics");
	content.appendChild(diagSection.container);

	var openRow = createCheckRow(diagSection.body, "Open Edges", "cleanOpen", "Close");
	var nmRow = createCheckRow(diagSection.body, "Non-Manifold", "cleanNM", "Remove");
	var degRow = createCheckRow(diagSection.body, "Degenerate Tris", "cleanDeg", "Remove");
	var crossRow = createCheckRow(diagSection.body, "Crossing Tris", "cleanCross", "Remove");
	var overlapRow = createCheckRow(diagSection.body, "Overlapping Tris", "cleanOverlap", "Remove");
	var unweldRow = createCheckRow(diagSection.body, "Unwelded Verts", "cleanUnweld", "Weld");

	// Tolerance input row
	var tolRow = document.createElement("div");
	tolRow.style.display = "flex";
	tolRow.style.alignItems = "center";
	tolRow.style.justifyContent = "flex-end";
	tolRow.style.gap = "6px";
	tolRow.style.marginBottom = "4px";

	var tolLabel = document.createElement("span");
	tolLabel.className = "labelWhite12";
	tolLabel.textContent = "Tolerance:";

	var tolInput = document.createElement("input");
	tolInput.type = "number";
	tolInput.value = "0.001";
	tolInput.step = "0.001";
	tolInput.min = "0";
	tolInput.style.width = "70px";
	tolInput.style.padding = "2px 4px";
	tolInput.style.fontSize = "11px";
	tolInput.className = "inputText";

	tolRow.appendChild(tolLabel);
	tolRow.appendChild(tolInput);
	diagSection.body.appendChild(tolRow);

	// ── Tools Section ──
	var toolsSection = createSection("Tools");
	content.appendChild(toolsSection.container);

	var toolsRow = document.createElement("div");
	toolsRow.style.display = "flex";
	toolsRow.style.gap = "6px";
	toolsRow.style.flexWrap = "wrap";
	toolsSection.body.appendChild(toolsRow);

	var editBtn = createActionBtn("Edit Mesh");
	var weldAllBtn = createActionBtn("Weld All");
	var fixAllBtn = createActionBtn("Fix All");
	toolsRow.appendChild(editBtn);
	toolsRow.appendChild(weldAllBtn);
	toolsRow.appendChild(fixAllBtn);

	// ── Normals Section ──
	var normalsSection = createSection("Normals");
	content.appendChild(normalsSection.container);

	var normalsRow = document.createElement("div");
	normalsRow.style.display = "flex";
	normalsRow.style.gap = "6px";
	normalsRow.style.flexWrap = "wrap";
	normalsSection.body.appendChild(normalsRow);

	var normalBtnIn = createActionBtn("In");
	var normalBtnOut = createActionBtn("Out");
	var normalBtnFlip = createActionBtn("Flip");
	var normalBtnAlign = createActionBtn("Align");
	normalsRow.appendChild(normalBtnIn);
	normalsRow.appendChild(normalBtnOut);
	normalsRow.appendChild(normalBtnFlip);
	normalsRow.appendChild(normalBtnAlign);

	// ── Stats Section ──
	var statsSection = createSection("Stats");
	content.appendChild(statsSection.container);

	var statsDiv = document.createElement("div");
	statsDiv.className = "labelWhite12";
	statsDiv.style.lineHeight = "1.6";
	statsDiv.textContent = "Click [Check] to run diagnostics.";
	statsSection.body.appendChild(statsDiv);

	// ── Tracking state ──
	var lastDiag = null;
	var lastSelfIntersections = null;

	// ── Check function ──
	function runCheck() {
		var soup = extractTriangles(surface);
		if (soup.length === 0) {
			statsDiv.textContent = "No triangles.";
			return;
		}

		var problems = detectMeshProblems(soup, 1e-6);
		lastDiag = problems;

		updateBadge(openRow.badge, problems.openEdges.length);
		updateBadge(nmRow.badge, problems.nonManifoldEdges.length);
		updateBadge(degRow.badge, problems.degenerateTris.length);

		var tol = parseFloat(tolInput.value) || 0.001;
		var unweldCount = countUnweldedVertices(soup, tol);
		updateBadge(unweldRow.badge, unweldCount);

		var cleanedOverlap = removeOverlappingTriangles(soup, 0.5);
		var overlapCount = soup.length - cleanedOverlap.length;
		updateBadge(overlapRow.badge, overlapCount);

		var selfResult = detectSelfIntersections(soup);
		lastSelfIntersections = selfResult;
		updateBadge(crossRow.badge, selfResult.count);

		clearHighlights();
		buildWireframeOverlay(soup);
		if (crossRow.checkbox.checked && selfResult.count > 0) {
			highlightCrossingTris(soup, selfResult);
		}

		var stats = computeSurfaceStatistics(surface);
		var edgeInfo = countOpenEdges(soup);
		statsDiv.innerHTML =
			"Points: <b>" + fmt(stats.points) + "</b> &nbsp; " +
			"Edges: <b>" + fmt(stats.edges) + "</b> &nbsp; " +
			"Faces: <b>" + fmt(stats.faces) + "</b><br>" +
			"Closed: <b>" + stats.closed + "</b> &nbsp; " +
			"Open Edges: <b>" + edgeInfo.boundary + "</b> &nbsp; " +
			"Volume: <b>" + (stats.volume ? stats.volume.toFixed(1) + " m\u00B3" : "N/A") + "</b>";

		var isClosed = stats.closed === "Yes";
		normalBtnIn.style.display = isClosed ? "" : "none";
		normalBtnOut.style.display = isClosed ? "" : "none";
		normalBtnFlip.style.display = isClosed ? "none" : "";
		normalBtnAlign.style.display = isClosed ? "none" : "";
	}

	// ── Repair handlers ──
	function repairAndCheck(repairFn) {
		repairFn();
		applySurfaceChanges(surface);
		runCheck();
	}

	openRow.repairBtn.addEventListener("click", function () {
		var soup = extractTriangles(surface);
		var tol = parseFloat(tolInput.value) || 0.001;
		repairMesh(soup, {
			closeMode: "stitch",
			snapTolerance: tol,
			stitchTolerance: 1.0,
			removeDegenerate: true
		}).then(function (result) {
			if (result) {
				var finalSoup = Array.isArray(result) ? result : (result.soup || result);
				if (Array.isArray(finalSoup)) {
					soupToSurface(surface, finalSoup);
				}
			}
			applySurfaceChanges(surface);
			runCheck();
		});
	});

	nmRow.repairBtn.addEventListener("click", function () {
		repairAndCheck(function () {
			var soup = extractTriangles(surface);
			soup = cleanCrossingTriangles(soup);
			soupToSurface(surface, soup);
		});
	});

	degRow.repairBtn.addEventListener("click", function () {
		repairAndCheck(function () {
			var soup = extractTriangles(surface);
			soup = removeDegenerateTriangles(soup, 1e-6, 0);
			soupToSurface(surface, soup);
		});
	});

	crossRow.repairBtn.addEventListener("click", function () {
		repairAndCheck(function () {
			var soup = extractTriangles(surface);
			soup = removeSelfIntersections(soup);
			soupToSurface(surface, soup);
		});
	});

	overlapRow.repairBtn.addEventListener("click", function () {
		repairAndCheck(function () {
			var soup = extractTriangles(surface);
			soup = removeOverlappingTriangles(soup, 0.5);
			soupToSurface(surface, soup);
		});
	});

	unweldRow.repairBtn.addEventListener("click", function () {
		repairAndCheck(function () {
			var soup = extractTriangles(surface);
			var tol = parseFloat(tolInput.value) || 0.001;
			var welded = weldVertices(soup, tol);
			soup = weldedToSoup(welded.triangles);
			soup = deduplicateSeamVertices(soup, tol);
			soupToSurface(surface, soup);
		});
	});

	crossRow.checkbox.addEventListener("change", function () {
		if (!crossRow.checkbox.checked) {
			clearCrossingOverlay();
		} else if (lastSelfIntersections && lastSelfIntersections.count > 0) {
			var soup = extractTriangles(surface);
			highlightCrossingTris(soup, lastSelfIntersections);
		}
	});

	// ── Tool button handlers ──
	editBtn.addEventListener("click", function () {
		if (typeof window.startMeshEditMode === "function") {
			window.startMeshEditMode(surface.id);
		}
	});

	weldAllBtn.addEventListener("click", function () {
		repairAndCheck(function () {
			var soup = extractTriangles(surface);
			var tol = parseFloat(tolInput.value) || 0.001;
			var welded = weldVertices(soup, tol);
			soup = weldedToSoup(welded.triangles);
			soup = deduplicateSeamVertices(soup, tol);
			soupToSurface(surface, soup);
		});
	});

	fixAllBtn.addEventListener("click", function () {
		var soup = extractTriangles(surface);
		var tol = parseFloat(tolInput.value) || 0.001;
		repairMesh(soup, {
			closeMode: "stitch",
			snapTolerance: tol,
			stitchTolerance: 1.0,
			removeDegenerate: true
		}).then(function (result) {
			if (result) {
				var finalSoup = Array.isArray(result) ? result : (result.soup || result);
				if (Array.isArray(finalSoup)) {
					soupToSurface(surface, finalSoup);
					applySurfaceChanges(surface);
					runCheck();
				}
			}
		});
	});

	// ── Normal button handlers ──
	normalBtnIn.addEventListener("click", function () {
		var result = setSurfaceNormalsDirection(surface, "in");
		if (result) {
			surface.triangles = result.triangles;
			applySurfaceChanges(surface);
			runCheck();
		}
	});

	normalBtnOut.addEventListener("click", function () {
		var result = setSurfaceNormalsDirection(surface, "out");
		if (result) {
			surface.triangles = result.triangles;
			applySurfaceChanges(surface);
			runCheck();
		}
	});

	normalBtnFlip.addEventListener("click", function () {
		surface.triangles = flipSurfaceNormals(surface);
		applySurfaceChanges(surface);
		runCheck();
	});

	normalBtnAlign.addEventListener("click", function () {
		var result = alignSurfaceNormals(surface);
		if (result) {
			surface.triangles = result.triangles;
			applySurfaceChanges(surface);
			runCheck();
		}
	});

	// ── Create dialog ──
	var dialog = new window.FloatingDialog({
		title: "Clean Mesh",
		content: content,
		width: 400,
		height: 520,
		showConfirm: true,
		confirmText: "Check",
		showCancel: true,
		cancelText: "Close",
		onConfirm: function () {
			runCheck();
			return false; // Keep dialog open
		},
		onCancel: function () {
			clearHighlights();
			clearPickHighlight();
			exitPickMode();
		}
	});

	dialog.show();

	// Run initial check
	setTimeout(runCheck, 100);
}

// =============================================================================
// HELPERS
// =============================================================================

function createSection(title) {
	var container = document.createElement("div");
	container.style.borderBottom = "1px solid var(--border-color, #555)";
	container.style.paddingBottom = "6px";

	var header = document.createElement("div");
	header.className = "labelWhite12";
	header.style.fontWeight = "bold";
	header.style.marginBottom = "4px";
	header.textContent = title;
	container.appendChild(header);

	var body = document.createElement("div");
	container.appendChild(body);

	return { container: container, body: body };
}

function createCheckRow(parent, labelText, id, repairBtnText) {
	var row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.justifyContent = "space-between";
	row.style.marginBottom = "4px";

	var leftDiv = document.createElement("div");
	leftDiv.style.display = "flex";
	leftDiv.style.alignItems = "center";
	leftDiv.style.gap = "6px";

	var cb = document.createElement("input");
	cb.type = "checkbox";
	cb.id = id;
	cb.checked = true;

	var lbl = document.createElement("label");
	lbl.htmlFor = id;
	lbl.textContent = labelText;
	lbl.className = "labelWhite12";
	lbl.style.cursor = "pointer";

	leftDiv.appendChild(cb);
	leftDiv.appendChild(lbl);

	var rightDiv = document.createElement("div");
	rightDiv.style.display = "flex";
	rightDiv.style.alignItems = "center";
	rightDiv.style.gap = "4px";

	var repairBtn = null;
	if (repairBtnText) {
		repairBtn = document.createElement("button");
		repairBtn.textContent = repairBtnText;
		repairBtn.className = "floating-dialog-btn";
		repairBtn.style.padding = "3px 8px";
		repairBtn.style.minWidth = "60px";
		repairBtn.style.maxHeight = "18px";
		rightDiv.appendChild(repairBtn);
	}

	var badge = document.createElement("span");
	badge.textContent = "\u2014";
	badge.className = "surface-badge surface-badge-grey";
	badge.style.minWidth = "28px";
	badge.style.textAlign = "center";
	rightDiv.appendChild(badge);

	row.appendChild(leftDiv);
	row.appendChild(rightDiv);
	parent.appendChild(row);

	return { checkbox: cb, badge: badge, repairBtn: repairBtn };
}

function createActionBtn(text) {
	var btn = document.createElement("button");
	btn.textContent = text;
	btn.className = "floating-dialog-btn";
	btn.style.padding = "4px 10px";
	return btn;
}

function updateBadge(badge, count) {
	badge.textContent = count;
	if (count === 0) {
		badge.className = "surface-badge surface-badge-green";
	} else {
		badge.className = "surface-badge surface-badge-red";
	}
}

function fmt(n) {
	return typeof n === "number" ? n.toLocaleString() : String(n);
}

function soupToSurface(surface, soup) {
	var newTris = [];
	for (var i = 0; i < soup.length; i++) {
		newTris.push({
			vertices: [
				{ x: soup[i].v0.x, y: soup[i].v0.y, z: soup[i].v0.z },
				{ x: soup[i].v1.x, y: soup[i].v1.y, z: soup[i].v1.z },
				{ x: soup[i].v2.x, y: soup[i].v2.y, z: soup[i].v2.z }
			]
		});
	}
	surface.triangles = newTris;
}

function applySurfaceChanges(surface) {
	var surfaceId = surface.id;

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
			console.warn("CleanMesh: save failed:", err);
		});
	}

	if (highlightGroup && renderer && renderer.scene) {
		if (!highlightGroup.parent) renderer.scene.add(highlightGroup);
	}

	if (renderer) {
		renderer.needsRender = true;
		if (renderer.requestRender) renderer.requestRender();
	}
	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}
}

// =============================================================================
// 3D HIGHLIGHT FOR CROSSING TRIANGLES
// =============================================================================

function clearHighlights() {
	if (!highlightGroup) return;
	highlightGroup.traverse(function (child) {
		if (child.geometry) child.geometry.dispose();
		if (child.material) child.material.dispose();
	});
	while (highlightGroup.children.length > 0) {
		highlightGroup.remove(highlightGroup.children[0]);
	}
	var scene = window.threeRenderer && window.threeRenderer.scene;
	if (scene && highlightGroup.parent) scene.remove(highlightGroup);
	highlightGroup = null;
	wireframeOverlay = null;
	crossingOverlay = null;

	if (window.threeRenderer && window.threeRenderer.requestRender) {
		window.threeRenderer.requestRender();
	}
}

/**
 * Build a dark wireframe overlay showing all triangle edges for the given soup.
 * Adds to highlightGroup (creates it if needed).
 */
function buildWireframeOverlay(soup) {
	// Remove old wireframe
	if (wireframeOverlay && highlightGroup) {
		highlightGroup.remove(wireframeOverlay);
		if (wireframeOverlay.geometry) wireframeOverlay.geometry.dispose();
		if (wireframeOverlay.material) wireframeOverlay.material.dispose();
		wireframeOverlay = null;
	}

	if (!soup || soup.length === 0) return;
	if (!window.threeRenderer || !window.threeRenderer.scene) return;

	// Ensure highlight group exists
	if (!highlightGroup) {
		highlightGroup = new THREE.Group();
		highlightGroup.name = "cleanMeshHighlights";
		highlightGroup.renderOrder = 998;
		window.threeRenderer.scene.add(highlightGroup);
	}

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	// 3 edges per tri, 2 points per edge, 3 coords per point
	var positions = new Float32Array(soup.length * 18);

	for (var i = 0; i < soup.length; i++) {
		var t = soup[i];
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
		color: 0x000000,
		linewidth: 1,
		depthTest: true,
		depthWrite: false,
		transparent: true,
		opacity: 0.7,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1
	});

	wireframeOverlay = new THREE.LineSegments(geom, mat);
	wireframeOverlay.renderOrder = 997;
	wireframeOverlay.frustumCulled = false;
	highlightGroup.add(wireframeOverlay);

	if (window.threeRenderer.requestRender) window.threeRenderer.requestRender();
}

function clearCrossingOverlay() {
	if (crossingOverlay && highlightGroup) {
		highlightGroup.remove(crossingOverlay);
		if (crossingOverlay.geometry) crossingOverlay.geometry.dispose();
		if (crossingOverlay.material) crossingOverlay.material.dispose();
		crossingOverlay = null;
	}
}

function highlightCrossingTris(soup, selfResult) {
	clearCrossingOverlay();
	if (!selfResult || selfResult.count === 0) return;
	if (!window.threeRenderer || !window.threeRenderer.scene) return;

	// Ensure highlight group exists
	if (!highlightGroup) {
		highlightGroup = new THREE.Group();
		highlightGroup.name = "cleanMeshHighlights";
		highlightGroup.renderOrder = 998;
		window.threeRenderer.scene.add(highlightGroup);
	}

	var indexSet = new Set();
	for (var p = 0; p < selfResult.pairs.length; p++) {
		indexSet.add(selfResult.pairs[p].idxA);
		indexSet.add(selfResult.pairs[p].idxB);
	}

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;
	var positions = new Float32Array(indexSet.size * 9);
	var pi = 0;
	indexSet.forEach(function (idx) {
		var t = soup[idx];
		if (!t) return;
		var lv0 = toLocal ? toLocal(t.v0.x, t.v0.y) : { x: t.v0.x, y: t.v0.y };
		var lv1 = toLocal ? toLocal(t.v1.x, t.v1.y) : { x: t.v1.x, y: t.v1.y };
		var lv2 = toLocal ? toLocal(t.v2.x, t.v2.y) : { x: t.v2.x, y: t.v2.y };
		positions[pi++] = lv0.x; positions[pi++] = lv0.y; positions[pi++] = t.v0.z;
		positions[pi++] = lv1.x; positions[pi++] = lv1.y; positions[pi++] = t.v1.z;
		positions[pi++] = lv2.x; positions[pi++] = lv2.y; positions[pi++] = t.v2.z;
	});

	if (pi === 0) return;

	var usedPositions = pi < positions.length ? positions.subarray(0, pi) : positions;

	var geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(usedPositions), 3));

	var mat = new THREE.MeshBasicMaterial({
		color: 0xFF8800,
		transparent: true,
		opacity: 0.5,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false
	});

	crossingOverlay = new THREE.Mesh(geom, mat);
	crossingOverlay.renderOrder = 998;
	crossingOverlay.frustumCulled = false;
	highlightGroup.add(crossingOverlay);

	if (window.threeRenderer.requestRender) window.threeRenderer.requestRender();
}
