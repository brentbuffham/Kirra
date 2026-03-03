// src/shaders/analytics/models/ScaledHeelanModel.js
import * as THREE from "three";

/**
 * ScaledHeelanModel implements the Scaled Heelan model (Blair & Minchinton 2006)
 * using per-deck data.
 *
 * Each charged deck is subdivided into uElemsPerDeck sub-elements. Blair's (2008)
 * non-linear superposition with radiation patterns is applied per deck:
 *   Em = [m*w_e]^A - [(m-1)*w_e]^A
 *   vppv_element = K * Em * R^(-B) * F(phi)
 *
 * Air gaps between decks are naturally excluded. Each deck uses its own VOD
 * for frequency/attenuation calculations.
 *
 * Reference: Blair & Minchinton (2006), "Near-field blast vibration models", Fragblast-8
 */
export class ScaledHeelanModel {
    constructor() {
        this.name = "scaled_heelan";
        this.displayName = "Scaled Heelan (Blair & Minchinton 2006)";
        this.unit = "mm/s";
        this.defaultColourRamp = "jet";
        this.defaultMin = 0;
        this.defaultMax = 300;  // mm/s VPPV
    }

    getDefaultParams() {
        return {
            K: 1140,
            B: 1.6,
            chargeExponent: 0.5,
            elemsPerDeck: 8,
            pWaveVelocity: 4500,
            sWaveVelocity: 2600,
            detonationVelocity: 5500,
            pWaveWeight: 1.0,
            svWaveWeight: 1.0,
            cutoffDistance: 0.5,
            qualityFactorP: 50,
            qualityFactorS: 30
        };
    }

    /**
     * Fragment shader using per-deck data with Blair non-linear superposition
     * and Heelan radiation patterns.
     *
     * Deck DataTexture layout (3 rows × deckCount):
     *   Row 0: [topX, topY, topZ, deckMassKg]
     *   Row 1: [baseX, baseY, baseZ, densityKgPerL]
     *   Row 2: [vodMs, holeDiamMm, timing_ms, holeIndex]
     */
    getFragmentSource() {
        return `
            precision highp float;

            uniform sampler2D uHoleData;
            uniform int uHoleCount;
            uniform float uHoleDataWidth;

            // Per-deck data texture
            uniform sampler2D uDeckData;
            uniform int uDeckCount;
            uniform float uDeckDataWidth;

            // Site law constants
            uniform float uK;
            uniform float uB;
            uniform float uChargeExp;

            // Rock and explosive properties
            uniform float uPWaveVel;
            uniform float uSWaveVel;
            uniform float uVOD;
            uniform float uPWeight;
            uniform float uSVWeight;

            // Discretisation
            uniform int uElemsPerDeck;
            uniform float uCutoff;

            // Attenuation
            uniform float uQp;
            uniform float uQs;

            // Time filtering
            uniform float uDisplayTime;

            // Colour mapping
            uniform sampler2D uColourRamp;
            uniform float uMinValue;
            uniform float uMaxValue;
            uniform float uOpacity;

            varying vec3 vWorldPos;

            vec4 getHoleData(int index, int row) {
                float u = (float(index) + 0.5) / uHoleDataWidth;
                float v = (float(row) + 0.5) / 4.0;
                return texture2D(uHoleData, vec2(u, v));
            }

            vec4 getDeckData(int index, int row) {
                float u = (float(index) + 0.5) / uDeckDataWidth;
                float v = (float(row) + 0.5) / 3.0;
                return texture2D(uDeckData, vec2(u, v));
            }

            // Heelan P-wave radiation pattern
            float F1(float sinPhi, float cosPhi) {
                return 2.0 * sinPhi * cosPhi * cosPhi;
            }

            // Heelan SV-wave radiation pattern
            float F2(float sinPhi, float cosPhi) {
                return sinPhi * (2.0 * cosPhi * cosPhi - 1.0);
            }

            void main() {
                float peakVPPV = 0.0;

                for (int d = 0; d < 512; d++) {
                    if (d >= uDeckCount) break;

                    vec4 top = getDeckData(d, 0);
                    vec4 bot = getDeckData(d, 1);
                    vec4 extra = getDeckData(d, 2);

                    vec3 topPos = top.xyz;
                    vec3 botPos = bot.xyz;
                    float deckMass = top.w;
                    float deckVOD = extra.x;
                    float holeDiamMm = extra.y;
                    float timing_d = extra.z;
                    int holeIdx = int(extra.w);

                    if (deckMass <= 0.0) continue;

                    // Time filtering
                    if (uDisplayTime >= 0.0 && timing_d > uDisplayTime) continue;

                    // Deck geometry
                    vec3 deckAxis = botPos - topPos;
                    float deckLen = length(deckAxis);
                    if (deckLen < 0.001) continue;
                    vec3 deckDir = deckAxis / deckLen;

                    // Get hole axis from main hole data
                    vec4 holeCollar = getHoleData(holeIdx, 0);
                    vec4 holeToe = getHoleData(holeIdx, 1);
                    vec3 holeAxis = normalize(holeToe.xyz - holeCollar.xyz);
                    float holeLen = holeToe.w;

                    float holeRadius = holeDiamMm * 0.0005;
                    float effectiveVOD = deckVOD > 0.0 ? deckVOD : uVOD;

                    // Sub-element properties
                    float dL = deckLen / float(uElemsPerDeck);
                    float elementMass = deckMass / float(uElemsPerDeck);  // w_e (kg)

                    // Incoherent (RMS) superposition
                    float sumEnergy = 0.0;

                    for (int m = 0; m < 32; m++) {
                        if (m >= uElemsPerDeck) break;

                        float elemOffset = (float(m) + 0.5) * dL;
                        vec3 elemPos = topPos + deckDir * elemOffset;

                        vec3 toObs = vWorldPos - elemPos;
                        float R = max(length(toObs), uCutoff);

                        float cosPhi = dot(normalize(toObs), holeAxis);
                        float sinPhi = sqrt(max(1.0 - cosPhi * cosPhi, 0.0));

                        // Blair's non-linear superposition (Blair 2008, Eq. 3)
                        float mwe = float(m + 1) * elementMass;
                        float m1we = float(m) * elementMass;
                        float Em = pow(mwe, uChargeExp) - (m1we > 0.0 ? pow(m1we, uChargeExp) : 0.0);

                        // PPV_element = K * Em * R^(-B)
                        float vppvElement = uK * Em * pow(R, -uB);

                        float f1 = F1(sinPhi, cosPhi);
                        float f2 = F2(sinPhi, cosPhi);

                        // Viscoelastic attenuation (using per-deck VOD for frequency)
                        float attP = 1.0;
                        float attS = 1.0;
                        if (uQp > 0.0) {
                            float omega = effectiveVOD / (2.0 * holeRadius);
                            attP = exp(-omega * R / (2.0 * uQp * uPWaveVel));
                            attS = exp(-omega * R / (2.0 * uQs * uSWaveVel));
                        }

                        float vP  = vppvElement * f1 * uPWeight * attP;
                        float vSV = vppvElement * f2 * uSVWeight * attS;

                        sumEnergy += vP * vP + vSV * vSV;
                    }

                    // Attenuate below the toe
                    float projOnAxis = dot(vWorldPos - holeCollar.xyz, holeAxis);
                    float belowToe = projOnAxis - holeLen;
                    if (belowToe > 0.0) {
                        float decayLen = max(deckLen * 0.15, holeRadius * 4.0);
                        float att = exp(-belowToe / decayLen);
                        sumEnergy *= att * att;
                    }

                    float vppv = sqrt(sumEnergy);
                    peakVPPV = max(peakVPPV, vppv);
                }

                float t = clamp((peakVPPV - uMinValue) / (uMaxValue - uMinValue), 0.0, 1.0);
                vec4 colour = texture2D(uColourRamp, vec2(t, 0.5));
                colour.a *= uOpacity;

                if (peakVPPV < uMinValue * 0.01) discard;
                gl_FragColor = colour;
            }
        `;
    }

    getUniforms(params) {
        var p = Object.assign(this.getDefaultParams(), params || {});
        var deckData = p._deckData;

        var uniforms = {
            uK: { value: p.K },
            uB: { value: p.B },
            uChargeExp: { value: p.chargeExponent },
            uPWaveVel: { value: p.pWaveVelocity },
            uSWaveVel: { value: p.sWaveVelocity },
            uVOD: { value: p.detonationVelocity },
            uPWeight: { value: p.pWaveWeight },
            uSVWeight: { value: p.svWaveWeight },
            uElemsPerDeck: { value: p.elemsPerDeck },
            uCutoff: { value: p.cutoffDistance },
            uQp: { value: p.qualityFactorP },
            uQs: { value: p.qualityFactorS },
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
