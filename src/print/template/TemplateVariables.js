/**
 * @fileoverview Builds the variable context for template formula evaluation.
 *
 * Collects data from:
 *   - window.allBlastHoles (visible holes)
 *   - window.loadedCharging (charging data)
 *   - window.loadedSurfaces, window.loadedKADs
 *   - BlastStatistics (aggregated stats)
 *   - User input (blast name, designer, etc.)
 *
 * Returns a context object consumed by TemplateFormulaEvaluator.
 */

import { getBlastStatisticsPerEntity } from "../../helpers/BlastStatistics.js";

/**
 * Build the full template evaluation context.
 *
 * @param {Object} [options]
 * @param {string} [options.blastName] - User-entered blast name
 * @param {string} [options.designer] - User-entered designer name
 * @param {string} [options.paperSize] - Paper size string (e.g. "A3")
 * @param {string} [options.orientation] - "landscape" or "portrait"
 * @param {number} [options.scale] - Calculated print scale
 * @param {string} [options.entityFilter] - Filter to specific entity (null = all)
 * @returns {Object} Context for evaluateTemplateFormula()
 */
export function buildTemplateContext(options) {
	options = options || {};

	// Gather visible holes
	var allHoles = window.allBlastHoles || [];
	var visibleHoles = allHoles.filter(function (h) {
		if (h.visible === false) return false;
		if (options.entityFilter && h.entityName !== options.entityFilter) return false;
		return true;
	});

	// Blast statistics
	var stats = getBlastStatisticsPerEntity(visibleHoles);

	// Aggregate stats across all entities
	var totalDrill = 0;
	var totalMass = 0;
	var totalVolume = 0;
	var totalSurfaceArea = 0;
	var totalHoleCount = 0;
	var entityNames = [];

	for (var entity in stats) {
		if (stats.hasOwnProperty(entity)) {
			var s = stats[entity];
			totalDrill += s.drillMetres || 0;
			totalMass += s.expMass || 0;
			totalVolume += s.volume || 0;
			totalSurfaceArea += s.surfaceArea || 0;
			totalHoleCount += s.holeCount || 0;
			entityNames.push(entity);
		}
	}

	// Charging totals
	var chargingTotalMass = 0;
	if (window.loadedCharging) {
		window.loadedCharging.forEach(function (hc) {
			if (typeof hc.getTotalMass === "function") {
				chargingTotalMass += hc.getTotalMass() || 0;
			}
		});
	}

	// Powder factor
	var powderFactor = totalVolume > 0 ? (chargingTotalMass > 0 ? chargingTotalMass : totalMass) / totalVolume : 0;

	// Build scalar variables
	var scalarVars = {
		// User input
		blastName: options.blastName || "",
		designer: options.designer || "",
		paperSize: options.paperSize || "A3",
		orientation: options.orientation || "landscape",
		printScale: options.scale || 0,

		// Aggregates
		holeCount: totalHoleCount,
		drillMetres: totalDrill,
		totalMass: chargingTotalMass > 0 ? chargingTotalMass : totalMass,
		totalVolume: totalVolume,
		totalSurfaceArea: totalSurfaceArea,
		powderFactor: powderFactor,
		entityCount: entityNames.length,
		entityNames: entityNames.join(", "),
		entityName: entityNames.length > 0 ? entityNames[0] : "",

		// Surfaces
		surfaceCount: window.loadedSurfaces ? window.loadedSurfaces.size : 0,
		kadCount: window.loadedKADs ? window.loadedKADs.size : 0,

		// Date/time (also available via today()/now() functions)
		date: new Date().toLocaleDateString("en-AU"),
		time: new Date().toLocaleTimeString("en-AU"),
		datetime: new Date().toLocaleString("en-AU")
	};

	// Add per-entity stats as entityName_holeCount, entityName_drillMetres, etc.
	for (var entity in stats) {
		if (stats.hasOwnProperty(entity)) {
			var s = stats[entity];
			var prefix = entity.replace(/[^a-zA-Z0-9_]/g, "_");
			scalarVars[prefix + "_holeCount"] = s.holeCount;
			scalarVars[prefix + "_drillMetres"] = s.drillMetres;
			scalarVars[prefix + "_expMass"] = s.expMass;
			scalarVars[prefix + "_volume"] = s.volume;
			scalarVars[prefix + "_surfaceArea"] = s.surfaceArea;
			scalarVars[prefix + "_burden"] = s.burden;
			scalarVars[prefix + "_spacing"] = s.spacing;
			scalarVars[prefix + "_minFiringTime"] = s.minFiringTime !== null ? s.minFiringTime : 0;
			scalarVars[prefix + "_maxFiringTime"] = s.maxFiringTime !== null ? s.maxFiringTime : 0;
		}
	}

	return {
		visibleHoles: visibleHoles,
		scalarVars: scalarVars,
		blastStats: stats,
		entityNames: entityNames
	};
}

/**
 * Get the full list of available template variables for documentation / autocomplete.
 * @returns {Object[]} Array of { name, description, type, example }
 */
export function getAvailableVariables() {
	return [
		// ── Scalar variables ──
		{ name: "blastName", description: "User-entered blast name", type: "scalar", example: '"Shot 42"' },
		{ name: "designer", description: "User-entered designer name", type: "scalar", example: '"J. Smith"' },
		{ name: "date", description: "Current date", type: "scalar", example: '"6/03/2026"' },
		{ name: "time", description: "Current time", type: "scalar", example: '"14:30:00"' },
		{ name: "datetime", description: "Current date and time", type: "scalar", example: '"6/03/2026, 14:30:00"' },
		{ name: "paperSize", description: "Paper size", type: "scalar", example: '"A3"' },
		{ name: "orientation", description: "Page orientation", type: "scalar", example: '"landscape"' },
		{ name: "printScale", description: "Calculated print scale", type: "scalar", example: "500" },
		{ name: "holeCount", description: "Total visible holes", type: "scalar", example: "142" },
		{ name: "drillMetres", description: "Total drill metres", type: "scalar", example: "1927.3" },
		{ name: "totalMass", description: "Total explosive mass (kg)", type: "scalar", example: "4250.0" },
		{ name: "totalVolume", description: "Total volume (m3)", type: "scalar", example: "12500.0" },
		{ name: "powderFactor", description: "Powder factor (kg/m3)", type: "scalar", example: "0.34" },
		{ name: "entityCount", description: "Number of entities", type: "scalar", example: "2" },
		{ name: "entityNames", description: "Comma-separated entity names", type: "scalar", example: '"Pattern_01, Pattern_02"' },
		{ name: "entityName", description: "First entity name", type: "scalar", example: '"Pattern_01"' },

		// ── Iterated fields (use [i]) ──
		{ name: "holeLength[i]", description: "Hole length (m)", type: "iterated", example: "sum(holeLength[i])" },
		{ name: "holeDiameter[i]", description: "Hole diameter (mm)", type: "iterated", example: "avg(holeDiameter[i])" },
		{ name: "holeAngle[i]", description: "Hole angle from vertical (deg)", type: "iterated", example: "avg(holeAngle[i])" },
		{ name: "holeBearing[i]", description: "Hole bearing (deg)", type: "iterated", example: "avg(holeBearing[i])" },
		{ name: "benchHeight[i]", description: "Bench height (m)", type: "iterated", example: "avg(benchHeight[i])" },
		{ name: "burden[i]", description: "Burden (m)", type: "iterated", example: "avg(burden[i])" },
		{ name: "spacing[i]", description: "Spacing (m)", type: "iterated", example: "avg(spacing[i])" },
		{ name: "holeType[i]", description: "Hole type", type: "iterated", example: 'countif(holeType[i], "Production")' },
		{ name: "entityName[i]", description: "Entity name per hole", type: "iterated", example: "uniqueList(entityName[i])" },
		{ name: "measuredMass[i]", description: "Measured mass (kg)", type: "iterated", example: "sum(measuredMass[i])" },
		{ name: "measuredLength[i]", description: "Measured length (m)", type: "iterated", example: "avg(measuredLength[i])" },
		{ name: "startX[i]", description: "Collar X (easting)", type: "iterated", example: "min(startX[i])" },
		{ name: "startY[i]", description: "Collar Y (northing)", type: "iterated", example: "max(startY[i])" },
		{ name: "startZ[i]", description: "Collar Z (elevation)", type: "iterated", example: "avg(startZ[i])" },
		{ name: "totalMass[i]", description: "Charging total mass per hole", type: "iterated", example: "sum(totalMass[i])" },
		{ name: "deckCount[i]", description: "Deck count per hole", type: "iterated", example: "avg(deckCount[i])" },

		// ── Aggregation functions ──
		{ name: "sum(field[i])", description: "Sum of field across visible holes", type: "function", example: "sum(holeLength[i])" },
		{ name: "count(field[i])", description: "Count of non-null values", type: "function", example: "count(holeID[i])" },
		{ name: "avg(field[i])", description: "Average", type: "function", example: "avg(holeDiameter[i])" },
		{ name: "min(field[i])", description: "Minimum", type: "function", example: "min(startZ[i])" },
		{ name: "max(field[i])", description: "Maximum", type: "function", example: "max(startZ[i])" },
		{ name: "median(field[i])", description: "Median", type: "function", example: "median(holeLength[i])" },
		{ name: "stdev(field[i])", description: "Standard deviation", type: "function", example: "stdev(holeLength[i])" },
		{ name: "countif(field[i], val)", description: "Count where field equals val", type: "function", example: 'countif(holeType[i], "Production")' },
		{ name: "sumif(sumF[i], condF[i], val)", description: "Sum where condition field equals val", type: "function", example: 'sumif(holeLength[i], holeType[i], "Production")' },
		{ name: "join(field[i], sep)", description: "Join values as string", type: "function", example: 'join(holeID[i], ", ")' },
		{ name: "uniqueList(field[i], sep)", description: "Join unique values", type: "function", example: "uniqueList(entityName[i])" },

		// ── Math / Rounding ──
		{ name: "round(value, n)", description: "Round to n decimals (neg n = tens/hundreds)", type: "function", example: "round(1927.35, 1) = 1927.4" },
		{ name: "roundup(value, n)", description: "Round up (ceiling)", type: "function", example: "roundup(1927.31, 1) = 1927.4" },
		{ name: "rounddown(value, n)", description: "Round down (floor)", type: "function", example: "rounddown(1927.39, 1) = 1927.3" },
		{ name: "ceil(value)", description: "Ceiling (round up to integer)", type: "function", example: "ceil(12.1) = 13" },
		{ name: "floor(value)", description: "Floor (round down to integer)", type: "function", example: "floor(12.9) = 12" },
		{ name: "abs(value)", description: "Absolute value", type: "function", example: "abs(-5) = 5" },
		{ name: "sqrt(value)", description: "Square root", type: "function", example: "sqrt(9) = 3" },
		{ name: "pow(base, exp)", description: "Power", type: "function", example: "pow(2, 3) = 8" },
		{ name: "pi()", description: "Pi constant", type: "function", example: "pi() = 3.14159..." },

		// ── Date functions ──
		{ name: "today()", description: "Today's date", type: "function", example: '"6/03/2026"' },
		{ name: "today(offset)", description: "Today +/- days", type: "function", example: "today(-1) = yesterday" },
		{ name: "now()", description: "Current date and time", type: "function", example: '"6/03/2026, 14:30:00"' },
		{ name: "dateformat(fmt)", description: "Formatted date (YYYY,MM,DD,hh,mm,ss)", type: "function", example: 'dateformat("DD/MM/YYYY")' },

		// ── String functions ──
		{ name: "&", description: "String concatenation", type: "operator", example: '"Total: " & sum(holeLength[i]) & "m"' },
		{ name: "upper(text)", description: "Uppercase", type: "function", example: 'upper("hello") = "HELLO"' },
		{ name: "lower(text)", description: "Lowercase", type: "function", example: 'lower("HELLO") = "hello"' },
		{ name: "trim(text)", description: "Trim whitespace", type: "function", example: "trim(entityName)" },
		{ name: "left(text, n)", description: "Left N characters", type: "function", example: 'left("Hello", 3) = "Hel"' },
		{ name: "right(text, n)", description: "Right N characters", type: "function", example: 'right("Hello", 3) = "llo"' },
		{ name: "len(text)", description: "String length", type: "function", example: 'len("Hello") = 5' },
		{ name: "text(value, fmt)", description: "Format number", type: "function", example: 'text(3.14, "0.0") = "3.1"' },
		{ name: "fixed(value, n)", description: "Fixed decimals", type: "function", example: 'fixed(3.14, 1) = "3.1"' },
		{ name: 'if(cond, true, false)', description: "Conditional", type: "function", example: 'if(holeCount > 100, "Large", "Small")' },

		// ── Group / Count / Sort ──
		{ name: "sortCount(field[i], sep, limit)", description: "Count per unique value, sorted by count desc", type: "function", example: 'sortCount(holeType[i], ", ")' },
		{ name: "groupCount(field[i], sep, order)", description: "Group and count (order: desc/asc/alpha)", type: "function", example: 'groupCount(holeType[i], "\\n", "desc")' },
		{ name: "groupSum(sumF[i], grpF[i], sep)", description: "Sum grouped by another field", type: "function", example: 'groupSum(holeLength[i], entityName[i], "\\n")' },
		{ name: "groupAvg(valF[i], grpF[i], sep)", description: "Average grouped by another field", type: "function", example: 'groupAvg(holeDiameter[i], holeType[i], "\\n")' },
		{ name: "groupMin(valF[i], grpF[i], sep)", description: "Min grouped by another field", type: "function", example: 'groupMin(holeLength[i], holeType[i], "\\n")' },
		{ name: "groupMax(valF[i], grpF[i], sep)", description: "Max grouped by another field", type: "function", example: 'groupMax(startZ[i], holeType[i], "\\n")' },
		{ name: "groupTable(grpF[i], fmt, sep)", description: "Multi-field per-group format. Tokens: {key} {count} {sum:f} {avg:f} {min:f} {max:f} {median:f}", type: "function", example: 'groupTable(holeType[i], "{key}: {count} holes, dia={avg:holeDiameter}mm", "\\n")' },

		// ── Connector functions ──
		{ name: "connectorList(sep)", description: "List connector delays with counts", type: "function", example: 'connectorList(", ")' },
		{ name: "connectorCount(delay)", description: "Count connectors (optional: specific delay)", type: "function", example: "connectorCount(25)" },

		// ── Product / Charging functions ──
		{ name: "productList(sep)", description: "List products with total mass", type: "function", example: 'productList(", ")' },
		{ name: "productMass(name)", description: "Total mass of a specific product", type: "function", example: 'productMass("ANFO Heavy")' },
		{ name: "productCount(name)", description: "Count holes using product (or unique product count)", type: "function", example: "productCount()" },

		// ── Special render functions (produce graphics, not text) ──
		{ name: "legend(type, orient)", description: "Legend graphic", type: "render", example: "legend(relief, h)" },
		{ name: "northArrow", description: "North arrow graphic", type: "render", example: "northArrow" },
		{ name: "scale", description: "Scale bar + text (combined)", type: "render", example: "scale" },
		{ name: "scaleBar", description: "Scale bar graphic only", type: "render", example: "scaleBar" },
		{ name: "scaleText", description: "Scale text only (1:XXXX)", type: "render", example: "scaleText" },
		{ name: "logo", description: "User logo image", type: "render", example: "logo" },
		{ name: "qrcode", description: "QR code graphic", type: "render", example: "qrcode" },
		{ name: "mapView", description: "Map view — default raster", type: "render", example: "mapView" },
		{ name: "mapView(r)", description: "Raster map view (holes + surfaces + images)", type: "render", example: "mapView(r)" },
		{ name: "mapView(r, dpi)", description: "Raster with custom DPI (default 200)", type: "render", example: "mapView(r, 300)" },
		{ name: "mapView(v)", description: "Vector map view (holes + connectors, crisp lines)", type: "render", example: "mapView(v)" },
		{ name: "mapView(v, pt)", description: "Vector with label font size in points", type: "render", example: "mapView(v, 8pt)" },
		{ name: "connectorCount", description: "Connector count table (render)", type: "render", example: "connectorCount" },
		{ name: "sectionView(entity, holeID)", description: "Hole section view (entityName, holeID)", type: "render", example: 'sectionView("Pattern_01", "H001")' }
	];
}
