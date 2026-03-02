// src/helpers/BlastAnalysisShaderHelper.js
import * as THREE from "three";
import {
	getAvailableAnalyticsModels,
	getShaderMaterialForModel
} from "../draw/canvas3DDrawing.js";

import {
	showShaderAnalyticsLegend,
	hideShaderAnalyticsLegend
} from "../overlay/index.js";

import { ShaderTextureBaker } from "./ShaderTextureBaker.js";
import { exportAnalysisMeshToGLB } from "./AnalysisTextureRebuilder.js";
import { AddSurfaceAction } from "../tools/UndoActions.js";
import { ColourRampFactory } from "../shaders/core/ColourRampFactory.js";
import { prepareDeckDataTexture } from "../shaders/analytics/models/PowderFactorModel.js";

/**
 * BlastAnalysisShaderHelper manages blast analysis surfaces.
 *
 * Always creates a permanent surface with baked texture, registered via
 * AddSurfaceAction for undo support. Surfaces appear in TreeView and
 * persist to IndexedDB.
 *
 * Supports arbitrary surface orientations:
 * - Horizontal surfaces: bake pipeline with top-down camera (existing behavior)
 * - Non-horizontal surfaces: direct ShaderMaterial on mesh (bypasses bake UVs)
 *   + adaptive bake for 2D image
 */

/**
 * Model display names for surface naming.
 */
var MODEL_DISPLAY_NAMES = {
	ppv: "PPV",
	heelan_original: "Heelan Original",
	scaled_heelan: "Scaled Heelan",
	nonlinear_damage: "Nonlinear Damage",
	sdob: "SDoB",
	see: "SEE",
	pressure: "Borehole Pressure",
	powder_factor_vol: "Vol. Powder Factor",
	jointed_rock: "Jointed Rock Damage",
	ppv_deck: "PPV (Per-Deck)"
};

/**
 * Apply blast analysis shader — creates a permanent surface with baked texture.
 *
 * Detects surface orientation and routes to:
 * - Horizontal: existing bake pipeline (preserves current behavior)
 * - Non-horizontal: direct ShaderMaterial on mesh + adaptive bake for 2D
 *
 * @param {Object} config - { model, surfaceId, blastName, planePadding, params }
 */
export function applyBlastAnalysisShader(config) {
	if (!config || !config.model) {
		console.error("BlastAnalysisShaderHelper: Invalid config");
		return;
	}

	// Filter blast holes by selected entity
	var holes = getBlastHolesByEntity(config.blastName);

	if (!holes || holes.length === 0) {
		console.warn("BlastAnalysisShaderHelper: No holes found for blast: " + config.blastName);
		return;
	}

	// Build surface geometry (triangles + points)
	var surfaceData = buildAnalysisSurfaceData(config, holes);
	if (!surfaceData) {
		console.error("BlastAnalysisShaderHelper: Failed to build surface geometry");
		return;
	}

	// Prepare per-deck DataTexture from charging data — available for all models
	// Dispose previous DataTexture to prevent GPU memory leak
	if (config.params._deckData && config.params._deckData.texture) {
		config.params._deckData.texture.dispose();
	}
	config.params._deckData = prepareDeckDataTexture(holes);

	// Get shader material and bake to texture
	var shaderMaterial = getShaderMaterialForModel(config.model, holes, config.params);
	if (!shaderMaterial) {
		console.error("BlastAnalysisShaderHelper: Failed to create shader material");
		return;
	}

	// Calculate resolution from surface extent — keep GPU safe
	var bakeResolution = 2048;
	if (surfaceData.points && surfaceData.points.length > 0) {
		var bx = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
		for (var pi = 0; pi < surfaceData.points.length; pi++) {
			var pt = surfaceData.points[pi];
			if (pt.x < bx.minX) bx.minX = pt.x;
			if (pt.x > bx.maxX) bx.maxX = pt.x;
			if (pt.y < bx.minY) bx.minY = pt.y;
			if (pt.y > bx.maxY) bx.maxY = pt.y;
		}
		var extentMax = Math.max(bx.maxX - bx.minX, bx.maxY - bx.minY);
		var pxPerM = 5;
		bakeResolution = Math.min(Math.max(Math.ceil(extentMax * pxPerM), 512), 2048);
	}

	// Bake shader to texture (now auto-detects surface orientation)
	var bakeResult = ShaderTextureBaker.bakeShaderToTexture(surfaceData, shaderMaterial, {
		resolution: bakeResolution,
		padding: config.planePadding || 10
	});

	if (!bakeResult || !bakeResult.texture) {
		console.error("BlastAnalysisShaderHelper: Shader bake failed");
		return;
	}

	// Build permanent surface object
	var modelDisplayName = MODEL_DISPLAY_NAMES[config.model] || config.model;
	var uid4 = Math.random().toString(36).slice(2, 6); // 4-char uid for unique display names
	var surfaceId = "Analysis_" + config.model + "_" + Date.now();

	var surface = {
		id: surfaceId,
		name: "Analysis " + modelDisplayName + "_" + uid4,
		type: "triangulated",
		points: surfaceData.points,
		triangles: surfaceData.triangles,
		visible: true,
		gradient: "analysis",
		transparency: 1.0,
		isAnalysisSurface: true,
		analysisModelName: config.model,
		analysisBlastName: config.blastName,
		analysisParams: config.params,
		analysisTexture: bakeResult.texture,
		analysisCanvas: bakeResult.canvas,
		analysisUVBounds: bakeResult.uvBounds
	};

	// Add surface to loadedSurfaces directly (keeps non-serializable canvas/texture intact)
	if (window.loadedSurfaces) {
		window.loadedSurfaces.set(surfaceId, surface);
	}

	// Route based on surface orientation
	if (bakeResult.isHorizontal) {
		// Horizontal surface — existing bake pipeline (texture-mapped mesh)
		buildAndRegisterAnalysisMesh(surfaceId, surface, bakeResult);
	} else {
		// Non-horizontal surface — direct ShaderMaterial on mesh for 3D
		// Need a fresh shader material since the bake consumed one
		var directShaderMaterial = getShaderMaterialForModel(config.model, holes, config.params);
		if (directShaderMaterial) {
			buildDirectShaderAnalysisMesh(surfaceId, surface, directShaderMaterial, bakeResult);
		} else {
			// Fallback to bake path
			buildAndRegisterAnalysisMesh(surfaceId, surface, bakeResult);
		}
	}

	// Create flattened image for 2D rendering.
	// Vertical surfaces have near-zero XY extent so a top-down projection
	// produces no useful image — skip for those.
	if (!bakeResult.isVertical) {
		createFlattenedAnalysisImage(surfaceId, surface, bakeResult);
	}

	// Push undo action (without re-executing — surface is already added)
	if (window.undoManager) {
		var action = new AddSurfaceAction(surface);
		window.undoManager.pushAction(action);
	}

	// Update TreeView — do NOT set threeDataNeedsRebuild (that would
	// clearAllGeometry and destroy the analysis mesh we just registered)
	if (window.debouncedUpdateTreeView) {
		window.debouncedUpdateTreeView();
	}
	// Redraw 2D view (the 3D mesh is already in the scene)
	if (window.drawData) {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
	// Request a 3D render
	if (window.threeRenderer && window.threeRenderer.needsRender !== undefined) {
		window.threeRenderer.needsRender = true;
	}

	// Show legend
	var legendInfo = getShaderLegendInfo(config.model);
	showShaderAnalyticsLegend(
		legendInfo.title,
		legendInfo.minVal,
		legendInfo.maxVal,
		legendInfo.colorStops
	);

	console.log("Blast analysis surface created: " + surfaceId + " (" + config.model +
		" on " + holes.length + " holes, " +
		(bakeResult.isHorizontal ? "horizontal bake" : "direct shader") + ")");
}

/**
 * Build surface geometry data for analysis — either from existing surface or generated plane.
 *
 * @param {Object} config - { surfaceId, planePadding }
 * @param {Array} holes - Blast holes
 * @returns {Object|null} - { points, triangles } or null
 */
function buildAnalysisSurfaceData(config, holes) {
	// If using an existing surface, deep-copy its triangles and points
	if (config.surfaceId && config.surfaceId !== "__PLANE__" && window.loadedSurfaces) {
		var existingSurface = window.loadedSurfaces.get(config.surfaceId);
		if (existingSurface && existingSurface.triangles && existingSurface.triangles.length > 0) {
			return {
				points: JSON.parse(JSON.stringify(existingSurface.points)),
				triangles: JSON.parse(JSON.stringify(existingSurface.triangles))
			};
		}
	}

	// Generate analysis plane from hole bounds
	var bounds = calculateHoleBounds(holes);
	var padding = config.planePadding || 200;
	var planeZ = (window.drawingZLevel !== undefined && isFinite(window.drawingZLevel) && window.drawingZLevel !== 0)
		? window.drawingZLevel
		: calculateAverageCollarZ(holes);

	var minX = bounds.minX - padding;
	var maxX = bounds.maxX + padding;
	var minY = bounds.minY - padding;
	var maxY = bounds.maxY + padding;

	// Two triangles forming a quad (inline vertex format — required by 2D renderer + IndexedDB)
	var p0 = { x: minX, y: minY, z: planeZ };
	var p1 = { x: maxX, y: minY, z: planeZ };
	var p2 = { x: maxX, y: maxY, z: planeZ };
	var p3 = { x: minX, y: maxY, z: planeZ };
	var points = [p0, p1, p2, p3];
	var triangles = [
		{ vertices: [p0, p1, p2] },
		{ vertices: [p0, p2, p3] }
	];

	return { points: points, triangles: triangles };
}

/**
 * Build a textured analysis mesh directly and register it in the scene.
 * Used for horizontal surfaces — bakes texture and applies planar UVs.
 *
 * @param {string} surfaceId - Surface ID
 * @param {Object} surface - Surface object with triangles/points
 * @param {Object} bakeResult - { texture, canvas, uvBounds, projectionBasis, center3D, isHorizontal }
 */
function buildAndRegisterAnalysisMesh(surfaceId, surface, bakeResult) {
	if (!window.threeRenderer || !surface.triangles || surface.triangles.length === 0) {
		return;
	}

	// Build BufferGeometry directly with positions + UVs (no vertex colors)
	var triCount = surface.triangles.length;
	var positions = new Float32Array(triCount * 9); // 3 verts x 3 coords
	var uvs = new Float32Array(triCount * 6);       // 3 verts x 2 UV coords

	var uvBounds = bakeResult.uvBounds;
	var uvW = uvBounds.maxU - uvBounds.minU;
	var uvH = uvBounds.maxV - uvBounds.minV;

	for (var i = 0; i < triCount; i++) {
		var tri = surface.triangles[i];
		var verts = ShaderTextureBaker._resolveTriangleVertices(tri, surface.points);
		if (!verts) continue;

		for (var j = 0; j < 3; j++) {
			var v = verts[j];
			var local = window.worldToThreeLocal(v.x, v.y);

			// Position in local Three.js space
			positions[i * 9 + j * 3]     = local.x;
			positions[i * 9 + j * 3 + 1] = local.y;
			positions[i * 9 + j * 3 + 2] = v.z;

			// Planar UV from world XY — matches the top-down bake camera
			uvs[i * 6 + j * 2]     = (v.x - uvBounds.minU) / uvW;
			uvs[i * 6 + j * 2 + 1] = (v.y - uvBounds.minV) / uvH;
		}
	}

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
	geometry.computeVertexNormals();

	// Texture-only material
	var material = new THREE.MeshBasicMaterial({
		map: bakeResult.texture,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: surface.transparency || 1.0
	});

	var mesh = new THREE.Mesh(geometry, material);
	mesh.userData = { type: "surface", surfaceId: surfaceId, isAnalysisSurface: true };

	// Register in scene and surfaceMeshMap
	window.threeRenderer.surfacesGroup.add(mesh);
	window.threeRenderer.surfaceMeshMap.set(surfaceId, mesh);

	// Export to GLB for IndexedDB persistence
	exportAnalysisMeshToGLB(mesh).then(function(glbData) {
		if (glbData) {
			surface.analysisGLB = glbData;
			console.log("GLB export for analysis: " + (glbData.byteLength / 1024).toFixed(1) + " KB");
		}
		if (window.saveSurfaceToDB) {
			window.saveSurfaceToDB(surfaceId);
		}
	}).catch(function(err) {
		console.warn("GLB export failed:", err);
		if (window.saveSurfaceToDB) {
			window.saveSurfaceToDB(surfaceId);
		}
	});

	console.log("Built and registered texture-mapped analysis mesh for " + surfaceId);
}

/**
 * Build a direct ShaderMaterial analysis mesh for non-horizontal surfaces.
 *
 * Instead of baking to texture and applying UVs, this applies the ShaderMaterial
 * directly to the mesh geometry. The fragment shader computes per-pixel values from
 * vWorldPos, which works for ANY surface orientation — no UVs needed.
 *
 * @param {string} surfaceId - Surface ID
 * @param {Object} surface - Surface object with triangles/points
 * @param {THREE.ShaderMaterial} shaderMaterial - Configured shader material
 * @param {Object} bakeResult - { center3D } for world offset
 */
function buildDirectShaderAnalysisMesh(surfaceId, surface, shaderMaterial, bakeResult) {
	if (!window.threeRenderer || !surface.triangles || surface.triangles.length === 0) {
		return;
	}

	var triCount = surface.triangles.length;
	var positions = new Float32Array(triCount * 9);
	var idx = 0;

	// Compute centroid for local space offset
	var center = bakeResult.center3D || { x: 0, y: 0, z: 0 };

	// Use worldToThreeLocal for XY, keep Z as-is (same as other surfaces in scene)
	for (var i = 0; i < triCount; i++) {
		var tri = surface.triangles[i];
		var verts = ShaderTextureBaker._resolveTriangleVertices(tri, surface.points);
		if (!verts) continue;

		for (var j = 0; j < 3; j++) {
			var v = verts[j];
			var local = window.worldToThreeLocal(v.x, v.y);

			positions[idx++] = local.x;
			positions[idx++] = local.y;
			positions[idx++] = v.z;
		}
	}

	// Trim if some triangles were skipped
	var trimmedPositions = idx < positions.length ? positions.subarray(0, idx) : positions;

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(trimmedPositions, 3));
	geometry.computeVertexNormals();

	// Set uWorldOffset so the shader can reconstruct world positions.
	// The mesh vertices are in Three.js local space (world - threeLocalOrigin).
	// So uWorldOffset = threeLocalOrigin so that:
	// vWorldPos = localPos + uWorldOffset = (worldXY - originXY) + originXY = worldXY
	var originX = window.threeLocalOriginX || 0;
	var originY = window.threeLocalOriginY || 0;
	// Z stays at the surface center for precision
	if (shaderMaterial.uniforms && shaderMaterial.uniforms.uWorldOffset) {
		shaderMaterial.uniforms.uWorldOffset.value.set(originX, originY, 0);
	}

	// Configure shader material for mesh rendering
	shaderMaterial.side = THREE.DoubleSide;
	shaderMaterial.transparent = true;

	var mesh = new THREE.Mesh(geometry, shaderMaterial);
	mesh.userData = {
		type: "surface",
		surfaceId: surfaceId,
		isAnalysisSurface: true,
		isDirectShader: true
	};

	// Register in scene and surfaceMeshMap
	window.threeRenderer.surfacesGroup.add(mesh);
	window.threeRenderer.surfaceMeshMap.set(surfaceId, mesh);

	// For direct shader meshes, GLB export may not capture shader —
	// save surface data for re-creation on reload
	surface.isDirectShaderAnalysis = true;
	if (window.saveSurfaceToDB) {
		window.saveSurfaceToDB(surfaceId).catch(function(err) {
			console.error("Failed to save direct shader analysis surface:", err);
		});
	}

	console.log("Built and registered direct shader analysis mesh for " + surfaceId +
		" (" + (idx / 9) + " triangles)");
}

/**
 * Create a flattened image from the baked analysis canvas and register it
 * in loadedImages for 2D rendering. Also stores data URL on the surface
 * for IndexedDB persistence (same pattern as textured OBJ flattening).
 *
 * @param {string} surfaceId - Surface ID
 * @param {Object} surface - Surface object
 * @param {Object} bakeResult - { texture, canvas, uvBounds }
 */
function createFlattenedAnalysisImage(surfaceId, surface, bakeResult) {
	var texCanvas = bakeResult.canvas;
	var uvBounds = bakeResult.uvBounds;
	if (!texCanvas || !uvBounds) return;

	var imageId = "flattened_" + surfaceId;
	var meshBounds = {
		minX: uvBounds.minU,
		maxX: uvBounds.maxU,
		minY: uvBounds.minV,
		maxY: uvBounds.maxV,
		minZ: surface.points && surface.points.length > 0 ? surface.points[0].z : 0,
		maxZ: surface.points && surface.points.length > 0 ? surface.points[0].z : 0
	};
	var worldWidth = meshBounds.maxX - meshBounds.minX;
	var worldHeight = meshBounds.maxY - meshBounds.minY;

	// The bake camera is top-down Y-up, and drawImage from WebGL canvas
	// preserves HTML canvas convention: row 0 = top = North.
	// drawBackgroundImage maps bbox maxY (North) to screen top, drawing
	// canvas row 0 there — no flip needed.

	// Convert canvas to data URL for IndexedDB persistence
	var imageDataURL = texCanvas.toDataURL("image/png");

	// Store on surface for saveSurfaceToDB
	surface.flattenedImageDataURL = imageDataURL;
	surface.flattenedImageBounds = meshBounds;
	surface.flattenedImageDimensions = { width: texCanvas.width, height: texCanvas.height };

	// Register in loadedImages for immediate 2D rendering
	var imageEntry = {
		id: imageId,
		name: surface.name + "_flattened",
		canvas: texCanvas,
		bbox: [meshBounds.minX, meshBounds.minY, meshBounds.maxX, meshBounds.maxY],
		width: texCanvas.width,
		height: texCanvas.height,
		visible: true,
		transparency: surface.transparency || 1.0,
		zElevation: meshBounds.minZ || 0,
		isGeoReferenced: true,
		bounds: {
			minX: meshBounds.minX,
			maxX: meshBounds.maxX,
			minY: meshBounds.minY,
			maxY: meshBounds.maxY
		},
		pixelWidth: worldWidth / texCanvas.width,
		pixelHeight: worldHeight / texCanvas.height,
		sourceType: "flattened_analysis",
		sourceSurfaceId: surfaceId
	};

	if (window.loadedImages) {
		window.loadedImages.set(imageId, imageEntry);
	}

	// Save to IndexedDB (with the flattenedImageDataURL now stored)
	if (window.saveSurfaceToDB) {
		window.saveSurfaceToDB(surfaceId).catch(function(err) {
			console.error("Failed to save analysis surface to IndexedDB:", err);
		});
	}

	console.log("Created flattened analysis image: " + imageId + " (" + texCanvas.width + "x" + texCanvas.height + ")");
}

/**
 * Get legend information for a shader model.
 * Dynamically samples colours from ColourRampFactory.RAMPS.
 *
 * @param {string} modelName - Model name
 * @returns {Object} - { title, minVal, maxVal, colorStops }
 */
function getShaderLegendInfo(modelName) {
	var models = {
		ppv: { title: "PPV (mm/s)", ramp: "ppv", min: 0, max: 200 },
		heelan_original: { title: "PPV (mm/s)", ramp: "jet", min: 0, max: 300 },
		scaled_heelan: { title: "PPV (mm/s)", ramp: "jet", min: 0, max: 300 },
		nonlinear_damage: { title: "Damage Index", ramp: "damage", min: 0, max: 1 },
		sdob: { title: "SDoB (m/kg^1/3)", ramp: "sdob", min: 0, max: 3 },
		see: { title: "SEE (GJ/m³)", ramp: "jet", min: 0, max: 25 },
		pressure: { title: "Pressure (MPa)", ramp: "pressure", min: 0, max: 100 },
		powder_factor_vol: { title: "Powder Factor (kg/m³) [log]", ramp: "spectrum", min: 0.01, max: 100 },
		jointed_rock: { title: "Damage Ratio", ramp: "damage", min: 0, max: 2 },
		ppv_deck: { title: "PPV (mm/s)", ramp: "ppv", min: 0, max: 200 }
	};
	var info = models[modelName] || models.ppv;
	var stops = ColourRampFactory.RAMPS[info.ramp] || ColourRampFactory.RAMPS["jet"];

	// Sample 5 colours at positions 0, 0.25, 0.5, 0.75, 1.0
	var colorStops = [];
	for (var i = 0; i < 5; i++) {
		var t = i / 4;
		var rgb = ColourRampFactory._interpolate(stops, t);
		colorStops.push({
			pos: t,
			color: "rgb(" + Math.round(rgb[0] * 255) + "," + Math.round(rgb[1] * 255) + "," + Math.round(rgb[2] * 255) + ")"
		});
	}

	// For log-scale models, provide custom tick labels at log-spaced positions
	if (modelName === "powder_factor_vol") {
		// Log10 scale: min=0.01 (-2), max=100 (+2), range=4 decades
		// Tick positions in normalized log space:
		//   0    → log10(0.01) = -2 → pos = 0.0
		//   1    → log10(1)    =  0 → pos = 0.5
		//   10   → log10(10)   =  1 → pos = 0.75
		//   100  → log10(100)  =  2 → pos = 1.0
		colorStops.tickValues = [
			{ value: 0, pos: 0.0, label: "0" },
			{ value: 1, pos: 0.5, label: "1" },
			{ value: 10, pos: 0.75, label: "10" },
			{ value: 100, pos: 1.0, label: "100" }
		];
	}

	return { title: info.title, minVal: info.min, maxVal: info.max, colorStops: colorStops };
}

/**
 * Clear blast analysis legend overlay.
 * Surface removal is handled via TreeView delete or undo.
 */
export function clearBlastAnalysisShader() {
	hideShaderAnalyticsLegend();
	clearFlattenedAnalysis();
	console.log("Blast analysis legend cleared");
}

/**
 * Get available analytics models for the dialog.
 *
 * @returns {Array} - Array of { name, displayName, unit }
 */
export function getAnalyticsModels() {
	return getAvailableAnalyticsModels();
}

/**
 * Filter blast holes by entity name.
 *
 * @param {string} blastName - Entity name or "__ALL__" for all holes
 * @returns {Array} - Filtered blast holes
 */
function getBlastHolesByEntity(blastName) {
	if (!window.allBlastHoles || window.allBlastHoles.length === 0) {
		return [];
	}

	if (blastName === "__ALL__") {
		return window.allBlastHoles;
	}

	return window.allBlastHoles.filter(function(hole) {
		return hole.entityName === blastName;
	});
}

/**
 * Calculate bounding box for holes.
 *
 * @param {Array} holes - Blast holes
 * @returns {Object} - { minX, maxX, minY, maxY }
 */
function calculateHoleBounds(holes) {
	var bounds = {
		minX: Infinity, maxX: -Infinity,
		minY: Infinity, maxY: -Infinity
	};

	holes.forEach(function(hole) {
		if (hole.startXLocation < bounds.minX) bounds.minX = hole.startXLocation;
		if (hole.startXLocation > bounds.maxX) bounds.maxX = hole.startXLocation;
		if (hole.startYLocation < bounds.minY) bounds.minY = hole.startYLocation;
		if (hole.startYLocation > bounds.maxY) bounds.maxY = hole.startYLocation;
	});

	return bounds;
}

/**
 * Calculate average collar Z elevation.
 *
 * @param {Array} holes - Blast holes
 * @returns {number} - Average Z
 */
function calculateAverageCollarZ(holes) {
	var sum = 0;
	holes.forEach(function(hole) {
		sum += hole.startZLocation || 0;
	});
	return holes.length > 0 ? sum / holes.length : 0;
}

/**
 * Update shader when holes change (reactive update).
 * Called during drag operations.
 *
 * @param {number} index - Hole index in allBlastHoles
 * @param {Object} hole - Updated hole object
 */
export function updateShaderForHoleChange(index, hole) {
	if (!window.blastAnalyticsSettings || !window.blastAnalyticsSettings.model) {
		return; // No active shader
	}

	// Import and call update function
	import("../draw/canvas3DDrawing.js").then(function(module) {
		if (module.updateBlastAnalyticsSingleHole) {
			module.updateBlastAnalyticsSingleHole(index, hole, {
				useToeLocation: false
			});
		}
	});
}

/**
 * Refresh shader when charging data changes.
 * Requires full repack of hole data.
 */
export function refreshShaderForChargingChange() {
	if (!window.blastAnalyticsSettings) {
		return; // No active shader
	}

	// Re-apply with current settings
	applyBlastAnalysisShader(window.blastAnalyticsSettings);
}

/**
 * Export flattened shader to 2D canvas.
 *
 * @param {number} pixelsPerMetre - Resolution
 * @returns {Object} - { canvas, bounds, width, height } or null
 */
export function exportShaderTo2D(pixelsPerMetre) {
	if (!window.blastAnalyticsSettings || !window.blastAnalyticsSettings.model) {
		return null;
	}

	return import("../draw/canvas3DDrawing.js").then(function(module) {
		if (module.flattenBlastAnalytics) {
			return module.flattenBlastAnalytics(pixelsPerMetre || 2.0);
		}
		return null;
	});
}

/**
 * Flatten the current analysis shader to a 2D canvas and store globally
 * for overlay rendering in the 2D view and GeoTIFF export.
 *
 * @param {number} pixelsPerMetre - Resolution (default 1.0)
 */
export function flattenAnalysisTo2D(pixelsPerMetre) {
	pixelsPerMetre = pixelsPerMetre || 1.0;

	import("../draw/canvas3DDrawing.js").then(function(module) {
		if (!module.flattenBlastAnalytics) return;

		var result = module.flattenBlastAnalytics(pixelsPerMetre);
		if (result && result.canvas) {
			window.blastAnalyticsFlattenedCanvas = result.canvas;
			window.blastAnalyticsFlattenedBounds = result.bounds; // [minX, minY, maxX, maxY]
			console.log("Analysis flattened to 2D: " + result.width + "x" + result.height + " px");

			// Redraw 2D to show overlay
			if (window.drawData) {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		}
	}).catch(function(err) {
		console.warn("Failed to flatten analysis to 2D:", err);
	});
}

/**
 * Clear the flattened analysis overlay from 2D view.
 */
export function clearFlattenedAnalysis() {
	window.blastAnalyticsFlattenedCanvas = null;
	window.blastAnalyticsFlattenedBounds = null;
}

/**
 * Bake the current live shader state to a 2D image for canvas rendering.
 * Creates/updates a flattened image entry in loadedImages and redraws 2D.
 *
 * @param {string} liveSurfaceId - ID of the live analysis surface
 * @param {Object} config - { model, blastName, params, surfaceId, planePadding }
 * @returns {string|null} - The flattened image ID, or null on failure
 */
// Cached state for live 2D bake — reused across debounced calls to avoid
// creating new DataTextures and CanvasTextures every 200ms during playback.
var _liveBakeCache = {
	deckData: null,         // { texture, count, width } — reused between bakes
	surfaceData: null,      // Cached surface geometry (doesn't change during playback)
	bakeResolution: 1024,   // Cached resolution
	lastSurfaceId: null     // Track which surface we cached for
};

export function bakeLiveShaderTo2D(liveSurfaceId, config) {
	if (!config || !config.model) return null;

	var holes = getBlastHolesByEntity(config.blastName);
	if (!holes || holes.length === 0) return null;

	// Reuse cached surface data if same surface (geometry doesn't change during playback)
	var surfaceData;
	if (_liveBakeCache.lastSurfaceId === liveSurfaceId && _liveBakeCache.surfaceData) {
		surfaceData = _liveBakeCache.surfaceData;
	} else {
		surfaceData = buildAnalysisSurfaceData(config, holes);
		if (!surfaceData) return null;
		_liveBakeCache.surfaceData = surfaceData;
		_liveBakeCache.lastSurfaceId = liveSurfaceId;

		// Calculate bake resolution once
		var bakeResolution = 1024;
		if (surfaceData.points && surfaceData.points.length > 0) {
			var bx = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
			for (var pi = 0; pi < surfaceData.points.length; pi++) {
				var pt = surfaceData.points[pi];
				if (pt.x < bx.minX) bx.minX = pt.x;
				if (pt.x > bx.maxX) bx.maxX = pt.x;
				if (pt.y < bx.minY) bx.minY = pt.y;
				if (pt.y > bx.maxY) bx.maxY = pt.y;
			}
			var extentMax = Math.max(bx.maxX - bx.minX, bx.maxY - bx.minY);
			var pxPerM = 5; // Low resolution for live playback bake (speed + GPU safety)
			bakeResolution = Math.min(Math.max(Math.ceil(extentMax * pxPerM), 512), 1024);
		}
		_liveBakeCache.bakeResolution = bakeResolution;
	}

	// Get shader material (singleton — no leak) and set displayTime
	var shaderMaterial = getShaderMaterialForModel(config.model, holes, config.params);
	if (!shaderMaterial) return null;

	if (config.params && config.params.displayTime !== undefined) {
		if (shaderMaterial.uniforms && shaderMaterial.uniforms.uDisplayTime) {
			shaderMaterial.uniforms.uDisplayTime.value = config.params.displayTime;
		}
	}

	// Bake shader to texture
	var bakeResult = ShaderTextureBaker.bakeShaderToTexture(surfaceData, shaderMaterial, {
		resolution: _liveBakeCache.bakeResolution,
		padding: config.planePadding || 10
	});

	if (!bakeResult || !bakeResult.canvas) return null;

	// Dispose the CanvasTexture — we only need the 2D canvas for rendering,
	// the Three.js texture is not used for the 2D flattened image
	if (bakeResult.texture) {
		bakeResult.texture.dispose();
	}

	// Create/update flattened image for 2D rendering
	var imageId = "flattened_live_" + liveSurfaceId;
	var uvBounds = bakeResult.uvBounds;
	var texCanvas = bakeResult.canvas;
	var worldWidth = uvBounds.maxU - uvBounds.minU;
	var worldHeight = uvBounds.maxV - uvBounds.minV;

	var imageEntry = {
		id: imageId,
		name: "Live Analysis 2D",
		canvas: texCanvas,
		bbox: [uvBounds.minU, uvBounds.minV, uvBounds.maxU, uvBounds.maxV],
		width: texCanvas.width,
		height: texCanvas.height,
		visible: true,
		transparency: 1.0,
		zElevation: 0,
		isGeoReferenced: true,
		bounds: {
			minX: uvBounds.minU,
			maxX: uvBounds.maxU,
			minY: uvBounds.minV,
			maxY: uvBounds.maxV
		},
		pixelWidth: worldWidth / texCanvas.width,
		pixelHeight: worldHeight / texCanvas.height,
		sourceType: "flattened_live_analysis",
		sourceSurfaceId: liveSurfaceId
	};

	if (window.loadedImages) {
		window.loadedImages.set(imageId, imageEntry);
	}

	// Redraw 2D view
	if (window.drawData) {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}

	return imageId;
}

/**
 * Remove a live flattened analysis image from 2D view.
 *
 * @param {string} liveSurfaceId - Live surface ID
 */
export function removeLiveFlattenedImage(liveSurfaceId) {
	if (!liveSurfaceId) return;
	var imageId = "flattened_live_" + liveSurfaceId;
	if (window.loadedImages) {
		window.loadedImages.delete(imageId);
	}
	// Redraw 2D
	if (window.drawData) {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
}

/**
 * Apply a LIVE (non-baked) analysis shader to a surface mesh.
 * The ShaderMaterial remains active so uniforms (like uDisplayTime) can
 * be updated in real-time by the TimeInteractionDialog slider.
 *
 * Call applyBlastAnalysisShader() later to bake a permanent snapshot.
 *
 * @param {Object} config - { model, surfaceId, blastName, planePadding, params }
 * @returns {Object|null} - { surfaceId, shaderMaterial, mesh } or null on failure
 */
export function applyLiveAnalysisShader(config) {
	if (!config || !config.model) {
		console.error("applyLiveAnalysisShader: Invalid config");
		return null;
	}

	var holes = getBlastHolesByEntity(config.blastName);
	if (!holes || holes.length === 0) {
		console.warn("applyLiveAnalysisShader: No holes for blast: " + config.blastName);
		return null;
	}

	// Ensure cumulative firing times are computed before packing into DataTexture.
	// calculateTimes() sets hole.holeTime which the shader uses for time filtering.
	if (window.calculateTimes && window.allBlastHoles) {
		window.calculateTimes(window.allBlastHoles);
	}

	var surfaceData = buildAnalysisSurfaceData(config, holes);
	if (!surfaceData) {
		console.error("applyLiveAnalysisShader: Failed to build surface geometry");
		return null;
	}

	// Prepare per-deck DataTexture from charging data — available for all models
	// Dispose previous DataTexture to prevent GPU memory leak
	if (config.params._deckData && config.params._deckData.texture) {
		config.params._deckData.texture.dispose();
	}
	config.params._deckData = prepareDeckDataTexture(holes);

	var shaderMaterial = getShaderMaterialForModel(config.model, holes, config.params);
	if (!shaderMaterial) {
		console.error("applyLiveAnalysisShader: Failed to create shader material");
		return null;
	}

	// Ensure uDisplayTime = -1 (show all time initially)
	if (shaderMaterial.uniforms && shaderMaterial.uniforms.uDisplayTime) {
		shaderMaterial.uniforms.uDisplayTime.value = -1.0;
	}

	// Build a temporary surface ID for the live preview
	var surfaceId = "LiveAnalysis_" + config.model + "_" + Date.now();

	var surface = {
		id: surfaceId,
		name: "Live " + (MODEL_DISPLAY_NAMES[config.model] || config.model),
		type: "triangulated",
		points: surfaceData.points,
		triangles: surfaceData.triangles,
		visible: true,
		gradient: "analysis",
		transparency: 1.0,
		isAnalysisSurface: true,
		isLiveAnalysis: true,
		analysisModelName: config.model,
		analysisBlastName: config.blastName,
		analysisParams: config.params
	};

	if (window.loadedSurfaces) {
		window.loadedSurfaces.set(surfaceId, surface);
	}

	// Build mesh with live ShaderMaterial (reuses buildDirectShaderAnalysisMesh logic)
	if (!window.threeRenderer || !surface.triangles || surface.triangles.length === 0) {
		return null;
	}

	var triCount = surface.triangles.length;
	var positions = new Float32Array(triCount * 9);
	var idx = 0;

	for (var i = 0; i < triCount; i++) {
		var tri = surface.triangles[i];
		var verts = ShaderTextureBaker._resolveTriangleVertices(tri, surface.points);
		if (!verts) continue;
		for (var j = 0; j < 3; j++) {
			var v = verts[j];
			var local = window.worldToThreeLocal(v.x, v.y);
			positions[idx++] = local.x;
			positions[idx++] = local.y;
			positions[idx++] = v.z;
		}
	}

	var trimmedPositions = idx < positions.length ? positions.subarray(0, idx) : positions;
	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(trimmedPositions, 3));
	geometry.computeVertexNormals();

	// Set uWorldOffset for world-space reconstruction in shader
	var originX = window.threeLocalOriginX || 0;
	var originY = window.threeLocalOriginY || 0;
	if (shaderMaterial.uniforms && shaderMaterial.uniforms.uWorldOffset) {
		shaderMaterial.uniforms.uWorldOffset.value.set(originX, originY, 0);
	}

	shaderMaterial.side = THREE.DoubleSide;
	shaderMaterial.transparent = true;

	var mesh = new THREE.Mesh(geometry, shaderMaterial);
	mesh.userData = { type: "surface", surfaceId: surfaceId, isAnalysisSurface: true, isLiveAnalysis: true };

	window.threeRenderer.surfacesGroup.add(mesh);
	window.threeRenderer.surfaceMeshMap.set(surfaceId, mesh);
	window.threeRenderer.needsRender = true;

	// Show legend
	var legendInfo = getShaderLegendInfo(config.model);
	showShaderAnalyticsLegend(legendInfo.title, legendInfo.minVal, legendInfo.maxVal, legendInfo.colorStops);

	console.log("Live analysis shader applied: " + surfaceId + " (" + config.model + ")");

	return {
		surfaceId: surfaceId,
		shaderMaterial: shaderMaterial,
		mesh: mesh
	};
}

/**
 * Remove a live analysis surface (cleanup after time interaction).
 *
 * @param {string} surfaceId - Live surface ID to remove
 */
export function removeLiveAnalysisSurface(surfaceId) {
	if (!surfaceId) return;

	// Remove from 3D scene and dispose GPU resources
	if (window.threeRenderer && window.threeRenderer.surfaceMeshMap) {
		var mesh = window.threeRenderer.surfaceMeshMap.get(surfaceId);
		if (mesh) {
			if (mesh.parent) mesh.parent.remove(mesh);
			// Dispose geometry and materials to free GPU memory
			mesh.traverse(function (child) {
				if (child.geometry) child.geometry.dispose();
				if (child.material) {
					// Dispose textures attached to the material
					if (child.material.map) child.material.map.dispose();
					if (child.material.uniforms) {
						// Dispose DataTextures in shader uniforms (uHoleData, _deckData)
						for (var key in child.material.uniforms) {
							var uVal = child.material.uniforms[key].value;
							if (uVal && typeof uVal.dispose === "function" && uVal.isTexture) {
								uVal.dispose();
							}
						}
					}
					child.material.dispose();
				}
			});
		}
		window.threeRenderer.surfaceMeshMap.delete(surfaceId);
		window.threeRenderer.needsRender = true;
	}

	// Dispose analysisTexture stored on the surface object
	if (window.loadedSurfaces) {
		var surface = window.loadedSurfaces.get(surfaceId);
		if (surface && surface.analysisTexture) {
			surface.analysisTexture.dispose();
			surface.analysisTexture = null;
		}
		window.loadedSurfaces.delete(surfaceId);
	}

	// Clear live bake cache
	if (_liveBakeCache.lastSurfaceId === surfaceId) {
		_liveBakeCache.surfaceData = null;
		_liveBakeCache.lastSurfaceId = null;
	}

	// Hide legend
	hideShaderAnalyticsLegend();

	console.log("Removed live analysis surface: " + surfaceId);
}

/**
 * Re-bake all permanent (non-live) analysis surfaces with current timing data.
 * Called when hole timing changes (delay edits, connector adds/removes) so that
 * baked shader textures reflect the updated firing sequence.
 */
export function rebakeAnalysisSurfaces() {
	if (!window.loadedSurfaces || !window.threeRenderer) return;

	window.loadedSurfaces.forEach(function(surface, surfaceId) {
		// Only re-bake permanent analysis surfaces (not live shader surfaces)
		if (!surface.isAnalysisSurface || surface.isLiveAnalysis) return;
		if (!surface.analysisModelName) return;

		var blastName = surface.analysisBlastName || "__ALL__";
		var holes = getBlastHolesByEntity(blastName);
		if (!holes || holes.length === 0) return;

		// Prepare per-deck DataTexture (dispose old to prevent GPU leak)
		var params = Object.assign({}, surface.analysisParams || {});
		if (params._deckData && params._deckData.texture) {
			params._deckData.texture.dispose();
		}
		params._deckData = prepareDeckDataTexture(holes);

		// Fresh shader material with current hole timing
		var shaderMaterial = getShaderMaterialForModel(
			surface.analysisModelName, holes, params
		);
		if (!shaderMaterial) return;

		// Calculate bake resolution from surface extent
		var bakeResolution = 2048;
		if (surface.points && surface.points.length > 0) {
			var bx = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
			for (var pi = 0; pi < surface.points.length; pi++) {
				var pt = surface.points[pi];
				if (pt.x < bx.minX) bx.minX = pt.x;
				if (pt.x > bx.maxX) bx.maxX = pt.x;
				if (pt.y < bx.minY) bx.minY = pt.y;
				if (pt.y > bx.maxY) bx.maxY = pt.y;
			}
			var extentMax = Math.max(bx.maxX - bx.minX, bx.maxY - bx.minY);
			bakeResolution = Math.min(Math.max(Math.ceil(extentMax * 5), 512), 2048);
		}

		// Re-bake
		var bakeResult = ShaderTextureBaker.bakeShaderToTexture(
			{ points: surface.points, triangles: surface.triangles },
			shaderMaterial,
			{ resolution: bakeResolution, padding: 10 }
		);
		if (!bakeResult || !bakeResult.texture) return;

		// Update 3D mesh texture in-place
		var mesh = window.threeRenderer.surfaceMeshMap.get(surfaceId);
		if (mesh) {
			mesh.traverse(function(child) {
				if (child.isMesh && child.material) {
					if (child.material.map) child.material.map.dispose();
					child.material.map = bakeResult.texture;
					child.material.needsUpdate = true;
				}
			});
		}

		// Update surface object
		if (surface.analysisTexture) surface.analysisTexture.dispose();
		surface.analysisTexture = bakeResult.texture;
		surface.analysisCanvas = bakeResult.canvas;

		// Update flattened 2D image if it exists
		var imageId = "flattened_" + surfaceId;
		if (window.loadedImages && window.loadedImages.has(imageId)) {
			var imageEntry = window.loadedImages.get(imageId);
			imageEntry.canvas = bakeResult.canvas;
		}

		console.log("Re-baked analysis surface: " + surfaceId);
	});

	// Request 3D render
	if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Register rebake function on window so kirra.js onTimingChanged() can call it
window._rebakeAnalysisSurfaces = rebakeAnalysisSurfaces;
