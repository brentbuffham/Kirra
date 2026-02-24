/**
 * SolidCSGDialog.js
 *
 * Dialog for 3D CSG boolean operations on surface meshes.
 * User picks two surfaces via screen pick (raycast) or dropdown.
 * Uses FloatingDialog + createEnhancedFormContent.
 */

import * as THREE from "three";
import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import { solidCSG } from "../../../helpers/SolidCSGHelper.js";
import { flashHighlight, clearHighlight, clearAllHighlights } from "../../../helpers/SurfaceHighlightHelper.js";

// ────────────────────────────────────────────────────────
// Module-level pick state
// ────────────────────────────────────────────────────────
var pickCallback = null;
var highlightedSurfaceId = null;

function getThreeCanvas() {
	return window.threeRenderer ? window.threeRenderer.getCanvas() : null;
}

// ────────────────────────────────────────────────────────
// Public: show the Solid CSG dialog
// ────────────────────────────────────────────────────────

export function showSolidCSGDialog() {
	// Step 1) Collect all surfaces with triangles
	var surfaceEntries = [];
	if (window.loadedSurfaces && window.loadedSurfaces.size > 0) {
		window.loadedSurfaces.forEach(function (surface, surfaceId) {
			if (surface.triangles && surface.triangles.length > 0) {
				surfaceEntries.push({
					id: surfaceId,
					name: surface.name || surfaceId,
					triCount: surface.triangles.length
				});
			}
		});
	}

	if (surfaceEntries.length < 2) {
		showInfoDialog("Need at least 2 surfaces for CSG boolean operations.\nImport or create surfaces first.");
		return;
	}

	// Step 2) Build select options
	var surfaceOptions = surfaceEntries.map(function (se) {
		return { value: se.id, text: se.name + " (" + se.triCount + " tris)" };
	});

	// Step 3) Build form content with pick buttons
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px 0";

	// Warning div for open/closed status
	var warningDiv = document.createElement("div");
	warningDiv.className = "csg-surface-warning";
	warningDiv.style.fontSize = "11px";
	warningDiv.style.padding = "6px 8px";
	warningDiv.style.borderRadius = "4px";
	warningDiv.style.marginTop = "2px";
	warningDiv.style.marginBottom = "2px";
	warningDiv.style.display = "none";

	function updateClosedWarning() {
		var idA = rowA ? rowA.select.value : null;
		var idB = rowB ? rowB.select.value : null;
		if (!idA || !idB) { warningDiv.style.display = "none"; return; }
		var surfA = window.loadedSurfaces ? window.loadedSurfaces.get(idA) : null;
		var surfB = window.loadedSurfaces ? window.loadedSurfaces.get(idB) : null;
		var checkClosed = typeof window.isSurfaceClosed === "function";
		var closedA = checkClosed && surfA ? window.isSurfaceClosed(surfA) : false;
		var closedB = checkClosed && surfB ? window.isSurfaceClosed(surfB) : false;
		var dark = isDarkMode();
		warningDiv.style.display = "block";
		if (closedA && closedB) {
			warningDiv.style.background = "rgba(0,180,80,0.15)";
			warningDiv.style.border = "1px solid rgba(0,180,80,0.4)";
			warningDiv.style.color = dark ? "#6fdf6f" : "#1a7a1a";
			warningDiv.textContent = "Both meshes are closed solids — optimal for CSG.";
		} else {
			var which = !closedA && !closedB ? "Both meshes are open surfaces"
				: !closedA ? "Mesh A is an open surface" : "Mesh B is an open surface";
			warningDiv.style.background = "rgba(220,160,0,0.15)";
			warningDiv.style.border = "1px solid rgba(220,160,0,0.4)";
			warningDiv.style.color = dark ? "#e0c060" : "#7a5a00";
			warningDiv.textContent = which + " — results may be unreliable. For best results, use closed (watertight) solids with outward-facing normals.";
		}
	}

	// Mesh A row
	var rowA = createPickRow("Mesh A", surfaceOptions, surfaceOptions[0].value, function () {
		enterPickMode(rowA, function (surfaceId) {
			rowA.select.value = surfaceId;
			updateClosedWarning();
		});
	});
	rowA.select.addEventListener("change", updateClosedWarning);
	container.appendChild(rowA.row);

	// Mesh B row
	var defaultB = surfaceOptions.length > 1 ? surfaceOptions[1].value : surfaceOptions[0].value;
	var rowB = createPickRow("Mesh B", surfaceOptions, defaultB, function () {
		enterPickMode(rowB, function (surfaceId) {
			rowB.select.value = surfaceId;
			updateClosedWarning();
		});
	});
	rowB.select.addEventListener("change", updateClosedWarning);
	container.appendChild(rowB.row);

	// Insert warning div after both rows
	container.appendChild(warningDiv);

	// Initial check
	updateClosedWarning();

	// Operation & gradient
	var otherFields = [
		{
			label: "Operation",
			name: "operation",
			type: "select",
			value: "subtract",
			options: [
				{ value: "union", text: "Union (A + B)" },
				{ value: "intersect", text: "Intersect (A ∩ B)" },
				{ value: "subtract", text: "Subtract (A - B)" },
				{ value: "reverseSubtract", text: "Reverse Subtract (B - A)" },
				{ value: "difference", text: "Difference (A △ B / XOR)" }
			]
		},
		{
			label: "Result Gradient",
			name: "gradient",
			type: "select",
			value: "default",
			options: [
				{ value: "default", text: "Default" },
				{ value: "hillshade", text: "Hillshade" },
				{ value: "viridis", text: "Viridis" },
				{ value: "turbo", text: "Turbo" },
				{ value: "parula", text: "Parula" },
				{ value: "cividis", text: "Cividis" },
				{ value: "terrain", text: "Terrain" }
			]
		}
	];

	var formContent = createEnhancedFormContent(otherFields, false, false);
	container.appendChild(formContent);

	// Notes
	var notesDark = isDarkMode();
	var notesDiv = document.createElement("div");
	notesDiv.style.marginTop = "10px";
	notesDiv.style.fontSize = "10px";
	notesDiv.style.color = notesDark ? "#888" : "#666";
	notesDiv.innerHTML =
		"<strong>Operations:</strong><br>" +
		"&bull; <b>Union</b> — combine both meshes into one solid<br>" +
		"&bull; <b>Intersect</b> — keep only the overlapping volume<br>" +
		"&bull; <b>Subtract</b> — cut mesh B out of mesh A<br>" +
		"&bull; <b>Reverse Subtract</b> — cut mesh A out of mesh B<br>" +
		"&bull; <b>Difference</b> — keep non-overlapping parts (XOR)<br>" +
		"<br><strong>Tip:</strong> Click the pick button then click a surface in the 3D view.";
	container.appendChild(notesDiv);

	// Step 4) Create dialog
	var dialog = new FloatingDialog({
		title: "Solid Boolean (CSG)",
		content: container,
		layoutType: "wide",
		width: 480,
		height: 470,
		showConfirm: true,
		showCancel: true,
		confirmText: "Execute",
		cancelText: "Cancel",
		onConfirm: function () {
			exitPickMode();
			clearAllHighlights();

			var surfaceIdA = rowA.select.value;
			var surfaceIdB = rowB.select.value;
			var data = getFormData(formContent);

			if (surfaceIdA === surfaceIdB) {
				showInfoDialog("Mesh A and Mesh B must be different surfaces.");
				return;
			}

			console.log("CSG: Starting " + data.operation + " operation...");
			setTimeout(function () {
				var resultId = solidCSG({
					surfaceIdA: surfaceIdA,
					surfaceIdB: surfaceIdB,
					operation: data.operation,
					gradient: data.gradient || "default"
				});

				if (resultId) {
					console.log("CSG complete: " + resultId);
				} else {
					showInfoDialog("CSG operation failed or produced no result.\nEnsure both meshes overlap and are valid geometry.");
				}
			}, 50);
		},
		onCancel: function () {
			exitPickMode();
			clearAllHighlights();
		}
	});

	dialog.show();
}

// ────────────────────────────────────────────────────────
// Pick row builder
// ────────────────────────────────────────────────────────

function isDarkMode() {
	return typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
}

function createPickRow(label, options, defaultValue, onPick) {
	var dark = isDarkMode();
	var row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.gap = "8px";

	var labelEl = document.createElement("label");
	labelEl.textContent = label;
	labelEl.style.minWidth = "70px";
	labelEl.style.fontSize = "13px";
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

// ────────────────────────────────────────────────────────
// Screen pick mode
// ────────────────────────────────────────────────────────

function enterPickMode(pickRow, onPicked) {
	exitPickMode(); // cancel any existing

	// Highlight button red (Kirra convention)
	pickRow.pickBtn.style.background = "rgba(255,60,60,0.4)";
	pickRow.pickBtn.style.borderColor = "#FF4444";

	var canvas = getThreeCanvas();
	if (!canvas) {
		console.warn("CSG Pick: No 3D canvas found");
		return;
	}

	canvas.style.cursor = "crosshair";

	// Use pointerup to avoid conflict with camera controls (which use mousedown)
	pickCallback = function (e) {
		e.stopPropagation();

		var surfaceId = raycastSurface(e, canvas);
		if (surfaceId) {
			onPicked(surfaceId);
			showPickHighlight(surfaceId);
			console.log("CSG Pick: " + surfaceId);
		}

		// Reset
		exitPickMode();
		var dk = isDarkMode();
		pickRow.pickBtn.style.background = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		pickRow.pickBtn.style.borderColor = dk ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
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
	clearPickHighlight();
}

function raycastSurface(event, canvas) {
	var tr = window.threeRenderer;
	if (!tr || !tr.scene || !tr.camera || !tr.surfaceMeshMap) return null;

	var rect = canvas.getBoundingClientRect();
	var mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	var mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	var raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), tr.camera);

	// Collect all visible surface mesh children
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

// ────────────────────────────────────────────────────────
// Pick highlight: transparent overlay via SurfaceHighlightHelper
// ────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────
// Info dialog utility
// ────────────────────────────────────────────────────────

function showInfoDialog(message) {
	var content = document.createElement("div");
	content.style.padding = "15px";
	content.style.whiteSpace = "pre-wrap";
	content.textContent = message;

	var dialog = new FloatingDialog({
		title: "Solid Boolean (CSG)",
		content: content,
		width: 400,
		height: 200,
		showConfirm: true,
		confirmText: "OK",
		showCancel: false
	});
	dialog.show();
}
