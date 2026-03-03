// src/shaders/analytics/models/HeelanOriginalModel.js
import * as THREE from "three";

/**
 * HeelanOriginalModel implements the Original Heelan model based on Heelan's (1953)
 * analytical solution as formulated by Blair & Minchinton (1996).
 *
 * Now uses per-deck data: each charged deck is subdivided into uElemsPerDeck
 * sub-elements with radiation patterns F1(phi) and F2(phi). Air gaps between
 * decks are naturally excluded. Each deck uses its own VOD for frequency/attenuation.
 *
 * The hole axis direction is reconstructed from the main hole data texture using
 * the holeIndex stored in the deck data.
 *
 * Reference: Blair & Minchinton (1996), "On the damage zone surrounding a single
 * blasthole", Fragblast-5
 */
export class HeelanOriginalModel {
    constructor() {
        this.name = "heelan_original";
        this.displayName = "Heelan Original (Blair & Minchinton 1996)";
        this.unit = "mm/s";
        this.defaultColourRamp = "jet";
        this.defaultMin = 0;
        this.defaultMax = 300;   // mm/s VPPV
    }

    getDefaultParams() {
        return {
            rockDensity: 2700,         // rho, kg/m^3
            pWaveVelocity: 4500,       // Vp, m/s
            sWaveVelocity: 2600,       // Vs, m/s
            detonationVelocity: 5500,  // VOD, m/s — fallback when no product VOD assigned
            boreholePressure: 0,       // Pb, Pa (0 = auto-calculate)
            elemsPerDeck: 8,           // sub-elements per deck
            cutoffDistance: 0.5,       // minimum distance, m
            qualityFactorP: 50,        // Q_p — P-wave quality factor (0 = elastic)
            qualityFactorS: 30         // Q_s — S-wave quality factor (0 = elastic)
        };
    }

    /**
     * Fragment shader using per-deck data with Heelan radiation patterns.
     *
     * Deck DataTexture layout (3 rows × deckCount):
     *   Row 0: [topX, topY, topZ, deckMassKg]
     *   Row 1: [baseX, baseY, baseZ, densityKgPerL]
     *   Row 2: [vodMs, holeDiamMm, timing_ms, holeIndex]
     *
     * Main hole data (4 rows) used for hole axis via holeIndex:
     *   Row 0: [collarX, collarY, collarZ, ...]
     *   Row 1: [toeX, toeY, toeZ, ...]
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

            // Rock mass properties
            uniform float uRockDensity;
            uniform float uPWaveVel;
            uniform float uSWaveVel;
            uniform float uVOD;
            uniform float uCutoff;
            uniform int uElemsPerDeck;
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

            // Heelan P-wave radiation pattern: F1(phi) = sin(2*phi) * cos(phi)
            float F1(float sinPhi, float cosPhi) {
                return 2.0 * sinPhi * cosPhi * cosPhi;
            }

            // Heelan SV-wave radiation pattern: F2(phi) = sin(phi) * cos(2*phi)
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
                    float densityKgPerL = bot.w;
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

                    // Get hole axis from main hole data (for radiation pattern reference)
                    vec4 holeCollar = getHoleData(holeIdx, 0);
                    vec4 holeToe = getHoleData(holeIdx, 1);
                    vec3 holeAxis = normalize(holeToe.xyz - holeCollar.xyz);
                    float holeLen = holeToe.w;

                    float holeRadius = holeDiamMm * 0.0005;
                    float effectiveVOD = deckVOD > 0.0 ? deckVOD : uVOD;

                    // Borehole pressure from deck product density and VOD
                    float rho_e = densityKgPerL > 0.0 ? densityKgPerL * 1000.0 : 1200.0;  // kg/m³
                    float Pb = rho_e * effectiveVOD * effectiveVOD * 0.125;

                    // Sub-element properties
                    float dL = deckLen / float(uElemsPerDeck);

                    // Superpose contributions from each sub-element
                    float sumVr = 0.0;
                    float sumVz = 0.0;

                    for (int m = 0; m < 32; m++) {
                        if (m >= uElemsPerDeck) break;

                        float elemOffset = (float(m) + 0.5) * dL;
                        vec3 elemPos = topPos + deckDir * elemOffset;

                        vec3 toObs = vWorldPos - elemPos;
                        float R = max(length(toObs), uCutoff);

                        // Angle phi between hole axis and direction to observation point
                        float cosPhi = dot(normalize(toObs), holeAxis);
                        float sinPhi = sqrt(max(1.0 - cosPhi * cosPhi, 0.0));

                        float f1 = F1(sinPhi, cosPhi);
                        float f2 = F2(sinPhi, cosPhi);

                        float scaleP  = (Pb * holeRadius * holeRadius * dL) /
                                        (uRockDensity * uPWaveVel * uPWaveVel * R);
                        float scaleSV = (Pb * holeRadius * holeRadius * dL) /
                                        (uRockDensity * uSWaveVel * uSWaveVel * R);

                        // Viscoelastic attenuation
                        float omega = effectiveVOD / (2.0 * holeRadius);
                        float attP = 1.0;
                        float attS = 1.0;
                        if (uQp > 0.0) attP = exp(-omega * R / (2.0 * uQp * uPWaveVel));
                        if (uQs > 0.0) attS = exp(-omega * R / (2.0 * uQs * uSWaveVel));

                        float vP  = scaleP  * f1 * omega * attP;
                        float vSV = scaleSV * f2 * omega * attS;

                        sumVr += vP * sinPhi + vSV * cosPhi;
                        sumVz += vP * cosPhi - vSV * sinPhi;
                    }

                    // Attenuate below the toe
                    float projOnAxis = dot(vWorldPos - holeCollar.xyz, holeAxis);
                    float belowToe = projOnAxis - holeLen;
                    if (belowToe > 0.0) {
                        float decayLen = max(deckLen * 0.15, holeRadius * 4.0);
                        float att = exp(-belowToe / decayLen);
                        sumVr *= att;
                        sumVz *= att;
                    }

                    float vppv = sqrt(sumVr * sumVr + sumVz * sumVz) * 1000.0;
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
            uRockDensity: { value: p.rockDensity },
            uPWaveVel: { value: p.pWaveVelocity },
            uSWaveVel: { value: p.sWaveVelocity },
            uVOD: { value: p.detonationVelocity },
            uCutoff: { value: p.cutoffDistance },
            uElemsPerDeck: { value: p.elemsPerDeck },
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
