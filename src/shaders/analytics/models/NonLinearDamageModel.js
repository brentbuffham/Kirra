// src/shaders/analytics/models/NonLinearDamageModel.js
import * as THREE from "three";

/**
 * NonLinearDamageModel implements the Holmberg-Persson near-field damage model
 * using per-deck data.
 *
 * The Holmberg-Persson (H-P) approach integrates PPV contributions along each
 * charged deck, rather than treating each hole as a single charge column.
 * Multi-deck holes produce separate damage zones per deck, with air gaps
 * naturally excluded.
 *
 * Each deck is subdivided into uElemsPerDeck sub-elements:
 *   PPV_i = K * (q * dL)^α / R_i^β
 *
 * where q = linear charge density (kg/m), dL = sub-element length (m),
 * R_i = distance from sub-element centre to observation point.
 *
 * Elements are summed incoherently (RMS) within each deck:
 *   PPV_deck = sqrt( Σ PPV_i² )
 *
 * The damage index is: DI = peakPPV / PPV_critical
 *
 * Reference: Holmberg & Persson (1979), "Design of tunnel perimeter blasthole
 * patterns to prevent rock damage"
 */
export class NonLinearDamageModel {
    constructor() {
        this.name = "nonlinear_damage";
        this.displayName = "Holmberg-Persson Damage";
        this.unit = "DI";   // Damage Index 0-1
        this.defaultColourRamp = "damage";
        this.defaultMin = 0;
        this.defaultMax = 1.0;
    }

    getDefaultParams() {
        return {
            K_hp: 700,                 // H-P site constant
            alpha_hp: 0.7,             // H-P charge exponent
            beta_hp: 1.5,              // H-P distance exponent
            ppvCritical: 700,          // mm/s — PPV threshold for crack initiation
            elemsPerDeck: 8,           // sub-elements per deck
            cutoffDistance: 0.3        // Minimum distance (m) to avoid singularity
        };
    }

    /**
     * Fragment shader for Holmberg-Persson near-field damage using per-deck data.
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

            // Per-deck data texture (3 rows × deckCount columns)
            uniform sampler2D uDeckData;
            uniform int uDeckCount;
            uniform float uDeckDataWidth;

            // H-P site constants
            uniform float uK_hp;
            uniform float uAlpha;
            uniform float uBeta;
            uniform float uPPVCritical;

            // Discretisation
            uniform int uElemsPerDeck;
            uniform float uCutoff;

            // Time filtering
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
                float peakPPV = 0.0;

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

                    // Time filtering
                    if (uDisplayTime >= 0.0 && timing_d > uDisplayTime) continue;

                    // Deck geometry
                    vec3 deckAxis = botPos - topPos;
                    float deckLen = length(deckAxis);
                    if (deckLen < 0.001) continue;
                    vec3 deckDir = deckAxis / deckLen;

                    // Sub-element properties
                    float dL = deckLen / float(uElemsPerDeck);
                    float linearDensity = deckMass / deckLen;  // kg/m
                    float elementCharge = linearDensity * dL;  // kg

                    // Incoherent (RMS) sum of sub-element contributions
                    float sumPPVsq = 0.0;

                    for (int m = 0; m < 32; m++) {
                        if (m >= uElemsPerDeck) break;

                        // Sub-element centre within deck (from top to base)
                        float elemOffset = (float(m) + 0.5) * dL;
                        vec3 elemPos = topPos + deckDir * elemOffset;

                        float R = max(length(vWorldPos - elemPos), uCutoff);

                        // H-P per element: PPV_i = K * (q*dL)^α / R^β
                        float ppvElem = uK_hp * pow(elementCharge, uAlpha) * pow(R, -uBeta);
                        sumPPVsq += ppvElem * ppvElem;
                    }

                    // RMS PPV for this deck
                    float deckPPV = sqrt(sumPPVsq);
                    peakPPV = max(peakPPV, deckPPV);
                }

                // Damage index: ratio of peak PPV to critical PPV
                float damageIndex = clamp(peakPPV / uPPVCritical, 0.0, 1.0);

                float t = clamp((damageIndex - uMinValue) / (uMaxValue - uMinValue), 0.0, 1.0);
                vec4 colour = texture2D(uColourRamp, vec2(t, 0.5));
                colour.a *= uOpacity;

                if (damageIndex < 0.01) discard;
                gl_FragColor = colour;
            }
        `;
    }

    getUniforms(params) {
        var p = Object.assign(this.getDefaultParams(), params || {});
        var deckData = p._deckData;

        var uniforms = {
            uK_hp: { value: p.K_hp },
            uAlpha: { value: p.alpha_hp },
            uBeta: { value: p.beta_hp },
            uPPVCritical: { value: p.ppvCritical },
            uElemsPerDeck: { value: p.elemsPerDeck },
            uCutoff: { value: p.cutoffDistance },
            uDisplayTime: { value: p.displayTime !== undefined ? p.displayTime : -1.0 }
        };

        // Deck texture from prepareDeckDataTexture
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
