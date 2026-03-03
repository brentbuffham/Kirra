// src/shaders/analytics/models/JointedRockDamageModel.js
import * as THREE from "three";

/**
 * JointedRockDamageModel implements a simplified jointed rock damage analysis
 * using per-deck data.
 *
 * Combines intact rock fracture with joint-controlled failure:
 *
 * 1. Compute PPV using Holmberg-Persson integration along each charged deck
 *    (sub-elements within real deck bounds, air gaps excluded)
 *
 * 2. Convert PPV to dynamic stress:
 *    σ_d = ρ_rock × Vp × PPV
 *
 * 3. Intact rock fracture ratio:
 *    FR_rock = σ_d / σ_t  (tensile strength)
 *
 * 4. Mohr-Coulomb failure on joints:
 *    FR_joint = τ / (c + μ × σ_n)
 *
 * 5. Output = max(FR_rock, FR_joint)
 *
 * Values > 1.0 indicate damage/failure.
 */
export class JointedRockDamageModel {
	constructor() {
		this.name = "jointed_rock";
		this.displayName = "Jointed Rock Damage";
		this.unit = "damage ratio";
		this.defaultColourRamp = "damage";
		this.defaultMin = 0;
		this.defaultMax = 2.0;
	}

	getDefaultParams() {
		return {
			// Holmberg-Persson site law constants
			K_hp: 700,
			alpha_hp: 0.7,
			beta_hp: 1.5,
			// Rock mass properties
			rockTensileStrength: 10,    // MPa
			rockDensity: 2700,          // kg/m³
			pWaveVelocity: 4500,        // m/s
			// Joint properties
			jointSetAngle: 45,          // degrees
			jointCohesion: 0.1,         // MPa
			jointFrictionAngle: 30,     // degrees
			// Numerical
			elemsPerDeck: 8,            // sub-elements per deck
			cutoffDistance: 0.3,
			maxDisplayDistance: 50.0
		};
	}

	/**
	 * Fragment shader using per-deck data texture.
	 *
	 * Deck DataTexture layout (3 rows × deckCount):
	 *   Row 0: [topX, topY, topZ, deckMassKg]
	 *   Row 1: [baseX, baseY, baseZ, densityKgPerL]
	 *   Row 2: [vodMs, holeDiamMm, timing_ms, holeIndex]
	 */
	getFragmentSource() {
		return `
			precision highp float;

			// Standard hole data (kept for compatibility)
			uniform sampler2D uHoleData;
			uniform int uHoleCount;
			uniform float uHoleDataWidth;

			// Per-deck data texture
			uniform sampler2D uDeckData;
			uniform int uDeckCount;
			uniform float uDeckDataWidth;

			// Holmberg-Persson constants
			uniform float uK_hp;
			uniform float uAlpha_hp;
			uniform float uBeta_hp;

			// Rock mass properties
			uniform float uRockTensile;
			uniform float uRockDensity;
			uniform float uPWaveVel;

			// Joint properties
			uniform float uJointAngleRad;
			uniform float uJointCohesion;
			uniform float uJointFriction;

			// Numerical
			uniform int uElemsPerDeck;
			uniform float uCutoff;
			uniform float uMaxDisplayDistance;
			uniform float uDisplayTime;

			// Colour mapping
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

			void main() {
				float peakDamageRatio = 0.0;
				float minDist = 1e10;

				for (int d = 0; d < 512; d++) {
					if (d >= uDeckCount) break;

					vec4 top = getDeckData(d, 0);
					vec4 bot = getDeckData(d, 1);
					vec4 extra = getDeckData(d, 2);

					vec3 topPos = top.xyz;
					vec3 botPos = bot.xyz;
					float deckMass = top.w;

					if (deckMass <= 0.0) continue;

					// Time filtering: skip decks that haven't fired yet
					float timing_d = extra.z;
					if (uDisplayTime >= 0.0 && timing_d > uDisplayTime) continue;

					// Quick distance check to midpoint
					vec3 mid = (topPos + botPos) * 0.5;
					float distToMid = distance(vWorldPos, mid);
					if (distToMid > uMaxDisplayDistance) continue;
					minDist = min(minDist, distToMid);

					// Deck geometry
					vec3 deckAxis = botPos - topPos;
					float deckLen = length(deckAxis);
					if (deckLen < 0.001) continue;
					vec3 deckDir = deckAxis / deckLen;

					// Sub-element properties
					float dL = deckLen / float(uElemsPerDeck);
					float linearDensity = deckMass / deckLen;
					float q = linearDensity * dL;  // element mass (kg)

					// Holmberg-Persson integration (incoherent RMS sum)
					float sumPPV2 = 0.0;

					for (int m = 0; m < 32; m++) {
						if (m >= uElemsPerDeck) break;

						float elemOffset = (float(m) + 0.5) * dL;
						vec3 elemPos = topPos + deckDir * elemOffset;
						float R = max(distance(vWorldPos, elemPos), uCutoff);

						float ppv_i = uK_hp * pow(q, uAlpha_hp) / pow(R, uBeta_hp);
						sumPPV2 += ppv_i * ppv_i;
					}

					float ppv = sqrt(sumPPV2);  // mm/s (RMS)

					// Convert PPV to dynamic stress (MPa)
					float sigma_d = uRockDensity * uPWaveVel * ppv * 0.001 / 1000000.0;

					// Intact rock fracture ratio
					float FR_rock = sigma_d / max(uRockTensile, 0.001);

					// Joint failure
					float cosTheta = cos(uJointAngleRad);
					float sinTheta = sin(uJointAngleRad);
					float sigma_n = sigma_d * cosTheta * cosTheta;
					float tau = sigma_d * sinTheta * cosTheta;
					float denominator = uJointCohesion + uJointFriction * sigma_n;
					float FR_joint = denominator > 0.001 ? tau / denominator : 0.0;

					float damageRatio = max(FR_rock, FR_joint);
					peakDamageRatio = max(peakDamageRatio, damageRatio);
				}

				if (peakDamageRatio <= 0.0 || minDist > uMaxDisplayDistance) discard;

				float t = clamp((peakDamageRatio - uMinValue) / (uMaxValue - uMinValue), 0.0, 1.0);
				vec4 colour = texture2D(uColourRamp, vec2(t, 0.5));

				float edgeFade = 1.0 - smoothstep(uMaxDisplayDistance * 0.85, uMaxDisplayDistance, minDist);
				colour.a *= uOpacity * edgeFade;

				if (peakDamageRatio < uMinValue * 0.01) discard;
				gl_FragColor = colour;
			}
		`;
	}

	getUniforms(params) {
		var p = Object.assign(this.getDefaultParams(), params || {});
		var jointAngleRad = p.jointSetAngle * Math.PI / 180.0;
		var frictionCoeff = Math.tan((p.jointFrictionAngle || 30) * Math.PI / 180.0);
		var deckData = p._deckData;

		var uniforms = {
			uK_hp: { value: p.K_hp },
			uAlpha_hp: { value: p.alpha_hp },
			uBeta_hp: { value: p.beta_hp },
			uRockTensile: { value: p.rockTensileStrength },
			uRockDensity: { value: p.rockDensity },
			uPWaveVel: { value: p.pWaveVelocity },
			uJointAngleRad: { value: jointAngleRad },
			uJointCohesion: { value: p.jointCohesion },
			uJointFriction: { value: frictionCoeff },
			uElemsPerDeck: { value: p.elemsPerDeck },
			uCutoff: { value: p.cutoffDistance },
			uMaxDisplayDistance: { value: p.maxDisplayDistance },
			uDisplayTime: { value: p.displayTime !== undefined ? p.displayTime : -1.0 }
		};

		if (deckData && deckData.texture) {
			uniforms.uDeckData = { value: deckData.texture };
			uniforms.uDeckCount = { value: deckData.count };
			uniforms.uDeckDataWidth = { value: deckData.width };
		} else {
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
