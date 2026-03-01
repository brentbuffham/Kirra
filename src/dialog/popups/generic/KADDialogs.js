// src/dialog/popups/generic/KADDialogs.js
//=============================================================
// KAD DIALOG FUNCTIONS
//=============================================================
// Step 1) This file contains all KAD-related dialog functions previously in kirra.js
// Step 2) All functions use FloatingDialog for consistency and proper theming
// Step 0) Converted to ES Module for Vite bundling - 2025-12-26

import { getOrCreateSurfaceLayer } from "../../../helpers/LayerHelper.js";

// Step 2.5) PERFORMANCE FIX 2025-12-28: Helper function to estimate triangulation point count
function estimateTriangulationPointCount(formData) {
	var pointCount = 0;

	// Step 2.5a) Count blast hole points based on selected options
	var visibleHoles = window.allBlastHoles || [];
	if (window.getVisibleHolesAndKADDrawings) {
		var visibleElements = window.getVisibleHolesAndKADDrawings(window.allBlastHoles || [],
			window.allKADDrawingsMap ? Array.from(window.allKADDrawingsMap.values()) : []);
		visibleHoles = visibleElements.visibleHoles || [];
	}

	var holeMultiplier = 0;
	if (formData.blastHolePoints === "collar") holeMultiplier = 1;
	else if (formData.blastHolePoints === "grade") holeMultiplier = 1;
	else if (formData.blastHolePoints === "toe") holeMultiplier = 1;
	else if (formData.blastHolePoints === "measuredLength") holeMultiplier = 1;

	pointCount += visibleHoles.length * holeMultiplier;

	// Step 2.5b) Count KAD drawing points
	var kadDrawings = [];
	if (window.allKADDrawingsMap) {
		kadDrawings = Array.from(window.allKADDrawingsMap.values());
	}
	if (window.getVisibleHolesAndKADDrawings) {
		var visibleElements = window.getVisibleHolesAndKADDrawings([], kadDrawings);
		kadDrawings = visibleElements.visibleKADDrawings || kadDrawings;
	}

	kadDrawings.forEach(function (entity) {
		if (entity && entity.data) {
			pointCount += entity.data.length;
		}
	});

	console.log("📊 Estimated triangulation points: " + pointCount + " (holes: " + visibleHoles.length + ", KAD entities: " + kadDrawings.length + ")");
	return pointCount;
}

// Expose for use in kirra.js if needed
window.estimateTriangulationPointCount = estimateTriangulationPointCount;

//! SHOW TRIANGULATION POPUP
// Step 3) Dialog for creating Delaunay 2.5D triangulations
export async function showTriangulationPopup() {
	const selectedPolygon = window.selectedKADObject && window.selectedKADObject.entityType == "poly" ? window.selectedKADObject : null;

	// Step 3.0) PERFORMANCE FIX 2025-12-28: Pre-estimate point count BEFORE showing main dialog
	// This uses max possible points (all holes + all KAD) to warn user early
	var preEstimatedPoints = 0;
	var visibleHoles = window.allBlastHoles || [];
	if (window.getVisibleHolesAndKADDrawings) {
		var visibleElements = window.getVisibleHolesAndKADDrawings(window.allBlastHoles || [],
			window.allKADDrawingsMap ? Array.from(window.allKADDrawingsMap.values()) : []);
		visibleHoles = visibleElements.visibleHoles || [];
	}
	preEstimatedPoints += visibleHoles.length; // Max 1 point per hole

	var kadDrawings = [];
	if (window.allKADDrawingsMap) {
		kadDrawings = Array.from(window.allKADDrawingsMap.values());
	}
	if (window.getVisibleHolesAndKADDrawings) {
		var visibleElements = window.getVisibleHolesAndKADDrawings([], kadDrawings);
		kadDrawings = visibleElements.visibleKADDrawings || kadDrawings;
	}
	kadDrawings.forEach(function (entity) {
		if (entity && entity.data) {
			preEstimatedPoints += entity.data.length;
		}
	});

	console.log("📊 Pre-estimated max triangulation points: " + preEstimatedPoints);

	// Step 3.0a) Show warning FIRST if dataset is very large (before main dialog)
	var SAFE_POINT_LIMIT = 10000;
	var LARGE_DATASET_WARNING = 5000;

	if (preEstimatedPoints > SAFE_POINT_LIMIT) {
		// Very large dataset - require confirmation BEFORE showing main dialog
		var proceed = await window.showConfirmationDialog(
			"Very Large Dataset Warning",
			"This dataset has approximately " + preEstimatedPoints + " points. " +
			"Triangulation processing may take several minutes and could freeze the browser. " +
			"Consider reducing the visible data (hide layers) or using simplified settings. Continue to settings?",
			"Continue to Settings",
			"Cancel"
		);
		if (!proceed) {
			window.updateStatusMessage("Triangulation cancelled - dataset too large");
			return;
		}
	}

	const fields = [
		{
			label: "Surface Name",
			name: "surfaceName",
			value: "Surface_" + Date.now(),
			placeholder: "Surface Name",
		},
		{
			label: "Blast Hole Points",
			name: "blastHolePoints",
			type: "select",
			value: "none",
			options: [
				{
					text: "None - Exclude blast holes",
					value: "none",
				},
				{
					text: "Collar points (surface)",
					value: "collar",
				},
				{
					text: "Grade points (mid-hole)",
					value: "grade",
				},
				{
					text: "Toe points (bottom)",
					value: "toe",
				},
				{
					text: "Measured length points (along hole)",
					value: "measuredLength",
				},
			],
		},
		{
			label: "KAD Breaklines",
			name: "useBreaklines",
			type: "select",
			value: "yes",
			options: [
				{
					text: "Include as constraints",
					value: "yes",
				},
				{
					text: "Points only (no constraints)",
					value: "no",
				},
			],
		},
		// Boundary Clipping is now a custom pick-row section below the form
		{
			label: "Search Distance (XYZ duplicates)",
			name: "xyzTolerance",
			type: "number",
			value: 0.001,
			min: 0.001,
			max: 10,
			step: 0.01,
		},
		{
			label: "Minimum Internal Angle",
			name: "minInternalAngle",
			type: "number",
			value: 0, //0 = ignore culling
			min: 0,
			max: 60,
			step: 0.1,
		},
		{
			label: "Consider Angle in 3D?",
			name: "consider3DAngle",
			type: "checkbox",
			value: false,
		},
		{
			label: "Max Edge Length",
			name: "maxEdgeLength",
			type: "number",
			value: 0, //0 = ignore culling
			min: 0,
			max: 10000,
			step: 0.1,
		},
		{
			label: "Consider 3D edge length?",
			name: "consider3DLength",
			type: "checkbox",
			value: false,
		},
		{
			label: "Surface Style",
			name: "surfaceStyle",
			type: "select",
			value: "hillshade",
			options: [
				{
					text: "default",
					value: "default",
				},
				//{ text: "wireframe", value: "wireframe" },//! Never use wireframe it doesn't exist!//
				{
					text: "Hillshade",
					value: "hillshade",
				},
				{
					text: "Viridis",
					value: "viridis",
				},
				{
					text: "Turbo",
					value: "turbo",
				},
				{
					text: "Parula",
					value: "parpula",
				},
				{
					text: "Cividis",
					value: "cividis",
				},
				{
					text: "Terrain",
					value: "terrain",
				},
			],
		},
	];

	const formContent = window.createEnhancedFormContent(fields, false, true);

	// Step 4) Boundary Clipping section — pick-row with polygon dropdown + screen pick
	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
	var allPolys = [];
	if (window.allKADDrawingsMap && window.allKADDrawingsMap.size > 0) {
		window.allKADDrawingsMap.forEach(function (entity, entityName) {
			if (entity.entityType === "poly" && entity.data && entity.data.length >= 3) {
				var firstPt = entity.data[0];
				if (firstPt && (firstPt.closed === true || firstPt.closed === undefined)) {
					allPolys.push({ name: entityName, pointCount: entity.data.length });
				}
			}
		});
	}

	var boundarySection = document.createElement("div");
	boundarySection.style.gridColumn = "1 / -1";
	boundarySection.style.padding = "8px";
	boundarySection.style.borderRadius = "4px";
	boundarySection.style.display = "flex";
	boundarySection.style.flexDirection = "column";
	boundarySection.style.gap = "6px";

	var boundaryTitle = document.createElement("span");
	boundaryTitle.textContent = "Boundary Clipping";
	boundaryTitle.style.fontSize = "12px";
	boundaryTitle.style.fontWeight = "bold";
	boundarySection.appendChild(boundaryTitle);

	// Clip mode row
	var clipModeRow = document.createElement("div");
	clipModeRow.style.display = "flex";
	clipModeRow.style.alignItems = "center";
	clipModeRow.style.gap = "8px";

	var clipModeLabel = document.createElement("label");
	clipModeLabel.textContent = "Mode";
	clipModeLabel.style.fontSize = "11px";
	clipModeLabel.style.minWidth = "40px";

	var clipModeSelect = document.createElement("select");
	clipModeSelect.style.flex = "1";
	clipModeSelect.style.fontSize = "11px";
	clipModeSelect.style.padding = "3px 4px";
	clipModeSelect.style.borderRadius = "3px";
	var clipOptions = [
		{ value: "none", text: "No boundary clipping" },
		{ value: "outside", text: "Delete triangles outside polygon" },
		{ value: "inside", text: "Delete triangles inside polygon" }
	];
	for (var co = 0; co < clipOptions.length; co++) {
		var opt = document.createElement("option");
		opt.value = clipOptions[co].value;
		opt.textContent = clipOptions[co].text;
		clipModeSelect.appendChild(opt);
	}
	if (selectedPolygon) clipModeSelect.value = "outside";

	clipModeRow.appendChild(clipModeLabel);
	clipModeRow.appendChild(clipModeSelect);
	boundarySection.appendChild(clipModeRow);

	// Polygon pick row (shown when mode != "none")
	var polyPickRow = document.createElement("div");
	polyPickRow.style.display = clipModeSelect.value !== "none" ? "flex" : "none";
	polyPickRow.style.alignItems = "center";
	polyPickRow.style.gap = "8px";

	var polyLabel = document.createElement("label");
	polyLabel.textContent = "Polygon";
	polyLabel.style.fontSize = "11px";
	polyLabel.style.minWidth = "40px";

	var polySelect = document.createElement("select");
	polySelect.style.flex = "1";
	polySelect.style.fontSize = "11px";
	polySelect.style.padding = "3px 4px";
	polySelect.style.borderRadius = "3px";

	// "None" option
	var noneOpt = document.createElement("option");
	noneOpt.value = "";
	noneOpt.textContent = allPolys.length > 0 ? "-- Select polygon --" : "-- No closed polygons available --";
	polySelect.appendChild(noneOpt);

	for (var p = 0; p < allPolys.length; p++) {
		var pOpt = document.createElement("option");
		pOpt.value = allPolys[p].name;
		pOpt.textContent = allPolys[p].name + " (" + allPolys[p].pointCount + " pts)";
		polySelect.appendChild(pOpt);
	}

	// Pre-select if polygon was already selected before opening dialog
	if (selectedPolygon && selectedPolygon.entityName) {
		polySelect.value = selectedPolygon.entityName;
	}

	// Pick button
	var pickBtn = document.createElement("button");
	pickBtn.type = "button";
	pickBtn.title = "Pick a polygon from 3D view";
	pickBtn.style.width = "28px";
	pickBtn.style.height = "28px";
	pickBtn.style.padding = "2px";
	pickBtn.style.borderRadius = "4px";
	pickBtn.style.cursor = "pointer";
	pickBtn.style.flexShrink = "0";
	pickBtn.style.display = "flex";
	pickBtn.style.alignItems = "center";
	pickBtn.style.justifyContent = "center";

	var pickImg = document.createElement("img");
	pickImg.src = "icons/target-arrow.png";
	pickImg.style.width = "20px";
	pickImg.style.height = "20px";
	pickBtn.appendChild(pickImg);

	// Theme update function — applies dark/light styles to all boundary elements
	function applyBoundaryTheme() {
		var d = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
		boundarySection.style.background = d ? "rgba(0,0,0,0.15)" : "rgba(240,240,240,0.5)";
		boundarySection.style.border = d ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.1)";
		boundaryTitle.style.color = d ? "#ccc" : "#333";
		clipModeLabel.style.color = d ? "#ccc" : "#333";
		clipModeSelect.style.background = d ? "#333" : "#fff";
		clipModeSelect.style.color = d ? "#ccc" : "#333";
		clipModeSelect.style.border = d ? "1px solid #555" : "1px solid #999";
		polyLabel.style.color = d ? "#ccc" : "#333";
		polySelect.style.background = d ? "#333" : "#fff";
		polySelect.style.color = d ? "#ccc" : "#333";
		polySelect.style.border = d ? "1px solid #555" : "1px solid #999";
		pickImg.style.filter = d ? "invert(0.8)" : "invert(0.2)";
		if (!pickModeActive) {
			pickBtn.style.background = d ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
			pickBtn.style.border = d ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
		}
	}
	applyBoundaryTheme();

	// Listen for dark mode toggle changes while dialog is open
	var darkModeToggleEl = document.getElementById("dark-mode-toggle");
	var onDarkModeChange = function () { applyBoundaryTheme(); };
	if (darkModeToggleEl) {
		darkModeToggleEl.addEventListener("change", onDarkModeChange);
	}

	var pickModeActive = false;
	var pickPollInterval = null;

	function exitBoundaryPickMode() {
		if (!pickModeActive) return;
		pickModeActive = false;
		if (pickPollInterval) {
			clearInterval(pickPollInterval);
			pickPollInterval = null;
		}
		var d = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
		pickBtn.style.background = d ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		pickBtn.style.borderColor = d ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
	}

	pickBtn.addEventListener("click", function () {
		if (pickModeActive) {
			exitBoundaryPickMode();
			return;
		}

		// Activate select pointer tool
		var selectPointerBtn = document.getElementById("selectPointer");
		if (selectPointerBtn && !selectPointerBtn.checked) {
			selectPointerBtn.checked = true;
			selectPointerBtn.dispatchEvent(new Event("change"));
		}

		// Activate KAD selection mode via the selectKAD radio button
		var selectKADRadio = document.getElementById("selectKAD");
		if (selectKADRadio && !selectKADRadio.checked) {
			selectKADRadio.checked = true;
			selectKADRadio.dispatchEvent(new Event("change"));
		}

		pickModeActive = true;
		pickBtn.style.background = "rgba(255,60,60,0.4)";
		pickBtn.style.borderColor = "#FF4444";

		// Poll for selectedKADObject changes — the normal KAD click handler sets it
		var prevSelectedName = window.selectedKADObject ? window.selectedKADObject.entityName : null;
		pickPollInterval = setInterval(function () {
			var current = window.selectedKADObject;
			if (current && current.entityType === "poly" && current.entityName && current.entityName !== prevSelectedName) {
				// A new polygon was selected — populate dropdown
				polySelect.value = current.entityName;
				if (polySelect.value !== current.entityName) {
					// Not in dropdown yet — add it
					var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(current.entityName) : null;
					var ptCount = entity && entity.data ? entity.data.length : 0;
					var newOpt = document.createElement("option");
					newOpt.value = current.entityName;
					newOpt.textContent = current.entityName + " (" + ptCount + " pts)";
					polySelect.appendChild(newOpt);
					polySelect.value = current.entityName;
				}
				checkPolygonClosed(current.entityName);
				exitBoundaryPickMode();
			}
		}, 200);
	});

	polyPickRow.appendChild(polyLabel);
	polyPickRow.appendChild(pickBtn);
	polyPickRow.appendChild(polySelect);
	boundarySection.appendChild(polyPickRow);

	// Warning div for non-closed polygons
	var polyWarning = document.createElement("div");
	polyWarning.style.display = "none";
	polyWarning.style.padding = "4px 8px";
	polyWarning.style.fontSize = "11px";
	polyWarning.style.color = "#ff6600";
	polyWarning.style.background = "rgba(255,102,0,0.1)";
	polyWarning.style.border = "1px solid rgba(255,102,0,0.3)";
	polyWarning.style.borderRadius = "3px";
	polyWarning.textContent = "Warning: Selected polygon is not closed. Clipping may produce unexpected results.";
	boundarySection.appendChild(polyWarning);

	function checkPolygonClosed(entityName) {
		if (!entityName) { polyWarning.style.display = "none"; return; }
		var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
		if (!entity || !entity.data || entity.data.length < 3) {
			polyWarning.style.display = "block";
			polyWarning.textContent = "Warning: Selected polygon has fewer than 3 points.";
			return;
		}
		var firstPt = entity.data[0];
		var isClosed = firstPt && (firstPt.closed === true || firstPt.closed === undefined);
		if (!isClosed) {
			polyWarning.style.display = "block";
			polyWarning.textContent = "Warning: Selected polygon is not closed. Clipping may produce unexpected results.";
		} else {
			polyWarning.style.display = "none";
		}
	}

	polySelect.addEventListener("change", function () {
		checkPolygonClosed(polySelect.value);
	});
	// Check initial selection
	if (polySelect.value) checkPolygonClosed(polySelect.value);

	clipModeSelect.addEventListener("change", function () {
		polyPickRow.style.display = clipModeSelect.value !== "none" ? "flex" : "none";
		polyWarning.style.display = clipModeSelect.value === "none" ? "none" : polyWarning.style.display;
		if (clipModeSelect.value !== "none" && polySelect.value) checkPolygonClosed(polySelect.value);
	});

	formContent.appendChild(boundarySection);

	// Step 4.1) Add dataset size info box (always show for awareness)
	var datasetSizeStyle = preEstimatedPoints > SAFE_POINT_LIMIT ? "rgba(255, 150, 50, 0.3)" :
		preEstimatedPoints > LARGE_DATASET_WARNING ? "rgba(255, 255, 50, 0.2)" : "rgba(100, 100, 100, 0.2)";
	var datasetSizeBorder = preEstimatedPoints > SAFE_POINT_LIMIT ? "#ff9800" :
		preEstimatedPoints > LARGE_DATASET_WARNING ? "#ffeb3b" : "#666";
	var datasetSizeIcon = preEstimatedPoints > SAFE_POINT_LIMIT ? "⚠️" :
		preEstimatedPoints > LARGE_DATASET_WARNING ? "📊" : "📊";
	var datasetSizeText = preEstimatedPoints > SAFE_POINT_LIMIT ? " (very large - processing may be slow)" :
		preEstimatedPoints > LARGE_DATASET_WARNING ? " (large dataset)" : "";

	const datasetInfo = document.createElement("div");
	datasetInfo.style.gridColumn = "1 / -1";
	datasetInfo.style.padding = "8px";
	datasetInfo.style.backgroundColor = datasetSizeStyle;
	datasetInfo.style.border = "1px solid " + datasetSizeBorder;
	datasetInfo.style.borderRadius = "4px";
	datasetInfo.style.fontSize = "11px";
	datasetInfo.innerHTML = datasetSizeIcon + " Estimated points: ~" + preEstimatedPoints.toLocaleString() + datasetSizeText;
	formContent.insertBefore(datasetInfo, formContent.firstChild);

	// Step 5) Add HONEST notes section
	const notesDiv = document.createElement("div");
	notesDiv.style.gridColumn = "1 / -1";
	notesDiv.style.marginTop = "10px";
	notesDiv.style.fontSize = "10px";
	notesDiv.style.color = "#888";
	notesDiv.innerHTML = `
			<strong>Triangulation:</strong><br>
			✅ Handles XY duplicate points with different Z elevations<br>
			✅ Uses Constrainautor to constrain triangles to breaklines<br>
			✅ Cull triangles by internal angle, edge length, and boundary clipping<br>
			<strong>Approach:</strong><br>
			• Uses proven Delaunator + Constrainautor<br>
		`;

	formContent.appendChild(notesDiv);

	const dialog = new window.FloatingDialog({
		title: "Delaunay 2.5D Triangulation",
		content: formContent,
		layoutType: "wide",
		width: 520,
		height: 620,
		showConfirm: true,
		showCancel: true,
		confirmText: "Create",
		cancelText: "Cancel",
		onCancel: function () {
			exitBoundaryPickMode();
			if (darkModeToggleEl) darkModeToggleEl.removeEventListener("change", onDarkModeChange);
		},
		onConfirm: async () => {
			exitBoundaryPickMode();
			if (darkModeToggleEl) darkModeToggleEl.removeEventListener("change", onDarkModeChange);
			const formData = window.getFormData(formContent);

			// Step 6) Validate surface name
			if (!formData.surfaceName || formData.surfaceName.trim() === "") {
				window.showErrorDialog("Invalid Surface Name", "Please enter a valid surface name");
				return;
			}

			// Step 7) Check for duplicate surface names
			const existingSurface = Array.from(window.loadedSurfaces.values()).find((surface) => surface.name === formData.surfaceName.trim());
			if (existingSurface) {
				window.showErrorDialog("Duplicate Surface Name", "A surface with this name already exists. Please choose a different name.");
				return;
			}

			// Step 8) PERFORMANCE FIX 2025-12-28: Estimate actual point count based on form selections
			var estimatedPoints = estimateTriangulationPointCount(formData);
			var LARGE_DATASET_WARNING = 5000;

			// Note: Major warning was shown upfront before dialog opened
			// Here we just log and update status for user awareness
			if (estimatedPoints > LARGE_DATASET_WARNING) {
				console.log("⚠️ Large triangulation dataset: " + estimatedPoints + " points");
			}

			// Step 8b) Show loading message
			window.updateStatusMessage("Creating delaunay triangulation (" + estimatedPoints + " points)...");

			try {
				// Step 9) Process form data into triangulation parameters
				const params = processTriangulationFormData(formData);
				// ✅ FIX: Use surface name as the ID to maintain consistency
				const surfaceId = formData.surfaceName.trim();

				// Step 10) ALWAYS create progress dialog for ALL triangulation types
				// PERFORMANCE FIX 2025-12-28: Show progress for all operations
				window._triangulationCancelled = false;
				var isConstrained = formData.useBreaklines === "yes";
				var triangulationType = isConstrained ? "Constrained Delaunay" : "Delaunay";

				var progressContentHTML = '<p style="margin: 0 0 10px 0;">Creating ' + triangulationType + ' Triangulation</p>' +
					'<p style="margin: 0 0 15px 0;">Processing ' + estimatedPoints.toLocaleString() + ' points...</p>' +
					'<div style="width: 100%; background-color: #333; border-radius: 5px; margin: 15px 0;">' +
					'<div id="triangulationProgressBar" style="width: 0%; height: 20px; background-color: #4CAF50; border-radius: 5px; transition: width 0.3s;"></div>' +
					'</div>' +
					'<p id="triangulationProgressText" style="margin: 10px 0;">Initializing...</p>' +
					'<div style="text-align: center; margin-top: 15px;">' +
					'<button id="triangulationCancelBtn" class="floating-dialog-btn cancel">Cancel</button>' +
					'</div>';

				var progressContentDiv = document.createElement("div");
				progressContentDiv.innerHTML = progressContentHTML;

				const progressDialog = new window.FloatingDialog({
					title: "Triangulation Progress",
					content: progressContentDiv,
					layoutType: "standard",
					width: 400,
					height: 280,
					showConfirm: false,
					showCancel: false,
					allowOutsideClick: false,
				});

				progressDialog.show();

				// Step 10a) Setup cancel button handler
				var cancelBtn = document.getElementById("triangulationCancelBtn");
				if (cancelBtn) {
					cancelBtn.addEventListener("click", function () {
						window._triangulationCancelled = true;
						var progressText = document.getElementById("triangulationProgressText");
						if (progressText) progressText.textContent = "Cancelling...";
						cancelBtn.disabled = true;
						cancelBtn.textContent = "Cancelling...";
					});
				}

				// Step 11) Get progress bar and text elements
				const progressBar = document.getElementById("triangulationProgressBar");
				const progressText = document.getElementById("triangulationProgressText");

				// Step 12) Update progress function with event loop yield
				const updateProgress = async (percent, message) => {
					if (progressBar) progressBar.style.width = percent + "%";
					if (progressText) progressText.textContent = message;
					// Yield to event loop so UI updates
					await new Promise(function(resolve) { setTimeout(resolve, 0); });
				};

				// ✅ FIX: Declare result as let instead of const for reassignment
				let result;

				try {
					// ✅ FIX: Choose triangulation method based on formData
					if (isConstrained) {
						console.log("🔗 Using constrained triangulation");
						result = await window.createConstrainedDelaunayTriangulation(params, updateProgress);

						// ✅ FIX: Fallback to basic triangulation if CDT fails
						if (!result || !result.resultTriangles || result.resultTriangles.length === 0) {
							console.warn("⚠️ CDT failed, falling back to basic triangulation");
							await updateProgress(50, "CDT failed, using basic triangulation...");
							result = await window.createDelaunayTriangulation(params, updateProgress);
						}
					} else {
						console.log("🔺 Using basic Delaunay triangulation");
						result = await window.createDelaunayTriangulation(params, updateProgress);
					}

					if (result && result.resultTriangles && result.resultTriangles.length > 0) {
						await updateProgress(70, "Processing " + result.resultTriangles.length + " triangles...");

						const surface = {
							id: surfaceId,
							name: surfaceId,
							type: "delaunay",
							points: result.points || [],
							triangles: result.resultTriangles,
							created: new Date().toISOString(),
							visible: true,
							gradient: formData.surfaceStyle || "hillshade",
							transparency: 1.0,
							metadata: {
								algorithm: isConstrained ? "constrained_delaunay" : "delaunay",
								pointCount: result.points ? result.points.length : 0,
								triangleCount: result.resultTriangles.length,
								constraintCount: result.constraintCount || 0,
								blastHolePointType: params.blastHolePoints || "none",
								cullingApplied: result.cullingStats || {},
							},
						};

						// Step 14) Add to loaded surfaces
						window.loadedSurfaces.set(surfaceId, surface);
						console.log("✅ Surface created:", surface.name, "with", result.resultTriangles.length, "triangles");

						// Step 14a) Assign to "Triangulated" layer
						var triLayerId = getOrCreateSurfaceLayer("Triangulated");
						if (triLayerId) {
							surface.layerId = triLayerId;
							var triLayer = window.allSurfaceLayers.get(triLayerId);
							if (triLayer && triLayer.entities) triLayer.entities.add(surfaceId);
						}

						// Apply boundary clipping if requested
						var clipMode = clipModeSelect.value;
						var chosenPolyName = polySelect.value;
						if (clipMode && clipMode !== "none" && chosenPolyName) {
							// Temporarily set selectedKADObject so deleteTrianglesByClippingPolygon can find it
							var prevSelected = window.selectedKADObject;
							var chosenEntity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(chosenPolyName) : null;
							if (chosenEntity) {
								window.selectedKADObject = { entityType: "poly", entityName: chosenPolyName };
								await updateProgress(75, "Applying boundary clipping...");
								console.log("Applying boundary clipping:", clipMode, "polygon:", chosenPolyName);

								const clippingSuccess = window.deleteTrianglesByClippingPolygon(surfaceId, clipMode);

								if (clippingSuccess) {
									const clippedSurface = window.loadedSurfaces.get(surfaceId);
									const clippedCount = result.resultTriangles.length - clippedSurface.triangles.length;
									console.log("Clipping applied:", clippedCount, "triangles removed,", clippedSurface.triangles.length, "remaining");
								} else {
									console.warn("Boundary clipping failed");
								}
								window.selectedKADObject = prevSelected;
							}
						}

						// ✅ Apply internal angle filtering
						if (params.minAngle > 0) {
							await updateProgress(80, "Filtering by internal angle...");
							console.log("📐 Applying internal angle filtering:", params.minAngle + "°", "3D:", params.consider3DAngle);

							const angleFilterSuccess = window.deleteTrianglesByInternalAngle(surfaceId, params.minAngle, params.consider3DAngle);
							if (angleFilterSuccess) {
								const filteredSurface = window.loadedSurfaces.get(surfaceId);
								console.log("📐 Angle filtering applied:", filteredSurface.triangles.length, "triangles remaining");
							}
						}

						// ✅ Apply edge length filtering
						if (params.maxEdgeLength > 0) {
							await updateProgress(85, "Filtering by edge length...");
							console.log("📏 Applying edge length filtering: max =", params.maxEdgeLength, "3D:", params.consider3DLength);

							const edgeFilterSuccess = window.deleteTrianglesByEdgeLength(surfaceId, 0, params.maxEdgeLength, params.consider3DLength);
							if (edgeFilterSuccess) {
								const filteredSurface = window.loadedSurfaces.get(surfaceId);
								console.log("📏 Edge filtering applied:", filteredSurface.triangles.length, "triangles remaining");
							}
						}

						// Step 15) Final status message with all filtering applied
						const finalSurface = window.loadedSurfaces.get(surfaceId);
						const totalRemoved = result.resultTriangles.length - finalSurface.triangles.length;

						// Step 16) Save to database
						await updateProgress(90, "Saving to database...");
						try {
							await window.saveSurfaceToDB(surfaceId);
							console.log("💾 Surface saved to database successfully");
						} catch (saveError) {
							console.error("❌ Failed to save surface to database:", saveError);
						}

						// Step 17) Update UI - yield between heavy operations
						await updateProgress(95, "Updating display...");
						window.updateCentroids();

						// Yield before heavy drawData call
						await new Promise(function(resolve) { setTimeout(resolve, 10); });
						if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }

						// Yield before tree update
						await new Promise(function(resolve) { setTimeout(resolve, 10); });
						window.debouncedUpdateTreeView();

						await updateProgress(100, "Complete! " + finalSurface.triangles.length + " triangles");
						window.updateStatusMessage("Surface '" + surface.name + "' created with " + finalSurface.triangles.length + " triangles (" + totalRemoved + " filtered)");
					} else {
						await updateProgress(100, "No triangles generated");
						window.updateStatusMessage("No triangles generated. Check your data and settings.");
					}

					// Step 13) Close progress dialog with small delay to show completion
					setTimeout(function() {
						progressDialog.close();
					}, 800);

				} catch (error) {
					// Close dialog on error
					progressDialog.close();
					throw error;
				}
			} catch (error) {
				console.error("Error creating triangulation:", error);
				window.updateStatusMessage("Error creating triangulation: " + error.message);
			}

			// Step 18) Clear selections
			window.selectedKADPolygon = null;
			window.selectedKADObject = null;
			window.selectedPoint = null;
		},
		onCancel: () => {
			window.updateStatusMessage("");
			window.selectedKADPolygon = null;
			window.selectedKADObject = null;
			window.selectedPoint = null;
		},
	});

	dialog.show();

	// Step 19) Auto-focus the surface name field
	setTimeout(() => {
		const nameInput = formContent.querySelector("input[name='surfaceName']");
		if (nameInput) {
			nameInput.focus();
			nameInput.select();
		}
	}, 100);
}

// Step 20) Process form data into triangulation parameters
export function processTriangulationFormData(formData) {
	return {
		// Fix parameter names to match what createDelaunayTriangulation expects
		useCollars: formData.blastHolePoints === "collar",
		useGrade: formData.blastHolePoints === "grade",
		useToe: formData.blastHolePoints === "toe",
		useMLength: formData.blastHolePoints === "measuredLength",
		blastHolePoints: formData.blastHolePoints,
		xyzTolerance: parseFloat(formData.xyzTolerance),
		minAngle: parseFloat(formData.minInternalAngle),
		consider3DAngle: formData.consider3DAngle === "true",
		maxEdgeLength: parseFloat(formData.maxEdgeLength),
		consider3DLength: formData.consider3DLength === "true",
	};
}

//! SHOW OFFSET KAD POPUP
// Step 21) Dialog for offsetting KAD entities (lines and polygons)
// Step 21a) ENHANCED with live preview functionality
export function showOffsetKADPopup(kadObject) {
	const entity = window.getEntityFromKADObject(kadObject);
	if (!entity) return;

	// Step 21b) Debounce timer for preview updates
	let previewDebounceTimer = null;
	const PREVIEW_DEBOUNCE_MS = 150;

	// Step 22) Create form content using the helper function
	const fields = [
	{
		label: "Offset (m) +ve = expand, -ve = contract",
		name: "offsetAmount",
		type: "number",
		value: "1.0",
		step: "0.1",
		min: "-100",
		max: "100",
	},
		{
			label: "Projection (°) +ve° = up, -ve° = dn",
			name: "projectionAngle",
			type: "number",
			value: "0",
			step: "1",
			min: "-90",
			max: "90",
		},
		{
			label: "Number of Offsets",
			name: "numberOfOffsets",
			type: "number",
			value: "1",
			step: "1",
			min: "1",
			max: "10",
		},
		{
			label: "Priority Mode",
			name: "priorityMode",
			type: "select",
			value: "distance",
			options: [
				{
					value: "distance",
					text: "Distance Priority (total distance)",
				},
				{
					value: "vertical",
					text: "Vertical Priority (vertical distance)",
				},
			],
		},
		{
			label: "Offset Color",
			name: "offsetColor",
			type: "color",
			value: "#FF0000",
		},
		{
			label: "Handle Crossovers",
			name: "handleCrossovers",
			type: "checkbox",
			checked: true,
			labelInLeftColumn: false,
		},
		{
			label: "Keep Elevations (interpolate)",
			name: "keepElevations",
			type: "checkbox",
			checked: true,
			labelInLeftColumn: false,
		},
		{
			label: "Limit to Elevation",
			name: "limitElevation",
			type: "checkbox",
			checked: false,
			labelInLeftColumn: false,
		},
		{
			label: "Elevation Limit (m)",
			name: "elevationLimit",
			type: "number",
			value: "0.0",
			step: "0.1",
			min: "-1000",
			max: "10000",
		},
	];

	const formContent = window.createEnhancedFormContent(fields, false, false);

	// Step 22a) Function to get current preview parameters from form
	function getPreviewParams() {
		var formData = window.getFormData(formContent);
		return {
			baseAmount: parseFloat(formData.offsetAmount) || 0,
			projectionAngle: parseFloat(formData.projectionAngle) || 0,
			numberOfOffsets: parseInt(formData.numberOfOffsets) || 1,
			priorityMode: formData.priorityMode || "distance",
			color: formData.offsetColor || "#FF0000",
			handleCrossovers: formData.handleCrossovers === "true",
			keepElevations: formData.keepElevations === "true",
			limitElevation: formData.limitElevation === "true",
			elevationLimit: parseFloat(formData.elevationLimit) || 0.0
		};
	}

	// Step 22b) Function to trigger debounced preview update
	function triggerPreviewUpdate() {
		if (previewDebounceTimer) {
			clearTimeout(previewDebounceTimer);
		}
		previewDebounceTimer = setTimeout(function() {
			var params = getPreviewParams();
			if (window.updateOffsetPreview) {
				window.updateOffsetPreview(entity, params);
			}
		}, PREVIEW_DEBOUNCE_MS);
	}

	// Step 22c) Add event listeners to all form inputs for live preview
	var allInputs = formContent.querySelectorAll("input, select");
	allInputs.forEach(function(input) {
		input.addEventListener("input", triggerPreviewUpdate);
		input.addEventListener("change", triggerPreviewUpdate);
	});

	// Step 23) Add notes section with preview info
	const notesDiv = document.createElement("div");
	notesDiv.style.gridColumn = "1 / -1";
	notesDiv.style.marginTop = "10px";
	notesDiv.style.fontSize = "10px";
	notesDiv.style.color = "#888";
	notesDiv.innerHTML = "\n                <strong>Notes:</strong><br>\n                \u2022 Lines: +ve offsets left (facing forward), -ve offsets right<br>\n                \u2022 Polygons: +ve expands outward, -ve contracts inward<br>\n                \u2022 Projection: 0\u00B0 = horizontal, +\u00B0 = up slope, -\u00B0 = down slope<br>\n                \u2022 <span style=\"color: #00FFFF;\">&#9679;</span> CYAN dot = original START point (direction reference)<br>\n                \u2022 <span style=\"color: #00FF00;\">&#9679;</span> GREEN dots = preview offset START points<br>\n                \u2022 Arrows show direction of travel along lines<br>\n                \u2022 Dashed lines = live preview (updates as you change values)\n    ";
	formContent.appendChild(notesDiv);

	const dialog = new window.FloatingDialog({
		title: "Offset " + kadObject.entityType.toUpperCase() + ": " + kadObject.entityName,
		content: formContent,
		layoutType: "wide",
		width: 400,
		height: 430,
		showConfirm: true,
		showCancel: true,
		confirmText: "Offset",
		cancelText: "Cancel",
		onConfirm: () => {
			// Step 24) Cancel any pending debounced preview updates FIRST
			if (previewDebounceTimer) {
				clearTimeout(previewDebounceTimer);
				previewDebounceTimer = null;
			}

			// Step 24a) Clear preview using the function (this properly clears module-level state)
			if (typeof window.clearOffsetPreview === "function") {
				window.clearOffsetPreview();
			}

			// Step 24a) Clear all selection state BEFORE performKADOffset
			window.selectedKADPolygon = null;
			window.selectedKADObject = null;
			window.selectedPoint = null;

			// Step 24b) Get form values
			const formData = window.getFormData(formContent);

			const offsetParams = {
				baseAmount: parseFloat(formData.offsetAmount),
				projectionAngle: parseFloat(formData.projectionAngle),
				numberOfOffsets: parseInt(formData.numberOfOffsets),
				priorityMode: formData.priorityMode,
				color: formData.offsetColor,
				handleCrossovers: formData.handleCrossovers === "true",
				keepElevations: formData.keepElevations === "true",
				limitElevation: formData.limitElevation === "true",
				elevationLimit: parseFloat(formData.elevationLimit),
				originalEntityName: kadObject.entityName,
			};

			// Step 25) Perform the offset operation (this triggers another redraw)
			window.performKADOffset(entity, offsetParams);

			// Step 25a) Clean up tool state
			window.offsetKADButton.checked = false;
			window.isOffsetKAD = false;
			window.canvas.removeEventListener("click", window.handleOffsetKADClick);
			window.canvas.removeEventListener("touchstart", window.handleOffsetKADClick);
			window.updateStatusMessage("");
		},
		onCancel: () => {
			// Step 26) Cancel any pending debounced preview updates FIRST
			if (previewDebounceTimer) {
				clearTimeout(previewDebounceTimer);
				previewDebounceTimer = null;
			}

			// Step 26a) Clear preview using the function (this properly clears and redraws)
			if (typeof window.clearOffsetPreview === "function") {
				window.clearOffsetPreview();
			}

			// Step 26a) Clear all selection state
			window.selectedKADPolygon = null;
			window.selectedKADObject = null;
			window.selectedPoint = null;

			// Step 26b) Deactivate the offset tool
			window.offsetKADButton.checked = false;
			window.isOffsetKAD = false;
			window.canvas.removeEventListener("click", window.handleOffsetKADClick);
			window.canvas.removeEventListener("touchstart", window.handleOffsetKADClick);
			window.updateStatusMessage("");

			// Step 26c) Trigger additional redraw to ensure selections are cleared
			if (typeof window.redraw3D === "function") {
				window.redraw3D();
			} else {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		},
	});

	dialog.show();

	// Step 27) Initialize JSColor and trigger initial preview after dialog shows
	setTimeout(() => {
		jscolor.install();
		// Force z-index on any JSColor elements
		const colorInputs = formContent.querySelectorAll("[data-jscolor]");
		colorInputs.forEach((input) => {
			if (input.jscolor) {
				input.jscolor.option("zIndex", 20000);
				// Step 27a) Add change listener for JSColor picker
				input.jscolor.onFineChange = function() {
					triggerPreviewUpdate();
				};
			}
		});

		// Step 27b) Trigger initial preview with default values
		triggerPreviewUpdate();
	}, 100);
}

//! SHOW RADII CONFIG POPUP
// Step 28) Dialog for creating radii/circles around selected entities
export function showRadiiConfigPopup(selectedEntities) {
	// Step 29) Analyze selected entities for counts and descriptions
	const entityCount = selectedEntities.length;
	const holeCount = selectedEntities.filter((e) => e.type === "hole").length;
	const kadCount = selectedEntities.filter((e) => e.type.startsWith("kad")).length;

	let entityDescription = "";
	if (holeCount > 0 && kadCount > 0) {
		entityDescription = holeCount + " hole(s) and " + kadCount + " KAD point(s)";
	} else if (holeCount > 0) {
		entityDescription = holeCount + " hole(s)";
	} else {
		entityDescription = kadCount + " KAD point(s)";
	}

	// Step 30) Inherit properties from first selected entity
	let inheritedLineWidth = 2.0; // Default fallback
	let inheritedColor = "#00FF00"; // Default fallback

	if (selectedEntities.length > 0) {
		const firstEntity = selectedEntities[0];

		// Step 31) Check for lineWidth in entity data
		if (firstEntity.data && firstEntity.data.lineWidth !== undefined) {
			inheritedLineWidth = firstEntity.data.lineWidth;
		} else if (firstEntity.data && firstEntity.data.data && firstEntity.data.data.length > 0) {
			// Check first point in KAD data array
			const firstPoint = firstEntity.data.data[0];
			if (firstPoint && firstPoint.lineWidth !== undefined) {
				inheritedLineWidth = firstPoint.lineWidth;
			}
		}

		// Step 32) Check for color in entity data
		if (firstEntity.data && firstEntity.data.color !== undefined) {
			inheritedColor = firstEntity.data.color;
		} else if (firstEntity.data && firstEntity.data.colour !== undefined) {
			inheritedColor = firstEntity.data.colour;
		} else if (firstEntity.data && firstEntity.data.data && firstEntity.data.data.length > 0) {
			// Check first point in KAD data array
			const firstPoint = firstEntity.data.data[0];
			if (firstPoint && firstPoint.color !== undefined) {
				inheritedColor = firstPoint.color;
			} else if (firstPoint && firstPoint.colour !== undefined) {
				inheritedColor = firstPoint.colour;
			}
		}
	}

	// Step 33) Create form fields with inherited values and new rotation/starburst fields
	const fields = [
	{
		label: "Radius (m) +ve = expand, -ve = contract",
		name: "radiiRadius",
		type: "number",
		value: "5.0",
		step: "0.1",
		min: "-100",
		max: "100",
	},
		{
			label: "Circle Steps",
			name: "radiiSteps",
			type: "number",
			value: "16",
			step: "1",
			min: "3",
			max: "100",
		},
		{
			label: "Rotation Offset (°)",
			name: "rotationOffset",
			type: "number",
			value: "0.0",
			step: "1.0",
			min: "-360.0",
			max: "360.0",
		},
		{
			label: "Starburst Offset (%)",
			name: "starburstOffset",
			type: "number",
			value: "100.0",
			step: "1.0",
			min: "0.0",
			max: "100.0",
			disabled: true, // Step 34) Initially disabled - will be enabled if steps >= 8
		},
		{
			label: "Point Location",
			name: "radiiLocation",
			type: "select",
			value: "start",
			options: [
				{
					value: "start",
					text: "Start/Collar Location",
				},
				{
					value: "end",
					text: "End/Toe Location",
				},
			],
		},
		{
			label: "Line Width",
			name: "lineWidth",
			type: "number",
			value: inheritedLineWidth.toString(),
			step: "0.1",
			min: "0.1",
			max: "20",
		},
		{
			label: "Polygon Color",
			name: "radiiColor",
			type: "color",
			value: inheritedColor,
		},
		{
			label: "Union Circles",
			name: "unionCircles",
			type: "checkbox",
			checked: true,
			labelInLeftColumn: false,
		},
	];

	// Step 35) Create enhanced form content
	const formContent = window.createEnhancedFormContent(fields, false, false);

	// Step 36) Add dynamic behavior for starburst field based on steps
	const stepsInput = formContent.querySelector('input[name="radiiSteps"]');
	const starburstInput = formContent.querySelector('input[name="starburstOffset"]');
	const starburstLabel = formContent.querySelector('label[for="starburstOffset"]') || Array.from(formContent.querySelectorAll("label")).find((label) => label.textContent.includes("Starburst"));

	function updateStarburstAvailability() {
		const currentSteps = parseInt(stepsInput.value) || 0;
		const isStarburstEnabled = currentSteps >= 8;

		if (starburstInput) {
			starburstInput.disabled = !isStarburstEnabled;
			starburstInput.style.opacity = isStarburstEnabled ? "1" : "0.4";
			if (!isStarburstEnabled) {
				starburstInput.value = "100.0"; // Reset to 100% when disabled
			}
		}

		if (starburstLabel) {
			starburstLabel.style.opacity = isStarburstEnabled ? "1" : "0.4";
		}
	}

	// Step 37) Add event listener for steps input
	if (stepsInput) {
		stepsInput.addEventListener("input", updateStarburstAvailability);
		stepsInput.addEventListener("change", updateStarburstAvailability);
		// Initial check
		updateStarburstAvailability();
	}

	// Step 38) Add informational notes section with starburst limitation info
	const notesDiv = document.createElement("div");
	notesDiv.style.gridColumn = "1 / -1";
	notesDiv.style.marginTop = "10px";
	notesDiv.style.fontSize = "10px";
	notesDiv.style.color = "var(--text-color)";
	notesDiv.innerHTML =
		`
        <strong>Selected:</strong> ` +
		entityDescription +
		`<br>
        • Creates circular polygons around each point<br>
        • Union option combines overlapping circles<br>
        • Higher steps create smoother circles<br>
        • Line width inherited from first selected entity<br>
        • Rotation: 0° = no rotation, +45° = clockwise, -45° = counter-clockwise<br>
        • <strong>Starburst: Requires 8+ steps minimum</strong> (disabled for < 8 steps)<br>
        • Starburst: 100% = circle, 50% = even points at half radius, 0% = star shape<br>
        • Example: 5m radius + 50% starburst = odd points at 5m, even at 2.5m
    `;
	formContent.appendChild(notesDiv);

	// Step 39) Create FloatingDialog instance
	const dialog = new window.FloatingDialog({
		title: "Create Radii Polygons",
		content: formContent,
		layoutType: "wide",
		width: 420,
		height: 470, // Slightly taller for the extra note
		showConfirm: true,
		showCancel: true,
		confirmText: "Create",
		cancelText: "Cancel",
		onConfirm: () => {
			// Step 40) Get form values and validate
			const formData = window.getFormData(formContent);

			const radius = parseFloat(formData.radiiRadius);
			const steps = parseInt(formData.radiiSteps);
			const rotationOffset = parseFloat(formData.rotationOffset);
			let starburstOffset = parseFloat(formData.starburstOffset);
			const location = formData.radiiLocation;
			const lineWidth = parseFloat(formData.lineWidth);
			const unionCircles = formData.unionCircles === "true";
			const color = formData.radiiColor;

			// Step 41) Enhanced validation with starburst step requirement
			if (isNaN(radius) || radius <= 0) {
				window.showErrorDialog("Invalid Radius", "Please enter a valid radius > 0");
				return;
			}

			if (isNaN(steps) || steps < 3 || steps > 100) {
				window.showErrorDialog("Invalid Steps", "Steps must be between 3 and 100");
				return;
			}

			if (isNaN(rotationOffset) || rotationOffset < -360.0 || rotationOffset > 360.0) {
				window.showErrorDialog("Invalid Rotation", "Rotation offset must be between -360° and +360°");
				return;
			}

			// Step 42) Validate starburst only if it should be enabled
			if (steps >= 8) {
				if (isNaN(starburstOffset) || starburstOffset < 0.0 || starburstOffset > 100.0) {
					window.showErrorDialog("Invalid Starburst", "Starburst offset must be between 0% and 100%");
					return;
				}
			} else {
				// Force starburst to 100% for steps < 8 (now this works because starburstOffset is let)
				starburstOffset = 100.0;
			}

			if (isNaN(lineWidth) || lineWidth < 0.1 || lineWidth > 20) {
				window.showErrorDialog("Invalid Line Width", "Line width must be between 0.1 and 20");
				return;
			}

			// Step 43) Create radii parameters object (simplified logic since we handled it above)
			const radiiParams = {
				radius: radius,
				steps: steps,
				rotationOffset: rotationOffset,
				starburstOffset: starburstOffset / 100.0, // Convert percentage to decimal ratio
				useToeLocation: location === "end",
				unionCircles: unionCircles,
				color: color,
				lineWidth: lineWidth,
			};

			// Step 44) Perform radii creation
			window.createRadiiFromSelectedEntitiesFixed(selectedEntities, radiiParams);

			// Step 45) Clean up selection state using centralized function
			window.clearAllSelectionState();
			window.radiiHolesOrKADsTool.checked = false;
			window.resetFloatingToolbarButtons("none");
			window.updateStatusMessage("");
		},
		onCancel: () => {
			// Step 46) Clean up on cancel using centralized function
			window.clearAllSelectionState();
			window.radiiHolesOrKADsTool.checked = false;
			window.resetFloatingToolbarButtons("none");
			window.updateStatusMessage("");
		},
	});

	// Step 47) Show dialog and initialize color picker
	dialog.show();

	// Step 48) Initialize JSColor after dialog shows and recheck starburst availability
	setTimeout(() => {
		jscolor.install();
		// Force z-index on any JSColor elements
		const colorInputs = formContent.querySelectorAll("[data-jscolor]");
		colorInputs.forEach((input) => {
			if (input.jscolor) {
				input.jscolor.option("zIndex", 20000);
			}
		});

		// Final check of starburst availability after dialog is fully loaded
		updateStarburstAvailability();
	}, 100);
}

//===========================================
// EXPOSE FUNCTIONS GLOBALLY
//===========================================
// Step 49) Expose all functions globally for access from kirra.js
window.showTriangulationPopup = showTriangulationPopup;
window.showOffsetKADPopup = showOffsetKADPopup;
window.showRadiiConfigPopup = showRadiiConfigPopup;

console.log("✅ KADDialogs.js loaded successfully - 3 KAD dialogs extracted from kirra.js");
