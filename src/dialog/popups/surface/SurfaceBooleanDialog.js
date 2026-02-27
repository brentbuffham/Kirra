/**
 * SurfaceBooleanDialog.js
 *
 * Two-phase dialog for interactive split-and-pick surface boolean (Vulcan TRIBOOL style).
 * Phase 1: Pick two surfaces (dropdown + screen pick) → Split
 * Phase 2: PICK REGIONS — toggle visibility per split with icon buttons → Apply
 * Uses FloatingDialog + createEnhancedFormContent.
 */

import * as THREE from "three";
import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import {
	computeSplits,
	createSplitPreviewMeshes,
	createIntersectionPolylineMesh,
	updateSplitMeshAppearance,
	applyMerge
} from "../../../helpers/SurfaceBooleanHelper.js";
import { ensureZUpNormals } from "../../../helpers/SurfaceIntersectionHelper.js";
import { classifyNormalDirection } from "../../../helpers/SurfaceNormalHelper.js";
import { flashHighlight, clearHighlight, clearAllHighlights } from "../../../helpers/SurfaceHighlightHelper.js";

// ────────────────────────────────────────────────────────
// Split preview colors — jscolor palette (red → light grey, no black/white)
// ────────────────────────────────────────────────────────
var SPLIT_COLORS = [
	"#FF0000", "#FF9900", "#00ff00", "#00ffFF",
	"#0099ff", "#FF00FF", "#FFFF00", "#009900",
	"#AA0000", "#883300", "#33AA00", "#007F7F",
	"#002288", "#7F007F", "#AAAAAA", "#cccccc"
];

// ────────────────────────────────────────────────────────
// Module-level state
// ────────────────────────────────────────────────────────
var previewGroup = null;
var pickCallback = null;
var highlightedSurfaceId = null;
var hiddenSurfaceIds = []; // surfaces hidden during phase 2

function getThreeCanvas() {
	return window.threeRenderer ? window.threeRenderer.getCanvas() : null;
}

function clearPreview() {
	if (!previewGroup) return;
	var scene = window.threeRenderer ? window.threeRenderer.scene : null;
	if (scene) {
		scene.remove(previewGroup);
	}
	previewGroup.traverse(function (child) {
		if (child.geometry) child.geometry.dispose();
		if (child.material) child.material.dispose();
	});
	previewGroup = null;
}

function hideSurface(surfaceId) {
	var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceId) : null;
	if (surface) surface.visible = false;

	// Also hide the Three.js mesh directly
	if (window.threeRenderer && window.threeRenderer.surfaceMeshMap) {
		var mesh = window.threeRenderer.surfaceMeshMap.get(surfaceId);
		if (mesh) mesh.visible = false;
	}
}

function restoreHiddenSurfaces() {
	for (var i = 0; i < hiddenSurfaceIds.length; i++) {
		var surface = window.loadedSurfaces ? window.loadedSurfaces.get(hiddenSurfaceIds[i]) : null;
		if (surface) surface.visible = true;

		// Also restore the Three.js mesh
		if (window.threeRenderer && window.threeRenderer.surfaceMeshMap) {
			var mesh = window.threeRenderer.surfaceMeshMap.get(hiddenSurfaceIds[i]);
			if (mesh) mesh.visible = true;
		}
	}
	hiddenSurfaceIds = [];
	if (typeof window.drawData === "function") {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
}

// ────────────────────────────────────────────────────────
// Public: show the Surface Boolean dialog
// ────────────────────────────────────────────────────────

export function showSurfaceBooleanDialog() {
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
		showInfoDialog("Need at least 2 surfaces for boolean operations.\nImport or create surfaces first.");
		return;
	}

	showPhase1(surfaceEntries);
}

// ────────────────────────────────────────────────────────
// Phase 1: Surface selection with screen pick
// ────────────────────────────────────────────────────────

function showPhase1(surfaceEntries) {
	var surfaceOptions = surfaceEntries.map(function (se) {
		return { value: se.id, text: se.name + " (" + se.triCount + " tris)" };
	});

	// Build container with pick rows + gradient field
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px 0";

	// Surface A row
	var rowA = createPickRow("Surface A", surfaceOptions, surfaceOptions[0].value, function () {
		enterPickMode(rowA, function (surfaceId) {
			rowA.select.value = surfaceId;
		});
	});
	container.appendChild(rowA.row);

	// Surface B row
	var defaultB = surfaceOptions.length > 1 ? surfaceOptions[1].value : surfaceOptions[0].value;
	var rowB = createPickRow("Surface B", surfaceOptions, defaultB, function () {
		enterPickMode(rowB, function (surfaceId) {
			rowB.select.value = surfaceId;
		});
	});
	container.appendChild(rowB.row);

	// Gradient field
	var gradientFields = [
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
	var formContent = createEnhancedFormContent(gradientFields, false, false);
	container.appendChild(formContent);

	// Notes
	var notesDark = isDarkMode();
	var notesDiv = document.createElement("div");
	notesDiv.style.marginTop = "10px";
	notesDiv.style.fontSize = "10px";
	notesDiv.style.color = notesDark ? "#888" : "#666";
	notesDiv.innerHTML =
		"<strong>Surface Boolean (TRIBOOL):</strong><br>" +
		"&bull; Computes the intersection line between two surfaces<br>" +
		"&bull; Splits each surface into regions<br>" +
		"&bull; You then pick which regions to keep or remove<br>" +
		"&bull; Apply merges kept regions into a new surface<br>" +
		"<br><strong>Tip:</strong> Click the pick button then click a surface in the 3D view.";
	container.appendChild(notesDiv);

	var dialog = new FloatingDialog({
		title: "Surface Boolean — Select Surfaces",
		content: container,
		layoutType: "wide",
		width: 480,
		height: 400,
		showConfirm: true,
		showCancel: true,
		confirmText: "Split",
		cancelText: "Cancel",
		onConfirm: function () {
			exitPickMode();
			clearAllHighlights();

			var surfaceIdA = rowA.select.value;
			var surfaceIdB = rowB.select.value;
			var data = getFormData(formContent);

			if (surfaceIdA === surfaceIdB) {
				showInfoDialog("Surface A and Surface B must be different.");
				return;
			}

			// Show progress
			var progressDialog = showProgressDialog("Computing intersection splits...\nThis may take a moment for large surfaces.");

			setTimeout(async function () {
				var result = await computeSplits(surfaceIdA, surfaceIdB);

				if (progressDialog && progressDialog.close) {
					progressDialog.close();
				}

				if (!result || !result.splits || result.splits.length === 0) {
					showInfoDialog("No intersection found between the selected surfaces.\nThe surfaces may not overlap.");
					return;
				}

				showPhase2(result, data.gradient);
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
// Pick row builder (reused from SolidCSGDialog pattern)
// ────────────────────────────────────────────────────────

function createPickRow(label, options, defaultValue, onPick) {
	var dark = isDarkMode();
	var row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.gap = "8px";

	var labelEl = document.createElement("label");
	labelEl.textContent = label;
	labelEl.style.minWidth = "80px";
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
	exitPickMode();

	// Highlight button red (Kirra convention)
	pickRow.pickBtn.style.background = "rgba(255,60,60,0.4)";
	pickRow.pickBtn.style.borderColor = "#FF4444";

	var canvas = getThreeCanvas();
	if (!canvas) {
		console.warn("Surface Boolean Pick: No 3D canvas found");
		return;
	}

	canvas.style.cursor = "crosshair";

	pickCallback = function (e) {
		e.stopPropagation();

		var surfaceId = raycastSurface(e, canvas);
		if (surfaceId) {
			onPicked(surfaceId);
			showPickHighlight(surfaceId);
			console.log("Surface Boolean Pick: " + surfaceId);
		}

		exitPickMode();
		pickRow.pickBtn.style.background = "rgba(255,255,255,0.08)";
		pickRow.pickBtn.style.borderColor = "rgba(255,255,255,0.2)";
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
// Phase 2: PICK REGIONS — interactive split picker
// ────────────────────────────────────────────────────────

function showPhase2(splitResult, gradient) {
	var splits = splitResult.splits;

	// Step 1) Assign colors from SPLIT_COLORS palette
	for (var c = 0; c < splits.length; c++) {
		splits[c].color = SPLIT_COLORS[c % SPLIT_COLORS.length];
		splits[c].kept = true;
	}

	// Step 2) Label splits as SURF-A[1], SURF-A[2], SURF-B[1], SURF-B[2]
	var countA = 0;
	var countB = 0;
	for (var i = 0; i < splits.length; i++) {
		if (splits[i].surfaceId === splitResult.surfaceIdA) {
			countA++;
			splits[i].label = "SURF-A[" + countA + "] (" + splits[i].triangles.length + " tris)";
		} else {
			countB++;
			splits[i].label = "SURF-B[" + countB + "] (" + splits[i].triangles.length + " tris)";
		}
	}

	// Step 3) Hide original surfaces A and B
	hiddenSurfaceIds = [];
	hideSurface(splitResult.surfaceIdA);
	hiddenSurfaceIds.push(splitResult.surfaceIdA);
	hideSurface(splitResult.surfaceIdB);
	hiddenSurfaceIds.push(splitResult.surfaceIdB);

	// Step 4) Create colored preview meshes + intersection polyline
	clearPreview();
	if (window.threeRenderer && window.threeRenderer.scene) {
		previewGroup = createSplitPreviewMeshes(splits);
		if (previewGroup) {
			// Add intersection polyline visualization (bright yellow)
			var ixLine = createIntersectionPolylineMesh(splitResult.taggedSegments);
			if (ixLine) {
				previewGroup.add(ixLine);
				console.log("Surface Boolean: showing " + splitResult.taggedSegments.length + " intersection segments");
			}
			window.threeRenderer.scene.add(previewGroup);
		}
		// Redraw to reflect hidden originals + new previews
		if (typeof window.drawData === "function") {
			window.drawData(window.allBlastHoles, window.selectedHole);
		}
	}

	// Step 5) Build PICK REGIONS dialog UI
	var container = document.createElement("div");
	container.style.padding = "8px";

	// Header
	var p2Dark = isDarkMode();
	var headerDiv = document.createElement("div");
	headerDiv.style.fontSize = "11px";
	headerDiv.style.color = p2Dark ? "rgba(255,200,0,0.8)" : "rgba(180,120,0,0.9)";
	headerDiv.style.marginBottom = "8px";
	headerDiv.style.padding = "4px 8px";
	headerDiv.style.background = p2Dark ? "rgba(0,0,0,0.2)" : "rgba(255,240,200,0.5)";
	headerDiv.style.borderRadius = "4px";
	headerDiv.textContent = splits.length + " split regions — toggle visibility, then Apply to merge visible regions.";
	container.appendChild(headerDiv);

	// Split list
	var listDiv = document.createElement("div");
	listDiv.style.maxHeight = "220px";
	listDiv.style.overflowY = "auto";
	listDiv.style.border = p2Dark ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(0,0,0,0.15)";
	listDiv.style.borderRadius = "4px";
	listDiv.style.padding = "6px";
	listDiv.style.background = p2Dark ? "rgba(0,0,0,0.15)" : "rgba(240,240,240,0.5)";

	var splitRows = [];

	for (var s = 0; s < splits.length; s++) {
		(function (index) {
			var split = splits[index];

			var row = document.createElement("div");
			row.style.display = "flex";
			row.style.alignItems = "center";
			row.style.justifyContent = "space-between";
			row.style.padding = "5px 8px";
			row.style.marginBottom = "3px";
			row.style.borderRadius = "3px";
			row.style.fontSize = "12px";
			row.style.background = "rgba(255,255,255,0.05)";

			// Left: color swatch + label
			var leftDiv = document.createElement("div");
			leftDiv.style.display = "flex";
			leftDiv.style.alignItems = "center";
			leftDiv.style.gap = "8px";
			leftDiv.style.flex = "1";
			leftDiv.style.overflow = "hidden";

			var swatch = document.createElement("div");
			swatch.style.width = "14px";
			swatch.style.height = "14px";
			swatch.style.borderRadius = "3px";
			swatch.style.backgroundColor = split.color;
			swatch.style.border = "1px solid rgba(255,255,255,0.3)";
			swatch.style.flexShrink = "0";

			var label = document.createElement("span");
			label.style.overflow = "hidden";
			label.style.textOverflow = "ellipsis";
			label.style.whiteSpace = "nowrap";
			label.textContent = split.label;

			// Normal direction badge (updated dynamically after flip/align)
			var badge = document.createElement("span");
			badge.style.fontSize = "10px";
			badge.style.fontWeight = "bold";
			badge.style.padding = "1px 4px";
			badge.style.borderRadius = "3px";
			badge.style.flexShrink = "0";
			updateNormalBadge(badge, split, p2Dark);

			leftDiv.appendChild(swatch);
			leftDiv.appendChild(label);
			leftDiv.appendChild(badge);

			// Right: remove/add icon buttons
			var btnDiv = document.createElement("div");
			btnDiv.style.display = "flex";
			btnDiv.style.gap = "4px";
			btnDiv.style.flexShrink = "0";

			var removeBtn = createIconButton("icons/triangle-minus.png", "Hide / Remove from result", function () {
				split.kept = false;
				updateRowAppearance(row, swatch, split);
				updateSplitPreview(index, false);
			});

			var addBtn = createIconButton("icons/triangle-plus.png", "Show / Add to result", function () {
				split.kept = true;
				updateRowAppearance(row, swatch, split);
				updateSplitPreview(index, true);
			});

			var flipBtn = createIconButton("icons/flip-horizontal.png", "Flip Normals on this region", function () {
				flipSplitRegionNormals(split, index);
				updateNormalBadge(badge, split, p2Dark);
			});

			var alignBtn = createIconButton("icons/arrows-up.png", "Align Normals Z-Up on this region", function () {
				alignSplitRegionNormals(split, index);
				updateNormalBadge(badge, split, p2Dark);
			});

			btnDiv.appendChild(removeBtn);
			btnDiv.appendChild(addBtn);
			btnDiv.appendChild(flipBtn);
			btnDiv.appendChild(alignBtn);

			row.appendChild(leftDiv);
			row.appendChild(btnDiv);
			listDiv.appendChild(row);

			splitRows.push({ row: row, swatch: swatch, split: split, index: index });
		})(s);
	}

	container.appendChild(listDiv);

	// ── Row 1: Invert + Snap ──
	var row1 = document.createElement("div");
	row1.style.display = "flex";
	row1.style.gap = "8px";
	row1.style.marginTop = "10px";
	row1.style.alignItems = "center";

	var invertBtn = createIconButton("icons/switch.png", "Invert All: Swap kept/hidden on every region", function () {
		for (var i = 0; i < splitRows.length; i++) {
			var sr = splitRows[i];
			sr.split.kept = !sr.split.kept;
			updateRowAppearance(sr.row, sr.swatch, sr.split);
			updateSplitPreview(sr.index, sr.split.kept);
		}
	});
	invertBtn.style.width = "32px";
	invertBtn.style.height = "32px";

	var invertLabel = document.createElement("span");
	invertLabel.textContent = "Invert All";
	invertLabel.style.fontSize = "11px";
	invertLabel.style.color = p2Dark ? "#aaa" : "#555";

	row1.appendChild(invertBtn);
	row1.appendChild(invertLabel);

	var snapLabel = createInlineLabel("Snap:", "auto");
	snapLabel.title = "Weld tolerance: vertices closer than this distance are merged into one";
	var snapInput = createSmallInput("0.001", "60px", "0.001", "0");
	snapInput.title = "Weld tolerance in metres — vertices within this distance are merged";
	snapLabel.appendChild(snapInput);
	snapLabel.appendChild(document.createTextNode("m"));
	row1.appendChild(snapLabel);

	container.appendChild(row1);

	// ── Row 2: Close Mode ──
	var row2 = document.createElement("div");
	row2.style.display = "flex";
	row2.style.gap = "8px";
	row2.style.marginTop = "6px";
	row2.style.alignItems = "center";

	var closeModeLabel = createInlineLabel("Close:", "0");
	closeModeLabel.title = "Controls how open boundary edges are handled after boolean merge";
	var closeModeSelect = document.createElement("select");
	applySmallSelectStyle(closeModeSelect);
	closeModeSelect.title = "None: raw merge, seam is a tear\nStitch Intersection: weld seam only, boundaries stay open\nClose by Stitching: weld + bridge + cap to produce a closed solid";
	var closeModeOptions = [
		{ value: "raw", text: "None", disabled: false },
		{ value: "none", text: "Stitch Intersection", disabled: false },
		{ value: "stitch", text: "Close by Stitching", disabled: false },
		{ value: "curtain", text: "Close by Capping", disabled: true },
		{ value: "stitch+curtain", text: "Close by Curtain", disabled: true }
	];
	for (var cm = 0; cm < closeModeOptions.length; cm++) {
		var opt = document.createElement("option");
		opt.value = closeModeOptions[cm].value;
		opt.textContent = closeModeOptions[cm].text;
		if (closeModeOptions[cm].disabled) {
			opt.disabled = true;
			opt.style.color = "#666";
		}
		closeModeSelect.appendChild(opt);
	}
	closeModeLabel.appendChild(closeModeSelect);
	row2.appendChild(closeModeLabel);

	var stitchTolLabel = createInlineLabel("Stitch tol:", "0");
	stitchTolLabel.style.display = "none";
	stitchTolLabel.title = "Max distance (m) to bridge boundary edge pairs. Both endpoints must be within this distance.";
	var stitchTolInput = createSmallInput("1.0", "60px", "0.1", "0");
	stitchTolInput.title = "Max distance (m) to bridge boundary edge pairs. Both endpoints must be within this distance.";
	stitchTolLabel.appendChild(stitchTolInput);
	stitchTolLabel.appendChild(document.createTextNode("m"));
	row2.appendChild(stitchTolLabel);

	closeModeSelect.addEventListener("change", function () {
		stitchTolLabel.style.display = closeModeSelect.value === "stitch" ? "flex" : "none";
		updateInfoText(closeModeSelect.value);
	});

	container.appendChild(row2);

	// ── Row 3: Cleanup Options (vertical stack) ──
	var row3 = document.createElement("div");
	row3.style.display = "flex";
	row3.style.flexDirection = "column";
	row3.style.gap = "4px";
	row3.style.marginTop = "6px";
	row3.style.padding = "6px 8px";
	row3.style.background = p2Dark ? "rgba(0,0,0,0.15)" : "rgba(240,240,240,0.5)";
	row3.style.borderRadius = "4px";
	row3.style.border = p2Dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.1)";

	var cleanTitle = document.createElement("span");
	cleanTitle.textContent = "Cleanup:";
	cleanTitle.style.fontSize = "11px";
	cleanTitle.style.color = p2Dark ? "#aaa" : "#555";
	cleanTitle.style.fontWeight = "bold";
	cleanTitle.title = "Post-merge cleanup operations to improve mesh quality";
	row3.appendChild(cleanTitle);

	// Helper: wrap checkbox + optional inline input into a row
	function createCleanupRow(checkResult, extraLabel) {
		var rowDiv = document.createElement("div");
		rowDiv.style.display = "flex";
		rowDiv.style.alignItems = "center";
		rowDiv.style.gap = "8px";
		rowDiv.style.marginLeft = "4px";
		rowDiv.appendChild(checkResult.label);
		if (extraLabel) rowDiv.appendChild(extraLabel);
		return rowDiv;
	}

	// Remove Degenerate checkbox (on by default)
	var degenerateCheck = createCheckboxLabel("Remove Degenerate", true);
	degenerateCheck.label.title = "Remove triangles with near-zero area (< 0.000001 m\u00B2). Safe \u2014 recommended to leave on.";
	row3.appendChild(createCleanupRow(degenerateCheck));

	// Remove Slivers checkbox + ratio input (off by default)
	var sliverCheck = createCheckboxLabel("Remove Slivers", false);
	sliverCheck.label.title = "\u26A0 Remove needle-thin triangles. May punch holes in valid thin geometry at seam boundaries. Off by default.";
	var sliverRatioLabel = createInlineLabel("ratio:", "0");
	sliverRatioLabel.style.display = "none";
	sliverRatioLabel.title = "Altitude-to-edge ratio threshold. Lower = only extreme slivers. Higher = more aggressive.";
	var sliverRatioInput = createSmallInput("0.01", "50px", "0.001", "0");
	sliverRatioInput.title = "Altitude-to-edge ratio threshold. Lower = only extreme slivers. Higher = more aggressive.";
	sliverRatioLabel.appendChild(sliverRatioInput);
	row3.appendChild(createCleanupRow(sliverCheck, sliverRatioLabel));

	sliverCheck.checkbox.addEventListener("change", function () {
		sliverRatioLabel.style.display = sliverCheck.checkbox.checked ? "flex" : "none";
	});

	// Clean Crossings checkbox (off by default)
	var crossingCheck = createCheckboxLabel("Clean Crossings", false);
	crossingCheck.label.title = "Fix non-manifold edges (3+ triangles sharing one edge) \u2014 keeps the 2 largest per edge. Also removes exact duplicate triangles. Runs before AND after stitching/capping.";
	row3.appendChild(createCleanupRow(crossingCheck));

	// Remove Overlapping / Internal Walls checkbox + tolerance (off by default)
	var overlapCheck = createCheckboxLabel("Remove Overlapping", false);
	overlapCheck.label.title = "Remove internal walls (anti-parallel triangle pairs) and near-duplicate triangles with close centroids. \u26A0 May remove valid thin walls if tolerance is too large.";
	var overlapTolLabel = createInlineLabel("tol:", "0");
	overlapTolLabel.style.display = "none";
	overlapTolLabel.title = "Max centroid distance (m) to detect overlapping pairs. Start with 0.5m, reduce if valid geometry is removed.";
	var overlapTolInput = createSmallInput("0.5", "50px", "0.1", "0");
	overlapTolInput.title = "Max centroid distance (m) to detect overlapping pairs. Start with 0.5m, reduce if valid geometry is removed.";
	overlapTolLabel.appendChild(overlapTolInput);
	overlapTolLabel.appendChild(document.createTextNode("m"));
	row3.appendChild(createCleanupRow(overlapCheck, overlapTolLabel));

	overlapCheck.checkbox.addEventListener("change", function () {
		overlapTolLabel.style.display = overlapCheck.checkbox.checked ? "flex" : "none";
	});

	container.appendChild(row3);

	// ── Info Section ──
	var infoDiv = document.createElement("div");
	infoDiv.style.marginTop = "8px";
	infoDiv.style.padding = "6px 8px";
	infoDiv.style.fontSize = "10px";
	infoDiv.style.lineHeight = "1.5";
	infoDiv.style.color = p2Dark ? "#888" : "#666";
	infoDiv.style.background = p2Dark ? "rgba(0,0,0,0.2)" : "rgba(245,245,245,0.8)";
	infoDiv.style.borderRadius = "4px";
	infoDiv.style.border = p2Dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.08)";

	function updateInfoText(mode) {
		var buttons = "<b>Buttons per region:</b> " +
			"<span style='opacity:0.7'>&#9651;&#8722;</span> Hide | " +
			"<span style='opacity:0.7'>&#9651;+</span> Show | " +
			"<span style='opacity:0.7'>&#8644;</span> Flip Normals | " +
			"<span style='opacity:0.7'>&#8657;</span> Align Z-Up";
		if (mode === "stitch") {
			infoDiv.innerHTML =
				"<b>Close by Stitching:</b> Welds seam, bridges open edges within <i>Stitch tolerance</i>, " +
				"then sequentially caps boundary loops (one at a time, with non-manifold cleanup between each). " +
				"Post-cap cleanup removes duplicates/overlaps. Safety-net closer handles any remaining gaps.<br>" + buttons;
		} else if (mode === "raw") {
			infoDiv.innerHTML =
				"<b>None:</b> No post-processing. Kept regions are merged as raw triangle soup " +
				"without welding or stitching. Vertices along the intersection will be duplicated " +
				"(seam is a tear, not welded).<br>" + buttons;
		} else {
			infoDiv.innerHTML =
				"<b>Stitch Intersection:</b> Welds vertices along the intersection seam so the kept " +
				"regions share edges cleanly. Outer boundaries remain open. This is the fastest mode.<br>" + buttons;
		}
	}
	updateInfoText("raw");
	container.appendChild(infoDiv);

	// Step 6) Create dialog
	var dialog = new FloatingDialog({
		title: "Surface Boolean — Pick Regions",
		content: container,
		layoutType: "wide",
		width: 480,
		height: 600,
		showConfirm: true,
		showCancel: true,
		confirmText: "Apply",
		cancelText: "Cancel",
		onConfirm: function () {
			// Check at least one split is kept
			var anyKept = false;
			for (var i = 0; i < splits.length; i++) {
				if (splits[i].kept) { anyKept = true; break; }
			}
			if (!anyKept) {
				showInfoDialog("No regions are visible. Add at least one region to keep.");
				return;
			}

			clearPreview();
			restoreHiddenSurfaces();

			var snapTol = parseFloat(snapInput.value) || 0;
			var closeMode = closeModeSelect.value || "none";
			var mergeConfig = {
				gradient: gradient,
				surfaceIdA: splitResult.surfaceIdA,
				surfaceIdB: splitResult.surfaceIdB,
				closeMode: closeMode,
				snapTolerance: snapTol,
				stitchTolerance: parseFloat(stitchTolInput.value) || 1.0,
				removeDegenerate: degenerateCheck.checkbox.checked,
				removeSlivers: sliverCheck.checkbox.checked,
				sliverRatio: parseFloat(sliverRatioInput.value) || 0.01,
				cleanCrossings: crossingCheck.checkbox.checked,
				removeOverlapping: overlapCheck.checkbox.checked,
				overlapTolerance: parseFloat(overlapTolInput.value) || 0.5
			};

			// Run merge async with progress dialog to avoid UI freeze
			var progressDialog = showProgressDialog(
				"Merging " + splits.filter(function (s) { return s.kept; }).length +
				" regions...\nMode: " + (closeMode === "stitch" ? "Close by Stitching" : "Stitch Intersection")
			);

			setTimeout(async function () {
				var resultId = await applyMerge(splits, mergeConfig);

				if (progressDialog && progressDialog.close) {
					progressDialog.close();
				}

				if (resultId) {
					console.log("Surface Boolean applied: " + resultId);
				} else {
					showInfoDialog("Surface Boolean failed to produce a result.");
				}
			}, 50);
		},
		onCancel: function () {
			clearPreview();
			restoreHiddenSurfaces();
		}
	});

	dialog.show();
}

// ────────────────────────────────────────────────────────
// UI helpers
// ────────────────────────────────────────────────────────

function createIconButton(iconSrc, tooltip, onClick) {
	var dark = isDarkMode();
	var btn = document.createElement("button");
	btn.type = "button";
	btn.title = tooltip;
	btn.style.width = "26px";
	btn.style.height = "26px";
	btn.style.padding = "2px";
	btn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
	btn.style.borderRadius = "4px";
	btn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
	btn.style.cursor = "pointer";
	btn.style.display = "flex";
	btn.style.alignItems = "center";
	btn.style.justifyContent = "center";
	btn.style.flexShrink = "0";

	var img = document.createElement("img");
	img.src = iconSrc;
	img.style.width = "18px";
	img.style.height = "18px";
	img.style.filter = dark ? "invert(0.8)" : "invert(0.2)";
	btn.appendChild(img);

	btn.addEventListener("click", onClick);
	return btn;
}

/**
 * Check dark mode state.
 */
function isDarkMode() {
	return typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
}

/**
 * Create a small inline label with flex layout.
 */
function createInlineLabel(text, marginLeft) {
	var dark = isDarkMode();
	var label = document.createElement("label");
	label.style.display = "flex";
	label.style.alignItems = "center";
	label.style.gap = "4px";
	label.style.marginLeft = marginLeft || "0";
	label.style.fontSize = "11px";
	label.style.color = dark ? "#ccc" : "#333";
	label.appendChild(document.createTextNode(text));
	return label;
}

/**
 * Create a small numeric input.
 */
function createSmallInput(value, width, step, min) {
	var dark = isDarkMode();
	var input = document.createElement("input");
	input.type = "number";
	input.value = value;
	input.step = step || "0.001";
	input.min = min || "0";
	input.style.width = width || "60px";
	input.style.fontSize = "11px";
	input.style.padding = "2px 4px";
	input.style.background = dark ? "#333" : "#fff";
	input.style.color = dark ? "#ccc" : "#333";
	input.style.border = dark ? "1px solid #555" : "1px solid #999";
	input.style.borderRadius = "3px";
	return input;
}

/**
 * Apply standard small select styling.
 */
function applySmallSelectStyle(select) {
	var dark = isDarkMode();
	select.style.fontSize = "11px";
	select.style.padding = "2px 4px";
	select.style.background = dark ? "#333" : "#fff";
	select.style.color = dark ? "#ccc" : "#333";
	select.style.border = dark ? "1px solid #555" : "1px solid #999";
	select.style.borderRadius = "3px";
}

/**
 * Create a checkbox with inline label. Returns { label, checkbox }.
 */
function createCheckboxLabel(text, checked) {
	var dark = isDarkMode();
	var label = document.createElement("label");
	label.style.display = "flex";
	label.style.alignItems = "center";
	label.style.gap = "3px";
	label.style.fontSize = "11px";
	label.style.color = dark ? "#ccc" : "#333";
	label.style.cursor = "pointer";
	label.style.whiteSpace = "nowrap";

	var cb = document.createElement("input");
	cb.type = "checkbox";
	cb.checked = !!checked;
	cb.style.cursor = "pointer";
	cb.style.margin = "0";

	label.appendChild(cb);
	label.appendChild(document.createTextNode(text));
	return { label: label, checkbox: cb };
}

function updateNormalBadge(badge, split, dark) {
	var dir = classifyNormalDirection(split.triangles, false, 0);
	badge.textContent = "[" + dir + "]";
	if (dir === "Z+" || dir === "Out") {
		badge.style.color = "#00CC44";
		badge.style.background = "rgba(0,204,68,0.15)";
	} else if (dir === "Z-" || dir === "In") {
		badge.style.color = "#FF8800";
		badge.style.background = "rgba(255,136,0,0.15)";
	} else if (dir === "Chaos") {
		badge.style.color = "#FF3333";
		badge.style.background = "rgba(255,51,51,0.15)";
	} else {
		badge.style.color = dark ? "#aaa" : "#666";
		badge.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
	}
}

function updateRowAppearance(row, swatch, split) {
	if (split.kept) {
		row.style.opacity = "1";
		swatch.style.backgroundColor = split.color;
	} else {
		row.style.opacity = "0.4";
		swatch.style.backgroundColor = "#444";
	}
}

function updateSplitPreview(splitIndex, kept) {
	if (!previewGroup) return;
	var children = previewGroup.children;
	for (var i = 0; i < children.length; i++) {
		if (children[i].userData && children[i].userData.splitIndex === splitIndex) {
			updateSplitMeshAppearance(children[i], kept);
			break;
		}
	}
	if (window.threeRenderer) {
		window.threeRenderer.render();
	}
}

/**
 * Flip normals on a single split region's triangle data and rebuild its preview mesh.
 * Swaps v1↔v2 on every triangle in the split, then rebuilds the BufferGeometry.
 */
function flipSplitRegionNormals(split, splitIndex) {
	// Flip the triangle data in-place (swap v1 and v2 references, not coordinates)
	// Swapping references is safe with shared vertex objects from deduplicateSeamVertices
	for (var i = 0; i < split.triangles.length; i++) {
		var tri = split.triangles[i];
		var tmp = tri.v1;
		tri.v1 = tri.v2;
		tri.v2 = tmp;
	}

	// Rebuild the preview mesh geometry
	if (!previewGroup) return;
	var children = previewGroup.children;
	for (var c = 0; c < children.length; c++) {
		if (children[c].userData && children[c].userData.splitIndex === splitIndex) {
			var group = children[c];

			// Rebuild positions from flipped triangles
			var positions = [];
			for (var t = 0; t < split.triangles.length; t++) {
				var tri = split.triangles[t];
				var l0 = window.worldToThreeLocal(tri.v0.x, tri.v0.y);
				var l1 = window.worldToThreeLocal(tri.v1.x, tri.v1.y);
				var l2 = window.worldToThreeLocal(tri.v2.x, tri.v2.y);
				positions.push(
					l0.x, l0.y, tri.v0.z,
					l1.x, l1.y, tri.v1.z,
					l2.x, l2.y, tri.v2.z
				);
			}

			var newGeom = new THREE.BufferGeometry();
			newGeom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
			newGeom.computeVertexNormals();

			// Update solid fill mesh and wireframe
			group.traverse(function (child) {
				if (child.isMesh && child.name === "solidFill") {
					if (child.geometry) child.geometry.dispose();
					child.geometry = newGeom.clone();
				}
				if (child.isLineSegments && child.name === "wireframe") {
					if (child.geometry) child.geometry.dispose();
					child.geometry = new THREE.WireframeGeometry(newGeom);
				}
			});

			break;
		}
	}

	console.log("Flip Normals: flipped " + split.triangles.length + " tris on split region " + splitIndex);

	if (window.threeRenderer) {
		window.threeRenderer.render();
	}
}

/**
 * Align normals Z-up on a single split region using ensureZUpNormals.
 * Replaces the split's triangles with Z-up aligned clones, then rebuilds the preview mesh.
 */
function alignSplitRegionNormals(split, splitIndex) {
	// ensureZUpNormals returns a new array of cloned triangles with Z-up normals
	var aligned = ensureZUpNormals(split.triangles);
	split.triangles = aligned;

	// Rebuild the preview mesh geometry
	if (!previewGroup) return;
	var children = previewGroup.children;
	for (var c = 0; c < children.length; c++) {
		if (children[c].userData && children[c].userData.splitIndex === splitIndex) {
			var group = children[c];

			var positions = [];
			for (var t = 0; t < split.triangles.length; t++) {
				var tri = split.triangles[t];
				var l0 = window.worldToThreeLocal(tri.v0.x, tri.v0.y);
				var l1 = window.worldToThreeLocal(tri.v1.x, tri.v1.y);
				var l2 = window.worldToThreeLocal(tri.v2.x, tri.v2.y);
				positions.push(
					l0.x, l0.y, tri.v0.z,
					l1.x, l1.y, tri.v1.z,
					l2.x, l2.y, tri.v2.z
				);
			}

			var newGeom = new THREE.BufferGeometry();
			newGeom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
			newGeom.computeVertexNormals();

			group.traverse(function (child) {
				if (child.isMesh && child.name === "solidFill") {
					if (child.geometry) child.geometry.dispose();
					child.geometry = newGeom.clone();
				}
				if (child.isLineSegments && child.name === "wireframe") {
					if (child.geometry) child.geometry.dispose();
					child.geometry = new THREE.WireframeGeometry(newGeom);
				}
			});

			break;
		}
	}

	console.log("Align Normals Z-Up: aligned " + split.triangles.length + " tris on split region " + splitIndex);

	if (window.threeRenderer) {
		window.threeRenderer.render();
	}
}

// ────────────────────────────────────────────────────────
// Info / progress dialogs
// ────────────────────────────────────────────────────────

function showInfoDialog(message) {
	var content = document.createElement("div");
	content.style.padding = "15px";
	content.style.whiteSpace = "pre-wrap";
	content.textContent = message;

	var dialog = new FloatingDialog({
		title: "Surface Boolean",
		content: content,
		width: 400,
		height: 200,
		showConfirm: true,
		confirmText: "OK",
		showCancel: false
	});
	dialog.show();
}

function showProgressDialog(message) {
	var content = document.createElement("div");
	content.style.padding = "15px";
	content.style.whiteSpace = "pre-wrap";
	content.style.textAlign = "center";
	content.textContent = message;

	var dialog = new FloatingDialog({
		title: "Surface Boolean",
		content: content,
		width: 350,
		height: 160,
		showConfirm: false,
		showCancel: false
	});
	dialog.show();
	return dialog;
}
