// src/fileIO/TextIO/CustomBlastHoleTextWriter.js
//=============================================================
// CUSTOM BLAST HOLE TEXT WRITER
//=============================================================
// Step 1) Writes blast hole data to CSV files with user-defined column ordering
// Step 2) Created: 2026-01-04
// Step 3) Supports custom field selection, unit conversions, custom headers, and custom text fields
// Step 4) Companion to CustomBlastHoleTextParser.js

import BaseWriter from "../BaseWriter.js";
import { chargingKey } from "../../charging/HoleCharging.js";

// Step 5) CustomBlastHoleTextWriter class
class CustomBlastHoleTextWriter extends BaseWriter {
	constructor(options = {}) {
		super(options);

		// Step 6) Writer configuration
		this.columnOrder = options.columnOrder || ["holeID", "startXLocation", "startYLocation", "startZLocation"]; // Array of field names
		this.subdrillNegative = options.subdrillNegative || false; // Convert subdrill to negative values
		this.diameterUnit = options.diameterUnit || "mm"; // "mm", "m", "in"
		this.includeHeaders = options.includeHeaders !== false; // Default true
		this.decimalPlaces = options.decimalPlaces || 4;
		this.customHeaders = options.customHeaders || {}; // Map of column name to custom header text
		this.customFields = options.customFields || []; // Array of {enabled, name, value}

		// Step 7) Get field mapping from parser (shared schema)
		this.HOLE_FIELD_MAPPING = options.fieldMapping || this.getDefaultFieldMapping();
	}

	// Step 8) Get default field mapping (minimal version - full version in parser)
	getDefaultFieldMapping() {
		return {
			entityName: { property: "entityName", type: "string", default: "Imported_Blast" },
			holeID: { property: "holeID", type: "string", default: "" },
			startXLocation: { property: "startXLocation", type: "number", default: 0 },
			startYLocation: { property: "startYLocation", type: "number", default: 0 },
			startZLocation: { property: "startZLocation", type: "number", default: 0 },
			endXLocation: { property: "endXLocation", type: "number", default: 0 },
			endYLocation: { property: "endYLocation", type: "number", default: 0 },
			endZLocation: { property: "endZLocation", type: "number", default: 0 },
			gradeXLocation: { property: "gradeXLocation", type: "number", default: 0 },
			gradeYLocation: { property: "gradeYLocation", type: "number", default: 0 },
			gradeZLocation: { property: "gradeZLocation", type: "number", default: 0 },
			holeAngle: { property: "holeAngle", type: "number", default: 0 },
			holeBearing: { property: "holeBearing", type: "number", default: 0 },
			holeLengthCalculated: { property: "holeLengthCalculated", type: "number", default: 0 },
			holeDiameter: { property: "holeDiameter", type: "number", default: 0 },
			holeType: { property: "holeType", type: "string", default: "Production" },
			subdrillAmount: { property: "subdrillAmount", type: "number", default: 0 },
			benchHeight: { property: "benchHeight", type: "number", default: 10 },
			fromHoleID: { property: "fromHoleID", type: "string", default: "" },
			timingDelayMilliseconds: { property: "timingDelayMilliseconds", type: "number", default: 0 },
			holeTime: { property: "holeTime", type: "number", default: 0 },
			colorHexDecimal: { property: "colorHexDecimal", type: "string", default: "red" },
			rowID: { property: "rowID", type: "string", default: "" },
			posID: { property: "posID", type: "string", default: "" },
			burden: { property: "burden", type: "number", default: 0 },
			spacing: { property: "spacing", type: "number", default: 0 },
			measuredLength: { property: "measuredLength", type: "number", default: 0 },
			measuredLengthTimeStamp: { property: "measuredLengthTimeStamp", type: "string", default: "09/05/1975 00:00:00" },
			measuredMass: { property: "measuredMass", type: "number", default: 0 },
			measuredMassTimeStamp: { property: "measuredMassTimeStamp", type: "string", default: "09/05/1975 00:00:00" },
			measuredComment: { property: "measuredComment", type: "string", default: "None" },
			measuredCommentTimeStamp: { property: "measuredCommentTimeStamp", type: "string", default: "09/05/1975 00:00:00" },
			// Charging-derived fields
			designExplosiveMassKg: { property: "designExplosiveMassKg", type: "derived", default: "" },
			designExplosiveMassPerDeck: { property: "designExplosiveMassPerDeck", type: "derived", default: "" },
			designPrimerMassKg: { property: "designPrimerMassKg", type: "derived", default: "" },
			designPrimerMassPerDeck: { property: "designPrimerMassPerDeck", type: "derived", default: "" },
			designDetonatorCount: { property: "designDetonatorCount", type: "derived", default: "" },
			designDetonatorCountPerDeck: { property: "designDetonatorCountPerDeck", type: "derived", default: "" },
			designLengthPerDeck: { property: "designLengthPerDeck", type: "derived", default: "" },
			designStemmingLengthM: { property: "designStemmingLengthM", type: "derived", default: "" },
			designStemmingMassKg: { property: "designStemmingMassKg", type: "derived", default: "" },
			designStemmingLengthPerDeck: { property: "designStemmingLengthPerDeck", type: "derived", default: "" },
			designStemmingMassPerDeck: { property: "designStemmingMassPerDeck", type: "derived", default: "" },
			designAirLengthM: { property: "designAirLengthM", type: "derived", default: "" },
			designAirLengthPerDeck: { property: "designAirLengthPerDeck", type: "derived", default: "" },
			designWaterLengthM: { property: "designWaterLengthM", type: "derived", default: "" },
			designWaterMassKg: { property: "designWaterMassKg", type: "derived", default: "" },
			designWaterLengthPerDeck: { property: "designWaterLengthPerDeck", type: "derived", default: "" },
			designWaterMassPerDeck: { property: "designWaterMassPerDeck", type: "derived", default: "" }
		};
	}

	// Step 9) Main write method
	async write(data) {
		// Step 10) Validate input data
		if (!data || !Array.isArray(data.holes)) {
			throw new Error("Invalid data: holes array required");
		}

		// Step 11) Filter visible holes using base class helper
		var visibleHoles = this.filterVisibleHoles(data.holes);

		if (visibleHoles.length === 0) {
			throw new Error("No visible holes to export");
		}

		// Step 12) Generate CSV content
		var csv = "";

		// Step 13) Generate header row if enabled
		if (this.includeHeaders) {
			csv += this.generateHeaders();
		}

		// Step 14) Generate data rows
		for (var i = 0; i < visibleHoles.length; i++) {
			csv += this.generateRow(visibleHoles[i]);
		}

		// Step 15) Create and return blob
		return this.createBlob(csv, "text/csv");
	}

	// Step 16) Generate header row from column order
	generateHeaders() {
		var headers = [];

		// Step 17) Add each column name to header array (use custom header if available)
		for (var i = 0; i < this.columnOrder.length; i++) {
			var fieldName = this.columnOrder[i];

			// Step 17a) Check if this is a custom field
			if (fieldName.startsWith("customField")) {
				var fieldIndex = parseInt(fieldName.replace("customField", ""));
				var customField = this.customFields[fieldIndex];
				if (customField && customField.name) {
					headers.push(customField.name);
				} else {
					headers.push(fieldName);
				}
			} else {
				// Step 17b) Use custom header if provided, otherwise use field name
				var headerName = this.customHeaders[fieldName] || fieldName;
				headers.push(headerName);
			}
		}

		// Step 18) Join with commas and add newline
		return headers.join(",") + "\n";
	}

	// Step 19) Generate single data row for a hole
	generateRow(hole) {
		var values = [];

		// Step 20) Extract each field value in column order
		for (var i = 0; i < this.columnOrder.length; i++) {
			var fieldName = this.columnOrder[i];
			var value = this.extractFieldValue(hole, fieldName);
			values.push(this.formatValue(value, fieldName));
		}

		// Step 21) Join with commas and add newline
		return values.join(",") + "\n";
	}

	// Step 22) Extract field value from hole object
	extractFieldValue(hole, fieldName) {
		// Step 23) Handle custom fields
		if (fieldName.startsWith("customField")) {
			var fieldIndex = parseInt(fieldName.replace("customField", ""));
			var customField = this.customFields[fieldIndex];
			if (customField && customField.value) {
				return customField.value;
			}
			return "";
		}

		// Step 24) Handle calculated holeDip field (Dip = 90 - Angle)
		if (fieldName === "holeDip") {
			var holeAngle = hole.holeAngle || 0;
			return 90 - holeAngle;
		}

		// Step 24a) Handle charging-derived fields (pulled from window.loadedCharging)
		if (fieldName.startsWith("design")) {
			return this.extractChargingField(hole, fieldName);
		}

		// Step 25) Get field mapping
		var mapping = this.HOLE_FIELD_MAPPING[fieldName];
		if (!mapping) {
			console.warn("CustomCSVWriter: Unknown field " + fieldName);
			return "";
		}

		// Step 26) Get value from hole object using property name
		var value = hole[mapping.property];

		// Step 27) Return value or default
		if (value === null || value === undefined) {
			return mapping.default || "";
		}

		return value;
	}

	// Step 22a) Extract charging-derived field from window.loadedCharging
	extractChargingField(hole, fieldName) {
		var chargingMap = window.loadedCharging;
		if (!chargingMap) return "";

		var charging = chargingMap.get(chargingKey(hole));
		if (!charging) return "";

		var cols = this.buildChargingColumns(charging);
		return cols[fieldName] !== undefined ? cols[fieldName] : "";
	}

	// Step 22b) Build all charging-derived column values from a HoleCharging object
	buildChargingColumns(charging) {
		if (!charging) return {};

		var totalExpMass = 0;
		var expParts = [];
		var primerParts = [];
		var detParts = [];
		var lenParts = [];
		var totalStemmingLen = 0;
		var totalStemmingMass = 0;
		var stemmingLenParts = [];
		var stemmingMassParts = [];
		var totalAirLen = 0;
		var airLenParts = [];
		var totalWaterLen = 0;
		var totalWaterMass = 0;
		var waterLenParts = [];
		var waterMassParts = [];

		for (var i = 0; i < charging.decks.length; i++) {
			var deck = charging.decks[i];
			var deckIdx = i + 1;
			var deckLen = Math.abs(deck.baseDepth - deck.topDepth);

			// Length per deck (all deck types)
			lenParts.push("[" + deckIdx + "]" + deckLen.toFixed(3));

			if (deck.deckType === "COUPLED" || deck.deckType === "DECOUPLED") {
				var deckMass = deck.calculateMass(charging.holeDiameterMm);
				totalExpMass += deckMass;
				expParts.push("[" + deckIdx + "]" + deckMass.toFixed(3));
			} else {
				expParts.push("[" + deckIdx + "]0.000");
			}

			// Inert deck classification by product type/name
			if (deck.deckType === "INERT" && deck.product) {
				var pType = deck.product.productType || "";
				var pName = (deck.product.name || "").toLowerCase();
				var deckMassInert = deck.calculateMass(charging.holeDiameterMm);

				if (pType === "Stemming" || pName.indexOf("stemm") !== -1 || pName.indexOf("drill") !== -1 || pName.indexOf("gel") !== -1) {
					totalStemmingLen += deckLen;
					totalStemmingMass += deckMassInert;
					stemmingLenParts.push("[" + deckIdx + "]" + deckLen.toFixed(3));
					stemmingMassParts.push("[" + deckIdx + "]" + deckMassInert.toFixed(3));
				} else if (pType === "Water" || pName.indexOf("water") !== -1) {
					totalWaterLen += deckLen;
					totalWaterMass += deckMassInert;
					waterLenParts.push("[" + deckIdx + "]" + deckLen.toFixed(3));
					waterMassParts.push("[" + deckIdx + "]" + deckMassInert.toFixed(3));
				} else {
					// Air or unknown inert (Air has ~0 density so mass ~0)
					totalAirLen += deckLen;
					airLenParts.push("[" + deckIdx + "]" + deckLen.toFixed(3));
				}
			}

			// Primer mass and detonator count per deck
			var deckPrimerMass = 0;
			var deckDetCount = 0;
			for (var p = 0; p < charging.primers.length; p++) {
				var primer = charging.primers[p];
				if (primer.deckID === deck.deckID ||
					(primer.lengthFromCollar >= deck.topDepth && primer.lengthFromCollar <= deck.baseDepth)) {
					deckPrimerMass += (primer.totalBoosterMassGrams || 0) / 1000;
					deckDetCount += (primer.detonator && primer.detonator.quantity) ? primer.detonator.quantity : 0;
				}
			}
			primerParts.push("[" + deckIdx + "]" + deckPrimerMass.toFixed(3));
			detParts.push("[" + deckIdx + "]" + deckDetCount);
		}

		// Total primer mass and detonator count (all primers)
		var totalPrimerMass = 0;
		var totalDetCount = 0;
		for (var k = 0; k < charging.primers.length; k++) {
			totalPrimerMass += (charging.primers[k].totalBoosterMassGrams || 0) / 1000;
			totalDetCount += (charging.primers[k].detonator && charging.primers[k].detonator.quantity) ? charging.primers[k].detonator.quantity : 0;
		}

		return {
			designExplosiveMassKg: totalExpMass.toFixed(3),
			designExplosiveMassPerDeck: expParts.length > 0 ? "EXP{" + expParts.join("|") + "}" : "",
			designPrimerMassKg: totalPrimerMass.toFixed(3),
			designPrimerMassPerDeck: primerParts.length > 0 ? "PMR{" + primerParts.join("|") + "}" : "",
			designDetonatorCount: totalDetCount.toString(),
			designDetonatorCountPerDeck: detParts.length > 0 ? "DET{" + detParts.join("|") + "}" : "",
			designLengthPerDeck: lenParts.length > 0 ? "LEN{" + lenParts.join("|") + "}" : "",
			// Stemming: total length, total mass, per-deck length, per-deck mass
			designStemmingLengthM: totalStemmingLen.toFixed(3),
			designStemmingMassKg: totalStemmingMass.toFixed(3),
			designStemmingLengthPerDeck: stemmingLenParts.length > 0 ? "STL{" + stemmingLenParts.join("|") + "}" : "",
			designStemmingMassPerDeck: stemmingMassParts.length > 0 ? "STM{" + stemmingMassParts.join("|") + "}" : "",
			// Air: total length, per-deck length (no mass — negligible)
			designAirLengthM: totalAirLen.toFixed(3),
			designAirLengthPerDeck: airLenParts.length > 0 ? "AIR{" + airLenParts.join("|") + "}" : "",
			// Water: total length, total mass, per-deck length, per-deck mass
			designWaterLengthM: totalWaterLen.toFixed(3),
			designWaterMassKg: totalWaterMass.toFixed(3),
			designWaterLengthPerDeck: waterLenParts.length > 0 ? "WTL{" + waterLenParts.join("|") + "}" : "",
			designWaterMassPerDeck: waterMassParts.length > 0 ? "WTR{" + waterMassParts.join("|") + "}" : ""
		};
	}

	// Step 26) Format value for CSV output with unit conversions
	formatValue(value, fieldName) {
		// Step 27) Handle diameter unit conversions
		if (fieldName === "holeDiameter") {
			return this.convertDiameter(value);
		}

		// Step 28) Handle subdrill negative conversion
		if (fieldName === "subdrillAmount" && this.subdrillNegative) {
			var num = parseFloat(value);
			if (isNaN(num)) {
				return "0." + "0".repeat(this.decimalPlaces);
			}
			return (-num).toFixed(this.decimalPlaces);
		}

		// Step 29) Handle numeric values
		if (typeof value === "number") {
			// Step 30) Check for NaN
			if (isNaN(value)) {
				return "0." + "0".repeat(this.decimalPlaces);
			}
			// Step 31) Format with decimal places
			return value.toFixed(this.decimalPlaces);
		}

		// Step 32) Handle string escaping for CSV
		if (typeof value === "string") {
			// Step 33) Check if string contains special characters
			if (value.indexOf(",") !== -1 || value.indexOf('"') !== -1 || value.indexOf("\n") !== -1) {
				// Step 34) Escape quotes and wrap in quotes
				var escapedValue = value.replace(/"/g, '""');
				return '"' + escapedValue + '"';
			}
		}

		// Step 35) Return value as-is
		return value;
	}

	// Step 36) Convert diameter from mm to target unit
	convertDiameter(value) {
		// Step 37) Parse to number
		var num = parseFloat(value);
		if (isNaN(num)) {
			return "0." + "0".repeat(this.decimalPlaces);
		}

		// Step 38) Convert based on target unit
		if (this.diameterUnit === "m") {
			// Step 39) Convert mm to meters
			return (num / 1000).toFixed(this.decimalPlaces);
		}
		if (this.diameterUnit === "in") {
			// Step 40) Convert mm to inches
			return (num / 25.4).toFixed(this.decimalPlaces);
		}

		// Step 41) Default: keep as mm
		return num.toFixed(this.decimalPlaces);
	}
}

export default CustomBlastHoleTextWriter;
