/**
 * SectionPlaneDialog.js
 *
 * Compact floating dialog for controlling a section clipping plane (or slab).
 * Controls operate in scene (local) coordinates — the slider is ±1000
 * around the current position. Front/back width inputs create a slab by
 * clipping with two parallel planes. World coordinate shown as info.
 */

import * as THREE from "three";
import { FloatingDialog } from "../../FloatingDialog.js";

// ────────────────────────────────────────────────────────
// Module state — persists across open/close
// ────────────────────────────────────────────────────────

var _dialog = null;
var _enabled = false;
var _plane = "XY";       // "XY" | "XZ" | "YZ"
var _position = 0;       // scene (local) coordinate — centre of slab
var _rotation = 0;       // degrees
var _frontWidth = 0;     // distance clipped in front of position (0 = no front clip)
var _backWidth = 0;      // distance clipped behind position (0 = no back clip)
var SLIDER_HALF = 1000;  // slider extends ±1000 from the number value

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

export function toggleSectionPlaneDialog() {
	if (_dialog) {
		_dialog.close();
		_dialog = null;
		return;
	}
	_showDialog();
}

export function isSectionPlaneEnabled() {
	return _enabled;
}

// ────────────────────────────────────────────────────────
// Coordinate helpers
// ────────────────────────────────────────────────────────

function _sceneToWorld(sceneVal) {
	if (_plane === "XY") return sceneVal;
	if (_plane === "XZ") return sceneVal + (window.threeLocalOriginY || 0);
	return sceneVal + (window.threeLocalOriginX || 0);
}

function _axisLabel() {
	if (_plane === "XY") return "Z";
	if (_plane === "XZ") return "Y";
	return "X";
}

function _getSceneBounds() {
	var minVal = -500, maxVal = 500;
	if (!window.loadedSurfaces) return { min: minVal, max: maxVal };

	var first = true;
	window.loadedSurfaces.forEach(function (surface) {
		if (!surface.meshBounds) return;
		var b = surface.meshBounds;
		var lo, hi;
		if (_plane === "XY") {
			lo = b.minZ; hi = b.maxZ;
		} else if (_plane === "XZ") {
			lo = b.minY - (window.threeLocalOriginY || 0);
			hi = b.maxY - (window.threeLocalOriginY || 0);
		} else {
			lo = b.minX - (window.threeLocalOriginX || 0);
			hi = b.maxX - (window.threeLocalOriginX || 0);
		}
		if (first || lo < minVal) minVal = lo;
		if (first || hi > maxVal) maxVal = hi;
		first = false;
	});

	return { min: minVal, max: maxVal };
}

// ────────────────────────────────────────────────────────
// Build & show dialog
// ────────────────────────────────────────────────────────

function _showDialog() {
	var sceneBounds = _getSceneBounds();
	if (_position === 0) _position = (sceneBounds.min + sceneBounds.max) / 2;

	var posSlider, posValue, rotSlider, rotValue, worldInfo;
	var frontInput, backInput;

	var container = document.createElement("div");
	container.style.cssText = "display:flex; flex-direction:column; gap:6px; user-select:none;";

	// ── Row 1: Enable toggle + Plane selector ──
	var row1 = document.createElement("div");
	row1.style.cssText = "display:flex; align-items:center; gap:8px;";

	var enableCb = document.createElement("input");
	enableCb.type = "checkbox";
	enableCb.checked = _enabled;
	enableCb.style.margin = "0";

	var enableLbl = document.createElement("label");
	enableLbl.style.cssText = "font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer;";
	enableLbl.appendChild(enableCb);
	enableLbl.appendChild(document.createTextNode("Enable"));
	row1.appendChild(enableLbl);

	var spacer = document.createElement("span");
	spacer.style.flex = "1";
	row1.appendChild(spacer);

	var planeLbl = document.createElement("span");
	planeLbl.textContent = "Plane:";
	planeLbl.style.fontSize = "11px";
	row1.appendChild(planeLbl);

	var planeSelect = document.createElement("select");
	planeSelect.style.cssText = "font-size:11px; padding:2px 4px;";
	var planes = ["XY", "XZ", "YZ"];
	for (var i = 0; i < planes.length; i++) {
		var opt = document.createElement("option");
		opt.value = planes[i];
		opt.textContent = planes[i];
		if (planes[i] === _plane) opt.selected = true;
		planeSelect.appendChild(opt);
	}
	row1.appendChild(planeSelect);
	container.appendChild(row1);

	// ── Position: label + number ──
	var posRow = document.createElement("div");
	posRow.style.cssText = "display:flex; align-items:center; gap:6px;";

	var posLbl = document.createElement("span");
	posLbl.textContent = "Position:";
	posLbl.style.cssText = "font-size:11px; min-width:56px;";
	posRow.appendChild(posLbl);

	posValue = document.createElement("input");
	posValue.type = "number";
	posValue.value = _position.toFixed(1);
	posValue.step = "0.1";
	posValue.style.cssText = "flex:1; font-size:11px; text-align:right;";
	posRow.appendChild(posValue);
	container.appendChild(posRow);

	// Position slider — 90% width, centred
	posSlider = document.createElement("input");
	posSlider.type = "range";
	posSlider.min = _position - SLIDER_HALF;
	posSlider.max = _position + SLIDER_HALF;
	posSlider.step = 0.1;
	posSlider.value = _position;
	posSlider.style.cssText = "width:90%; margin:0 auto; display:block;";
	container.appendChild(posSlider);

	// ── Clipping width: Front + Back ──
	var widthRow = document.createElement("div");
	widthRow.style.cssText = "display:flex; align-items:center; gap:6px;";

	var frontLbl = document.createElement("span");
	frontLbl.textContent = "+" + _axisLabel() + ":";
	frontLbl.style.cssText = "font-size:11px; min-width:34px;";
	widthRow.appendChild(frontLbl);

	frontInput = document.createElement("input");
	frontInput.type = "number";
	frontInput.value = _frontWidth;
	frontInput.step = "1";
	frontInput.title = "Clip distance in +" + _axisLabel() + " direction (0 = no clip)";
	frontInput.style.cssText = "width:60px; font-size:11px; text-align:right;";
	widthRow.appendChild(frontInput);

	var widthSpacer = document.createElement("span");
	widthSpacer.style.flex = "1";
	widthRow.appendChild(widthSpacer);

	var backLbl = document.createElement("span");
	backLbl.textContent = "-" + _axisLabel() + ":";
	backLbl.style.cssText = "font-size:11px; min-width:30px;";
	widthRow.appendChild(backLbl);

	backInput = document.createElement("input");
	backInput.type = "number";
	backInput.value = _backWidth;
	backInput.step = "1";
	backInput.title = "Clip distance in -" + _axisLabel() + " direction (0 = no clip)";
	backInput.style.cssText = "width:60px; font-size:11px; text-align:right;";
	widthRow.appendChild(backInput);
	container.appendChild(widthRow);

	// ── Rotation: label + number ──
	var rotRow = document.createElement("div");
	rotRow.style.cssText = "display:flex; align-items:center; gap:6px;";

	var rotLbl = document.createElement("span");
	rotLbl.textContent = "Rotation:";
	rotLbl.style.cssText = "font-size:11px; min-width:56px;";
	rotRow.appendChild(rotLbl);

	rotValue = document.createElement("input");
	rotValue.type = "number";
	rotValue.value = _rotation;
	rotValue.min = 0;
	rotValue.max = 720;
	rotValue.step = 1;
	rotValue.style.cssText = "flex:1; font-size:11px; text-align:right;";
	rotRow.appendChild(rotValue);

	var degSign = document.createElement("span");
	degSign.textContent = "\u00B0";
	degSign.style.fontSize = "11px";
	rotRow.appendChild(degSign);
	container.appendChild(rotRow);

	// Rotation slider — 90% width, centred
	rotSlider = document.createElement("input");
	rotSlider.type = "range";
	rotSlider.min = 0;
	rotSlider.max = 720;
	rotSlider.step = 1;
	rotSlider.value = _rotation;
	rotSlider.style.cssText = "width:90%; margin:0 auto; display:block;";
	container.appendChild(rotSlider);

	// ── World coordinate info ──
	worldInfo = document.createElement("div");
	worldInfo.style.cssText = "font-size:10px; color:#888; text-align:right; padding-right:2px;";
	_updateWorldInfo(worldInfo);
	container.appendChild(worldInfo);

	// ────────────────────────────────────────────────────
	// Helpers
	// ────────────────────────────────────────────────────

	function recentreSlider() {
		posSlider.min = _position - SLIDER_HALF;
		posSlider.max = _position + SLIDER_HALF;
		posSlider.value = _position;
	}

	function syncAll() {
		_applyClippingPlane();
		_updateWorldInfo(worldInfo);
	}

	// ────────────────────────────────────────────────────
	// Events
	// ────────────────────────────────────────────────────

	enableCb.addEventListener("change", function () {
		_enabled = enableCb.checked;
		syncAll();
	});

	planeSelect.addEventListener("change", function () {
		_plane = planeSelect.value;
		var axis = _axisLabel();
		frontLbl.textContent = "+" + axis + ":";
		frontInput.title = "Clip distance in +" + axis + " direction (0 = no clip)";
		backLbl.textContent = "-" + axis + ":";
		backInput.title = "Clip distance in -" + axis + " direction (0 = no clip)";
		var sb = _getSceneBounds();
		_position = (sb.min + sb.max) / 2;
		posValue.value = _position.toFixed(1);
		recentreSlider();
		syncAll();
	});

	posSlider.addEventListener("input", function () {
		_position = parseFloat(posSlider.value);
		posValue.value = _position.toFixed(1);
		syncAll();
	});

	posValue.addEventListener("change", function () {
		_position = parseFloat(posValue.value) || 0;
		posValue.value = _position.toFixed(1);
		recentreSlider();
		syncAll();
	});

	frontInput.addEventListener("change", function () {
		_frontWidth = parseFloat(frontInput.value) || 0;
		frontInput.value = _frontWidth;
		syncAll();
	});

	backInput.addEventListener("change", function () {
		_backWidth = parseFloat(backInput.value) || 0;
		backInput.value = _backWidth;
		syncAll();
	});

	rotSlider.addEventListener("input", function () {
		_rotation = parseFloat(rotSlider.value);
		rotValue.value = _rotation;
		syncAll();
	});

	rotValue.addEventListener("change", function () {
		_rotation = Math.max(0, Math.min(720, parseFloat(rotValue.value) || 0));
		rotSlider.value = _rotation;
		rotValue.value = _rotation;
		syncAll();
	});

	// ────────────────────────────────────────────────────
	// Dialog — Reset in footer, Close via cancel
	// ────────────────────────────────────────────────────

	_dialog = new FloatingDialog({
		title: "Section Plane",
		content: container,
		width: 350,
		height: 300,
		draggable: true,
		resizable: false,
		passthroughKeys: true, // Allow canvas key events (Delete, etc.) while this dialog is open
		showConfirm: true,
		confirmText: "Reset",
		showCancel: true,
		cancelText: "Close",
		onConfirm: function () {
			var sb = _getSceneBounds();
			_rotation = 0;
			_frontWidth = 0;
			_backWidth = 0;
			_position = (sb.min + sb.max) / 2;
			rotSlider.value = 0;
			rotValue.value = 0;
			frontInput.value = 0;
			backInput.value = 0;
			posValue.value = _position.toFixed(1);
			recentreSlider();
			syncAll();
			return false; // keep dialog open
		},
		onCancel: function () {
			_dialog = null;
		}
	});
	_dialog.show();
}

// ────────────────────────────────────────────────────────
// World info display
// ────────────────────────────────────────────────────────

function _updateWorldInfo(el) {
	var worldVal = _sceneToWorld(_position);
	var text = "World " + _axisLabel() + ": " + worldVal.toFixed(2);
	if (_frontWidth !== 0 || _backWidth !== 0) {
		var lo = worldVal - _backWidth;
		var hi = worldVal + _frontWidth;
		text += "  [" + lo.toFixed(1) + " \u2013 " + hi.toFixed(1) + "]";
	}
	el.textContent = text;
}

// ────────────────────────────────────────────────────────
// Build plane normal from settings
// ────────────────────────────────────────────────────────

function _buildNormal() {
	var radians = _rotation * Math.PI / 180;
	var nx = 0, ny = 0, nz = 0;

	if (_plane === "XY") {
		var cosR = Math.cos(radians);
		var sinR = Math.sin(radians);
		nx = 0; ny = -sinR; nz = cosR;
	} else if (_plane === "XZ") {
		var cosR2 = Math.cos(radians);
		var sinR2 = Math.sin(radians);
		nx = -sinR2; ny = cosR2; nz = 0;
	} else {
		var cosR3 = Math.cos(radians);
		var sinR3 = Math.sin(radians);
		nx = cosR3; ny = sinR3; nz = 0;
	}

	var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (len > 0) { nx /= len; ny /= len; nz /= len; }
	return { x: nx, y: ny, z: nz };
}

// ────────────────────────────────────────────────────────
// Apply clipping plane(s) to renderer
// ────────────────────────────────────────────────────────

function _applyClippingPlane() {
	var renderer = window.threeRenderer;
	if (!renderer || !renderer.renderer) return;

	if (!_enabled) {
		renderer.renderer.clippingPlanes = [];
		renderer.requestRender();
		return;
	}

	renderer.renderer.localClippingEnabled = true;

	var n = _buildNormal();
	var planes = [];

	// Front plane: clips everything ABOVE position + frontWidth
	// (keeps geometry below the front plane)
	if (_frontWidth !== 0) {
		var frontPos = _position + _frontWidth;
		planes.push(new THREE.Plane(
			new THREE.Vector3(n.x, n.y, n.z),
			-frontPos
		));
	}

	// Back plane: clips everything BELOW position - backWidth
	// (keeps geometry above the back plane — opposite normal)
	if (_backWidth !== 0) {
		var backPos = _position - _backWidth;
		planes.push(new THREE.Plane(
			new THREE.Vector3(-n.x, -n.y, -n.z),
			backPos
		));
	}

	// If neither width is set, use a single clip at position
	if (planes.length === 0) {
		planes.push(new THREE.Plane(
			new THREE.Vector3(n.x, n.y, n.z),
			-_position
		));
	}

	renderer.renderer.clippingPlanes = planes;
	renderer.requestRender();
}

// Expose globally for toolbar button
window.toggleSectionPlaneDialog = toggleSectionPlaneDialog;
