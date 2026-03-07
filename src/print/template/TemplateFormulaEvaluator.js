/**
 * @fileoverview Template formula evaluator for XLSX print templates.
 *
 * Extends the charging FormulaEvaluator concept with:
 *   - String concatenation via & operator
 *   - Aggregation functions: sum, count, avg, min, max, median, stdev, countif, sumif
 *   - Date functions: today(), now(), dateformat()
 *   - Rounding variants: round, roundup, rounddown, ceil, floor
 *   - String functions: upper, lower, trim, left, right, mid, len, text, join
 *   - Conditional: if(cond, trueVal, falseVal)
 *   - Special render tokens: legend(), northArrow, scale, logo, qrcode, mapView, connectorCount
 *
 * Formula prefix: "fx:" (same as charging formulas, compatible with Excel)
 *
 * Iteration: field[i] notation iterates over visible holes.
 *   sum(holeLength[i])  ->  sums holeLengthCalculated for every visible hole
 *
 * Returns { type: "text"|"render", value: string|object }
 */

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Check if a cell value is a template formula.
 * @param {*} value
 * @returns {boolean}
 */
export function isTemplateFormula(value) {
	if (typeof value !== "string") return false;
	if (value.length <= 3) return false;
	var prefix = value.substring(0, 3).toLowerCase();
	return prefix === "fx:";
}

/**
 * Strip the "fx:" prefix.
 * @param {string} formula
 * @returns {string}
 */
function stripPrefix(formula) {
	// Handle both "fx:" and "Fx:" / "FX:" etc.
	var lower = formula.substring(0, 3).toLowerCase();
	if (lower === "fx:") return formula.substring(3).trim();
	return formula.trim();
}

// ── Special render tokens ─────────────────────────────────────────────
// These produce image/graphic output, not text. The engine renders them
// into the merged-cell region in the XLSX/PDF.

var RENDER_PATTERN = /^(legend|northArrow|scale|scaleText|scaleBar|logo|qrcode|mapView|connectorCount|sectionView)\b/;

/**
 * Check if expression is a special render function.
 * @param {string} expr - Expression body (prefix stripped)
 * @returns {{ type: string, args: string[] }|null}
 */
function parseRenderToken(expr) {
	var m = expr.match(RENDER_PATTERN);
	if (!m) return null;

	var name = m[1];

	// Parse arguments in parentheses, e.g. legend(relief,h)
	var argStr = "";
	var parenStart = expr.indexOf("(");
	if (parenStart !== -1) {
		var parenEnd = expr.lastIndexOf(")");
		if (parenEnd > parenStart) {
			argStr = expr.substring(parenStart + 1, parenEnd).trim();
		}
	}

	var args = argStr ? argStr.split(",").map(function (a) { return a.trim().replace(/^["']|["']$/g, ""); }) : [];

	return { type: name, args: args };
}

// ── Aggregation engine ────────────────────────────────────────────────

/**
 * Extract all field[i] references from an expression.
 * @param {string} expr
 * @returns {string[]} Unique field names (without [i])
 */
function extractIteratedFields(expr) {
	var re = /([a-zA-Z_]\w*)\[i\]/g;
	var fields = [];
	var seen = {};
	var m;
	while ((m = re.exec(expr)) !== null) {
		if (!seen[m[1]]) {
			seen[m[1]] = true;
			fields.push(m[1]);
		}
	}
	return fields;
}

/**
 * Resolve a field name to its blast-hole property accessor.
 * Maps short names to actual hole data model properties.
 */
var FIELD_ALIASES = {
	holeLength: "holeLengthCalculated",
	holeDiameter: "holeDiameter",
	holeAngle: "holeAngle",
	holeBearing: "holeBearing",
	holeType: "holeType",
	holeID: "holeID",
	entityName: "entityName",
	startX: "startXLocation",
	startY: "startYLocation",
	startZ: "startZLocation",
	endX: "endXLocation",
	endY: "endYLocation",
	endZ: "endZLocation",
	gradeX: "gradeXLocation",
	gradeY: "gradeYLocation",
	gradeZ: "gradeZLocation",
	benchHeight: "benchHeight",
	subdrillAmount: "subdrillAmount",
	subdrillLength: "subdrillLength",
	burden: "burden",
	spacing: "spacing",
	diameter: "holeDiameter",
	angle: "holeAngle",
	bearing: "holeBearing",
	measuredMass: "measuredMass",
	measuredLength: "measuredLength",
	measuredComment: "measuredComment",
	timingDelay: "timingDelayMilliseconds",
	holeTime: "timingDelayMilliseconds",
	rowID: "rowID",
	posID: "posID",
	color: "colorHexDecimal",
	fromHoleID: "fromHoleID",
	connectorCurve: "connectorCurve",
	visible: "visible",
	// Full property names also work
	holeLengthCalculated: "holeLengthCalculated",
	startXLocation: "startXLocation",
	startYLocation: "startYLocation",
	startZLocation: "startZLocation",
	endXLocation: "endXLocation",
	endYLocation: "endYLocation",
	endZLocation: "endZLocation",
	gradeXLocation: "gradeXLocation",
	gradeYLocation: "gradeYLocation",
	gradeZLocation: "gradeZLocation",
	timingDelayMilliseconds: "timingDelayMilliseconds",
	colorHexDecimal: "colorHexDecimal"
};

/**
 * Get field values from visible holes.
 * @param {string} fieldName - Short or full property name
 * @param {Object[]} holes - Array of blast hole objects
 * @returns {Array} Values (numbers or strings)
 */
function getFieldValues(fieldName, holes) {
	var prop = FIELD_ALIASES[fieldName] || fieldName;
	var values = [];
	for (var i = 0; i < holes.length; i++) {
		var h = holes[i];
		var val = h[prop];
		// For charging-derived fields, look in loadedCharging
		if (val === undefined && fieldName === "totalMass") {
			val = getChargingField(h, "totalMass");
		} else if (val === undefined && fieldName === "deckCount") {
			val = getChargingField(h, "deckCount");
		} else if (val === undefined && fieldName === "stemLength") {
			val = getChargingField(h, "stemLength");
		} else if (val === undefined && fieldName === "chargeLength") {
			val = getChargingField(h, "chargeLength");
		}
		if (val !== undefined && val !== null) {
			values.push(val);
		}
	}
	return values;
}

/**
 * Get a charging-derived field for a hole.
 * @param {Object} hole
 * @param {string} field
 * @returns {number|undefined}
 */
function getChargingField(hole, field) {
	if (!window.loadedCharging) return undefined;
	var key = (hole.entityName || "") + ":::" + (hole.holeID || "");
	var hc = window.loadedCharging.get(key);
	if (!hc) return undefined;

	if (field === "totalMass") {
		return typeof hc.getTotalMass === "function" ? hc.getTotalMass() : undefined;
	}
	if (field === "deckCount") {
		return hc.decks ? hc.decks.length : 0;
	}
	if (field === "stemLength") {
		return typeof hc.getStemLength === "function" ? hc.getStemLength() : undefined;
	}
	if (field === "chargeLength") {
		return typeof hc.getChargeLength === "function" ? hc.getChargeLength() : undefined;
	}
	return undefined;
}

// ── Built-in functions ────────────────────────────────────────────────

/**
 * Build the function library available inside template formulas.
 * @param {Object[]} visibleHoles - Filtered visible holes
 * @param {Object} scalarVars - Scalar template variables
 * @returns {Object} Map of function names to implementations
 */
function buildFunctionLibrary(visibleHoles, scalarVars) {
	var fns = {};

	// ── Aggregation ──

	fns.sum = function (fieldOrArray) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var total = 0;
		for (var i = 0; i < vals.length; i++) {
			var n = parseFloat(vals[i]);
			if (!isNaN(n)) total += n;
		}
		return total;
	};

	fns.count = function (fieldOrArray) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		return vals.length;
	};

	fns.avg = function (fieldOrArray) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		if (vals.length === 0) return 0;
		var total = 0;
		var ct = 0;
		for (var i = 0; i < vals.length; i++) {
			var n = parseFloat(vals[i]);
			if (!isNaN(n)) { total += n; ct++; }
		}
		return ct > 0 ? total / ct : 0;
	};

	fns.median = function (fieldOrArray) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var nums = [];
		for (var i = 0; i < vals.length; i++) {
			var n = parseFloat(vals[i]);
			if (!isNaN(n)) nums.push(n);
		}
		if (nums.length === 0) return 0;
		nums.sort(function (a, b) { return a - b; });
		var mid = Math.floor(nums.length / 2);
		return nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
	};

	fns.stdev = function (fieldOrArray) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var nums = [];
		for (var i = 0; i < vals.length; i++) {
			var n = parseFloat(vals[i]);
			if (!isNaN(n)) nums.push(n);
		}
		if (nums.length < 2) return 0;
		var mean = nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
		var variance = nums.reduce(function (a, v) { return a + (v - mean) * (v - mean); }, 0) / (nums.length - 1);
		return Math.sqrt(variance);
	};

	fns.unique = function (fieldOrArray) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var seen = {};
		var ct = 0;
		for (var i = 0; i < vals.length; i++) {
			var k = String(vals[i]);
			if (!seen[k]) { seen[k] = true; ct++; }
		}
		return ct;
	};

	fns.countif = function (fieldOrArray, condition) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var ct = 0;
		for (var i = 0; i < vals.length; i++) {
			if (String(vals[i]) === String(condition)) ct++;
		}
		return ct;
	};

	fns.sumif = function (sumField, condField, condition) {
		if (!Array.isArray(sumField) || !Array.isArray(condField)) return 0;
		var total = 0;
		for (var i = 0; i < sumField.length; i++) {
			if (i < condField.length && String(condField[i]) === String(condition)) {
				var n = parseFloat(sumField[i]);
				if (!isNaN(n)) total += n;
			}
		}
		return total;
	};

	fns.join = function (fieldOrArray, separator) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var sep = separator !== undefined ? String(separator) : ", ";
		return vals.join(sep);
	};

	fns.uniqueList = function (fieldOrArray, separator) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var sep = separator !== undefined ? String(separator) : ", ";
		var seen = {};
		var result = [];
		for (var i = 0; i < vals.length; i++) {
			var k = String(vals[i]);
			if (!seen[k]) { seen[k] = true; result.push(k); }
		}
		return result.join(sep);
	};

	/**
	 * sortCount(field[i]) - Count occurrences of each unique value, sorted by count descending.
	 * Returns formatted string: "Production: 85, Presplit: 42, Buffer: 15"
	 * sortCount(field[i], "\n") - newline separated
	 * sortCount(field[i], sep, limit) - limit number of groups
	 */
	fns.sortCount = function (fieldOrArray, separator, limit) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var sep = separator !== undefined ? String(separator) : ", ";
		var lim = limit ? parseInt(limit) : 0;

		// Count occurrences
		var counts = {};
		for (var i = 0; i < vals.length; i++) {
			var k = String(vals[i]);
			counts[k] = (counts[k] || 0) + 1;
		}

		// Sort by count descending
		var sorted = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
		if (lim > 0) sorted = sorted.slice(0, lim);

		return sorted.map(function (k) { return k + ": " + counts[k]; }).join(sep);
	};

	/**
	 * connectorList(separator) - List all connector delay groups with counts.
	 * Returns: "25ms x 42, 42ms x 38, 67ms x 12"
	 * Uses fromHoleID to identify actual connectors (not all holes).
	 */
	fns.connectorList = function (separator) {
		var sep = separator !== undefined ? String(separator) : ", ";
		var groups = {};

		for (var i = 0; i < visibleHoles.length; i++) {
			var h = visibleHoles[i];
			if (!h.fromHoleID) continue;
			var parts = h.fromHoleID.split(":::");
			if (parts.length !== 2) continue;
			var selfKey = (h.entityName || "") + ":::" + (h.holeID || "");
			if (h.fromHoleID === selfKey) continue;

			var delay = h.timingDelayMilliseconds !== undefined && h.timingDelayMilliseconds !== null
				? h.timingDelayMilliseconds : "Unknown";
			groups[delay] = (groups[delay] || 0) + 1;
		}

		var sorted = Object.keys(groups).sort(function (a, b) {
			if (a === "Unknown") return 1;
			if (b === "Unknown") return -1;
			return parseFloat(a) - parseFloat(b);
		});

		return sorted.map(function (d) {
			return (d === "Unknown" ? "Unknown" : d + "ms") + " x " + groups[d];
		}).join(sep);
	};

	/**
	 * connectorCount(delay) - Count connectors of a specific delay.
	 * connectorCount() - Total connector count.
	 */
	fns.connectorCount = function (delay) {
		var total = 0;
		for (var i = 0; i < visibleHoles.length; i++) {
			var h = visibleHoles[i];
			if (!h.fromHoleID) continue;
			var parts = h.fromHoleID.split(":::");
			if (parts.length !== 2) continue;
			var selfKey = (h.entityName || "") + ":::" + (h.holeID || "");
			if (h.fromHoleID === selfKey) continue;

			if (delay !== undefined) {
				if (String(h.timingDelayMilliseconds) === String(delay)) total++;
			} else {
				total++;
			}
		}
		return total;
	};

	/**
	 * productList(separator) - List all charged products with total mass.
	 * Returns: "ANFO Heavy: 2450.0kg, Emulsion: 1800.5kg"
	 */
	fns.productList = function (separator) {
		var sep = separator !== undefined ? String(separator) : ", ";
		var products = {};

		if (window.loadedCharging) {
			for (var i = 0; i < visibleHoles.length; i++) {
				var h = visibleHoles[i];
				var key = (h.entityName || "") + ":::" + (h.holeID || "");
				var hc = window.loadedCharging.get(key);
				if (!hc || !hc.decks) continue;

				for (var d = 0; d < hc.decks.length; d++) {
					var deck = hc.decks[d];
					if (deck.product && deck.product.name) {
						var pName = deck.product.name;
						var mass = typeof deck.calculateMass === "function" ? (deck.calculateMass() || 0) : 0;
						if (!products[pName]) products[pName] = 0;
						products[pName] += mass;
					}
				}
			}
		}

		var sorted = Object.keys(products).sort(function (a, b) { return products[b] - products[a]; });
		return sorted.map(function (p) {
			return p + ": " + products[p].toFixed(1) + "kg";
		}).join(sep);
	};

	/**
	 * productMass(productName) - Total mass (kg) of a specific product across all visible holes.
	 */
	fns.productMass = function (productName) {
		var total = 0;
		if (window.loadedCharging) {
			for (var i = 0; i < visibleHoles.length; i++) {
				var h = visibleHoles[i];
				var key = (h.entityName || "") + ":::" + (h.holeID || "");
				var hc = window.loadedCharging.get(key);
				if (!hc || !hc.decks) continue;

				for (var d = 0; d < hc.decks.length; d++) {
					var deck = hc.decks[d];
					if (deck.product && deck.product.name === String(productName)) {
						total += typeof deck.calculateMass === "function" ? (deck.calculateMass() || 0) : 0;
					}
				}
			}
		}
		return total;
	};

	/**
	 * productCount(productName) - Count of holes using a specific product.
	 * productCount() - Count of unique product names.
	 */
	fns.productCount = function (productName) {
		var seen = {};
		var ct = 0;

		if (window.loadedCharging) {
			for (var i = 0; i < visibleHoles.length; i++) {
				var h = visibleHoles[i];
				var key = (h.entityName || "") + ":::" + (h.holeID || "");
				var hc = window.loadedCharging.get(key);
				if (!hc || !hc.decks) continue;

				for (var d = 0; d < hc.decks.length; d++) {
					var deck = hc.decks[d];
					if (deck.product && deck.product.name) {
						if (productName !== undefined) {
							if (deck.product.name === String(productName)) { ct++; break; }
						} else {
							seen[deck.product.name] = true;
						}
					}
				}
			}
		}
		return productName !== undefined ? ct : Object.keys(seen).length;
	};

	/**
	 * groupCount(field[i]) - Group values and return count per group as object.
	 * Useful for building tables: groupCount(holeType[i])
	 * Returns formatted string: "Production: 85\nPresplit: 42\nBuffer: 15"
	 * groupCount(field[i], sep) - custom separator
	 * groupCount(field[i], sep, "asc"|"desc"|"alpha") - sort order
	 */
	fns.groupCount = function (fieldOrArray, separator, sortOrder) {
		var vals = Array.isArray(fieldOrArray) ? fieldOrArray : [fieldOrArray];
		var sep = separator !== undefined ? String(separator) : "\n";
		var order = sortOrder ? String(sortOrder).toLowerCase() : "desc";

		var counts = {};
		for (var i = 0; i < vals.length; i++) {
			var k = String(vals[i]);
			counts[k] = (counts[k] || 0) + 1;
		}

		var keys = Object.keys(counts);
		if (order === "alpha") {
			keys.sort();
		} else if (order === "asc") {
			keys.sort(function (a, b) { return counts[a] - counts[b]; });
		} else {
			// desc (default)
			keys.sort(function (a, b) { return counts[b] - counts[a]; });
		}

		return keys.map(function (k) { return k + ": " + counts[k]; }).join(sep);
	};

	/**
	 * groupSum(sumField[i], groupField[i]) - Sum a numeric field grouped by another field.
	 * Returns: "Production: 1234.5\nPresplit: 678.9"
	 * groupSum(sumField[i], groupField[i], sep, sortOrder)
	 */
	fns.groupSum = function (sumFieldOrArray, groupFieldOrArray, separator, sortOrder) {
		var sums = Array.isArray(sumFieldOrArray) ? sumFieldOrArray : [sumFieldOrArray];
		var groups = Array.isArray(groupFieldOrArray) ? groupFieldOrArray : [groupFieldOrArray];
		var sep = separator !== undefined ? String(separator) : "\n";
		var order = sortOrder ? String(sortOrder).toLowerCase() : "desc";

		var totals = {};
		var len = Math.min(sums.length, groups.length);
		for (var i = 0; i < len; i++) {
			var k = String(groups[i]);
			var n = parseFloat(sums[i]);
			if (!isNaN(n)) {
				totals[k] = (totals[k] || 0) + n;
			}
		}

		var keys = Object.keys(totals);
		if (order === "alpha") {
			keys.sort();
		} else if (order === "asc") {
			keys.sort(function (a, b) { return totals[a] - totals[b]; });
		} else {
			keys.sort(function (a, b) { return totals[b] - totals[a]; });
		}

		return keys.map(function (k) { return k + ": " + totals[k].toFixed(1); }).join(sep);
	};

	/**
	 * groupAvg(valueField[i], groupField[i], sep, sortOrder) - Average per group.
	 * Returns: "Production: 121.0\nBuffer: 89.0"
	 */
	fns.groupAvg = function (valueFieldOrArray, groupFieldOrArray, separator, sortOrder) {
		var vals = Array.isArray(valueFieldOrArray) ? valueFieldOrArray : [valueFieldOrArray];
		var groups = Array.isArray(groupFieldOrArray) ? groupFieldOrArray : [groupFieldOrArray];
		var sep = separator !== undefined ? String(separator) : "\n";
		var order = sortOrder ? String(sortOrder).toLowerCase() : "desc";

		var sums = {};
		var counts = {};
		var len = Math.min(vals.length, groups.length);
		for (var i = 0; i < len; i++) {
			var k = String(groups[i]);
			var n = parseFloat(vals[i]);
			if (!isNaN(n)) {
				sums[k] = (sums[k] || 0) + n;
				counts[k] = (counts[k] || 0) + 1;
			}
		}

		var keys = Object.keys(sums);
		if (order === "alpha") keys.sort();
		else if (order === "asc") keys.sort(function (a, b) { return (sums[a] / counts[a]) - (sums[b] / counts[b]); });
		else keys.sort(function (a, b) { return (sums[b] / counts[b]) - (sums[a] / counts[a]); });

		return keys.map(function (k) { return k + ": " + (sums[k] / counts[k]).toFixed(1); }).join(sep);
	};

	/**
	 * groupMin(valueField[i], groupField[i], sep, sortOrder) - Min per group.
	 */
	fns.groupMin = function (valueFieldOrArray, groupFieldOrArray, separator, sortOrder) {
		var vals = Array.isArray(valueFieldOrArray) ? valueFieldOrArray : [valueFieldOrArray];
		var groups = Array.isArray(groupFieldOrArray) ? groupFieldOrArray : [groupFieldOrArray];
		var sep = separator !== undefined ? String(separator) : "\n";
		var order = sortOrder ? String(sortOrder).toLowerCase() : "alpha";

		var mins = {};
		var len = Math.min(vals.length, groups.length);
		for (var i = 0; i < len; i++) {
			var k = String(groups[i]);
			var n = parseFloat(vals[i]);
			if (!isNaN(n)) {
				if (mins[k] === undefined || n < mins[k]) mins[k] = n;
			}
		}

		var keys = Object.keys(mins);
		if (order === "alpha") keys.sort();
		else if (order === "asc") keys.sort(function (a, b) { return mins[a] - mins[b]; });
		else keys.sort(function (a, b) { return mins[b] - mins[a]; });

		return keys.map(function (k) { return k + ": " + mins[k].toFixed(1); }).join(sep);
	};

	/**
	 * groupMax(valueField[i], groupField[i], sep, sortOrder) - Max per group.
	 */
	fns.groupMax = function (valueFieldOrArray, groupFieldOrArray, separator, sortOrder) {
		var vals = Array.isArray(valueFieldOrArray) ? valueFieldOrArray : [valueFieldOrArray];
		var groups = Array.isArray(groupFieldOrArray) ? groupFieldOrArray : [groupFieldOrArray];
		var sep = separator !== undefined ? String(separator) : "\n";
		var order = sortOrder ? String(sortOrder).toLowerCase() : "alpha";

		var maxs = {};
		var len = Math.min(vals.length, groups.length);
		for (var i = 0; i < len; i++) {
			var k = String(groups[i]);
			var n = parseFloat(vals[i]);
			if (!isNaN(n)) {
				if (maxs[k] === undefined || n > maxs[k]) maxs[k] = n;
			}
		}

		var keys = Object.keys(maxs);
		if (order === "alpha") keys.sort();
		else if (order === "asc") keys.sort(function (a, b) { return maxs[a] - maxs[b]; });
		else keys.sort(function (a, b) { return maxs[b] - maxs[a]; });

		return keys.map(function (k) { return k + ": " + maxs[k].toFixed(1); }).join(sep);
	};

	/**
	 * groupTable(groupField[i], formatString, sep, sortOrder)
	 * Multi-field per-group formatting with inline aggregation tokens.
	 *
	 * Format tokens:
	 *   {key}           - group key value
	 *   {count}         - count of items in group
	 *   {sum:field}     - sum of field within group
	 *   {avg:field}     - average of field within group
	 *   {min:field}     - min of field within group
	 *   {max:field}     - max of field within group
	 *   {median:field}  - median of field within group
	 *
	 * Example:
	 *   groupTable(holeType[i], "{key}: {count} holes, dia={avg:holeDiameter}mm", "\n")
	 *   → "Production: 198 holes, dia=121.0mm\nBuffer: 42 holes, dia=89.0mm"
	 */
	fns.groupTable = function (groupFieldOrArray, formatStr, separator, sortOrder) {
		var groupVals = Array.isArray(groupFieldOrArray) ? groupFieldOrArray : [groupFieldOrArray];
		var fmt = formatStr !== undefined ? String(formatStr) : "{key}: {count}";
		var sep = separator !== undefined ? String(separator) : "\n";
		var order = sortOrder ? String(sortOrder).toLowerCase() : "desc";

		// Build per-group hole index lists
		var groupIndices = {};
		for (var i = 0; i < groupVals.length; i++) {
			var k = String(groupVals[i]);
			if (!groupIndices[k]) groupIndices[k] = [];
			groupIndices[k].push(i);
		}

		// Sort group keys
		var keys = Object.keys(groupIndices);
		if (order === "alpha") {
			keys.sort();
		} else if (order === "asc") {
			keys.sort(function (a, b) { return groupIndices[a].length - groupIndices[b].length; });
		} else {
			keys.sort(function (a, b) { return groupIndices[b].length - groupIndices[a].length; });
		}

		// Parse format tokens: {key}, {count}, {stat:fieldName}
		var tokenRegex = /\{(key|count|sum|avg|min|max|median)(?::([a-zA-Z_]\w*))?\}/g;

		return keys.map(function (groupKey) {
			var indices = groupIndices[groupKey];

			return fmt.replace(tokenRegex, function (match, stat, fieldName) {
				if (stat === "key") return groupKey;
				if (stat === "count") return String(indices.length);

				// Need field values for this group
				if (!fieldName) return match; // no field specified for stat
				var fieldVals = getFieldValues(fieldName, visibleHoles);
				var groupFieldVals = [];
				for (var j = 0; j < indices.length; j++) {
					var idx = indices[j];
					if (idx < fieldVals.length) groupFieldVals.push(fieldVals[idx]);
				}

				// Compute statistic
				var nums = [];
				for (var n = 0; n < groupFieldVals.length; n++) {
					var v = parseFloat(groupFieldVals[n]);
					if (!isNaN(v)) nums.push(v);
				}
				if (nums.length === 0) return "0";

				if (stat === "sum") {
					var total = 0;
					for (var s = 0; s < nums.length; s++) total += nums[s];
					return total.toFixed(1);
				}
				if (stat === "avg") {
					var sum = 0;
					for (var a = 0; a < nums.length; a++) sum += nums[a];
					return (sum / nums.length).toFixed(1);
				}
				if (stat === "min") {
					return Math.min.apply(null, nums).toFixed(1);
				}
				if (stat === "max") {
					return Math.max.apply(null, nums).toFixed(1);
				}
				if (stat === "median") {
					nums.sort(function (x, y) { return x - y; });
					var mid = Math.floor(nums.length / 2);
					var med = nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
					return med.toFixed(1);
				}
				return match;
			});
		}).join(sep);
	};

	// ── Math / Rounding ──

	fns.round = function (value, decimals) {
		var n = parseFloat(value);
		if (isNaN(n)) return 0;
		var d = parseInt(decimals) || 0;
		if (d >= 0) {
			var factor = Math.pow(10, d);
			return Math.round(n * factor) / factor;
		} else {
			// Negative decimals: round to nearest 10, 100, etc.
			var f2 = Math.pow(10, -d);
			return Math.round(n / f2) * f2;
		}
	};

	fns.roundup = function (value, decimals) {
		var n = parseFloat(value);
		if (isNaN(n)) return 0;
		var d = parseInt(decimals) || 0;
		if (d >= 0) {
			var factor = Math.pow(10, d);
			return Math.ceil(n * factor) / factor;
		} else {
			var f2 = Math.pow(10, -d);
			return Math.ceil(n / f2) * f2;
		}
	};

	fns.rounddown = function (value, decimals) {
		var n = parseFloat(value);
		if (isNaN(n)) return 0;
		var d = parseInt(decimals) || 0;
		if (d >= 0) {
			var factor = Math.pow(10, d);
			return Math.floor(n * factor) / factor;
		} else {
			var f2 = Math.pow(10, -d);
			return Math.floor(n / f2) * f2;
		}
	};

	fns.ceil = Math.ceil;
	fns.floor = Math.floor;
	fns.abs = Math.abs;
	fns.sqrt = Math.sqrt;
	fns.pow = Math.pow;
	fns.pi = function () { return Math.PI; };
	fns.log = Math.log;
	fns.log10 = Math.log10;

	fns.min = function () {
		var args = arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
		var nums = [];
		for (var i = 0; i < args.length; i++) {
			var n = parseFloat(args[i]);
			if (!isNaN(n)) nums.push(n);
		}
		return nums.length > 0 ? Math.min.apply(null, nums) : 0;
	};

	fns.max = function () {
		var args = arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
		var nums = [];
		for (var i = 0; i < args.length; i++) {
			var n = parseFloat(args[i]);
			if (!isNaN(n)) nums.push(n);
		}
		return nums.length > 0 ? Math.max.apply(null, nums) : 0;
	};

	// ── Date functions ──

	fns.today = function (offset) {
		var d = new Date();
		if (offset) d.setDate(d.getDate() + parseInt(offset));
		return d.toLocaleDateString("en-AU");
	};

	fns.now = function () {
		return new Date().toLocaleString("en-AU");
	};

	fns.dateformat = function (format) {
		var d = new Date();
		if (!format) return d.toLocaleDateString("en-AU");
		// Simple format tokens: YYYY, MM, DD, hh, mm, ss
		var yyyy = d.getFullYear();
		var MM = String(d.getMonth() + 1).padStart(2, "0");
		var dd = String(d.getDate()).padStart(2, "0");
		var hh = String(d.getHours()).padStart(2, "0");
		var mn = String(d.getMinutes()).padStart(2, "0");
		var ss = String(d.getSeconds()).padStart(2, "0");
		return String(format)
			.replace("YYYY", yyyy).replace("yyyy", yyyy)
			.replace("MM", MM)
			.replace("DD", dd).replace("dd", dd)
			.replace("hh", hh).replace("HH", hh)
			.replace("mm", mn)
			.replace("ss", ss);
	};

	// ── String functions ──

	fns.upper = function (text) { return String(text).toUpperCase(); };
	fns.lower = function (text) { return String(text).toLowerCase(); };
	fns.trim = function (text) { return String(text).trim(); };
	fns.len = function (text) { return String(text).length; };

	fns.left = function (text, n) {
		return String(text).substring(0, parseInt(n) || 0);
	};

	fns.right = function (text, n) {
		var s = String(text);
		var ct = parseInt(n) || 0;
		return s.substring(Math.max(0, s.length - ct));
	};

	fns.mid = function (text, start, length) {
		return String(text).substring(parseInt(start) || 0, (parseInt(start) || 0) + (parseInt(length) || 0));
	};

	fns.text = function (value, format) {
		var n = parseFloat(value);
		if (isNaN(n)) return String(value);
		if (!format) return String(n);
		// Simple format: "0.00" = 2 decimals, "0.0" = 1 decimal, "0" = integer
		var dotPos = String(format).indexOf(".");
		if (dotPos >= 0) {
			var decimals = String(format).length - dotPos - 1;
			return n.toFixed(decimals);
		}
		return String(Math.round(n));
	};

	fns.fixed = function (value, decimals) {
		var n = parseFloat(value);
		if (isNaN(n)) return "0";
		return n.toFixed(parseInt(decimals) || 0);
	};

	// ── Conditional ──

	fns.$$if = function (condition, trueVal, falseVal) {
		return condition ? trueVal : falseVal;
	};

	fns.isnumber = function (value) {
		return typeof value === "number" && isFinite(value);
	};

	fns.isblank = function (value) {
		return value === null || value === undefined || value === "";
	};

	return fns;
}

// ── Expression compiler ───────────────────────────────────────────────

/**
 * Pre-process a template expression:
 *  1. Replace & with + for string concat (after quoting strings)
 *  2. Replace field[i] references with array lookups __field_fieldName
 *  3. Inject function library names
 *
 * @param {string} expr - Raw expression body
 * @param {string[]} iteratedFields - Fields that use [i] notation
 * @returns {string} JavaScript-safe expression
 */
function compileExpression(expr, iteratedFields) {
	var compiled = expr;

	// Replace field[i] with __field_fieldName for aggregation functions
	for (var i = 0; i < iteratedFields.length; i++) {
		var field = iteratedFields[i];
		var re = new RegExp(escapeRegExp(field) + "\\[i\\]", "g");
		compiled = compiled.replace(re, "__field_" + field);
	}

	// Replace & with + for string concatenation (JS uses + for both)
	// Only replace & that is NOT part of && (logical AND)
	compiled = compiled.replace(/(?<![&])&(?![&])/g, "+");

	// Replace JS reserved words used as function names: if() → $$if()
	// $$ prefix is valid JS and won't collide with mine blast naming conventions
	// Must use function replacer to avoid $$ being interpreted as escape in replace()
	compiled = compiled.replace(/\bif\s*\(/g, function () { return "$$if("; });

	return compiled;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Main evaluator ────────────────────────────────────────────────────

/**
 * Evaluate a template formula.
 *
 * @param {string} formula - Formula string starting with "fx:"
 * @param {Object} context - Template context from TemplateVariables.buildContext()
 *   { visibleHoles: [], scalarVars: {}, blastStats: {} }
 * @returns {{ type: "text"|"render", value: string|{ renderType: string, args: string[] } }}
 */
export function evaluateTemplateFormula(formula, context) {
	if (!isTemplateFormula(formula)) {
		return { type: "text", value: String(formula) };
	}

	var expr = stripPrefix(formula);
	if (expr.length === 0) return { type: "text", value: "" };

	// Check for special render tokens first
	var renderToken = parseRenderToken(expr);
	if (renderToken) {
		return {
			type: "render",
			value: { renderType: renderToken.type, args: renderToken.args }
		};
	}

	var visibleHoles = context.visibleHoles || [];
	var scalarVars = context.scalarVars || {};

	// Extract iterated fields
	var iteratedFields = extractIteratedFields(expr);

	// Build field arrays for iterated fields
	var fieldArrays = {};
	for (var i = 0; i < iteratedFields.length; i++) {
		fieldArrays["__field_" + iteratedFields[i]] = getFieldValues(iteratedFields[i], visibleHoles);
	}

	// Compile expression
	var compiled = compileExpression(expr, iteratedFields);

	// Build function library
	var fns = buildFunctionLibrary(visibleHoles, scalarVars);

	// Build single context object — all scalars, field arrays, and functions
	// Using with() so property names have NO restrictions (reserved words,
	// digit-starting names, special chars all work)
	var $$ctx = {};

	// Add scalar variables
	for (var key in scalarVars) {
		if (scalarVars.hasOwnProperty(key)) {
			$$ctx[key] = scalarVars[key];
		}
	}

	// Add field arrays
	for (var key in fieldArrays) {
		if (fieldArrays.hasOwnProperty(key)) {
			$$ctx[key] = fieldArrays[key];
		}
	}

	// Add functions
	for (var key in fns) {
		if (fns.hasOwnProperty(key)) {
			$$ctx[key] = fns[key];
		}
	}

	try {
		// Evaluate using with() — no strict mode so with() is allowed.
		// Property names can be anything: reserved words, digit-prefixed, etc.
		var fn = new Function("$$ctx", "with($$ctx){return(" + compiled + ")}");
		var result = fn($$ctx);

		// Convert result to string
		if (result === null || result === undefined) {
			return { type: "text", value: "" };
		}
		if (typeof result === "number") {
			if (!isFinite(result)) return { type: "text", value: "ERR" };
			return { type: "text", value: String(result) };
		}
		return { type: "text", value: String(result) };
	} catch (e) {
		console.warn("TemplateFormulaEvaluator: error evaluating '" + formula + "':", e.message);
		return { type: "text", value: "#ERR: " + e.message };
	}
}

/**
 * Batch-evaluate all formulas in a cell map.
 * @param {Object} cellMap - { "A1": "fx:...", "B2": "Hello", ... }
 * @param {Object} context - Template context
 * @returns {Object} { "A1": { type, value }, ... }
 */
export function evaluateAllCells(cellMap, context) {
	var results = {};
	for (var ref in cellMap) {
		if (cellMap.hasOwnProperty(ref)) {
			var raw = cellMap[ref];
			if (isTemplateFormula(raw)) {
				results[ref] = evaluateTemplateFormula(raw, context);
			} else {
				results[ref] = { type: "text", value: raw };
			}
		}
	}
	return results;
}
