// src/shaders/core/ShaderUniformManager.js
import * as THREE from "three";
import { chargingKey } from "../../charging/HoleCharging.js";

/**
 * ShaderUniformManager packs blast hole data into DataTextures for GPU consumption.
 *
 * Layout: Each hole occupies 4 pixels (16 floats total) in a 512x4 RGBA float texture.
 *
 * Pixel 0 (Row 0): [collarX, collarY, collarZ, totalChargeKg]
 * Pixel 1 (Row 1): [toeX, toeY, toeZ, holeLength_m]
 * Pixel 2 (Row 2): [MIC_kg, detonation_time_ms, holeDiam_mm, unused]
 * Pixel 3 (Row 3): [chargeTopDepth_m, chargeBaseDepth_m, vodMs, totalExplosiveMassKg]
 *
 * Row 3 is populated from actual charging data (window.loadedCharging) when available.
 * chargeTopDepth = depth from collar to top of first explosive deck (stemming length)
 * chargeBaseDepth = depth from collar to bottom of deepest explosive deck
 * vodMs = mass-weighted average VOD across all explosive decks
 * totalExplosiveMassKg = sum of all explosive deck masses
 *
 * This enables reactive updates — when a hole moves or charge changes, only the
 * relevant texels are updated, avoiding full repack.
 */
export class ShaderUniformManager {
    /**
     * @param {number} maxHoles - Maximum number of holes to support (default 512)
     */
    constructor(maxHoles) {
        this.maxHoles = maxHoles || 512;

        // DataTexture layout: each hole occupies 4 pixels (16 floats)
        // Pixel 0: [collarX, collarY, collarZ, totalChargeKg]
        // Pixel 1: [toeX, toeY, toeZ, holeLength_m]
        // Pixel 2: [MIC_kg, timing_ms, holeDiam_mm, unused]
        // Pixel 3: [chargeTopDepth_m, chargeBaseDepth_m, vodMs, totalExplosiveMassKg]
        this.textureWidth = this.maxHoles;
        this.textureHeight = 4;
        this.data = new Float32Array(this.textureWidth * this.textureHeight * 4);
        this.texture = null;
        this.holeCount = 0;
    }

    /**
     * Build or rebuild the data texture from an array of blast holes.
     *
     * @param {Array} holes - allBlastHoles array from Kirra
     * @param {Object} options - { useToeLocation: bool }
     * @returns {THREE.DataTexture}
     */
    packHoles(holes, options) {
        this.holeCount = Math.min(holes.length, this.maxHoles);
        this.data.fill(0);

        for (var i = 0; i < this.holeCount; i++) {
            var h = holes[i];
            var chargingDetails = this._getChargingDetails(h);
            var baseIdx = i * 4; // pixel 0 of this hole (row 0)

            // Row 0: collar position + total charge
            this.data[baseIdx + 0] = h.startXLocation || 0;
            this.data[baseIdx + 1] = h.startYLocation || 0;
            this.data[baseIdx + 2] = h.startZLocation || 0;
            this.data[baseIdx + 3] = chargingDetails.totalMassKg;

            // Row 1: toe position + hole length
            var row1Idx = (this.textureWidth * 4) + (i * 4);
            this.data[row1Idx + 0] = h.endXLocation || h.startXLocation || 0;
            this.data[row1Idx + 1] = h.endYLocation || h.startYLocation || 0;
            this.data[row1Idx + 2] = h.endZLocation || h.startZLocation || 0;
            this.data[row1Idx + 3] = parseFloat(h.holeLengthCalculated) || 0;

            // Row 2: MIC, timing, diameter, unused
            var row2Idx = (this.textureWidth * 2 * 4) + (i * 4);
            this.data[row2Idx + 0] = this._getMIC(h);       // Max Instantaneous Charge
            this.data[row2Idx + 1] = this._getDetonationTime(h);  // firing time ms (includes downhole delay)
            this.data[row2Idx + 2] = parseFloat(h.holeDiameter) || 115;
            this.data[row2Idx + 3] = 0; // unused

            // Row 3: charge column details from actual charging data
            var row3Idx = (this.textureWidth * 3 * 4) + (i * 4);
            this.data[row3Idx + 0] = chargingDetails.chargeTopDepth;   // m from collar
            this.data[row3Idx + 1] = chargingDetails.chargeBaseDepth;  // m from collar
            this.data[row3Idx + 2] = chargingDetails.vodMs;            // m/s
            this.data[row3Idx + 3] = chargingDetails.totalMassKg;      // kg (duplicate for convenience)
        }

        if (!this.texture) {
            this.texture = new THREE.DataTexture(
                this.data,
                this.textureWidth,
                this.textureHeight,
                THREE.RGBAFormat,
                THREE.FloatType
            );
            this.texture.minFilter = THREE.NearestFilter;
            this.texture.magFilter = THREE.NearestFilter;
            this.texture.needsUpdate = true;
        } else {
            this.texture.image.data.set(this.data);
            this.texture.needsUpdate = true;
        }

        return this.texture;
    }

    /**
     * Update a single hole (for drag operations — avoids full repack).
     *
     * @param {number} index - Hole index in array
     * @param {Object} hole - Updated hole object
     * @param {Object} options - { useToeLocation: bool }
     */
    updateHole(index, hole, options) {
        if (index >= this.holeCount) return;
        var useToe = options && options.useToeLocation;
        var chargingDetails = this._getChargingDetails(hole);
        var baseIdx = index * 4;

        this.data[baseIdx + 0] = useToe ? (hole.endXLocation || hole.startXLocation) : hole.startXLocation;
        this.data[baseIdx + 1] = useToe ? (hole.endYLocation || hole.startYLocation) : hole.startYLocation;
        this.data[baseIdx + 2] = useToe ? (hole.endZLocation || hole.startZLocation) : hole.startZLocation;
        this.data[baseIdx + 3] = chargingDetails.totalMassKg;

        // Update row 1 (toe + length)
        var row1Idx = (this.textureWidth * 4) + (index * 4);
        this.data[row1Idx + 0] = hole.endXLocation || hole.startXLocation || 0;
        this.data[row1Idx + 1] = hole.endYLocation || hole.startYLocation || 0;
        this.data[row1Idx + 2] = hole.endZLocation || hole.startZLocation || 0;
        this.data[row1Idx + 3] = parseFloat(hole.holeLengthCalculated) || 0;

        // Update row 2 (MIC, timing)
        var row2Idx = (this.textureWidth * 2 * 4) + (index * 4);
        this.data[row2Idx + 0] = this._getMIC(hole);
        this.data[row2Idx + 1] = this._getDetonationTime(hole);

        // Update row 3 (charging details)
        var row3Idx = (this.textureWidth * 3 * 4) + (index * 4);
        this.data[row3Idx + 0] = chargingDetails.chargeTopDepth;
        this.data[row3Idx + 1] = chargingDetails.chargeBaseDepth;
        this.data[row3Idx + 2] = chargingDetails.vodMs;
        this.data[row3Idx + 3] = chargingDetails.totalMassKg;

        this.texture.needsUpdate = true;
    }

    /**
     * Extract charging details from a hole's assigned charging data.
     * Returns charge column bounds, weighted average VOD, and total explosive mass.
     *
     * When no charging data exists, falls back to:
     *   - totalMassKg = hole.measuredMass
     *   - chargeTopDepth/chargeBaseDepth = 0 (signals shader to use 70% estimate)
     *   - vodMs = 0 (signals shader to use uniform default)
     *
     * @param {Object} hole - Blast hole object
     * @returns {{ chargeTopDepth: number, chargeBaseDepth: number, vodMs: number, totalMassKg: number }}
     * @private
     */
    _getChargingDetails(hole) {
        var result = {
            chargeTopDepth: 0,
            chargeBaseDepth: 0,
            vodMs: 0,
            totalMassKg: parseFloat(hole.measuredMass) || 0
        };

        if (!window.loadedCharging || !window.loadedCharging.has(chargingKey(hole))) {
            return result;
        }

        var charging = window.loadedCharging.get(chargingKey(hole));
        if (!charging || !charging.decks || charging.decks.length === 0) {
            return result;
        }

        var holeDiamMm = parseFloat(hole.holeDiameter) || 115;
        var firstChargeTop = null;
        var deepestChargeBase = 0;
        var totalMass = 0;
        var vodMassSum = 0;   // sum of (deckMass * deckVOD) for weighted average

        for (var i = 0; i < charging.decks.length; i++) {
            var deck = charging.decks[i];
            if (deck.deckType !== "COUPLED" && deck.deckType !== "DECOUPLED") continue;

            var deckMass = parseFloat(deck.calculateMass(holeDiamMm)) || 0;
            if (deckMass <= 0) continue;

            totalMass += deckMass;

            // Track charge column extent
            var deckTop = Math.min(deck.topDepth, deck.baseDepth);
            var deckBase = Math.max(deck.topDepth, deck.baseDepth);

            if (firstChargeTop === null || deckTop < firstChargeTop) {
                firstChargeTop = deckTop;
            }
            if (deckBase > deepestChargeBase) {
                deepestChargeBase = deckBase;
            }

            // VOD from product snapshot (added by snap() in SimpleRuleEngine)
            // or from the full product in window.loadedProducts
            var deckVOD = 0;
            if (deck.product && deck.product.vodMs) {
                deckVOD = parseFloat(deck.product.vodMs) || 0;
            } else if (deck.product && deck.product.productID && window.loadedProducts) {
                // Fallback: look up full product for VOD
                var fullProduct = window.loadedProducts.get(deck.product.productID);
                if (fullProduct && fullProduct.vodMs) {
                    deckVOD = parseFloat(fullProduct.vodMs) || 0;
                }
            }
            vodMassSum += deckMass * deckVOD;
        }

        // Also add booster mass from primers
        if (charging.primers) {
            for (var k = 0; k < charging.primers.length; k++) {
                totalMass += (charging.primers[k].totalBoosterMassGrams || 0) / 1000;
            }
        }

        if (totalMass > 0) {
            result.totalMassKg = totalMass;
            result.chargeTopDepth = firstChargeTop !== null ? firstChargeTop : 0;
            result.chargeBaseDepth = deepestChargeBase;
            result.vodMs = vodMassSum > 0 ? vodMassSum / (totalMass) : 0;
        }

        return result;
    }

    /**
     * Calculate MIC (Maximum Instantaneous Charge) for a hole.
     * This is the largest single deck charge mass — used for PPV calculations.
     *
     * @param {Object} hole - Blast hole object
     * @returns {number} - MIC in kg
     * @private
     */
    _getMIC(hole) {
        // If charging data exists, find the largest explosive deck
        if (window.loadedCharging && window.loadedCharging.has(chargingKey(hole))) {
            var charging = window.loadedCharging.get(chargingKey(hole));
            if (charging && charging.decks) {
                var maxDeckMass = 0;
                charging.decks.forEach(function(deck) {
                    if (deck.deckType === "COUPLED" || deck.deckType === "DECOUPLED") {
                        var deckMass = parseFloat(deck.calculateMass(hole.holeDiameter)) || 0;
                        if (deckMass > maxDeckMass) maxDeckMass = deckMass;
                    }
                });
                if (maxDeckMass > 0) return maxDeckMass;
            }
        }
        // Fallback: total measured mass (single-deck assumption)
        return parseFloat(hole.measuredMass) || 0;
    }

    /**
     * Get the detonation time for a hole in milliseconds.
     *
     * When charging data with primers exists, uses the earliest deck's
     * total fire time (surfaceTime + downholeDelay). This is critical for
     * electronic detonators where surface wire delay is ~0 (speed of light)
     * and the actual detonation time is the programmed downhole delay.
     *
     * Falls back to surface holeTime when no charging/primer data exists.
     *
     * @param {Object} hole - Blast hole object
     * @returns {number} - Detonation time in milliseconds
     * @private
     */
    _getDetonationTime(hole) {
        var surfaceTime = this._parseHoleTime(hole.holeTime) || 0;

        if (!window.loadedCharging) return surfaceTime;

        var charging = window.loadedCharging.get(chargingKey(hole));
        if (!charging || !charging.decks || !charging.primers || charging.primers.length === 0) {
            return surfaceTime;
        }

        // Find earliest detonation time across all explosive decks
        var earliestTime = Infinity;
        for (var d = 0; d < charging.decks.length; d++) {
            var deck = charging.decks[d];
            if (deck.deckType !== "COUPLED" && deck.deckType !== "DECOUPLED") continue;

            var downholeDelay = 0;
            // Match primer to deck by deckID
            for (var p = 0; p < charging.primers.length; p++) {
                if (charging.primers[p].deckID === deck.deckID) {
                    downholeDelay = charging.primers[p].totalDownholeDelayMs || 0;
                    break;
                }
            }
            // Fallback: primer within deck depth bounds
            if (downholeDelay === 0) {
                for (var p2 = 0; p2 < charging.primers.length; p2++) {
                    if (deck.containsDepth && deck.containsDepth(charging.primers[p2].lengthFromCollar)) {
                        downholeDelay = charging.primers[p2].totalDownholeDelayMs || 0;
                        break;
                    }
                }
            }

            var deckFireTime = surfaceTime + downholeDelay;
            if (deckFireTime < earliestTime) {
                earliestTime = deckFireTime;
            }
        }

        return isFinite(earliestTime) ? earliestTime : surfaceTime;
    }

    /**
     * Parse hole.holeTime to milliseconds.
     * Format can be: "Delay: 500ms" or "0ms" or number
     *
     * @param {string|number} holeTime - Hole timing string or number
     * @returns {number} - Time in milliseconds
     * @private
     */
    _parseHoleTime(holeTime) {
        if (typeof holeTime === "number") return holeTime;
        if (typeof holeTime === "string") {
            var match = holeTime.match(/(\d+)/);
            if (match) return parseFloat(match[1]);
        }
        return 0;
    }

    /**
     * Dispose of resources.
     */
    dispose() {
        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }
        this.data = null;
    }
}
