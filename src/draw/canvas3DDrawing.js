/* prettier-ignore-file */
//=================================================
// canvas3DDrawing.js - Three.js Drawing Functions
//=================================================
// All Three.js/WebGL drawing functions extracted from kirra.js
// This module handles 3D rendering using Three.js

import * as THREE from "three";
import { GeometryFactory } from "../three/GeometryFactory.js";
import { buildMassLabels } from "./canvas2DDrawing.js";
import { BlastAnalyticsShader } from "../shaders/analytics/BlastAnalyticsShader.js";
import { calculateDownholeTimings, getTimingRange, fireTimeToColor, normalizeFireTime } from "../helpers/DownholeTimingCalculator.js";
import { rebuildAnalysisFromGLB } from "../helpers/AnalysisTextureRebuilder.js";
import { chargingKey } from "../charging/HoleCharging.js";

//=================================================
// 3D ANALYSIS CACHE - Prevents rebuilding geometry every frame
//=================================================
// Step 0.1) Version tracking for 3D caching
// 3D geometry should ONLY be rebuilt when data actually changes
var voronoi3DCache = {
	dataVersion: -1,
	metric: null,
	useToeLocation: null,
	exists: false
};

var slope3DCache = {
	dataVersion: -1,
	exists: false
};

var relief3DCache = {
	dataVersion: -1,
	exists: false
};

/**
 * Step 0.2) Check if 3D Voronoi needs to be rebuilt
 * Returns true if we should skip rebuilding
 */
function shouldSkipVoronoi3DRebuild(metric, useToeLocation) {
	// Get current data version from AnalysisCache module
	var currentVersion = window.analysisDataVersion || 0;

	if (voronoi3DCache.exists && voronoi3DCache.dataVersion === currentVersion && voronoi3DCache.metric === metric && voronoi3DCache.useToeLocation === useToeLocation) {
		return true; // Skip rebuild - geometry is still valid
	}
	return false;
}

/**
 * Step 0.3) Mark 3D Voronoi as built
 */
function markVoronoi3DBuilt(metric, useToeLocation) {
	var currentVersion = window.analysisDataVersion || 0;
	voronoi3DCache = {
		dataVersion: currentVersion,
		metric: metric,
		useToeLocation: useToeLocation,
		exists: true
	};
}

/**
 * Step 0.4) Check if 3D Slope needs rebuild
 */
function shouldSkipSlope3DRebuild() {
	var currentVersion = window.analysisDataVersion || 0;
	if (slope3DCache.exists && slope3DCache.dataVersion === currentVersion) {
		return true;
	}
	return false;
}

/**
 * Step 0.5) Mark 3D Slope as built
 */
function markSlope3DBuilt() {
	slope3DCache = {
		dataVersion: window.analysisDataVersion || 0,
		exists: true
	};
}

/**
 * Step 0.6) Check if 3D Relief needs rebuild
 */
function shouldSkipRelief3DRebuild() {
	var currentVersion = window.analysisDataVersion || 0;
	if (relief3DCache.exists && relief3DCache.dataVersion === currentVersion) {
		return true;
	}
	return false;
}

/**
 * Step 0.7) Mark 3D Relief as built
 */
function markRelief3DBuilt() {
	relief3DCache = {
		dataVersion: window.analysisDataVersion || 0,
		exists: true
	};
}

/**
 * Step 0.8) Invalidate all 3D analysis caches
 * Call when data changes
 */
export function invalidate3DAnalysisCaches() {
	voronoi3DCache = { dataVersion: -1, metric: null, useToeLocation: null, exists: false };
	slope3DCache = { dataVersion: -1, exists: false };
	relief3DCache = { dataVersion: -1, exists: false };
	console.log("🗑️ 3D analysis caches invalidated");
}
// Note: LineSegmentsGeometry, LineMaterial, LineSegments2 are used by GeometryFactory for KAD lines
// The leading line uses simple THREE.Line like the ruler tool for reliability

// Step A1) BVH for accelerated raycasting on large surfaces (textured OBJ meshes)
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
const BVH_MIN_TRIANGLES = 1000;

// Note: These functions access global variables from kirra.js via window object:
// - threeInitialized, threeRenderer, worldToThreeLocal
// - holeScale, currentScale, darkModeEnabled
// - currentFontSize, textFillColor, depthColor, angleDipColor
// - elevationToColor, rgbStringToThreeColor, dataCentroidZ

//=================================================
// Helper Functions
//=================================================

// Step 0) Convert hex color string to Three.js color object {r, g, b}
function hexToThreeColor(hexColor) {
	// Step 0a) Default to grey if no color provided
	if (!hexColor) {
		if (developerModeEnabled) {
			console.log("🎨 [hexToThreeColor] No color provided, using grey");
		}
		return { r: 0.5, g: 0.5, b: 0.5 };
	}

	// Step 0b) Handle various formats
	var hex = String(hexColor).trim();

	// Step 0c) Remove # prefix if present
	if (hex.charAt(0) === "#") {
		hex = hex.substring(1);
	}

	// Step 0d) Handle 3-digit hex (e.g., "F0F" -> "FF00FF")
	if (hex.length === 3) {
		hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
	}

	// Step 0e) Parse hex values
	var r = parseInt(hex.substring(0, 2), 16) / 255;
	var g = parseInt(hex.substring(2, 4), 16) / 255;
	var b = parseInt(hex.substring(4, 6), 16) / 255;

	// Step 0f) Validate parsed values
	if (isNaN(r) || isNaN(g) || isNaN(b)) {
		if (developerModeEnabled) {
			console.log("🎨 [hexToThreeColor] Failed to parse color: " + hexColor + ", using grey");
		}
		return { r: 0.5, g: 0.5, b: 0.5 }; // Default grey
	}

	if (developerModeEnabled) {
		console.log("🎨 [hexToThreeColor] Parsed " + hexColor + " -> rgb(" + Math.round(r * 255) + ", " + Math.round(g * 255) + ", " + Math.round(b * 255) + ")");
	}
	return { r: r, g: g, b: b };
}

//=================================================
// Three.js Scene Management
//=================================================

// Step 1) Clear all Three.js geometry
export function clearThreeJS() {
	if (window.threeInitialized && window.threeRenderer) {
		window.threeRenderer.clearAllGeometry();
		// Invalidate analysis caches since geometry was removed
		invalidate3DAnalysisCaches();
		// Clear cached downhole timing range so it recalculates on next draw
		window._downholeTimingRange = null;
	}
}

// Step 2) Request render for Three.js
export function renderThreeJS() {
	if (window.threeInitialized && window.threeRenderer) {
		// Step 13a) Update orbit center Z before rendering
		window.threeRenderer.setOrbitCenterZ(window.dataCentroidZ);

		// Step 14) Just render - don't override camera state
		// Camera is controlled by CameraControls, not synced from 2D
		window.threeRenderer.requestRender();
	}
}

//=================================================
// Hole Drawing Functions (3D)
//=================================================

// Step 3) Draw complete hole in Three.js (collar + grade line + toe line)
export function drawHoleThreeJS(hole) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Step 1) Extract hole positions (world coordinates) with validation
	const collarWorld = {
		x: parseFloat(hole.startXLocation) || 0,
		y: parseFloat(hole.startYLocation) || 0
	};
	const gradeWorld = {
		x: parseFloat(hole.gradeXLocation) || 0,
		y: parseFloat(hole.gradeYLocation) || 0
	};
	const toeWorld = {
		x: parseFloat(hole.endXLocation) || 0,
		y: parseFloat(hole.endYLocation) || 0
	};

	// Step 1b) Skip holes with invalid coordinates
	if (!isFinite(collarWorld.x) || !isFinite(collarWorld.y)) {
		console.warn("Skipping hole with invalid collar coordinates:", hole.holeID);
		return;
	}

	// Step 2) Convert to local Three.js coordinates for precision
	const collarLocal = window.worldToThreeLocal(collarWorld.x, collarWorld.y);
	const gradeLocal = window.worldToThreeLocal(gradeWorld.x, gradeWorld.y);
	const toeLocal = window.worldToThreeLocal(toeWorld.x, toeWorld.y);

	// Z coordinates stay as-is (relative elevations) with validation
	const collarZ = parseFloat(hole.startZLocation) || 0;
	const gradeZ = parseFloat(hole.gradeZLocation) || 0;
	const toeZ = parseFloat(hole.endZLocation) || 0;

	let holeGroup;

	// Step 3) Determine hole type and create appropriate geometry
	const holeLength = parseFloat(hole.holeLengthCalculated);
	const holeDiameter = parseFloat(hole.holeDiameter);

	if (holeLength === 0 || isNaN(holeLength)) {
		// Step 3a) Dummy hole (no length) - draw cross/X
		const crossSize = 0.2 * window.holeScale; // 200mm * holeScale
		const color = window.darkModeEnabled ? 0xffffff : 0x000000;
		holeGroup = GeometryFactory.createDummyHole(collarLocal.x, collarLocal.y, collarZ, crossSize, color);
	} else if (holeDiameter === 0 || isNaN(holeDiameter)) {
		// Step 3b) Zero diameter hole - draw unfilled square
		const squareSize = 10 / window.currentScale; // 10 pixels converted to world units, influenced by scale
		const color = window.darkModeEnabled ? 0xffffff : 0x000000;
		holeGroup = GeometryFactory.createZeroDiameterHole(collarLocal.x, collarLocal.y, collarZ, gradeLocal.x, gradeLocal.y, gradeZ, toeLocal.x, toeLocal.y, toeZ, squareSize, hole.subdrillAmount || 0, window.darkModeEnabled);
	} else {
		// Step 3c) Normal hole - full visualization
		holeGroup = GeometryFactory.createHole(collarLocal.x, collarLocal.y, collarZ, gradeLocal.x, gradeLocal.y, gradeZ, toeLocal.x, toeLocal.y, toeZ, hole.holeDiameter, hole.holeColor || "#FF0000", window.holeScale, hole.subdrillAmount || 0, window.darkModeEnabled);
	}

	// Step 4) Add metadata for interaction/selection
	// IMPORTANT: holeId must be UNIQUE per hole, not just the entityName (which is shared by all holes in a pattern)
	// Use entityName + ":::" + holeID to create a unique identifier (matching 2D selection logic)
	const uniqueHoleId = hole.entityName + ":::" + hole.holeID;

	holeGroup.userData = {
		type: "hole",
		holeId: uniqueHoleId, // Unique identifier for selection (entityName:::holeID)
		entityName: hole.entityName, // Pattern/entity name
		holeID: hole.holeID, // Display name (hole number)
		holeData: hole // Full hole data for tooltips/info
	};

	// Step 4a) Also set userData on all child meshes for raycasting
	holeGroup.traverse(child => {
		if (child.isMesh || child.isLine || child.isPoints) {
			// Copy userData to children so raycast hits work
			child.userData = Object.assign({}, holeGroup.userData, child.userData);
		}
	});

	window.threeRenderer.holesGroup.add(holeGroup);
	window.threeRenderer.holeMeshMap.set(hole.holeID, holeGroup);
}

// Step 3b) Draw hole in Three.js using INSTANCED MESHES (10-50x faster for large blasts)
// This function uses InstancedMeshManager for circles (collar/grade/toe) and individual lines for hole bodies
export function drawHoleThreeJS_Instanced(hole, toeSliderRadius) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!window.threeRenderer.instancedMeshManager) return;

	const manager = window.threeRenderer.instancedMeshManager;
	const uniqueHoleId = hole.entityName + ":::" + hole.holeID;

	// Step 1) Extract hole positions (world coordinates) with validation
	const collarWorld = {
		x: parseFloat(hole.startXLocation) || 0,
		y: parseFloat(hole.startYLocation) || 0
	};
	const gradeWorld = {
		x: parseFloat(hole.gradeXLocation) || 0,
		y: parseFloat(hole.gradeYLocation) || 0
	};
	const toeWorld = {
		x: parseFloat(hole.endXLocation) || 0,
		y: parseFloat(hole.endYLocation) || 0
	};

	// Step 1b) Skip holes with invalid coordinates
	if (!isFinite(collarWorld.x) || !isFinite(collarWorld.y)) {
		console.warn("Skipping hole with invalid collar coordinates:", hole.holeID);
		return;
	}

	// Step 2) Convert to local Three.js coordinates for precision
	const collarLocal = window.worldToThreeLocal(collarWorld.x, collarWorld.y);
	const gradeLocal = window.worldToThreeLocal(gradeWorld.x, gradeWorld.y);
	const toeLocal = window.worldToThreeLocal(toeWorld.x, toeWorld.y);

	// Z coordinates stay as-is (relative elevations) with validation
	const collarZ = parseFloat(hole.startZLocation) || 0;
	const gradeZ = parseFloat(hole.gradeZLocation) || 0;
	const toeZ = parseFloat(hole.endZLocation) || 0;

	// Step 3) Determine hole type and dimensions
	const holeLength = parseFloat(hole.holeLengthCalculated);
	const holeDiameter = parseFloat(hole.holeDiameter);
	const subdrillAmount = hole.subdrillAmount || 0;
	const hasNegativeSubdrill = subdrillAmount < 0;

	// Calculate radii
	const diameterInMeters = holeDiameter / 1000;
	const radiusInMeters = diameterInMeters / 2 * (window.holeScale * 2);
	const gradeRadiusInMeters = radiusInMeters * 0.5;

	// Colors (matching original drawHoleThreeJS exactly)
	const collarColor = window.darkModeEnabled ? 0xffffff : 0x000000;
	const lineColor = window.darkModeEnabled ? 0xffffff : 0x000000;
	const gradeColor = 0xff0000; // Always RED
	const toeColor = window.darkModeEnabled ? 0x5eacff : 0x26ff00; // Blue in dark, green in light

	// Step 4) Create hole body lines (individual objects - lightweight)
	const lineGroup = new THREE.Group();
	lineGroup.userData = {
		type: "hole", // IMPORTANT: Must be "hole" for raycasting/selection to work
		holeId: uniqueHoleId,
		entityName: hole.entityName,
		holeID: hole.holeID,
		holeData: hole // Full hole data for connections and info
	};

	if (holeLength === 0 || isNaN(holeLength)) {
		// Step 4a) Dummy hole - use BATCHED X-shape (not individual geometry)
		// This reduces thousands of draw calls to just 1-2 for all dummy holes
		const crossSize = 0.2 * window.holeScale;
		manager.addDummyHoleToBatch(uniqueHoleId, collarLocal.x, collarLocal.y, collarZ, crossSize, collarColor);
		// Note: No individual mesh to add to holeMeshMap - tracking is in manager.dummyHoleIndexMap
		return; // Batched - no further processing needed
	} else if (holeDiameter === 0 || isNaN(holeDiameter)) {
		// Step 4b) Zero diameter hole - use BATCHED square + track lines
		// This reduces thousands of draw calls to just 1-2 for all zero-diameter holes
		const squareSize = 10 / window.currentScale;
		manager.addZeroDiameterHoleToBatch(uniqueHoleId, collarLocal.x, collarLocal.y, collarZ, gradeLocal.x, gradeLocal.y, gradeZ, toeLocal.x, toeLocal.y, toeZ, squareSize, subdrillAmount, window.darkModeEnabled);
		// Note: No individual mesh to add to holeMeshMap - tracking is in manager.zeroDiameterIndexMap
		return; // Batched - no further processing needed
	}

	// Step 5) Normal hole - use instancing for circles, BATCHED lines for body

	// Step 5a) Add collar circle as instance
	manager.addHoleInstance(uniqueHoleId, "collar", collarLocal.x, collarLocal.y, collarZ, holeDiameter, radiusInMeters, collarColor, window.darkModeEnabled);

	// Step 5b) Add hole body lines to BATCH (not individual objects!)
	// This reduces draw calls from 1000s to ~5-10
	const lineColorKey = window.darkModeEnabled ? "solid_white" : "solid_black";

	if (hasNegativeSubdrill) {
		// NEGATIVE SUBDRILL CASE
		// Solid line from collar to toe
		manager.addLineToBatch(lineColorKey, collarLocal.x, collarLocal.y, collarZ, toeLocal.x, toeLocal.y, toeZ);

		// RED transparent line from toe to grade
		manager.addLineToBatch("transparent_red", toeLocal.x, toeLocal.y, toeZ, gradeLocal.x, gradeLocal.y, gradeZ);

		// Add grade circle as instance (RED transparent for negative subdrill)
		manager.addHoleInstance(
			uniqueHoleId,
			"grade_negative",
			gradeLocal.x,
			gradeLocal.y,
			gradeZ,
			holeDiameter * 0.5, // Smaller diameter for grade
			gradeRadiusInMeters,
			gradeColor,
			window.darkModeEnabled
		);
	} else {
		// POSITIVE/ZERO SUBDRILL CASE
		// Solid line from collar to grade
		manager.addLineToBatch(lineColorKey, collarLocal.x, collarLocal.y, collarZ, gradeLocal.x, gradeLocal.y, gradeZ);

		// RED solid line from grade to toe
		manager.addLineToBatch("solid_red", gradeLocal.x, gradeLocal.y, gradeZ, toeLocal.x, toeLocal.y, toeZ);

		// Add grade circle as instance (RED solid for positive subdrill)
		manager.addHoleInstance(
			uniqueHoleId,
			"grade_positive",
			gradeLocal.x,
			gradeLocal.y,
			gradeZ,
			holeDiameter * 0.5, // Smaller diameter for grade
			gradeRadiusInMeters,
			gradeColor,
			window.darkModeEnabled
		);
	}

	// Step 5c) Add toe circle as instance
	// IMPORTANT: All toes use the SAME radius from toeSlider, not based on hole diameter
	// Use fixed key "toe_slider" so all toes are in one InstancedMesh
	if (holeLength > 0 && !isNaN(holeLength) && toeSliderRadius > 0) {
		manager.addHoleInstance(
			uniqueHoleId,
			"toe_slider", // Fixed key - all toes in one instance
			toeLocal.x,
			toeLocal.y,
			toeZ,
			999, // Dummy diameter value (not used for grouping with fixed key)
			parseFloat(toeSliderRadius), // Use slider radius directly
			toeColor,
			window.darkModeEnabled
		);
	}

	// NOTE: Lines are batched and will be flushed ONCE after all holes are drawn
	// The lineGroup is no longer used for lines - only kept for hole metadata lookup
	lineGroup.userData.linesBatched = true;

	// Step 6) Add empty line group to scene (for metadata/selection lookup only)
	window.threeRenderer.holesGroup.add(lineGroup);
	window.threeRenderer.holeMeshMap.set(hole.holeID, lineGroup);
}

// Step 4) Draw hole toe in Three.js
export function drawHoleToeThreeJS(worldX, worldY, worldZ, radius, color, holeId) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Don't draw toe circle if radius is 0 or less
	if (radius <= 0) return;

	// Validate coordinates to prevent NaN geometry
	const wx = parseFloat(worldX);
	const wy = parseFloat(worldY);
	const wz = parseFloat(worldZ) || 0;
	if (!isFinite(wx) || !isFinite(wy)) {
		return; // Skip invalid coordinates silently (toe is optional)
	}

	// Step 4a) Convert world coordinates to local Three.js coordinates for precision
	const local = window.worldToThreeLocal(wx, wy);

	// Step 4b) Create toe mesh at local coordinates
	let color2;
	if (window.darkModeEnabled) {
		color2 = "rgb(94, 172, 255)";
	} else {
		color2 = "rgb(38, 255, 0)";
	}
	const toeMesh = GeometryFactory.createHoleToe(local.x, local.y, wz, radius, color2);

	// Step 4c) Add metadata for selection
	toeMesh.userData = {
		type: "holeToe",
		holeId: holeId
	};

	window.threeRenderer.holesGroup.add(toeMesh);
}

// Step 5) Draw hole label text in Three.js
// 3D always uses Hershey Simplex vector text (LineSegments2) for consistency with export
// The window.useVectorText toggle only affects 2D canvas rendering
export function drawHoleTextThreeJS(worldX, worldY, worldZ, text, fontSize, color, anchorX = "center") {
	if (!window.threeInitialized || !window.threeRenderer) return;
	// Step 5a) Allow numeric 0 to display - only skip truly empty/invalid values
	if (text === null || text === undefined || text === "" || text === "null" || text === "undefined") return;

	// Validate coordinates to prevent NaN geometry
	const wx = parseFloat(worldX);
	const wy = parseFloat(worldY);
	const wz = parseFloat(worldZ) || 0;
	if (!isFinite(wx) || !isFinite(wy)) {
		return; // Skip invalid coordinates
	}

	const local = window.worldToThreeLocal(wx, wy);

	// Step 5a.1) Determine target group - use labelsGroup if available (for LOD control)
	var targetGroup = window.threeRenderer.labelsGroup || window.threeRenderer.holesGroup;

	// Step 5b) Always use Hershey Simplex vector font in 3D (high performance, line-based, matches export)
	const vectorText = GeometryFactory.createVectorText(local.x, local.y, wz, String(text), fontSize, color, anchorX);
	if (vectorText) {
		vectorText.userData.isHoleLabel = true;
		targetGroup.add(vectorText);
	}
}

// Step 6) Draw all hole labels in Three.js
export function drawHoleTextsAndConnectorsThreeJS(hole, displayOptions) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	const fontSize = parseInt(window.currentFontSize) || 12;

	// Step 0) Use a BASE font size for position calculation to maintain alignment
	// The actual font rendering uses fontSize, but position calculation uses BASE_FONT_SIZE
	// This prevents text from drifting away from the hole when font size increases
	const BASE_FONT_SIZE = 10; // Fixed base for position calculations

	// Step 0) EXACTLY match 2D: use worldToCanvas to get canvas coords, apply pixel offsets, convert back
	// In 2D: [x, y] = worldToCanvas(hole.startXLocation, hole.startYLocation) then apply pixel offsets
	const [collarCanvasX, collarCanvasY] = window.worldToCanvas(hole.startXLocation, hole.startYLocation);
	const [toeCanvasX, toeCanvasY] = window.worldToCanvas(hole.endXLocation, hole.endYLocation);

	// Step 0a) Calculate text offsets EXACTLY like 2D (in pixels)
	const textOffset = parseInt(hole.holeDiameter / 1000 * window.holeScale * window.currentScale);

	// Step 0b) Calculate canvas positions EXACTLY like 2D (matching kirra.js lines 21424-21434)
	// Use BASE_FONT_SIZE for position calculation to maintain alignment regardless of actual font size
	const leftSideToe = parseInt(toeCanvasX) - textOffset;
	const rightSideToe = parseInt(toeCanvasX) + textOffset;
	const leftSideCollar = parseInt(collarCanvasX) - textOffset;
	const rightSideCollar = parseInt(collarCanvasX) + textOffset;
	const topSideToe = parseInt(toeCanvasY - textOffset);
	const middleSideToe = parseInt(toeCanvasY + textOffset + parseInt(BASE_FONT_SIZE / 4));
	const bottomSideToe = parseInt(toeCanvasY + textOffset + BASE_FONT_SIZE);
	const topSideCollar = parseInt(collarCanvasY - textOffset);
	const middleSideCollar = parseInt(collarCanvasY + parseInt(BASE_FONT_SIZE / 2));
	const bottomSideCollar = parseInt(collarCanvasY + textOffset + BASE_FONT_SIZE);

	// Step 0c) Convert canvas pixel coordinates back to world coordinates (inverse of worldToCanvas)
	// worldToCanvas: [(x - centroidX) * currentScale + canvas.width / 2, (-y + centroidY) * currentScale + canvas.height / 2]
	// Inverse: [(canvasX - canvas.width / 2) / currentScale + centroidX, -(canvasY - canvas.height / 2) / currentScale + centroidY]
	// Note: centroidX/Y are local variables, so we reverse-engineer them from known world/canvas pairs
	const canvas = window.canvas;
	const currentScale = window.currentScale;

	if (!canvas || !currentScale) {
		console.warn("⚠️ Canvas or currentScale not available, skipping text rendering");
		return; // Skip text rendering if we can't convert properly
	}

	// Reverse-engineer centroid from known world/canvas coordinate pair
	// Using collar position: canvas = (world - centroid) * scale + canvas.width/2
	// Solving for centroid: centroid = world - (canvas - canvas.width/2) / scale
	const centroidX = hole.startXLocation - (collarCanvasX - canvas.width / 2) / currentScale;
	const centroidY = hole.startYLocation + (collarCanvasY - canvas.height / 2) / currentScale; // Note: Y is flipped

	const canvasToWorld = (canvasX, canvasY) => {
		const worldX = (canvasX - canvas.width / 2) / currentScale + centroidX;
		const worldY = -(canvasY - canvas.height / 2) / currentScale + centroidY;
		return { x: worldX, y: worldY };
	};

	// Step 0d) Convert all canvas positions to world coordinates
	const leftSideCollarWorld = canvasToWorld(leftSideCollar, topSideCollar);
	const rightSideCollarWorld = canvasToWorld(rightSideCollar, topSideCollar);
	const leftSideToeWorld = canvasToWorld(leftSideToe, topSideToe);
	const rightSideToeWorld = canvasToWorld(rightSideToe, topSideToe);
	const middleSideCollarWorld = canvasToWorld(rightSideCollar, middleSideCollar);
	const bottomSideCollarWorld = canvasToWorld(rightSideCollar, bottomSideCollar);
	const middleSideToeWorld = canvasToWorld(leftSideToe, middleSideToe);
	const bottomSideToeWorld = canvasToWorld(leftSideToe, bottomSideToe);

	// Extract world coordinates
	const collarX = hole.startXLocation;
	const collarY = hole.startYLocation;
	const collarZ = hole.startZLocation || 0;
	const toeX = hole.endXLocation;
	const toeY = hole.endYLocation;
	const toeZ = hole.endZLocation || 0;

	// Step 3) Draw text at calculated world positions (matching 2D positioning exactly)
	// drawHoleTextThreeJS will convert world coords to local internally
	if (displayOptions.holeID) {
		drawHoleTextThreeJS(rightSideCollarWorld.x, rightSideCollarWorld.y, collarZ, hole.holeID, fontSize / 1.5, window.textFillColor, "left");
	}
	if (displayOptions.holeDia) {
		drawHoleTextThreeJS(bottomSideCollarWorld.x, bottomSideCollarWorld.y, collarZ, parseFloat(hole.holeDiameter).toFixed(0), fontSize / 1.5, "green", "left");
	}
	if (displayOptions.holeLen) {
		drawHoleTextThreeJS(middleSideCollarWorld.x, middleSideCollarWorld.y, collarZ, parseFloat(hole.holeLengthCalculated).toFixed(1), fontSize / 1.5, window.depthColor, "left");
	}
	if (displayOptions.holeType) {
		drawHoleTextThreeJS(middleSideCollarWorld.x, middleSideCollarWorld.y, collarZ, hole.holeType, fontSize / 1.5, "green", "left");
	}
	if (displayOptions.measuredComment) {
		drawHoleTextThreeJS(middleSideCollarWorld.x, middleSideCollarWorld.y, collarZ, hole.measuredComment, fontSize / 1.5, "#FF8800", "left");
	}

	// Step 4) Left side labels (right-aligned)
	if (displayOptions.holeAng) {
		drawHoleTextThreeJS(leftSideCollarWorld.x, leftSideCollarWorld.y, collarZ, parseFloat(hole.holeAngle).toFixed(0), fontSize / 1.5, window.angleDipColor, "right");
	}
	if (displayOptions.holeDip) {
		drawHoleTextThreeJS(leftSideToeWorld.x, leftSideToeWorld.y, toeZ, 90 - parseFloat(hole.holeAngle).toFixed(0), fontSize / 1.5, window.angleDipColor, "right");
	}
	if (displayOptions.holeBea) {
		drawHoleTextThreeJS(bottomSideToeWorld.x, bottomSideToeWorld.y, toeZ, parseFloat(hole.holeBearing).toFixed(1), fontSize / 1.5, "red", "right");
	}
	if (displayOptions.holeSubdrill) {
		drawHoleTextThreeJS(bottomSideToeWorld.x, bottomSideToeWorld.y, toeZ, parseFloat(hole.subdrillAmount).toFixed(1), fontSize / 1.5, "blue", "right");
	}
	if (displayOptions.initiationTime) {
		drawHoleTextThreeJS(leftSideCollarWorld.x, leftSideCollarWorld.y, collarZ, hole.holeTime, fontSize / 1.5, "red", "right");
	}
	// Step 5) Additional coordinate and measurement labels
	if (displayOptions.xValue) {
		drawHoleTextThreeJS(leftSideCollarWorld.x, leftSideCollarWorld.y, collarZ, parseFloat(hole.startXLocation).toFixed(2), fontSize / 1.5, window.textFillColor, "right");
	}
	if (displayOptions.yValue) {
		const yPosWorld = canvasToWorld(leftSideCollar, middleSideCollar);
		drawHoleTextThreeJS(yPosWorld.x, yPosWorld.y, collarZ, parseFloat(hole.startYLocation).toFixed(2), fontSize / 1.5, window.textFillColor, "right");
	}
	if (displayOptions.zValue) {
		drawHoleTextThreeJS(bottomSideCollarWorld.x, bottomSideCollarWorld.y, collarZ, parseFloat(hole.startZLocation).toFixed(2), fontSize / 1.5, window.textFillColor, "right");
	}
	if (displayOptions.displayRowAndPosId) {
		drawHoleTextThreeJS(leftSideCollarWorld.x, leftSideCollarWorld.y, collarZ, "Row:" + hole.rowID, fontSize / 1.5, "#FF00FF", "right");
		const posPosWorld = canvasToWorld(leftSideCollar, middleSideCollar);
		drawHoleTextThreeJS(posPosWorld.x, posPosWorld.y, collarZ, "Pos:" + hole.posID, fontSize / 1.5, "#FF00FF", "right");
	}
	if (displayOptions.measuredLength) {
		const lenPosWorld = canvasToWorld(leftSideCollar, bottomSideCollar + BASE_FONT_SIZE);
		drawHoleTextThreeJS(lenPosWorld.x, lenPosWorld.y, collarZ, hole.measuredLength, fontSize / 1.5, "#FF4400", "right");
	}
	if (displayOptions.measuredMass) {
		// Step 5a) Use topSideToe for Y position to match 2D layout (left side, toe vertical position)
		const massPosWorld = canvasToWorld(leftSideCollar, topSideToe);
		drawHoleTextThreeJS(massPosWorld.x, massPosWorld.y, collarZ, hole.measuredMass, fontSize / 1.5, "#FF6600", "right");
	}
	if (displayOptions.massPerHole) {
		var mLabels = buildMassLabels(hole);
		if (mLabels.perHole) {
			var mphPos = canvasToWorld(leftSideCollar, middleSideToe);
			drawHoleTextThreeJS(mphPos.x, mphPos.y, collarZ, mLabels.perHole, fontSize / 1.5, "#FF0000", "right");
		}
	}
	if (displayOptions.massPerDeck) {
		var dLabels = buildMassLabels(hole);
		var massLineH = BASE_FONT_SIZE;
		for (var ml = 0; ml < dLabels.perDeck.length; ml++) {
			var mpdPos = canvasToWorld(leftSideCollar, middleSideToe + ml * massLineH);
			drawHoleTextThreeJS(mpdPos.x, mpdPos.y, collarZ, dLabels.perDeck[ml], fontSize / 1.5, "#FF0000", "right");
		}
	}
	if (displayOptions.downholeTiming) {
		var chargingMap = window.loadedCharging;
		if (chargingMap && chargingMap.has(chargingKey(hole))) {
			var timingEntries = calculateDownholeTimings([hole], chargingMap, { visibleOnly: false });
			if (timingEntries.length > 0) {
				// Get global timing range for consistent coloring
				if (!window._downholeTimingRange) {
					var allEntries = calculateDownholeTimings(window.allBlastHoles, chargingMap);
					window._downholeTimingRange = getTimingRange(allEntries);
				}
				var range = window._downholeTimingRange;
				var timingLineH = BASE_FONT_SIZE;
				for (var ti = 0; ti < timingEntries.length; ti++) {
					var entry = timingEntries[ti];
					var t = normalizeFireTime(entry.totalFireTimeMs, range.minMs, range.rangeMs);
					var tColor = fireTimeToColor(t);
					var tLabel = entry.totalFireTimeMs.toFixed(0) + "ms";
					// Position below the massPerDeck labels on the right side of the toe
					var tPos = canvasToWorld(rightSideToe, middleSideToe + ti * timingLineH);
					drawHoleTextThreeJS(tPos.x, tPos.y, toeZ, tLabel, fontSize / 1.5, tColor, "left");
				}
			}
		}
	}
}

//=================================================
// KAD Drawing Functions (3D)
//=================================================

// Step 7) Draw KAD point in Three.js
export function drawKADPointThreeJS(worldX, worldY, worldZ, size, color, kadId) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Validate coordinates to prevent NaN geometry
	const wx = parseFloat(worldX);
	const wy = parseFloat(worldY);
	const wz = parseFloat(worldZ) || 0;
	if (!isFinite(wx) || !isFinite(wy)) {
		console.warn("Skipping KAD point with invalid coordinates:", kadId);
		return;
	}

	const pointMesh = GeometryFactory.createKADPoint(wx, wy, wz, size, color);

	// Step 7a) Add metadata for selection
	if (kadId) {
		pointMesh.userData = { type: "kadPoint", kadId: kadId };
	}

	window.threeRenderer.kadGroup.add(pointMesh);
}

// Step 8) Draw KAD line segment in Three.js
// Matches 2D drawKADLines() - draws a single segment with its own attributes
export function drawKADLineSegmentThreeJS(startX, startY, startZ, endX, endY, endZ, lineWidth, color, kadId) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Validate coordinates to prevent NaN geometry
	const sx = parseFloat(startX);
	const sy = parseFloat(startY);
	const sz = parseFloat(startZ) || 0;
	const ex = parseFloat(endX);
	const ey = parseFloat(endY);
	const ez = parseFloat(endZ) || 0;
	if (!isFinite(sx) || !isFinite(sy) || !isFinite(ex) || !isFinite(ey)) {
		console.warn("Skipping KAD line segment with invalid coordinates:", kadId);
		return;
	}

	if (developerModeEnabled) {
		console.log("🔧 [drawKADLineSegmentThreeJS] kadId:", kadId);
	}

	const lineMesh = GeometryFactory.createKADLineSegment(sx, sy, sz, ex, ey, ez, lineWidth, color);

	// Step 8a) Add metadata for selection
	if (kadId) {
		lineMesh.userData = { type: "kadLine", kadId: kadId };
		if (developerModeEnabled) {
			console.log("✅ [drawKADLineSegmentThreeJS] userData set:", lineMesh.userData);
		}
	} else {
		if (developerModeEnabled) {
			console.log("❌ [drawKADLineSegmentThreeJS] kadId is falsy, NOT setting userData");
		}
	}

	window.threeRenderer.kadGroup.add(lineMesh);
}

// Step 9) Draw KAD polygon segment in Three.js
// Matches 2D drawKADPolys() - draws a single segment with its own attributes
export function drawKADPolygonSegmentThreeJS(startX, startY, startZ, endX, endY, endZ, lineWidth, color, kadId) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	if (developerModeEnabled) {
		console.log("🔧 [drawKADPolygonSegmentThreeJS] kadId:", kadId);
	}

	const polyMesh = GeometryFactory.createKADPolygonSegment(startX, startY, startZ, endX, endY, endZ, lineWidth, color);

	// Step 9a) Add metadata for selection
	if (kadId) {
		polyMesh.userData = { type: "kadPolygon", kadId: kadId };
		if (developerModeEnabled) {
			console.log("✅ [drawKADPolygonSegmentThreeJS] userData set:", polyMesh.userData);
		}
	} else {
		if (developerModeEnabled) {
			console.log("❌ [drawKADPolygonSegmentThreeJS] kadId is falsy, NOT setting userData");
		}
	}

	window.threeRenderer.kadGroup.add(polyMesh);
}

// Step 9b) FAST: Draw entire polyline/line entity with ONE draw call (batched)
// This is the key optimization for large DXF files
// Instead of creating one mesh per segment, create ONE mesh for all points
// For VERY large polylines (>20k vertices), splits into chunks to prevent GPU exhaustion
export function drawKADBatchedPolylineThreeJS(pointsArray, lineWidth, color, kadId, isPolygon) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!pointsArray || pointsArray.length < 2) return;

	// Step 9b.0) NO RENDER-LEVEL CHUNKING!
	// Storage-level chunking already happened during import
	// Double-chunking creates exponential objects (BAD!)
	// Just render the already-chunked entity as-is

	// Step 9b.1) Create single batched polyline for this entity/chunk
	var batchedLine = GeometryFactory.createBatchedPolyline(pointsArray, lineWidth, color, isPolygon);
	if (!batchedLine) return;

	// Step 9b.2) Add metadata for selection
	if (kadId) {
		batchedLine.userData = {
			type: isPolygon ? "kadPolygon" : "kadLine",
			kadId: kadId,
			isBatched: true
		};
	}

	window.threeRenderer.kadGroup.add(batchedLine);
}

// Step 9c) SUPER-BATCH: Draw ALL KAD points in ONE draw call
// This creates a single THREE.Points object containing all KAD points
export function drawKADSuperBatchedPointsThreeJS(allPointEntities, worldToThreeLocal) {
	if (!window.threeInitialized || !window.threeRenderer) return null;
	if (!allPointEntities || allPointEntities.length === 0) return null;

	// Step 9c.1) Create super-batched points (ONE object for ALL points!)
	var result = GeometryFactory.createSuperBatchedPoints(allPointEntities, worldToThreeLocal);
	if (!result || !result.points) return null;

	// Step 9c.2) Add to KAD group
	window.threeRenderer.kadGroup.add(result.points);

	return result;
}

// Step 9d) SUPER-BATCH: Draw ALL KAD circles in ONE draw call
// This creates a single THREE.LineSegments object containing all KAD circles
export function drawKADSuperBatchedCirclesThreeJS(allCircleEntities, worldToThreeLocal) {
	if (!window.threeInitialized || !window.threeRenderer) return null;
	if (!allCircleEntities || allCircleEntities.length === 0) return null;

	// Step 9d.1) Create super-batched circles (ONE object for ALL circles!)
	var result = GeometryFactory.createSuperBatchedCircles(allCircleEntities, worldToThreeLocal);
	if (!result || !result.lineSegments) return null;

	// Step 9d.2) Add to KAD group
	window.threeRenderer.kadGroup.add(result.lineSegments);

	return result;
}

// Step 10) Draw KAD circle in Three.js
export function drawKADCircleThreeJS(worldX, worldY, worldZ, radius, lineWidth, color, kadId) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	if (developerModeEnabled) {
		console.log("🔧 [drawKADCircleThreeJS] kadId:", kadId);
	}

	const circleMesh = GeometryFactory.createKADCircle(worldX, worldY, worldZ, radius, lineWidth, color);

	// Step 10a) Add metadata for selection
	if (kadId) {
		circleMesh.userData = { type: "kadCircle", kadId: kadId };
		if (developerModeEnabled) {
			console.log("✅ [drawKADCircleThreeJS] userData set:", circleMesh.userData);
		}
	}

	window.threeRenderer.kadGroup.add(circleMesh);
}

// Step 11) Draw KAD text in Three.js
// anchorX defaults to "left" to match 2D canvas text alignment
// 3D always uses Hershey Simplex vector text (LineSegments2) for consistency with export
// The window.useVectorText toggle only affects 2D canvas rendering
// Note: Vector text doesn't support background colors - falls back to Troika SDF for those
export function drawKADTextThreeJS(worldX, worldY, worldZ, text, fontSize, color, backgroundColor = null, kadId = null, anchorX = "left") {
	if (!window.threeInitialized || !window.threeRenderer) return;

	if (developerModeEnabled) {
		console.log("🔧 [drawKADTextThreeJS] kadId:", kadId);
	}

	// Step 11a) Vector text doesn't support background colors - use Troika for those
	if (backgroundColor) {
		// Step 11b) Use Troika SDF text for background support
		const textSprite = GeometryFactory.createKADText(worldX, worldY, worldZ, text, fontSize, color, backgroundColor, anchorX);

		// Step 11c) Add metadata for selection
		if (kadId) {
			if (!textSprite.userData) {
				textSprite.userData = {};
			}
			textSprite.userData.type = "kadText";
			textSprite.userData.kadId = kadId;
			if (developerModeEnabled) {
				console.log("✅ [drawKADTextThreeJS] Troika text userData set:", textSprite.userData);
			}
		}

		// Step 11d) Only add if not already in group (cached objects might already be there)
		if (!textSprite.parent) {
			window.threeRenderer.kadGroup.add(textSprite);
		}
	} else {
		// Step 11e) Use Hershey Simplex vector font (default for 3D, matches export)
		const vectorText = GeometryFactory.createVectorText(worldX, worldY, worldZ, String(text), fontSize, color, anchorX);

		if (vectorText) {
			// Step 11f) Add metadata for selection
			if (kadId) {
				vectorText.userData.type = "kadText";
				vectorText.userData.kadId = kadId;
				if (developerModeEnabled) {
					console.log("✅ [drawKADTextThreeJS] Vector text userData set:", vectorText.userData);
				}
			}
			window.threeRenderer.kadGroup.add(vectorText);
		}
	}
}

// Step 11g) Draw KAD point ID label in Three.js
// Used when the KAD Point ID display toggle is enabled
export function drawKADPointIDThreeJS(worldX, worldY, worldZ, pointID, color) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Small offset to position the ID label above and to the left of the point
	const offsetX = -0.5;
	const offsetY = 0.5;
	const offsetZ = 0.2;

	// Use font size 12 for the ID
	const fontSize = 9;

	// Draw the point ID using vector text
	const vectorText = GeometryFactory.createVectorText(
		worldX + offsetX,
		worldY + offsetY,
		worldZ + offsetZ,
		String(pointID),
		fontSize,
		color,
		"right"
	);

	if (vectorText) {
		vectorText.userData = { type: "kadPointIDLabel" };
		window.threeRenderer.kadGroup.add(vectorText);
	}
}

//=================================================
// Surface & Other 3D Drawing
//=================================================

/**
 * Rebuild an analysis mesh from stored texture/canvas data (same session).
 * Called when surfaceMeshMap was cleared (e.g. by clearAllGeometry) but the
 * surface still has its baked texture in memory.
 */
function _rebuildAnalysisMeshFromTexture(surfaceId, surfaceData) {
	var triCount = surfaceData.triangles ? surfaceData.triangles.length : 0;
	if (triCount === 0) return;

	var uvBounds = surfaceData.analysisUVBounds;
	var uvW = uvBounds.maxU - uvBounds.minU;
	var uvH = uvBounds.maxV - uvBounds.minV;

	var positions = new Float32Array(triCount * 9);
	var uvs = new Float32Array(triCount * 6);

	for (var i = 0; i < triCount; i++) {
		var tri = surfaceData.triangles[i];
		var verts;
		if (tri.a !== undefined && tri.b !== undefined && tri.c !== undefined) {
			verts = [surfaceData.points[tri.a], surfaceData.points[tri.b], surfaceData.points[tri.c]];
		} else if (tri.vertices && Array.isArray(tri.vertices) && tri.vertices.length === 3) {
			if (typeof tri.vertices[0] === "object") {
				verts = tri.vertices;
			} else {
				verts = [surfaceData.points[tri.vertices[0]], surfaceData.points[tri.vertices[1]], surfaceData.points[tri.vertices[2]]];
			}
		} else {
			continue;
		}
		if (!verts[0] || !verts[1] || !verts[2]) continue;

		for (var j = 0; j < 3; j++) {
			var v = verts[j];
			var local = window.worldToThreeLocal(v.x, v.y);
			positions[i * 9 + j * 3]     = local.x;
			positions[i * 9 + j * 3 + 1] = local.y;
			positions[i * 9 + j * 3 + 2] = v.z;
			uvs[i * 6 + j * 2]     = (v.x - uvBounds.minU) / uvW;
			uvs[i * 6 + j * 2 + 1] = (v.y - uvBounds.minV) / uvH;
		}
	}

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
	geometry.computeVertexNormals();

	var material = new THREE.MeshBasicMaterial({
		map: surfaceData.analysisTexture,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: surfaceData.transparency || 1.0
	});

	var mesh = new THREE.Mesh(geometry, material);
	mesh.userData = { type: "surface", surfaceId: surfaceId, isAnalysisSurface: true };

	window.threeRenderer.surfacesGroup.add(mesh);
	window.threeRenderer.surfaceMeshMap.set(surfaceId, mesh);
	console.log("Rebuilt analysis mesh from stored texture for " + surfaceId);
}

/**
 * Rebuild a direct ShaderMaterial analysis mesh for non-horizontal surfaces.
 * Called when surfaceMeshMap was cleared but the surface data is still in memory.
 * Re-creates the ShaderMaterial from the stored model name and params.
 */
function _rebuildDirectShaderAnalysisMesh(surfaceId, surfaceData) {
	var triCount = surfaceData.triangles ? surfaceData.triangles.length : 0;
	if (triCount === 0) return;

	// Re-create shader material from stored model/params
	var holes = window.allBlastHoles || [];
	var shaderMaterial = getShaderMaterialForModel(
		surfaceData.analysisModelName,
		holes,
		surfaceData.analysisParams
	);
	if (!shaderMaterial) {
		// Fallback to baked texture if shader creation fails
		if (surfaceData.analysisTexture && surfaceData.analysisUVBounds) {
			_rebuildAnalysisMeshFromTexture(surfaceId, surfaceData);
		}
		return;
	}

	var positions = new Float32Array(triCount * 9);
	var idx = 0;

	for (var i = 0; i < triCount; i++) {
		var tri = surfaceData.triangles[i];
		var verts;
		if (tri.a !== undefined && tri.b !== undefined && tri.c !== undefined) {
			verts = [surfaceData.points[tri.a], surfaceData.points[tri.b], surfaceData.points[tri.c]];
		} else if (tri.vertices && Array.isArray(tri.vertices) && tri.vertices.length === 3) {
			if (typeof tri.vertices[0] === "object") {
				verts = tri.vertices;
			} else {
				verts = [surfaceData.points[tri.vertices[0]], surfaceData.points[tri.vertices[1]], surfaceData.points[tri.vertices[2]]];
			}
		} else {
			continue;
		}
		if (!verts[0] || !verts[1] || !verts[2]) continue;

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

	// Set uWorldOffset for world position reconstruction
	var originX = window.threeLocalOriginX || 0;
	var originY = window.threeLocalOriginY || 0;
	if (shaderMaterial.uniforms && shaderMaterial.uniforms.uWorldOffset) {
		shaderMaterial.uniforms.uWorldOffset.value.set(originX, originY, 0);
	}

	shaderMaterial.side = THREE.DoubleSide;
	shaderMaterial.transparent = true;

	var mesh = new THREE.Mesh(geometry, shaderMaterial);
	mesh.userData = {
		type: "surface",
		surfaceId: surfaceId,
		isAnalysisSurface: true,
		isDirectShader: true
	};

	window.threeRenderer.surfacesGroup.add(mesh);
	window.threeRenderer.surfaceMeshMap.set(surfaceId, mesh);
	console.log("Rebuilt direct shader analysis mesh for " + surfaceId);
}

// Step 12) Draw surface in Three.js
export function drawSurfaceThreeJS(surfaceId, triangles, minZ, maxZ, gradient, transparency, surfaceData) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Step 12a) Check if this is a textured mesh with pre-loaded Three.js object
	// Check if mesh actually has textures
	var hasTexture = false;
	if (surfaceData && surfaceData.threeJSMesh) {
		surfaceData.threeJSMesh.traverse(function (child) {
			if (child.isMesh && child.material) {
				if (Array.isArray(child.material)) {
					hasTexture = child.material.some(function (mat) {
						return mat.map !== null && mat.map !== undefined;
					});
				} else {
					hasTexture = child.material.map !== null && child.material.map !== undefined;
				}
			}
		});
	}

	// Only use texture rendering if gradient is "texture" AND mesh has textures
	var useTextureRendering = surfaceData && surfaceData.isTexturedMesh && surfaceData.threeJSMesh && gradient === "texture" && hasTexture;

	// Diagnostic: Show why texture rendering is NOT being used
	if (surfaceData && surfaceData.isTexturedMesh && gradient === "texture" && !useTextureRendering) {
		console.warn("⚠️ Texture rendering DISABLED for " + surfaceId + " - Checks: hasSurfaceData=" + !!surfaceData +
			", isTexturedMesh=" + surfaceData.isTexturedMesh +
			", hasMesh=" + !!surfaceData.threeJSMesh +
			", gradient=" + gradient +
			", hasTexture=" + hasTexture);
	}

	if (useTextureRendering) {
		if (developerModeEnabled) {
			console.log("🎨 drawSurfaceThreeJS: Using textured mesh rendering for " + surfaceId + ", gradient: " + gradient + ", hasTexture: " + hasTexture);
		}

		// Step 12b) Check if already added to scene - CRITICAL: Return early to prevent duplicates!
		var existingMesh = window.threeRenderer.surfaceMeshMap.get(surfaceId);
		if (existingMesh) {
			// Already in scene, just ensure visibility
			if (developerModeEnabled) {
				console.log("🎨 drawSurfaceThreeJS: Mesh already in scene for " + surfaceId + ", setting visible");
				console.log("🎨 Existing mesh position: (" + existingMesh.position.x.toFixed(2) + ", " + existingMesh.position.y.toFixed(2) + ", " + existingMesh.position.z.toFixed(2) + ")");
			}
			existingMesh.visible = true;
			return; // CRITICAL: Return here to prevent adding duplicate meshes!
		}
		if (developerModeEnabled) {
			console.log("🎨 Mesh NOT in scene yet, creating new instance for " + surfaceId);
		}

		// Step 12c) Clone the pre-loaded mesh for rendering
		// CRITICAL: Use deep clone with geometry cloning to preserve original mesh
		var texturedMesh = surfaceData.threeJSMesh.clone(true); // true = deep clone including geometries

		// Step 12c.0) DIAGNOSTIC: Check original vertex positions BEFORE any transformation
		var firstVertexOriginal = null;
		texturedMesh.traverse(function (child) {
			if (!firstVertexOriginal && child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
				var pos = child.geometry.attributes.position.array;
				firstVertexOriginal = { x: pos[0], y: pos[1], z: pos[2] };
			}
		});
		if (developerModeEnabled) {
			console.log("🎨 First vertex BEFORE transform: (" + (firstVertexOriginal ? firstVertexOriginal.x.toFixed(2) : "N/A") + ", " + (firstVertexOriginal ? firstVertexOriginal.y.toFixed(2) : "N/A") + ", " + (firstVertexOriginal ? firstVertexOriginal.z.toFixed(2) : "N/A") + ")");
			console.log("🎨 Mesh group position BEFORE transform: (" + texturedMesh.position.x.toFixed(2) + ", " + texturedMesh.position.y.toFixed(2) + ", " + texturedMesh.position.z.toFixed(2) + ")");
		}

		// Step 12c.1) Position mesh group at mesh center in local Three.js space
		// On first load: OBJLoader centers vertices around mesh origin, so we position the group at mesh center
		// On reload: rebuildTexturedMesh transforms vertices to local coords, so we position the group at origin (mesh center relative to origin)
		var originX = window.threeLocalOriginX || 0;
		var originY = window.threeLocalOriginY || 0;

		// Get mesh center from surfaceData (world coordinates)
		var meshCenterWorldX = surfaceData.meshBounds ? (surfaceData.meshBounds.minX + surfaceData.meshBounds.maxX) / 2 : 0;
		var meshCenterWorldY = surfaceData.meshBounds ? (surfaceData.meshBounds.minY + surfaceData.meshBounds.maxY) / 2 : 0;

		// Convert mesh center from world to local coordinates
		var meshCenterLocalX = meshCenterWorldX - originX;
		var meshCenterLocalY = meshCenterWorldY - originY;

		if (developerModeEnabled) {
			console.log("🎨 Positioning mesh group at local coords: (" + meshCenterLocalX.toFixed(2) + ", " + meshCenterLocalY.toFixed(2) + ")");
		}

		// Position the mesh group
		texturedMesh.position.set(meshCenterLocalX, meshCenterLocalY, 0);

		// Step 12c.2) Deep clone materials and preserve textures
		texturedMesh.traverse(function (child) {
			if (child.isMesh) {
				// Clone materials and preserve textures
				if (child.material) {
					if (Array.isArray(child.material)) {
						child.material = child.material.map(function (mat) {
							var clonedMat = mat.clone();
							if (mat.map) {
								clonedMat.map = mat.map;
								clonedMat.needsUpdate = true;
							}
							return clonedMat;
						});
					} else {
						var clonedMat = child.material.clone();
						if (child.material.map) {
							clonedMat.map = child.material.map;
							clonedMat.needsUpdate = true;
						}
						child.material = clonedMat;
					}

					// DIAGNOSTIC: Material diagnostics (developer mode only)
					if (developerModeEnabled) {
						console.log("🎨 [drawSurfaceThreeJS] Material - hasMap: " + !!child.material.map + ", mapColorSpace: " + (child.material.map ? child.material.map.colorSpace : "N/A"));
						if (child.material.map && child.material.map.image) {
							console.log("🎨 Texture image: " + child.material.map.image.width + "x" + child.material.map.image.height);
						}
						console.log("🎨 Material type: " + child.material.type);
						console.log("🎨 Material color: rgb(" + (child.material.color.r * 255).toFixed(0) + ", " + (child.material.color.g * 255).toFixed(0) + ", " + (child.material.color.b * 255).toFixed(0) + ")");
						console.log("🎨 Material opacity: " + child.material.opacity + ", transparent: " + child.material.transparent);
						console.log("🎨 Material visible: " + child.material.visible + ", side: " + child.material.side);
						if (child.material.type === "MeshPhongMaterial") {
							console.log("🎨 Phong shininess: " + child.material.shininess + ", specular: " + child.material.specular.getHexString());
						}
					}
				}

				// Clone geometry to avoid modifying original
				if (child.geometry) {
					child.geometry = child.geometry.clone();
				}
			}
		});

		// Step 12d) Mesh vertices are in relative coordinates, group is positioned in local coordinates
		// No additional transformation needed

		// Step 12e) Set userData for selection
		texturedMesh.userData = { type: "surface", surfaceId: surfaceId, isTexturedMesh: true };

		// Step 12e.1) Add BVH for accelerated raycasting on large textured meshes
		var totalTriangles = 0;
		texturedMesh.traverse(function (child) {
			if (child.isMesh && child.geometry) {
				var posAttr = child.geometry.attributes.position;
				if (posAttr) {
					var triCount = child.geometry.index ? child.geometry.index.count / 3 : posAttr.count / 3;
					totalTriangles += triCount;

					// Add BVH to each child mesh if large enough
					if (triCount >= BVH_MIN_TRIANGLES) {
						try {
							var bvhStartTime = performance.now();
							child.geometry.boundsTree = new MeshBVH(child.geometry);
							child.raycast = acceleratedRaycast;
							child.userData.hasBVH = true;
							var bvhTime = performance.now() - bvhStartTime;
							console.log("🏔️ [BVH] Built for textured mesh " + surfaceId + " child (" + Math.round(triCount) + " triangles) in " + bvhTime.toFixed(2) + "ms");
						} catch (error) {
							console.warn("🏔️ [BVH] Build failed for " + surfaceId + ": " + error.message);
							child.userData.hasBVH = false;
						}
					}
				}
			}
		});
		if (developerModeEnabled) {
			console.log("🏔️ [BVH] Textured mesh " + surfaceId + " total triangles: " + Math.round(totalTriangles));
		}

		// Step 12f) Apply transparency if specified
		if (transparency < 1.0) {
			texturedMesh.traverse(function (child) {
				if (child.isMesh && child.material) {
					child.material.transparent = true;
					child.material.opacity = transparency;
				}
			});
		}

		// Step 12g) Add to scene
		window.threeRenderer.surfacesGroup.add(texturedMesh);
		window.threeRenderer.surfaceMeshMap.set(surfaceId, texturedMesh);

		// Step 12g.1) Log final mesh position and details (developer mode only)
		if (developerModeEnabled) {
			console.log("🎨 TEXTURE MESH DIAGNOSTICS for: " + surfaceId);
			console.log("🎨 Mesh group position: (" + texturedMesh.position.x.toFixed(2) + ", " + texturedMesh.position.y.toFixed(2) + ", " + texturedMesh.position.z.toFixed(2) + ")");
			console.log("🎨 Mesh visible: " + texturedMesh.visible + ", children count: " + texturedMesh.children.length);

			// Check actual vertex Z range
			var minVertexZ = Infinity,
				maxVertexZ = -Infinity;
			var firstVertex = null;
			texturedMesh.traverse(function (child) {
				if (child.isMesh && child.geometry && child.geometry.attributes.position) {
					var positions = child.geometry.attributes.position.array;
					for (var i = 0; i < positions.length; i += 3) {
						var z = positions[i + 2];
						if (z < minVertexZ) minVertexZ = z;
						if (z > maxVertexZ) maxVertexZ = z;
						if (!firstVertex) {
							firstVertex = { x: positions[i], y: positions[i + 1], z: positions[i + 2] };
						}
					}
				}
			});
			console.log("🎨 OBJ vertex Z range: " + minVertexZ.toFixed(2) + " to " + maxVertexZ.toFixed(2));
			console.log("🎨 First vertex (local coords): (" + (firstVertex ? firstVertex.x.toFixed(2) : "N/A") + ", " + (firstVertex ? firstVertex.y.toFixed(2) : "N/A") + ", " + (firstVertex ? firstVertex.z.toFixed(2) : "N/A") + ")");
			console.log("🎨 Camera position: (" + window.threeRenderer.camera.position.x.toFixed(2) + ", " + window.threeRenderer.camera.position.y.toFixed(2) + ", " + window.threeRenderer.camera.position.z.toFixed(2) + ")");
			console.log("🎨 Camera looking at: (" + window.threeRenderer.orbitCenterX.toFixed(2) + ", " + window.threeRenderer.orbitCenterY.toFixed(2) + ", " + window.threeRenderer.orbitCenterZ.toFixed(2) + ")");
		}

		// Step 12h) Request render
		if (window.threeRenderer.needsRender !== undefined) {
			window.threeRenderer.needsRender = true;
		}

		return;
	}

	// Step 12i) For textured meshes with non-texture gradient, fall through to standard rendering
	// This allows textured OBJs to use elevation-based color gradients

	// Step 12j) Analysis surface: has baked shader texture — preserve it, don't rebuild
	if ((gradient === "analysis" || gradient === "shader_overlay")
		&& surfaceData && surfaceData.isAnalysisSurface) {
		var existingAnalysisMesh = window.threeRenderer.surfaceMeshMap.get(surfaceId);
		if (existingAnalysisMesh) {
			// Mesh already has baked texture or direct shader — ensure visible and in scene
			if (!existingAnalysisMesh.parent) {
				window.threeRenderer.surfacesGroup.add(existingAnalysisMesh);
			}
			existingAnalysisMesh.visible = true;
			return; // CRITICAL: Don't rebuild — preserve existing analysis mesh
		}
		// No mesh in surfaceMeshMap — need to rebuild
		// Direct shader surfaces (non-horizontal): re-create ShaderMaterial mesh
		if (surfaceData.isDirectShaderAnalysis && surfaceData.analysisModelName) {
			_rebuildDirectShaderAnalysisMesh(surfaceId, surfaceData);
			return;
		}
		// Baked texture surfaces (horizontal): rebuild from stored canvas/texture
		if (surfaceData.analysisTexture && surfaceData.analysisUVBounds) {
			_rebuildAnalysisMeshFromTexture(surfaceId, surfaceData);
			return;
		}
		// No canvas — try to rebuild from GLB (page reload from IndexedDB)
		if (surfaceData.analysisGLB) {
			rebuildAnalysisFromGLB(surfaceId, surfaceData.analysisGLB, {
				modelName: surfaceData.analysisModelName,
				params: surfaceData.analysisParams,
				uvBounds: surfaceData.analysisUVBounds
			}).then(function() {
				// Trigger redraw so 2D cache picks up the restored analysisCanvas
				if (window.drawData) {
					window.drawData(window.allBlastHoles, window.selectedHole);
				}
			});
			return;
		}
		// Fallback: no GLB, fall through to vertex coloring
	}

	// Step 9a) Standard surface rendering
	// World-to-local offset: passed to createSurface so it transforms inline
	// (avoids creating 13M+ intermediate triangle objects via .map())
	var originX = window.threeLocalOriginX || 0;
	var originY = window.threeLocalOriginY || 0;

	// Debug logs - only in developer mode
	if (developerModeEnabled) {
		console.log("🔺 [drawSurfaceThreeJS] Processing " + triangles.length + " triangles for " + surfaceId);
	}

	// Step 10) Create color function for this surface
	var colorFunction;

	// Step 10a) Get custom min/max limits from surface data if available
	var surfaceMinLimit = surfaceData && surfaceData.minLimit !== null && surfaceData.minLimit !== undefined ? surfaceData.minLimit : null;
	var surfaceMaxLimit = surfaceData && surfaceData.maxLimit !== null && surfaceData.maxLimit !== undefined ? surfaceData.maxLimit : null;

	// Step 10b) Handle hillshade - use solid color instead of elevation gradient
	if (gradient === "hillshade") {
		var hillshadeHex = surfaceData && surfaceData.hillshadeColor ? surfaceData.hillshadeColor : "#808080";
		if (developerModeEnabled) {
			console.log("🎨 [drawSurfaceThreeJS] Hillshade mode - surfaceId: " + surfaceId + ", hillshadeColor from data: " + (surfaceData ? surfaceData.hillshadeColor : "N/A") + ", using: " + hillshadeHex);
		}
		// Step 10b-1) Convert hex color to Three.js RGB format
		var fixedColor = hexToThreeColor(hillshadeHex);
		colorFunction = function (z) {
			return fixedColor;
		};
	} else {
		// Step 10c) Regular elevation-based color gradient with custom limits support
		colorFunction = function (z) {
			var rgbString = window.elevationToColor(z, minZ, maxZ, gradient, surfaceMinLimit, surfaceMaxLimit);
			return window.rgbStringToThreeColor(rgbString);
		};
	}

	// Step 11) Check if surface already exists to prevent duplicates
	var existingSurfaceMesh = window.threeRenderer.surfaceMeshMap.get(surfaceId);
	if (existingSurfaceMesh) {
		// Already in scene, just ensure visibility
		existingSurfaceMesh.visible = true;
		return; // CRITICAL: Return here to prevent adding duplicate meshes!
	}

	// Step 11b) Create mesh with vertex colors — pass origin offsets so
	// createSurface transforms world→local inline (no intermediate copy)
	var surfaceMesh = GeometryFactory.createSurface(triangles, colorFunction, transparency, {
		originX: originX,
		originY: originY
	});

	// Step 11c) Check if mesh creation succeeded (returns null if no valid triangles)
	if (!surfaceMesh) {
		console.warn("⚠️ [drawSurfaceThreeJS] Failed to create surface mesh for " + surfaceId + " - no valid triangles");
		return;
	}

	// Flyrock shroud: lit (Phong) so it darkens with terrain on the shadow side,
	// keeping the see-through effect consistent from all viewing angles.
	if (surfaceData && surfaceData.isFlyrockShroud && surfaceMesh.material) {
		surfaceMesh.material.side = THREE.DoubleSide;
		surfaceMesh.material.transparent = true;
		surfaceMesh.material.depthWrite = false;
		surfaceMesh.renderOrder = 999; // render after terrain so depth test works correctly
	}

	surfaceMesh.userData = { type: "surface", surfaceId: surfaceId };

	window.threeRenderer.surfacesGroup.add(surfaceMesh);
	window.threeRenderer.surfaceMeshMap.set(surfaceId, surfaceMesh);
}

// Step 13) Draw contour lines in Three.js (positioned at collar elevation)
export function drawContoursThreeJS(contourLinesArray, color, allBlastHoles) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!contourLinesArray || contourLinesArray.length === 0) return;

	// Check if contours already exist to prevent duplicates
	var hasExistingContours = window.threeRenderer.contoursGroup.children.some(function (child) {
		return child.userData && child.userData.type === "contourLines";
	});
	if (hasExistingContours) {
		return; // CRITICAL: Prevent duplicate contours
	}

	// Step 13a) Pass allBlastHoles and worldToThreeLocal for collar Z positioning
	const contourGroup = GeometryFactory.createContourLines(contourLinesArray, color, allBlastHoles, window.worldToThreeLocal);
	contourGroup.userData = { type: "contourLines" };
	window.threeRenderer.contoursGroup.add(contourGroup);

	// Step 13b) Add 3D text labels for each contour level (matching 2D overlay behavior)
	const interval = window.intervalAmount || 100;

	for (let level = 0; level < contourLinesArray.length; level++) {
		const contourLevel = contourLinesArray[level];
		if (!contourLevel || contourLevel.length === 0) continue;

		const contourTime = level * interval;
		const labelText = contourTime + "ms";
		const totalLines = contourLevel.length;

		// Step 13c) Add labels at 1/3 and 2/3 marks of this contour level
		const oneThirdMark = Math.floor(totalLines / 3);
		const twoThirdsMark = Math.floor(totalLines * 2 / 3);

		for (let i = 0; i < contourLevel.length; i++) {
			if (i === oneThirdMark || i === twoThirdsMark) {
				const line = contourLevel[i];
				if (!line || !line[0] || !line[1]) continue;

				// Step 13d) Calculate midpoint of the line segment
				const midX = (line[0].x + line[1].x) / 2;
				const midY = (line[0].y + line[1].y) / 2;

				// Step 13e) Find nearest hole for Z elevation
				const nearestHole = GeometryFactory.findNearestHole(midX, midY, allBlastHoles);
				const midZ = nearestHole ? nearestHole.startZLocation || 0 : 0;

				// Step 13f) Convert to local coordinates
				const local = window.worldToThreeLocal ? window.worldToThreeLocal(midX, midY) : { x: midX, y: midY };

				// Step 13g) Create text label for contour (billboarded, italicized, dark/light mode aware)
				// Step 13g.1) Use white text in dark mode, black in light mode
				const labelColor = window.darkModeEnabled ? "#FFFFFF" : "#000000";
				const textMesh = GeometryFactory.createContourLabel(
					local.x,
					local.y,
					midZ + 0.5, // Slightly above the line
					labelText,
					12,
					labelColor
				);

				if (textMesh) {
					textMesh.userData = { type: "contourLabel", time: contourTime, billboard: true };
					window.threeRenderer.contoursGroup.add(textMesh);
				}
			}
		}
	}
}

// Step 14) Draw direction arrows in Three.js (positioned at collar elevation)
export function drawDirectionArrowsThreeJS(directionArrows, allBlastHoles) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Check if direction arrows already exist to prevent duplicates
	var hasExistingArrows = window.threeRenderer.contoursGroup.children.some(function (child) {
		return child.userData && child.userData.type === "directionArrows";
	});
	if (hasExistingArrows) {
		return; // CRITICAL: Prevent duplicate direction arrows
	}

	// Step 14a) Pass allBlastHoles and worldToThreeLocal for collar Z positioning
	const arrowGroup = GeometryFactory.createDirectionArrows(directionArrows, allBlastHoles, window.worldToThreeLocal);
	arrowGroup.userData = { type: "directionArrows" };
	window.threeRenderer.contoursGroup.add(arrowGroup);
}

// Step 15) Draw background image in Three.js
// zElevation parameter positions image at specific Z level (default uses drawingZLevel)
export function drawBackgroundImageThreeJS(imageId, imageCanvas, bbox, transparency, zElevation) {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// Convert world bbox to local Three.js coordinates
	// bbox format: [minX, minY, maxX, maxY] in world coordinates
	const minLocal = window.worldToThreeLocal(bbox[0], bbox[1]);
	const maxLocal = window.worldToThreeLocal(bbox[2], bbox[3]);

	// Create local bbox
	const localBbox = [minLocal.x, minLocal.y, maxLocal.x, maxLocal.y];

	if (developerModeEnabled) {
		console.log("🖼️ [3D IMAGE COORDS] World bbox:", bbox, "-> Local bbox:", localBbox);
	}

	const imageMesh = GeometryFactory.createImagePlane(imageCanvas, localBbox, transparency, zElevation);

	// Check if image plane was created successfully
	if (!imageMesh) {
		console.warn("Failed to create image plane for imageId:", imageId);
		return;
	}

	// Check if image already exists to prevent duplicates
	var existingImage = null;
	window.threeRenderer.imagesGroup.children.forEach(function (child) {
		if (child.userData && child.userData.imageId === imageId) {
			existingImage = child;
		}
	});
	if (existingImage) {
		existingImage.visible = true;
		return; // CRITICAL: Prevent duplicate images
	}

	imageMesh.userData = {
		type: "image",
		imageId: imageId
	};

	window.threeRenderer.imagesGroup.add(imageMesh);
}

// Step 16) Draw connector line in Three.js
export function drawConnectorThreeJS(fromHole, toHole, color, curve, delayText, connScale) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!fromHole || !toHole) return;

	// Step 16a) Convert world coordinates to local Three.js coordinates
	const fromLocal = window.worldToThreeLocal(fromHole.startXLocation, fromHole.startYLocation);
	const toLocal = window.worldToThreeLocal(toHole.startXLocation, toHole.startYLocation);

	// Step 16b) Use collar Z elevations
	const fromZ = fromHole.startZLocation || 0;
	const toZ = toHole.startZLocation || 0;

	// Step 16c) Check if self-connecting (same hole)
	const isSelfConnecting = fromHole.entityName === toHole.entityName && fromHole.holeID === toHole.holeID;

	// Step 16d) Create connector line geometry
	// For self-connecting holes, use same position for both ends
	const connectorGroup = GeometryFactory.createConnectorLine(
		fromLocal.x,
		fromLocal.y,
		fromZ,
		isSelfConnecting ? fromLocal.x : toLocal.x, // Use same position for self-connecting
		isSelfConnecting ? fromLocal.y : toLocal.y, // Use same position for self-connecting
		toZ,
		color,
		curve || 0,
		delayText,
		connScale || 100
	);

	// Step 16d) Add metadata for selection
	var fromHoleKey = fromHole.entityName + ":::" + fromHole.holeID;
	var toHoleKey = toHole.entityName + ":::" + toHole.holeID;

	// Check if connector already exists for this hole pair to prevent duplicates
	var hasExistingConnector = window.threeRenderer.connectorsGroup.children.some(function (child) {
		return child.userData && child.userData.type === "connector" && child.userData.fromHoleId === fromHoleKey && child.userData.toHoleId === toHoleKey;
	});
	if (hasExistingConnector) {
		return; // CRITICAL: Prevent duplicate connectors
	}

	connectorGroup.userData = {
		type: "connector",
		fromHoleId: fromHoleKey,
		toHoleId: toHoleKey
	};

	window.threeRenderer.connectorsGroup.add(connectorGroup);
}

// Step 16b) Draw connector delay text ONLY in Three.js (separate from connector line)
// This allows showing delay values even when connector arrows are hidden
export function drawConnectorDelayTextThreeJS(fromHole, toHole, color, curve, delayValue) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!fromHole || !toHole) return;
	if (delayValue === null || delayValue === undefined) return;

	// Step 16b.1) Convert world coordinates to local Three.js coordinates
	const fromLocal = window.worldToThreeLocal(fromHole.startXLocation, fromHole.startYLocation);
	const toLocal = window.worldToThreeLocal(toHole.startXLocation, toHole.startYLocation);
	const fromZ = fromHole.startZLocation || 0;
	const toZ = toHole.startZLocation || 0;

	// Step 16b.2) Create unique key for this delay text
	var fromHoleKey = fromHole.entityName + ":::" + fromHole.holeID;
	var toHoleKey = toHole.entityName + ":::" + toHole.holeID;
	var textKey = "delayText_" + fromHoleKey + "_" + toHoleKey;

	// Step 16b.3) Check if delay text already exists for this hole pair
	var hasExistingText = window.threeRenderer.connectorsGroup.children.some(function (child) {
		return child.userData && child.userData.type === "standaloneDelayText" && child.userData.textKey === textKey;
	});
	if (hasExistingText) {
		return; // Prevent duplicate delay text
	}

	// Step 16b.4) Create delay text using GeometryFactory
	const textGroup = GeometryFactory.createConnectorDelayText(fromLocal.x, fromLocal.y, fromZ, toLocal.x, toLocal.y, toZ, color, curve || 0, delayValue);

	if (textGroup) {
		textGroup.userData = {
			type: "standaloneDelayText",
			textKey: textKey,
			fromHoleId: fromHoleKey,
			toHoleId: toHoleKey
		};
		window.threeRenderer.connectorsGroup.add(textGroup);
	}
}

//TODO: This is too verbose for it to be rendered in the scene! We should have a shared 2D canvas overlay that displays the selected holes and their IDs. That both 2D and 3D use.
// Step 17) Draw tool prompt text in Three.js
export function drawToolPromptThreeJS(text, position, color) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!text || text === "") return;

	// Step 17a) Convert world coordinates to local Three.js coordinates
	const local = window.worldToThreeLocal(position.x, position.y);
	const z = position.z || 0;

	// Step 17b) Parse color (can be RGBA string or hex)
	let textColor = color;
	if (color && color.startsWith("rgba")) {
		// Extract RGB from RGBA for text sprite (opacity handled separately if needed)
		const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (match) {
			const r = parseInt(match[1]);
			const g = parseInt(match[2]);
			const b = parseInt(match[3]);
			textColor = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
		}
	}

	// Step 17c) Split multiline text
	const lines = text.split("\n");
	const fontSize = 12;
	const lineHeight = 16;
	const offsetY = 20; // Offset above hole

	// Step 17d) Create text sprites for each line
	lines.forEach((line, index) => {
		if (line.trim() === "") return;
		const textSprite = GeometryFactory.createKADText(
			local.x,
			local.y + offsetY + index * lineHeight,
			z + 1, // Slightly above collar
			line,
			fontSize,
			textColor,
			null
		);
		window.threeRenderer.kadGroup.add(textSprite);
	});
}

// Step 18) Highlight selected hole in Three.js (matching 2D style)
export function highlightSelectedHoleThreeJS(hole, highlightType) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!hole) return;

	// Step 18a) Convert world coordinates to local Three.js coordinates
	const local = window.worldToThreeLocal(hole.startXLocation, hole.startYLocation);
	const z = hole.startZLocation || 0;

	// Step 18a.1) Convert collar and toe coordinates to local Three.js coordinates for tube geometry
	const collarLocal = window.worldToThreeLocal(hole.startXLocation, hole.startYLocation);
	const collarZ = hole.startZLocation || 0;
	const toeLocal = window.worldToThreeLocal(hole.endXLocation, hole.endYLocation);
	const toeZ = hole.endZLocation || 0;

	// Step 18b) Determine colors based on highlight type
	let fillColor, strokeColor, radius;

	const holeDiameter = parseFloat(hole.holeDiameter) || 0;
	// Step 18b.1) Radius = 1m + hole diameter (in meters)
	// Convert hole diameter from mm to meters, then add 1m
	const holeDiameterMeters = holeDiameter / 1000; // Convert mm to meters
	const baseRadius = 1.0 + holeDiameterMeters; // 1m + hole diameter in meters

	switch (highlightType) {
		case "first":
			// First connector hole: green
			fillColor = "rgba(0, 255, 0, 0.2)";
			strokeColor = "rgba(0, 190, 0, .8)";
			radius = baseRadius;
			break;
		case "second":
			// Second connector hole: yellow
			fillColor = "rgba(255, 255, 0, 0.2)";
			strokeColor = "rgba(255, 200, 0, .8)";
			radius = baseRadius;
			break;
		case "selected":
		case "multi":
			// Regular selection: pink/magenta
			fillColor = "rgba(255, 0, 150, 0.2)";
			strokeColor = "rgba(255, 0, 150, .8)";
			radius = baseRadius;
			break;
		case "animation-playing":
			// Animation playing: orange/yellow
			fillColor = "rgba(255, 0, 0, 0.4)";
			strokeColor = "rgba(250, 250, 0, 0.8)";
			radius = baseRadius + 0.5;
			break;
		case "animation-paused":
			// Animation paused: green
			fillColor = "rgba(0, 255, 0, 0.2)";
			strokeColor = "rgba(0, 255, 0, 0.6)";
			radius = baseRadius + 0.5;
			break;
		default:
			fillColor = "rgba(255, 0, 150, 0.2)";
			strokeColor = "rgba(255, 0, 150, .8)";
			radius = baseRadius;
	}

	// Step 18c) Create highlight geometry with collar and toe coordinates for tube
	const highlightGroup = GeometryFactory.createSelectionHighlight(local.x, local.y, z, radius, fillColor, strokeColor, collarLocal.x, collarLocal.y, collarZ, toeLocal.x, toeLocal.y, toeZ);

	// Step 18d) Add metadata
	highlightGroup.userData = {
		type: "selectionHighlight",
		holeId: hole.entityName + ":::" + hole.holeID,
		highlightType: highlightType
	};

	window.threeRenderer.holesGroup.add(highlightGroup);
}

// Step 18.5) Highlight selected KAD point in Three.js (matching 2D style)
export function highlightSelectedKADPointThreeJS(kadObject, highlightType) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!kadObject) return;

	// Step 18.5a) Convert world coordinates to local Three.js coordinates
	const local = window.worldToThreeLocal(kadObject.pointXLocation, kadObject.pointYLocation);
	const z = kadObject.pointZLocation || 0;

	// Step 18.5b) Determine colors based on highlight type
	let color, baseRadius;

	switch (highlightType) {
		case "selected":
		case "multi":
			// Regular selection: pink/magenta (matching holes and canvas3DDrawSelection.js)
			color = "rgba(255, 0, 150, .8)";
			baseRadius = 1.0; // Base radius in world units
			break;
		default:
			color = "rgba(255, 0, 150, .8)";
			baseRadius = 1.0;
	}

	// Step 18.5c) Create highlight using GeometryFactory.createKADPointHighlight
	// This matches the style in canvas3DDrawSelection.js:193 - uses Points geometry with circular texture
	// Points always face camera and maintain consistent screen-space size
	const highlightMesh = GeometryFactory.createKADPointHighlight(local.x, local.y, z, baseRadius, color);

	// Step 18.5d) Add metadata
	const kadId = kadObject.entityName + ":::" + kadObject.elementIndex;
	highlightMesh.userData = {
		type: "kadHighlight",
		kadId: kadId,
		highlightType: highlightType
	};

	window.threeRenderer.kadGroup.add(highlightMesh);
}

// Step 18.6) Clear vertex selection highlights in Three.js
// Call this before drawing new highlights to prevent accumulation
export function clearVertexHighlightsThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	var kadGroup = window.threeRenderer.kadGroup;
	if (!kadGroup) return;

	var toRemove = [];
	kadGroup.children.forEach(function(child) {
		if (child.userData && (child.userData.type === "vertexHighlight" || child.userData.type === "vertexSelectionHighlight")) {
			toRemove.push(child);
		}
	});

	toRemove.forEach(function(obj) {
		kadGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) {
			if (Array.isArray(obj.material)) {
				obj.material.forEach(function(mat) { mat.dispose(); });
			} else {
				obj.material.dispose();
			}
		}
	});
}

// Step 18.6b) Clear KAD selection highlights in Three.js
// Call this before drawing new highlights to prevent accumulation
export function clearKADSelectionHighlightsThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	var kadGroup = window.threeRenderer.kadGroup;
	if (!kadGroup) return;

	var toRemove = [];
	kadGroup.children.forEach(function(child) {
		if (child.userData && child.userData.type === "kadSelectionHighlight") {
			toRemove.push(child);
		}
	});

	toRemove.forEach(function(obj) {
		kadGroup.remove(obj);
		// Dispose children if it's a group
		if (obj.traverse) {
			obj.traverse(function(subObj) {
				if (subObj.geometry) subObj.geometry.dispose();
				if (subObj.material) {
					if (Array.isArray(subObj.material)) {
						subObj.material.forEach(function(mat) { mat.dispose(); });
					} else {
						subObj.material.dispose();
					}
				}
			});
		}
	});
}

// Step 19) Draw connection stadium zone (multi-connector indicator) in Three.js
// Now accepts WORLD coordinates for toMousePos and converts to local internally
export function drawConnectStadiumZoneThreeJS(fromHole, toMousePos, connectAmount) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!fromHole || !toMousePos) return;

	// Step 19a) Validate inputs
	if (!isFinite(fromHole.startXLocation) || !isFinite(fromHole.startYLocation) || !isFinite(toMousePos.x) || !isFinite(toMousePos.y) || !isFinite(connectAmount) || connectAmount <= 0) {
		console.warn("drawConnectStadiumZoneThreeJS: Invalid inputs", {
			fromHole: fromHole ? { x: fromHole.startXLocation, y: fromHole.startYLocation, z: fromHole.startZLocation } : null,
			toMousePos: toMousePos,
			connectAmount: connectAmount
		});
		return;
	}

	// Step 19b) Convert fromHole to local coordinates
	const fromLocal = window.worldToThreeLocal(fromHole.startXLocation, fromHole.startYLocation);

	// Step 19b.1) Convert toMousePos to local - SAME as mouse indicator does
	const toLocal = window.worldToThreeLocal(toMousePos.x, toMousePos.y);

	// Step 19c) Extract Z coordinates separately (Z coordinates stay as-is, no conversion needed)
	const fromZ = fromHole.startZLocation || 0;
	const toZ = toMousePos.z !== undefined && isFinite(toMousePos.z) ? toMousePos.z : fromHole.startZLocation || 0;

	// DEBUG: Log coordinate conversion for stadium zone
	if (window.developerModeEnabled) {
		console.log("🏟️ Stadium Zone Coords:");
		console.log("  fromHole world:", fromHole.startXLocation.toFixed(2), fromHole.startYLocation.toFixed(2), fromZ.toFixed(2));
		console.log("  toMousePos world:", toMousePos.x.toFixed(2), toMousePos.y.toFixed(2), toZ.toFixed(2));
		console.log("  threeLocalOrigin:", window.threeLocalOriginX.toFixed(2), window.threeLocalOriginY.toFixed(2));
		console.log("  fromLocal:", fromLocal.x.toFixed(2), fromLocal.y.toFixed(2));
		console.log("  toLocal:", toLocal.x.toFixed(2), toLocal.y.toFixed(2));
	}

	const radius = connectAmount;

	// Step 19d) Create simplified stadium zone using MeshLineModified
	const stadiumGroup = GeometryFactory.createStadiumZone(
		fromLocal.x,
		fromLocal.y,
		fromZ,
		toLocal.x,
		toLocal.y,
		toZ,
		radius,
		"rgba(0, 255, 0, 0.6)", // stroke - more opaque green
		"rgba(0, 255, 0, 0.2)" // fill - semi-transparent green
	);

	// Step 19e) Add metadata
	stadiumGroup.userData = {
		type: "stadiumZone",
		fromHoleId: fromHole.entityName + ":::" + fromHole.holeID
	};

	window.threeRenderer.connectorsGroup.add(stadiumGroup);

	// Request render to display the stadium zone
	if (window.threeRenderer && typeof window.threeRenderer.requestRender === "function") {
		window.threeRenderer.requestRender();
	} else if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Step 19.1) Draw renumber stadium zone (MAGENTA - matching 2D) in Three.js
// Used for RenumberHoles tool visualization
export function drawRenumberStadiumZoneThreeJS(fromHole, toMousePos, zoneWidth) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!fromHole || !toMousePos) return;

	// Step 19.1a) Validate inputs
	if (!isFinite(fromHole.startXLocation) || !isFinite(fromHole.startYLocation) || !isFinite(toMousePos.x) || !isFinite(toMousePos.y) || !isFinite(zoneWidth) || zoneWidth <= 0) {
		console.warn("drawRenumberStadiumZoneThreeJS: Invalid inputs", {
			fromHole: fromHole ? { x: fromHole.startXLocation, y: fromHole.startYLocation, z: fromHole.startZLocation } : null,
			toMousePos: toMousePos,
			zoneWidth: zoneWidth
		});
		return;
	}

	// Step 19.1b) Convert fromHole to local coordinates
	const fromLocal = window.worldToThreeLocal(fromHole.startXLocation, fromHole.startYLocation);

	// Step 19.1b.1) Convert toMousePos to local
	const toLocal = window.worldToThreeLocal(toMousePos.x, toMousePos.y);

	// Step 19.1c) Extract Z coordinates
	const fromZ = fromHole.startZLocation || 0;
	const toZ = toMousePos.z !== undefined && isFinite(toMousePos.z) ? toMousePos.z : fromHole.startZLocation || 0;

	// DEBUG: Log coordinate conversion
	if (window.developerModeEnabled) {
		console.log("🔢 Renumber Stadium Zone Coords:");
		console.log("  fromHole world:", fromHole.startXLocation.toFixed(2), fromHole.startYLocation.toFixed(2), fromZ.toFixed(2));
		console.log("  toMousePos world:", toMousePos.x.toFixed(2), toMousePos.y.toFixed(2), toZ.toFixed(2));
		console.log("  fromLocal:", fromLocal.x.toFixed(2), fromLocal.y.toFixed(2));
		console.log("  toLocal:", toLocal.x.toFixed(2), toLocal.y.toFixed(2));
	}

	// Step 19.1d) Create stadium zone using GeometryFactory - MAGENTA color matching 2D
	const stadiumGroup = GeometryFactory.createStadiumZone(
		fromLocal.x,
		fromLocal.y,
		fromZ,
		toLocal.x,
		toLocal.y,
		toZ,
		zoneWidth,
		"rgba(255, 0, 255, 0.6)", // stroke - magenta (matching 2D)
		"rgba(255, 0, 255, 0.15)" // fill - semi-transparent magenta (matching 2D)
	);

	// Step 19.1e) Add metadata
	stadiumGroup.userData = {
		type: "renumberStadiumZone",
		fromHoleId: fromHole.entityName + ":::" + fromHole.holeID
	};

	window.threeRenderer.connectorsGroup.add(stadiumGroup);

	// Request render
	if (window.threeRenderer && typeof window.threeRenderer.requestRender === "function") {
		window.threeRenderer.requestRender();
	} else if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Step 19.2) Draw reorder rows line with burden arrow (CYAN/ORANGE - matching 2D) in Three.js
// Used for ReorderRows tool visualization
export function drawReorderRowsLineThreeJS(fromHole, toPos, showArrow, directionInfo) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!fromHole || !toPos) return;

	// Step 19.2a) Validate inputs
	if (!isFinite(fromHole.startXLocation) || !isFinite(fromHole.startYLocation) || !isFinite(toPos.x) || !isFinite(toPos.y)) {
		console.warn("drawReorderRowsLineThreeJS: Invalid inputs", {
			fromHole: fromHole ? { x: fromHole.startXLocation, y: fromHole.startYLocation } : null,
			toPos: toPos
		});
		return;
	}

	// Step 19.2b) Convert to local coordinates
	const fromLocal = window.worldToThreeLocal(fromHole.startXLocation, fromHole.startYLocation);
	const toLocal = window.worldToThreeLocal(toPos.x, toPos.y);
	const fromZ = fromHole.startZLocation || 0;
	const toZ = toPos.z !== undefined && isFinite(toPos.z) ? toPos.z : fromZ;

	// Step 19.2c) Create group to hold line and arrow
	const group = new THREE.Group();
	group.userData = {
		type: "reorderRowsLine",
		fromHoleId: fromHole.entityName + ":::" + fromHole.holeID
	};

	// Step 19.2d) Create main direction line (CYAN - matching 2D)
	const lineGeometry = new THREE.BufferGeometry();
	const positions = new Float32Array([
		fromLocal.x, fromLocal.y, fromZ,
		toLocal.x, toLocal.y, toZ
	]);
	lineGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

	const lineMaterial = new THREE.LineBasicMaterial({
		color: new THREE.Color(0, 0.78, 1), // rgba(0, 200, 255) in normalized
		linewidth: 3,
		transparent: true,
		opacity: 0.9
	});
	const line = new THREE.Line(lineGeometry, lineMaterial);
	group.add(line);

	// Step 19.2e) Create endpoint spheres (CYAN - matching 2D circles)
	const sphereGeometry = new THREE.SphereGeometry(0.5, 12, 12);
	const sphereMaterial = new THREE.MeshBasicMaterial({
		color: new THREE.Color(0, 0.78, 1),
		transparent: true,
		opacity: 0.9
	});

	const startSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
	startSphere.position.set(fromLocal.x, fromLocal.y, fromZ);
	group.add(startSphere);

	const endSphere = new THREE.Mesh(sphereGeometry, sphereMaterial.clone());
	endSphere.position.set(toLocal.x, toLocal.y, toZ);
	group.add(endSphere);

	// Step 19.2f) Draw burden direction arrow if second hole selected
	if (showArrow && directionInfo) {
		// Calculate midpoint
		const midX = (fromLocal.x + toLocal.x) / 2;
		const midY = (fromLocal.y + toLocal.y) / 2;
		const midZ = (fromZ + toZ) / 2;

		// Arrow length in world units (meters)
		const arrowLength = 8;
		const arrowHeadLength = 2;
		const arrowHeadWidth = 1;

		// Get perpendicular direction for burden
		// NOTE: perpX/perpY already have the flip applied in getRowDirectionInfo()
		// Do NOT flip again here - that was causing double-flip bug
		let perpX = directionInfo.perpX || 0;
		let perpY = directionInfo.perpY || 0;

		// Arrow end point
		const arrowEndX = midX + perpX * arrowLength;
		const arrowEndY = midY + perpY * arrowLength;

		// Create arrow shaft (ORANGE - matching 2D)
		const arrowGeometry = new THREE.BufferGeometry();
		const arrowPositions = new Float32Array([
			midX, midY, midZ,
			arrowEndX, arrowEndY, midZ
		]);
		arrowGeometry.setAttribute("position", new THREE.BufferAttribute(arrowPositions, 3));

		const arrowMaterial = new THREE.LineBasicMaterial({
			color: new THREE.Color(1, 0.59, 0), // rgba(255, 150, 0) in normalized
			linewidth: 3,
			transparent: true,
			opacity: 0.9
		});
		const arrowLine = new THREE.Line(arrowGeometry, arrowMaterial);
		group.add(arrowLine);

		// Create arrowhead using cone
		const coneGeometry = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
		const coneMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(1, 0.59, 0),
			transparent: true,
			opacity: 0.9
		});
		const cone = new THREE.Mesh(coneGeometry, coneMaterial);
		cone.position.set(arrowEndX, arrowEndY, midZ);

		// Rotate cone to point in the perpendicular direction
		// ConeGeometry points along Y axis by default
		const angle = Math.atan2(perpY, perpX);
		cone.rotation.z = angle - Math.PI / 2; // Adjust for cone's default Y-up orientation

		group.add(cone);

		// Add "Row 1" label using GeometryFactory.createKADText
		const labelX = arrowEndX + perpX * 2;
		const labelY = arrowEndY + perpY * 2;
		const labelText = GeometryFactory.createKADText(labelX, labelY, midZ + 0.5, "Row 1→", 15, "rgba(255, 150, 0, 1)");
		if (labelText) {
			group.add(labelText);
		}
	}

	window.threeRenderer.connectorsGroup.add(group);

	// Request render
	if (window.threeRenderer && typeof window.threeRenderer.requestRender === "function") {
		window.threeRenderer.requestRender();
	} else if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Step 19.5) Draw mouse position indicator (crosshairs) in Three.js
// Now uses view plane positioning and billboard rendering
// Optional color parameter to change torus color (e.g., when drawing tools are active)
export function drawMousePositionIndicatorThreeJS(worldX, worldY, worldZ, indicatorColor) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (worldX === undefined || worldY === undefined || worldZ === undefined) return;

	// Step 19.5a) Convert world coordinates to local Three.js coordinates
	const local = window.worldToThreeLocal(worldX, worldY);
	const z = worldZ || 0;

	// Step 19.5a.1) Use provided color or apply cursor opacity setting
	const cursorOpacity = 0.2;
	let sphereColor = indicatorColor;

	// If no custom color provided, use default grey with user-defined opacity
	if (!sphereColor) {
		sphereColor = `rgba(128, 128, 128, ${cursorOpacity})`;
	} else if (sphereColor.startsWith("rgba")) {
		// If custom color provided, replace its opacity with user setting
		//sphereColor = sphereColor.replace(/[\d.]+\)$/, `${cursorOpacity})`);
	}

	// Step 19.5b) Remove existing mouse indicator if present
	const connectorsGroup = window.threeRenderer.connectorsGroup;
	const toRemove = [];
	connectorsGroup.children.forEach(child => {
		if (child.userData && child.userData.type === "mouseIndicator") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(obj => {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) {
			if (Array.isArray(obj.material)) {
				obj.material.forEach(mat => mat.dispose());
			} else {
				obj.material.dispose();
			}
		}
		// Dispose children if it's a group
		if (obj.isGroup) {
			obj.traverse(child => {
				if (child.geometry) child.geometry.dispose();
				if (child.material) {
					if (Array.isArray(child.material)) {
						child.material.forEach(mat => mat.dispose());
					} else {
						child.material.dispose();
					}
				}
			});
		}
	});

	// Step 19.5c) Create mouse position indicator sphere
	// FIX: Size should be FIXED PIXEL SIZE on screen, matching 2D canvas behavior
	// 2D canvas draws snap circle at fixed pixel radius - 3D should match this
	const snapRadiusPixels = window.snapRadiusPixels !== undefined ? window.snapRadiusPixels : 15; // Default 15px

	// Step 19.5c.1) Calculate world units that give consistent PIXEL size on screen
	// With orthographic camera: screenPixels = worldUnits * camera.zoom
	// So: worldUnits = screenPixels / camera.zoom
	// This makes cursor appear the SAME SIZE on screen regardless of zoom
	const cameraZoom = window.threeRenderer && window.threeRenderer.camera ? window.threeRenderer.camera.zoom : 1;
	const snapRadiusWorld = snapRadiusPixels / cameraZoom;

	// Step 19.5c.2) Use calculated world size (no minimum clamp - let it scale properly)
	const indicatorSize = snapRadiusWorld;

	const indicatorGroup = GeometryFactory.createMousePositionIndicator(
		local.x,
		local.y,
		z,
		indicatorSize,
		sphereColor, // Use sphere color with user-defined opacity
		false // No billboarding needed for sphere!
	);

	// Step 19.5d) Add metadata
	indicatorGroup.userData = {
		type: "mouseIndicator"
	};

	// No billboarding markup needed - sphere looks the same from all angles

	connectorsGroup.add(indicatorGroup);

	// Request render to display the mouse indicator
	if (window.threeRenderer && typeof window.threeRenderer.requestRender === "function") {
		window.threeRenderer.requestRender();
	} else if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Step 19.5.1) Draw plumb line from cursor to Drawing Z Level
// Uses connectorsGroup (same as mouse indicator) so it doesn't get cleared with KAD leading lines
// Uses simple THREE.Line for reliable vertical line rendering
export function drawPlumbLineThreeJS(fromWorldX, fromWorldY, fromWorldZ, toWorldZ, color) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (fromWorldX === undefined || fromWorldY === undefined || fromWorldZ === undefined) return;
	if (toWorldZ === undefined) return;

	// Step 19.5.1a) Convert world coordinates to local Three.js coordinates
	const fromLocal = window.worldToThreeLocal(fromWorldX, fromWorldY);

	// Step 19.5.1b) Remove existing plumb line from connectorsGroup
	const connectorsGroup = window.threeRenderer.connectorsGroup;
	const toRemove = [];
	connectorsGroup.children.forEach(child => {
		if (child.userData && child.userData.type === "plumbLine") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(obj => {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});

	// Step 19.5.1c) Define gradient colors for visibility on both light and dark backgrounds
	// Grey (#777777) at cursor/centroid end, Orange (#FFA500) at drawing plane end
	const greyColor = new THREE.Color(0x777777);   // Grey at cursor
	const orangeColor = new THREE.Color(0xFFA500); // Orange at drawing plane

	// Step 19.5.1d) Create simple vertical line using BufferGeometry with VERTEX COLORS
	// This creates a gradient from grey (cursor) to orange (drawing plane)
	const geometry = new THREE.BufferGeometry();
	const positions = new Float32Array([
		fromLocal.x, fromLocal.y, fromWorldZ,  // Start point (cursor position) - GREY
		fromLocal.x, fromLocal.y, toWorldZ     // End point (Drawing Z) - ORANGE
	]);
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

	// Step 19.5.1e) Add vertex colors for gradient effect
	const colors = new Float32Array([
		greyColor.r, greyColor.g, greyColor.b,     // Start vertex - Grey
		orangeColor.r, orangeColor.g, orangeColor.b // End vertex - Orange
	]);
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

	const material = new THREE.LineBasicMaterial({
		vertexColors: true, // Enable vertex colors for gradient
		linewidth: 2, // Note: linewidth > 1 only works on some platforms
		transparent: true,
		opacity: 0.8, // Slightly higher opacity for better visibility
		depthTest: false,
		depthWrite: false
	});

	const line = new THREE.Line(geometry, material);
	line.userData = { type: "plumbLine" };
	line.name = "plumb-line";
	line.renderOrder = 9998;
	line.frustumCulled = false;

	connectorsGroup.add(line);

	// Request render
	if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Step 19.5.2) Clear plumb line from scene
export function clearPlumbLineThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	const connectorsGroup = window.threeRenderer.connectorsGroup;
	if (!connectorsGroup) return;

	const toRemove = [];
	connectorsGroup.children.forEach(child => {
		if (child.userData && (child.userData.type === "plumbLine" || child.userData.type === "plumbLineMarker")) {
			toRemove.push(child);
		}
	});
	toRemove.forEach(obj => {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) {
			if (Array.isArray(obj.material)) {
				obj.material.forEach(mat => mat.dispose());
			} else {
				obj.material.dispose();
			}
		}
	});
}

// Step 19.5.3) Draw plumb line marker (small indicator at Drawing Z intersection)
export function drawPlumbLineMarkerThreeJS(worldX, worldY, worldZ, color) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (worldX === undefined || worldY === undefined || worldZ === undefined) return;

	const local = window.worldToThreeLocal(worldX, worldY);
	const connectorsGroup = window.threeRenderer.connectorsGroup;

	// Remove existing plumb line marker
	const toRemove = [];
	connectorsGroup.children.forEach(child => {
		if (child.userData && child.userData.type === "plumbLineMarker") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(obj => {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) {
			if (Array.isArray(obj.material)) {
				obj.material.forEach(mat => mat.dispose());
			} else {
				obj.material.dispose();
			}
		}
		if (obj.isGroup) {
			obj.traverse(child => {
				if (child.geometry) child.geometry.dispose();
				if (child.material) {
					if (Array.isArray(child.material)) {
						child.material.forEach(mat => mat.dispose());
					} else {
						child.material.dispose();
					}
				}
			});
		}
	});

	// Create smaller indicator for the plumb line endpoint
	const snapRadiusPixels = window.snapRadiusPixels !== undefined ? window.snapRadiusPixels : 15;
	const cameraZoom = window.threeRenderer && window.threeRenderer.camera ? window.threeRenderer.camera.zoom : 1;
	const indicatorSize = (snapRadiusPixels * 0.6) / cameraZoom; // 60% of normal cursor size

	const indicatorGroup = GeometryFactory.createMousePositionIndicator(
		local.x,
		local.y,
		worldZ,
		indicatorSize,
		color || "rgba(255, 165, 0, 0.4)",
		false
	);

	indicatorGroup.userData = { type: "plumbLineMarker" };
	connectorsGroup.add(indicatorGroup);

	// Request render
	if (window.threeRenderer && typeof window.threeRenderer.requestRender === "function") {
		window.threeRenderer.requestRender();
	} else if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Step 19.6) Draw KAD leading line preview in Three.js
// FIXED: Use EXACT same approach as working KAD line drawing (batched lines pattern)
// The key is: worldToThreeLocal converts coords, then use LineSegments with BufferGeometry
export function drawKADLeadingLineThreeJS(fromWorldX, fromWorldY, fromWorldZ, toWorldX, toWorldY, toWorldZ, color) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (fromWorldX === undefined || fromWorldY === undefined) return;
	if (toWorldX === undefined || toWorldY === undefined) return;

	// Step 19.6a) Convert world coordinates to local Three.js coordinates
	// This MUST happen - same as line 27784-27785 in kirra.js for working KAD lines
	var fromLocal = window.worldToThreeLocal(fromWorldX, fromWorldY);
	var toLocal = window.worldToThreeLocal(toWorldX, toWorldY);
	var fromZ = fromWorldZ || 0;
	var toZ = toWorldZ || 0;

	if (window.developerModeEnabled) {
		console.log("🔸 Leading line: world(" + fromWorldX.toFixed(2) + "," + fromWorldY.toFixed(2) + ") → local(" + fromLocal.x.toFixed(2) + "," + fromLocal.y.toFixed(2) + ")");
	}

	// Step 19.6b) Remove existing leading line from kadGroup (where visible KAD entities live)
	// FIX: Use kadGroup instead of connectorsGroup - kadGroup IS visible, connectorsGroup may not be
	var kadGroup = window.threeRenderer.kadGroup;
	if (!kadGroup) {
		console.warn("🔸 Leading line: kadGroup not found!");
		return;
	}

	var toRemove = [];
	kadGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "kadLeadingLine") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		kadGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});

	// Step 19.6c) Parse color to CSS string (required by GeometryFactory.createKADLineSegment)
	var lineColorCSS = "#00ffff"; // Default cyan
	if (color) {
		if (color.startsWith("rgba(") || color.startsWith("rgb(")) {
			var match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
			if (match) {
				var r = parseInt(match[1]);
				var g = parseInt(match[2]);
				var b = parseInt(match[3]);
				lineColorCSS = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
			}
		} else if (color.startsWith("#")) {
			lineColorCSS = color;
		}
	}

	// Step 19.6d) Create line using GeometryFactory.createKADLineSegment - SAME as visible KAD lines
	// FIX: Use LineSegments2/LineMaterial (fat lines) instead of THREE.Line (1px invisible lines)
	var line = GeometryFactory.createKADLineSegment(
		fromLocal.x,
		fromLocal.y,
		fromZ,
		toLocal.x,
		toLocal.y,
		toZ,
		3, // lineWidth in pixels (screen-space)
		lineColorCSS
	);
	line.userData = { type: "kadLeadingLine" };
	line.name = "kad-leading-line";
	line.renderOrder = 9999; // Render on top of everything else
	line.frustumCulled = false; // Prevent frustum culling from hiding the line

	// FIX: Override material settings to render on TOP of other geometry (leading line should always be visible)
	if (line.material) {
		line.material.depthTest = false; // Don't test depth - always render
		line.material.depthWrite = false; // Don't write to depth buffer
		line.material.transparent = true; // Required for proper renderOrder sorting
	}

	kadGroup.add(line);

	if (window.developerModeEnabled) {
		console.log("🔸 Leading line ADDED to kadGroup. Children:", kadGroup.children.length);
	}

	// Step 19.6e) Request render to display the leading line
	if (window.threeRenderer && typeof window.threeRenderer.requestRender === "function") {
		window.threeRenderer.requestRender();
	} else if (window.threeRenderer) {
		window.threeRenderer.needsRender = true;
	}
}

// Step 19.7) Clear KAD leading line preview in Three.js
export function clearKADLeadingLineThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	// FIX: Use kadGroup instead of connectorsGroup - must match where we added the line
	var kadGroup = window.threeRenderer.kadGroup;
	if (!kadGroup) return;

	var toRemove = [];
	kadGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "kadLeadingLine") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		kadGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});
}

//=================================================
// V2 Leading Line - Clean implementation following ruler pattern
//=================================================

// drawKADLeadingLineThreeJSV2 - Fresh implementation copying ruler exactly
export function drawKADLeadingLineThreeJSV2(fromWorldX, fromWorldY, fromWorldZ, toWorldX, toWorldY, toWorldZ, color) {
	// Step 1) Guard checks - same as ruler
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (fromWorldX === undefined || fromWorldY === undefined) return;
	if (toWorldX === undefined || toWorldY === undefined) return;

	// Step 2) Convert world coordinates to local - EXACTLY like ruler
	var fromLocal = window.worldToThreeLocal(fromWorldX, fromWorldY);
	var toLocal = window.worldToThreeLocal(toWorldX, toWorldY);
	var fromZ = fromWorldZ || 0;
	var toZ = toWorldZ || 0;

	// Step 3) Get connectorsGroup - SAME as ruler (NOT kadGroup)
	var connectorsGroup = window.threeRenderer.connectorsGroup;
	if (!connectorsGroup) return;

	// Step 4) Remove existing leading lines - same pattern as ruler
	var toRemove = [];
	connectorsGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "kadLeadingLineV2") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});

	// Step 5) Parse color - default cyan
	var lineColor = 0x00ffff;
	if (color) {
		if (color.startsWith && color.startsWith("#") && color.length >= 7) {
			lineColor = parseInt(color.slice(1, 7), 16);
		} else if (color.startsWith && (color.startsWith("rgba(") || color.startsWith("rgb("))) {
			var match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
			if (match) {
				lineColor = (parseInt(match[1]) << 16) | (parseInt(match[2]) << 8) | parseInt(match[3]);
			}
		}
	}

	// Step 6) Create line - EXACTLY like ruler (THREE.Line + LineBasicMaterial)
	var points = [new THREE.Vector3(fromLocal.x, fromLocal.y, fromZ), new THREE.Vector3(toLocal.x, toLocal.y, toZ)];
	var geometry = new THREE.BufferGeometry().setFromPoints(points);
	var material = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 2 });
	var line = new THREE.Line(geometry, material);

	// Step 7) Set userData - same pattern as ruler
	line.userData = { type: "kadLeadingLineV2" };

	// Step 8) Add to connectorsGroup - SAME as ruler
	connectorsGroup.add(line);
}

// clearKADLeadingLineThreeJSV2 - Clean up V2 leading lines
export function clearKADLeadingLineThreeJSV2() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	var connectorsGroup = window.threeRenderer.connectorsGroup;
	if (!connectorsGroup) return;

	var toRemove = [];
	connectorsGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "kadLeadingLineV2") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});
}

//=================================================
// Ruler and Protractor 3D Drawing Functions
//=================================================

// Step 19.8) Draw ruler leading line in Three.js
export function drawRulerThreeJS(startWorldX, startWorldY, startWorldZ, endWorldX, endWorldY, endWorldZ) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (startWorldX === undefined || startWorldY === undefined) return;
	if (endWorldX === undefined || endWorldY === undefined) return;

	// Step 19.8a) Convert world coordinates to local Three.js coordinates
	const startLocal = window.worldToThreeLocal(startWorldX, startWorldY);
	const endLocal = window.worldToThreeLocal(endWorldX, endWorldY);
	const startZ = startWorldZ || 0;
	const endZ = endWorldZ || 0;

	// Step 19.8b) Remove existing ruler line if present
	const connectorsGroup = window.threeRenderer.connectorsGroup;
	const toRemove = [];
	connectorsGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "rulerLine") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});

	// Step 19.8c) Create solid cyan line from start to end
	const lineColor = window.darkModeEnabled ? 0x00cccc : 0x004444;
	const points = [new THREE.Vector3(startLocal.x, startLocal.y, startZ), new THREE.Vector3(endLocal.x, endLocal.y, endZ)];

	const geometry = new THREE.BufferGeometry().setFromPoints(points);
	const material = new THREE.LineBasicMaterial({
		color: lineColor,
		linewidth: 2
	});

	const line = new THREE.Line(geometry, material);

	// Step 19.8d) Add tick marks at both ends
	const tickSize = 0.5;
	const dx = endLocal.x - startLocal.x;
	const dy = endLocal.y - startLocal.y;
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len > 0) {
		const perpX = -dy / len * tickSize;
		const perpY = dx / len * tickSize;

		// Start tick
		const startTick = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(startLocal.x - perpX, startLocal.y - perpY, startZ), new THREE.Vector3(startLocal.x + perpX, startLocal.y + perpY, startZ)]);
		const startTickLine = new THREE.Line(startTick, material.clone());
		startTickLine.userData = { type: "rulerLine" };
		connectorsGroup.add(startTickLine);

		// End tick
		const endTick = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(endLocal.x - perpX, endLocal.y - perpY, endZ), new THREE.Vector3(endLocal.x + perpX, endLocal.y + perpY, endZ)]);
		const endTickLine = new THREE.Line(endTick, material.clone());
		endTickLine.userData = { type: "rulerLine" };
		connectorsGroup.add(endTickLine);
	}

	// Step 19.8e) Add metadata
	line.userData = {
		type: "rulerLine"
	};

	connectorsGroup.add(line);
}

// Step 19.9) Clear ruler line in Three.js
export function clearRulerThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	const connectorsGroup = window.threeRenderer.connectorsGroup;
	const toRemove = [];
	connectorsGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "rulerLine") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});
}

// Step 19.10) Draw protractor (two lines + arc) in Three.js
export function drawProtractorThreeJS(centerWorldX, centerWorldY, centerWorldZ, p2WorldX, p2WorldY, p2WorldZ, p3WorldX, p3WorldY, p3WorldZ) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (centerWorldX === undefined || centerWorldY === undefined) return;

	// Step 19.10a) Convert world coordinates to local Three.js coordinates
	const centerLocal = window.worldToThreeLocal(centerWorldX, centerWorldY);
	const centerZ = centerWorldZ || 0;

	// Step 19.10b) Remove existing protractor lines if present
	const connectorsGroup = window.threeRenderer.connectorsGroup;
	const toRemove = [];
	connectorsGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "protractorLine") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});

	const lineColor = window.darkModeEnabled ? 0x00cccc : 0x004444;
	const arcColor = 0xff0000; // Red for arc

	// Step 19.10c) Draw first line (center to p2) if p2 is defined
	if (p2WorldX !== undefined && p2WorldY !== undefined) {
		const p2Local = window.worldToThreeLocal(p2WorldX, p2WorldY);
		const p2Z = p2WorldZ || 0;

		const points1 = [new THREE.Vector3(centerLocal.x, centerLocal.y, centerZ), new THREE.Vector3(p2Local.x, p2Local.y, p2Z)];
		const geometry1 = new THREE.BufferGeometry().setFromPoints(points1);
		const material1 = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 2 });
		const line1 = new THREE.Line(geometry1, material1);
		line1.userData = { type: "protractorLine" };
		connectorsGroup.add(line1);
	}

	// Step 19.10d) Draw second line (center to p3) if p3 is defined and different from center
	if (p3WorldX !== undefined && p3WorldY !== undefined && !(p3WorldX === centerWorldX && p3WorldY === centerWorldY)) {
		const p2Local = window.worldToThreeLocal(p2WorldX, p2WorldY);
		const p3Local = window.worldToThreeLocal(p3WorldX, p3WorldY);
		const p2Z = p2WorldZ || 0;
		const p3Z = p3WorldZ || 0;

		const points2 = [new THREE.Vector3(centerLocal.x, centerLocal.y, centerZ), new THREE.Vector3(p3Local.x, p3Local.y, p3Z)];
		const geometry2 = new THREE.BufferGeometry().setFromPoints(points2);
		const material2 = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 2 });
		const line2 = new THREE.Line(geometry2, material2);
		line2.userData = { type: "protractorLine" };
		connectorsGroup.add(line2);

		// Step 19.10e) Draw arc between the two lines
		const d1 = Math.sqrt(Math.pow(p2Local.x - centerLocal.x, 2) + Math.pow(p2Local.y - centerLocal.y, 2));
		const d2 = Math.sqrt(Math.pow(p3Local.x - centerLocal.x, 2) + Math.pow(p3Local.y - centerLocal.y, 2));
		const arcRadius = Math.min(d1, d2) / 3;

		if (arcRadius > 0.1) {
			// Calculate angles
			const angle1 = Math.atan2(p2Local.y - centerLocal.y, p2Local.x - centerLocal.x);
			const angle2 = Math.atan2(p3Local.y - centerLocal.y, p3Local.x - centerLocal.x);

			// Generate arc points
			var arcPoints = [];
			var startAngle = angle1;
			var endAngle = angle2;
			var angleDiff = endAngle - startAngle;

			// Normalize to [-PI, PI]
			while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
			while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

			// Draw smaller arc
			var numSegments = 32;
			for (var i = 0; i <= numSegments; i++) {
				var t = i / numSegments;
				var angle = startAngle + t * angleDiff;
				arcPoints.push(new THREE.Vector3(centerLocal.x + arcRadius * Math.cos(angle), centerLocal.y + arcRadius * Math.sin(angle), centerZ));
			}

			if (arcPoints.length > 1) {
				const arcGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
				const arcMaterial = new THREE.LineBasicMaterial({ color: arcColor, linewidth: 2 });
				const arcLine = new THREE.Line(arcGeometry, arcMaterial);
				arcLine.userData = { type: "protractorLine" };
				connectorsGroup.add(arcLine);
			}
		}
	}
}

// Step 19.11) Clear protractor lines in Three.js
export function clearProtractorThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	const connectorsGroup = window.threeRenderer.connectorsGroup;
	const toRemove = [];
	connectorsGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "protractorLine") {
			toRemove.push(child);
		}
	});
	toRemove.forEach(function (obj) {
		connectorsGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) obj.material.dispose();
	});
}

// Step 20) Draw slope map in Three.js
// OPTIMIZED: Only rebuilds when data actually changes (not every frame)
export function drawSlopeMapThreeJS(triangles, allBlastHoles) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!triangles || triangles.length === 0) return;

	// Step 20.0) FAST PATH: Skip rebuild if data hasn't changed
	if (shouldSkipSlope3DRebuild()) {
		return; // Geometry already exists and is valid
	}

	// Step 20.0a) Check if slope map already exists to prevent duplicates
	var hasExistingSlope = window.threeRenderer.surfacesGroup.children.some(function (child) {
		return child.userData && child.userData.type === "slopeMap";
	});
	if (hasExistingSlope) {
		// Mark as built and return (geometry exists)
		markSlope3DBuilt();
		return;
	}

	// Step 20a) Create slope surface geometry
	const slopeMesh = GeometryFactory.createSlopeSurface(triangles, allBlastHoles, window.worldToThreeLocal, 1.0);

	// Step 20b) Add metadata and to scene (if mesh was created)
	if (slopeMesh) {
		slopeMesh.userData = {
			type: "slopeMap"
		};
		window.threeRenderer.surfacesGroup.add(slopeMesh);
	}

	// Step 20c) Add text labels for slope values on each triangle
	for (const triangle of triangles) {
		if (!triangle || triangle.length !== 3) continue;

		// Step 20c.1) Calculate triangle centroid
		const centroidX = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
		const centroidY = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;

		// Step 20c.2) Find nearest hole for Z elevation
		const nearestHole = GeometryFactory.findNearestHole(centroidX, centroidY, allBlastHoles);
		const centroidZ = nearestHole ? nearestHole.startZLocation || 0 : 0;

		// Step 20c.3) Calculate slope angle using GeometryFactory helper
		const triangleForSlope = [[triangle[0][0], triangle[0][1], triangle[0][2] || centroidZ], [triangle[1][0], triangle[1][1], triangle[1][2] || centroidZ], [triangle[2][0], triangle[2][1], triangle[2][2] || centroidZ]];
		const slopeAngle = GeometryFactory.getDipAngle(triangleForSlope);

		// Step 20c.4) Convert to local coordinates
		const local = window.worldToThreeLocal ? window.worldToThreeLocal(centroidX, centroidY) : { x: centroidX, y: centroidY };

		// Step 20c.5) Create text label showing slope angle
		const labelText = slopeAngle.toFixed(1) + "°";
		const textColor = window.darkModeEnabled ? "#FFFFFF" : "#000000";
		const textMesh = GeometryFactory.createKADText(
			local.x,
			local.y,
			centroidZ + 0.3,
			labelText,
			8,
			textColor,
			null // No background
		);

		if (textMesh) {
			textMesh.userData = { type: "slopeLabel" };
			window.threeRenderer.surfacesGroup.add(textMesh);
		}
	}

	// Step 20d) Mark as built for cache
	markSlope3DBuilt();
	console.log("📦 3D Slope map built with " + triangles.length + " triangles");
}

// Step 21) Draw burden relief map in Three.js
// OPTIMIZED: Only rebuilds when data actually changes (not every frame)
export function drawBurdenReliefMapThreeJS(triangles, allBlastHoles) {
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!triangles || triangles.length === 0) return;

	// Step 21.0) FAST PATH: Skip rebuild if data hasn't changed
	if (shouldSkipRelief3DRebuild()) {
		return; // Geometry already exists and is valid
	}

	// Step 21.0a) Check if relief map already exists to prevent duplicates
	var hasExistingRelief = window.threeRenderer.surfacesGroup.children.some(function (child) {
		return child.userData && child.userData.type === "burdenReliefMap";
	});
	if (hasExistingRelief) {
		// Mark as built and return (geometry exists)
		markRelief3DBuilt();
		return;
	}

	// Step 21a) Create relief surface geometry
	const reliefMesh = GeometryFactory.createReliefSurface(triangles, allBlastHoles, window.worldToThreeLocal, 1.0);

	// Step 21b) Add metadata and to scene (if mesh was created)
	if (reliefMesh) {
		reliefMesh.userData = {
			type: "burdenReliefMap"
		};
		window.threeRenderer.surfacesGroup.add(reliefMesh);
	}

	// Step 21c) Add text labels for relief values on each triangle
	// Relief triangle format: [[x, y, holeTime], [x, y, holeTime], [x, y, holeTime]]
	for (const triangle of triangles) {
		if (!triangle || triangle.length !== 3) continue;

		// Step 21c.1) Calculate triangle centroid (X and Y only)
		const centroidX = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
		const centroidY = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;

		// Step 21c.2) Find nearest hole for Z elevation (relief triangles have holeTime in index 2, not Z)
		const nearestHole = GeometryFactory.findNearestHole(centroidX, centroidY, allBlastHoles);
		const centroidZ = nearestHole ? nearestHole.startZLocation || 0 : 0;

		// Step 21c.3) Calculate burden relief value using GeometryFactory helper
		// Relief triangles already have the correct format: [[x, y, holeTime], ...]
		const burdenRelief = GeometryFactory.getBurdenRelief(triangle);

		// Step 21c.4) Convert to local coordinates
		const local = window.worldToThreeLocal ? window.worldToThreeLocal(centroidX, centroidY) : { x: centroidX, y: centroidY };

		// Step 21c.5) Create text label showing burden relief value (ms/m)
		const labelText = burdenRelief.toFixed(1);
		const textColor = window.darkModeEnabled ? "#FFFFFF" : "#000000";
		const textMesh = GeometryFactory.createKADText(
			local.x,
			local.y,
			centroidZ + 0.3,
			labelText,
			8,
			textColor,
			null // No background
		);

		if (textMesh) {
			textMesh.userData = { type: "reliefLabel" };
			window.threeRenderer.surfacesGroup.add(textMesh);
		}
	}

	// Step 21d) Mark as built for cache
	markRelief3DBuilt();
	console.log("📦 3D Relief map built with " + triangles.length + " triangles");
}

// Step 22) Draw Voronoi cells in Three.js
// selectedMetric: the metric name to use for coloring (e.g., "powderFactor", "mass", "volume", "area", "measuredLength", "designedLength", "holeFiringTime")
// OPTIMIZED: Skip check FIRST, then only compute expensive operations if rebuild is needed
// NEW SIGNATURE: Takes cache/calculation functions instead of pre-computed cells
export function drawVoronoiCellsThreeJS(
	getColorFunction,
	allBlastHoles,
	extrusionHeight,
	useToeLocation,
	selectedMetric,
	getCachedVoronoiCells, // Function to get cached or compute voronoi cells
	getVoronoiMetrics, // Function to compute voronoi metrics (expensive)
	clipVoronoiCells // Function to clip voronoi cells (expensive)
) {
	// Step 22.0) Early returns for invalid state
	if (!window.threeInitialized || !window.threeRenderer) return;
	if (!allBlastHoles || allBlastHoles.length === 0) return;

	// Step 22.0a) FAST PATH: Skip rebuild if data hasn't changed
	// This check MUST happen BEFORE any expensive calculations
	if (shouldSkipVoronoi3DRebuild(selectedMetric, useToeLocation)) {
		// Geometry already exists and is valid - THREE.js will render it automatically
		return;
	}

	// Step 22.0b) ONLY NOW do we compute - get clipped cells from Level 1 cache or compute
	var clippedCells = getCachedVoronoiCells(allBlastHoles, useToeLocation, getVoronoiMetrics, clipVoronoiCells);

	// Step 22.0c) Check if we have valid cells
	if (!clippedCells || clippedCells.length === 0) {
		return;
	}

	// Step 22.0d) Clear existing Voronoi cells since we're rebuilding
	clearVoronoiCellsThreeJS();

	// Step 22a) Default extrusionHeight if not provided
	if (extrusionHeight === undefined || extrusionHeight === null) {
		extrusionHeight = 0.2;
	}

	// Step 22b) Create Voronoi cells geometry
	// Positioning: collar mode = 0.1m below collar, toe mode = 0.1m above toe
	var voronoiGroup = GeometryFactory.createVoronoiCells(clippedCells, getColorFunction, allBlastHoles, window.worldToThreeLocal, extrusionHeight, useToeLocation, selectedMetric);

	// Step 22c) Add metadata
	voronoiGroup.userData = {
		type: "voronoiCells"
	};

	window.threeRenderer.surfacesGroup.add(voronoiGroup);

	// Step 22d) Mark as built for cache
	markVoronoi3DBuilt(selectedMetric, useToeLocation);
	console.log("📦 3D Voronoi built for metric: " + selectedMetric);
}

// Step 22.1) Clear Voronoi cells from 3D scene
// Call when toggling Voronoi display OFF or before creating new cells
export function clearVoronoiCellsThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	var surfacesGroup = window.threeRenderer.surfacesGroup;
	if (!surfacesGroup) return;

	// Step 22.1a) Find and remove all Voronoi cell groups
	var toRemove = [];
	surfacesGroup.children.forEach(function (child) {
		if (child.userData && child.userData.type === "voronoiCells") {
			toRemove.push(child);
		}
	});

	// Step 22.1b) Dispose geometry, materials, and textures to prevent memory leaks
	toRemove.forEach(function (voronoiGroup) {
		voronoiGroup.traverse(function (object) {
			if (object.geometry) {
				object.geometry.dispose();
			}
			if (object.material) {
				// Step 22.1c) Dispose textures before disposing material
				if (object.material.map) object.material.map.dispose();
				if (Array.isArray(object.material)) {
					object.material.forEach(function (mat) {
						mat.dispose();
					});
				} else {
					object.material.dispose();
				}
			}
		});
		surfacesGroup.remove(voronoiGroup);
	});

	// Step 22.1d) Invalidate 3D cache since geometry was removed
	voronoi3DCache.exists = false;

	if (toRemove.length > 0) {
		console.log("🗑️ Cleared " + toRemove.length + " Voronoi cell group(s) from 3D scene");
	}
}

//=================================================
// GPU Memory Management
//=================================================

// Step 23) Dispose KAD group and free GPU memory
// Call this before loading new KAD files or when clearing the scene
export function disposeKADThreeJS() {
	if (!window.threeInitialized || !window.threeRenderer) return;

	var kadGroup = window.threeRenderer.kadGroup;
	if (!kadGroup) return;

	// Step 23a) Count objects for logging
	var objectCount = 0;
	kadGroup.traverse(function () {
		objectCount++;
	});

	// Step 23b) Dispose all geometries and materials
	kadGroup.traverse(function (object) {
		if (object.geometry) {
			object.geometry.dispose();
		}
		// Note: Don't dispose shared materials - they're in the cache
		// Only dispose if NOT using shared material cache
		if (object.material && !GeometryFactory._lineMaterialCache) {
			if (Array.isArray(object.material)) {
				object.material.forEach(function (mat) {
					mat.dispose();
				});
			} else {
				object.material.dispose();
			}
		}
	});

	// Step 23c) Remove all children
	while (kadGroup.children.length > 0) {
		kadGroup.remove(kadGroup.children[0]);
	}

	console.log("🗑️ Disposed " + objectCount + " KAD ThreeJS objects and freed GPU memory");
}

//=================================================
// Blast Analytics Shader Functions
//=================================================

// Global shader instance
var _blastAnalyticsShader = null;

/**
 * Get or create the blast analytics shader instance
 */
function _getAnalyticsShader() {
	if (!_blastAnalyticsShader && window.threeRenderer) {
		_blastAnalyticsShader = new BlastAnalyticsShader(window.threeRenderer);
	}
	return _blastAnalyticsShader;
}

/**
 * Draw blast analytics shader on surface in 3D
 */
export function drawBlastAnalyticsThreeJS(model, holes, params, options) {
	if (!window.threeInitialized || !window.threeRenderer) {
		console.warn("Three.js not initialized");
		return;
	}

	options = options || {};

	var shader = _getAnalyticsShader();
	if (!shader) {
		console.error("Failed to create BlastAnalyticsShader");
		return;
	}

	// Set the model and parameters
	shader.setModel(model, params);

	// Update with hole data
	shader.update(holes, { useToeLocation: options.useToeLocation || false });

	// Build mesh based on options
	var mesh;
	var usedSurface = false;

	if (options.surfaceId && options.surfaceId !== "__PLANE__" && window.loadedSurfaces) {
		// Try to render on existing surface
		var surface = window.loadedSurfaces.get(options.surfaceId);

		// Try to find surface mesh in scene
		var surfaceMesh = null;
		if (window.threeRenderer && window.threeRenderer.surfacesGroup) {
			window.threeRenderer.surfacesGroup.traverse(function(obj) {
				if (obj.userData && obj.userData.surfaceId === options.surfaceId && obj.geometry) {
					surfaceMesh = obj;
				}
			});
		}

		if (surfaceMesh && surfaceMesh.geometry) {
			// Use surface geometry from scene
			var surfaceGeom = surfaceMesh.geometry.clone();
			var worldOffset = {
				x: window.threeLocalOriginX || 0,
				y: window.threeLocalOriginY || 0,
				z: 0
			};
			mesh = shader.buildOnGeometry(surfaceGeom, worldOffset);
			usedSurface = true;
			console.log("✅ Using surface geometry from scene:", options.surfaceId);
		} else if (surface && surface.threeJSMesh && surface.threeJSMesh.geometry) {
			// Fallback: use from surface object
			var surfaceGeom = surface.threeJSMesh.geometry.clone();
			var worldOffset = {
				x: window.threeLocalOriginX || 0,
				y: window.threeLocalOriginY || 0,
				z: 0
			};
			mesh = shader.buildOnGeometry(surfaceGeom, worldOffset);
			usedSurface = true;
			console.log("✅ Using surface geometry from object:", options.surfaceId);
		} else {
			console.warn("⚠️ Surface geometry not found, falling back to analysis plane");
		}
	}

	// Fallback to analysis plane if no surface or surface not found
	if (!mesh) {
		var bounds = _calculateHoleBounds(holes);
		// Use Drawing Z elevation if set, otherwise fall back to average collar Z
		var planeZ = (window.drawingZLevel !== undefined && isFinite(window.drawingZLevel) && window.drawingZLevel !== 0)
			? window.drawingZLevel
			: _calculateAverageCollarZ(holes);
		var padding = options.planePadding || 50;

		mesh = shader.buildPlane(bounds, planeZ, padding);
		console.log("✅ Created analysis plane at Z=" + planeZ);
	}

	// Add to scene
	if (mesh && window.threeRenderer.surfacesGroup) {
		// Remove any existing analytics mesh
		clearBlastAnalyticsThreeJS();

		// Debug mesh properties
		console.log("📊 Shader Mesh Debug:");
		console.log("  - Position:", mesh.position.toArray());
		console.log("  - Geometry vertices:", mesh.geometry.attributes.position ? mesh.geometry.attributes.position.count : 0);
		console.log("  - Material type:", mesh.material.type);
		console.log("  - Material visible:", mesh.material.visible);
		console.log("  - Material transparent:", mesh.material.transparent);
		console.log("  - Material opacity:", mesh.material.uniforms.uOpacity ? mesh.material.uniforms.uOpacity.value : "N/A");
		console.log("  - Hole count uniform:", mesh.material.uniforms.uHoleCount ? mesh.material.uniforms.uHoleCount.value : "N/A");

		// Make sure mesh is visible
		mesh.visible = true;
		mesh.renderOrder = 100; // Render after other objects

		window.threeRenderer.surfacesGroup.add(mesh);
		mesh.userData.isBlastAnalytics = true;

		console.log("✅ Blast analytics shader applied:", model, "on", holes.length, "holes");
		console.log("  Mesh added to scene at position:", mesh.position.toArray());
	}
}

/**
 * Clear blast analytics shader from 3D scene
 */
export function clearBlastAnalyticsThreeJS() {
	if (!window.threeRenderer || !window.threeRenderer.surfacesGroup) return;

	var toRemove = [];
	window.threeRenderer.surfacesGroup.children.forEach(function(child) {
		if (child.userData && child.userData.isBlastAnalytics) {
			toRemove.push(child);
		}
	});

	toRemove.forEach(function(obj) {
		window.threeRenderer.surfacesGroup.remove(obj);
		if (obj.geometry) obj.geometry.dispose();
	});

	if (toRemove.length > 0) {
		console.log("🗑️ Cleared blast analytics shader");
	}
}

/**
 * Get available analytics models
 */
export function getAvailableAnalyticsModels() {
	var shader = _getAnalyticsShader();
	if (shader) {
		return shader.getAvailableModels();
	}

	// Fallback if shader not initialized
	return [
		{ name: "ppv", displayName: "PPV (Simple)", unit: "mm/s" },
		{ name: "scaled_heelan", displayName: "Scaled Heelan (Blair & Minchinton 2006)", unit: "mm/s" },
		{ name: "heelan_original", displayName: "Original Heelan Waveform", unit: "mm/s" },
		{ name: "nonlinear_damage", displayName: "Non-Linear Damage (Blair 2008)", unit: "damage index" }
	];
}

/**
 * Get shader material for a model (for texture baking)
 */
export function getShaderMaterialForModel(model, holes, params) {
	var shader = _getAnalyticsShader();
	if (!shader) return null;

	shader.setModel(model, params);
	shader.update(holes, { useToeLocation: false });

	return shader.material;
}

/**
 * Calculate bounding box for holes
 * @private
 */
function _calculateHoleBounds(holes) {
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
 * Calculate average collar Z elevation
 * @private
 */
function _calculateAverageCollarZ(holes) {
	var sum = 0;
	holes.forEach(function(hole) {
		sum += hole.startZLocation || 0;
	});
	return holes.length > 0 ? sum / holes.length : 0;
}
