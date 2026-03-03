// src/shaders/analytics/models/PPVDeckModel.js
import * as THREE from "three";

/**
 * PPVDeckModel implements per-deck Peak Particle Velocity analysis.
 *
 * For each charged deck, evaluates PPV at 3 positions along the deck
 * (top, centre, base) using the deck's own mass. Takes the maximum
 * across all deck evaluations.
 *
 * Formula per evaluation point: PPV = K * (D / Q^e)^(-B)
 *
 * Advantages over point PPV:
 * - Multi-deck holes show per-deck influence zones
 * - Air gaps between decks are naturally excluded
 * - Each deck uses its own mass (not total hole mass)
 *
 * Supports timing window: decks firing within a time window can be
 * combined (mass-weighted centroid of deck midpoints, summed mass).
 */
export class PPVDeckModel {
	constructor() {
		this.name = "ppv_deck";
		this.displayName = "PPV (Per-Deck)";
		this.unit = "mm/s";
		this.defaultColourRamp = "ppv";
		this.defaultMin = 0;
		this.defaultMax = 200;   // mm/s
	}

	getDefaultParams() {
		return {
			K: 1140,              // site constant
			B: 1.6,               // site exponent
			chargeExponent: 0.5,  // 0.5 = square-root scaling (SD)
			cutoffDistance: 1.0,  // minimum distance (metres)
			pWaveVelocity: 0.0,   // m/s — P-wave velocity for propagation animation (0 = instant)
			targetPPV: 0.0,       // target PPV band (0 = disabled)
			timeWindow: 0.0,      // ms — decks within this window are combined (0 = per-deck peak)
			timeOffset: -1.0,     // ms — centre of timing window (-1 = disabled)
			maxDisplayDistance: 200.0  // m — max distance to render
		};
	}

	/**
	 * Fragment shader using per-deck data texture.
	 *
	 * When timeWindow is 0 (default), excludes the O(n²) nested loop entirely.
	 * WebGL compilers compile ALL branches — even unused ones cause shader
	 * compilation failure on GPUs that can't handle 512×512 iteration loops.
	 *
	 * Deck DataTexture layout (3 rows × deckCount):
	 *   Row 0: [topX, topY, topZ, deckMassKg]
	 *   Row 1: [baseX, baseY, baseZ, densityKgPerL]
	 *   Row 2: [vodMs, holeDiamMm, timing_ms, holeIndex]
	 */
	getFragmentSource(params) {
		var useTimeWindow = params && params.timeWindow > 0;

		var header = `
			precision highp float;

			// Standard hole data (unused by deck PPV but required by base uniforms)
			uniform sampler2D uHoleData;
			uniform int uHoleCount;
			uniform float uHoleDataWidth;

			// Per-deck data texture (3 rows × deckCount columns)
			uniform sampler2D uDeckData;
			uniform int uDeckCount;
			uniform float uDeckDataWidth;

			uniform float uK;
			uniform float uB;
			uniform float uChargeExp;
			uniform float uCutoff;
			uniform float uTargetPPV;
			uniform float uTimeWindow;
			uniform float uTimeOffset;
			uniform float uMaxDisplayDistance;
			uniform float uDisplayTime;
			uniform float uPWaveVel;
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
		`;

		var footer = `
				if (peakPPV <= 0.0 || minDist > uMaxDisplayDistance) discard;
				if (peakPPV < uMinValue * 0.01) discard;

				vec4 colour;
				if (uTargetPPV > 0.0) {
					// Split colour ramp at target PPV boundary
					// Above target: Red (max) → Green (target)
					// Below target: Blue (target) → Purple (0)
					if (peakPPV >= uTargetPPV) {
						float aboveRange = max(uMaxValue - uTargetPPV, 0.001);
						float t = clamp((peakPPV - uTargetPPV) / aboveRange, 0.0, 1.0);
						// t=0 (at target) = green, t=1 (at max) = red
						colour = vec4(t, 1.0 - t * 0.6, 0.0, 1.0);
					} else {
						float t = clamp(peakPPV / max(uTargetPPV, 0.001), 0.0, 1.0);
						// t=1 (at target) = blue, t=0 (at 0) = purple
						colour = vec4(0.5 * (1.0 - t), 0.0, 0.5 + 0.5 * t, 1.0);
					}
				} else {
					float t = clamp((peakPPV - uMinValue) / (uMaxValue - uMinValue), 0.0, 1.0);
					colour = texture2D(uColourRamp, vec2(t, 0.5));
				}
				colour.a *= uOpacity;
				gl_FragColor = colour;
			}
		`;

		if (useTimeWindow) {
			// Time-window MIC mode: O(n²) nested loop — only compiled when needed
			return header + `
			void main() {
				float peakPPV = 0.0;
				float minDist = 1e10;

				for (int d = 0; d < 512; d++) {
					if (d >= uDeckCount) break;

					vec4 top_d = getDeckData(d, 0);
					vec4 bot_d = getDeckData(d, 1);
					vec4 extra_d = getDeckData(d, 2);

					float mass_d = top_d.w;
					if (mass_d <= 0.0) continue;

					// Quick distance check
					vec3 midPos_d = (top_d.xyz + bot_d.xyz) * 0.5;
					float distCheck = distance(vWorldPos, midPos_d);
					if (distCheck > uMaxDisplayDistance) continue;

					float timing_d = extra_d.z;
					if (uDisplayTime >= 0.0) {
						float arrivalTime_d = timing_d;
						if (uPWaveVel > 0.0) arrivalTime_d += (distCheck / uPWaveVel) * 1000.0;
						if (arrivalTime_d > uDisplayTime) continue;
					}
					minDist = min(minDist, distCheck);

					// Determine bin index for deck d
					float bin_d = (uTimeOffset > 0.0 && timing_d < uTimeOffset)
						? -1.0
						: floor((timing_d - uTimeOffset) / uTimeWindow);

					// Sum masses of all decks in the same bin → MIC
					float mic = 0.0;
					for (int j = 0; j < 512; j++) {
						if (j >= uDeckCount) break;
						vec4 top_j = getDeckData(j, 0);
						float mass_j = top_j.w;
						if (mass_j <= 0.0) continue;

						vec4 extra_j = getDeckData(j, 2);
						float t_j = extra_j.z;
						if (uDisplayTime >= 0.0 && t_j > uDisplayTime) continue;

						float bin_j = (uTimeOffset > 0.0 && t_j < uTimeOffset)
							? -1.0
							: floor((t_j - uTimeOffset) / uTimeWindow);

						if (abs(bin_j - bin_d) < 0.5) {
							mic += mass_j;
						}
					}

					if (mic <= 0.0) continue;

					// Evaluate PPV at top/mid/base of this deck using bin MIC
					vec3 topPos = top_d.xyz;
					vec3 botPos = bot_d.xyz;
					vec3 midPos = (topPos + botPos) * 0.5;

					float sd, ppv;
					sd = max(distance(vWorldPos, topPos), uCutoff) / pow(mic, uChargeExp);
					ppv = uK * pow(sd, -uB);
					peakPPV = max(peakPPV, ppv);

					sd = max(distance(vWorldPos, midPos), uCutoff) / pow(mic, uChargeExp);
					ppv = uK * pow(sd, -uB);
					peakPPV = max(peakPPV, ppv);

					sd = max(distance(vWorldPos, botPos), uCutoff) / pow(mic, uChargeExp);
					ppv = uK * pow(sd, -uB);
					peakPPV = max(peakPPV, ppv);
				}
			` + footer;
		} else {
			// Per-deck peak mode: O(n) single loop — fast, compiles on all GPUs
			return header + `
			void main() {
				float peakPPV = 0.0;
				float minDist = 1e10;

				for (int d = 0; d < 512; d++) {
					if (d >= uDeckCount) break;

					vec4 top = getDeckData(d, 0);
					vec4 bot = getDeckData(d, 1);
					vec4 extra = getDeckData(d, 2);

					vec3 topPos = top.xyz;
					vec3 botPos = bot.xyz;
					float deckMass = top.w;
					float timing_d = extra.z;

					if (deckMass <= 0.0) continue;

					// Quick distance check to midpoint
					vec3 midPos = (topPos + botPos) * 0.5;
					float distToMid = distance(vWorldPos, midPos);
					if (distToMid > uMaxDisplayDistance) continue;

					// Display time filter with P-wave travel time
					if (uDisplayTime >= 0.0) {
						float arrivalTime = timing_d;
						if (uPWaveVel > 0.0) arrivalTime += (distToMid / uPWaveVel) * 1000.0;
						if (arrivalTime > uDisplayTime) continue;
					}
					minDist = min(minDist, distToMid);

					// Evaluate PPV at 3 deck positions, take max
					float sd_top = max(distance(vWorldPos, topPos), uCutoff) / pow(deckMass, uChargeExp);
					float sd_mid = max(distance(vWorldPos, midPos), uCutoff) / pow(deckMass, uChargeExp);
					float sd_bot = max(distance(vWorldPos, botPos), uCutoff) / pow(deckMass, uChargeExp);

					float ppv_top = uK * pow(sd_top, -uB);
					float ppv_mid = uK * pow(sd_mid, -uB);
					float ppv_bot = uK * pow(sd_bot, -uB);

					float deckPPV = max(ppv_top, max(ppv_mid, ppv_bot));
					peakPPV = max(peakPPV, deckPPV);
				}
			` + footer;
		}
	}

	getUniforms(params) {
		var p = Object.assign(this.getDefaultParams(), params || {});
		var deckData = p._deckData;

		var uniforms = {
			uK: { value: p.K },
			uB: { value: p.B },
			uChargeExp: { value: p.chargeExponent },
			uCutoff: { value: p.cutoffDistance },
			uPWaveVel: { value: p.pWaveVelocity || 0.0 },
			uTargetPPV: { value: p.targetPPV || 0.0 },
			uTimeWindow: { value: p.timeWindow || 0.0 },
			uTimeOffset: { value: p.timeOffset !== undefined ? p.timeOffset : -1.0 },
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
