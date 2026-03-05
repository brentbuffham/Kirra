/**
 * @fileoverview HoleCharging - Manages all charging data for a single hole
 * Includes interval-based fill operations for rule engine support
 */

import { Deck, generateUUID } from "./Deck.js";
import { Primer } from "./Primer.js";
import { DecoupledContent } from "./DecoupledContent.js";
import { DECK_TYPES, DEFAULT_DECK, VALIDATION_MESSAGES } from "./ChargingConstants.js";
import { evaluateFormula } from "../helpers/FormulaEvaluator.js";

/**
 * Build the composite key for loadedCharging map lookups.
 * Format: "entityName:::holeID"
 * @param {Object} hole - Object with entityName and holeID properties
 * @returns {string}
 */
export function chargingKey(hole) {
	return (hole.entityName || "") + ":::" + (hole.holeID || "");
}

/**
 * Build indexed charge variables from decks for primer formula context.
 * @param {Array} decks - Array of Deck objects
 * @param {Object} ctx - Formula context to populate
 */
function buildIndexedChargeVarsForPrimers(decks, ctx) {
	var deepestBase = 0;
	var deepestTop = 0;
	var deepestLen = 0;
	var firstChargeTop = null;

	for (var i = 0; i < decks.length; i++) {
		var d = decks[i];
		var dt = d.deckType;
		var deckPos = i + 1;

		// deckBase[N]/deckTop[N]/deckLength[N] — ALL deck types
		ctx["deckBase_" + deckPos] = d.baseDepth;
		ctx["deckTop_" + deckPos] = d.topDepth;
		ctx["deckLength_" + deckPos] = d.baseDepth - d.topDepth;

		// chargeBase[N]/chargeTop[N]/chargeLength[N] — charge decks only
		if (dt === DECK_TYPES.COUPLED || dt === DECK_TYPES.DECOUPLED) {
			var cTop = d.topDepth;
			var cBase = d.baseDepth;
			var cLen = cBase - cTop;

			ctx["chargeBase_" + deckPos] = cBase;
			ctx["chargeTop_" + deckPos] = cTop;
			ctx["chargeLength_" + deckPos] = cLen;

			if (cBase >= deepestBase) {
				deepestBase = cBase;
				deepestTop = cTop;
				deepestLen = cLen;
			}
			if (firstChargeTop === null) {
				firstChargeTop = cTop;
			}
		}
	}

	ctx.chargeBase = deepestBase;
	ctx.chargeTop = deepestTop;
	ctx.chargeLength = deepestLen;
	ctx.stemLength = firstChargeTop !== null ? firstChargeTop : 0;
}

export class HoleCharging {
	constructor(hole) {
		this.holeID = hole.holeID;
		this.entityName = hole.entityName || null;
		this.holeDiameterMm = hole.holeDiameter || 0;           // mm
		this.holeLength = hole.holeLengthCalculated || hole.measuredLength || 0;
		this.autoRecalculate = hole.autoRecalculate !== undefined ? hole.autoRecalculate : true;

		this.decks = [];
		this.primers = [];

		this.created = new Date().toISOString();
		this.modified = new Date().toISOString();

		if (this.holeDiameterMm > 0 && this.holeLength !== 0) {
			this.initializeDefaultDeck();
		}
	}

	initializeDefaultDeck() {
		if (this.decks.length === 0) {
			var top = this.holeLength < 0 ? this.holeLength : 0;
			var base = this.holeLength < 0 ? 0 : this.holeLength;
			this.decks.push(new Deck({
				holeID: this.holeID,
				deckType: DECK_TYPES.INERT,
				topDepth: top,
				baseDepth: base,
				product: { name: "Air", density: DEFAULT_DECK.density }
			}));
		}
	}

	sortDecks() {
		this.decks.sort(function(a, b) { return a.topDepth - b.topDepth; });
	}

	// ============ INTERVAL OPERATIONS ============

	/**
	 * Get unallocated intervals (gaps not yet assigned a non-Air product)
	 * Returns array of {top, base} intervals
	 */
	getUnallocated() {
		var unallocated = [];
		for (var i = 0; i < this.decks.length; i++) {
			var deck = this.decks[i];
			if (deck.deckType === DECK_TYPES.INERT && deck.product && deck.product.name === "Air") {
				unallocated.push({ top: deck.topDepth, base: deck.baseDepth, length: deck.length });
			}
		}
		return unallocated;
	}

	/**
	 * Fill an interval with a product, creating the appropriate deck type
	 * Automatically splits existing decks that overlap the interval
	 */
	fillInterval(topDepth, baseDepth, deckType, product, options) {
		var newDeck = new Deck({
			holeID: this.holeID,
			deckType: deckType,
			topDepth: topDepth,
			baseDepth: baseDepth,
			product: product,
			isCompressible: options ? options.isCompressible : false,
			averageDensity: options ? options.averageDensity : null,
			capDensity: options ? options.capDensity : null,
			maxCompressibleDensity: options ? options.maxCompressibleDensity : null,
			limitingDensity: options ? options.limitingDensity : null,
			criticalDensity: options ? options.criticalDensity : null,
			waterHeadM: options ? options.waterHeadM : 0
		});
		return this.insertDeck(newDeck);
	}

	/**
	 * Fill interval to a target mass in kg
	 * Calculates required length based on product density and hole diameter
	 */
	fillToMass(startFromBase, deckType, product, massKg) {
		if (!product || !product.density || product.density === 0) return null;
		var radiusM = (this.holeDiameterMm / 1000) / 2;
		var volumeM3 = massKg / (product.density * 1000);
		var lengthM = volumeM3 / (Math.PI * radiusM * radiusM);

		// Fill from base upward
		var unalloc = this.getUnallocated();
		if (unalloc.length === 0) return null;

		var lastUnalloc = unalloc[unalloc.length - 1];
		var actualLength = Math.min(lengthM, lastUnalloc.length);
		var topDepth = lastUnalloc.base - actualLength;
		var baseDepth = lastUnalloc.base;

		return this.fillInterval(topDepth, baseDepth, deckType, product);
	}

	/**
	 * Insert a deck, splitting any existing decks that overlap
	 */
	insertDeck(newDeck) {
		newDeck.holeID = this.holeID;
		var toRemove = [];
		var toAdd = [newDeck];
		var newMin = Math.min(newDeck.topDepth, newDeck.baseDepth);
		var newMax = Math.max(newDeck.topDepth, newDeck.baseDepth);

		for (var i = 0; i < this.decks.length; i++) {
			var existing = this.decks[i];
			var exMin = Math.min(existing.topDepth, existing.baseDepth);
			var exMax = Math.max(existing.topDepth, existing.baseDepth);

			if (newMin < exMax && newMax > exMin) {
				toRemove.push(existing);

				// Top portion of split deck
				if (exMin < newMin) {
					toAdd.push(new Deck({
						holeID: this.holeID,
						deckType: existing.deckType,
						topDepth: exMin,
						baseDepth: newMin,
						product: existing.product ? Object.assign({}, existing.product) : null
					}));
				}
				// Bottom portion of split deck
				if (exMax > newMax) {
					toAdd.push(new Deck({
						holeID: this.holeID,
						deckType: existing.deckType,
						topDepth: newMax,
						baseDepth: exMax,
						product: existing.product ? Object.assign({}, existing.product) : null
					}));
				}
			}
		}

		this.decks = this.decks.filter(function(d) { return toRemove.indexOf(d) === -1; });
		for (var j = 0; j < toAdd.length; j++) {
			this.decks.push(toAdd[j]);
		}
		this.sortDecks();
		this.modified = new Date().toISOString();
		return { success: true };
	}

	// ============ PRIMERS ============

	addPrimer(primer) {
		primer.holeID = this.holeID;
		var val = primer.validate(this.decks);
		if (!val.valid) return val;

		primer.deckID = val.assignedDeck ? val.assignedDeck.deckID : null;
		this.primers.push(primer);
		this.modified = new Date().toISOString();
		return { success: true, errors: [], warnings: val.warnings, assignedDeck: val.assignedDeck };
	}

	// ============ EMBEDDED CONTENT ============

	/**
	 * Embed a DecoupledContent item inside an existing deck (e.g. a package inside an INERT deck).
	 * @param {string} deckID - The ID of the target deck
	 * @param {DecoupledContent} content - The content to embed
	 * @returns {{ success: boolean, errors?: string[] }}
	 */
	embedContent(deckID, content) {
		var deck = null;
		for (var i = 0; i < this.decks.length; i++) {
			if (this.decks[i].deckID === deckID) { deck = this.decks[i]; break; }
		}
		if (!deck) return { success: false, errors: ["Deck not found: " + deckID] };

		var deckMin = Math.min(deck.topDepth, deck.baseDepth);
		var deckMax = Math.max(deck.topDepth, deck.baseDepth);
		var contentTop = content.lengthFromCollar;
		var contentBase = contentTop + (content.length || 0);

		if (contentTop < deckMin - 0.001 || contentBase > deckMax + 0.001) {
			return { success: false, errors: ["Content does not fit within deck bounds"] };
		}

		if (!deck.contains) deck.contains = [];
		deck.contains.push(content);
		this.modified = new Date().toISOString();
		return { success: true };
	}

	/**
	 * Remove an embedded content item by contentID from any deck.
	 * @param {string} contentID
	 * @returns {boolean} true if found and removed
	 */
	removeContent(contentID) {
		for (var i = 0; i < this.decks.length; i++) {
			var deck = this.decks[i];
			if (!deck.contains) continue;
			for (var j = 0; j < deck.contains.length; j++) {
				if (deck.contains[j].contentID === contentID) {
					deck.contains.splice(j, 1);
					if (deck.contains.length === 0) deck.contains = null;
					this.modified = new Date().toISOString();
					return true;
				}
			}
		}
		return false;
	}

	// ============ QUERIES ============

	getDeckAtDepth(depth) {
		for (var i = 0; i < this.decks.length; i++) {
			if (this.decks[i].containsDepth(depth)) return this.decks[i];
		}
		return null;
	}

	getExplosiveDecks() {
		return this.decks.filter(function(d) {
			return d.deckType === DECK_TYPES.COUPLED || d.deckType === DECK_TYPES.DECOUPLED;
		});
	}

	getTotalExplosiveMass() {
		var total = 0;
		var self = this;
		for (var i = 0; i < this.decks.length; i++) {
			var deck = this.decks[i];
			if (deck.deckType === DECK_TYPES.COUPLED) {
				total += deck.calculateMass(self.holeDiameterMm);
			} else if (deck.deckType === DECK_TYPES.DECOUPLED) {
				var contentMass = 0;
				if (deck.contains && deck.contains.length > 0) {
					for (var j = 0; j < deck.contains.length; j++) {
						var c = deck.contains[j];
						if (c.contentCategory === "Physical") {
							var mass = c.calculateMass ? c.calculateMass() : 0;
							if (mass) contentMass += mass;
						}
					}
				}
				if (contentMass === 0) {
					contentMass = deck.calculateMass(self.holeDiameterMm);
				}
				total += contentMass;
			} else if (deck.deckType === DECK_TYPES.INERT && deck.contains && deck.contains.length > 0) {
				// Embedded physical items inside inert decks (e.g. packages in air/water)
				for (var ej = 0; ej < deck.contains.length; ej++) {
					var ec = deck.contains[ej];
					if (ec.contentCategory === "Physical") {
						var eMass = ec.calculateMass ? ec.calculateMass() : 0;
						if (eMass) total += eMass;
					}
				}
			}
		}
		for (var k = 0; k < this.primers.length; k++) {
			total += (this.primers[k].totalBoosterMassGrams || 0) / 1000;
		}
		return total;
	}

	calculatePowderFactor(burden, spacing) {
		var mass = this.getTotalExplosiveMass();
		var volume = burden * spacing * Math.abs(this.holeLength);
		return volume > 0 ? mass / volume : 0;
	}

	// ============ VALIDATION ============

	validate() {
		var errors = [], warnings = [];

		if (!this.holeDiameterMm || this.holeLength === 0) {
			warnings.push(VALIDATION_MESSAGES.NO_DIAMETER_OR_LENGTH);
		}
		if (this.decks.length === 0) {
			errors.push(VALIDATION_MESSAGES.NO_DECKS);
		}

		this.sortDecks();
		for (var i = 0; i < this.decks.length - 1; i++) {
			var gap = Math.abs(this.decks[i + 1].topDepth - this.decks[i].baseDepth);
			if (gap > 0.001) {
				warnings.push(VALIDATION_MESSAGES.DECK_GAP + " Gap: " + gap.toFixed(3) + "m");
			}
		}

		for (var j = 0; j < this.decks.length; j++) {
			var dv = this.decks[j].validate();
			errors = errors.concat(dv.errors);
			warnings = warnings.concat(dv.warnings);
		}

		for (var k = 0; k < this.primers.length; k++) {
			var pv = this.primers[k].validate(this.decks);
			errors = errors.concat(pv.errors);
			warnings = warnings.concat(pv.warnings);
		}

		return { valid: errors.length === 0, errors: errors, warnings: warnings };
	}

	// ============ DIMENSION MISMATCH ============

	/**
	 * Check if hole dimensions have changed since charging was created.
	 * @param {Object} hole - Current blast hole object
	 * @returns {{ lengthChanged: boolean, diameterChanged: boolean, oldLength: number, newLength: number, oldDiameter: number, newDiameter: number }}
	 */
	checkDimensionMismatch(hole) {
		var currentLength = hole.holeLengthCalculated || hole.measuredLength || 0;
		var currentDiameter = hole.holeDiameter || 0;
		var lengthDelta = Math.abs(currentLength - this.holeLength);
		var diameterDelta = Math.abs(currentDiameter - this.holeDiameterMm);

		return {
			lengthChanged: lengthDelta > 0.01,
			diameterChanged: diameterDelta > 0.1,
			oldLength: this.holeLength,
			newLength: currentLength,
			oldDiameter: this.holeDiameterMm,
			newDiameter: currentDiameter
		};
	}

	/**
	 * Update cached dimensions and rescale deck depths when hole length/diameter changes.
	 * Uses top/base formula-aware approach respecting per-deck scaling flags:
	 *   - isVariable (VR): re-evaluate topDepthFormula/baseDepthFormula with new hole context
	 *   - isFixedLength (FL): keep topDepth and baseDepth unchanged
	 *   - isFixedMass (FM): recalculate length from mass at new diameter, adjust derived end
	 *   - isProportionalDeck (PR): scale both topDepth and baseDepth proportionally
	 *
	 * @param {Object} hole - Current blast hole object
	 * @returns {{ lengthRescaled: boolean, diameterUpdated: boolean }}
	 */
	updateDimensions(hole) {
		var currentLength = hole.holeLengthCalculated || hole.measuredLength || 0;
		var currentDiameter = hole.holeDiameter || 0;
		var result = { lengthRescaled: false, diameterUpdated: false };

		var lengthChanged = this.holeLength !== 0 && Math.abs(currentLength - this.holeLength) > 0.01;
		var diameterChanged = Math.abs(currentDiameter - this.holeDiameterMm) > 0.1;

		if (lengthChanged || diameterChanged) {
			var newLength = currentLength;
			var oldLength = this.holeLength;
			var newDiameter = diameterChanged ? currentDiameter : this.holeDiameterMm;

			// Build incremental formula context for VR deck re-evaluation
			var formulaCtx = {
				holeLength: newLength,
				holeDiameter: newDiameter,
				benchHeight: hole.benchHeight || 0,
				subdrillLength: hole.subdrillLength || 0,
				chargeLength: 0,
				chargeTop: 0,
				chargeBase: newLength,
				stemLength: 0
			};

			// Sequential layout: process decks in topDepth order
			var lengthRatio = oldLength > 0 ? newLength / oldLength : 1;

			for (var j = 0; j < this.decks.length; j++) {
				var dk = this.decks[j];
				var oldLen = dk.length;

				if (dk.isFixedLength) {
					// FL: keep topDepth and baseDepth unchanged
					// (no change to deck positions)
				} else if (dk.isVariable && (dk.topDepthFormula || dk.baseDepthFormula)) {
					// VR: re-evaluate formulas with current hole context + resolved deck vars
					var newTop = dk.topDepth;
					var newBase = dk.baseDepth;

					if (dk.topDepthFormula) {
						var tResult = evaluateFormula(dk.topDepthFormula, formulaCtx);
						if (tResult != null && isFinite(tResult)) newTop = tResult;
					}
					if (dk.baseDepthFormula) {
						var bResult = evaluateFormula(dk.baseDepthFormula, formulaCtx);
						if (bResult != null && isFinite(bResult)) newBase = bResult;
					}

					dk.topDepth = parseFloat(newTop.toFixed(3));
					dk.baseDepth = parseFloat(newBase.toFixed(3));
				} else if (dk.isFixedMass) {
					// FM: recalculate length from mass at new diameter
					var newLen = this._lengthForMass(dk, newDiameter);
					if (newLen != null && newLen > 0) {
						// Keep the top position, adjust base
						dk.baseDepth = parseFloat((dk.topDepth + newLen).toFixed(3));
					}
				} else {
					// PR (Proportional): scale both topDepth and baseDepth
					dk.topDepth = parseFloat((dk.topDepth * lengthRatio).toFixed(3));
					dk.baseDepth = parseFloat((dk.baseDepth * lengthRatio).toFixed(3));
				}

				// Clamp to hole bounds
				if (dk.topDepth < 0) dk.topDepth = 0;
				if (dk.baseDepth > newLength) dk.baseDepth = parseFloat(newLength.toFixed(3));

				// Rescale embedded content positions proportionally within the deck
				var newDeckLen = dk.length;
				if (dk.contains && oldLen > 0 && newDeckLen > 0) {
					var contentRatio = newDeckLen / oldLen;
					for (var ci = 0; ci < dk.contains.length; ci++) {
						dk.contains[ci].lengthFromCollar = dk.topDepth +
							(dk.contains[ci].lengthFromCollar - dk.topDepth) * contentRatio;
					}
				}

				// Add deckBase[N]/deckTop[N] to context for subsequent VR decks
				var deckPos = j + 1;
				formulaCtx["deckBase_" + deckPos] = dk.baseDepth;
				formulaCtx["deckTop_" + deckPos] = dk.topDepth;
				formulaCtx["deckLength_" + deckPos] = dk.baseDepth - dk.topDepth;
			}

			// Rescale primer depths — re-evaluate formulas or scale proportionally
			for (var k = 0; k < this.primers.length; k++) {
				var primer = this.primers[k];
				if (primer.depthFormula) {
					// Build primer context with charge vars
					var primerCtx = Object.assign({}, formulaCtx);
					buildIndexedChargeVarsForPrimers(this.decks, primerCtx);
					var pResult = evaluateFormula(primer.depthFormula, primerCtx);
					if (pResult != null && isFinite(pResult)) {
						primer.lengthFromCollar = Math.max(0, Math.min(newLength - 0.1, parseFloat(pResult.toFixed(2))));
					}
				} else if (primer.lengthFromCollar != null) {
					primer.lengthFromCollar = Math.max(0,
						Math.min(newLength - 0.1, primer.lengthFromCollar * lengthRatio));
				}
			}

			this.holeLength = newLength;
			this.holeDiameterMm = newDiameter;
			result.lengthRescaled = lengthChanged;
			result.diameterUpdated = diameterChanged;
		} else if (this.holeLength === 0 && currentLength !== 0) {
			this.holeLength = currentLength;
			result.lengthRescaled = true;
		}

		if (diameterChanged && !lengthChanged) {
			this.holeDiameterMm = currentDiameter;
			result.diameterUpdated = true;
		}

		if (result.lengthRescaled || result.diameterUpdated) {
			this.modified = new Date().toISOString();
		}

		return result;
	}

	/**
	 * Calculate required deck length from its current mass at a given diameter.
	 * length = mass / (density * PI * r² * 1000)
	 * @param {Object} deck - Deck object
	 * @param {number} diameterMm - Hole diameter in mm
	 * @returns {number|null} Length in metres, or null
	 */
	_lengthForMass(deck, diameterMm) {
		var density = deck.effectiveDensity;
		if (!density || density <= 0) return null;
		var mass = deck.calculateMass(this.holeDiameterMm); // mass at old diameter
		if (mass <= 0) return null;
		var radiusM = (diameterMm / 1000) / 2;
		var area = Math.PI * radiusM * radiusM;
		var kgPerMetre = density * 1000 * area;
		if (kgPerMetre <= 0) return null;
		return mass / kgPerMetre;
	}

	clear() {
		this.decks = [];
		this.primers = [];
		this.initializeDefaultDeck();
	}

	toJSON() {
		return {
			holeID: this.holeID,
			entityName: this.entityName,
			holeDiameterMm: this.holeDiameterMm,
			holeLength: this.holeLength,
			autoRecalculate: this.autoRecalculate,
			decks: this.decks.map(function(d) { return d.toJSON(); }),
			primers: this.primers.map(function(p) { return p.toJSON(); }),
			created: this.created,
			modified: this.modified
		};
	}

	static fromJSON(obj, hole) {
		var hc = new HoleCharging(hole || {
			holeID: obj.holeID,
			entityName: obj.entityName,
			holeDiameter: obj.holeDiameterMm,
			holeLengthCalculated: obj.holeLength,
			autoRecalculate: obj.autoRecalculate
		});
		hc.autoRecalculate = obj.autoRecalculate !== undefined ? obj.autoRecalculate : true;
		hc.decks = [];
		hc.primers = [];
		if (obj.decks) {
			hc.decks = obj.decks.map(function(d) { return Deck.fromJSON(d); });
		}
		if (obj.primers) {
			hc.primers = obj.primers.map(function(p) { return Primer.fromJSON(p); });
		}
		hc.created = obj.created || hc.created;
		hc.modified = obj.modified || hc.modified;
		return hc;
	}
}
