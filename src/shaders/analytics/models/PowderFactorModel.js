// src/shaders/analytics/models/PowderFactorModel.js
import * as THREE from "three";

/**
 * PowderFactorModel implements Volumetric Powder Factor analysis.
 *
 * Uses a per-DECK DataTexture: each charged deck (COUPLED/DECOUPLED) from
 * the charging model becomes a separate entry with its world-space endpoints
 * and mass. Multi-deck holes produce multiple hotspots — one per deck.
 *
 * For each observation point, distance R to the nearest point on each deck's
 * charge segment is computed:
 *   PF = deckMass / ((4/3)π × R³)
 *
 * Peak PF taken across all decks. Colour mapped on log₁₀ scale.
 */
export class PowderFactorModel {
	constructor() {
		this.name = "powder_factor_vol";
		this.displayName = "Volumetric Powder Factor";
		this.unit = "kg/m³";
		this.defaultColourRamp = "spectrum";
		this.defaultMin = 0.01;
		this.defaultMax = 100.0;
	}

	getDefaultParams() {
		return {
			cutoffDistance: 0.3,
			maxDisplayDistance: 50.0
		};
	}

	getFragmentSource() {
		return `
			precision highp float;

			// Standard hole data (unused by PF but required by base uniforms)
			uniform sampler2D uHoleData;
			uniform int uHoleCount;
			uniform float uHoleDataWidth;

			// Per-deck data texture (2 rows × deckCount columns)
			uniform sampler2D uDeckData;
			uniform int uDeckCount;
			uniform float uDeckDataWidth;

			uniform float uCutoff;
			uniform float uMaxDisplayDistance;
			uniform float uDisplayTime;
			uniform sampler2D uColourRamp;
			uniform float uMinValue;
			uniform float uMaxValue;
			uniform float uOpacity;

			varying vec3 vWorldPos;

			vec4 getDeckData(int index, int row) {
				float u = (float(index) + 0.5) / uDeckDataWidth;
				float v = (float(row) + 0.5) / 3.0;
				return texture2D(uDeckData, vec2(u, v));
			}

			// Distance from point P to nearest point on line segment AB
			float distToSegment(vec3 P, vec3 A, vec3 B) {
				vec3 AB = B - A;
				float lenSq = dot(AB, AB);
				if (lenSq < 0.0001) return distance(P, A);
				float t = clamp(dot(P - A, AB) / lenSq, 0.0, 1.0);
				vec3 closest = A + t * AB;
				return distance(P, closest);
			}

			void main() {
				float peakPF = 0.0;
				float minDist = 1e10;

				for (int i = 0; i < 512; i++) {
					if (i >= uDeckCount) break;

					vec4 top = getDeckData(i, 0);  // [topX, topY, topZ, mass]
					vec4 bot = getDeckData(i, 1);  // [baseX, baseY, baseZ, 0]
					vec4 extra = getDeckData(i, 2); // [vod, holeDiamMm, timing, holeIndex]

					vec3 topPos = top.xyz;
					vec3 botPos = bot.xyz;
					float mass = top.w;

					if (mass <= 0.0) continue;

					// Time filtering: skip decks that haven't fired yet
					float timing_d = extra.z;
					if (uDisplayTime >= 0.0 && timing_d > uDisplayTime) continue;

					// Quick distance check to midpoint
					vec3 mid = (topPos + botPos) * 0.5;
					float distToMid = distance(vWorldPos, mid);
					if (distToMid > uMaxDisplayDistance) continue;
					minDist = min(minDist, distToMid);

					// Distance from observation point to deck segment
					float R = max(distToSegment(vWorldPos, topPos, botPos), uCutoff);

					// Capsule volume: (4/3)π R³
					float capsuleVol = 4.18879 * R * R * R;

					// Powder factor from this deck
					float deckPF = mass / capsuleVol;

					peakPF = max(peakPF, deckPF);
				}

				if (peakPF <= 0.0 || minDist > uMaxDisplayDistance) discard;

				// Logarithmic colour mapping (log10 scale)
				float logMin = log2(max(uMinValue, 0.001)) * 0.30103;
				float logMax = log2(max(uMaxValue, 0.002)) * 0.30103;
				float logPF = log2(max(peakPF, 0.001)) * 0.30103;
				float t = clamp((logPF - logMin) / (logMax - logMin), 0.0, 1.0);

				vec4 colour = texture2D(uColourRamp, vec2(t, 0.5));

				// Edge fade
				float edgeFade = 1.0 - smoothstep(uMaxDisplayDistance * 0.85, uMaxDisplayDistance, minDist);
				colour.a *= uOpacity * edgeFade;

				if (peakPF < uMinValue * 0.1) discard;
				gl_FragColor = colour;
			}
		`;
	}

	getUniforms(params) {
		var p = Object.assign(this.getDefaultParams(), params || {});
		var deckData = p._deckData;

		var uniforms = {
			uCutoff: { value: p.cutoffDistance },
			uMaxDisplayDistance: { value: p.maxDisplayDistance },
			uDisplayTime: { value: p.displayTime !== undefined ? p.displayTime : -1.0 }
		};

		// Deck texture from prepareDeckDataTexture
		if (deckData && deckData.texture) {
			uniforms.uDeckData = { value: deckData.texture };
			uniforms.uDeckCount = { value: deckData.count };
			uniforms.uDeckDataWidth = { value: deckData.width };
		} else {
			// Fallback: empty 1x3 texture
			var emptyData = new Float32Array(1 * 3 * 4);
			var emptyTex = new THREE.DataTexture(emptyData, 1, 3, THREE.RGBAFormat, THREE.FloatType);
			emptyTex.minFilter = THREE.NearestFilter;
			emptyTex.magFilter = THREE.NearestFilter;
			emptyTex.needsUpdate = true;
			uniforms.uDeckData = { value: emptyTex };
			uniforms.uDeckCount = { value: 0 };
			uniforms.uDeckDataWidth = { value: 1.0 };
		}

		return uniforms;
	}
}

/**
 * Prepare a per-deck DataTexture from blast hole charging data.
 *
 * Each COUPLED or DECOUPLED deck becomes a separate entry with its
 * world-space charge segment endpoints, mass, and physical properties.
 * This allows shaders to show separate hotspots per deck (e.g. multi-deck
 * holes with air gaps show distinct zones) and access per-deck VOD/density.
 *
 * Texture layout (width=deckCount, height=3, RGBA Float):
 *   Row 0: [chargeTopWorldX,  chargeTopWorldY,  chargeTopWorldZ,  deckMassKg]
 *   Row 1: [chargeBaseWorldX, chargeBaseWorldY, chargeBaseWorldZ, densityKgPerL]
 *   Row 2: [vodMs,           holeDiamMm,       timing_ms,        holeIndex]
 *
 * @param {Array} holes - allBlastHoles array
 * @returns {{ texture: THREE.DataTexture, count: number, width: number }}
 */
export function prepareDeckDataTexture(holes) {
	var ROWS_PER_DECK = 3;
	var deckEntries = [];

	for (var i = 0; i < holes.length; i++) {
		var h = holes[i];
		var key = (h.entityName || "") + ":::" + (h.holeID || "");
		var chargingObj = window.loadedCharging ? window.loadedCharging.get(key) : null;

		var holeLen = parseFloat(h.holeLengthCalculated) || 0;
		if (holeLen <= 0) continue;

		var axX = (h.endXLocation - h.startXLocation) / holeLen;
		var axY = (h.endYLocation - h.startYLocation) / holeLen;
		var axZ = (h.endZLocation - h.startZLocation) / holeLen;

		var holeDiamMm = parseFloat(h.holeDiameter) || 115;
		var surfaceTimeMs = parseFloat(h.holeTime) || parseFloat(h.timingDelayMilliseconds) || 0;

		if (!chargingObj || !chargingObj.decks || chargingObj.decks.length === 0) {
			// Fallback: treat entire hole as single charge (30%-100% of hole)
			var mass = parseFloat(h.measuredMass) || 0;
			if (mass <= 0) continue;

			var chargeStart = holeLen * 0.3;
			deckEntries.push({
				topX: h.startXLocation + axX * chargeStart,
				topY: h.startYLocation + axY * chargeStart,
				topZ: h.startZLocation + axZ * chargeStart,
				baseX: h.endXLocation,
				baseY: h.endYLocation,
				baseZ: h.endZLocation,
				mass: mass,
				density: 1.2,   // fallback density (kg/L)
				vod: 5000,      // fallback VOD (m/s)
				holeDiamMm: holeDiamMm,
				timingMs: surfaceTimeMs,
				holeIndex: i
			});
			continue;
		}

		// Build primer lookup for downhole delays
		var primers = chargingObj.primers || [];

		for (var d = 0; d < chargingObj.decks.length; d++) {
			var deck = chargingObj.decks[d];
			if (deck.deckType !== "COUPLED" && deck.deckType !== "DECOUPLED") continue;

			var deckMass = parseFloat(deck.calculateMass(holeDiamMm)) || 0;
			if (deckMass <= 0) continue;

			var deckTop = Math.min(deck.topDepth, deck.baseDepth);
			var deckBase = Math.max(deck.topDepth, deck.baseDepth);

			// Extract product properties
			var product = deck.product || null;
			var density = product ? (parseFloat(product.density) || 1.2) : 1.2;  // g/cc = kg/L
			var vod = product ? (parseFloat(product.vodMs) || 5000) : 5000;

			// Calculate per-deck detonation time: surface + downhole delay
			// For electronic detonators, surface time ~0 (speed of light through wire)
			// and the actual detonation time is the programmed downhole delay
			var downholeDelayMs = 0;
			for (var p = 0; p < primers.length; p++) {
				if (primers[p].deckID === deck.deckID) {
					downholeDelayMs = primers[p].totalDownholeDelayMs || 0;
					break;
				}
			}
			// Fallback: primer within deck depth bounds
			if (downholeDelayMs === 0) {
				for (var p2 = 0; p2 < primers.length; p2++) {
					if (deck.containsDepth && deck.containsDepth(primers[p2].lengthFromCollar)) {
						downholeDelayMs = primers[p2].totalDownholeDelayMs || 0;
						break;
					}
				}
			}

			deckEntries.push({
				topX: h.startXLocation + axX * deckTop,
				topY: h.startYLocation + axY * deckTop,
				topZ: h.startZLocation + axZ * deckTop,
				baseX: h.startXLocation + axX * deckBase,
				baseY: h.startYLocation + axY * deckBase,
				baseZ: h.startZLocation + axZ * deckBase,
				mass: deckMass,
				density: density,
				vod: vod,
				holeDiamMm: holeDiamMm,
				timingMs: surfaceTimeMs + downholeDelayMs,
				holeIndex: i
			});
		}
	}

	if (deckEntries.length === 0) {
		var emptyData = new Float32Array(1 * ROWS_PER_DECK * 4);
		var emptyTex = new THREE.DataTexture(emptyData, 1, ROWS_PER_DECK, THREE.RGBAFormat, THREE.FloatType);
		emptyTex.minFilter = THREE.NearestFilter;
		emptyTex.magFilter = THREE.NearestFilter;
		emptyTex.needsUpdate = true;
		return { texture: emptyTex, count: 0, width: 1 };
	}

	var width = deckEntries.length;
	var data = new Float32Array(width * ROWS_PER_DECK * 4);

	for (var i = 0; i < deckEntries.length; i++) {
		var de = deckEntries[i];
		// Row 0: charge top position + mass
		data[i * 4 + 0] = de.topX;
		data[i * 4 + 1] = de.topY;
		data[i * 4 + 2] = de.topZ;
		data[i * 4 + 3] = de.mass;
		// Row 1: charge base position + density
		data[width * 4 + i * 4 + 0] = de.baseX;
		data[width * 4 + i * 4 + 1] = de.baseY;
		data[width * 4 + i * 4 + 2] = de.baseZ;
		data[width * 4 + i * 4 + 3] = de.density;
		// Row 2: VOD, hole diameter, timing, hole index
		data[width * 2 * 4 + i * 4 + 0] = de.vod;
		data[width * 2 * 4 + i * 4 + 1] = de.holeDiamMm;
		data[width * 2 * 4 + i * 4 + 2] = de.timingMs;
		data[width * 2 * 4 + i * 4 + 3] = de.holeIndex;
	}

	var texture = new THREE.DataTexture(data, width, ROWS_PER_DECK, THREE.RGBAFormat, THREE.FloatType);
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.needsUpdate = true;

	console.log("prepareDeckDataTexture: packed " + deckEntries.length + " deck entries from " + holes.length + " holes");

	return { texture: texture, count: deckEntries.length, width: width };
}
