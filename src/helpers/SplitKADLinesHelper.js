/**
 * SplitKADLinesHelper.js
 *
 * Pure logic for splitting KAD line and polygon entities.
 * No UI — called by KADSplitLinesDialog.js.
 *
 * - Lines: split at one vertex → two lines sharing that vertex
 * - Polys: split at two vertices → two open lines
 *
 * Uses AddKADEntityAction / DeleteKADEntityAction for undo support.
 */

import { AddKADEntityAction, DeleteKADEntityAction } from "../tools/UndoActions.js";

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Split a KAD line at a single vertex index.
 *
 * @param {Object} config
 * @param {string} config.entityName   - Entity to split
 * @param {number} config.splitIndex   - Index of the vertex to split at (shared by both halves)
 * @param {boolean} config.deleteOriginal - Whether to delete the original (default true)
 * @returns {{ success: boolean, message: string, entityNames?: string[] }}
 */
export function splitKADLine(config) {
	var entityName = config.entityName;
	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;

	if (!entity || !entity.data) {
		return { success: false, message: "Entity not found: " + entityName };
	}
	if (entity.entityType !== "line") {
		return { success: false, message: "Entity must be a line (got: " + entity.entityType + ")." };
	}

	var points = entity.data;
	var n = points.length;

	if (n < 3) {
		return { success: false, message: "Line must have at least 3 points to split." };
	}

	var splitIndex = config.splitIndex;
	if (splitIndex <= 0 || splitIndex >= n - 1) {
		return { success: false, message: "Cannot split at first or last point. Pick a middle vertex." };
	}

	var deleteOriginal = config.deleteOriginal !== false;

	// Line A: points[0..splitIndex] inclusive
	var pointsA = [];
	for (var i = 0; i <= splitIndex; i++) {
		pointsA.push(JSON.parse(JSON.stringify(points[i])));
	}

	// Line B: points[splitIndex..end] inclusive (split vertex shared)
	var pointsB = [];
	for (var i = splitIndex; i < n; i++) {
		pointsB.push(JSON.parse(JSON.stringify(points[i])));
	}

	var nameA = entityName + "_A";
	var nameB = entityName + "_B";

	// Ensure unique names
	nameA = ensureUniqueName(nameA);
	nameB = ensureUniqueName(nameB);

	// Set metadata on points
	var refPoint = points[0];
	var color = refPoint.color || "#FFFFFF";
	var lineWidth = refPoint.lineWidth || 2;

	preparePoints(pointsA, nameA, "line", color, lineWidth);
	preparePoints(pointsB, nameB, "line", color, lineWidth);

	// Create entities
	var layerId = entity.layerId || null;
	var entityDataA = { entityType: "line", layerId: layerId, data: pointsA };
	var entityDataB = { entityType: "line", layerId: layerId, data: pointsB };

	// Undo batch
	if (window.undoManager) {
		window.undoManager.beginBatch("Split KAD Line: " + entityName);
	}

	window.allKADDrawingsMap.set(nameA, entityDataA);
	window.allKADDrawingsMap.set(nameB, entityDataB);

	if (window.undoManager) {
		window.undoManager.pushAction(new AddKADEntityAction(nameA, JSON.parse(JSON.stringify(entityDataA))));
		window.undoManager.pushAction(new AddKADEntityAction(nameB, JSON.parse(JSON.stringify(entityDataB))));
	}

	// Assign to layer
	assignToLayer(layerId, nameA);
	assignToLayer(layerId, nameB);

	if (deleteOriginal) {
		if (window.undoManager) {
			window.undoManager.pushAction(new DeleteKADEntityAction(entityName, JSON.parse(JSON.stringify(entity))));
		}
		window.allKADDrawingsMap.delete(entityName);
		removeFromLayers(entityName);
	}

	if (window.undoManager) {
		window.undoManager.endBatch();
	}

	// Post-creation refresh
	postRefresh();

	console.log("SplitKADLine: " + entityName + " → " + nameA + " (" + pointsA.length + " pts) + " + nameB + " (" + pointsB.length + " pts)");
	return {
		success: true,
		message: "Split into " + nameA + " (" + pointsA.length + " pts) and " + nameB + " (" + pointsB.length + " pts)",
		entityNames: [nameA, nameB]
	};
}

/**
 * Split a KAD polygon at two vertex indices into two open lines.
 *
 * @param {Object} config
 * @param {string} config.entityName   - Entity to split
 * @param {number} config.indexA       - First split vertex index
 * @param {number} config.indexB       - Second split vertex index
 * @param {boolean} config.deleteOriginal - Whether to delete the original (default true)
 * @returns {{ success: boolean, message: string, entityNames?: string[] }}
 */
export function splitKADPoly(config) {
	var entityName = config.entityName;
	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;

	if (!entity || !entity.data) {
		return { success: false, message: "Entity not found: " + entityName };
	}
	if (entity.entityType !== "poly") {
		return { success: false, message: "Entity must be a polygon (got: " + entity.entityType + ")." };
	}

	var points = entity.data;
	var n = points.length;

	if (n < 4) {
		return { success: false, message: "Polygon must have at least 4 points to split." };
	}

	var idxA = config.indexA;
	var idxB = config.indexB;

	if (idxA === idxB) {
		return { success: false, message: "Must select two different vertices." };
	}

	// Ensure idxA < idxB
	if (idxA > idxB) {
		var tmp = idxA;
		idxA = idxB;
		idxB = tmp;
	}

	var deleteOriginal = config.deleteOriginal !== false;

	// Path 1: walk from idxA to idxB (forward)
	var path1 = [];
	for (var i = idxA; i <= idxB; i++) {
		path1.push(JSON.parse(JSON.stringify(points[i])));
	}

	// Path 2: walk from idxB forward, wrapping to idxA
	var path2 = [];
	for (var i = idxB; i < n; i++) {
		path2.push(JSON.parse(JSON.stringify(points[i])));
	}
	for (var i = 0; i <= idxA; i++) {
		path2.push(JSON.parse(JSON.stringify(points[i])));
	}

	var nameA = entityName + "_A";
	var nameB = entityName + "_B";

	nameA = ensureUniqueName(nameA);
	nameB = ensureUniqueName(nameB);

	var refPoint = points[0];
	var color = refPoint.color || "#FFFFFF";
	var lineWidth = refPoint.lineWidth || 2;

	preparePoints(path1, nameA, "line", color, lineWidth);
	preparePoints(path2, nameB, "line", color, lineWidth);

	var layerId = entity.layerId || null;
	var entityDataA = { entityType: "line", layerId: layerId, data: path1 };
	var entityDataB = { entityType: "line", layerId: layerId, data: path2 };

	// Undo batch
	if (window.undoManager) {
		window.undoManager.beginBatch("Split KAD Polygon: " + entityName);
	}

	window.allKADDrawingsMap.set(nameA, entityDataA);
	window.allKADDrawingsMap.set(nameB, entityDataB);

	if (window.undoManager) {
		window.undoManager.pushAction(new AddKADEntityAction(nameA, JSON.parse(JSON.stringify(entityDataA))));
		window.undoManager.pushAction(new AddKADEntityAction(nameB, JSON.parse(JSON.stringify(entityDataB))));
	}

	assignToLayer(layerId, nameA);
	assignToLayer(layerId, nameB);

	if (deleteOriginal) {
		if (window.undoManager) {
			window.undoManager.pushAction(new DeleteKADEntityAction(entityName, JSON.parse(JSON.stringify(entity))));
		}
		window.allKADDrawingsMap.delete(entityName);
		removeFromLayers(entityName);
	}

	if (window.undoManager) {
		window.undoManager.endBatch();
	}

	postRefresh();

	console.log("SplitKADPoly: " + entityName + " → " + nameA + " (" + path1.length + " pts) + " + nameB + " (" + path2.length + " pts)");
	return {
		success: true,
		message: "Split into " + nameA + " (" + path1.length + " pts) and " + nameB + " (" + path2.length + " pts)",
		entityNames: [nameA, nameB]
	};
}

// ────────────────────────────────────────────────────────
// Internal utilities
// ────────────────────────────────────────────────────────

function preparePoints(points, entityName, entityType, color, lineWidth) {
	for (var i = 0; i < points.length; i++) {
		points[i].pointID = i + 1;
		points[i].entityName = entityName;
		points[i].entityType = entityType;
		points[i].closed = false;
		points[i].color = color;
		points[i].lineWidth = lineWidth;
	}
}

function ensureUniqueName(name) {
	if (!window.allKADDrawingsMap) return name;
	var candidate = name;
	var counter = 1;
	while (window.allKADDrawingsMap.has(candidate)) {
		candidate = name + "_" + counter;
		counter++;
	}
	return candidate;
}

function assignToLayer(layerId, entityName) {
	if (layerId && window.allDrawingLayers) {
		var layer = window.allDrawingLayers.get(layerId);
		if (layer && layer.entities) {
			layer.entities.add(entityName);
		}
	}
}

function removeFromLayers(entityName) {
	if (window.allDrawingLayers) {
		window.allDrawingLayers.forEach(function (layer) {
			if (layer.entities) {
				layer.entities.delete(entityName);
			}
		});
	}
}

function postRefresh() {
	window.threeKADNeedsRebuild = true;
	if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
	if (typeof window.debouncedSaveKAD === "function") window.debouncedSaveKAD();
	if (typeof window.debouncedSaveLayers === "function") window.debouncedSaveLayers();
	if (typeof window.debouncedUpdateTreeView === "function") window.debouncedUpdateTreeView();
}
