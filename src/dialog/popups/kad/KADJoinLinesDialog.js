/**
 * KADJoinLinesDialog.js
 *
 * Join two KAD line entities end-to-end via interactive screen picking.
 *
 * Flow:
 *  1) User clicks Join button → dialog opens immediately with instructions
 *  2) User clicks a START or END vertex on the canvas → Line A row updates live
 *  3) User clicks a START or END vertex on a different line → Line B row updates
 *  4) User adjusts options and clicks Execute
 *
 * The dialog stays open the entire time, acting as both instruction panel and
 * confirmation form. Works in both 2D and 3D views.
 *
 * Uses FloatingDialog + createEnhancedFormContent.
 */

import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import { joinKADLines, getLineEndpoints, distance3D } from "../../../helpers/JoinKADLinesHelper.js";

// ────────────────────────────────────────────────────────
// Module-scoped state
// ────────────────────────────────────────────────────────

var isJoinKADActive = false;
var joinStep = 0;           // 0=idle, 1=pick endpoint A, 2=pick endpoint B, 3=ready
var pickA = null;           // { entityName, endpoint, pointIndex, pointID, coords, pointCount }
var pickB = null;
var joinDialog = null;      // FloatingDialog reference

// Live DOM references inside the dialog
var pickADisplay = null;
var pickBDisplay = null;
var pickABtn = null;
var pickBBtn = null;
var distRow = null;
var formContent = null;
var executeBtn = null;

// ────────────────────────────────────────────────────────
// Public: entry point
// ────────────────────────────────────────────────────────

export function showKADJoinLinesDialog() {
	// Count available lines
	var lineCount = 0;
	if (window.allKADDrawingsMap) {
		window.allKADDrawingsMap.forEach(function (entity) {
			if (entity.entityType === "line" && entity.data && entity.data.length >= 2) {
				lineCount++;
			}
		});
	}

	if (lineCount < 2) {
		showInfoDialog("Need at least 2 KAD line entities.\nCreate line entities first, then use this tool.");
		return;
	}

	startJoinKADMode();
}

// ────────────────────────────────────────────────────────
// Interactive mode + dialog
// ────────────────────────────────────────────────────────

function startJoinKADMode() {
	isJoinKADActive = true;
	joinStep = 1;
	pickA = null;
	pickB = null;

	window.isJoinKADActive = true;

	// Activate KAD selection mode and pointer tool
	activateKADSelection();

	var btn = document.getElementById("kadJoinLinesBtn");
	if (btn) btn.classList.add("active");

	// Build and open the dialog immediately
	openLiveDialog();

	updateStatus("Click on a START or END vertex of a line");
	console.log("JoinKAD mode started");
}

function cancelJoinKADMode() {
	isJoinKADActive = false;
	joinStep = 0;
	pickA = null;
	pickB = null;

	window.isJoinKADActive = false;

	// Clear selection highlights
	window.selectedPoint = null;
	window.selectedKADObject = null;

	// Close dialog if open
	if (joinDialog) {
		joinDialog.close();
		joinDialog = null;
	}

	var btn = document.getElementById("kadJoinLinesBtn");
	if (btn) btn.classList.remove("active");

	updateStatus("");
	if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);

	console.log("JoinKAD mode cancelled");
}

// ────────────────────────────────────────────────────────
// Live dialog — open at start, updates as picks happen
// ────────────────────────────────────────────────────────

function openLiveDialog() {
	var container = document.createElement("div");
	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	// ── Line A pick row: Label | [target-arrow] | [display] ──
	var rowA = createPickRow("Line A", dark, function () {
		activateKADSelection();
		joinStep = 1;
		pickA = null;
		window.selectedPoint = null;
		window.selectedKADObject = null;
		if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
		refreshDialogContent();
		updateStatus("Click on a START or END vertex of a line");
	});
	pickABtn = rowA.pickBtn;
	pickADisplay = rowA.display;
	container.appendChild(rowA.row);

	// ── Line B pick row: Label | [target-arrow] | [display] ──
	var rowB = createPickRow("Line B", dark, function () {
		activateKADSelection();
		if (!pickA) {
			updateStatus("Pick Line A first");
			return;
		}
		joinStep = 2;
		pickB = null;
		window.selectedPoint = null;
		window.selectedKADObject = null;
		if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
		refreshDialogContent();
		updateStatus("Click on a START or END vertex of a different line");
	});
	pickBBtn = rowB.pickBtn;
	pickBDisplay = rowB.display;
	container.appendChild(rowB.row);

	// Distance display
	distRow = document.createElement("div");
	distRow.style.padding = "6px 8px";
	distRow.style.marginTop = "4px";
	distRow.style.fontSize = "12px";
	distRow.style.borderRadius = "4px";
	container.appendChild(distRow);

	// Options form
	var fields = [
		{
			label: "Weld Tolerance",
			name: "weldTolerance",
			type: "number",
			value: 0.01,
			step: 0.001,
			min: 0,
			tooltip: "Max distance to merge joining endpoints"
		},
		{
			label: "New Entity Name",
			name: "newEntityName",
			type: "text",
			value: "Joined",
			tooltip: "Name for the joined line"
		},
		{
			label: "Close as Poly",
			name: "closeAsPoly",
			type: "checkbox",
			value: false,
			tooltip: "Close the joined line into a polygon"
		},
		{
			label: "Delete Originals",
			name: "deleteOriginals",
			type: "checkbox",
			value: true,
			tooltip: "Remove original lines after joining"
		}
	];

	formContent = createEnhancedFormContent(fields, false, false);
	formContent.style.marginTop = "8px";
	container.appendChild(formContent);

	// Wire tolerance changes to update distance
	var weldInput = formContent.querySelector("[name='weldTolerance']");
	if (weldInput) {
		weldInput.addEventListener("input", refreshDistRow);
	}

	// Render initial state
	refreshDialogContent();

	joinDialog = new FloatingDialog({
		title: "Join KAD Lines",
		content: container,
		layoutType: "default",
		width: 440,
		height: 380,
		showConfirm: true,
		showCancel: true,
		confirmText: "Execute",
		cancelText: "Cancel",
		onConfirm: function () {
			executeJoin();
		},
		onCancel: function () {
			cancelJoinKADMode();
		}
	});

	joinDialog.show();

	// Disable Execute until both picks are made — find the button after show()
	var buttons = joinDialog.dialogElement
		? joinDialog.dialogElement.querySelectorAll("button")
		: [];
	for (var i = 0; i < buttons.length; i++) {
		if (buttons[i].textContent.trim() === "Execute") {
			executeBtn = buttons[i];
			break;
		}
	}
	updateExecuteBtn();
}

/**
 * Create a pick row matching SurfaceBooleanDialog pattern:
 *   Label (bold, 80px) | [target-arrow btn 28x28] | [display span, flex:1]
 */
function createPickRow(label, dark, onPick) {
	var row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.gap = "8px";
	row.style.marginBottom = "6px";

	var labelEl = document.createElement("label");
	labelEl.textContent = label;
	labelEl.style.minWidth = "80px";
	labelEl.style.fontSize = "13px";
	labelEl.style.fontWeight = "bold";
	labelEl.style.flexShrink = "0";

	var pickBtn = document.createElement("button");
	pickBtn.type = "button";
	pickBtn.title = "Pick endpoint from canvas";
	pickBtn.style.width = "28px";
	pickBtn.style.height = "28px";
	pickBtn.style.padding = "2px";
	pickBtn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
	pickBtn.style.borderRadius = "4px";
	pickBtn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
	pickBtn.style.cursor = "pointer";
	pickBtn.style.flexShrink = "0";
	pickBtn.style.display = "flex";
	pickBtn.style.alignItems = "center";
	pickBtn.style.justifyContent = "center";

	var pickImg = document.createElement("img");
	pickImg.src = "icons/target-arrow.png";
	pickImg.style.width = "20px";
	pickImg.style.height = "20px";
	pickImg.style.filter = dark ? "invert(0.8)" : "invert(0.2)";
	pickBtn.appendChild(pickImg);

	pickBtn.addEventListener("click", onPick);

	var display = document.createElement("span");
	display.style.flex = "1";
	display.style.padding = "4px 6px";
	display.style.fontSize = "12px";
	display.style.borderRadius = "4px";
	display.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid #999";
	display.style.background = dark ? "rgba(30,30,30,0.9)" : "#fff";
	display.style.color = dark ? "#eee" : "#333";
	display.style.minWidth = "0";
	display.style.minHeight = "22px";
	display.style.overflow = "hidden";
	display.style.textOverflow = "ellipsis";
	display.style.whiteSpace = "nowrap";

	row.appendChild(labelEl);
	row.appendChild(pickBtn);
	row.appendChild(display);

	return { row: row, display: display, pickBtn: pickBtn };
}

function refreshDialogContent() {
	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	// Pick A display + button state
	if (pickA) {
		var labelA = pickA.endpoint === "start" ? "Start (#1)" : "End (#" + pickA.pointCount + ")";
		pickADisplay.textContent = escapeHTML(pickA.entityName) + " — " + labelA + " (" + pickA.pointCount + " pts)";
		pickADisplay.title = formatCoord(pickA.coords);
		setPickBtnState(pickABtn, false, dark);
	} else {
		pickADisplay.textContent = "— not picked —";
		pickADisplay.title = "";
		setPickBtnState(pickABtn, joinStep === 1, dark);
	}

	// Pick B display + button state
	if (pickB) {
		var labelB = pickB.endpoint === "start" ? "Start (#1)" : "End (#" + pickB.pointCount + ")";
		pickBDisplay.textContent = escapeHTML(pickB.entityName) + " — " + labelB + " (" + pickB.pointCount + " pts)";
		pickBDisplay.title = formatCoord(pickB.coords);
		setPickBtnState(pickBBtn, false, dark);
	} else {
		pickBDisplay.textContent = "— not picked —";
		pickBDisplay.title = "";
		setPickBtnState(pickBBtn, joinStep === 2, dark);
	}

	// Distance
	refreshDistRow();

	// Update default entity name when A is picked
	if (pickA && formContent) {
		var nameInput = formContent.querySelector("[name='newEntityName']");
		if (nameInput && (nameInput.value === "Joined" || nameInput.value === "")) {
			nameInput.value = pickA.entityName + "_joined";
		}
	}

	updateExecuteBtn();
}

/**
 * Toggle pick button active state — red when actively picking, neutral otherwise.
 */
function setPickBtnState(btn, active, dark) {
	if (!btn) return;
	if (active) {
		btn.style.background = "rgba(255,60,60,0.4)";
		btn.style.border = "1px solid #FF4444";
	} else {
		btn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		btn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
	}
}

function refreshDistRow() {
	if (pickA && pickB) {
		var dist = distance3D(pickA.coords, pickB.coords);
		var weldInput = formContent ? formContent.querySelector("[name='weldTolerance']") : null;
		var tol = weldInput ? parseFloat(weldInput.value) || 0.01 : 0.01;

		distRow.textContent = "Distance between endpoints: " + dist.toFixed(4) + " m";
		if (dist <= tol) {
			distRow.style.color = "#88FF88";
			distRow.textContent += " (will weld)";
		} else {
			distRow.style.color = "#FFAA44";
			distRow.textContent += " (gap — no weld)";
		}
	} else {
		distRow.textContent = "";
	}
}

function updateExecuteBtn() {
	if (executeBtn) {
		executeBtn.disabled = (joinStep < 3);
		executeBtn.style.opacity = (joinStep < 3) ? "0.4" : "1";
	}
}

// ────────────────────────────────────────────────────────
// Click handler
// ────────────────────────────────────────────────────────

/**
 * Handle click during join mode.
 * Called from kirra.js main click handler (2D and 3D).
 * @param {Object} clickedKADObject - From getClickedKADObject / getClickedKADVertex3DWithTolerance
 * @returns {boolean} true if click was consumed
 */
function handleJoinKADClick(clickedKADObject) {
	if (!isJoinKADActive) return false;

	var worldX, worldY;
	if (clickedKADObject) {
		worldX = clickedKADObject.pointXLocation;
		worldY = clickedKADObject.pointYLocation;
	} else {
		updateStatus("Click on a START or END vertex of a line");
		return true;
	}

	// Endpoint-only search — excludes already-picked entity on step 2
	var excludeEntity = (joinStep === 2 && pickA) ? pickA.entityName : null;
	var best = findNearestEndpoint(worldX, worldY, excludeEntity);

	if (!best) {
		updateStatus("No line endpoint found near click. Click on a START or END vertex.");
		return true;
	}

	var entityName = best.entityName;
	var entity = best.entity;
	var idx = best.pointIndex;
	var n = entity.data.length;
	var endpoint = (idx === 0) ? "start" : "end";
	var pt = entity.data[idx];
	var coords = {
		x: pt.pointXLocation,
		y: pt.pointYLocation,
		z: pt.pointZLocation || 0
	};

	var pickInfo = {
		entityName: entityName,
		endpoint: endpoint,
		pointIndex: idx,
		pointID: idx + 1,
		coords: coords,
		pointCount: n
	};

	if (joinStep === 1) {
		pickA = pickInfo;
		joinStep = 2;

		// Highlight vertex in 2D and 3D
		highlightVertex(entityName, "line", idx, pt);
		if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);

		// Update dialog live
		refreshDialogContent();
		updateStatus("Click on a START or END vertex of a different line");
		return true;

	} else if (joinStep === 2) {
		pickB = pickInfo;
		joinStep = 3;

		// Highlight vertex
		highlightVertex(entityName, "line", idx, pt);
		if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);

		// Update dialog live
		refreshDialogContent();
		updateStatus("Ready — adjust options in dialog and click Execute");
		return true;
	}

	return true;
}

// ────────────────────────────────────────────────────────
// Execute
// ────────────────────────────────────────────────────────

function executeJoin() {
	if (!pickA || !pickB || !formContent) {
		showInfoDialog("Both endpoints must be picked first.");
		return;
	}

	var formData = getFormData(formContent);

	var result = joinKADLines({
		entityNameA: pickA.entityName,
		entityNameB: pickB.entityName,
		endpointA: pickA.endpoint,
		endpointB: pickB.endpoint,
		weldTolerance: parseFloat(formData.weldTolerance) || 0.01,
		newEntityName: formData.newEntityName || (pickA.entityName + "_joined"),
		closeAsPoly: formData.closeAsPoly === "true" || formData.closeAsPoly === true,
		deleteOriginals: formData.deleteOriginals === "true" || formData.deleteOriginals === true
	});

	if (result.success) {
		console.log("KAD Join Lines: " + result.message);
	} else {
		showInfoDialog(result.message);
	}

	cancelJoinKADMode();
}

// ────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────

function highlightVertex(entityName, entityType, elementIndex, dataPoint) {
	if (!dataPoint) return;
	window.selectedKADObject = {
		entityName: entityName,
		entityType: entityType,
		elementIndex: elementIndex,
		selectionType: "vertex",
		pointXLocation: dataPoint.pointXLocation,
		pointYLocation: dataPoint.pointYLocation
	};
	window.selectedPoint = dataPoint;
}

function formatCoord(c) {
	return "(" + c.x.toFixed(2) + ", " + c.y.toFixed(2) + ", " + c.z.toFixed(2) + ")";
}

function escapeHTML(str) {
	var div = document.createElement("div");
	div.textContent = str;
	return div.innerHTML;
}

function updateStatus(msg) {
	if (typeof window.updateStatusMessage === "function") {
		window.updateStatusMessage(msg);
	}
}

/**
 * Search only start/end endpoints of line entities near the click.
 * Handles overlapping points by excluding a specific entity on step 2.
 */
function findNearestEndpoint(worldX, worldY, excludeEntity) {
	if (!window.allKADDrawingsMap) return null;

	var tolerance = typeof window.getSnapToleranceInWorldUnits === "function"
		? window.getSnapToleranceInWorldUnits()
		: 10;

	var best = null;
	var bestDist = tolerance;

	window.allKADDrawingsMap.forEach(function (entity, entityName) {
		if (entity.entityType !== "line" || !entity.data || entity.data.length < 2) return;
		if (excludeEntity && entityName === excludeEntity) return;
		if (typeof window.isEntityVisible === "function" && !window.isEntityVisible(entityName)) return;

		var endpoints = [0, entity.data.length - 1];
		for (var e = 0; e < endpoints.length; e++) {
			var idx = endpoints[e];
			var pt = entity.data[idx];
			if (pt.visible === false) continue;

			var dx = pt.pointXLocation - worldX;
			var dy = pt.pointYLocation - worldY;
			var dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < bestDist) {
				bestDist = dist;
				best = { entityName: entityName, entity: entity, pointIndex: idx };
			}
		}
	});

	return best;
}

function showInfoDialog(message) {
	var content = document.createElement("div");
	content.style.padding = "15px";
	content.style.whiteSpace = "pre-wrap";
	content.textContent = message;

	var dialog = new FloatingDialog({
		title: "Join KAD Lines",
		content: content,
		width: 400,
		height: 200,
		showConfirm: true,
		confirmText: "OK",
		showCancel: false
	});
	dialog.show();
}

/**
 * Activate KAD radio and selection pointer so interactive picking works.
 */
function activateKADSelection() {
	var kadRadio = window.selectKADRadio || document.getElementById("selectKAD");
	if (kadRadio) kadRadio.checked = true;

	var pointerTool = document.getElementById("selectPointer");
	if (pointerTool && !pointerTool.checked) {
		pointerTool.checked = true;
		pointerTool.dispatchEvent(new Event("change"));
	}
}

// ────────────────────────────────────────────────────────
// Window exposures for kirra.js integration
// ────────────────────────────────────────────────────────

window.handleJoinKADClick = handleJoinKADClick;
window.cancelJoinKADMode = cancelJoinKADMode;
