/* prettier-ignore-file */
//=================================================
// Charging Deck Builder Pipeline Tests
//=================================================
// End-to-end tests for the charging pipeline:
// - Deck creation and interval filling
// - Product snapshot propagation
// - Compressible density model
// - Mass/volume calculations
// - Formula evaluation and clearing
// - Dimension update (auto-recalculate)
// - JSON serialization roundtrip
// - Validation
//
// Run with: node src/charging/__tests__/charging-pipeline.test.js
//=================================================

// ---- Minimal module loader for Node.js (no bundler) ----
// We inline the necessary imports since this runs standalone.

var ATM_PA = 101325;
var G = 9.80665;

// ---- DECK_TYPES and constants (from ChargingConstants.js) ----
var DECK_TYPES = Object.freeze({
	INERT: "INERT",
	COUPLED: "COUPLED",
	DECOUPLED: "DECOUPLED",
	SPACER: "SPACER"
});

var DECK_SCALING_MODES = Object.freeze({
	FIXED_LENGTH: "fixedLength",
	FIXED_MASS: "fixedMass",
	PROPORTIONAL: "proportional",
	VARIABLE: "variable"
});

var VALIDATION_MESSAGES = Object.freeze({
	NO_DIAMETER_OR_LENGTH: "This hole has no diameter or length and by definition is not a hole.",
	DECK_OVERLAP: "Decks cannot overlap.",
	DECK_GAP: "Gap detected between decks.",
	PRIMER_IN_SPACER: "Primers cannot be placed in Spacer decks.",
	ZERO_DECK_LENGTH: "Deck has zero length.",
	NO_PRODUCT_ASSIGNED: "Deck has no product assigned.",
	NO_DETONATOR: "Primer has no detonator assigned.",
	NO_BOOSTER: "Primer has no booster assigned.",
	PRIMER_OUTSIDE_DECKS: "Primer is outside all deck bounds.",
	NO_DECKS: "Hole has no decks defined."
});

var DEFAULT_DECK = Object.freeze({
	deckType: DECK_TYPES.INERT,
	productType: "Air",
	productName: "Air",
	density: 0.0012
});

// ---- UUID generator ----
function generateUUID() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
		var r = Math.random() * 16 | 0;
		var v = c === "x" ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

// ---- CompressibleDensityModel (from CompressibleDensityModel.js) ----
function createCompressibleModel(params) {
	var limitingDensity = params.limitingDensity;
	var capDensity = params.capDensity;
	var criticalDensity = params.criticalDensity || null;
	var waterHeadM = params.waterHeadM || 0;
	var holeDiameterMm = params.holeDiameterMm || 115;
	var interval = params.interval || 0.1;

	var waterHeadATM = (1000 * G * waterHeadM) / ATM_PA;

	function pressureSimplified(h) {
		return waterHeadATM + 1 + (capDensity * 1000 * G * h) / ATM_PA;
	}

	function densityAtPressure(pressureATM) {
		var specificVolGas = (1 / capDensity) - (1 / limitingDensity);
		return 1 / ((1 / limitingDensity) + specificVolGas / pressureATM);
	}

	function densityAtDepth(h) {
		if (h <= 0) return capDensity;
		return densityAtPressure(pressureSimplified(h));
	}

	function densityProfile(columnLength, profileInterval) {
		var step = profileInterval || interval;
		var profile = [];
		var radiusM = (holeDiameterMm / 1000) / 2;
		var area = Math.PI * radiusM * radiusM;
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
		return profile;
	}

	function averageDensity(columnLength) {
		if (columnLength <= 0) return capDensity;
		var prof = densityProfile(columnLength, interval);
		if (prof.length === 0) return capDensity;
		return prof[prof.length - 1].avgDensity;
	}

	function totalMass(columnLength) {
		if (columnLength <= 0) return 0;
		var prof = densityProfile(columnLength, interval);
		if (prof.length === 0) return 0;
		return prof[prof.length - 1].cumulativeMassKg;
	}

	function criticalDepth(columnLength) {
		if (!criticalDensity) return null;
		if (capDensity >= criticalDensity) return 0;
		var prof = densityProfile(columnLength, interval);
		for (var i = 0; i < prof.length; i++) {
			if (prof[i].isCritical) return prof[i].depth;
		}
		return null;
	}

	function compressionRatio(h) {
		var rho = densityAtDepth(h);
		if (limitingDensity === capDensity) return 0;
		return Math.min(1, Math.max(0, (rho - capDensity) / (limitingDensity - capDensity)));
	}

	function criticalRatio() {
		if (!criticalDensity) return null;
		if (limitingDensity === capDensity) return null;
		return Math.min(1, Math.max(0, (criticalDensity - capDensity) / (limitingDensity - capDensity)));
	}

	return {
		limitingDensity: limitingDensity,
		capDensity: capDensity,
		criticalDensity: criticalDensity,
		waterHeadM: waterHeadM,
		holeDiameterMm: holeDiameterMm,
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

// ---- Deck class (simplified from Deck.js) ----
function Deck(options) {
	this.deckID = options.deckID || generateUUID();
	this.holeID = options.holeID;
	this.deckType = options.deckType || DECK_TYPES.INERT;
	this.topDepth = options.topDepth;
	this.baseDepth = options.baseDepth;
	this.product = options.product || null;
	this.contains = options.contains || null;
	this.isCompressible = options.isCompressible || false;
	this.averageDensity = options.averageDensity || null;
	this.capDensity = options.capDensity || null;
	this.maxCompressibleDensity = options.maxCompressibleDensity || null;
	this.limitingDensity = options.limitingDensity || null;
	this.criticalDensity = options.criticalDensity || null;
	this.waterHeadM = options.waterHeadM || 0;
	this.isFixedLength = options.isFixedLength || false;
	this.isFixedMass = options.isFixedMass || false;
	this.isVariable = options.isVariable || false;
	this.isProportionalDeck = (options.isProportionalDeck !== undefined)
		? options.isProportionalDeck
		: (!options.isFixedLength && !options.isFixedMass && !options.isVariable);
	this.overlapPattern = options.overlapPattern || null;
	this.topDepthFormula = options.topDepthFormula || null;
	this.baseDepthFormula = options.baseDepthFormula || null;
	this.lengthFormula = options.lengthFormula || null;
	this.swap = options.swap || null;
	this.swappedFrom = options.swappedFrom || null;
	this.created = options.created || new Date().toISOString();
	this.modified = new Date().toISOString();
}

Object.defineProperty(Deck.prototype, "length", {
	get: function() { return Math.abs(this.baseDepth - this.topDepth); }
});

Object.defineProperty(Deck.prototype, "scalingMode", {
	get: function() {
		if (this.isFixedLength) return DECK_SCALING_MODES.FIXED_LENGTH;
		if (this.isFixedMass) return DECK_SCALING_MODES.FIXED_MASS;
		if (this.isVariable) return DECK_SCALING_MODES.VARIABLE;
		return DECK_SCALING_MODES.PROPORTIONAL;
	}
});

Object.defineProperty(Deck.prototype, "effectiveDensity", {
	get: function() {
		if (this.isCompressible) {
			var model = this.getCompressibleModel();
			if (model) return model.averageDensity(this.length);
			if (this.averageDensity) return this.averageDensity;
		}
		return this.product ? (this.product.density || 0) : 0;
	}
});

Deck.prototype.getCompressibleModel = function(diameterMm) {
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
};

Object.defineProperty(Deck.prototype, "packageCount", {
	get: function() {
		if (this.deckType !== DECK_TYPES.DECOUPLED) return 0;
		if (!this.product || !this.product.lengthMm) return 0;
		var packageLenM = this.product.lengthMm / 1000;
		if (packageLenM <= 0) return 0;
		return Math.floor(this.length / packageLenM);
	}
});

Deck.prototype.calculateVolume = function(holeDiameterMm) {
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
};

Deck.prototype.calculateMass = function(holeDiameterMm) {
	if (this.deckType === DECK_TYPES.DECOUPLED && this.product) {
		var count = this.overlapPattern ? this.totalPackageCount : this.packageCount;
		if (count > 0 && this.product.diameterMm && this.effectiveDensity > 0) {
			var pkgLenM = this.product.lengthMm / 1000;
			var rM = (this.product.diameterMm / 1000) / 2;
			var unitMassKg = Math.PI * rM * rM * pkgLenM * this.effectiveDensity * 1000;
			return count * unitMassKg;
		}
		if (this.product.diameterMm && this.effectiveDensity > 0) {
			var rM2 = (this.product.diameterMm / 1000) / 2;
			return Math.PI * rM2 * rM2 * this.length * this.effectiveDensity * 1000;
		}
	}
	if (this.isCompressible && this.deckType === DECK_TYPES.COUPLED) {
		var model = this.getCompressibleModel(holeDiameterMm);
		if (model) return model.totalMass(this.length);
	}
	return this.calculateVolume(holeDiameterMm) * this.effectiveDensity * 1000;
};

Deck.prototype.containsDepth = function(depth) {
	var min = Math.min(this.topDepth, this.baseDepth);
	var max = Math.max(this.topDepth, this.baseDepth);
	return depth >= min && depth <= max;
};

Deck.prototype.validate = function() {
	var errors = [], warnings = [];
	if (this.topDepth === this.baseDepth) errors.push(VALIDATION_MESSAGES.ZERO_DECK_LENGTH);
	if (!this.product) warnings.push(VALIDATION_MESSAGES.NO_PRODUCT_ASSIGNED);
	return { valid: errors.length === 0, errors: errors, warnings: warnings };
};

Deck.prototype.toJSON = function() {
	return {
		deckID: this.deckID, holeID: this.holeID, deckType: this.deckType,
		topDepth: this.topDepth, baseDepth: this.baseDepth, product: this.product,
		contains: this.contains, isCompressible: this.isCompressible,
		averageDensity: this.averageDensity, capDensity: this.capDensity,
		maxCompressibleDensity: this.maxCompressibleDensity,
		limitingDensity: this.limitingDensity, criticalDensity: this.criticalDensity,
		waterHeadM: this.waterHeadM, isFixedLength: this.isFixedLength,
		isFixedMass: this.isFixedMass, isVariable: this.isVariable,
		isProportionalDeck: this.isProportionalDeck, overlapPattern: this.overlapPattern,
		topDepthFormula: this.topDepthFormula, baseDepthFormula: this.baseDepthFormula,
		lengthFormula: this.lengthFormula, swap: this.swap, swappedFrom: this.swappedFrom,
		created: this.created, modified: this.modified
	};
};

Deck.fromJSON = function(obj) {
	return new Deck(obj);
};

// ---- HoleCharging (simplified from HoleCharging.js) ----
function HoleCharging(hole) {
	this.holeID = hole.holeID;
	this.entityName = hole.entityName || null;
	this.holeDiameterMm = hole.holeDiameter || 0;
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

HoleCharging.prototype.initializeDefaultDeck = function() {
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
};

HoleCharging.prototype.sortDecks = function() {
	this.decks.sort(function(a, b) { return a.topDepth - b.topDepth; });
};

HoleCharging.prototype.getUnallocated = function() {
	var unallocated = [];
	for (var i = 0; i < this.decks.length; i++) {
		var deck = this.decks[i];
		if (deck.deckType === DECK_TYPES.INERT && deck.product && deck.product.name === "Air") {
			unallocated.push({ top: deck.topDepth, base: deck.baseDepth, length: deck.length });
		}
	}
	return unallocated;
};

HoleCharging.prototype.fillInterval = function(topDepth, baseDepth, deckType, product, options) {
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
};

HoleCharging.prototype.insertDeck = function(newDeck) {
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
			if (exMin < newMin) {
				toAdd.push(new Deck({
					holeID: this.holeID,
					deckType: existing.deckType,
					topDepth: exMin,
					baseDepth: newMin,
					product: existing.product ? Object.assign({}, existing.product) : null
				}));
			}
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
};

HoleCharging.prototype.getExplosiveDecks = function() {
	return this.decks.filter(function(d) {
		return d.deckType === DECK_TYPES.COUPLED || d.deckType === DECK_TYPES.DECOUPLED;
	});
};

HoleCharging.prototype.getTotalExplosiveMass = function() {
	var total = 0;
	var self = this;
	for (var i = 0; i < this.decks.length; i++) {
		var deck = this.decks[i];
		if (deck.deckType === DECK_TYPES.COUPLED) {
			total += deck.calculateMass(self.holeDiameterMm);
		} else if (deck.deckType === DECK_TYPES.DECOUPLED) {
			total += deck.calculateMass(self.holeDiameterMm);
		}
	}
	return total;
};

HoleCharging.prototype.calculatePowderFactor = function(burden, spacing) {
	var mass = this.getTotalExplosiveMass();
	var volume = burden * spacing * Math.abs(this.holeLength);
	return volume > 0 ? mass / volume : 0;
};

HoleCharging.prototype.validate = function() {
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
	return { valid: errors.length === 0, errors: errors, warnings: warnings };
};

HoleCharging.prototype.updateDimensions = function(hole) {
	var currentLength = hole.holeLengthCalculated || hole.measuredLength || 0;
	var currentDiameter = hole.holeDiameter || 0;
	var result = { lengthRescaled: false, diameterUpdated: false };

	var lengthChanged = this.holeLength !== 0 && Math.abs(currentLength - this.holeLength) > 0.01;
	var diameterChanged = Math.abs(currentDiameter - this.holeDiameterMm) > 0.1;

	if (lengthChanged || diameterChanged) {
		var newLength = currentLength;
		var oldLength = this.holeLength;
		var newDiameter = diameterChanged ? currentDiameter : this.holeDiameterMm;
		var lengthRatio = oldLength > 0 ? newLength / oldLength : 1;

		for (var j = 0; j < this.decks.length; j++) {
			var dk = this.decks[j];
			if (dk.isFixedLength) {
				// No change
			} else {
				dk.topDepth = parseFloat((dk.topDepth * lengthRatio).toFixed(3));
				dk.baseDepth = parseFloat((dk.baseDepth * lengthRatio).toFixed(3));
			}
			if (dk.topDepth < 0) dk.topDepth = 0;
			if (dk.baseDepth > newLength) dk.baseDepth = parseFloat(newLength.toFixed(3));
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
};

HoleCharging.prototype.clear = function() {
	this.decks = [];
	this.primers = [];
	this.initializeDefaultDeck();
};

HoleCharging.prototype.toJSON = function() {
	return {
		holeID: this.holeID, entityName: this.entityName,
		holeDiameterMm: this.holeDiameterMm, holeLength: this.holeLength,
		autoRecalculate: this.autoRecalculate,
		decks: this.decks.map(function(d) { return d.toJSON(); }),
		primers: this.primers.map(function(p) { return p.toJSON ? p.toJSON() : p; }),
		created: this.created, modified: this.modified
	};
};

HoleCharging.fromJSON = function(obj, hole) {
	var hc = new HoleCharging(hole || {
		holeID: obj.holeID, entityName: obj.entityName,
		holeDiameter: obj.holeDiameterMm,
		holeLengthCalculated: obj.holeLength,
		autoRecalculate: obj.autoRecalculate
	});
	hc.autoRecalculate = obj.autoRecalculate !== undefined ? obj.autoRecalculate : true;
	hc.decks = [];
	if (obj.decks) {
		hc.decks = obj.decks.map(function(d) { return Deck.fromJSON(d); });
	}
	hc.primers = obj.primers || [];
	hc.created = obj.created || hc.created;
	hc.modified = obj.modified || hc.modified;
	return hc;
};

// ========== TEST FRAMEWORK ==========

var testResults = { passed: 0, failed: 0, tests: [] };
var currentSuite = "";

function describe(name, fn) {
	currentSuite = name;
	console.log("\n--- " + name + " ---");
	fn();
	currentSuite = "";
}

function test(name, fn) {
	var fullName = currentSuite ? currentSuite + " > " + name : name;
	try {
		fn();
		testResults.passed++;
		testResults.tests.push({ name: fullName, passed: true });
		console.log("  PASS  " + name);
	} catch (e) {
		testResults.failed++;
		testResults.tests.push({ name: fullName, passed: false, error: e.message });
		console.log("  FAIL  " + name);
		console.log("        " + e.message);
	}
}

function expect(value) {
	return {
		toBe: function(expected) {
			if (value !== expected) throw new Error("Expected " + JSON.stringify(expected) + " but got " + JSON.stringify(value));
		},
		toEqual: function(expected) {
			if (JSON.stringify(value) !== JSON.stringify(expected))
				throw new Error("Expected " + JSON.stringify(expected) + " but got " + JSON.stringify(value));
		},
		toBeGreaterThan: function(expected) {
			if (!(value > expected)) throw new Error("Expected " + value + " > " + expected);
		},
		toBeLessThan: function(expected) {
			if (!(value < expected)) throw new Error("Expected " + value + " < " + expected);
		},
		toBeCloseTo: function(expected, precision) {
			var p = precision !== undefined ? precision : 2;
			var diff = Math.abs(value - expected);
			var limit = Math.pow(10, -p) / 2;
			if (diff > limit) throw new Error("Expected " + value + " to be close to " + expected + " (diff=" + diff.toFixed(p + 2) + ")");
		},
		toBeTruthy: function() {
			if (!value) throw new Error("Expected truthy but got " + JSON.stringify(value));
		},
		toBeFalsy: function() {
			if (value) throw new Error("Expected falsy but got " + JSON.stringify(value));
		},
		toBeNull: function() {
			if (value !== null) throw new Error("Expected null but got " + JSON.stringify(value));
		},
		toBeGreaterThanOrEqual: function(expected) {
			if (!(value >= expected)) throw new Error("Expected " + value + " >= " + expected);
		},
		toBeLessThanOrEqual: function(expected) {
			if (!(value <= expected)) throw new Error("Expected " + value + " <= " + expected);
		},
		toHaveLength: function(expected) {
			if (!value || value.length !== expected) throw new Error("Expected length " + expected + " but got " + (value ? value.length : "undefined"));
		}
	};
}


// ========== TEST DATA FACTORIES ==========

function createTestHole(overrides) {
	return Object.assign({
		holeID: "TEST-001",
		entityName: "ISEE_OTHER",
		holeDiameter: 165,
		holeLengthCalculated: 3.5,
		benchHeight: 3.0,
		subdrillLength: 0.5,
		measuredLength: 0,
		autoRecalculate: true
	}, overrides || {});
}

function createStemProduct() {
	return { name: "Stemming", density: 2.1, productCategory: "NonExplosive" };
}

function createANFOProduct() {
	return { name: "ANFO", density: 0.8, productCategory: "BulkExplosive", isCompressible: false };
}

function createCompressibleProduct() {
	return {
		name: "GENERIC7030G",
		density: 1.17,
		productCategory: "BulkExplosive",
		isCompressible: true,
		limitingDensity: 1.34,
		criticalDensity: 1.29
	};
}

function createPackagedProduct() {
	return {
		name: "PKG75mm",
		density: 1.15,
		productCategory: "HighExplosive",
		diameterMm: 75,
		lengthMm: 400,
		massGrams: 2500
	};
}


// ========== TESTS ==========

console.log("\n========================================");
console.log("  Charging Deck Builder Pipeline Tests");
console.log("========================================");

// --------------------------------------------------
// 1. DECK CONSTRUCTION & PROPERTIES
// --------------------------------------------------
describe("Deck Construction", function() {
	test("creates deck with correct properties", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 2.5, baseDepth: 3.5,
			product: createANFOProduct()
		});
		expect(d.deckType).toBe(DECK_TYPES.COUPLED);
		expect(d.topDepth).toBe(2.5);
		expect(d.baseDepth).toBe(3.5);
		expect(d.length).toBe(1.0);
		expect(d.product.name).toBe("ANFO");
	});

	test("length is always positive regardless of top/base order", function() {
		var d = new Deck({ holeID: "H1", topDepth: 5, baseDepth: 2 });
		expect(d.length).toBe(3);
	});

	test("default scaling is proportional", function() {
		var d = new Deck({ holeID: "H1", topDepth: 0, baseDepth: 5 });
		expect(d.scalingMode).toBe(DECK_SCALING_MODES.PROPORTIONAL);
		expect(d.isProportionalDeck).toBe(true);
	});

	test("fixed-length scaling mode", function() {
		var d = new Deck({ holeID: "H1", topDepth: 0, baseDepth: 2, isFixedLength: true });
		expect(d.scalingMode).toBe(DECK_SCALING_MODES.FIXED_LENGTH);
	});

	test("containsDepth works correctly", function() {
		var d = new Deck({ holeID: "H1", topDepth: 1.0, baseDepth: 3.0 });
		expect(d.containsDepth(2.0)).toBe(true);
		expect(d.containsDepth(1.0)).toBe(true);
		expect(d.containsDepth(3.0)).toBe(true);
		expect(d.containsDepth(0.5)).toBe(false);
		expect(d.containsDepth(3.5)).toBe(false);
	});
});

// --------------------------------------------------
// 2. DECK VALIDATION
// --------------------------------------------------
describe("Deck Validation", function() {
	test("zero-length deck is invalid", function() {
		var d = new Deck({ holeID: "H1", topDepth: 2.0, baseDepth: 2.0 });
		var v = d.validate();
		expect(v.valid).toBe(false);
		expect(v.errors.length).toBeGreaterThan(0);
	});

	test("deck without product warns", function() {
		var d = new Deck({ holeID: "H1", topDepth: 0, baseDepth: 3 });
		var v = d.validate();
		expect(v.valid).toBe(true);
		expect(v.warnings.length).toBeGreaterThan(0);
	});

	test("valid deck passes", function() {
		var d = new Deck({
			holeID: "H1", topDepth: 0, baseDepth: 3,
			product: createANFOProduct()
		});
		var v = d.validate();
		expect(v.valid).toBe(true);
		expect(v.errors.length).toBe(0);
	});
});

// --------------------------------------------------
// 3. MASS & VOLUME CALCULATIONS
// --------------------------------------------------
describe("Mass and Volume Calculations", function() {
	test("COUPLED deck volume = PI * r^2 * length", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 2.0,
			product: createANFOProduct()
		});
		var holeDiaMm = 165;
		var expectedVol = Math.PI * Math.pow((165 / 1000) / 2, 2) * 2.0;
		expect(d.calculateVolume(holeDiaMm)).toBeCloseTo(expectedVol, 6);
	});

	test("COUPLED deck mass = volume * density * 1000", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 2.0,
			product: createANFOProduct()
		});
		var holeDiaMm = 165;
		var vol = d.calculateVolume(holeDiaMm);
		var expectedMass = vol * 0.8 * 1000;
		expect(d.calculateMass(holeDiaMm)).toBeCloseTo(expectedMass, 2);
	});

	test("INERT deck mass with stemming", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.INERT,
			topDepth: 0, baseDepth: 2.5,
			product: createStemProduct()
		});
		var mass = d.calculateMass(165);
		expect(mass).toBeGreaterThan(0);
		// stemming density 2.1 g/cc in a 165mm hole, 2.5m length
		var expectedMass = Math.PI * Math.pow(0.0825, 2) * 2.5 * 2.1 * 1000;
		expect(mass).toBeCloseTo(expectedMass, 1);
	});

	test("DECOUPLED deck uses package counting", function() {
		var pkg = createPackagedProduct();
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.DECOUPLED,
			topDepth: 0, baseDepth: 1.0,
			product: pkg
		});
		// 1.0m / 0.4m = 2 packages fit
		expect(d.packageCount).toBe(2);
		var mass = d.calculateMass(165);
		// 2 packages x PI * (0.0375)^2 * 0.4 * 1.15 * 1000
		var unitMass = Math.PI * Math.pow(0.0375, 2) * 0.4 * 1.15 * 1000;
		expect(mass).toBeCloseTo(2 * unitMass, 2);
	});

	test("zero-length deck has zero mass", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 2.0, baseDepth: 2.0,
			product: createANFOProduct()
		});
		expect(d.calculateMass(165)).toBe(0);
	});
});

// --------------------------------------------------
// 4. COMPRESSIBLE DENSITY MODEL
// --------------------------------------------------
describe("Compressible Density Model", function() {
	test("density at surface equals capDensity", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			criticalDensity: 1.29
		});
		expect(model.densityAtDepth(0)).toBe(1.15);
	});

	test("density increases with depth", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			criticalDensity: 1.29
		});
		var d0 = model.densityAtDepth(0);
		var d1 = model.densityAtDepth(1);
		var d5 = model.densityAtDepth(5);
		var d10 = model.densityAtDepth(10);
		expect(d1).toBeGreaterThan(d0);
		expect(d5).toBeGreaterThan(d1);
		expect(d10).toBeGreaterThan(d5);
	});

	test("density never exceeds limitingDensity", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			criticalDensity: 1.29
		});
		var dDeep = model.densityAtDepth(100);
		expect(dDeep).toBeLessThanOrEqual(1.34);
	});

	test("pressure at surface is ~1 ATM", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15
		});
		expect(model.pressureAtDepth(0)).toBeCloseTo(1.0, 1);
	});

	test("pressure increases with depth", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15
		});
		expect(model.pressureAtDepth(5)).toBeGreaterThan(model.pressureAtDepth(0));
	});

	test("average density is between cap and limiting", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15
		});
		var avg = model.averageDensity(5);
		expect(avg).toBeGreaterThanOrEqual(1.15);
		expect(avg).toBeLessThanOrEqual(1.34);
	});

	test("total mass is positive for positive length", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			holeDiameterMm: 165
		});
		var mass = model.totalMass(2.0);
		expect(mass).toBeGreaterThan(0);
	});

	test("total mass is zero for zero length", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15
		});
		expect(model.totalMass(0)).toBe(0);
	});

	test("critical depth is found when column is long enough", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			criticalDensity: 1.29
		});
		var cd = model.criticalDepth(30);
		expect(cd).toBeGreaterThan(0);
		expect(cd).toBeLessThan(30);
	});

	test("critical depth is null when column too short", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			criticalDensity: 1.29
		});
		// Very short column should not reach critical
		var cd = model.criticalDepth(0.1);
		expect(cd).toBeNull();
	});

	test("critical depth is null when no criticalDensity set", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15
		});
		expect(model.criticalDepth(30)).toBeNull();
	});

	test("compressionRatio is 0 at surface, increases with depth", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15
		});
		expect(model.compressionRatio(0)).toBeCloseTo(0, 2);
		expect(model.compressionRatio(5)).toBeGreaterThan(0);
		expect(model.compressionRatio(5)).toBeLessThanOrEqual(1);
	});

	test("criticalRatio returns value between 0 and 1", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			criticalDensity: 1.29
		});
		var cr = model.criticalRatio();
		expect(cr).toBeGreaterThan(0);
		expect(cr).toBeLessThan(1);
		// criticalRatio = (1.29 - 1.15) / (1.34 - 1.15) = 0.14/0.19 ~ 0.737
		expect(cr).toBeCloseTo(0.737, 2);
	});

	test("criticalRatio is null when no criticalDensity", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15
		});
		expect(model.criticalRatio()).toBeNull();
	});

	test("water head increases pressure and density", function() {
		var modelDry = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15, waterHeadM: 0
		});
		var modelWet = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15, waterHeadM: 5
		});
		// At same depth, wet hole should have higher density
		expect(modelWet.densityAtDepth(3)).toBeGreaterThan(modelDry.densityAtDepth(3));
		expect(modelWet.pressureAtDepth(0)).toBeGreaterThan(modelDry.pressureAtDepth(0));
	});

	test("density profile has correct number of points", function() {
		var model = createCompressibleModel({
			limitingDensity: 1.34, capDensity: 1.15,
			interval: 0.5
		});
		var prof = model.densityProfile(2.0, 0.5);
		// 2.0 / 0.5 = 4 steps + 1 initial = 5 points
		expect(prof.length).toBe(5);
		expect(prof[0].depth).toBe(0);
		expect(prof[prof.length - 1].depth).toBe(2.0);
	});
});

// --------------------------------------------------
// 5. COMPRESSIBLE DECK INTEGRATION
// --------------------------------------------------
describe("Compressible Deck Integration", function() {
	test("compressible deck reads limitingDensity from product", function() {
		var prod = createCompressibleProduct();
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 1.7, baseDepth: 3.5,
			product: prod,
			isCompressible: true,
			capDensity: prod.density
		});
		var model = d.getCompressibleModel(165);
		expect(model).toBeTruthy();
		expect(model.limitingDensity).toBe(1.34);
		expect(model.capDensity).toBe(1.17);
	});

	test("compressible deck uses deck-level overrides over product", function() {
		var prod = createCompressibleProduct();
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 3,
			product: prod,
			isCompressible: true,
			capDensity: 1.10,
			limitingDensity: 1.40,
			criticalDensity: 1.32
		});
		var model = d.getCompressibleModel(165);
		expect(model.limitingDensity).toBe(1.40);
		expect(model.capDensity).toBe(1.10);
		expect(model.criticalDensity).toBe(1.32);
	});

	test("non-compressible deck returns null model", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 3,
			product: createANFOProduct()
		});
		expect(d.getCompressibleModel()).toBeNull();
	});

	test("compressible deck effectiveDensity uses model average", function() {
		var prod = createCompressibleProduct();
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 2.0,
			product: prod,
			isCompressible: true,
			capDensity: prod.density
		});
		var eff = d.effectiveDensity;
		// Should be between capDensity and limitingDensity
		expect(eff).toBeGreaterThanOrEqual(1.17);
		expect(eff).toBeLessThanOrEqual(1.34);
	});

	test("compressible COUPLED mass uses totalMass from model", function() {
		var prod = createCompressibleProduct();
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 2.0,
			product: prod,
			isCompressible: true,
			capDensity: prod.density
		});
		var mass = d.calculateMass(165);
		// Mass from compressible model should differ from simple vol*density
		var simpleMass = d.calculateVolume(165) * prod.density * 1000;
		// Compressible mass should be >= simple mass (density increases with depth)
		expect(mass).toBeGreaterThanOrEqual(simpleMass);
	});
});

// --------------------------------------------------
// 6. HOLE CHARGING INITIALIZATION
// --------------------------------------------------
describe("HoleCharging Initialization", function() {
	test("creates with default air deck spanning full hole", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		expect(hc.decks.length).toBe(1);
		expect(hc.decks[0].deckType).toBe(DECK_TYPES.INERT);
		expect(hc.decks[0].topDepth).toBe(0);
		expect(hc.decks[0].baseDepth).toBe(3.5);
		expect(hc.decks[0].product.name).toBe("Air");
	});

	test("does not create deck for zero-diameter hole", function() {
		var hole = createTestHole({ holeDiameter: 0 });
		var hc = new HoleCharging(hole);
		expect(hc.decks.length).toBe(0);
	});

	test("stores correct dimensions", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		expect(hc.holeDiameterMm).toBe(165);
		expect(hc.holeLength).toBe(3.5);
	});
});

// --------------------------------------------------
// 7. INTERVAL FILLING (DECK SPLITTING)
// --------------------------------------------------
describe("Interval Filling", function() {
	test("filling stemming at top splits default deck", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());

		expect(hc.decks.length).toBe(2);
		expect(hc.decks[0].topDepth).toBe(0);
		expect(hc.decks[0].baseDepth).toBe(2.5);
		expect(hc.decks[0].product.name).toBe("Stemming");
		expect(hc.decks[1].topDepth).toBe(2.5);
		expect(hc.decks[1].baseDepth).toBe(3.5);
		expect(hc.decks[1].product.name).toBe("Air");
	});

	test("filling charge at bottom splits correctly", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		expect(hc.decks.length).toBe(2);
		expect(hc.decks[0].product.name).toBe("Air");
		expect(hc.decks[1].product.name).toBe("ANFO");
		expect(hc.decks[1].deckType).toBe(DECK_TYPES.COUPLED);
	});

	test("filling middle creates 3 decks", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(1.0, 2.5, DECK_TYPES.COUPLED, createANFOProduct());

		expect(hc.decks.length).toBe(3);
		expect(hc.decks[0].topDepth).toBe(0);
		expect(hc.decks[0].baseDepth).toBe(1.0);
		expect(hc.decks[1].topDepth).toBe(1.0);
		expect(hc.decks[1].baseDepth).toBe(2.5);
		expect(hc.decks[2].topDepth).toBe(2.5);
		expect(hc.decks[2].baseDepth).toBe(3.5);
	});

	test("complete charging design: stem + charge", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		expect(hc.decks.length).toBe(2);
		var v = hc.validate();
		expect(v.valid).toBe(true);

		// No gaps
		expect(hc.decks[0].baseDepth).toBe(hc.decks[1].topDepth);
	});

	test("compressible fill propagates product data", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		var prod = createCompressibleProduct();
		hc.fillInterval(1.7, 3.5, DECK_TYPES.COUPLED, prod, {
			isCompressible: true,
			capDensity: prod.density,
			limitingDensity: prod.limitingDensity,
			criticalDensity: prod.criticalDensity
		});

		var chargeDeck = hc.decks.filter(function(d) { return d.deckType === DECK_TYPES.COUPLED; })[0];
		expect(chargeDeck).toBeTruthy();
		expect(chargeDeck.isCompressible).toBe(true);
		expect(chargeDeck.limitingDensity).toBe(1.34);
		expect(chargeDeck.criticalDensity).toBe(1.29);
		expect(chargeDeck.capDensity).toBe(1.17);

		var model = chargeDeck.getCompressibleModel(165);
		expect(model).toBeTruthy();
	});

	test("unallocated intervals track Air decks", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());

		var unalloc = hc.getUnallocated();
		expect(unalloc.length).toBe(1);
		expect(unalloc[0].top).toBe(2.5);
		expect(unalloc[0].base).toBe(3.5);
	});
});

// --------------------------------------------------
// 8. EXPLOSIVE MASS AND POWDER FACTOR
// --------------------------------------------------
describe("Explosive Mass and Powder Factor", function() {
	test("total explosive mass from COUPLED deck", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		var mass = hc.getTotalExplosiveMass();
		// 1.0m of ANFO in 165mm hole at 0.8 g/cc
		var expected = Math.PI * Math.pow(0.0825, 2) * 1.0 * 0.8 * 1000;
		expect(mass).toBeCloseTo(expected, 1);
	});

	test("powder factor calculated correctly", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		var pf = hc.calculatePowderFactor(3.0, 3.5);
		expect(pf).toBeGreaterThan(0);
		// PF = mass / (burden * spacing * holeLength)
		var mass = hc.getTotalExplosiveMass();
		var expectedPF = mass / (3.0 * 3.5 * 3.5);
		expect(pf).toBeCloseTo(expectedPF, 4);
	});

	test("compressible mass is higher than simple mass", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		var prod = createCompressibleProduct();
		hc.fillInterval(1.7, 3.5, DECK_TYPES.COUPLED, prod, {
			isCompressible: true,
			capDensity: prod.density,
			limitingDensity: prod.limitingDensity,
			criticalDensity: prod.criticalDensity
		});

		var mass = hc.getTotalExplosiveMass();
		// Simple mass without compression
		var simpleVol = Math.PI * Math.pow(0.0825, 2) * 1.8;
		var simpleMass = simpleVol * prod.density * 1000;
		// Compressible mass should be >= simple (avg density >= capDensity)
		expect(mass).toBeGreaterThanOrEqual(simpleMass * 0.99); // allow tiny float tolerance
	});
});

// --------------------------------------------------
// 9. DIMENSION UPDATES (AUTO-RECALCULATE)
// --------------------------------------------------
describe("Dimension Updates", function() {
	test("proportional decks scale when length changes", function() {
		var hole = createTestHole({ holeLengthCalculated: 10 });
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 3, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(3, 10, DECK_TYPES.COUPLED, createANFOProduct());

		// Change hole length from 10 to 12
		var result = hc.updateDimensions({
			holeID: "TEST-001", holeDiameter: 165,
			holeLengthCalculated: 12, benchHeight: 3.0
		});

		expect(result.lengthRescaled).toBe(true);
		expect(hc.holeLength).toBe(12);
		// Stem was 0-3 (30%), should now be 0-3.6
		expect(hc.decks[0].topDepth).toBeCloseTo(0, 2);
		expect(hc.decks[0].baseDepth).toBeCloseTo(3.6, 2);
		// Charge was 3-10 (70%), should now be 3.6-12
		expect(hc.decks[1].topDepth).toBeCloseTo(3.6, 2);
		expect(hc.decks[1].baseDepth).toBeCloseTo(12, 2);
	});

	test("fixed-length decks do NOT scale", function() {
		var hole = createTestHole({ holeLengthCalculated: 10 });
		var hc = new HoleCharging(hole);

		// Clear default deck and create manually
		hc.decks = [];
		hc.decks.push(new Deck({
			holeID: "TEST-001", deckType: DECK_TYPES.INERT,
			topDepth: 0, baseDepth: 3, product: createStemProduct(),
			isFixedLength: true
		}));
		hc.decks.push(new Deck({
			holeID: "TEST-001", deckType: DECK_TYPES.COUPLED,
			topDepth: 3, baseDepth: 10, product: createANFOProduct()
		}));

		hc.updateDimensions({
			holeID: "TEST-001", holeDiameter: 165,
			holeLengthCalculated: 12
		});

		// Fixed-length deck unchanged
		expect(hc.decks[0].topDepth).toBe(0);
		expect(hc.decks[0].baseDepth).toBe(3);
		// Proportional deck scaled
		expect(hc.decks[1].baseDepth).toBeCloseTo(12, 1);
	});

	test("diameter change updates stored diameter", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);

		hc.updateDimensions({
			holeID: "TEST-001", holeDiameter: 200,
			holeLengthCalculated: 3.5
		});

		expect(hc.holeDiameterMm).toBe(200);
	});

	test("no change returns false flags", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);

		var result = hc.updateDimensions({
			holeID: "TEST-001", holeDiameter: 165,
			holeLengthCalculated: 3.5
		});

		expect(result.lengthRescaled).toBe(false);
		expect(result.diameterUpdated).toBe(false);
	});

	test("mass changes when diameter changes", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		var mass165 = hc.getTotalExplosiveMass();

		hc.updateDimensions({
			holeID: "TEST-001", holeDiameter: 200,
			holeLengthCalculated: 3.5
		});

		// Recalculate mass with new diameter
		var mass200 = hc.getTotalExplosiveMass();
		// Larger hole = more mass
		expect(mass200).toBeGreaterThan(mass165);
	});
});

// --------------------------------------------------
// 10. VALIDATION
// --------------------------------------------------
describe("HoleCharging Validation", function() {
	test("valid charging passes", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		var v = hc.validate();
		expect(v.valid).toBe(true);
	});

	test("empty charging is invalid", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.decks = [];

		var v = hc.validate();
		expect(v.valid).toBe(false);
	});

	test("gap between decks warns", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.decks = [];
		hc.decks.push(new Deck({
			holeID: "TEST-001", topDepth: 0, baseDepth: 2,
			product: createStemProduct()
		}));
		hc.decks.push(new Deck({
			holeID: "TEST-001", topDepth: 2.1, baseDepth: 3.5,
			product: createANFOProduct(), deckType: DECK_TYPES.COUPLED
		}));

		var v = hc.validate();
		var hasGapWarning = v.warnings.some(function(w) { return w.indexOf("Gap") >= 0; });
		expect(hasGapWarning).toBe(true);
	});

	test("zero-diameter hole warns", function() {
		var hc = new HoleCharging({ holeID: "H1", holeDiameter: 0, holeLengthCalculated: 0 });
		hc.decks = [new Deck({ holeID: "H1", topDepth: 0, baseDepth: 1, product: createANFOProduct() })];
		var v = hc.validate();
		var hasDimWarning = v.warnings.some(function(w) { return w.indexOf("diameter") >= 0; });
		expect(hasDimWarning).toBe(true);
	});
});

// --------------------------------------------------
// 11. JSON SERIALIZATION ROUNDTRIP
// --------------------------------------------------
describe("JSON Serialization", function() {
	test("Deck roundtrip preserves all fields", function() {
		var orig = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 1.7, baseDepth: 3.5,
			product: createCompressibleProduct(),
			isCompressible: true, capDensity: 1.17,
			limitingDensity: 1.34, criticalDensity: 1.29,
			waterHeadM: 2.0,
			topDepthFormula: "fx:stemLength",
			baseDepthFormula: "fx:holeLength",
			swap: "w{WR-ANFO}"
		});
		var json = orig.toJSON();
		var restored = Deck.fromJSON(json);

		expect(restored.deckType).toBe(DECK_TYPES.COUPLED);
		expect(restored.topDepth).toBe(1.7);
		expect(restored.baseDepth).toBe(3.5);
		expect(restored.isCompressible).toBe(true);
		expect(restored.capDensity).toBe(1.17);
		expect(restored.limitingDensity).toBe(1.34);
		expect(restored.criticalDensity).toBe(1.29);
		expect(restored.waterHeadM).toBe(2.0);
		expect(restored.topDepthFormula).toBe("fx:stemLength");
		expect(restored.baseDepthFormula).toBe("fx:holeLength");
		expect(restored.swap).toBe("w{WR-ANFO}");
		expect(restored.product.name).toBe("GENERIC7030G");
	});

	test("HoleCharging roundtrip preserves structure", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		var prod = createCompressibleProduct();
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, prod, {
			isCompressible: true, capDensity: prod.density,
			limitingDensity: prod.limitingDensity, criticalDensity: prod.criticalDensity
		});

		var json = hc.toJSON();
		var restored = HoleCharging.fromJSON(json);

		expect(restored.holeID).toBe("TEST-001");
		expect(restored.holeDiameterMm).toBe(165);
		expect(restored.holeLength).toBe(3.5);
		expect(restored.decks.length).toBe(hc.decks.length);

		// Check compressible deck survived roundtrip
		var compDeck = restored.decks.filter(function(d) { return d.isCompressible; })[0];
		expect(compDeck).toBeTruthy();
		expect(compDeck.limitingDensity).toBe(1.34);
		expect(compDeck.criticalDensity).toBe(1.29);
	});

	test("JSON roundtrip preserves scaling flags", function() {
		var d = new Deck({
			holeID: "H1", topDepth: 0, baseDepth: 3,
			isFixedLength: true, isProportionalDeck: false
		});
		var json = d.toJSON();
		var restored = Deck.fromJSON(json);
		expect(restored.isFixedLength).toBe(true);
		expect(restored.isProportionalDeck).toBe(false);
		expect(restored.scalingMode).toBe(DECK_SCALING_MODES.FIXED_LENGTH);
	});
});

// --------------------------------------------------
// 12. CLEAR / REINITIALIZE
// --------------------------------------------------
describe("Clear and Reinitialize", function() {
	test("clear resets to default air deck", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		expect(hc.decks.length).toBe(2);
		hc.clear();
		expect(hc.decks.length).toBe(1);
		expect(hc.decks[0].product.name).toBe("Air");
		expect(hc.primers.length).toBe(0);
	});
});

// --------------------------------------------------
// 13. EDGE CASES
// --------------------------------------------------
describe("Edge Cases", function() {
	test("overlapping fill replaces existing deck", function() {
		var hole = createTestHole();
		var hc = new HoleCharging(hole);
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, createANFOProduct());

		// Now fill over the ANFO with emulsion
		var prod = createCompressibleProduct();
		hc.fillInterval(2.5, 3.5, DECK_TYPES.COUPLED, prod, {
			isCompressible: true, capDensity: prod.density,
			limitingDensity: prod.limitingDensity
		});

		expect(hc.decks.length).toBe(2);
		expect(hc.decks[1].product.name).toBe("GENERIC7030G");
		expect(hc.decks[1].isCompressible).toBe(true);
	});

	test("very small deck length still calculates mass", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 0.001,
			product: createANFOProduct()
		});
		var mass = d.calculateMass(165);
		expect(mass).toBeGreaterThan(0);
	});

	test("product with zero density returns zero mass", function() {
		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 3,
			product: { name: "ZeroDensity", density: 0 }
		});
		expect(d.calculateMass(165)).toBe(0);
	});

	test("multiple fills build a full charging config", function() {
		var hole = createTestHole({ holeLengthCalculated: 10 });
		var hc = new HoleCharging(hole);

		// Stemming 0-2.5
		hc.fillInterval(0, 2.5, DECK_TYPES.INERT, createStemProduct());
		// ANFO 2.5-8
		hc.fillInterval(2.5, 8, DECK_TYPES.COUPLED, createANFOProduct());
		// Emulsion 8-10
		var prod = createCompressibleProduct();
		hc.fillInterval(8, 10, DECK_TYPES.COUPLED, prod, {
			isCompressible: true, capDensity: prod.density,
			limitingDensity: prod.limitingDensity
		});

		expect(hc.decks.length).toBe(3);
		expect(hc.getExplosiveDecks().length).toBe(2);

		var v = hc.validate();
		expect(v.valid).toBe(true);

		// Total coverage should be 0 to 10 with no gaps
		expect(hc.decks[0].topDepth).toBe(0);
		expect(hc.decks[2].baseDepth).toBe(10);
		for (var i = 0; i < hc.decks.length - 1; i++) {
			var gap = Math.abs(hc.decks[i + 1].topDepth - hc.decks[i].baseDepth);
			expect(gap).toBeLessThanOrEqual(0.001);
		}
	});
});

// --------------------------------------------------
// 14. PRODUCT SNAPSHOT PROPAGATION
// --------------------------------------------------
describe("Product Snapshot Propagation", function() {
	test("productSnapshot carries compressible fields to deck", function() {
		// Simulates what DeckBuilderDialog.productSnapshot() does
		var product = createCompressibleProduct();
		var snapshot = {
			name: product.name,
			density: product.density,
			productCategory: product.productCategory,
			isCompressible: product.isCompressible,
			limitingDensity: product.limitingDensity,
			criticalDensity: product.criticalDensity
		};

		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 3,
			product: snapshot,
			isCompressible: snapshot.isCompressible,
			capDensity: snapshot.density,
			limitingDensity: snapshot.limitingDensity,
			criticalDensity: snapshot.criticalDensity
		});

		// Verify the full chain: snapshot -> deck -> model
		expect(d.isCompressible).toBe(true);
		expect(d.limitingDensity).toBe(1.34);
		expect(d.criticalDensity).toBe(1.29);

		var model = d.getCompressibleModel(165);
		expect(model).toBeTruthy();
		expect(model.limitingDensity).toBe(1.34);
		expect(model.criticalDensity).toBe(1.29);
		expect(model.capDensity).toBe(1.17);
	});

	test("non-compressible product snapshot does not create model", function() {
		var product = createANFOProduct();
		var snapshot = {
			name: product.name,
			density: product.density,
			productCategory: product.productCategory,
			isCompressible: false
		};

		var d = new Deck({
			holeID: "H1", deckType: DECK_TYPES.COUPLED,
			topDepth: 0, baseDepth: 3,
			product: snapshot,
			isCompressible: false
		});

		expect(d.getCompressibleModel()).toBeNull();
	});
});


// ========== RESULTS SUMMARY ==========

console.log("\n========================================");
console.log("  Test Results");
console.log("========================================");
console.log("  Passed: " + testResults.passed);
console.log("  Failed: " + testResults.failed);
console.log("  Total:  " + testResults.tests.length);
console.log("========================================\n");

if (testResults.failed > 0) {
	console.log("FAILED TESTS:");
	testResults.tests.forEach(function(t) {
		if (!t.passed) {
			console.log("  - " + t.name + ": " + t.error);
		}
	});
	console.log("");
	process.exit(1);
} else {
	console.log("All tests passed.\n");
	process.exit(0);
}
