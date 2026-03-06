// src/dialog/contextMenu/HolesContextMenu.js
//=============================================================
// HOLES CONTEXT MENU
//=============================================================
// Step 0) Converted to ES Module for Vite bundling - 2025-12-26

import { assignBlastDialog } from '../popups/generic/AssignBlastDialog.js';
import { chargingKey } from '../../charging/HoleCharging.js';

// Step 1) Show hole property editor for single or multiple holes
export function showHolePropertyEditor(hole) {
	// Step 1a) CHECK VISIBILITY FIRST - Filter out hidden holes
	const visibleHoles = window.allBlastHoles.filter(hole => window.isHoleVisible(hole));

	if (visibleHoles.length === 0) {
		console.log("❌ No visible holes to edit");
		return;
	}

	if (visibleHoles.length !== allBlastHoles.length) {
		console.log("⚠️ Some holes are hidden and will not be edited");
	}

	// Step 1b) Determine if we're dealing with single hole or multiple holes
	let candidateHoles;
	if (Array.isArray(hole)) {
		candidateHoles = hole;
	} else if (window.selectedMultipleHoles && window.selectedMultipleHoles.length > 1) {
		candidateHoles = window.selectedMultipleHoles;
	} else {
		candidateHoles = [hole];
	}
	// Step 1c) Filter candidate holes to only include visible ones
	const holes = candidateHoles.filter(h => window.isHoleVisible(h));

	const isMultiple = holes.length > 1;
	const isArrayInput = Array.isArray(hole);

	if (holes.length === 0) return;

	// Step 2) Calculate current values and averages with proper fallbacks
	let delaySum = 0,
		diameterSum = 0,
		bearingSum = 0,
		angleSum = 0,
		subdrillSum = 0;
	let collarZSum = 0,
		gradeZSum = 0;
	let uniqueDelays = new Set(),
		uniqueDelayColors = new Set(),
		uniqueHoleTypes = new Set();
	let uniqueRowIDs = new Set(),
		uniquePosIDs = new Set();
	let typeCounts = {};
	let connectorCurveSum = 0;
	let burdenSum = 0;
	let spacingSum = 0;

	holes.forEach(h => {
		// Basic properties
		const currentDelay = h.holeDelay !== undefined ? h.holeDelay : h.timingDelayMilliseconds || 0;
		const currentColor = h.holeDelayColor || h.colorHexDecimal || "#FF0000";
		const currentType = h.holeType || "Production";

		// Geometry properties
		const diameter = h.holeDiameter || 0;
		const bearing = h.holeBearing || 0;
		const angle = h.holeAngle || 0;
		const subdrill = h.subdrillAmount || 0;
		const collarZ = h.startZLocation || 0;
		const gradeZ = h.gradeZLocation || h.endZLocation || 0;
		const rowID = h.rowID || "";
		const posID = h.posID || "";

		// Step 2a) Add connectorCurve calculation
		const connectorCurve = h.connectorCurve || 0;
		const burden = h.burden || 0;
		const spacing = h.spacing || 0;

		// Sum for averages
		delaySum += parseFloat(currentDelay);
		diameterSum += parseFloat(diameter);
		bearingSum += parseFloat(bearing);
		angleSum += parseFloat(angle);
		subdrillSum += parseFloat(subdrill);
		collarZSum += parseFloat(collarZ);
		gradeZSum += parseFloat(gradeZ);

		// Step 2b) Add new sums

		connectorCurveSum += parseFloat(connectorCurve);
		burdenSum += parseFloat(burden);
		spacingSum += parseFloat(spacing);

		// Track unique values
		uniqueDelays.add(currentDelay);
		uniqueDelayColors.add(currentColor);
		uniqueHoleTypes.add(currentType);
		uniqueRowIDs.add(rowID);
		uniquePosIDs.add(posID);

		// Count hole types for most common
		typeCounts[currentType] = (typeCounts[currentType] || 0) + 1;
	});

	// Step 3) Calculate averages
	const count = holes.length;
	const avgDelay = delaySum / count;
	const avgDiameter = diameterSum / count;
	const avgBearing = bearingSum / count;
	const avgAngle = angleSum / count;
	const avgSubdrill = subdrillSum / count;
	const avgCollarZ = collarZSum / count;
	const avgGradeZ = gradeZSum / count;

	// Step 3a) Find most common values
	const firstDelayColor = Array.from(uniqueDelayColors)[0];
	const firstRowID = Array.from(uniqueRowIDs)[0];
	const firstPosID = Array.from(uniquePosIDs)[0];

	// Step 3b) Find most common hole type
	let mostCommonType = "Production";
	let maxCount = 0;
	for (const [type, typeCount] of Object.entries(typeCounts)) {
		if (typeCount > maxCount) {
			maxCount = typeCount;
			mostCommonType = type;
		}
	}

	// Step 4) Create combined hole types list (standard + any custom types from selection)
	const standardHoleTypes = ["Angled", "Batter", "Buffer", "Infill", "Production", "Stab", "Toe", "Trim"];
	const customTypesFromSelection = Array.from(uniqueHoleTypes).filter(type => !standardHoleTypes.includes(type));
	const allHoleTypes = [...standardHoleTypes, ...customTypesFromSelection].sort();
	// Step 4a) Calculate averages (add after existing averages around line 37240)
	const avgConnectorCurve = connectorCurveSum / count;
	const avgBurden = burdenSum / count;
	const avgSpacing = spacingSum / count;

	// Step 5) Helper to normalize color for storage and comparison
	function normalizeColorValue(color) {
		if (!color) return "#000000";
		var c = String(color).trim().toUpperCase();
		if (!c.startsWith("#")) c = "#" + c;
		if (c.length === 4) {
			c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
		}
		return c;
	}

	// Step 5a) Add to originalValues object around line 37275
	const originalValues = {
		delay: avgDelay.toFixed(1),
		diameter: avgDiameter.toFixed(0),
		bearing: avgBearing.toFixed(1),
		angle: avgAngle.toFixed(0),
		subdrill: avgSubdrill.toFixed(1),
		collarZ: avgCollarZ.toFixed(2),
		gradeZ: avgGradeZ.toFixed(2),
		holeType: mostCommonType,
		delayColor: normalizeColorValue(firstDelayColor),
		rowID: firstRowID,
		posID: firstPosID,
		// Step 5b) Add new original values
		connectorCurve: avgConnectorCurve.toFixed(0),
		burden: avgBurden.toFixed(2),
		spacing: avgSpacing.toFixed(2)
	};

	// Step 6) Add display values around line 37285
	const displayConnectorCurve = isMultiple && new Set(holes.map(h => h.connectorCurve || 0)).size > 1 ? "varies (avg: " + avgConnectorCurve.toFixed(0) + "°)" : avgConnectorCurve.toFixed(0) + "°";
	const displayBurden = isMultiple && new Set(holes.map(h => h.burden || 0)).size > 1 ? "varies (avg: " + avgBurden.toFixed(2) + ")" : avgBurden.toFixed(2);
	const displaySpacing = isMultiple && new Set(holes.map(h => h.spacing || 0)).size > 1 ? "varies (avg: " + avgSpacing.toFixed(2) + ")" : avgSpacing.toFixed(2);

	// Step 6a) Create display values with indicators for varying values
	const displayDelay = isMultiple && uniqueDelays.size > 1 ? "varies (avg: " + avgDelay.toFixed(1) + ")" : avgDelay.toFixed(1);
	const displayDiameter = isMultiple && new Set(holes.map(h => h.holeDiameter)).size > 1 ? "varies (avg: " + avgDiameter.toFixed(0) + ")" : avgDiameter.toFixed(0);
	const displayBearing = isMultiple && new Set(holes.map(h => h.holeBearing)).size > 1 ? "varies (avg: " + avgBearing.toFixed(1) + ")" : avgBearing.toFixed(1);
	const displayAngle = isMultiple && new Set(holes.map(h => h.holeAngle)).size > 1 ? "varies (avg: " + avgAngle.toFixed(0) + ")" : avgAngle.toFixed(0);
	const displaySubdrill = isMultiple && new Set(holes.map(h => h.subdrillAmount)).size > 1 ? "varies (avg: " + avgSubdrill.toFixed(1) + ")" : avgSubdrill.toFixed(1);
	const displayCollarZ = isMultiple && new Set(holes.map(h => h.startZLocation)).size > 1 ? "varies (avg: " + avgCollarZ.toFixed(2) + ")" : avgCollarZ.toFixed(2);
	const displayGradeZ = isMultiple && new Set(holes.map(h => h.gradeZLocation || h.endZLocation)).size > 1 ? "varies (avg: " + avgGradeZ.toFixed(2) + ")" : avgGradeZ.toFixed(2);

	// Step 6b) Create notes for multiple values
	const delayNote = isMultiple && uniqueDelays.size > 1 ? " (varying)" : "";
	const colorNote = isMultiple && uniqueDelayColors.size > 1 ? " (multiple)" : "";
	const typeNote = isMultiple && uniqueHoleTypes.size > 1 ? " (most common: " + mostCommonType + ")" : "";

	const title = isMultiple ? "Edit Multiple Holes (" + holes.length + " selected)" : "Edit Hole " + holes[0].holeID;

	// Step 7) Define form fields
	const fields = [
		{
			label: "Delay" + delayNote,
			name: "delay",
			type: "text",
			value: originalValues.delay,
			placeholder: displayDelay
		},
		{
			label: "Delay Color" + colorNote,
			name: "delayColor",
			type: "color",
			value: normalizeColorValue(firstDelayColor)
		},
		{
			label: "Connector Curve (°)",
			name: "connectorCurve",
			type: "number",
			value: originalValues.connectorCurve,
			placeholder: displayConnectorCurve
		},
		{
			label: "Hole Type",
			name: "holeType",
			type: "select",
			value: mostCommonType,
			options: [
				{
					value: "",
					text: "-- No Change --"
				},
				...allHoleTypes.map(type => ({
					value: type,
					text: type
				})),
				{
					value: "__CUSTOM__",
					text: "Other (custom)..."
				}
			]
		},
		{
			label: "Custom Type",
			name: "customType",
			type: "text",
			placeholder: "Enter custom hole type",
			disabled: true
		},
		{
			label: "Diameter (mm)",
			name: "diameter",
			type: "text",
			value: originalValues.diameter,
			placeholder: displayDiameter
		},
		{
			label: "Bearing (°)",
			name: "bearing",
			type: "text",
			value: originalValues.bearing,
			placeholder: displayBearing
		},
		{
			label: "Dip/Angle (°)",
			name: "angle",
			type: "text",
			value: originalValues.angle,
			placeholder: displayAngle
		},
		{
			label: "Subdrill (m)",
			name: "subdrill",
			type: "text",
			value: originalValues.subdrill,
			placeholder: displaySubdrill
		},
		{
			label: "Collar Z RL (m)",
			name: "collarZ",
			type: "text",
			value: originalValues.collarZ,
			placeholder: displayCollarZ
		},
		{
			label: "Grade Z RL (m)",
			name: "gradeZ",
			type: "text",
			value: originalValues.gradeZ,
			placeholder: displayGradeZ
		},
		{
			label: "Burden (m)",
			name: "burden",
			type: "text",
			value: originalValues.burden,
			placeholder: displayBurden
		},
		{
			label: "Spacing (m)",
			name: "spacing",
			type: "text",
			value: originalValues.spacing,
			placeholder: displaySpacing
		}
	];

	// Step 8) Add Row ID and Pos ID fields only for single hole edits
	if (!isMultiple) {
		fields.push(
			{
				label: "Row ID",
				name: "rowID",
				type: "text",
				value: firstRowID,
				placeholder: "Row identifier"
			},
			{
				label: "Pos ID",
				name: "posID",
				type: "text",
				value: firstPosID,
				placeholder: "Position identifier"
			}
		);
	}

	// Step 9) Create enhanced form content with special handling
	const formContent = window.createEnhancedFormContent(fields, isMultiple);

	// Step 9a) Add note at the bottom
	const noteDiv = document.createElement("div");
	noteDiv.style.gridColumn = "1 / -1";
	noteDiv.style.marginTop = "10px";
	noteDiv.style.fontSize = "10px";
	noteDiv.style.color = "#888";
	noteDiv.textContent = isMultiple ? "Note: Use = prefix for calculations (e.g., =+0.3 to add, =-0.2 to subtract). Plain numbers set absolute values. Only changed values will be applied." : "Note: Use = prefix for calculations (e.g., =+0.3 to add, =-0.2 to subtract). Plain numbers (including negatives like -0.3) set absolute values. Curved connectors: 45° to 120° or -45° to -120°. Straight: 0°";
	formContent.appendChild(noteDiv);

	// Step 9b) For multi-hole: add Recalculate Loading section below form
	if (isMultiple) {
		// Gather per-hole charging stats
		let chargedCount = 0;
		let mismatchCount = 0;
		let autoOnCount = 0;
		let autoOffCount = 0;
		const chargedHoles = []; // holes that have charging data
		if (window.loadedCharging) {
			holes.forEach(function(h) {
				const hc = window.loadedCharging.get(chargingKey(h));
				if (hc) {
					chargedCount++;
					chargedHoles.push(h);
					if (hc.autoRecalculate !== false) { autoOnCount++; } else { autoOffCount++; }
					if (typeof hc.checkDimensionMismatch === "function") {
						const mm = hc.checkDimensionMismatch(h);
						if (mm.lengthChanged || mm.diameterChanged) mismatchCount++;
					}
				}
			});
		}

		if (chargedCount > 0) {
			// Auto-recalculate on open for holes that have autoRecalculate=true
			if (mismatchCount > 0 && autoOnCount > 0) {
				let autoUpdated = 0;
				chargedHoles.forEach(function(h) {
					const hc = window.loadedCharging.get(chargingKey(h));
					if (hc && hc.autoRecalculate !== false && typeof hc.updateDimensions === "function") {
						const mm = hc.checkDimensionMismatch(h);
						if (mm.lengthChanged || mm.diameterChanged) {
							hc.updateDimensions(h);
							autoUpdated++;
						}
					}
				});
				if (autoUpdated > 0) {
					if (typeof window.debouncedSaveCharging === "function") window.debouncedSaveCharging();
					// Recount mismatches after auto-recalc
					mismatchCount = 0;
					chargedHoles.forEach(function(h) {
						const hc = window.loadedCharging.get(chargingKey(h));
						if (hc && typeof hc.checkDimensionMismatch === "function") {
							const mm = hc.checkDimensionMismatch(h);
							if (mm.lengthChanged || mm.diameterChanged) mismatchCount++;
						}
					});
					console.log("Auto-recalculated charging for", autoUpdated, "holes on multi-hole dialog open");
				}
			}

			// Controls row: Recalculate button + Auto checkbox
			const loadingSection = document.createElement("div");
			loadingSection.style.cssText = "grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:6px 0 4px;border-top:1px solid #444;margin-top:6px;";

			// Recalculate button
			const recalcBtn = document.createElement("button");
			recalcBtn.className = "floating-dialog-btn";
			recalcBtn.textContent = "Recalculate Loading";
			recalcBtn.addEventListener("click", function() {
				let updated = 0;
				chargedHoles.forEach(function(h) {
					const hc = window.loadedCharging ? window.loadedCharging.get(chargingKey(h)) : null;
					if (hc && typeof hc.updateDimensions === "function") {
						const result = hc.updateDimensions(h);
						if (result.lengthRescaled || result.diameterUpdated) updated++;
					}
				});
				if (updated > 0 && typeof window.debouncedSaveCharging === "function") {
					window.debouncedSaveCharging();
				}
				// Update status panel to green
				statusPanel.style.background = "#1a3a1a";
				statusPanel.style.color = "#6fbf6f";
				statusPanel.textContent = chargedCount + " holes with charging \u2014 All up to date";
				window.updateStatusMessage("Recalculated charging for " + updated + " of " + chargedCount + " holes");
				setTimeout(function() { window.updateStatusMessage(""); }, 3000);
			});
			loadingSection.appendChild(recalcBtn);

			// Auto Recalculate checkbox (per-hole: indeterminate if mixed)
			const autoLabel = document.createElement("label");
			autoLabel.style.cssText = "display:flex;align-items:center;gap:4px;font-size:11px;color:#aaa;cursor:pointer;margin-left:auto;";
			const autoCheck = document.createElement("input");
			autoCheck.type = "checkbox";
			if (autoOnCount > 0 && autoOffCount > 0) {
				// Mixed state
				autoCheck.checked = false;
				autoCheck.indeterminate = true;
			} else {
				autoCheck.checked = autoOnCount > 0;
			}
			autoCheck.addEventListener("change", function() {
				// Apply to all charged holes in selection
				chargedHoles.forEach(function(h) {
					const hc = window.loadedCharging ? window.loadedCharging.get(chargingKey(h)) : null;
					if (hc) hc.autoRecalculate = autoCheck.checked;
				});
				autoCheck.indeterminate = false;
				if (typeof window.debouncedSaveCharging === "function") window.debouncedSaveCharging();
			});
			autoLabel.appendChild(autoCheck);
			autoLabel.appendChild(document.createTextNode("Auto Recalculate"));
			loadingSection.appendChild(autoLabel);

			formContent.appendChild(loadingSection);

			// Status panel: green (all good) or orange (mismatches)
			const statusPanel = document.createElement("div");
			statusPanel.style.cssText = "grid-column:1/-1;padding:6px 10px;font-size:12px;border-radius:3px;text-align:center;";
			if (mismatchCount > 0) {
				statusPanel.style.background = "#5a3800";
				statusPanel.style.color = "#ffb347";
				statusPanel.textContent = chargedCount + " holes with charging, " + mismatchCount + " with dimension mismatches";
			} else {
				statusPanel.style.background = "#1a3a1a";
				statusPanel.style.color = "#6fbf6f";
				statusPanel.textContent = chargedCount + " holes with charging \u2014 All up to date";
			}
			formContent.appendChild(statusPanel);
		}
	}

	// Step 9c) Build tabbed content for single-hole edit (Properties + Loading tabs)
	let dialogContent = formContent;
	let dialogWidth = 380;
	let sectionViewRef = null;

	if (!isMultiple) {
		dialogWidth = 480;
		const tabbedContainer = document.createElement("div");
		tabbedContainer.style.cssText = "display:flex;flex-direction:column;height:100%;";

		// Tab header buttons
		const tabBar = document.createElement("div");
		tabBar.style.cssText = "display:flex;border-bottom:2px solid #444;margin-bottom:6px;flex-shrink:0;";

		const tabProps = document.createElement("button");
		tabProps.textContent = "Properties";
		tabProps.style.cssText = "flex:1;padding:6px 0;border:none;cursor:pointer;font-size:12px;font-weight:bold;background:#333;color:#fff;border-bottom:2px solid #4a9eff;";

		const tabLoading = document.createElement("button");
		tabLoading.textContent = "Loading";
		tabLoading.style.cssText = "flex:1;padding:6px 0;border:none;cursor:pointer;font-size:12px;font-weight:bold;background:#222;color:#888;border-bottom:2px solid transparent;";

		tabBar.appendChild(tabProps);
		tabBar.appendChild(tabLoading);
		tabbedContainer.appendChild(tabBar);

		// Tab 1: Properties panel (existing form)
		const propsPanel = document.createElement("div");
		propsPanel.style.cssText = "flex:1;overflow-y:auto;display:block;";
		propsPanel.appendChild(formContent);

		// Tab 2: Loading panel (charging cross-section + summary)
		const loadingPanel = document.createElement("div");
		loadingPanel.style.cssText = "flex:1;display:none;flex-direction:column;overflow:hidden;";

		// Build loading tab content
		const singleHole = holes[0];
		const holeCharging = window.loadedCharging ? window.loadedCharging.get(chargingKey(singleHole)) : null;

		if (holeCharging) {
			// Check for dimension mismatch
			const mismatch = typeof holeCharging.checkDimensionMismatch === "function"
				? holeCharging.checkDimensionMismatch(singleHole)
				: { lengthChanged: false, diameterChanged: false };
			const hasMismatch = mismatch.lengthChanged || mismatch.diameterChanged;

			// Auto-recalculate immediately if this hole has autoRecalculate enabled
			if (hasMismatch && holeCharging.autoRecalculate !== false && typeof holeCharging.updateDimensions === "function") {
				holeCharging.updateDimensions(singleHole);
				if (typeof window.debouncedSaveCharging === "function") {
					window.debouncedSaveCharging();
				}
				console.log("Auto-recalculated charging on Loading tab open for hole " + singleHole.holeID);
			}

			// Mismatch warning bar (only show if this hole's auto-recalc is OFF and mismatch exists)
			let mismatchWarningBar = null;
			if (hasMismatch && holeCharging.autoRecalculate === false) {
				mismatchWarningBar = document.createElement("div");
				mismatchWarningBar.style.cssText = "background:#5a3800;color:#ffb347;padding:6px 10px;font-size:11px;border-radius:3px;margin-bottom:4px;";
				let warningText = "Dimension mismatch: ";
				if (mismatch.lengthChanged) {
					warningText += "Length " + mismatch.oldLength.toFixed(1) + "m \u2192 " + mismatch.newLength.toFixed(1) + "m";
				}
				if (mismatch.lengthChanged && mismatch.diameterChanged) warningText += ", ";
				if (mismatch.diameterChanged) {
					warningText += "Diameter " + mismatch.oldDiameter.toFixed(0) + "mm \u2192 " + mismatch.newDiameter.toFixed(0) + "mm";
				}
				mismatchWarningBar.textContent = warningText;
				loadingPanel.appendChild(mismatchWarningBar);
			}

			const loadingRow = document.createElement("div");
			loadingRow.style.cssText = "display:flex;gap:8px;flex:1;min-height:0;";

			// Left: Section view canvas (wrapped in flex container like DeckBuilder)
			const sectionDiv = document.createElement("div");
			sectionDiv.style.cssText = "flex:1;display:flex;flex-direction:column;min-width:0;";
			const sectionCanvas = document.createElement("canvas");
			sectionCanvas.style.cssText = "flex:1;width:100%;";
			sectionDiv.appendChild(sectionCanvas);
			loadingRow.appendChild(sectionDiv);

			// Right: Summary text (fixed width)
			const summaryDiv = document.createElement("div");
			summaryDiv.style.cssText = "width:180px;flex-shrink:0;font-size:11px;color:#ccc;padding:4px;line-height:1.6;";

			const deckCount = holeCharging.decks ? holeCharging.decks.length : 0;
			const primerCount = holeCharging.primers ? holeCharging.primers.length : 0;
			const totalMass = typeof holeCharging.getTotalExplosiveMass === "function" ? holeCharging.getTotalExplosiveMass() : 0;
			const burden = singleHole.burden || 1;
			const spacing = singleHole.spacing || 1;
			const powderFactor = typeof holeCharging.calculatePowderFactor === "function" ? holeCharging.calculatePowderFactor(burden, spacing) : 0;

			let productNames = [];
			if (holeCharging.decks) {
				holeCharging.decks.forEach(function(d) {
					if (d.product && d.product.name && productNames.indexOf(d.product.name) === -1) {
						productNames.push(d.product.name);
					}
				});
			}

			let detDelay = "";
			if (holeCharging.primers && holeCharging.primers.length > 0) {
				const p = holeCharging.primers[0];
				if (p.detonator && p.detonator.delayMs != null) {
					detDelay = p.detonator.delayMs + "ms";
					if (p.detonator.productName) detDelay += " (" + p.detonator.productName + ")";
				}
			}

			// Build summary using safe DOM methods
			summaryDiv.textContent = "";

			function addSummaryLine(parent, text, bold) {
				if (bold) {
					var b = document.createElement("b");
					b.textContent = text;
					parent.appendChild(b);
				} else {
					parent.appendChild(document.createTextNode(text));
				}
				parent.appendChild(document.createElement("br"));
			}

			function addLabelValue(parent, label, value) {
				parent.appendChild(document.createTextNode(label));
				var b = document.createElement("b");
				b.textContent = value;
				parent.appendChild(b);
				parent.appendChild(document.createElement("br"));
			}

			addSummaryLine(summaryDiv, "Charging Summary", true);
			addSummaryLine(summaryDiv, "Decks: " + deckCount, false);
			addSummaryLine(summaryDiv, "Primers: " + primerCount, false);
			addLabelValue(summaryDiv, "Explosive Mass: ", totalMass.toFixed(1) + " kg");
			addLabelValue(summaryDiv, "Powder Factor: ", powderFactor.toFixed(3) + " kg/m\u00B3");
			addSummaryLine(summaryDiv, "Products: " + (productNames.length > 0 ? productNames.join(", ") : "None"), false);
			if (detDelay) {
				addSummaryLine(summaryDiv, "Det Delay: " + detDelay, false);
			}

			// Compression profile warnings for compressible decks
			if (holeCharging.decks) {
				let hasCompressible = false;
				for (let ci = 0; ci < holeCharging.decks.length; ci++) {
					let cd = holeCharging.decks[ci];
					if (cd.isCompressible && cd.deckType === "COUPLED" && typeof cd.getCompressibleModel === "function") {
						let cModel = cd.getCompressibleModel(singleHole.holeDiameter || 115);
						if (cModel) {
							if (!hasCompressible) {
								summaryDiv.appendChild(document.createElement("br"));
								var compTitle = document.createElement("b");
								compTitle.style.color = "#ffcc00";
								compTitle.textContent = "Compression Profile";
								summaryDiv.appendChild(compTitle);
								summaryDiv.appendChild(document.createElement("br"));
								hasCompressible = true;
							}
							var densLine = document.createElement("span");
							densLine.style.fontSize = "10px";
							densLine.textContent = "Deck " + (ci + 1) + ": " + cModel.capDensity.toFixed(2) + " \u2192 " + cModel.densityAtDepth(cd.length).toFixed(2) + " g/cc";
							summaryDiv.appendChild(densLine);
							summaryDiv.appendChild(document.createElement("br"));

							var cDepth = cModel.criticalDepth(cd.length);
							if (cDepth !== null) {
								var critLine = document.createElement("span");
								critLine.style.cssText = "color:#ff4444;font-weight:bold;font-size:10px;display:inline-flex;align-items:center;gap:3px;";
								var critIcon = document.createElement("img");
								critIcon.src = "icons/alert-triangle-filled.png";
								critIcon.width = 24;
								critIcon.height = 24;
								critIcon.style.filter = "invert(55%) sepia(90%) saturate(600%) hue-rotate(5deg) brightness(105%)";
								critIcon.style.verticalAlign = "middle";
								critLine.appendChild(critIcon);
								critLine.appendChild(document.createTextNode(" Critical at " + cDepth.toFixed(1) + "m"));
								summaryDiv.appendChild(critLine);
								summaryDiv.appendChild(document.createElement("br"));
							}
						}
					}
				}
			}

			loadingRow.appendChild(summaryDiv);
			loadingPanel.appendChild(loadingRow);

			// Controls bar: Recalculate button + Auto-recalc checkbox
			const controlsBar = document.createElement("div");
			controlsBar.style.cssText = "display:flex;align-items:center;gap:10px;padding:4px 6px;border-top:1px solid #444;flex-shrink:0;";

			// Manual Recalculate button (uses standard floating-dialog-btn for consistent styling)
			const recalcBtn = document.createElement("button");
			recalcBtn.textContent = "Recalculate";
			recalcBtn.className = "floating-dialog-btn";
			recalcBtn.addEventListener("click", function() {
				if (typeof holeCharging.updateDimensions === "function") {
					const result = holeCharging.updateDimensions(singleHole);
					if (result.lengthRescaled || result.diameterUpdated) {
						// Persist updated charging
						if (typeof window.debouncedSaveCharging === "function") {
							window.debouncedSaveCharging();
						}
						// Refresh section view
						if (sectionViewRef && sectionViewRef.sectionView) {
							sectionViewRef.sectionView.setCharging(holeCharging, singleHole.holeDiameter || 115);
						}
						// Remove warning bar if present
						if (mismatchWarningBar && mismatchWarningBar.parentNode) {
							mismatchWarningBar.parentNode.removeChild(mismatchWarningBar);
						}
						window.updateStatusMessage("Charging recalculated for hole " + singleHole.holeID);
						setTimeout(function() { window.updateStatusMessage(""); }, 2000);
					} else {
						window.updateStatusMessage("No dimension changes to apply");
						setTimeout(function() { window.updateStatusMessage(""); }, 2000);
					}
				}
			});
			controlsBar.appendChild(recalcBtn);

			// Auto-recalc checkbox (per-hole property)
			const autoLabel = document.createElement("label");
			autoLabel.style.cssText = "display:flex;align-items:center;gap:4px;font-size:11px;color:#aaa;cursor:pointer;margin-left:auto;";
			const autoCheck = document.createElement("input");
			autoCheck.type = "checkbox";
			autoCheck.checked = holeCharging.autoRecalculate !== false;
			autoCheck.addEventListener("change", function() {
				holeCharging.autoRecalculate = autoCheck.checked;
				if (typeof window.debouncedSaveCharging === "function") window.debouncedSaveCharging();
			});
			autoLabel.appendChild(autoCheck);
			autoLabel.appendChild(document.createTextNode("Auto Recalculate"));
			controlsBar.appendChild(autoLabel);

			loadingPanel.appendChild(controlsBar);

			// Create HoleSectionView in read-only mode after dialog shows
			sectionViewRef = { canvas: sectionCanvas, holeCharging: holeCharging, holeDiameterMm: singleHole.holeDiameter || 115 };
		} else {
			const placeholder = document.createElement("div");
			placeholder.style.cssText = "text-align:center;padding:40px 20px;color:#666;font-size:13px;";
			placeholder.textContent = "No charging data for this hole.";
			loadingPanel.appendChild(placeholder);
		}

		tabbedContainer.appendChild(propsPanel);
		tabbedContainer.appendChild(loadingPanel);

		// Tab switching logic
		tabProps.addEventListener("click", function() {
			propsPanel.style.display = "block";
			loadingPanel.style.display = "none";
			tabProps.style.background = "#333";
			tabProps.style.color = "#fff";
			tabProps.style.borderBottom = "2px solid #4a9eff";
			tabLoading.style.background = "#222";
			tabLoading.style.color = "#888";
			tabLoading.style.borderBottom = "2px solid transparent";
		});

		tabLoading.addEventListener("click", function() {
			propsPanel.style.display = "none";
			loadingPanel.style.display = "flex";
			tabLoading.style.background = "#333";
			tabLoading.style.color = "#fff";
			tabLoading.style.borderBottom = "2px solid #4a9eff";
			tabProps.style.background = "#222";
			tabProps.style.color = "#888";
			tabProps.style.borderBottom = "2px solid transparent";
		});

		dialogContent = tabbedContainer;
	}

	// Step 10) Create dialog
	const dialog = new window.FloatingDialog({
		title: title,
		content: dialogContent,
		layoutType: "compact",
		showConfirm: true,
		showCancel: true,
		showOption1: true, // Hide button
		showOption2: true, // Delete button
		showOption3: !isMultiple, // Insert button (only for single hole)
		showOption4: true, // Assign Blast button (always shown)
		confirmText: "Apply",
		cancelText: "Cancel",
		option1Text: "Hide",
		option2Text: "Delete",
		option3Text: "Insert",
		option4Text: "Assign Blast",
		width: dialogWidth,
		height: 600,
		onConfirm: () => {
			// Step 10a) Get form values and process updates
			const formData = window.getFormData(formContent);

			// Process the form data and update holes
			processHolePropertyUpdates(holes, formData, originalValues, isMultiple);

			// Clear any dragging states when dialog closes
			if (typeof window.isDragging !== "undefined") window.isDragging = false;
			if (typeof window.longPressTimeout !== "undefined") clearTimeout(window.longPressTimeout);
		},
		onCancel: () => {
			// Step 10d) Clear any dragging states and redraw when dialog closes
			if (typeof window.isDragging !== "undefined") window.isDragging = false;
			if (typeof window.longPressTimeout !== "undefined") clearTimeout(window.longPressTimeout);

			// Redraw canvas when dialog closes
			if (typeof window.redraw3D === "function") {
				window.redraw3D();
			} else {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		},
		onOption1: () => {
			// Step 10b) Hide holes - just set visible flag
			holes.forEach(hole => {
				hole.visible = false;
			});
			if (typeof window.redraw3D === "function") {
				window.redraw3D();
			} else {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		},
		onOption2: () => {
			// Step 10c) Delete holes using Factory Code with renumber prompt
			// Close the property dialog first
			dialog.close();

			// Ask if user wants to renumber (USE FACTORY CODE)
			window.showConfirmationDialog(
				"Renumber Holes?",
				"Do you want to renumber holes after deletion?",
				"Yes",
				"No",
				() => {
					// Step 10c.1) Yes - Ask for starting number using input dialog (USE FACTORY CODE)
					window.showConfirmationDialogWithInput(
						"Renumber Starting Value",
						"Enter the starting number for renumbering:",
						"Start From",
						"text",
						"1",
						"OK",
						"Cancel",
						startNumber => {
							// Step 10c.2) Delete holes manually and renumber with starting value
							const entitiesToRenumber = new Set();

							// Step 10c.2a) Build set of deleted hole combined IDs for orphan detection
							const deletedHoleIDs = new Set();
							holes.forEach(hole => {
								deletedHoleIDs.add(hole.entityName + ":::" + hole.holeID);
							});

							// Step 10c.2b) Capture holes for undo BEFORE deletion
							var holesToDeleteForUndo = [];
							holes.forEach(hole => {
								const index = window.allBlastHoles.findIndex(h => h.holeID === hole.holeID && h.entityName === hole.entityName);
								if (index !== -1) {
									holesToDeleteForUndo.push({
										holeData: JSON.parse(JSON.stringify(window.allBlastHoles[index])),
										originalIndex: index
									});
									window.allBlastHoles.splice(index, 1);
									entitiesToRenumber.add(hole.entityName);
								}
							});

							// Step 10c.2c) Fix orphaned fromHoleID references pointing to deleted holes
							// This must happen BEFORE renumbering so renumberHolesFunction can update them properly
							window.allBlastHoles.forEach(h => {
								if (h.fromHoleID && deletedHoleIDs.has(h.fromHoleID)) {
									// Set orphaned fromHoleID to point to itself (self-connected)
									h.fromHoleID = h.entityName + ":::" + h.holeID;
								}
							});

							// Step 10c.2d) Create undo action for deleted holes
							if (window.undoManager && holesToDeleteForUndo.length > 0) {
								var deleteAction;
								if (holesToDeleteForUndo.length === 1) {
									deleteAction = new window.DeleteHoleAction(holesToDeleteForUndo[0].holeData, holesToDeleteForUndo[0].originalIndex);
								} else {
									deleteAction = new window.DeleteMultipleHolesAction(holesToDeleteForUndo);
								}
								window.undoManager.pushAction(deleteAction);
							}

							// Step 10c.2e) Renumber each affected entity with user-specified starting number (USE FACTORY CODE)
							// renumberHolesFunction will update fromHoleID references as holeIDs change
							entitiesToRenumber.forEach(entityName => {
								window.renumberHolesFunction(startNumber, entityName);
							});

							// Clear selection state to avoid highlighting deleted/renumbered holes
							if (typeof window.clearHoleSelection === "function") window.clearHoleSelection();

							// Debounced save and updates (USE FACTORY CODE)
							window.debouncedSaveHoles();
							window.debouncedUpdateTreeView();
							if (typeof window.redraw3D === "function") {
								window.redraw3D();
							} else {
								window.drawData(window.allBlastHoles, window.selectedHole);
							}
							window.updateStatusMessage("Deleted " + holes.length + " hole(s) and renumbered from " + startNumber);
							setTimeout(() => window.updateStatusMessage(""), 2000);
						},
						() => {
							// Step 10c.3) User cancelled the starting number input
							window.updateStatusMessage("Renumber cancelled");
							setTimeout(() => window.updateStatusMessage(""), 2000);
						}
					);
				},
				() => {
					// Step 10c.4) No - Delete without renumbering

					// Step 10c.4a) Build set of deleted hole combined IDs for orphan detection
					const deletedHoleIDs = new Set();
					holes.forEach(hole => {
						deletedHoleIDs.add(hole.entityName + ":::" + hole.holeID);
					});

					// Step 10c.4b) Capture holes for undo BEFORE deletion
					var holesToDeleteForUndo = [];
					holes.forEach(hole => {
						const index = window.allBlastHoles.findIndex(h => h.holeID === hole.holeID && h.entityName === hole.entityName);
						if (index !== -1) {
							holesToDeleteForUndo.push({
								holeData: JSON.parse(JSON.stringify(window.allBlastHoles[index])),
								originalIndex: index
							});
							window.allBlastHoles.splice(index, 1);
						}
					});

					// Step 10c.4c) Fix orphaned fromHoleID references pointing to deleted holes
					window.allBlastHoles.forEach(h => {
						if (h.fromHoleID && deletedHoleIDs.has(h.fromHoleID)) {
							// Set orphaned fromHoleID to point to itself (self-connected)
							h.fromHoleID = h.entityName + ":::" + h.holeID;
						}
					});

					// Step 10c.4d) Create undo action for deleted holes
					if (window.undoManager && holesToDeleteForUndo.length > 0) {
						var deleteAction;
						if (holesToDeleteForUndo.length === 1) {
							deleteAction = new window.DeleteHoleAction(holesToDeleteForUndo[0].holeData, holesToDeleteForUndo[0].originalIndex);
						} else {
							deleteAction = new window.DeleteMultipleHolesAction(holesToDeleteForUndo);
						}
						window.undoManager.pushAction(deleteAction);
					}

					// Clear selection state to avoid highlighting deleted/renumbered holes
					if (typeof window.clearHoleSelection === "function") window.clearHoleSelection();

					// Debounced save and updates (USE FACTORY CODE)
					window.debouncedSaveHoles();
					window.debouncedUpdateTreeView();
					if (typeof window.redraw3D === "function") {
						window.redraw3D();
					} else {
						window.drawData(window.allBlastHoles, window.selectedHole);
					}
					window.updateStatusMessage("Deleted " + holes.length + " hole(s)");
					setTimeout(() => window.updateStatusMessage(""), 2000);
				}
			);
		},
		onOption4: () => {
			// Step 10f) Assign Blast - reassign selected holes to a different blast
			dialog.close();
			assignBlastDialog(holes);
		},
		onOption3: () => {
			// Step 10e) Insert hole before or after selected hole
			dialog.close();

			const sourceHole = holes[0]; // Single hole only

			// Find holes in same entity and row
			const holesInRow = window.allBlastHoles.filter(h => h.entityName === sourceHole.entityName && h.rowID === sourceHole.rowID).sort((a, b) => parseInt(a.posID) - parseInt(b.posID));

			const sourceIndex = holesInRow.findIndex(h => h.holeID === sourceHole.holeID);

			// Helper function to calculate bearing from two holes
			const calculateBearingFromHoles = (hole1, hole2) => {
				const dx = hole2.startXLocation - hole1.startXLocation;
				const dy = hole2.startYLocation - hole1.startYLocation;
				let bearing = Math.atan2(dx, dy) * 180 / Math.PI;
				if (bearing < 0) bearing += 360;
				return bearing;
			};

			// Show dialog with Before/After buttons
			window.showConfirmationDialogWithInputAndBeforeAfter(
				"Insert Hole",
				"Enter custom Hole ID or leave blank to auto-renumber:",
				"Hole ID (optional)",
				"text",
				"",
				// onBefore callback - Insert BEFORE the selected hole
				customID => {
					// Step 1) Validate custom hole ID
					if (customID && customID.trim()) {
						const trimmedID = customID.trim();
						const existingHole = window.allBlastHoles.find(h => h.entityName === sourceHole.entityName && h.holeID === trimmedID);
						if (existingHole) {
							window.showErrorDialog("Duplicate Hole ID", "Hole ID '" + trimmedID + "' already exists in entity '" + sourceHole.entityName + "'.\n\nPlease choose a different ID or leave blank to auto-renumber.", "OK");
							return;
						}
					}

					// Step 2) Calculate insert position BEFORE source hole
					let insertX, insertY, insertZ;
					const prevHole = sourceIndex > 0 ? holesInRow[sourceIndex - 1] : null;

					if (prevHole) {
						// Midpoint between previous and source hole
						insertX = (prevHole.startXLocation + sourceHole.startXLocation) / 2;
						insertY = (prevHole.startYLocation + sourceHole.startYLocation) / 2;
						insertZ = (prevHole.startZLocation + sourceHole.startZLocation) / 2;
					} else {
						// At start of row - use spacing and bearing from first two holes
						const spacing = sourceHole.spacing || 3;
						let bearing;
						if (holesInRow.length >= 2) {
							bearing = calculateBearingFromHoles(holesInRow[0], holesInRow[1]);
						} else {
							bearing = sourceHole.holeBearing || 0;
						}
						const bearingRad = bearing * Math.PI / 180;
						insertX = sourceHole.startXLocation - spacing * Math.sin(bearingRad);
						insertY = sourceHole.startYLocation - spacing * Math.cos(bearingRad);
						insertZ = sourceHole.startZLocation;
					}

					// Step 3) Create new hole - DO NOT copy fromHoleID from source
					const newHole = {
						...sourceHole,
						holeID: customID && customID.trim() ? customID.trim() : "TEMP_ID",
						startXLocation: insertX,
						startYLocation: insertY,
						startZLocation: insertZ,
						posID: sourceHole.posID ? String(parseInt(sourceHole.posID)) : "1",
						visible: true,
						hasCustomID: customID && customID.trim() ? true : false,
						// Step 3a) Clear fromHoleID - will be set to self after final holeID is assigned
						fromHoleID: ""
					};

					// Step 4) Remove copied geometry properties so they'll be recalculated
					delete newHole.endXLocation;
					delete newHole.endYLocation;
					delete newHole.endZLocation;
					delete newHole.gradeXLocation;
					delete newHole.gradeYLocation;
					delete newHole.gradeZLocation;
					delete newHole.benchHeight;

					const globalIndex = window.allBlastHoles.findIndex(h => h.holeID === sourceHole.holeID && h.entityName === sourceHole.entityName);

					if (globalIndex !== -1) {
						// Step 5) Insert hole into array FIRST (calculateHoleGeometry needs it to exist in array)
						window.allBlastHoles.splice(globalIndex, 0, newHole);

						// Step 6) Recalculate geometry based on new collar position using mode 1 (Length)
						if (typeof window.calculateHoleGeometry === "function") {
							window.calculateHoleGeometry(newHole, newHole.holeLengthCalculated, 1);
						}

						// Step 7) Build oldToNewHoleIDMap BEFORE renumbering to track changes
						const oldToNewHoleIDMap = new Map();

						if (!customID || !customID.trim()) {
							const sourceNum = sourceHole.holeID.match(/\d+/);
							const sourceNumber = sourceNum ? parseInt(sourceNum[0]) : 1;
							const prefix = sourceHole.holeID.replace(/\d+/g, "");
							
							// Step 7a) Assign new hole its ID
							newHole.holeID = prefix + sourceNumber;
							
							// Step 7b) Renumber from source hole onwards, building the mapping
							let nextNum = sourceNumber + 1;
							for (let i = globalIndex + 1; i < window.allBlastHoles.length; i++) {
								const h = window.allBlastHoles[i];
								if (h.entityName === sourceHole.entityName) {
									if (!h.hasCustomID) {
										const oldID = h.holeID;
										const newID = prefix + nextNum;
										oldToNewHoleIDMap.set(oldID, newID);
										h.holeID = newID;
									}
									nextNum++;
								}
							}
						}

						// Step 8) Set new hole's fromHoleID to point to itself (self-connected)
						newHole.fromHoleID = sourceHole.entityName + ":::" + newHole.holeID;

						// Step 9) Update fromHoleID references for all holes in this entity
						window.allBlastHoles.forEach(h => {
							if (h.fromHoleID && h !== newHole) {
								const parts = h.fromHoleID.split(":::");
								if (parts.length === 2) {
									const entity = parts[0];
									const oldHoleID = parts[1];
									if (entity === sourceHole.entityName && oldToNewHoleIDMap.has(oldHoleID)) {
										h.fromHoleID = entity + ":::" + oldToNewHoleIDMap.get(oldHoleID);
									}
								}
							}
						});

						// Remap charging keys to follow hole ID changes
						if (window.remapChargingKeys && oldToNewHoleIDMap.size > 0) {
							window.remapChargingKeys(oldToNewHoleIDMap);
						}

						// Step 10) Increment posID for all holes from insertion point onwards
						for (let i = globalIndex + 1; i < window.allBlastHoles.length; i++) {
							const h = window.allBlastHoles[i];
							if (h.entityName === sourceHole.entityName && h.rowID === sourceHole.rowID) {
								h.posID = String(parseInt(h.posID || 0) + 1);
							}
						}

						window.debouncedSaveHoles();
						window.debouncedUpdateTreeView();
						if (typeof window.redraw3D === "function") {
							window.redraw3D();
						} else {
							window.drawData(window.allBlastHoles, window.selectedHole);
						}
						window.updateStatusMessage("Inserted hole before " + sourceHole.holeID);
						setTimeout(() => window.updateStatusMessage(""), 2000);
					}
				},
				// onAfter callback - Insert AFTER the selected hole
				customID => {
					// Step 1) Validate custom hole ID
					if (customID && customID.trim()) {
						const trimmedID = customID.trim();
						const existingHole = window.allBlastHoles.find(h => h.entityName === sourceHole.entityName && h.holeID === trimmedID);
						if (existingHole) {
							window.showErrorDialog("Duplicate Hole ID", "Hole ID '" + trimmedID + "' already exists in entity '" + sourceHole.entityName + "'.\n\nPlease choose a different ID or leave blank to auto-renumber.", "OK");
							return;
						}
					}

					// Step 2) Calculate insert position AFTER source hole
					let insertX, insertY, insertZ;
					const nextHole = sourceIndex < holesInRow.length - 1 ? holesInRow[sourceIndex + 1] : null;

					if (nextHole) {
						// Midpoint between source and next hole
						insertX = (sourceHole.startXLocation + nextHole.startXLocation) / 2;
						insertY = (sourceHole.startYLocation + nextHole.startYLocation) / 2;
						insertZ = (sourceHole.startZLocation + nextHole.startZLocation) / 2;
					} else {
						// At end of row - use spacing and bearing from last two holes
						const spacing = sourceHole.spacing || 3;
						let bearing;
						if (holesInRow.length >= 2) {
							const lastIdx = holesInRow.length - 1;
							bearing = calculateBearingFromHoles(holesInRow[lastIdx - 1], holesInRow[lastIdx]);
						} else {
							bearing = sourceHole.holeBearing || 0;
						}
						const bearingRad = bearing * Math.PI / 180;
						insertX = sourceHole.startXLocation + spacing * Math.sin(bearingRad);
						insertY = sourceHole.startYLocation + spacing * Math.cos(bearingRad);
						insertZ = sourceHole.startZLocation;
					}

					// Step 3) Create new hole - DO NOT copy fromHoleID from source
					const newHole = {
						...sourceHole,
						holeID: customID && customID.trim() ? customID.trim() : "TEMP_ID",
						startXLocation: insertX,
						startYLocation: insertY,
						startZLocation: insertZ,
						posID: sourceHole.posID ? String(parseInt(sourceHole.posID) + 1) : "1",
						visible: true,
						hasCustomID: customID && customID.trim() ? true : false,
						// Step 3a) Clear fromHoleID - will be set to self after final holeID is assigned
						fromHoleID: ""
					};

					// Step 4) Remove copied geometry properties so they'll be recalculated
					delete newHole.endXLocation;
					delete newHole.endYLocation;
					delete newHole.endZLocation;
					delete newHole.gradeXLocation;
					delete newHole.gradeYLocation;
					delete newHole.gradeZLocation;
					delete newHole.benchHeight;

					const globalIndex = window.allBlastHoles.findIndex(h => h.holeID === sourceHole.holeID && h.entityName === sourceHole.entityName);

					if (globalIndex !== -1) {
						// Step 5) Insert hole into array FIRST (calculateHoleGeometry needs it to exist in array)
						window.allBlastHoles.splice(globalIndex + 1, 0, newHole);

						// Step 6) Recalculate geometry based on new collar position using mode 1 (Length)
						if (typeof window.calculateHoleGeometry === "function") {
							window.calculateHoleGeometry(newHole, newHole.holeLengthCalculated, 1);
						}

						// Step 7) Build oldToNewHoleIDMap BEFORE renumbering to track changes
						const oldToNewHoleIDMap = new Map();

						if (!customID || !customID.trim()) {
							const sourceNum = sourceHole.holeID.match(/\d+/);
							const sourceNumber = sourceNum ? parseInt(sourceNum[0]) : 1;
							const prefix = sourceHole.holeID.replace(/\d+/g, "");
							
							// Step 7a) Assign new hole its ID
							newHole.holeID = prefix + (sourceNumber + 1);
							
							// Step 7b) Renumber ONLY holes after the inserted one, building the mapping
							let nextNum = sourceNumber + 2;
							for (let i = globalIndex + 2; i < window.allBlastHoles.length; i++) {
								const h = window.allBlastHoles[i];
								if (h.entityName === sourceHole.entityName) {
									if (!h.hasCustomID) {
										const oldID = h.holeID;
										const newID = prefix + nextNum;
										oldToNewHoleIDMap.set(oldID, newID);
										h.holeID = newID;
									}
									nextNum++;
								}
							}
						}

						// Step 8) Set new hole's fromHoleID to point to itself (self-connected)
						newHole.fromHoleID = sourceHole.entityName + ":::" + newHole.holeID;

						// Step 9) Update fromHoleID references for all holes in this entity
						window.allBlastHoles.forEach(h => {
							if (h.fromHoleID && h !== newHole) {
								const parts = h.fromHoleID.split(":::");
								if (parts.length === 2) {
									const entity = parts[0];
									const oldHoleID = parts[1];
									if (entity === sourceHole.entityName && oldToNewHoleIDMap.has(oldHoleID)) {
										h.fromHoleID = entity + ":::" + oldToNewHoleIDMap.get(oldHoleID);
									}
								}
							}
						});

						// Remap charging keys to follow hole ID changes
						if (window.remapChargingKeys && oldToNewHoleIDMap.size > 0) {
							window.remapChargingKeys(oldToNewHoleIDMap);
						}

						// Step 10) Increment posID for all holes after insertion
						for (let i = globalIndex + 2; i < window.allBlastHoles.length; i++) {
							const h = window.allBlastHoles[i];
							if (h.entityName === sourceHole.entityName && h.rowID === sourceHole.rowID) {
								h.posID = String(parseInt(h.posID || 0) + 1);
							}
						}

						window.debouncedSaveHoles();
						window.debouncedUpdateTreeView();
						if (typeof window.redraw3D === "function") {
							window.redraw3D();
						} else {
							window.drawData(window.allBlastHoles, window.selectedHole);
						}
						window.updateStatusMessage("Inserted hole after " + sourceHole.holeID);
						setTimeout(() => window.updateStatusMessage(""), 2000);
					}
				},
				// onCancel callback
				() => {
					window.updateStatusMessage("Insert cancelled");
					setTimeout(() => window.updateStatusMessage(""), 1500);
				}
			);
		}
	});

	dialog.show();

	// Step 10f) Initialize HoleSectionView for Loading tab after dialog is visible
	if (sectionViewRef) {
		requestAnimationFrame(function() {
			try {
				// Dynamic import to avoid circular dependency
				import("../../charging/ui/HoleSectionView.js").then(function(mod) {
					var sv = new mod.HoleSectionView({
						canvas: sectionViewRef.canvas,
						padding: 20,
						holeDiameterMm: sectionViewRef.holeDiameterMm,
						fontSizeOffset: 2
					});
					sv.setData(sectionViewRef.holeCharging);
				});
			} catch (e) {
				console.warn("Could not load HoleSectionView for Loading tab:", e);
			}
		});
	}
}

// Step 11) Process hole property updates (extracted from original logic)
export function processHolePropertyUpdates(holes, formData, originalValues, isMultiple) {
	// Step 11a) Helper function to handle relative/absolute value changes
	// Uses "=" prefix for calculations: =+1 adds 1, =-1 subtracts 1
	// Plain numbers (including negatives like -0.3) are treated as absolute/literal values
	function processNumericValue(inputValue, originalValue, currentHoleValue) {
		if (inputValue === "" || inputValue === originalValue) {
			return null; // No change
		}

		// Step 11a.1) Check for formula/calculation mode (starts with =)
		if (inputValue.startsWith("=")) {
			// Step 11a.2) Parse the expression after the = sign
			// e.g., "=+1" -> "+1" -> adds 1, "=-0.3" -> "-0.3" -> subtracts 0.3
			var expression = inputValue.substring(1);
			var delta = parseFloat(expression);
			if (!isNaN(delta)) {
				return currentHoleValue + delta;
			}
		} else {
			// Step 11a.3) Absolute/literal value (including negative numbers like -0.3)
			var absoluteValue = parseFloat(inputValue);
			if (!isNaN(absoluteValue)) {
				return absoluteValue;
			}
		}
		return null; // Invalid input
	}

	// Step 11b) NEW: Track which fields were actually modified by the user
	const modifiedFields = new Set();

	// Step 11b.1) Helper to normalize color values for comparison
	function normalizeColor(color) {
		if (!color) return "#000000";
		var c = String(color).trim().toUpperCase();
		if (!c.startsWith("#")) c = "#" + c;
		// Ensure 6 digits
		if (c.length === 4) {
			c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
		}
		return c;
	}

	// Check each field to see if it was actually changed from the original average
	if (formData.delay !== originalValues.delay) modifiedFields.add("delay");
	// Step 11b.2) Normalize colors before comparing
	if (normalizeColor(formData.delayColor) !== normalizeColor(originalValues.delayColor)) modifiedFields.add("delayColor");
	if (formData.holeType !== originalValues.holeType) modifiedFields.add("holeType");
	if (formData.diameter !== originalValues.diameter) modifiedFields.add("diameter");
	if (formData.bearing !== originalValues.bearing) modifiedFields.add("bearing");
	if (formData.angle !== originalValues.angle) modifiedFields.add("angle");
	if (formData.subdrill !== originalValues.subdrill) modifiedFields.add("subdrill");
	if (formData.collarZ !== originalValues.collarZ) modifiedFields.add("collarZ");
	if (formData.gradeZ !== originalValues.gradeZ) modifiedFields.add("gradeZ");
	if (formData.connectorCurve !== originalValues.connectorCurve) modifiedFields.add("connectorCurve");
	if (formData.burden !== originalValues.burden) modifiedFields.add("burden");
	if (formData.spacing !== originalValues.spacing) modifiedFields.add("spacing");

	// For single hole edits, also check Row ID and Pos ID
	if (!isMultiple) {
		if (formData.rowID !== originalValues.rowID) modifiedFields.add("rowID");
		if (formData.posID !== originalValues.posID) modifiedFields.add("posID");
	}

	// Step 11c) Handle hole type: check if custom or standard
	let newHoleType = formData.holeType;
	if (newHoleType === "__CUSTOM__") {
		newHoleType = formData.customType.trim();
		if (newHoleType !== originalValues.holeType) modifiedFields.add("holeType");
	}

	// Step 11d) Track if any timing-related properties were changed
	let timingChanged = false;
	let geometryChanged = false;

	holes.forEach(h => {
		// Step 11d.1) ONLY process fields that were actually modified
		if (modifiedFields.has("delay")) {
			const processedDelay = processNumericValue(formData.delay, originalValues.delay, h.holeDelay !== undefined ? h.holeDelay : h.timingDelayMilliseconds || 0);
			if (processedDelay !== null) {
				h.holeDelay = processedDelay;
				if (h.timingDelayMilliseconds !== undefined) {
					h.timingDelayMilliseconds = processedDelay;
				}
				timingChanged = true;
			}
		}

		if (modifiedFields.has("delayColor")) {
			h.holeDelayColor = formData.delayColor;
			if (h.colorHexDecimal !== undefined) {
				h.colorHexDecimal = formData.delayColor;
			}
			timingChanged = true;
		}

		if (modifiedFields.has("holeType")) {
			h.holeType = newHoleType;
		}

		// Update geometry properties only if modified
		if (modifiedFields.has("diameter")) {
			const processedDiameter = processNumericValue(formData.diameter, originalValues.diameter, h.holeDiameter || 0);
			if (processedDiameter !== null) {
				window.calculateHoleGeometry(h, processedDiameter, 7);
				geometryChanged = true;
			}
		}

		if (modifiedFields.has("bearing")) {
			const processedBearing = processNumericValue(formData.bearing, originalValues.bearing, h.holeBearing || 0);
			if (processedBearing !== null) {
				window.calculateHoleGeometry(h, processedBearing, 3);
				geometryChanged = true;
			}
		}

		if (modifiedFields.has("angle")) {
			const processedAngle = processNumericValue(formData.angle, originalValues.angle, h.holeAngle || 0);
			if (processedAngle !== null) {
				window.calculateHoleGeometry(h, processedAngle, 2);
				geometryChanged = true;
			}
		}

		if (modifiedFields.has("subdrill")) {
			const processedSubdrill = processNumericValue(formData.subdrill, originalValues.subdrill, h.subdrillAmount || 0);
			if (processedSubdrill !== null) {
				window.calculateHoleGeometry(h, processedSubdrill, 8);
				geometryChanged = true;
			}
		}

		if (modifiedFields.has("collarZ")) {
			const processedCollarZ = processNumericValue(formData.collarZ, originalValues.collarZ, h.startZLocation || 0);
			if (processedCollarZ !== null) {
				// Step 1) Calculate the delta (shift amount)
				const deltaZ = processedCollarZ - h.startZLocation;

				// Step 2) Shift all Z coordinates by the same delta to maintain hole geometry
				h.startZLocation = processedCollarZ;
				h.gradeZLocation += deltaZ;
				h.endZLocation += deltaZ;

				geometryChanged = true;
			}
		}

		if (modifiedFields.has("gradeZ")) {
			const processedGradeZ = processNumericValue(formData.gradeZ, originalValues.gradeZ, h.gradeZLocation || h.endZLocation || 0);
			if (processedGradeZ !== null) {
				// Step 1) Calculate new benchHeight from the new gradeZ
				// The grade point slides along the hole vector, maintaining angle and bearing
				const newBenchHeight = h.startZLocation - processedGradeZ;

				// Step 2) Use mode 9 (BenchHeight) to recalculate all geometry properly
				window.calculateHoleGeometry(h, newBenchHeight, 9);

				geometryChanged = true;
			}
		}

		if (modifiedFields.has("connectorCurve")) {
			// Step 11d.2) Treat connectorCurve as absolute value only (no relative adjustments)
			const curveValue = parseFloat(formData.connectorCurve);
			if (!isNaN(curveValue)) {
				h.connectorCurve = curveValue;
				timingChanged = true; // Since this affects visual display
			}
		}

		if (modifiedFields.has("burden")) {
			const processedBurden = processNumericValue(formData.burden, originalValues.burden, h.burden || 0);
			if (processedBurden !== null) {
				h.burden = processedBurden;
			}
		}

		if (modifiedFields.has("spacing")) {
			const processedSpacing = processNumericValue(formData.spacing, originalValues.spacing, h.spacing || 0);
			if (processedSpacing !== null) {
				h.spacing = processedSpacing;
			}
		}

		// Update Row ID and Pos ID only for single hole edits
		if (!isMultiple) {
			if (modifiedFields.has("rowID")) {
				h.rowID = formData.rowID;
			}
			if (modifiedFields.has("posID")) {
				h.posID = formData.posID;
			}
		}
	});

	// Step 12) Trigger updates
	if (timingChanged) {
		if (window.onTimingChanged) {
			window.onTimingChanged();
		}
	}

	if (geometryChanged) {
		// Auto-recalculate charging per-hole (only for holes with autoRecalculate=true)
		if (window.loadedCharging) {
			let chargingUpdated = 0;
			holes.forEach(function(h) {
				const hc = window.loadedCharging.get(chargingKey(h));
				if (hc && hc.autoRecalculate !== false && typeof hc.updateDimensions === "function") {
					const result = hc.updateDimensions(h);
					if (result.lengthRescaled || result.diameterUpdated) {
						chargingUpdated++;
					}
				}
			});
			if (chargingUpdated > 0) {
				// Persist updated charging
				if (typeof window.debouncedSaveCharging === "function") {
					window.debouncedSaveCharging();
				}
				console.log("Auto-recalculated charging for", chargingUpdated, "holes");
			}
		}
	}

	// Redraw and save
	if (typeof window.redraw3D === "function") {
		window.redraw3D();
	} else {
		window.drawData(window.allBlastHoles, window.selectedHole);
	}
	window.debouncedUpdateTreeView();
	window.debouncedSaveHoles();

	// Show status message
	const message = isMultiple ? "Updated " + holes.length + " holes" : "Updated hole " + holes[0].holeID;
	window.updateStatusMessage(message);
	setTimeout(() => window.updateStatusMessage(""), 2000);
}

//===========================================
// ROW EDITING TOOLS - Phase 9
//===========================================

/**
 * Show dialog to invert row order for an entity
 * @param {string} preselectedEntity - Optional entity name to preselect
 */
export function showInvertRowsDialog(preselectedEntity) {
	// Get available entities
	var entityNames = window.getBlastEntityNames ? window.getBlastEntityNames() : [];
	if (entityNames.length === 0) {
		window.showErrorDialog("No Entities", "No blast entities found. Import or create holes first.", "OK");
		return;
	}

	// Build entity options
	var entityOptions = entityNames.map(function(name) {
		return { value: name, text: name };
	});

	var fields = [
		{
			label: "Entity",
			name: "entityName",
			type: "select",
			value: preselectedEntity || entityNames[0],
			options: entityOptions
		},
		{
			label: "Also invert positions within rows",
			name: "invertPositions",
			type: "checkbox",
			value: false
		}
	];

	var formContent = window.createEnhancedFormContent(fields);

	var dialog = new window.FloatingDialog({
		title: "Invert Row Order",
		content: formContent,
		width: 350,
		height: 200,
		showConfirm: true,
		showCancel: true,
		confirmText: "Invert",
		cancelText: "Cancel",
		onConfirm: function() {
			var formData = window.getFormData(formContent);
			var result = window.invertRowOrder(formData.entityName, {
				invertPositions: formData.invertPositions
			});
			if (result.success) {
				window.updateStatusMessage("Inverted " + result.rowCount + " rows (" + result.modifiedCount + " holes)");
				setTimeout(function() { window.updateStatusMessage(""); }, 2000);
			} else {
				window.showErrorDialog("Invert Failed", result.error, "OK");
			}
		}
	});
	dialog.show();
}

/**
 * Show dialog to resequence positions within rows
 * @param {string} preselectedEntity - Optional entity name to preselect
 */
export function showResequencePositionsDialog(preselectedEntity) {
	// Get available entities
	var entityNames = window.getBlastEntityNames ? window.getBlastEntityNames() : [];
	if (entityNames.length === 0) {
		window.showErrorDialog("No Entities", "No blast entities found. Import or create holes first.", "OK");
		return;
	}

	// Build entity options
	var entityOptions = entityNames.map(function(name) {
		return { value: name, text: name };
	});

	var fields = [
		{
			label: "Entity",
			name: "entityName",
			type: "select",
			value: preselectedEntity || entityNames[0],
			options: entityOptions
		},
		{
			label: "Direction",
			name: "direction",
			type: "select",
			value: "forward",
			options: [
				{ value: "forward", text: "Forward (all same direction)" },
				{ value: "serpentine", text: "Serpentine (alternating)" }
			]
		},
		{
			label: "Order By",
			name: "orderBy",
			type: "select",
			value: "spatial",
			options: [
				{ value: "spatial", text: "Spatial (by position along row)" },
				{ value: "existing", text: "Existing (by current posID)" }
			]
		},
		{
			label: "Start Position",
			name: "startPos",
			type: "number",
			value: 1,
			min: 1,
			step: 1
		}
	];

	var formContent = window.createEnhancedFormContent(fields);

	var dialog = new window.FloatingDialog({
		title: "Resequence Positions",
		content: formContent,
		width: 350,
		height: 280,
		showConfirm: true,
		showCancel: true,
		confirmText: "Apply",
		cancelText: "Cancel",
		onConfirm: function() {
			var formData = window.getFormData(formContent);
			var result = window.resequencePositions(formData.entityName, {
				direction: formData.direction,
				orderBy: formData.orderBy,
				startPos: parseInt(formData.startPos) || 1
			});
			if (result.success) {
				window.updateStatusMessage("Resequenced " + result.modifiedCount + " holes in " + result.rowCount + " rows (" + result.direction + ")");
				setTimeout(function() { window.updateStatusMessage(""); }, 2000);
			} else {
				window.showErrorDialog("Resequence Failed", result.error, "OK");
			}
		}
	});
	dialog.show();
}

/**
 * Show dialog to assign a new row to selected holes
 */
export function showAssignRowDialog() {
	var selectedHoles = window.selectedMultipleHoles || (window.selectedHole ? [window.selectedHole] : []);
	if (selectedHoles.length === 0) {
		window.showErrorDialog("No Selection", "Select holes first, then use this tool to assign them to a row.", "OK");
		return;
	}

	// Get current entity and row info
	var entityName = selectedHoles[0].entityName || "Unknown";
	var currentRowIDs = [];
	selectedHoles.forEach(function(h) {
		if (h.rowID !== undefined && currentRowIDs.indexOf(h.rowID) === -1) {
			currentRowIDs.push(h.rowID);
		}
	});

	var currentRowText = currentRowIDs.length > 1 ? "Multiple (" + currentRowIDs.join(", ") + ")" : (currentRowIDs[0] || "None");

	var fields = [
		{
			label: "Selected Holes",
			name: "selectedCount",
			type: "text",
			value: selectedHoles.length + " hole(s) in " + entityName,
			disabled: true
		},
		{
			label: "Current Row(s)",
			name: "currentRows",
			type: "text",
			value: currentRowText,
			disabled: true
		},
		{
			label: "New Row ID",
			name: "newRowID",
			type: "number",
			value: 1,
			min: 1,
			step: 1
		}
	];

	var formContent = window.createEnhancedFormContent(fields);

	var dialog = new window.FloatingDialog({
		title: "Assign Row to Holes",
		content: formContent,
		width: 350,
		height: 220,
		showConfirm: true,
		showCancel: true,
		confirmText: "Assign",
		cancelText: "Cancel",
		onConfirm: function() {
			var formData = window.getFormData(formContent);
			var newRowID = parseInt(formData.newRowID);
			if (isNaN(newRowID) || newRowID < 1) {
				window.showErrorDialog("Invalid Row ID", "Please enter a valid positive row number.", "OK");
				return;
			}
			var result = window.assignRowToHoles(selectedHoles, newRowID);
			if (result.success) {
				window.updateStatusMessage("Assigned " + result.modifiedCount + " holes to Row " + result.newRowID);
				setTimeout(function() { window.updateStatusMessage(""); }, 2000);
			} else {
				window.showErrorDialog("Assign Failed", result.error, "OK");
			}
		}
	});
	dialog.show();
}

/**
 * Show dialog to rename rows by mapping old IDs to new IDs
 * @param {string} preselectedEntity - Optional entity name to preselect
 */
export function showRenameRowsDialog(preselectedEntity) {
	// Get available entities
	var entityNames = window.getBlastEntityNames ? window.getBlastEntityNames() : [];
	if (entityNames.length === 0) {
		window.showErrorDialog("No Entities", "No blast entities found. Import or create holes first.", "OK");
		return;
	}

	// Build entity options
	var entityOptions = entityNames.map(function(name) {
		return { value: name, text: name };
	});

	// Get rows for first entity
	var firstEntity = preselectedEntity || entityNames[0];
	var rowIDs = window.getEntityRowIDs ? window.getEntityRowIDs(firstEntity) : [];
	var rowListText = rowIDs.length > 0 ? "Current rows: " + rowIDs.join(", ") : "No rows detected";

	var fields = [
		{
			label: "Entity",
			name: "entityName",
			type: "select",
			value: firstEntity,
			options: entityOptions
		},
		{
			label: "Row Info",
			name: "rowInfo",
			type: "text",
			value: rowListText,
			disabled: true
		},
		{
			label: "Mapping (oldID:newID, ...)",
			name: "mapping",
			type: "text",
			value: "",
			placeholder: "e.g., 1:3, 2:1, 3:2"
		}
	];

	var formContent = window.createEnhancedFormContent(fields);

	// Add help text
	var helpDiv = document.createElement("div");
	helpDiv.style.cssText = "margin-top:10px;font-size:11px;color:#666;";
	helpDiv.innerHTML = "<b>Mapping format:</b> oldRowID:newRowID pairs separated by commas.<br>" +
		"Example: <code>1:3, 2:1, 3:2</code> swaps rows 1→3, 2→1, 3→2";
	formContent.appendChild(helpDiv);

	var dialog = new window.FloatingDialog({
		title: "Rename Rows",
		content: formContent,
		width: 380,
		height: 280,
		showConfirm: true,
		showCancel: true,
		confirmText: "Apply",
		cancelText: "Cancel",
		onConfirm: function() {
			var formData = window.getFormData(formContent);
			var mappingStr = formData.mapping || "";

			// Parse mapping string
			var rowMapping = {};
			var pairs = mappingStr.split(",");
			var parseError = false;
			pairs.forEach(function(pair) {
				var parts = pair.trim().split(":");
				if (parts.length === 2) {
					var oldID = parseInt(parts[0].trim());
					var newID = parseInt(parts[1].trim());
					if (!isNaN(oldID) && !isNaN(newID)) {
						rowMapping[oldID] = newID;
					} else {
						parseError = true;
					}
				} else if (pair.trim().length > 0) {
					parseError = true;
				}
			});

			if (parseError || Object.keys(rowMapping).length === 0) {
				window.showErrorDialog("Invalid Mapping", "Please enter a valid mapping.\nFormat: oldRowID:newRowID, ...\nExample: 1:3, 2:1, 3:2", "OK");
				return;
			}

			var result = window.renameRows(null, formData.entityName, rowMapping);
			if (result.success) {
				window.updateStatusMessage("Renamed rows: " + result.modifiedCount + " holes modified");
				setTimeout(function() { window.updateStatusMessage(""); }, 2000);
			} else {
				window.showErrorDialog("Rename Failed", result.error || "Unknown error", "OK");
			}
		}
	});
	dialog.show();
}

//===========================================
// HOLES CONTEXT MENU END
//===========================================

// Make functions available globally
window.showHolePropertyEditor = showHolePropertyEditor;
window.processHolePropertyUpdates = processHolePropertyUpdates;
window.showInvertRowsDialog = showInvertRowsDialog;
window.showResequencePositionsDialog = showResequencePositionsDialog;
window.showAssignRowDialog = showAssignRowDialog;
window.showRenameRowsDialog = showRenameRowsDialog;
