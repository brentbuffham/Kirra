// src/shaders/analytics/models/PressureModel.js
import * as THREE from "three";

/**
 * PressureModel implements borehole pressure analysis using per-deck data.
 *
 * Borehole wall pressure: Pb = ρ_e × VOD² / 8
 * Attenuation with distance: P(R) = Pb × (a / R)^α
 *
 * where:
 *   ρ_e  = explosive density (kg/m³) — from deck product
 *   VOD  = velocity of detonation (m/s) — from deck product
 *   a    = borehole radius (m) — from deck holeDiamMm
 *   R    = distance from observation point to nearest point on deck segment (m)
 *   α    = attenuation exponent (≈ 2 for cylindrical divergence)
 *
 * Uses distToSegment for smooth, artifact-free contours (no discrete elements).
 * Air gaps between decks are naturally excluded since only charged decks
 * appear in the deck data texture.
 */
export class PressureModel {
	constructor() {
		this.name = "pressure";
		this.displayName = "Borehole Pressure";
		this.unit = "MPa";
		this.defaultColourRamp = "pressure";
		this.defaultMin = 0;
		this.defaultMax = 100;   // MPa
	}

	getDefaultParams() {
		return {
			attenuationExponent: 2.0,   // α — geometric spreading exponent
			fallbackDensity: 1.2,       // kg/L — only when no charging data
			fallbackVOD: 5000,          // m/s — only when no per-deck VOD
			cutoffDistance: 0.3,        // minimum distance (m) to avoid singularity
			maxDisplayDistance: 50.0     // m — max distance from nearest hole to render
		};
	}

	/**
	 * GLSL fragment shader source.
	 *
	 * Per-deck DataTexture layout (3 rows × deckCount):
	 *   Row 0: [topX, topY, topZ, deckMassKg]
	 *   Row 1: [baseX, baseY, baseZ, densityKgPerL]
	 *   Row 2: [vodMs, holeDiamMm, timing_ms, holeIndex]
	 */
	getFragmentSource() {
		return `
			precision highp float;

			// Standard hole data (kept for compatibility but not used by this model)
			uniform sampler2D uHoleData;
			uniform int uHoleCount;
			uniform float uHoleDataWidth;

			// Per-deck data texture (3 rows × deckCount columns)
			uniform sampler2D uDeckData;
			uniform int uDeckCount;
			uniform float uDeckDataWidth;

			uniform float uAttenuationExp;
			uniform float uFallbackDensity;
			uniform float uFallbackVOD;
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
				float peakPressure = 0.0;
				float minDist = 1e10;

				for (int i = 0; i < 512; i++) {
					if (i >= uDeckCount) break;

					vec4 top = getDeckData(i, 0);   // [topX, topY, topZ, mass]
					vec4 bot = getDeckData(i, 1);   // [baseX, baseY, baseZ, density]
					vec4 extra = getDeckData(i, 2); // [vod, holeDiamMm, timing, holeIndex]

					vec3 topPos = top.xyz;
					vec3 botPos = bot.xyz;
					float mass = top.w;
					float densityKgPerL = bot.w;
					float vod = extra.x;
					float holeDiamMm = extra.y;

					if (mass <= 0.0) continue;

					// Time filtering: skip decks that haven't fired yet
					float timing_d = extra.z;
					if (uDisplayTime >= 0.0 && timing_d > uDisplayTime) continue;

					// Quick distance check to midpoint
					vec3 mid = (topPos + botPos) * 0.5;
					float distToMid = distance(vWorldPos, mid);
					if (distToMid > uMaxDisplayDistance) continue;
					minDist = min(minDist, distToMid);

					// Physical properties from deck data
					float holeRadius = holeDiamMm * 0.0005;  // mm -> m radius
					float effectiveVOD = vod > 0.0 ? vod : uFallbackVOD;
					float rho_e = densityKgPerL > 0.0 ? densityKgPerL * 1000.0 : uFallbackDensity * 1000.0;  // kg/L -> kg/m³

					// Borehole wall pressure: Pb = ρ_e × VOD² / 8 (Pa -> MPa)
					float Pb_MPa = rho_e * effectiveVOD * effectiveVOD * 0.125 / 1000000.0;

					// Distance from observation point to deck segment (smooth, no halos)
					float R = max(distToSegment(vWorldPos, topPos, botPos), uCutoff);

					// P(R) = Pb × (a / R)^α
					float P_deck = Pb_MPa * pow(holeRadius / R, uAttenuationExp);
					peakPressure = max(peakPressure, P_deck);
				}

				if (peakPressure <= 0.0 || minDist > uMaxDisplayDistance) discard;

				float t = clamp((peakPressure - uMinValue) / (uMaxValue - uMinValue), 0.0, 1.0);
				vec4 colour = texture2D(uColourRamp, vec2(t, 0.5));

				// Edge fade
				float edgeFade = 1.0 - smoothstep(uMaxDisplayDistance * 0.85, uMaxDisplayDistance, minDist);
				colour.a *= uOpacity * edgeFade;

				if (peakPressure < uMinValue * 0.01) discard;
				gl_FragColor = colour;
			}
		`;
	}

	getUniforms(params) {
		var p = Object.assign(this.getDefaultParams(), params || {});
		var deckData = p._deckData;

		var uniforms = {
			uAttenuationExp: { value: p.attenuationExponent },
			uFallbackDensity: { value: p.fallbackDensity },
			uFallbackVOD: { value: p.fallbackVOD },
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
