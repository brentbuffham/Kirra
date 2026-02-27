// src/tools/flyrock/FlyrockShroudGenerator.js

/**
 * FlyrockShroudGenerator creates a single 3D triangulated shroud surface
 * representing the flyrock envelope around blast holes.
 *
 * Uses a heightfield max-union approach:
 *   1. Compute per-hole flyrock parameters (distance, velocity)
 *   2. Create a regular XY grid over the bounding box + max distance padding
 *   3. For each grid point, compute max envelope altitude across all holes
 *   4. Triangulate grid cells (2 triangles per cell)
 *   5. Cull triangles outside envelope and steeper than endAngle
 *
 * Output: surface object compatible with saveSurfaceToDB()
 * Triangle format: { vertices: [{x,y,z}, {x,y,z}, {x,y,z}] }
 */

import { richardsMoore, envelopeAltitude, lundborg, mckenzie } from "./FlyrockCalculator.js";
import { chargingKey } from "../../charging/HoleCharging.js";

var PI = Math.PI;
var GRAVITY = 9.80665;

/**
 * Generate a flyrock shroud surface for a set of blast holes.
 *
 * @param {Array} holes - Blast holes (from window.allBlastHoles)
 * @param {Object} params - Generation parameters
 * @param {string} params.algorithm - "richardsMoore" | "lundborg" | "mckenzie"
 * @param {number} params.K - Flyrock constant (Richards & Moore)
 * @param {number} params.factorOfSafety - Safety factor
 * @param {number} params.stemEjectAngleDeg - Stem eject angle (degrees)
 * @param {number} params.inholeDensity - Explosive density (kg/L)
 * @param {number} params.rockDensity - Rock density (kg/m³)
 * @param {number} params.iterations - Grid resolution factor
 * @param {number} params.endAngleDeg - Face angle culling threshold (degrees from horizontal)
 * @param {number} params.transparency - Surface transparency (0-1)
 * @returns {Object} - Surface object { id, name, points, triangles, ... }
 */
export function generate(holes, params) {
	if (!holes || holes.length === 0) {
		console.warn("FlyrockShroudGenerator: No holes provided");
		return null;
	}

	params = params || {};
	var algorithm = params.algorithm || "richardsMoore";
	var iterations = params.iterations || 40;
	var endAngleDeg = params.endAngleDeg !== undefined ? params.endAngleDeg : 85;
	var transparency = params.transparency !== undefined ? params.transparency : 0.5;
	var extendBelowCollar = params.extendBelowCollar || 0;

	// Step 1: Compute per-hole flyrock parameters (requires charging data)
	var holeData = [];
	var skippedNoCharging = 0;
	var worstHoleIdx = -1;
	var worstVelocity = 0;

	for (var h = 0; h < holes.length; h++) {
		var hole = holes[h];
		var cx = hole.startXLocation || 0;
		var cy = hole.startYLocation || 0;
		var cz = hole.startZLocation || 0;

		var holeParams = getHoleFlyrockParams(hole, params);
		if (!holeParams) {
			skippedNoCharging++;
			continue;
		}

		var maxDistance;
		var maxVelocity;
		var rmResult;

		switch (algorithm) {
			case "lundborg":
				var lundResult = lundborg(holeParams);
				maxDistance = lundResult.clearance; // FoS-scaled clearance
				maxVelocity = Math.sqrt(lundResult.rangeMax * GRAVITY); // velocity from BASE range
				break;

			case "mckenzie":
				var mckResult = mckenzie(holeParams);
				maxDistance = mckResult.clearance; // FoS-scaled for grid bounds
				maxVelocity = mckResult.v0 || Math.sqrt(mckResult.rangeMax * GRAVITY); // BASE velocity
				break;

			case "richardsMoore":
			default:
				rmResult = richardsMoore(holeParams);
				maxDistance = rmResult.maxDistance;
				maxVelocity = rmResult.maxVelocity;
				break;
		}

		// Scale velocity for FoS — envelope range = V²/g, so FoS× range needs V × √FoS
		var fos = params.factorOfSafety || 2;
		if (fos > 1) {
			maxVelocity = maxVelocity * Math.sqrt(fos);
		}

		if (maxDistance <= 0 || maxVelocity <= 0) continue;

		// Log every hole for diagnostics
		var hMaxH = (maxVelocity * maxVelocity) / (2 * GRAVITY);
		console.log("Flyrock [" + hole.entityName + ":" + hole.holeID + "] " +
			"diam=" + holeParams.holeDiameterMm + "mm " +
			"burden=" + holeParams.burden.toFixed(1) + "m " +
			"stemming=" + holeParams.stemmingLength.toFixed(1) + "m " +
			"chgLen=" + holeParams.chargeLength.toFixed(1) + "m " +
			"density=" + holeParams.inholeDensity.toFixed(2) + "g/cc " +
			"mpm=" + (rmResult ? rmResult.massPerMetre.toFixed(1) : "?") + "kg/m " +
			(rmResult ? "FB=" + rmResult.faceBurst.toFixed(0) + " CR=" + rmResult.cratering.toFixed(0) + " SE=" + rmResult.stemEject.toFixed(0) + "m " : "") +
			"V=" + maxVelocity.toFixed(1) + "m/s " +
			"H=" + hMaxH.toFixed(0) + "m");

		if (maxVelocity > worstVelocity) {
			worstVelocity = maxVelocity;
			worstHoleIdx = holeData.length;
		}

		holeData.push({
			cx: cx,
			cy: cy,
			cz: cz,
			maxDistance: maxDistance,
			maxVelocity: maxVelocity,
			holeID: hole.entityName + ":" + hole.holeID
		});
	}

	if (skippedNoCharging > 0) {
		console.warn("FlyrockShroudGenerator: Skipped " + skippedNoCharging + " of " +
			holes.length + " holes (no charging data)");
	}

	if (worstHoleIdx >= 0) {
		var worst = holeData[worstHoleIdx];
		var wH = (worst.maxVelocity * worst.maxVelocity) / (2 * GRAVITY);
		var wR = (worst.maxVelocity * worst.maxVelocity) / GRAVITY;
		console.log("Flyrock WORST CASE [" + worst.holeID + "]: " +
			"V=" + worst.maxVelocity.toFixed(1) + " m/s, " +
			"envelope height=" + wH.toFixed(0) + "m, " +
			"envelope radius=" + wR.toFixed(0) + "m");
	}

	if (holeData.length === 0) {
		console.warn("FlyrockShroudGenerator: No valid hole data — all holes missing charging");
		return { error: "NO_CHARGING", skipped: skippedNoCharging, total: holes.length };
	}

	// Step 2: Compute grid bounding box from hole positions + envelope radius
	// When extendBelowCollar > 0, the parabola extends beyond maxDistance.
	// Radius where alt = -E: d = V/g × sqrt(V² + 2gE)
	var overallMaxDist = 0;
	var gridMinX = Infinity, gridMaxX = -Infinity;
	var gridMinY = Infinity, gridMaxY = -Infinity;
	for (var i = 0; i < holeData.length; i++) {
		var hd = holeData[i];
		var padding = hd.maxDistance;
		if (extendBelowCollar > 0) {
			var V2 = hd.maxVelocity * hd.maxVelocity;
			var extRadius = (hd.maxVelocity / GRAVITY) * Math.sqrt(V2 + 2 * GRAVITY * extendBelowCollar);
			if (extRadius > padding) padding = extRadius;
		}
		if (padding > overallMaxDist) overallMaxDist = padding;
		if (hd.cx - padding < gridMinX) gridMinX = hd.cx - padding;
		if (hd.cx + padding > gridMaxX) gridMaxX = hd.cx + padding;
		if (hd.cy - padding < gridMinY) gridMinY = hd.cy - padding;
		if (hd.cy + padding > gridMaxY) gridMaxY = hd.cy + padding;
	}

	// Step 3: Compute grid spacing from iterations parameter
	var gridSpacing = overallMaxDist / (iterations / 2);
	if (gridSpacing <= 0) gridSpacing = 1;

	var cols = Math.ceil((gridMaxX - gridMinX) / gridSpacing) + 1;
	var rows = Math.ceil((gridMaxY - gridMinY) / gridSpacing) + 1;

	// Safety limit — cap grid size to prevent memory blow-up
	var maxGridCells = 500;
	if (cols > maxGridCells || rows > maxGridCells) {
		var scaleDown = maxGridCells / Math.max(cols, rows);
		gridSpacing = gridSpacing / scaleDown;
		cols = Math.ceil((gridMaxX - gridMinX) / gridSpacing) + 1;
		rows = Math.ceil((gridMaxY - gridMinY) / gridSpacing) + 1;
	}

	// Step 4: Compute grid Z values (max envelope altitude across all holes)
	// gridZ[row][col] = absolute Z elevation
	// gridInside[row][col] = 1 if inside envelope, 0 if outside
	var gridZ = new Array(rows);
	var gridInside = new Array(rows);
	for (var r = 0; r < rows; r++) {
		gridZ[r] = new Float64Array(cols);
		gridInside[r] = new Uint8Array(cols); // 0 = outside
	}

	for (var r = 0; r < rows; r++) {
		var gy = gridMinY + r * gridSpacing;
		for (var c = 0; c < cols; c++) {
			var gx = gridMinX + c * gridSpacing;

			var bestAbsZ = -Infinity;
			var pointInside = false;

			for (var hi = 0; hi < holeData.length; hi++) {
				var hd = holeData[hi];
				var dx = gx - hd.cx;
				var dy = gy - hd.cy;
				var dist = Math.sqrt(dx * dx + dy * dy);

				// Compute raw Chernigovskii altitude — goes negative beyond ballistic range
				// alt = (V⁴ - g²d²) / (2gV²)
				var V2 = hd.maxVelocity * hd.maxVelocity;
				var alt = (V2 * V2 - GRAVITY * GRAVITY * dist * dist) / (2 * GRAVITY * V2);

				// Determine if this point is inside the envelope for this hole
				var minAlt = extendBelowCollar > 0 ? -extendBelowCollar : 0;
				if (alt >= minAlt) {
					// Inside envelope (dome surface or parabolic extension)
					var absZ = hd.cz + alt;
					if (absZ > bestAbsZ) {
						bestAbsZ = absZ;
					}
					pointInside = true;
				}
			}

			gridZ[r][c] = pointInside ? bestAbsZ : 0;
			gridInside[r][c] = pointInside ? 1 : 0;
		}
	}

	// Step 5: Build triangles from grid (2 per cell), skip cells outside envelope
	var allTriangles = [];
	var allPoints = [];
	var pointMap = {}; // "row,col" -> index for deduplication

	function getOrCreatePoint(row, col) {
		var key = row + "," + col;
		if (pointMap[key] !== undefined) return pointMap[key];
		var px = gridMinX + col * gridSpacing;
		var py = gridMinY + row * gridSpacing;
		var pz = gridZ[row][col];
		var idx = allPoints.length;
		allPoints.push({ x: px, y: py, z: pz });
		pointMap[key] = idx;
		return idx;
	}

	var endAngleRad = endAngleDeg * (PI / 180);
	var cosEndAngle = Math.cos(endAngleRad);

	for (var r = 0; r < rows - 1; r++) {
		for (var c = 0; c < cols - 1; c++) {
			// Check which corners are inside the envelope
			var in00 = gridInside[r][c];
			var in10 = gridInside[r + 1][c];
			var in01 = gridInside[r][c + 1];
			var in11 = gridInside[r + 1][c + 1];

			// Triangle 1: (r,c) (r+1,c) (r,c+1) — ALL vertices must be inside for circular edge
			if (in00 && in10 && in01) {
				var i0 = getOrCreatePoint(r, c);
				var i1 = getOrCreatePoint(r + 1, c);
				var i2 = getOrCreatePoint(r, c + 1);

				if (passesAngleCull(allPoints[i0], allPoints[i1], allPoints[i2], cosEndAngle)) {
					allTriangles.push({
						vertices: [allPoints[i0], allPoints[i1], allPoints[i2]]
					});
				}
			}

			// Triangle 2: (r+1,c) (r+1,c+1) (r,c+1) — ALL vertices must be inside for circular edge
			if (in10 && in11 && in01) {
				var i0 = getOrCreatePoint(r + 1, c);
				var i1 = getOrCreatePoint(r + 1, c + 1);
				var i2 = getOrCreatePoint(r, c + 1);

				if (passesAngleCull(allPoints[i0], allPoints[i1], allPoints[i2], cosEndAngle)) {
					allTriangles.push({
						vertices: [allPoints[i0], allPoints[i1], allPoints[i2]]
					});
				}
			}
		}
	}

	if (allTriangles.length === 0) {
		console.warn("FlyrockShroudGenerator: No triangles generated");
		return null;
	}

	// Build surface object compatible with saveSurfaceToDB
	var timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
	var surfaceId = "flyrock_shroud_" + timestamp;

	return {
		id: surfaceId,
		name: "Flyrock Shroud (" + algorithm + ")",
		type: "triangulated",
		points: allPoints,
		triangles: allTriangles,
		visible: true,
		gradient: "default",
		transparency: transparency,
		isFlyrockShroud: true,
		flyrockParams: {
			algorithm: algorithm,
			K: params.K,
			factorOfSafety: params.factorOfSafety,
			stemEjectAngleDeg: params.stemEjectAngleDeg,
			holeCount: holeData.length,
			holesSkipped: skippedNoCharging,
			endAngleDeg: endAngleDeg,
			gridSpacing: gridSpacing,
			gridSize: cols + "x" + rows
		},
		metadata: {
			createdAt: new Date().toISOString(),
			algorithm: algorithm
		}
	};
}

/**
 * Check if a triangle passes face angle culling.
 * Returns false if the triangle is steeper than the end angle threshold.
 *
 * @param {Object} v0 - {x, y, z}
 * @param {Object} v1 - {x, y, z}
 * @param {Object} v2 - {x, y, z}
 * @param {number} cosEndAngle - cosine of the max allowed slope angle from horizontal
 * @returns {boolean} - true if triangle passes (not too steep)
 */
function passesAngleCull(v0, v1, v2, cosEndAngle) {
	// Edge vectors
	var e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
	var e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;

	// Cross product (face normal)
	var nx = e1y * e2z - e1z * e2y;
	var ny = e1z * e2x - e1x * e2z;
	var nz = e1x * e2y - e1y * e2x;

	var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (len < 1e-10) return false; // Degenerate triangle

	// Slope angle from horizontal = acos(|nz| / len)
	// Triangle is too steep if acos(|nz|/len) > endAngle
	// i.e., |nz|/len < cos(endAngle)
	var absNzNorm = Math.abs(nz) / len;
	return absNzNorm >= cosEndAngle;
}

/**
 * Extract per-hole flyrock data for Web Worker grid computation.
 * This runs on the main thread (needs window.loadedCharging) and returns
 * the holeData array that the worker uses for the heavy grid computation.
 *
 * @param {Array} holes - Blast holes
 * @param {Object} params - Algorithm parameters from dialog
 * @returns {Object} - { holeData: [...], skippedNoCharging, error? }
 */
export function extractHoleFlyrockData(holes, params) {
	if (!holes || holes.length === 0) {
		return { holeData: [], skippedNoCharging: 0 };
	}

	params = params || {};
	var algorithm = params.algorithm || "richardsMoore";
	var holeData = [];
	var skippedNoCharging = 0;

	for (var h = 0; h < holes.length; h++) {
		var hole = holes[h];
		var cx = hole.startXLocation || 0;
		var cy = hole.startYLocation || 0;
		var cz = hole.startZLocation || 0;

		var holeParams = getHoleFlyrockParams(hole, params);
		if (!holeParams) {
			skippedNoCharging++;
			continue;
		}

		var maxDistance;
		var maxVelocity;

		switch (algorithm) {
			case "lundborg":
				var lundResult = lundborg(holeParams);
				maxDistance = lundResult.clearance;
				maxVelocity = Math.sqrt(lundResult.rangeMax * GRAVITY);
				break;

			case "mckenzie":
				var mckResult = mckenzie(holeParams);
				maxDistance = mckResult.clearance;
				maxVelocity = mckResult.v0 || Math.sqrt(mckResult.rangeMax * GRAVITY);
				break;

			case "richardsMoore":
			default:
				var rmResult = richardsMoore(holeParams);
				maxDistance = rmResult.maxDistance;
				maxVelocity = rmResult.maxVelocity;
				break;
		}

		// Scale velocity for FoS
		var fos = params.factorOfSafety || 2;
		if (fos > 1) {
			maxVelocity = maxVelocity * Math.sqrt(fos);
		}

		if (maxDistance <= 0 || maxVelocity <= 0) continue;

		holeData.push({
			cx: cx,
			cy: cy,
			cz: cz,
			maxDistance: maxDistance,
			maxVelocity: maxVelocity,
			holeID: hole.entityName + ":" + hole.holeID
		});
	}

	if (holeData.length === 0 && skippedNoCharging > 0) {
		return { error: "NO_CHARGING", skipped: skippedNoCharging, total: holes.length, holeData: [] };
	}

	return { holeData: holeData, skippedNoCharging: skippedNoCharging };
}

/**
 * Extract flyrock-relevant parameters from a hole, deriving values from
 * hole geometry and charging data. Returns null if charging data is missing.
 *
 * Priority: per-hole charging data > per-hole geometry > null (skip hole)
 *
 * @param {Object} hole - Blast hole object
 * @param {Object} config - Algorithm parameters from dialog (K, FoS, stemAngle, rockDensity)
 * @returns {Object|null} - Parameters for FlyrockCalculator, or null if charging unavailable
 */
function getHoleFlyrockParams(hole, config) {
	// Charging data is required — it provides stemming, charge length, and explosive density
	if (!window.loadedCharging || !window.loadedCharging.has(chargingKey(hole))) {
		return null;
	}

	var charging = window.loadedCharging.get(chargingKey(hole));
	if (!charging || !charging.decks || charging.decks.length === 0) {
		return null;
	}

	// Extract stemming length, charge length, and weighted-average density from charging decks
	var topExplosiveDepth = null;
	var bottomExplosiveDepth = 0;
	var totalExplosiveVolume = 0;
	var densityWeightedSum = 0;
	var holeDiamMm = parseFloat(hole.holeDiameter) || (charging.holeDiameterMm || 115);
	var radiusM = (holeDiamMm / 1000) / 2;
	var holeArea = Math.PI * radiusM * radiusM; // cross-sectional area in m²

	for (var i = 0; i < charging.decks.length; i++) {
		var deck = charging.decks[i];
		if (deck.deckType === "COUPLED" || deck.deckType === "DECOUPLED") {
			var deckTop = Math.min(deck.topDepth, deck.baseDepth);
			var deckBase = Math.max(deck.topDepth, deck.baseDepth);
			if (topExplosiveDepth === null || deckTop < topExplosiveDepth) {
				topExplosiveDepth = deckTop;
			}
			if (deckBase > bottomExplosiveDepth) {
				bottomExplosiveDepth = deckBase;
			}

			// Weighted-average density across explosive decks
			var deckLength = deckBase - deckTop;
			var deckVolume = holeArea * deckLength; // m³
			var deckDensity = deck.effectiveDensity || (deck.product ? deck.product.density : 0) || 1.2; // g/cc
			totalExplosiveVolume += deckVolume;
			densityWeightedSum += deckVolume * deckDensity;
		}
	}

	// No explosive decks found — hole has charging structure but no actual explosives
	if (topExplosiveDepth === null || totalExplosiveVolume <= 0) {
		return null;
	}

	var stemmingLength = topExplosiveDepth;
	var chargeLength = bottomExplosiveDepth - topExplosiveDepth;
	// Weighted average density in g/cc → convert to kg/L (same numeric value)
	var inholeDensity = densityWeightedSum / totalExplosiveVolume;

	// Minimum stemming check — presplit and unstemmed holes have explosive to the collar.
	// The Richards & Moore cratering formula divides by stemming^2.6, so near-zero
	// stemming produces infinite distances. These holes are not flyrock risks in the
	// same way; skip them with a warning.
	var MIN_STEMMING = 0.5; // metres
	if (stemmingLength < MIN_STEMMING) {
		console.warn("Flyrock: Skipping " + hole.entityName + ":" + hole.holeID +
			" — stemming " + stemmingLength.toFixed(2) + "m < " + MIN_STEMMING + "m " +
			"(unstemmed/presplit hole, R&M model not applicable)");
		return null;
	}

	// Geometry from the hole object — burden, benchHeight, subdrill, spacing
	// Burden of 1 is the data model default placeholder — not a real value
	var holeBurden = parseFloat(hole.burden);
	var burden = (holeBurden && holeBurden > 1.5) ? holeBurden : 4.5;

	var holeSpacing = parseFloat(hole.spacing);
	var spacing = (holeSpacing && holeSpacing > 1.5) ? holeSpacing : burden * 1.15;

	// benchHeight: absolute vertical from collar to grade
	var holeBenchHeight = parseFloat(hole.benchHeight);
	var benchHeight = (holeBenchHeight && holeBenchHeight > 1) ? holeBenchHeight : 12;

	// subdrillAmount: vertical delta from grade to toe
	var holeSubdrill = parseFloat(hole.subdrillAmount);
	var subdrill = (holeSubdrill && holeSubdrill > 0) ? holeSubdrill : 1.5;

	return {
		holeDiameterMm: holeDiamMm,
		benchHeight: benchHeight,
		stemmingLength: stemmingLength,
		burden: burden,
		spacing: spacing,
		subdrill: subdrill,
		inholeDensity: inholeDensity,
		rockDensity: config.rockDensity || 2600,
		chargeLength: chargeLength,
		K: config.K || 20,
		factorOfSafety: config.factorOfSafety || 2,
		stemEjectAngleDeg: config.stemEjectAngleDeg || 80
	};
}
