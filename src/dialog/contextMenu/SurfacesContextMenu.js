// src/dialog/contextMenu/SurfacesContextMenu.js
//=============================================================
// SURFACES CONTEXT MENU
//=============================================================
// Step 0) Converted to ES Module for Vite bundling - 2025-12-26

import { computeSurfaceStatistics, classifyNormalDirection, flipSurfaceNormals, alignSurfaceNormals, setSurfaceNormalsDirection } from "../../helpers/SurfaceNormalHelper.js";
import { extractTriangles } from "../../helpers/SurfaceIntersectionHelper.js";
import { detectMeshProblems, countUnweldedVertices, weldVertices, weldedToSoup, extractBoundaryLoops, triangulateLoop, capBoundaryLoopsSequential, closeMeshIndexed, cleanCrossingTriangles, removeDegenerateTriangles } from "../../helpers/MeshRepairHelper.js";
import * as THREE from "three";

// Module-level group for mesh check highlights — cleared on dialog close
var meshCheckGroup = null;

// Module-level last check results — used by repair buttons
var lastCheckProblems = null;

// Module-level state for show normals toggle
var lastShowNormalsChecked = false;

// Module-level refs for normal direction buttons — toggled by runMeshCheck
var normalBtnIn = null, normalBtnOut = null, normalBtnFlip = null, normalBtnAlign = null;

// Step 1) Show surface context menu
export function showSurfaceContextMenu(x, y, surfaceId = null) {
	// Step 1a) Stop any ongoing drag operations
	window.isDragging = false;
	// Step 1b) Clear any pending long press timeouts
	if (typeof window.longPressTimeout !== "undefined") {
		clearTimeout(window.longPressTimeout);
		window.longPressTimeout = null;
	}

	// Step 1c) Reset pan start positions to prevent jump when next drag starts
	if (typeof window.startPanX !== "undefined") {
		window.startPanX = null;
		window.startPanY = null;
	}

	// Step 2) Get the specific surface if ID provided, otherwise first visible surface
	var surface = surfaceId
		? window.loadedSurfaces.get(surfaceId)
		: Array.from(window.loadedSurfaces.values()).find(function (s) {
			return s.visible;
		});
	if (!surface) return;

	// Step 3) Store reference for dialog callbacks
	var currentSurface = surface;

	// Step 4) Define gradient options - include texture option for textured meshes
	var gradientOptions = [{ value: "default", text: "Default" }, { value: "hillshade", text: "Hillshade" }, { value: "viridis", text: "Viridis" }, { value: "turbo", text: "Turbo" }, { value: "parula", text: "Parula" }, { value: "cividis", text: "Cividis" }, { value: "terrain", text: "Terrain" }];

	// Step 4a) Add texture option if this is a textured mesh
	if (currentSurface.isTexturedMesh) {
		gradientOptions.unshift({ value: "texture", text: "Texture (Original)" });
	}

	// Step 4b) Add analysis option if surface has baked analysis texture
	if (currentSurface.analysisTexture && currentSurface.analysisCanvas) {
		gradientOptions.unshift({ value: "analysis", text: "Analysis (" + (currentSurface.analysisModel || "PPV") + ")" });
	}

	// Step 5) Create fields array for form content
	var initialTransparency = Math.round((currentSurface.transparency || 1.0) * 100);
	var currentGradient = currentSurface.gradient || "default";
	var currentMinLimit = currentSurface.minLimit !== undefined ? currentSurface.minLimit : null;
	var currentMaxLimit = currentSurface.maxLimit !== undefined ? currentSurface.maxLimit : null;

	// Get actual surface min/max for reference
	var actualMinZ = Infinity;
	var actualMaxZ = -Infinity;
	if (currentSurface.points && currentSurface.points.length > 0) {
		for (var i = 0; i < currentSurface.points.length; i++) {
			var point = currentSurface.points[i];
			if (point.z < actualMinZ) actualMinZ = point.z;
			if (point.z > actualMaxZ) actualMaxZ = point.z;
		}
	}

	var fields = [
		{
			label: "Transparency",
			name: "transparency",
			type: "slider",
			value: initialTransparency,
			min: 0,
			max: 100,
			step: 1,
			minLabel: "0%",
			maxLabel: "100%"
		},
		{
			label: "Color Gradient",
			name: "gradient",
			type: "select",
			value: currentGradient,
			options: gradientOptions
		},
		{
			label: "Min Z (actual: " + (isFinite(actualMinZ) ? actualMinZ.toFixed(2) : "N/A") + ")",
			name: "minLimit",
			type: "number",
			value: currentMinLimit,
			step: 0.1,
			placeholder: "Auto (no limit)",
			style: "width:100px"
		},
		{
			label: "Max Z (actual: " + (isFinite(actualMaxZ) ? actualMaxZ.toFixed(2) : "N/A") + ")",
			name: "maxLimit",
			type: "number",
			value: currentMaxLimit,
			step: 0.1,
			placeholder: "Auto (no limit)",
			style: "width:100px"
		}
	];

	// Step 6) Create form content using enhanced form helper
	var formContent = window.createEnhancedFormContent ? window.createEnhancedFormContent(fields, false, false) : document.createElement("div");

	// Step 6a) Fallback if createEnhancedFormContent doesn't exist
	if (!window.createEnhancedFormContent) {
		fields.forEach(function (field) {
			var fieldDiv = document.createElement("div");
			fieldDiv.className = "form-field";
			fieldDiv.style.marginBottom = "10px";

			var label = document.createElement("label");
			label.textContent = field.label + ":";
			label.style.display = "inline-block";
			label.style.width = "100px";
			fieldDiv.appendChild(label);

			if (field.type === "select") {
				var select = document.createElement("select");
				select.name = field.name;
				field.options.forEach(function (opt) {
					var option = document.createElement("option");
					option.value = opt.value;
					option.textContent = opt.text;
					if (opt.value === field.value) {
						option.selected = true;
					}
					select.appendChild(option);
				});
				fieldDiv.appendChild(select);
			} else {
				var input = document.createElement("input");
				input.type = field.type;
				input.name = field.name;
				input.value = field.value;
				if (field.type === "range") {
					input.min = field.min;
					input.max = field.max;
					input.step = field.step;
				}
				fieldDiv.appendChild(input);
			}
			formContent.appendChild(fieldDiv);
		});
	}

	// Step 6b) Add hillshade color picker section (initially hidden, shown when hillshade is selected)
	var hillshadeSection = document.createElement("div");
	hillshadeSection.id = "hillshadeColorSection";
	hillshadeSection.style.gridColumn = "1 / -1";
	hillshadeSection.style.display = currentGradient === "hillshade" ? "flex" : "none";
	hillshadeSection.style.alignItems = "center";
	hillshadeSection.style.gap = "8px";
	hillshadeSection.style.marginTop = "10px";

	var hillshadeLabel = document.createElement("label");
	hillshadeLabel.textContent = "Hillshade Color:";
	hillshadeLabel.className = "labelWhite12";

	var hillshadeColorInput = document.createElement("input");
	hillshadeColorInput.type = "text";
	hillshadeColorInput.name = "hillshadeColor";
	hillshadeColorInput.className = "jscolor";
	hillshadeColorInput.setAttribute("data-jscolor", "{}");
	hillshadeColorInput.value = currentSurface.hillshadeColor || "#808080";
	hillshadeColorInput.style.width = "80px";
	hillshadeColorInput.style.height = "24px";
	hillshadeColorInput.style.cursor = "pointer";

	hillshadeSection.appendChild(hillshadeLabel);
	hillshadeSection.appendChild(hillshadeColorInput);
	formContent.appendChild(hillshadeSection);

	// Step 6b-1) Listen for gradient change to show/hide hillshade color picker
	var gradientSelect = formContent.querySelector("select[name='gradient']");
	if (gradientSelect) {
		gradientSelect.addEventListener("change", function () {
			var isHillshade = gradientSelect.value === "hillshade";
			hillshadeSection.style.display = isHillshade ? "flex" : "none";
		});
	}

	// Legend checkbox removed — now driven by displayLegend checkbox in toolbar

	// Step 6d) Add normals direction badge
	var normalsSection = document.createElement("div");
	normalsSection.style.gridColumn = "1 / -1";
	normalsSection.style.display = "flex";
	normalsSection.style.alignItems = "center";
	normalsSection.style.gap = "8px";
	normalsSection.style.marginTop = "10px";

	var normalsLabel = document.createElement("label");
	normalsLabel.textContent = "Normals:";
	normalsLabel.className = "labelWhite12";

	// Compute normals direction and open/closed status
	var surfTris = extractTriangles(currentSurface);
	var isClosed = typeof window.isSurfaceClosed === "function" && window.isSurfaceClosed(currentSurface);
	var volume = 0;
	if (isClosed && surfTris.length > 0) {
		for (var ti = 0; ti < surfTris.length; ti++) {
			var sv0 = surfTris[ti].v0, sv1 = surfTris[ti].v1, sv2 = surfTris[ti].v2;
			volume += (sv0.x * (sv1.y * sv2.z - sv2.y * sv1.z) -
				sv1.x * (sv0.y * sv2.z - sv2.y * sv0.z) +
				sv2.x * (sv0.y * sv1.z - sv1.y * sv0.z)) / 6.0;
		}
	}
	var normalDir = classifyNormalDirection(surfTris, isClosed, volume);
	var topologyText = isClosed ? "Closed" : "Open";

	var normalsBadge = document.createElement("span");
	normalsBadge.textContent = normalDir;
	normalsBadge.className = "surface-badge";
	if (normalDir === "Up" || normalDir === "Out" || normalDir === "Z+") {
		normalsBadge.className += " surface-badge-green";
	} else if (normalDir === "Down" || normalDir === "In" || normalDir === "Z-") {
		normalsBadge.className += " surface-badge-red";
	} else {
		normalsBadge.className += " surface-badge-yellow";
	}

	var topologyBadge = document.createElement("span");
	topologyBadge.textContent = topologyText;
	topologyBadge.className = "surface-badge";
	if (isClosed) {
		topologyBadge.className += " surface-badge-blue";
	} else {
		topologyBadge.className += " surface-badge-grey";
	}

	normalsSection.appendChild(normalsLabel);
	normalsSection.appendChild(normalsBadge);
	normalsSection.appendChild(topologyBadge);
	formContent.appendChild(normalsSection);

	// Step 7) Create dialog with footer buttons
	var dialog = new window.FloatingDialog({
		title: currentSurface.name || "Surface Properties",
		content: formContent,
		layoutType: "compact",
		width: 370,
		height: 300,
		showConfirm: true, // "Ok" button
		showCancel: true, // "Cancel" button
		showOption1: true, // "Delete" button
		showOption2: true, // "Hide" button
		showOption3: true, // "Statistics" button
		confirmText: "Ok",
		cancelText: "Cancel",
		option1Text: "Delete",
		option2Text: currentSurface.visible ? "Hide" : "Show",
		option3Text: "Statistics",
		onConfirm: function () {
			// Step 7a) Get form values and commit changes
			var formData = window.getFormData ? window.getFormData(formContent) : {};
			var newTransparency = formData.transparency !== undefined ? parseFloat(formData.transparency) / 100 : currentSurface.transparency;
			var newGradient = formData.gradient !== undefined ? formData.gradient : currentSurface.gradient;


			// Handle min/max limits (convert empty strings to null)
			var newMinLimit = formData.minLimit !== undefined && formData.minLimit !== "" ? parseFloat(formData.minLimit) : null;
			var newMaxLimit = formData.maxLimit !== undefined && formData.maxLimit !== "" ? parseFloat(formData.maxLimit) : null;

			// Step 7a-1) Get hillshade color if using hillshade gradient
			var newHillshadeColor = currentSurface.hillshadeColor || null; // Preserve existing color
			if (newGradient === "hillshade") {
				// Step 7a-2) Try to get color from jscolor instance or input value
				var hillshadeInput = formContent.querySelector("input[name='hillshadeColor']");
				if (hillshadeInput && hillshadeInput.jscolor) {
					newHillshadeColor = hillshadeInput.jscolor.toHEXString();
				} else if (hillshadeInput && hillshadeInput.value) {
					// Step 7a-3) Ensure the value has # prefix
					var colorVal = hillshadeInput.value;
					if (colorVal && colorVal.charAt(0) !== "#") {
						colorVal = "#" + colorVal;
					}
					newHillshadeColor = colorVal;
				}
			}

			currentSurface.transparency = newTransparency;
			currentSurface.gradient = newGradient;
			currentSurface.hillshadeColor = newHillshadeColor;
			currentSurface.minLimit = newMinLimit;
			currentSurface.maxLimit = newMaxLimit;
			// Legend toggle now in toolbar — no longer set here

			// Step 7a-4) Invalidate 2D surface cache so it re-renders with new settings
			if (typeof window.invalidateSurfaceCache === "function") {
				window.invalidateSurfaceCache(currentSurface.id);
			}

			// Save to database
			window.saveSurfaceToDB(currentSurface.id).catch(function (err) {
				console.error("Failed to save surface:", err);
			});

			if (typeof window.redraw3D === "function") {
				window.redraw3D();
			} else {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		},
		onCancel: function () {
			// Step 7b) Just close, no changes
		},
		onOption1: function () {
			// Step 7c) Delete surface
			window
				.deleteSurfaceFromDB(currentSurface.id)
				.then(function () {
					window.loadedSurfaces.delete(currentSurface.id);
					if (typeof window.redraw3D === "function") {
						window.redraw3D();
					} else {
						window.drawData(window.allBlastHoles, window.selectedHole);
					}
					window.debouncedUpdateTreeView();
					console.log("Surface removed from both memory and database");
				})
				.catch(function (error) {
					console.error("Error removing surface:", error);
					window.loadedSurfaces.delete(currentSurface.id);
					if (typeof window.redraw3D === "function") {
						window.redraw3D();
					} else {
						window.drawData(window.allBlastHoles, window.selectedHole);
					}
				});
		},
		onOption2: function () {
			// Step 7d) Toggle visibility
			window.setSurfaceVisibility(currentSurface.id, !currentSurface.visible);
			if (typeof window.redraw3D === "function") {
				window.redraw3D();
			} else {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		},
		onOption3: function () {
			// Step 7e) Show statistics dialog
			var stats = computeSurfaceStatistics(currentSurface);
			showSurfaceStatsDialog(stats, currentSurface);
		}
	});

	dialog.show();

	// Step 7a-1) Initialize jscolor AFTER dialog is in DOM so it can find the input
	setTimeout(function () {
		if (typeof window.jscolor !== "undefined") {
			window.jscolor.install();
		}
	}, 50);

	// Step 8) Position dialog near click location (adjusted for viewport bounds)
	if (dialog.element) {
		var dialogWidth = 370;
		var dialogHeight = 250;
		var posX = Math.min(x, window.innerWidth - dialogWidth - 20);
		var posY = Math.min(y, window.innerHeight - dialogHeight - 20);
		posX = Math.max(10, posX);
		posY = Math.max(10, posY);
		dialog.element.style.left = posX + "px";
		dialog.element.style.top = posY + "px";
	}
}

/**
 * Clear mesh check highlights from the 3D scene.
 */
function clearMeshCheckHighlights() {
	if (!meshCheckGroup) return;
	var scene = window.threeRenderer && window.threeRenderer.scene;
	if (scene) {
		scene.remove(meshCheckGroup);
	}
	// Dispose geometry and materials
	meshCheckGroup.traverse(function (child) {
		if (child.geometry) child.geometry.dispose();
		if (child.material) child.material.dispose();
	});
	meshCheckGroup = null;
	// Trigger re-render
	if (window.threeRenderer && window.threeRenderer.requestRender) {
		window.threeRenderer.requestRender();
	}
}

/**
 * Show a statistics dialog for a single surface.
 * Reuses the same table format as TreeView's showStatistics.
 * Includes a Mesh Check section with checkboxes for open edges,
 * non-manifold edges, and degenerate triangles with 3D highlighting.
 *
 * @param {Object} stats - Computed statistics from computeSurfaceStatistics
 * @param {Object} [surface] - Surface object for mesh check (optional for backwards compat)
 */
function showSurfaceStatsDialog(stats, surface) {
	function formatValue(val) {
		if (val >= 1e9) return val.toExponential(3);
		return val.toFixed(2);
	}
	function formatCount(val) {
		if (val >= 1e9) return val.toExponential(3);
		return String(val);
	}

	var content = document.createElement("div");

	var table = document.createElement("table");
	table.className = "stats-table";

	var rows = [
		["Points (pts)", formatCount(stats.points)],
		["Edges (segs)", formatCount(stats.edges)],
		["Faces (tris)", formatCount(stats.faces)],
		["Normal Dir.", stats.normalDirection],
		["Closed", stats.closed],
		["XY Area (m\u00B2)", formatValue(stats.xyArea)],
		["YZ Area (m\u00B2)", formatValue(stats.yzArea)],
		["XZ Area (m\u00B2)", formatValue(stats.xzArea)],
		["3D Area (m\u00B2)", formatValue(stats.surfaceArea)],
		["Volume (m\u00B3)", formatValue(stats.volume)]
	];

	var tbody = document.createElement("tbody");
	for (var r = 0; r < rows.length; r++) {
		var tr = document.createElement("tr");

		var tdLabel = document.createElement("td");
		tdLabel.textContent = rows[r][0];
		tdLabel.className = "stats-label";

		var tdValue = document.createElement("td");
		tdValue.textContent = rows[r][1];
		tdValue.className = "stats-value";

		tr.appendChild(tdLabel);
		tr.appendChild(tdValue);
		tbody.appendChild(tr);
	}
	table.appendChild(tbody);
	content.appendChild(table);

	// Step M1) Mesh Check section — only if surface is available
	var openCountSpan = null;
	var nonManifoldCountSpan = null;
	var degenerateCountSpan = null;
	var unweldedCountSpan = null;
	var openCheckbox = null;
	var nonManifoldCheckbox = null;
	var degenerateCheckbox = null;
	var unweldedCheckbox = null;
	var weldToleranceInput = null;

	if (surface) {
		var meshCheckSection = document.createElement("div");
		meshCheckSection.style.marginTop = "12px";
		meshCheckSection.style.borderTop = "1px solid var(--border-color, #555)";
		meshCheckSection.style.paddingTop = "8px";

		var meshCheckTitle = document.createElement("div");
		meshCheckTitle.textContent = "Mesh Check";
		meshCheckTitle.className = "labelWhite12";
		meshCheckTitle.style.marginBottom = "6px";
		meshCheckTitle.style.fontWeight = "bold";
		meshCheckSection.appendChild(meshCheckTitle);

		// Helper to create a check row with optional inline repair button
		function createCheckRow(labelText, id, repairBtnText) {
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

			// Inline repair button — same style as footer but half height
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

			var countBadge = document.createElement("span");
			countBadge.textContent = "—";
			countBadge.className = "surface-badge surface-badge-grey";
			countBadge.style.minWidth = "28px";
			countBadge.style.textAlign = "center";

			rightDiv.appendChild(countBadge);

			row.appendChild(leftDiv);
			row.appendChild(rightDiv);
			meshCheckSection.appendChild(row);

			return { checkbox: cb, countSpan: countBadge, repairBtn: repairBtn };
		}

		// Helper to build refs object — captures all UI refs at call time
		function getRefs() {
			return {
				openCb: openCheckbox, nonManifoldCb: nonManifoldCheckbox, degenerateCb: degenerateCheckbox,
				openCountSpan: openCountSpan, nonManifoldCountSpan: nonManifoldCountSpan, degenerateCountSpan: degenerateCountSpan,
				unweldedCb: unweldedCheckbox, unweldedCountSpan: unweldedCountSpan, weldTolInput: weldToleranceInput,
				statsTbody: tbody, surface: surface
			};
		}

		var openRow = createCheckRow("Open Edges", "meshChkOpen", "Close");
		openCheckbox = openRow.checkbox;
		openCountSpan = openRow.countSpan;
		openRow.repairBtn.addEventListener("click", function () {
			repairCloseOpenEdges(surface, getRefs());
		});

		var nmRow = createCheckRow("Non-Manifold Edges", "meshChkNonManifold", "Remove");
		nonManifoldCheckbox = nmRow.checkbox;
		nonManifoldCountSpan = nmRow.countSpan;
		nmRow.repairBtn.addEventListener("click", function () {
			repairRemoveProblems(surface, getRefs());
		});

		var degRow = createCheckRow("Degenerate Tris", "meshChkDegenerate", "Remove");
		degenerateCheckbox = degRow.checkbox;
		degenerateCountSpan = degRow.countSpan;
		degRow.repairBtn.addEventListener("click", function () {
			repairRemoveProblems(surface, getRefs());
		});

		// Unwelded Vertices row — custom layout with tolerance input
		var unweldRow = document.createElement("div");
		unweldRow.style.display = "flex";
		unweldRow.style.alignItems = "center";
		unweldRow.style.justifyContent = "space-between";
		unweldRow.style.marginBottom = "4px";

		var unweldLeftDiv = document.createElement("div");
		unweldLeftDiv.style.display = "flex";
		unweldLeftDiv.style.alignItems = "center";
		unweldLeftDiv.style.gap = "6px";

		unweldedCheckbox = document.createElement("input");
		unweldedCheckbox.type = "checkbox";
		unweldedCheckbox.id = "meshChkUnwelded";
		unweldedCheckbox.checked = true;

		var unweldLabel = document.createElement("label");
		unweldLabel.htmlFor = "meshChkUnwelded";
		unweldLabel.textContent = "Unwelded";
		unweldLabel.className = "labelWhite12";
		unweldLabel.style.cursor = "pointer";

		weldToleranceInput = document.createElement("input");
		weldToleranceInput.type = "number";
		weldToleranceInput.className = "narrow-no-spinner";
		weldToleranceInput.value = "0.01";
		weldToleranceInput.step = "0.001";
		weldToleranceInput.min = "0.001";
		weldToleranceInput.style.textAlign = "right";

		var unweldUnitLabel = document.createElement("span");
		unweldUnitLabel.textContent = "m";
		unweldUnitLabel.className = "labelWhite12";

		unweldLeftDiv.appendChild(unweldedCheckbox);
		unweldLeftDiv.appendChild(unweldLabel);
		unweldLeftDiv.appendChild(weldToleranceInput);
		unweldLeftDiv.appendChild(unweldUnitLabel);

		var unweldRightDiv = document.createElement("div");
		unweldRightDiv.style.display = "flex";
		unweldRightDiv.style.alignItems = "center";
		unweldRightDiv.style.gap = "4px";

		var weldBtn = document.createElement("button");
		weldBtn.textContent = "Weld";
		weldBtn.className = "floating-dialog-btn";
		weldBtn.style.padding = "3px 8px";
		weldBtn.style.minWidth = "60px";
		weldBtn.style.maxHeight = "18px";
		weldBtn.addEventListener("click", function () {
			repairWeldVertices(surface, getRefs());
		});

		unweldedCountSpan = document.createElement("span");
		unweldedCountSpan.textContent = "—";
		unweldedCountSpan.className = "surface-badge surface-badge-grey";
		unweldedCountSpan.style.minWidth = "28px";
		unweldedCountSpan.style.textAlign = "center";

		unweldRightDiv.appendChild(weldBtn);
		unweldRightDiv.appendChild(unweldedCountSpan);

		unweldRow.appendChild(unweldLeftDiv);
		unweldRow.appendChild(unweldRightDiv);
		meshCheckSection.appendChild(unweldRow);

		// Show Normals row — simple checkbox, no badge or repair button
		var normalsRow = document.createElement("div");
		normalsRow.style.display = "flex";
		normalsRow.style.alignItems = "center";
		normalsRow.style.justifyContent = "space-between";
		normalsRow.style.marginBottom = "4px";

		var normalsLeftDiv = document.createElement("div");
		normalsLeftDiv.style.display = "flex";
		normalsLeftDiv.style.alignItems = "center";
		normalsLeftDiv.style.gap = "6px";

		var normalsCheckbox = document.createElement("input");
		normalsCheckbox.type = "checkbox";
		normalsCheckbox.id = "meshChkNormals";
		normalsCheckbox.checked = lastShowNormalsChecked;
		normalsCheckbox.addEventListener("change", function () {
			lastShowNormalsChecked = normalsCheckbox.checked;
			runMeshCheck(surface, openCheckbox, nonManifoldCheckbox, degenerateCheckbox,
				openCountSpan, nonManifoldCountSpan, degenerateCountSpan,
				unweldedCheckbox, unweldedCountSpan, weldToleranceInput);
		});

		var normalsLabel = document.createElement("label");
		normalsLabel.htmlFor = "meshChkNormals";
		normalsLabel.textContent = "Show Normals";
		normalsLabel.className = "labelWhite12";
		normalsLabel.style.cursor = "pointer";

		normalsLeftDiv.appendChild(normalsCheckbox);
		normalsLeftDiv.appendChild(normalsLabel);
		normalsRow.appendChild(normalsLeftDiv);

		var normalsRightDiv = document.createElement("div");
		normalsRightDiv.style.display = "flex";
		normalsRightDiv.style.alignItems = "center";
		normalsRightDiv.style.gap = "2px";

		function createNormalBtn(label, onClick) {
			var btn = document.createElement("button");
			btn.textContent = label;
			btn.className = "floating-dialog-btn";
			btn.style.padding = "2px 6px";
			btn.style.minWidth = "36px";
			btn.style.maxHeight = "18px";
			btn.addEventListener("click", onClick);
			return btn;
		}

		normalBtnIn = createNormalBtn("In", function () {
			var result = setSurfaceNormalsDirection(surface, "in");
			console.log("Normals In:", result.message);
			if (result.flippedCount > 0) {
				surface.triangles = result.triangles;
				applyRepairAndRecheck(surface, extractTriangles(surface), getRefs());
			}
		});
		normalBtnOut = createNormalBtn("Out", function () {
			var result = setSurfaceNormalsDirection(surface, "out");
			console.log("Normals Out:", result.message);
			if (result.flippedCount > 0) {
				surface.triangles = result.triangles;
				applyRepairAndRecheck(surface, extractTriangles(surface), getRefs());
			}
		});
		normalBtnFlip = createNormalBtn("Flip", function () {
			surface.triangles = flipSurfaceNormals(surface);
			console.log("Normals flipped");
			applyRepairAndRecheck(surface, extractTriangles(surface), getRefs());
		});
		normalBtnAlign = createNormalBtn("Align", function () {
			var result = alignSurfaceNormals(surface);
			surface.triangles = result.triangles;
			console.log("Normals aligned:", result.flippedCount + "/" + result.totalCount + " flipped");
			applyRepairAndRecheck(surface, extractTriangles(surface), getRefs());
		});

		// Hide all initially — runMeshCheck will show the appropriate pair
		normalBtnIn.style.display = "none";
		normalBtnOut.style.display = "none";
		normalBtnFlip.style.display = "none";
		normalBtnAlign.style.display = "none";

		normalsRightDiv.appendChild(normalBtnIn);
		normalsRightDiv.appendChild(normalBtnOut);
		normalsRightDiv.appendChild(normalBtnFlip);
		normalsRightDiv.appendChild(normalBtnAlign);

		normalsRow.appendChild(normalsRightDiv);
		meshCheckSection.appendChild(normalsRow);

		content.appendChild(meshCheckSection);
	}

	// Build clipboard text
	var clipText = stats.name + "\n";
	for (var ci = 0; ci < rows.length; ci++) {
		clipText += rows[ci][0] + "\t" + rows[ci][1] + "\n";
	}

	var dialog = new window.FloatingDialog({
		title: "Statistics: " + stats.name,
		content: content,
		width: 320,
		height: surface ? 510 : 380,
		showConfirm: true,
		confirmText: "Copy",
		onConfirm: function () {
			navigator.clipboard.writeText(clipText).then(function () {
				console.log("Statistics copied to clipboard");
			}).catch(function (err) {
				console.error("Clipboard copy failed:", err);
			});
			return false; // Keep dialog open after copy
		},
		showOption1: !!surface,
		option1Text: "Check",
		onOption1: function () {
			runMeshCheck(surface, openCheckbox, nonManifoldCheckbox, degenerateCheckbox,
				openCountSpan, nonManifoldCountSpan, degenerateCountSpan,
				unweldedCheckbox, unweldedCountSpan, weldToleranceInput);
			return false; // Keep dialog open after check
		},
		showCancel: true,
		cancelText: "Close",
		onCancel: function () {
			clearMeshCheckHighlights();
		}
	});
	dialog.show();
}

/**
 * Run mesh checks on a surface and highlight results in 3D.
 */
function runMeshCheck(surface, openCb, nonManifoldCb, degenerateCb,
	openCountSpan, nonManifoldCountSpan, degenerateCountSpan,
	unweldedCb, unweldedCountSpan, weldTolInput) {

	// Step 1) Clear previous highlights
	clearMeshCheckHighlights();

	// Step 2) Extract triangles and run detection
	var tris = extractTriangles(surface);
	if (!tris || tris.length === 0) {
		console.warn("Mesh Check: no triangles found");
		return;
	}

	var problems = detectMeshProblems(tris);
	lastCheckProblems = problems;

	// Step 3) Update count badges

	openCountSpan.textContent = openCb.checked ? String(problems.openEdges.length) : "—";
	nonManifoldCountSpan.textContent = nonManifoldCb.checked ? String(problems.nonManifoldEdges.length) : "—";
	degenerateCountSpan.textContent = degenerateCb.checked ? String(problems.degenerateTris.length) : "—";

	// Unwelded vertex count
	if (unweldedCb && unweldedCountSpan && weldTolInput) {
		if (unweldedCb.checked) {
			var weldTol = parseFloat(weldTolInput.value) || 0.01;
			var unweldedCount = countUnweldedVertices(tris, weldTol);
			unweldedCountSpan.textContent = String(unweldedCount);
		} else {
			unweldedCountSpan.textContent = "—";
		}
	}

	// Update badge colors based on count
	function setBadgeColor(span, count, checked) {
		span.className = "surface-badge";
		if (!checked) {
			span.className += " surface-badge-grey";
		} else if (count === 0) {
			span.className += " surface-badge-green";
		} else {
			span.className += " surface-badge-red";
		}
	}
	setBadgeColor(openCountSpan, problems.openEdges.length, openCb.checked);
	setBadgeColor(nonManifoldCountSpan, problems.nonManifoldEdges.length, nonManifoldCb.checked);
	setBadgeColor(degenerateCountSpan, problems.degenerateTris.length, degenerateCb.checked);
	if (unweldedCb && unweldedCountSpan) {
		var unweldedVal = unweldedCb.checked ? parseInt(unweldedCountSpan.textContent) || 0 : 0;
		setBadgeColor(unweldedCountSpan, unweldedVal, unweldedCb.checked);
	}

	// Step 3b) Toggle normal direction buttons based on closed/open mesh
	var isClosed = problems.openEdges.length === 0;
	if (normalBtnIn) normalBtnIn.style.display = isClosed ? "" : "none";
	if (normalBtnOut) normalBtnOut.style.display = isClosed ? "" : "none";
	if (normalBtnFlip) normalBtnFlip.style.display = isClosed ? "none" : "";
	if (normalBtnAlign) normalBtnAlign.style.display = isClosed ? "none" : "";

	// Step 4) Build 3D highlights
	var scene = window.threeRenderer && window.threeRenderer.scene;
	if (!scene) return;

	meshCheckGroup = new THREE.Group();
	meshCheckGroup.name = "meshCheckHighlights";
	meshCheckGroup.renderOrder = 999;

	var toLocal = typeof window.worldToThreeLocal === "function" ? window.worldToThreeLocal : null;

	// Step 4a) Edge highlight helper — builds LineSegments from edge array
	function buildEdgeHighlight(edges) {
		if (edges.length === 0) return null;
		var positions = new Float32Array(edges.length * 6);
		for (var i = 0; i < edges.length; i++) {
			var e = edges[i];
			var p0 = toLocal ? toLocal(e.v0.x, e.v0.y) : { x: e.v0.x, y: e.v0.y };
			var p1 = toLocal ? toLocal(e.v1.x, e.v1.y) : { x: e.v1.x, y: e.v1.y };
			positions[i * 6] = p0.x;
			positions[i * 6 + 1] = p0.y;
			positions[i * 6 + 2] = e.v0.z;
			positions[i * 6 + 3] = p1.x;
			positions[i * 6 + 4] = p1.y;
			positions[i * 6 + 5] = e.v1.z;
		}
		var geom = new THREE.BufferGeometry();
		geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		var mat = new THREE.LineBasicMaterial({
			color: 0xFF00FF,
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

	// Step 4b) Triangle highlight helper — builds Mesh from degenerate tris
	function buildTriHighlight(degTris) {
		if (degTris.length === 0) return null;
		var positions = new Float32Array(degTris.length * 9);
		for (var i = 0; i < degTris.length; i++) {
			var t = degTris[i];
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
			color: 0xFF00FF,
			transparent: true,
			opacity: 0.6,
			side: THREE.DoubleSide,
			depthTest: false,
			depthWrite: false
		});
		var mesh = new THREE.Mesh(geom, mat);
		mesh.renderOrder = 999;
		mesh.frustumCulled = false;
		return mesh;
	}

	// Step 4c) Normal arrows helper — draws a line from each triangle centroid along its normal
	// Red at the face (base), blue at the tip
	function buildNormalArrows(surfTris, arrowLength) {
		if (surfTris.length === 0) return null;
		if (!arrowLength) arrowLength = 2.4;
		// Sample up to 2000 triangles for performance
		var step = Math.max(1, Math.floor(surfTris.length / 2000));
		var positions = [];
		var colors = [];
		for (var i = 0; i < surfTris.length; i += step) {
			var t = surfTris[i];
			// Centroid
			var cx = (t.v0.x + t.v1.x + t.v2.x) / 3;
			var cy = (t.v0.y + t.v1.y + t.v2.y) / 3;
			var cz = (t.v0.z + t.v1.z + t.v2.z) / 3;
			// Normal (cross product)
			var ux = t.v1.x - t.v0.x, uy = t.v1.y - t.v0.y, uz = t.v1.z - t.v0.z;
			var vx = t.v2.x - t.v0.x, vy = t.v2.y - t.v0.y, vz = t.v2.z - t.v0.z;
			var nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
			var nl = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2);
			if (nl < 1e-12) continue;
			nx2 /= nl; ny2 /= nl; nz2 /= nl;
			var lc = toLocal ? toLocal(cx, cy) : { x: cx, y: cy };
			positions.push(lc.x, lc.y, cz);
			positions.push(lc.x + nx2 * arrowLength, lc.y + ny2 * arrowLength, cz + nz2 * arrowLength);
			// Orange at base, cyan at tip
			colors.push(1, 0.647, 0);
			colors.push(0, 1, 1);
		}
		if (positions.length === 0) return null;
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
		var lines = new THREE.LineSegments(geom, mat);
		lines.renderOrder = 999;
		lines.frustumCulled = false;
		return lines;
	}

	// Step 4d) Build and add highlights for checked categories
	if (openCb.checked && problems.openEdges.length > 0) {
		var openLines = buildEdgeHighlight(problems.openEdges);
		if (openLines) meshCheckGroup.add(openLines);
	}
	if (nonManifoldCb.checked && problems.nonManifoldEdges.length > 0) {
		var nmLines = buildEdgeHighlight(problems.nonManifoldEdges);
		if (nmLines) meshCheckGroup.add(nmLines);
	}
	if (degenerateCb.checked && problems.degenerateTris.length > 0) {
		var degMesh = buildTriHighlight(problems.degenerateTris);
		if (degMesh) meshCheckGroup.add(degMesh);
	}

	// Step 4e) Show normals if checkbox is checked
	if (lastShowNormalsChecked) {
		var normalArrows = buildNormalArrows(tris);
		if (normalArrows) meshCheckGroup.add(normalArrows);
	}

	// Step 5) Add to scene and render
	if (meshCheckGroup.children.length > 0) {
		scene.add(meshCheckGroup);
	}
	if (window.threeRenderer && window.threeRenderer.requestRender) {
		window.threeRenderer.requestRender();
	}

	console.log("Mesh Check: open=" + problems.openEdges.length +
		" non-manifold=" + problems.nonManifoldEdges.length +
		" degenerate=" + problems.degenerateTris.length);
}

/**
 * Convert triangle soup [{v0,v1,v2},...] back to surface.triangles format [{vertices:[...]},...].
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

/**
 * Apply surface changes after repair — update surface, save, invalidate caches, redraw, re-check.
 */
function applyRepairAndRecheck(surface, newTris, refs) {
	surface.triangles = soupToSurfaceTriangles(newTris);

	// Invalidate caches
	if (typeof window.invalidateSurfaceCache === "function") {
		window.invalidateSurfaceCache(surface.id);
	}

	// Save to database
	window.saveSurfaceToDB(surface.id).catch(function (err) {
		console.error("Mesh repair: failed to save surface:", err);
	});

	// Redraw 3D
	if (typeof window.redraw3D === "function") {
		window.redraw3D();
	} else {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}

	// Update tree view to reflect repaired surface
	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}

	// Refresh stats table if tbody ref is available
	if (refs.statsTbody && refs.surface) {
		var newStats = computeSurfaceStatistics(refs.surface);
		function fmtVal(v) { return v >= 1e9 ? v.toExponential(3) : v.toFixed(2); }
		function fmtCnt(v) { return v >= 1e9 ? v.toExponential(3) : String(v); }
		var newValues = [
			fmtCnt(newStats.points),
			fmtCnt(newStats.edges),
			fmtCnt(newStats.faces),
			newStats.normalDirection,
			newStats.closed,
			fmtVal(newStats.xyArea),
			fmtVal(newStats.yzArea),
			fmtVal(newStats.xzArea),
			fmtVal(newStats.surfaceArea),
			fmtVal(newStats.volume)
		];
		var tableRows = refs.statsTbody.querySelectorAll("tr");
		for (var ri = 0; ri < tableRows.length && ri < newValues.length; ri++) {
			var valCell = tableRows[ri].querySelector(".stats-value");
			if (valCell) valCell.textContent = newValues[ri];
		}
	}

	// Re-run check to update badges and highlights
	runMeshCheck(surface, refs.openCb, refs.nonManifoldCb, refs.degenerateCb,
		refs.openCountSpan, refs.nonManifoldCountSpan, refs.degenerateCountSpan,
		refs.unweldedCb, refs.unweldedCountSpan, refs.weldTolInput);
}

/**
 * Repair: close open edges by iteratively capping boundary loops.
 * Uses capBoundaryLoopsSequential which caps, welds, and cleans in multiple passes.
 */
function repairCloseOpenEdges(surface, refs) {
	if (!lastCheckProblems) {
		console.warn("Mesh Repair: run Check first");
		return;
	}
	if (lastCheckProblems.openEdges.length === 0) {
		console.log("Mesh Repair: no open edges to close");
		return;
	}

	var tris = extractTriangles(surface);
	var before = tris.length;

	// Use extractBoundaryLoops — same detection as mesh check
	var loopResult = extractBoundaryLoops(tris);
	if (loopResult.loops.length === 0) {
		console.log("Mesh Repair: extractBoundaryLoops found 0 loops (but " +
			lastCheckProblems.openEdges.length + " open edges reported)");
		return;
	}

	console.log("Mesh Repair: " + loopResult.loops.length + " boundary loop(s), sizes: " +
		loopResult.loops.map(function (l) { return l.length; }).join(", "));

	// Triangulate each loop and add cap tris directly to soup
	var totalCapTris = 0;
	for (var li = 0; li < loopResult.loops.length; li++) {
		var loop = loopResult.loops[li];
		if (loop.length < 3) continue;
		var capTris = triangulateLoop(loop);
		for (var ct = 0; ct < capTris.length; ct++) {
			tris.push(capTris[ct]);
		}
		totalCapTris += capTris.length;
		console.log("Mesh Repair: loop[" + li + "] " + loop.length + " verts → " + capTris.length + " cap tris");
	}

	console.log("Mesh Repair: close open edges (" + before + " → " + tris.length +
		" tris, added " + totalCapTris + " cap tris)");

	applyRepairAndRecheck(surface, tris, refs);
}

/**
 * Repair: remove degenerate triangles and non-manifold (over-shared) edge triangles.
 */
function repairRemoveProblems(surface, refs) {
	if (!lastCheckProblems) {
		console.warn("Mesh Repair: run Check first");
		return;
	}
	if (lastCheckProblems.nonManifoldEdges.length === 0 && lastCheckProblems.degenerateTris.length === 0) {
		console.log("Mesh Repair: no non-manifold edges or degenerate tris to remove");
		return;
	}

	var tris = extractTriangles(surface);
	var before = tris.length;

	// Step 1) Remove non-manifold (over-shared) edge triangles
	if (lastCheckProblems.nonManifoldEdges.length > 0) {
		tris = cleanCrossingTriangles(tris);
	}

	// Step 2) Remove degenerate triangles
	if (lastCheckProblems.degenerateTris.length > 0) {
		tris = removeDegenerateTriangles(tris);
	}

	console.log("Mesh Repair: removed " + (before - tris.length) + " problem triangles (" +
		before + " → " + tris.length + ")");

	applyRepairAndRecheck(surface, tris, refs);
}

/**
 * Repair: weld vertices within tolerance, then convert back to soup.
 * Triangles that collapse (2+ vertices merge to same point) are automatically
 * removed by weldVertices. Any remaining near-zero-area slivers are cleaned up.
 */
function repairWeldVertices(surface, refs) {
	var tris = extractTriangles(surface);
	var before = tris.length;
	var weldTol = refs.weldTolInput ? (parseFloat(refs.weldTolInput.value) || 0.01) : 0.01;

	var welded = weldVertices(tris, weldTol);
	var newTris = weldedToSoup(welded.triangles);

	// Remove any degenerate slivers created by welding
	newTris = removeDegenerateTriangles(newTris);

	console.log("Mesh Repair: welded at " + weldTol + "m (" +
		before + " → " + newTris.length + " tris, " + welded.points.length + " unique pts)");

	applyRepairAndRecheck(surface, newTris, refs);
}

//===========================================
// SURFACES CONTEXT MENU END
//===========================================

// Make functions available globally
window.showSurfaceContextMenu = showSurfaceContextMenu;
