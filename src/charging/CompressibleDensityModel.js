/**
 * @fileoverview Compressible Density Model for Gassed Emulsion Explosives
 *
 * Implements hydrostatic compression of gas bubbles using Boyle's Law.
 * Gassed emulsions (e.g., Orica Fortis, Dyno Nobel Titan) achieve target density
 * by chemically generating N2 gas bubbles. Under hydrostatic pressure from the
 * column above, these bubbles compress at depth, creating a density gradient.
 *
 * Reference: "Compression of Gasses in Volume.xlsx" spreadsheet model.
 *
 * Core formula (Boyle's Law applied to void fraction):
 *   rho(h) = 1 / (1/limitingDensity + (1/capDensity - 1/limitingDensity) / P(h))
 *
 * Where P(h) is hydrostatic pressure at depth h in ATM units.
 */

var ATM_PA = 101325;    // 1 ATM in Pascals
var G = 9.80665;        // gravitational acceleration m/s^2

/**
 * Create a compressible density model for a single deck.
 *
 * @param {Object} params
 * @param {number} params.limitingDensity   - Matrix density without gas (g/cc), e.g. 1.34
 * @param {number} params.capDensity        - Density at top of column at 1 ATM (g/cc), e.g. 1.15
 * @param {number} params.criticalDensity   - Dead-pressing threshold (g/cc), e.g. 1.29
 * @param {number} [params.waterHeadM=0]    - Water column above explosive (metres)
 * @param {number} [params.holeDiameterMm=115] - Hole diameter in millimetres
 * @param {number} [params.interval=0.1]    - Step size for iterative calculation (metres)
 * @param {boolean} [params.selfConsistent=false] - Use iterative pressure model (more accurate for deep holes)
 * @returns {Object} Model with calculation methods
 */
export function createCompressibleModel(params) {
	var limitingDensity = params.limitingDensity;
	var capDensity = params.capDensity;
	var criticalDensity = params.criticalDensity || null;
	var waterHeadM = params.waterHeadM || 0;
	var holeDiameterMm = params.holeDiameterMm || 115;
	var interval = params.interval || 0.1;
	var selfConsistent = params.selfConsistent || false;

	// Additional ATM from water head
	var waterHeadATM = (1000 * G * waterHeadM) / ATM_PA;

	// Void fraction at surface (1 ATM)
	var phi0 = 1 - (capDensity / limitingDensity);

	/**
	 * Pressure at depth h using simplified model (cap density for column weight).
	 * P(h) = waterHeadATM + 1 + (capDensity * g * h * 1000) / ATM_PA
	 * @param {number} h - Depth from top of column in metres
	 * @returns {number} Pressure in ATM
	 */
	function pressureSimplified(h) {
		return waterHeadATM + 1 + (capDensity * 1000 * G * h) / ATM_PA;
	}

	/**
	 * Density at a given pressure using Boyle's Law on gas voids.
	 * rho = 1 / (1/limitingDensity + (1/capDensity - 1/limitingDensity) / P)
	 * @param {number} pressureATM - Pressure in ATM
	 * @returns {number} Density in g/cc
	 */
	function densityAtPressure(pressureATM) {
		var specificVolGas = (1 / capDensity) - (1 / limitingDensity);
		return 1 / ((1 / limitingDensity) + specificVolGas / pressureATM);
	}

	/**
	 * Density at depth h from top of explosive column.
	 * Uses simplified model (cap density for pressure calc) unless selfConsistent.
	 * @param {number} h - Depth from top of column in metres
	 * @returns {number} Density in g/cc
	 */
	function densityAtDepth(h) {
		if (h <= 0) return capDensity;
		if (!selfConsistent) {
			return densityAtPressure(pressureSimplified(h));
		}
		// Self-consistent: integrate pressure using local density
		return densityProfileIterative(h, interval).density;
	}

	/**
	 * Iterative self-consistent calculation to a target depth.
	 * Uses local density for pressure increments.
	 * @param {number} targetDepth - Depth from top of column (m)
	 * @param {number} step - Step size (m)
	 * @returns {{ density: number, pressure: number, avgDensity: number }}
	 */
	function densityProfileIterative(targetDepth, step) {
		var pressurePa = ATM_PA + 1000 * G * waterHeadM;  // initial pressure
		var totalDensitySum = capDensity;
		var numSteps = 1;
		var rho = capDensity;

		var h = 0;
		while (h < targetDepth) {
			var dh = Math.min(step, targetDepth - h);
			// Use current density for pressure increment
			var rhoPa = rho * 1000; // g/cc to kg/m^3
			pressurePa += rhoPa * G * dh;
			var pressureATM = pressurePa / ATM_PA;
			rho = densityAtPressure(pressureATM);
			h += dh;
			totalDensitySum += rho;
			numSteps++;
		}

		return {
			density: rho,
			pressure: pressurePa / ATM_PA,
			avgDensity: totalDensitySum / numSteps
		};
	}

	/**
	 * Generate a full density profile over the column length.
	 * @param {number} columnLength - Length of explosive column (m)
	 * @param {number} [profileInterval] - Step size (m), defaults to model interval
	 * @returns {Array<Object>} Array of profile points
	 */
	function densityProfile(columnLength, profileInterval) {
		var step = profileInterval || interval;
		var profile = [];
		var radiusM = (holeDiameterMm / 1000) / 2;
		var area = Math.PI * radiusM * radiusM;

		if (selfConsistent) {
			// Iterative self-consistent model
			var pressurePa = ATM_PA + 1000 * G * waterHeadM;
			var rho = capDensity;
			var densitySum = capDensity;
			var stepCount = 1;
			var cumulativeMass = 0;

			profile.push({
				depth: 0,
				density: capDensity,
				pressureATM: pressurePa / ATM_PA,
				avgDensity: capDensity,
				cumulativeMassKg: 0,
				isCritical: criticalDensity ? capDensity >= criticalDensity : false
			});

			var h = 0;
			while (h < columnLength - 0.0001) {
				var dh = Math.min(step, columnLength - h);
				var rhoPa = rho * 1000;
				pressurePa += rhoPa * G * dh;
				rho = densityAtPressure(pressurePa / ATM_PA);
				h += dh;
				densitySum += rho;
				stepCount++;
				cumulativeMass += rho * 1000 * area * dh;

				profile.push({
					depth: Math.round(h * 1000) / 1000,
					density: Math.round(rho * 1000) / 1000,
					pressureATM: Math.round((pressurePa / ATM_PA) * 100) / 100,
					avgDensity: Math.round((densitySum / stepCount) * 1000) / 1000,
					cumulativeMassKg: Math.round(cumulativeMass * 100) / 100,
					isCritical: criticalDensity ? rho >= criticalDensity : false
				});
			}
		} else {
			// Simplified model (cap density for pressure)
			var densitySumS = 0;
			var cumulativeMassS = 0;
			var numPoints = Math.ceil(columnLength / step) + 1;

			for (var i = 0; i < numPoints; i++) {
				var depth = Math.min(i * step, columnLength);
				var pATM = pressureSimplified(depth);
				var d = densityAtPressure(pATM);
				densitySumS += d;
				if (i > 0) {
					var prevDepth = Math.min((i - 1) * step, columnLength);
					var segLen = depth - prevDepth;
					cumulativeMassS += d * 1000 * area * segLen;
				}

				profile.push({
					depth: Math.round(depth * 1000) / 1000,
					density: Math.round(d * 100) / 100,
					pressureATM: Math.round(pATM * 100) / 100,
					avgDensity: Math.round((densitySumS / (i + 1)) * 100) / 100,
					cumulativeMassKg: Math.round(cumulativeMassS * 100) / 100,
					isCritical: criticalDensity ? d >= criticalDensity : false
				});

				if (depth >= columnLength) break;
			}
		}

		return profile;
	}

	/**
	 * Average density over column length (for mass calculation).
	 * @param {number} columnLength - Length of explosive column (m)
	 * @returns {number} Average density in g/cc
	 */
	function averageDensity(columnLength) {
		if (columnLength <= 0) return capDensity;
		var prof = densityProfile(columnLength, interval);
		if (prof.length === 0) return capDensity;
		return prof[prof.length - 1].avgDensity;
	}

	/**
	 * Total mass of explosive in the column.
	 * @param {number} columnLength - Length of explosive column (m)
	 * @returns {number} Mass in kg
	 */
	function totalMass(columnLength) {
		if (columnLength <= 0) return 0;
		var prof = densityProfile(columnLength, interval);
		if (prof.length === 0) return 0;
		return prof[prof.length - 1].cumulativeMassKg;
	}

	/**
	 * Depth at which critical density is first exceeded, or null if never.
	 * @param {number} columnLength - Length of explosive column (m)
	 * @returns {number|null} Depth in metres, or null
	 */
	function criticalDepth(columnLength) {
		if (!criticalDensity) return null;
		if (capDensity >= criticalDensity) return 0;

		var prof = densityProfile(columnLength, interval);
		for (var i = 0; i < prof.length; i++) {
			if (prof[i].isCritical) return prof[i].depth;
		}
		return null;
	}

	/**
	 * Get the density at a specific depth within the column, as a ratio
	 * between capDensity and limitingDensity (0 = cap, 1 = limiting).
	 * Useful for gradient rendering.
	 * @param {number} h - Depth from top of column (m)
	 * @returns {number} Ratio 0..1
	 */
	function compressionRatio(h) {
		var rho = densityAtDepth(h);
		if (limitingDensity === capDensity) return 0;
		return Math.min(1, Math.max(0, (rho - capDensity) / (limitingDensity - capDensity)));
	}

	/**
	 * Get the critical ratio: how close critical density is to limiting density.
	 * Returns null if no critical density set.
	 * @returns {number|null} Ratio 0..1 where criticalDensity sits between cap and limiting
	 */
	function criticalRatio() {
		if (!criticalDensity) return null;
		if (limitingDensity === capDensity) return null;
		return Math.min(1, Math.max(0, (criticalDensity - capDensity) / (limitingDensity - capDensity)));
	}

	return {
		// Parameters (read-only)
		limitingDensity: limitingDensity,
		capDensity: capDensity,
		criticalDensity: criticalDensity,
		waterHeadM: waterHeadM,
		holeDiameterMm: holeDiameterMm,

		// Calculation methods
		pressureAtDepth: pressureSimplified,
		densityAtDepth: densityAtDepth,
		densityAtPressure: densityAtPressure,
		densityProfile: densityProfile,
		averageDensity: averageDensity,
		totalMass: totalMass,
		criticalDepth: criticalDepth,
		compressionRatio: compressionRatio,
		criticalRatio: criticalRatio
	};
}
