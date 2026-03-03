// src/shaders/analytics/models/PPVModel.js

/**
 * PPVModel implements a simple Peak Particle Velocity site law.
 *
 * Formula: PPV = K * (D / Q^e)^(-B)
 * where:
 *   K = site constant (intercept)
 *   B = site exponent (slope)
 *   e = charge exponent (typically 0.5 for square-root scaling)
 *   D = distance from charge centroid to observation point
 *   Q = charge mass
 *
 * Improvements over original:
 * - Point source is at charge centroid (midpoint of charge column),
 *   not collar. Produces more physically accurate PPV contours.
 * - Timing window support: charges firing within a time window can be
 *   combined (mass-weighted centroid, summed mass) for cooperative PPV.
 */
export class PPVModel {
    constructor() {
        this.name = "ppv";
        this.displayName = "Peak Particle Velocity (PPV)";
        this.unit = "mm/s";
        this.defaultColourRamp = "ppv";
        this.defaultMin = 0;
        this.defaultMax = 200;   // mm/s
    }

    /**
     * Site law constants — these become shader uniforms.
     * PPV = K * (D / Q^e)^(-B)
     *   K = site constant (intercept)
     *   B = site exponent (slope)
     *   e = charge exponent (typically 0.5 for SD, 0.33 for cube-root)
     */
    getDefaultParams() {
        return {
            K: 1140,              // site constant
            B: 1.6,               // site exponent
            chargeExponent: 0.5,  // 0.5 = square-root scaling (SD)
            cutoffDistance: 1.0,  // minimum distance to avoid singularity (metres)
            pWaveVelocity: 0.0,   // m/s — P-wave velocity for propagation animation (0 = instant)
            targetPPV: 0.0,       // target PPV band (0 = disabled)
            timeWindow: 0.0,      // ms — charges within this window are combined (0 = per-hole peak)
            timeOffset: -1.0      // ms — centre of timing window (-1 = disabled)
        };
    }

    /**
     * Return the GLSL fragment source for this model.
     *
     * Data layout (from ShaderUniformManager):
     *   Row 0: [collarX, collarY, collarZ, totalChargeKg]
     *   Row 1: [toeX, toeY, toeZ, holeLength_m]
     *   Row 2: [MIC_kg, timing_ms, holeDiam_mm, unused]
     *   Row 3: [chargeTopDepth_m, chargeBaseDepth_m, vodMs, totalExplosiveMassKg]
     */
    getFragmentSource(params) {
        // When timeWindow is 0 (default), exclude the O(n²) nested loop entirely.
        // WebGL compilers compile ALL branches — even unused ones cause shader
        // compilation failure on GPUs that can't handle 512×512 iteration loops.
        var useTimeWindow = params && params.timeWindow > 0;

        var header = `
            precision highp float;

            uniform sampler2D uHoleData;
            uniform int uHoleCount;
            uniform float uHoleDataWidth;
            uniform float uK;
            uniform float uB;
            uniform float uChargeExp;
            uniform float uCutoff;
            uniform float uTargetPPV;
            uniform float uDisplayTime;
            uniform float uTimeWindow;
            uniform float uTimeOffset;
            uniform float uPWaveVel;
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

            vec3 getChargeCentroid(int idx) {
                vec4 collar = getHoleData(idx, 0);
                vec4 toe = getHoleData(idx, 1);
                vec4 charging = getHoleData(idx, 3);
                vec3 collarPos = collar.xyz;
                vec3 toePos = toe.xyz;
                float holeLen = toe.w;
                float chargeTopDepth = charging.x;
                float chargeBaseDepth = charging.y;
                vec3 holeAxis = normalize(toePos - collarPos);
                float centroidDepth;
                if (chargeBaseDepth > 0.0 && chargeBaseDepth > chargeTopDepth) {
                    centroidDepth = (chargeTopDepth + chargeBaseDepth) * 0.5;
                } else {
                    centroidDepth = holeLen * 0.65;
                }
                return collarPos + holeAxis * centroidDepth;
            }
        `;

        var footer = `
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
                for (int i = 0; i < 512; i++) {
                    if (i >= uHoleCount) break;
                    vec4 posCharge_i = getHoleData(i, 0);
                    float charge_i = posCharge_i.w;
                    if (charge_i <= 0.0) continue;
                    vec4 props_i = getHoleData(i, 2);
                    float timing_i = props_i.y;
                    if (uDisplayTime >= 0.0) {
                        float arrTime_i = timing_i;
                        if (uPWaveVel > 0.0) {
                            vec3 cc_i = getChargeCentroid(i);
                            arrTime_i += (distance(vWorldPos, cc_i) / uPWaveVel) * 1000.0;
                        }
                        if (arrTime_i > uDisplayTime) continue;
                    }
                    float bin_i = (uTimeOffset > 0.0 && timing_i < uTimeOffset)
                        ? -1.0 : floor((timing_i - uTimeOffset) / uTimeWindow);
                    float mic = 0.0;
                    for (int j = 0; j < 512; j++) {
                        if (j >= uHoleCount) break;
                        vec4 pc_j = getHoleData(j, 0);
                        float q_j = pc_j.w;
                        if (q_j <= 0.0) continue;
                        vec4 pr_j = getHoleData(j, 2);
                        float t_j = pr_j.y;
                        if (uDisplayTime >= 0.0 && t_j > uDisplayTime) continue;
                        float bin_j = (uTimeOffset > 0.0 && t_j < uTimeOffset)
                            ? -1.0 : floor((t_j - uTimeOffset) / uTimeWindow);
                        if (abs(bin_j - bin_i) < 0.5) mic += q_j;
                    }
                    if (mic <= 0.0) continue;
                    vec3 chargeCenter = getChargeCentroid(i);
                    vec4 collar = getHoleData(i, 0);
                    vec4 toe = getHoleData(i, 1);
                    vec4 charging = getHoleData(i, 3);
                    vec3 collarPos = collar.xyz;
                    vec3 toePos = toe.xyz;
                    float holeLen = toe.w;
                    float ctd = charging.x;
                    float cbd = charging.y;
                    if (cbd <= 0.0 || cbd <= ctd) { ctd = holeLen * 0.3; cbd = holeLen; }
                    vec3 holeAxis = (holeLen > 0.001) ? normalize(toePos - collarPos) : vec3(0.0);
                    vec3 chargeTop = collarPos + holeAxis * ctd;
                    vec3 chargeBase = collarPos + holeAxis * cbd;
                    float sd, ppv;
                    sd = max(distance(vWorldPos, chargeTop), uCutoff) / pow(mic, uChargeExp);
                    ppv = uK * pow(sd, -uB); peakPPV = max(peakPPV, ppv);
                    sd = max(distance(vWorldPos, chargeCenter), uCutoff) / pow(mic, uChargeExp);
                    ppv = uK * pow(sd, -uB); peakPPV = max(peakPPV, ppv);
                    sd = max(distance(vWorldPos, chargeBase), uCutoff) / pow(mic, uChargeExp);
                    ppv = uK * pow(sd, -uB); peakPPV = max(peakPPV, ppv);
                }
            ` + footer;
        } else {
            // Per-hole peak mode: O(n) single loop — fast, compiles on all GPUs
            return header + `
            void main() {
                float peakPPV = 0.0;
                for (int i = 0; i < 512; i++) {
                    if (i >= uHoleCount) break;
                    vec4 posCharge = getHoleData(i, 0);
                    float charge = posCharge.w;
                    if (charge <= 0.0) continue;
                    vec3 chargeCenter = getChargeCentroid(i);
                    float dist = max(distance(vWorldPos, chargeCenter), uCutoff);
                    if (uDisplayTime >= 0.0) {
                        vec4 props = getHoleData(i, 2);
                        float timing_ms = props.y;
                        float arrivalTime = timing_ms;
                        if (uPWaveVel > 0.0) arrivalTime += (dist / uPWaveVel) * 1000.0;
                        if (arrivalTime > uDisplayTime) continue;
                    }
                    float sd = dist / pow(charge, uChargeExp);
                    float ppv = uK * pow(sd, -uB);
                    peakPPV = max(peakPPV, ppv);
                }
            ` + footer;
        }
    }

    /**
     * Return model-specific uniform definitions.
     */
    getUniforms(params) {
        var p = Object.assign(this.getDefaultParams(), params || {});
        return {
            uK: { value: p.K },
            uB: { value: p.B },
            uChargeExp: { value: p.chargeExponent },
            uCutoff: { value: p.cutoffDistance },
            uPWaveVel: { value: p.pWaveVelocity || 0.0 },
            uTargetPPV: { value: p.targetPPV || 0.0 },
            uDisplayTime: { value: p.displayTime !== undefined ? p.displayTime : -1.0 },
            uTimeWindow: { value: p.timeWindow || 0.0 },
            uTimeOffset: { value: p.timeOffset !== undefined ? p.timeOffset : -1.0 }
        };
    }
}
