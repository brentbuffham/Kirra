// src/dialog/popups/analytics/BlastAnalysisShaderDialog.js
import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import { showTimeInteractionDialog } from "./TimeInteractionDialog.js";
import { applyLiveAnalysisShader, removeLiveAnalysisSurface, bakeLiveShaderTo2D, removeLiveFlattenedImage } from "../../../helpers/BlastAnalysisShaderHelper.js";

/**
 * Show dialog for configuring blast analysis shader overlay.
 *
 * @param {Function} callback - Called with { model, surfaceId, blastName, params } on Apply
 */
var SETTINGS_STORAGE_KEY = "kirra_blast_analysis_settings";

/**
 * Load saved settings from localStorage.
 * @returns {Object|null}
 */
function loadSavedSettings() {
	try {
		var json = localStorage.getItem(SETTINGS_STORAGE_KEY);
		return json ? JSON.parse(json) : null;
	} catch (e) {
		console.warn("Failed to load blast analysis settings from localStorage:", e);
		return null;
	}
}

/**
 * Save settings to localStorage.
 * @param {Object} settings
 */
function saveSettingsToStorage(settings) {
	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
	} catch (e) {
		console.warn("Failed to save blast analysis settings to localStorage:", e);
	}
}

export function showBlastAnalysisShaderDialog(callback) {
	// Get available models from the shader system
	var models = window.getAvailableAnalyticsModels ? window.getAvailableAnalyticsModels() : [];

	// Debug: check if models are loaded
	if (models.length === 0) {
		console.error("No analytics models available! Check if getAvailableAnalyticsModels is properly initialized.");
		return;
	}
	console.log("Available models:", models);

	// Load saved settings: window.blastAnalyticsSettings > localStorage > defaults
	var saved = window.blastAnalyticsSettings || loadSavedSettings();

	// Get available surfaces
	var surfaces = [];
	if (window.loadedSurfaces && window.loadedSurfaces.size > 0) {
		window.loadedSurfaces.forEach(function(surface, surfaceId) {
			surfaces.push({ value: surfaceId, text: surface.name || surfaceId });
		});
	}

	// Get available blast entities
	var blasts = [];
	var blastNames = new Set();
	if (window.allBlastHoles && window.allBlastHoles.length > 0) {
		window.allBlastHoles.forEach(function(hole) {
			if (hole.entityName && !blastNames.has(hole.entityName)) {
				blastNames.add(hole.entityName);
				blasts.push({ value: hole.entityName, text: hole.entityName });
			}
		});
	}

	// Add "All Holes" option
	blasts.unshift({ value: "__ALL__", text: "All Blast Holes" });

	// If no surfaces, create default plane option
	if (surfaces.length === 0) {
		surfaces.push({ value: "__PLANE__", text: "Generate Analysis Plane" });
	} else {
		surfaces.unshift({ value: "__PLANE__", text: "Generate Analysis Plane" });
	}

	// Convert models to dropdown options
	var modelOptions = models.map(function(m) {
		return {
			value: m.name,
			text: m.displayName + " (" + m.unit + ")"
		};
	});

	// Get current settings from in-memory or localStorage
	var currentModel = saved ? saved.model : "scaled_heelan";
	var currentSurface = saved ? saved.surfaceId : "__PLANE__";
	var currentBlast = saved ? saved.blastName : "__ALL__";
	var currentPlanePadding = saved ? saved.planePadding : 200;

	var fields = [
		{
			label: "Analytics Model",
			name: "model",
			type: "select",
			value: currentModel,
			options: modelOptions,
			required: true
		},
		{
			label: "Render On",
			name: "surfaceId",
			type: "select",
			value: currentSurface,
			options: surfaces,
			required: true
		},
		{
			label: "Blast Pattern",
			name: "blastName",
			type: "select",
			value: currentBlast,
			options: blasts,
			required: true
		},
		{
			label: "Analysis Plane Distance from Blast Holes (m)",
			name: "planePadding",
			type: "number",
			value: currentPlanePadding,
			min: 50,
			max: 1000,
			step: 10,
			required: false
		}
	];

	// Create form content
	var formContent = createEnhancedFormContent(fields);

	// Create container and append both parts
	var container = document.createElement("div");
	container.appendChild(formContent);

	// Add model-specific parameter section
	var baDark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
	var parametersSection = document.createElement("div");
	parametersSection.id = "modelParametersSection";
	parametersSection.style.marginTop = "20px";
	parametersSection.style.padding = "12px 15px";
	parametersSection.style.background = baDark ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.04)";
	parametersSection.style.borderRadius = "5px";
	parametersSection.style.border = baDark ? "1px solid var(--dark-mode-border)" : "1px solid var(--light-mode-border)";

	var parametersTitle = document.createElement("h3");
	parametersTitle.style.marginTop = "0";
	parametersTitle.style.marginBottom = "12px";
	parametersTitle.style.fontSize = "14px";
	parametersTitle.style.fontWeight = "bold";
	parametersTitle.style.color = "var(--text-color)";
	parametersTitle.textContent = "Model Parameters";
	parametersSection.appendChild(parametersTitle);

	var parametersContent = document.createElement("div");
	parametersContent.id = "modelParametersContent";
	parametersContent.style.display = "flex";
	parametersContent.style.flexDirection = "column";
	parametersContent.style.gap = "4px";
	parametersContent.style.width = "100%";
	parametersSection.appendChild(parametersContent);

	container.appendChild(parametersSection);

	// Add model info section
	var infoSection = document.createElement("div");
	infoSection.id = "modelInfoSection";
	infoSection.style.marginTop = "15px";
	infoSection.style.padding = "12px 15px";
	infoSection.style.background = "rgba(0, 100, 200, 0.1)";
	infoSection.style.borderRadius = "5px";
	infoSection.style.border = "1px solid rgba(0, 150, 255, 0.3)";
	infoSection.style.fontSize = "11px";
	infoSection.style.color = "var(--text-color)";
	infoSection.style.lineHeight = "1.4";

	var infoTitle = document.createElement("h4");
	infoTitle.style.marginTop = "0";
	infoTitle.style.marginBottom = "8px";
	infoTitle.style.fontSize = "12px";
	infoTitle.style.fontWeight = "bold";
	infoTitle.style.color = "#4DA6FF";
	infoTitle.textContent = "ℹ️ Model Information";
	infoSection.appendChild(infoTitle);

	var infoContent = document.createElement("div");
	infoContent.id = "modelInfoContent";
	infoContent.style.maxHeight = "120px";
	infoContent.style.overflowY = "auto";
	infoSection.appendChild(infoContent);

	container.appendChild(infoSection);

	// Models that support time interaction
	var TIMING_CAPABLE_MODELS = ["ppv", "ppv_deck", "heelan_original", "scaled_heelan", "nonlinear_damage", "pressure", "jointed_rock", "powder_factor_vol"];

	var dialog = new FloatingDialog({
		title: "Blast Analysis Shader",
		content: container,
		width: 650,
		height: 750,
		showConfirm: true,
		confirmText: "Apply Analysis",
		cancelText: "Cancel",
		showOption1: true,
		option1Text: "Interact",
		onConfirm: function() {
			var formData = getFormData(this.content);

			// Get model-specific parameters
			var params = getModelParameters(formData.model);

			// Parse plane padding
			var planePadding = parseFloat(formData.planePadding) || 200;

			// Store settings in memory and localStorage
			window.blastAnalyticsSettings = {
				model: formData.model,
				surfaceId: formData.surfaceId,
				blastName: formData.blastName,
				planePadding: planePadding,
				params: params
			};
			saveSettingsToStorage(window.blastAnalyticsSettings);

			callback({
				model: formData.model,
				surfaceId: formData.surfaceId,
				blastName: formData.blastName,
				planePadding: planePadding,
				params: params
			});
		},
		onOption1: function() {
			// [Interact] — apply a LIVE shader (not baked) then open time slider
			var formData = getFormData(dialog.content);
			var params = getModelParameters(formData.model);
			var planePadding = parseFloat(formData.planePadding) || 200;

			// Store settings
			window.blastAnalyticsSettings = {
				model: formData.model,
				surfaceId: formData.surfaceId,
				blastName: formData.blastName,
				planePadding: planePadding,
				params: params
			};
			saveSettingsToStorage(window.blastAnalyticsSettings);

			// Apply a LIVE (non-baked) shader so uniforms can be updated in real-time
			var liveConfig = {
				model: formData.model,
				surfaceId: formData.surfaceId,
				blastName: formData.blastName,
				planePadding: planePadding,
				params: params
			};
			var liveResult = applyLiveAnalysisShader(liveConfig);

			if (!liveResult) {
				console.warn("Failed to create live analysis shader");
				return;
			}

			// Bake initial 2D image so 2D view shows the analysis immediately
			bakeLiveShaderTo2D(liveResult.surfaceId, liveConfig);

			// Open time interaction dialog with direct reference to live shader
			showTimeInteractionDialog({
				surfaceId: liveResult.surfaceId,
				shaderMaterial: liveResult.shaderMaterial,
				modelName: formData.model,
				params: params,
				liveConfig: liveConfig,
				onFreeze: function(freezeConfig) {
					// Remove live surface and flattened image, then bake a permanent one at this time
					removeLiveFlattenedImage(liveResult.surfaceId);
					removeLiveAnalysisSurface(liveResult.surfaceId);
					var freezeParams = Object.assign({}, params, { displayTime: freezeConfig.timeMs });
					callback({
						model: formData.model,
						surfaceId: formData.surfaceId,
						blastName: formData.blastName,
						planePadding: planePadding,
						params: freezeParams
					});
				},
				onClose: function() {
					// User cancelled — remove the live surface and flattened image
					removeLiveFlattenedImage(liveResult.surfaceId);
					removeLiveAnalysisSurface(liveResult.surfaceId);
					// Redraw to clear the removed surface
					if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
					if (window.threeRenderer) window.threeRenderer.needsRender = true;
				}
			});
		},
		onCancel: function() {
			// Redraw in case dialog obscured the view
			if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
			if (window.threeRenderer) window.threeRenderer.needsRender = true;
		}
	});

	dialog.show();

	// Wait for DOM to be ready, then populate initial parameters and info
	setTimeout(function() {
		if (!dialog.content) {
			console.error("Dialog content not available!");
			return;
		}

		// Add listener for model change and populate initial parameters
		var modelSelect = dialog.content.querySelector('[name="model"]');
		if (modelSelect) {
			console.log("Model select found, value:", modelSelect.value);
			// Populate parameters and info for the initially selected model
			updateModelParameters(modelSelect.value, dialog.content);
			updateModelInfo(modelSelect.value, dialog.content);

			// Set initial [Interact] button visibility
			var option1Btn = dialog.dialogElement ? dialog.dialogElement.querySelector(".option1") : null;
			if (option1Btn) {
				var isTimingCapable = TIMING_CAPABLE_MODELS.indexOf(modelSelect.value) !== -1;
				option1Btn.style.display = isTimingCapable ? "" : "none";
			}

			// Add change listener
			modelSelect.addEventListener("change", function() {
				updateModelParameters(this.value, dialog.content);
				updateModelInfo(this.value, dialog.content);

				// Show/hide [Interact] button based on timing capability
				var option1Btn = dialog.dialogElement ? dialog.dialogElement.querySelector(".option1") : null;
				if (option1Btn) {
					var isTimingCapable = TIMING_CAPABLE_MODELS.indexOf(this.value) !== -1;
					option1Btn.style.display = isTimingCapable ? "" : "none";
				}
			});
		} else {
			console.error("Model select element not found!");
		}
	}, 50);
}

/**
 * Update the info section based on selected model.
 *
 * @param {string} modelName - Selected model name
 * @param {HTMLElement} dialogContent - Dialog content element
 */
function updateModelInfo(modelName, dialogContent) {
	var infoContent = dialogContent.querySelector("#modelInfoContent");
	if (!infoContent) return;

	var info = getModelInfo(modelName);
	infoContent.innerHTML = info;
}

/**
 * Get information text for a model.
 *
 * @param {string} modelName - Model name
 * @returns {string} - HTML info text
 */
function getModelInfo(modelName) {
	switch (modelName) {
		case "ppv":
			return `
				<p><strong>Peak Particle Velocity (PPV) - Site Law</strong></p>
				<p>Predicts ground vibration using empirical site constants from monitoring data.</p>
				<p><strong>Formula:</strong> PPV = K × (SD)<sup>-b</sup></p>
				<p>Where SD = Scaled Distance = D / W<sup>n</sup></p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>K</strong> - Site constant (mm/s), calibrated from blast monitoring</li>
					<li><strong>b</strong> - Distance attenuation exponent (typical 1.5-2.0)</li>
					<li><strong>n</strong> - Charge weight scaling exponent (typically 0.5 for square-root SD)</li>
					<li><strong>D</strong> - Distance from charge top/centre/base (m), per pixel</li>
					<li><strong>W</strong> - Charge mass per hole (kg), from charging data</li>
				</ul>
				<p style="margin-top: 8px;"><strong>MIC Bin Mode</strong> (when Bin Width > 0):<br>
				The blast timeline is divided into fixed-width time bins. All holes firing within the same bin have their charges summed to give the <strong>Maximum Instantaneous Charge (MIC)</strong> for that bin. PPV is then evaluated at each hole's charge top, centre, and base using the bin MIC. The worst-case bin determines the peak PPV at each pixel. The Bin Offset shifts the bin boundaries (e.g. 8ms bins with 4ms offset: edge bin [0,4ms), then [4,12), [12,20)...).</p>
				<p style="margin-top: 8px; font-style: italic;">Use for: Compliance predictions, monitoring comparisons, and MIC-based vibration analysis.</p>
			`;

		case "ppv_deck":
			return `
				<p><strong>PPV (Per-Deck) - Site Law with Deck Resolution</strong></p>
				<p>Evaluates PPV independently for each charged deck, showing per-deck influence zones.</p>
				<p><strong>Formula:</strong> PPV = K × (SD)<sup>-b</sup> per deck</p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>K, b, n</strong> - Site constants (same as PPV model)</li>
					<li><strong>Per-deck mass</strong> - Each deck uses its own mass, not total hole mass</li>
					<li><strong>Multi-deck holes</strong> - Air gaps between decks naturally excluded</li>
					<li><strong>3-point evaluation</strong> - PPV checked at top, centre, and base of each deck</li>
				</ul>
				<p style="margin-top: 8px;"><strong>MIC Bin Mode</strong> (when Bin Width > 0):<br>
				Same fixed-width bin approach as PPV model. Deck masses within the same time bin are summed for MIC. Each deck's top/mid/base is evaluated using the bin MIC. The offset shifts bin boundaries to test different bin alignments.</p>
				<p style="margin-top: 8px; font-style: italic;">Use for: Per-deck PPV analysis with multi-deck charge configurations and MIC windowing.</p>
			`;

		case "heelan_original":
			return `
				<p><strong>Heelan (1953) - Original Radiation Pattern</strong></p>
				<p>Physics-based model using elastic wave theory and cylindrical charge radiation patterns.</p>
				<p><strong>Theory:</strong> P-wave and S-wave propagation from cylindrical explosive charges</p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>Rock Density</strong> - Mass per unit volume (kg/m³)</li>
					<li><strong>P-Wave Velocity</strong> - Compressional wave speed (m/s), from seismic testing</li>
					<li><strong>S-Wave Velocity</strong> - Shear wave speed (m/s), from seismic testing</li>
					<li><strong>VOD</strong> - Detonation velocity (m/s), <em>should come from explosive product database</em></li>
					<li><strong>Quality Factors</strong> - Rock attenuation (P and S waves)</li>
					<li><strong>Charge Elements</strong> - Discretization resolution (higher = more accurate)</li>
				</ul>
				<p style="margin-top: 8px; font-style: italic;">⚠️ Future: VOD and density should be extracted per-deck from charging products.</p>
			`;

		case "scaled_heelan":
			return `
				<p><strong>Scaled Heelan (Blair & Minchinton 2006) - Recommended</strong></p>
				<p>Combines site law calibration (K, b) with Heelan radiation patterns for directional accuracy.</p>
				<p><strong>Advantages:</strong> Calibrated to site data + physics-based directional effects</p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>K, b, n</strong> - Site constants (same as PPV model above)</li>
					<li><strong>P/S-Wave Velocities</strong> - Control radiation pattern directionality</li>
					<li><strong>VOD</strong> - Explosive detonation velocity, <em>should come from product database</em></li>
					<li><strong>Wave Weights</strong> - Balance P-wave vs SV-wave contributions</li>
					<li><strong>Charge Elements</strong> - Number of point sources along hole depth</li>
				</ul>
				<p style="margin-top: 8px; font-style: italic;">✅ Best for: Compliance prediction with directional accuracy (structures near blast).</p>
			`;

		case "nonlinear_damage":
			return `
				<p><strong>Non-Linear Damage (Holmberg-Persson)</strong></p>
				<p>Predicts rock damage zones using Holmberg-Persson damage criterion with PPV and stress.</p>
				<p><strong>Output:</strong> Damage index (0 = no damage, 1 = full fracture)</p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>Rock UCS</strong> - Uniaxial compressive strength (MPa)</li>
					<li><strong>Rock Tensile</strong> - Tensile strength (MPa), typically UCS/10</li>
					<li><strong>Critical PPV</strong> - Threshold for damage initiation (mm/s)</li>
					<li><strong>H-P Constants</strong> - K, alpha, beta calibrated from damage observations</li>
				</ul>
				<p style="margin-top: 8px; font-style: italic;">🎯 Use for: Fragmentation analysis, overbreak prediction, damage zone mapping.</p>
			`;

		case "sdob":
			return `
				<p><strong>Scaled Depth of Burial (McKenzie 2022)</strong></p>
				<p>Assesses flyrock risk by computing the ratio of stemming to charge mass.</p>
				<p><strong>Formula:</strong> SDoB = S<sub>t</sub> / W<sub>t,m</sub><sup>1/3</sup></p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>S<sub>t</sub></strong> - Stemming length (m), depth from collar to first explosive deck</li>
					<li><strong>W<sub>t,m</sub></strong> - Contributing charge mass (kg), capped at 10 diameters</li>
					<li><strong>Target SDoB</strong> - Threshold contour (typical 1.5 m/kg<sup>1/3</sup>)</li>
					<li><strong>Max Display Distance</strong> - Voronoi cell radius limit (m)</li>
				</ul>
				<p style="margin-top: 8px;">Colour: <span style="color:#ff0000;">Red</span> = Low SDoB (flyrock risk) | <span style="color:#00cc00;">Green</span> = High SDoB (well confined)</p>
				<p style="font-style: italic;">Use for: Flyrock risk assessment, stemming adequacy checks, clearance zone planning.</p>
			`;

		case "see":
			return `
				<p><strong>Specific Explosive Energy (SEE)</strong></p>
				<p>Detonation energy density: SEE = 0.5 × ρ<sub>e</sub> × VOD²</p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>ρ<sub>e</sub></strong> - Explosive density (kg/m³), from charging data</li>
					<li><strong>VOD</strong> - Velocity of detonation (m/s), from product database or fallback</li>
				</ul>
				<p>Displayed as IDW-weighted heatmap in GJ/m³. Higher values = more energy per unit volume.</p>
				<p>Typical range: ANFO ≈ 8.6 GJ/m³, Emulsion ≈ 18.9 GJ/m³</p>
				<p style="margin-top: 8px; font-style: italic;">Use for: Comparing explosive energy distribution, product performance assessment.</p>
			`;

		case "pressure":
			return `
				<p><strong>Borehole Pressure</strong></p>
				<p>Wall pressure: P<sub>b</sub> = ρ<sub>e</sub> × VOD² / 8</p>
				<p>Attenuation: P(R) = P<sub>b</sub> × (a/R)<sup>α</sup></p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>a</strong> - Borehole radius (m)</li>
					<li><strong>R</strong> - Distance from charge element (m)</li>
					<li><strong>α</strong> - Attenuation exponent (≈2 for cylindrical divergence)</li>
				</ul>
				<p style="margin-top: 8px; font-style: italic;">Use for: Borehole interaction analysis, wall damage assessment.</p>
			`;

		case "powder_factor_vol":
			return `
				<p><strong>Volumetric Powder Factor</strong></p>
				<p>Integrates along each charge column. Each element contributes mass to an expanding capsule volume:</p>
				<p><strong>PF<sub>elem</sub> = elementMass / ((4/3)π R³)</strong></p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li>Near charge: small capsule volume → high PF (red)</li>
					<li>Far from charge: large capsule volume → low PF (violet)</li>
					<li>Elements summed within each hole, peak taken across holes</li>
				</ul>
				<p style="margin-top: 8px; font-style: italic;">Use for: Identifying over/under-charged zones, charge distribution assessment.</p>
			`;

		case "jointed_rock":
			return `
				<p><strong>Jointed Rock Damage</strong></p>
				<p>Combines intact rock fracture with joint-controlled failure using Mohr-Coulomb criterion.</p>
				<ul style="margin: 5px 0; padding-left: 20px;">
					<li><strong>PPV</strong> - Holmberg-Persson integration along charge column</li>
					<li><strong>Dynamic stress</strong> - σ<sub>d</sub> = ρ<sub>rock</sub> × V<sub>p</sub> × PPV</li>
					<li><strong>Rock fracture</strong> - σ<sub>d</sub> / tensile strength</li>
					<li><strong>Joint failure</strong> - τ / (c + μ×σ<sub>n</sub>) via Mohr-Coulomb</li>
				</ul>
				<p>Output: max(rock fracture ratio, joint failure ratio). Values > 1 = damage.</p>
				<p style="margin-top: 8px; font-style: italic;">Use for: Predicting failure zones controlled by rock structure.</p>
			`;

		default:
			return "<p>Select a model to see detailed information.</p>";
	}
}

/**
 * Update the parameters section based on selected model.
 *
 * @param {string} modelName - Selected model name
 * @param {HTMLElement} dialogContent - Dialog content element
 */
function updateModelParameters(modelName, dialogContent) {
	console.log("updateModelParameters called with model:", modelName);
	var paramsContent = dialogContent.querySelector("#modelParametersContent");
	console.log("Found paramsContent element:", paramsContent);
	if (!paramsContent) {
		console.error("Could not find #modelParametersContent element!");
		return;
	}

	// Get default parameters for the model
	var params = getDefaultParametersForModel(modelName);

	// Override defaults with saved values if model matches
	var savedSettings = window.blastAnalyticsSettings || loadSavedSettings();
	if (savedSettings && savedSettings.model === modelName && savedSettings.params) {
		for (var key in params) {
			if (params.hasOwnProperty(key) && savedSettings.params[key] !== undefined) {
				params[key].value = savedSettings.params[key];
			}
		}
	}
	console.log("Parameters for model:", params);

	var html = "";

	// Generate input fields for each parameter using 2-column grid layout
	for (var key in params) {
		if (params.hasOwnProperty(key)) {
			var param = params[key];
			var unitSpan = param.unit ? `<span style="margin-left: 8px; color: #888; font-size: 11px;">${param.unit}</span>` : '';
			var tooltipAttr = param.tooltip ? ` title="${param.tooltip.replace(/"/g, '&quot;')}"` : '';
			html += `
				<div class="button-container-2col" style="display: grid; grid-template-columns: 40% 60%; column-gap: 8px; row-gap: 2px; align-items: center; width: 100%; margin-bottom: 8px;"${tooltipAttr}>
					<label class="labelWhite12" style="font-size: 11px; font-family: sans-serif; text-align: right; padding-right: 8px; cursor: help;"${tooltipAttr}>${param.label}:</label>
					<div style="display: flex; align-items: center;">
						<input type="number"
							   name="param_${key}"
							   value="${param.value}"
							   step="${param.step || 'any'}"
							   min="${param.min || ''}"
							   max="${param.max || ''}"
							   ${tooltipAttr}
							   style="width: 120px; padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">
						${unitSpan}
					</div>
				</div>
			`;
		}
	}

	console.log("Generated HTML length:", html.length);
	paramsContent.innerHTML = html;
	console.log("Parameters populated");
}

/**
 * Get default parameters for a model with UI metadata.
 *
 * @param {string} modelName - Model name
 * @returns {Object} - Parameter definitions
 */
function getDefaultParametersForModel(modelName) {
	switch (modelName) {
		case "ppv":
			return {
				K: { label: "Site Constant K", value: 1140, min: 100, max: 5000, step: 10, unit: "",
					tooltip: "Empirical site constant (intercept) from blast monitoring regression. Higher K = higher predicted PPV. Calibrate from site vibration data." },
				B: { label: "Site Exponent b", value: 1.6, min: 1.0, max: 2.5, step: 0.1, unit: "",
					tooltip: "Distance attenuation exponent (slope). Typical range 1.5-2.0. Higher b = faster PPV decay with distance." },
				chargeExponent: { label: "Scaled Weight Exponent n", value: 0.5, min: 0.3, max: 0.8, step: 0.05, unit: "",
					tooltip: "Charge weight scaling exponent. 0.5 = square-root (standard SD), 0.33 = cube-root. Controls how charge mass influences scaled distance." },
				pWaveVelocity: { label: "P-Wave Velocity (0 = instant)", value: 0, min: 0, max: 7000, step: 100, unit: "m/s",
					tooltip: "Rock P-wave velocity for wave propagation animation. During time interaction, PPV ripples outward at this speed. 0 = instant (no travel time). Typical: 1600-4500 m/s." },
				targetPPV: { label: "Target PPV (0 = off)", value: 0, min: 0, max: 500, step: 5, unit: "mm/s",
					tooltip: "Draw a black contour line at this PPV value. Set to 0 to disable. Useful for compliance boundaries." },
				timeWindow: { label: "MIC Bin Width (0 = per-hole)", value: 0, min: 0, max: 500, step: 1, unit: "ms",
					tooltip: "Time bin width for Maximum Instantaneous Charge (MIC). Holes firing within the same bin have their charges summed. 0 = each hole evaluated independently. Typical: 8-25 ms." },
				timeOffset: { label: "Bin Offset", value: 0, min: 0, max: 500, step: 1, unit: "ms",
					tooltip: "Shifts the bin boundaries. With 8ms bins and 4ms offset: edge bin [0,4), then [4,12), [12,20), etc. 0 = bins start at t=0." }
			};

		case "heelan_original":
			return {
				rockDensity: { label: "Rock Density", value: 2700, min: 2000, max: 3500, step: 50, unit: "kg/m³",
					tooltip: "In-situ rock mass density. Affects wave impedance and radiation pattern amplitude. Typical: granite 2700, sandstone 2400, limestone 2600." },
				pWaveVelocity: { label: "P-Wave Velocity", value: 4500, min: 2000, max: 7000, step: 100, unit: "m/s",
					tooltip: "Compressional (P) wave velocity from seismic refraction or crosshole testing. Controls radiation pattern shape and wavelength." },
				sWaveVelocity: { label: "S-Wave Velocity", value: 2600, min: 1500, max: 4000, step: 100, unit: "m/s",
					tooltip: "Shear (S) wave velocity. Typically 0.5-0.6 of P-wave velocity. Controls SV-wave radiation lobe geometry." },
				detonationVelocity: { label: "VOD", value: 5500, min: 3000, max: 8000, step: 100, unit: "m/s",
					tooltip: "Velocity of detonation of the explosive. Controls the Mach angle of the radiation pattern. ANFO ~4500, emulsion ~5500 m/s." },
				numElements: { label: "Charge Elements", value: 20, min: 5, max: 64, step: 1, unit: "",
					tooltip: "Number of point sources used to discretise the charge column. Higher = more accurate but slower. 20 is a good balance." },
				qualityFactorP: { label: "Quality Factor P", value: 50, min: 0, max: 200, step: 5, unit: "",
					tooltip: "Seismic quality factor for P-waves (anelastic attenuation). Higher Q = less attenuation. 0 = no attenuation. Typical rock: 30-100." },
				qualityFactorS: { label: "Quality Factor S", value: 30, min: 0, max: 200, step: 5, unit: "",
					tooltip: "Seismic quality factor for S-waves. Usually lower than Qp. Typical: 20-80." }
			};

		case "scaled_heelan":
			return {
				K: { label: "Site Constant K", value: 1140, min: 100, max: 5000, step: 10, unit: "",
					tooltip: "Site constant from blast monitoring regression. Scales the overall PPV magnitude. Calibrate from monitoring data." },
				B: { label: "Site Exponent B", value: 1.6, min: 1.0, max: 2.5, step: 0.1, unit: "",
					tooltip: "Distance attenuation exponent. Controls how fast PPV decays with scaled distance. Typical 1.5-2.0." },
				chargeExponent: { label: "Charge Exponent", value: 0.5, min: 0.3, max: 0.8, step: 0.05, unit: "",
					tooltip: "Charge weight scaling exponent. 0.5 = square-root (standard scaled distance)." },
				numElements: { label: "Charge Elements", value: 20, min: 5, max: 64, step: 1, unit: "",
					tooltip: "Number of point sources along the charge column. Higher = more accurate directional pattern but slower." },
				pWaveVelocity: { label: "P-Wave Velocity", value: 4500, min: 2000, max: 7000, step: 100, unit: "m/s",
					tooltip: "Compressional wave velocity. Shapes the radiation pattern directionality." },
				sWaveVelocity: { label: "S-Wave Velocity", value: 2600, min: 1500, max: 4000, step: 100, unit: "m/s",
					tooltip: "Shear wave velocity. Affects SV-wave lobe direction." },
				detonationVelocity: { label: "VOD", value: 5500, min: 3000, max: 8000, step: 100, unit: "m/s",
					tooltip: "Explosive detonation velocity. Controls the Mach cone angle of the radiation pattern." },
				pWaveWeight: { label: "P-Wave Weight", value: 1.0, min: 0, max: 2, step: 0.1, unit: "",
					tooltip: "Relative contribution of P-wave radiation. 1.0 = normal. Increase to emphasise axial vibration." },
				svWaveWeight: { label: "SV-Wave Weight", value: 1.0, min: 0, max: 2, step: 0.1, unit: "",
					tooltip: "Relative contribution of SV-wave radiation. 1.0 = normal. Increase to emphasise lateral/shear vibration." }
			};

		case "nonlinear_damage":
			return {
				K_hp: { label: "H-P Constant K", value: 700, min: 100, max: 2000, step: 50, unit: "",
					tooltip: "Holmberg-Persson site constant. Calibrated from observed damage extents or near-field PPV data." },
				alpha_hp: { label: "H-P Alpha (α)", value: 0.7, min: 0.3, max: 1.5, step: 0.05, unit: "",
					tooltip: "Charge mass exponent in Holmberg-Persson formula. Controls how charge mass influences PPV. Typical 0.5-1.0." },
				beta_hp: { label: "H-P Beta (β)", value: 1.5, min: 1.0, max: 2.5, step: 0.1, unit: "",
					tooltip: "Distance exponent in Holmberg-Persson formula. Controls attenuation rate with distance." },
				ppvCritical: { label: "Critical PPV", value: 700, min: 100, max: 2000, step: 50, unit: "mm/s",
					tooltip: "PPV threshold for damage initiation. Pixels at or above this value show full damage (ratio = 1.0). Typical: 700 mm/s for hard rock." },
				numElements: { label: "Charge Elements", value: 20, min: 5, max: 50, step: 1, unit: "",
					tooltip: "Sub-elements per charge column for Holmberg-Persson integration. Higher = smoother damage contours." },
				cutoffDistance: { label: "Min Distance", value: 0.3, min: 0.1, max: 2.0, step: 0.1, unit: "m",
					tooltip: "Minimum distance clamp to avoid singularity at charge axis. Prevents infinite values at zero distance." }
			};

		case "sdob":
			return {
				targetSDoB: { label: "Target SDoB Threshold", value: 1.5, min: 0.5, max: 5.0, step: 0.1, unit: "m/kg^(1/3)",
					tooltip: "Scaled Depth of Burial contour threshold. Values below this indicate flyrock risk. McKenzie (2022) recommends 1.5 for surface blasting." },
				maxDisplayDistance: { label: "Max Display Distance", value: 50, min: 10, max: 500, step: 10, unit: "m",
					tooltip: "Maximum distance from nearest hole to render. Controls the extent of the Voronoi-style heatmap." },
				fallbackDensity: { label: "Fallback Explosive Density", value: 1.2, min: 0.8, max: 1.6, step: 0.05, unit: "kg/L",
					tooltip: "Used when no charging data is available for a hole. Typical: ANFO 0.85, emulsion 1.15-1.25 kg/L." }
			};

		case "see":
			return {
				fallbackDensity: { label: "Fallback Explosive Density", value: 1.2, min: 0.8, max: 1.6, step: 0.05, unit: "kg/L",
					tooltip: "Explosive density when not available from charging products. SEE = 0.5 x density x VOD^2." },
				fallbackVOD: { label: "Fallback VOD", value: 5000, min: 3000, max: 8000, step: 100, unit: "m/s",
					tooltip: "Velocity of detonation when not available from charging products. Typical: ANFO 4500, emulsion 5500 m/s." },
				maxDisplayDistance: { label: "Max Display Distance", value: 50, min: 10, max: 500, step: 10, unit: "m",
					tooltip: "Maximum distance from nearest hole to render the heatmap." }
			};

		case "pressure":
			return {
				attenuationExponent: { label: "Attenuation Exponent (α)", value: 2.0, min: 1.0, max: 4.0, step: 0.1, unit: "",
					tooltip: "Geometric spreading exponent. 2.0 = cylindrical divergence (standard). Higher values = faster pressure decay." },
				fallbackDensity: { label: "Fallback Explosive Density", value: 1.2, min: 0.8, max: 1.6, step: 0.05, unit: "kg/L",
					tooltip: "Explosive density when not available from deck products. Borehole pressure Pb = density x VOD^2 / 8." },
				fallbackVOD: { label: "Fallback VOD", value: 5000, min: 3000, max: 8000, step: 100, unit: "m/s",
					tooltip: "Detonation velocity when not available from deck products. Higher VOD = higher borehole pressure." },
				numElements: { label: "Charge Elements", value: 20, min: 5, max: 64, step: 1, unit: "",
					tooltip: "Number of point sources per charge column. Higher = smoother pressure contours near the charge." },
				cutoffDistance: { label: "Min Distance", value: 0.3, min: 0.1, max: 2.0, step: 0.1, unit: "m",
					tooltip: "Minimum distance clamp. Prevents infinite pressure at zero distance from the charge axis." },
				maxDisplayDistance: { label: "Max Display Distance", value: 50, min: 10, max: 500, step: 10, unit: "m",
					tooltip: "Maximum distance from nearest deck to render. Pressure decays rapidly so large values may show little at the edge." }
			};

		case "powder_factor_vol":
			return {
				cutoffDistance: { label: "Min Distance", value: 0.3, min: 0.1, max: 2.0, step: 0.1, unit: "m",
					tooltip: "Minimum distance from deck segment. Prevents infinite powder factor at the charge surface." },
				maxDisplayDistance: { label: "Max Display Distance", value: 50, min: 10, max: 500, step: 10, unit: "m",
					tooltip: "Maximum distance from nearest deck to render. PF drops rapidly with distance (1/R^3)." }
			};

		case "jointed_rock":
			return {
				K_hp: { label: "H-P Constant K", value: 700, min: 100, max: 2000, step: 50, unit: "",
					tooltip: "Holmberg-Persson site constant for PPV estimation. Calibrate from near-field monitoring data." },
				alpha_hp: { label: "H-P Alpha (α)", value: 0.7, min: 0.3, max: 1.5, step: 0.05, unit: "",
					tooltip: "Charge mass exponent in H-P formula. Controls sensitivity to charge amount." },
				beta_hp: { label: "H-P Beta (β)", value: 1.5, min: 1.0, max: 2.5, step: 0.1, unit: "",
					tooltip: "Distance exponent in H-P formula. Controls PPV attenuation rate." },
				rockTensileStrength: { label: "Rock Tensile Strength", value: 10, min: 1, max: 50, step: 1, unit: "MPa",
					tooltip: "Intact rock tensile strength. Fracture ratio = dynamic stress / tensile strength. Typically UCS/10 to UCS/15." },
				rockDensity: { label: "Rock Density", value: 2700, min: 2000, max: 3500, step: 50, unit: "kg/m³",
					tooltip: "Rock mass density. Used to convert PPV to dynamic stress: sigma = density x Vp x PPV." },
				pWaveVelocity: { label: "P-Wave Velocity", value: 4500, min: 2000, max: 7000, step: 100, unit: "m/s",
					tooltip: "P-wave velocity for stress calculation. Higher Vp = higher dynamic stress for same PPV." },
				jointSetAngle: { label: "Joint Set Angle", value: 45, min: 0, max: 90, step: 5, unit: "°",
					tooltip: "Orientation of dominant joint set relative to blast wave direction (degrees). 45 deg maximises shear on joints." },
				jointCohesion: { label: "Joint Cohesion", value: 0.1, min: 0, max: 5.0, step: 0.1, unit: "MPa",
					tooltip: "Mohr-Coulomb cohesion of joints. Higher cohesion = more resistance to shear failure along joints." },
				jointFrictionAngle: { label: "Joint Friction Angle", value: 30, min: 10, max: 45, step: 1, unit: "°",
					tooltip: "Mohr-Coulomb friction angle of joint surfaces. Higher friction = more resistance to sliding. Typical 25-35 deg." },
				numElements: { label: "Charge Elements", value: 20, min: 5, max: 64, step: 1, unit: "",
					tooltip: "Sub-elements per deck for H-P integration. Higher = smoother damage contours." }
			};

		case "ppv_deck":
			return {
				K: { label: "Site Constant K", value: 1140, min: 100, max: 5000, step: 10, unit: "",
					tooltip: "Empirical site constant from blast monitoring. Same as PPV model but applied per-deck." },
				B: { label: "Site Exponent b", value: 1.6, min: 1.0, max: 2.5, step: 0.1, unit: "",
					tooltip: "Distance attenuation exponent. Controls PPV decay with scaled distance." },
				chargeExponent: { label: "Scaled Weight Exponent n", value: 0.5, min: 0.3, max: 0.8, step: 0.05, unit: "",
					tooltip: "Charge weight scaling exponent. 0.5 = square-root (standard SD)." },
				pWaveVelocity: { label: "P-Wave Velocity (0 = instant)", value: 0, min: 0, max: 7000, step: 100, unit: "m/s",
					tooltip: "Rock P-wave velocity for wave propagation animation. During time interaction, PPV ripples outward at this speed. 0 = instant (no travel time). Typical: 1600-4500 m/s." },
				targetPPV: { label: "Target PPV (0 = off)", value: 0, min: 0, max: 500, step: 5, unit: "mm/s",
					tooltip: "Draw a black contour line at this PPV value. 0 = disabled." },
				timeWindow: { label: "MIC Bin Width (0 = per-deck)", value: 0, min: 0, max: 500, step: 1, unit: "ms",
					tooltip: "Time bin width for MIC calculation. Decks firing in the same bin have their masses summed. 0 = each deck independent. Typical: 8-25 ms." },
				timeOffset: { label: "Bin Offset", value: 0, min: 0, max: 500, step: 1, unit: "ms",
					tooltip: "Shifts bin boundaries. E.g. 8ms bins with 4ms offset: edge bin [0,4), then [4,12), [12,20)..." },
				maxDisplayDistance: { label: "Max Display Distance", value: 200, min: 10, max: 1000, step: 10, unit: "m",
					tooltip: "Maximum distance from nearest deck to render. Limits the spatial extent of the heatmap." },
				cutoffDistance: { label: "Min Distance", value: 1.0, min: 0.1, max: 5.0, step: 0.1, unit: "m",
					tooltip: "Minimum distance clamp to avoid singularity at the charge axis." }
			};

		default:
			return {};
	}
}

/**
 * Extract parameter values from form data.
 *
 * @param {string} modelName - Model name
 * @returns {Object} - Parameter values
 */
function getModelParameters(modelName) {
	var params = {};
	var defaults = getDefaultParametersForModel(modelName);

	// Get values from form inputs
	for (var key in defaults) {
		if (defaults.hasOwnProperty(key)) {
			var input = document.querySelector('[name="param_' + key + '"]');
			if (input) {
				params[key] = parseFloat(input.value) || defaults[key].value;
			} else {
				params[key] = defaults[key].value;
			}
		}
	}

	return params;
}
