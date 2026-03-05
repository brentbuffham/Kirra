/**
 * @fileoverview Deck Class - A section of a blast hole between two depths
 */

import { DECK_TYPES, DECK_SCALING_MODES, VALIDATION_MESSAGES } from "./ChargingConstants.js";
import { DecoupledContent } from "./DecoupledContent.js";
import { createCompressibleModel } from "./CompressibleDensityModel.js";

export function generateUUID() {
	if (crypto && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
		var r = Math.random() * 16 | 0;
		var v = c === "x" ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

export class Deck {
	constructor(options) {
		this.deckID = options.deckID || generateUUID();
		this.holeID = options.holeID;
		this.deckType = options.deckType || DECK_TYPES.INERT;
		this.topDepth = options.topDepth;       // lengthFromCollar
		this.baseDepth = options.baseDepth;     // lengthFromCollar
		this.product = options.product || null;  // { productID, name, density, ... }
		this.contains = options.contains || null; // DecoupledContent[] or spacer item details

		// For compressible COUPLED decks (gassed emulsions)
		this.isCompressible = options.isCompressible || false;
		this.averageDensity = options.averageDensity || null;
		this.capDensity = options.capDensity || null;
		this.maxCompressibleDensity = options.maxCompressibleDensity || null;
		this.limitingDensity = options.limitingDensity || null;   // Matrix density (g/cc)
		this.criticalDensity = options.criticalDensity || null;   // Dead-pressing threshold (g/cc)
		this.waterHeadM = options.waterHeadM || 0;               // Water above explosive (m)

		// Scaling flags — control how this deck behaves when hole length changes
		this.isFixedLength = options.isFixedLength || false;
		this.isFixedMass = options.isFixedMass || false;
		this.isVariable = options.isVariable || false;
		this.isProportionalDeck = (options.isProportionalDeck !== undefined)
			? options.isProportionalDeck
			: (!options.isFixedLength && !options.isFixedMass && !options.isVariable);

		// Decoupled overlap pattern — packages per position for variable stacking
		// e.g. { base: 3, "base-1": 2, n: 1, top: 2 }
		this.overlapPattern = options.overlapPattern || null;

		// Formula strings for deferred evaluation (stored alongside numeric values)
		// When present, these are shown in the Edit Deck dialog instead of numeric topDepth/baseDepth
		this.topDepthFormula = options.topDepthFormula || null;    // e.g. "fx:stemLength"
		this.baseDepthFormula = options.baseDepthFormula || null;  // e.g. "fx:holeLength"
		this.lengthFormula = options.lengthFormula || null;        // e.g. "fx:holeLength-4"

		// Per-deck swap rules string: "w{WR-ANFO}|r{Emulsion}|t{Emulsion,C>50}"
		this.swap = options.swap || null;
		// Original product name if swapped by condition evaluation
		this.swappedFrom = options.swappedFrom || null;

		this.created = options.created || new Date().toISOString();
		this.modified = new Date().toISOString();
	}

	get length() {
		return Math.abs(this.baseDepth - this.topDepth);
	}

	get scalingMode() {
		if (this.isFixedLength) return DECK_SCALING_MODES.FIXED_LENGTH;
		if (this.isFixedMass) return DECK_SCALING_MODES.FIXED_MASS;
		if (this.isVariable) return DECK_SCALING_MODES.VARIABLE;
		return DECK_SCALING_MODES.PROPORTIONAL;
	}

	get effectiveDensity() {
		if (this.isCompressible) {
			// Use compressible model average if we have the parameters
			var model = this.getCompressibleModel();
			if (model) return model.averageDensity(this.length);
			if (this.averageDensity) return this.averageDensity;
		}
		return this.product ? (this.product.density || 0) : 0;
	}

	/**
	 * Build a CompressibleDensityModel for this deck if compressible parameters are available.
	 * Reads limitingDensity/criticalDensity from deck overrides or from product defaults.
	 * @param {number} [diameterMm] - Optional override for hole diameter
	 * @returns {Object|null} Model object or null if insufficient parameters
	 */
	getCompressibleModel(diameterMm) {
		if (!this.isCompressible) return null;
		var cap = this.capDensity || (this.product ? this.product.density : null);
		var limiting = this.limitingDensity || (this.product ? this.product.limitingDensity : null);
		if (!cap || !limiting) return null;
		var critical = this.criticalDensity || (this.product ? this.product.criticalDensity : null);
		return createCompressibleModel({
			limitingDensity: limiting,
			capDensity: cap,
			criticalDensity: critical,
			waterHeadM: this.waterHeadM || 0,
			holeDiameterMm: diameterMm || 115
		});
	}

	/** Number of whole packages that fit in this deck (simple stacking) */
	get packageCount() {
		if (this.deckType !== DECK_TYPES.DECOUPLED) return 0;
		if (!this.product || !this.product.lengthMm) return 0;
		var packageLenM = this.product.lengthMm / 1000;
		if (packageLenM <= 0) return 0;
		return Math.floor(this.length / packageLenM);
	}

	/**
	 * Total package count accounting for overlap pattern stacking.
	 * When overlapPattern is set, each position may have multiple packages stacked.
	 * @returns {number} Total packages including overlaps
	 */
	get totalPackageCount() {
		if (this.deckType !== DECK_TYPES.DECOUPLED) return 0;
		if (!this.product || !this.product.lengthMm) return 0;
		var packageLenM = this.product.lengthMm / 1000;
		if (packageLenM <= 0) return 0;
		var positions = Math.floor(this.length / packageLenM);
		if (positions <= 0) return 0;
		if (!this.overlapPattern) return positions;

		var total = 0;
		for (var i = 0; i < positions; i++) {
			total += this.packagesAtPosition(i, positions);
		}
		return total;
	}

	/**
	 * Get the number of packages stacked at a given position index.
	 * Reads overlapPattern keys: "base" (bottom), "base-1" (one above base),
	 * "top" (topmost), "n" (default for middle positions).
	 * @param {number} posIndex - 0-based from top of deck
	 * @param {number} totalPositions - Total positions in deck
	 * @returns {number} Package count at this position
	 */
	packagesAtPosition(posIndex, totalPositions) {
		if (!this.overlapPattern) return 1;
		var op = this.overlapPattern;
		var fromBase = totalPositions - 1 - posIndex;

		if (fromBase === 0 && op.base != null) return op.base;
		if (fromBase === 1 && op["base-1"] != null) return op["base-1"];
		if (posIndex === 0 && op.top != null) return op.top;
		if (op.n != null) return op.n;
		return 1;
	}

	/**
	 * Calculate volume in cubic meters.
	 * DECOUPLED decks use product diameter (smaller than hole bore).
	 * @param {number} holeDiameterMm - Hole diameter in millimeters
	 */
	calculateVolume(holeDiameterMm) {
		if (this.deckType === DECK_TYPES.DECOUPLED && this.product && this.product.diameterMm) {
			var rM = (this.product.diameterMm / 1000) / 2;
			var count = this.packageCount;
			if (count > 0) {
				return count * Math.PI * rM * rM * (this.product.lengthMm / 1000);
			}
			return Math.PI * rM * rM * this.length;
		}
		var radiusM = (holeDiameterMm / 1000) / 2;
		return Math.PI * radiusM * radiusM * this.length;
	}

	/**
	 * Calculate mass in kilograms.
	 * DECOUPLED decks use discrete package counting with product dimensions.
	 * Mass = PI * r² * packageLength * density × packageCount
	 * Always calculated from geometry (diameter × length × density) for consistency.
	 * COUPLED/INERT/SPACER decks use hole diameter (original behaviour).
	 * @param {number} holeDiameterMm - Hole diameter in millimeters
	 */
	calculateMass(holeDiameterMm) {
		if (this.deckType === DECK_TYPES.DECOUPLED && this.product) {
			var count = this.overlapPattern ? this.totalPackageCount : this.packageCount;
			// Discrete packages: count × single-package mass from geometry
			if (count > 0 && this.product.diameterMm && this.effectiveDensity > 0) {
				var pkgLenM = this.product.lengthMm / 1000;
				var rM = (this.product.diameterMm / 1000) / 2;
				var unitMassKg = Math.PI * rM * rM * pkgLenM * this.effectiveDensity * 1000;
				return count * unitMassKg;
			}
			// No package length — continuous fill with product diameter
			if (this.product.diameterMm && this.effectiveDensity > 0) {
				var rM2 = (this.product.diameterMm / 1000) / 2;
				return Math.PI * rM2 * rM2 * this.length * this.effectiveDensity * 1000;
			}
		}
		// COUPLED / INERT / SPACER — use hole diameter (original behaviour)
		// For compressible COUPLED decks, use integrated mass from density model
		if (this.isCompressible && this.deckType === DECK_TYPES.COUPLED) {
			var model = this.getCompressibleModel(holeDiameterMm);
			if (model) return model.totalMass(this.length);
		}
		return this.calculateVolume(holeDiameterMm) * this.effectiveDensity * 1000;
	}

	containsDepth(depth) {
		var min = Math.min(this.topDepth, this.baseDepth);
		var max = Math.max(this.topDepth, this.baseDepth);
		return depth >= min && depth <= max;
	}

	validate() {
		var errors = [], warnings = [];
		if (this.topDepth === this.baseDepth) errors.push(VALIDATION_MESSAGES.ZERO_DECK_LENGTH);
		if (!this.product) warnings.push(VALIDATION_MESSAGES.NO_PRODUCT_ASSIGNED);
		if (this.deckType === DECK_TYPES.DECOUPLED && (!this.contains || this.contains.length === 0)) {
			warnings.push("Decoupled deck has no contents");
		}
		if (this.deckType === DECK_TYPES.SPACER && !this.contains) {
			warnings.push("Spacer deck has no item details");
		}
		return { valid: errors.length === 0, errors: errors, warnings: warnings };
	}

	toJSON() {
		return {
			deckID: this.deckID,
			holeID: this.holeID,
			deckType: this.deckType,
			topDepth: this.topDepth,
			baseDepth: this.baseDepth,
			product: this.product,
			contains: this.contains ? this.contains.map(function(c) { return c.toJSON ? c.toJSON() : c; }) : null,
			isCompressible: this.isCompressible,
			averageDensity: this.averageDensity,
			capDensity: this.capDensity,
			maxCompressibleDensity: this.maxCompressibleDensity,
			limitingDensity: this.limitingDensity,
			criticalDensity: this.criticalDensity,
			waterHeadM: this.waterHeadM,
			isFixedLength: this.isFixedLength,
			isFixedMass: this.isFixedMass,
			isVariable: this.isVariable,
			isProportionalDeck: this.isProportionalDeck,
			overlapPattern: this.overlapPattern,
			topDepthFormula: this.topDepthFormula,
			baseDepthFormula: this.baseDepthFormula,
			lengthFormula: this.lengthFormula,
			swap: this.swap,
			swappedFrom: this.swappedFrom,
			created: this.created,
			modified: this.modified
		};
	}

	static fromJSON(obj) {
		var deck = new Deck(obj);
		if (obj.contains && Array.isArray(obj.contains)) {
			deck.contains = obj.contains.map(function(c) {
				return c instanceof DecoupledContent ? c : DecoupledContent.fromJSON(c);
			});
		}
		return deck;
	}
}
