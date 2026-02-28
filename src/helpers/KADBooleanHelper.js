/**
 * KADBooleanHelper.js
 *
 * 2D boolean operations on KAD polygon entities using ClipperLib.
 * Operations: Union, Intersect, Difference, XOR.
 * Supports N polygons (not just 2).
 * Results stored as new KAD poly entities with undo/redo support.
 *
 * Reuses the createKADEntities pattern from SurfaceIntersectionHelper.
 */

import ClipperLib from "clipper-lib";
import { AddKADEntityAction } from "../tools/UndoActions.js";

var SCALE = 100000; // ClipperLib works in integers — matches existing pattern

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Execute a 2D boolean operation on N KAD polygon entities.
 *
 * For Union/XOR all polygons are added as subjects.
 * For Intersect/Difference the first is subject, the rest are clips.
 *
 * @param {Object} config
 * @param {string[]} config.entityNames - Array of entity names (>= 2)
 * @param {string}   config.operation   - "union" | "intersect" | "difference" | "xor"
 * @param {string}   config.color       - Hex color for result entities
 * @param {number}   config.lineWidth   - Line width for result entities
 * @param {string}   config.layerName   - Layer name for results (default "BOOLS")
 * @returns {number} - Number of result polygons created
 */
export function kadBoolean(config) {
	var names = config.entityNames;
	if (!names || names.length < 2) {
		console.error("KADBooleanHelper: Need at least 2 entity names");
		return 0;
	}

	// Step 1) Resolve entities
	var entities = [];
	for (var i = 0; i < names.length; i++) {
		var entity = window.allKADDrawingsMap
			? window.allKADDrawingsMap.get(names[i])
			: null;
		if (!entity || !entity.data || entity.data.length < 3) {
			console.error("KADBooleanHelper: Entity not found or too few points: " + names[i]);
			return 0;
		}
		entities.push(entity);
	}

	// Step 2) Convert to ClipperLib paths and normalise winding (CCW = outer)
	var paths = entities.map(function (e) { return entityToClipperPath(e); });
	for (var i = 0; i < paths.length; i++) {
		if (!ClipperLib.Clipper.Orientation(paths[i])) {
			paths[i].reverse();
		}
	}

	// Step 3) Compute average Z from all polygons
	var avgZ = computeAverageZ(entities);

	// Step 4) Map operation string to ClipperLib type
	var clipType;
	switch (config.operation) {
		case "union":      clipType = ClipperLib.ClipType.ctUnion; break;
		case "intersect":  clipType = ClipperLib.ClipType.ctIntersection; break;
		case "difference": clipType = ClipperLib.ClipType.ctDifference; break;
		case "xor":        clipType = ClipperLib.ClipType.ctXor; break;
		default:
			console.error("KADBooleanHelper: Unknown operation: " + config.operation);
			return 0;
	}

	// Step 5) Execute ClipperLib boolean
	var solution;
	var succeeded;

	if (config.operation === "union" && paths.length > 2) {
		// N-polygon union: iterative pairwise union.
		// Adding multiple clips with EvenOdd cancels overlapping clip regions.
		// Pairwise avoids this by only ever unioning 2 polygons per step.
		solution = [paths[0]];
		succeeded = true;
		for (var i = 1; i < paths.length; i++) {
			var stepCpr = new ClipperLib.Clipper();
			for (var r = 0; r < solution.length; r++) {
				stepCpr.AddPath(solution[r], ClipperLib.PolyType.ptSubject, true);
			}
			stepCpr.AddPath(paths[i], ClipperLib.PolyType.ptClip, true);
			var stepResult = new ClipperLib.Paths();
			var stepOk = stepCpr.Execute(
				ClipperLib.ClipType.ctUnion,
				stepResult,
				ClipperLib.PolyFillType.pftEvenOdd,
				ClipperLib.PolyFillType.pftEvenOdd
			);
			if (stepOk && stepResult.length > 0) {
				solution = stepResult;
			} else {
				succeeded = false;
				break;
			}
		}
	} else {
		// 2-polygon union, intersect, difference, xor: standard subject+clip
		var cpr = new ClipperLib.Clipper();
		cpr.AddPath(paths[0], ClipperLib.PolyType.ptSubject, true);
		for (var i = 1; i < paths.length; i++) {
			cpr.AddPath(paths[i], ClipperLib.PolyType.ptClip, true);
		}
		solution = new ClipperLib.Paths();
		succeeded = cpr.Execute(
			clipType,
			solution,
			ClipperLib.PolyFillType.pftEvenOdd,
			ClipperLib.PolyFillType.pftEvenOdd
		);
	}

	if (!succeeded || solution.length === 0) {
		console.warn("KADBooleanHelper: Operation returned no results");
		return 0;
	}

	// Step 6) Convert result paths to world coordinate polylines
	var resultPolylines = [];
	for (var i = 0; i < solution.length; i++) {
		var path = solution[i];
		if (path.length < 3) continue;

		var points = [];
		for (var j = 0; j < path.length; j++) {
			points.push({
				x: path[j].X / SCALE,
				y: path[j].Y / SCALE,
				z: avgZ
			});
		}
		resultPolylines.push(points);
	}

	if (resultPolylines.length === 0) {
		console.warn("KADBooleanHelper: No valid result polygons");
		return 0;
	}

	// Step 7) Create KAD entities with undo support
	var layerName = config.layerName || "BOOLS";
	var opLabel = config.operation.charAt(0).toUpperCase() + config.operation.slice(1);
	createKADEntities(resultPolylines, {
		layerName: layerName,
		color: config.color || "#FFCC00",
		lineWidth: config.lineWidth || 3,
		batchLabel: "KAD Boolean " + opLabel + " (" + names.length + " inputs, " + resultPolylines.length + " results)"
	});

	console.log("KAD Boolean " + opLabel + ": " + names.length + " inputs → " + resultPolylines.length + " result polygon(s)");
	return resultPolylines.length;
}

// ────────────────────────────────────────────────────────
// Internal utilities
// ────────────────────────────────────────────────────────

/**
 * Convert a KAD entity's vertices to a ClipperLib integer path.
 */
function entityToClipperPath(entity) {
	var path = [];
	for (var i = 0; i < entity.data.length; i++) {
		var pt = entity.data[i];
		path.push({
			X: Math.round(pt.pointXLocation * SCALE),
			Y: Math.round(pt.pointYLocation * SCALE)
		});
	}
	return path;
}

/**
 * Compute average Z from an array of entities.
 */
function computeAverageZ(entities) {
	var sumZ = 0;
	var count = 0;
	for (var e = 0; e < entities.length; e++) {
		for (var i = 0; i < entities[e].data.length; i++) {
			sumZ += entities[e].data[i].pointZLocation || 0;
			count++;
		}
	}
	return count > 0 ? sumZ / count : 0;
}

/**
 * Create KAD polygon entities from result polylines.
 * Follows the SurfaceIntersectionHelper.createKADEntities() pattern.
 */
function createKADEntities(polylines, config) {
	// Step 1) Begin undo batch
	if (window.undoManager && polylines.length > 1) {
		window.undoManager.beginBatch(config.batchLabel || "KAD Boolean");
	}

	// Step 2) Get or create layer (layerName is the canonical property for DB/TreeView)
	var activeLayerId = null;
	var activeLayer = null;
	if (window.allDrawingLayers) {
		for (var [layerId, layer] of window.allDrawingLayers) {
			if ((layer.layerName || layer.name) === config.layerName) {
				activeLayer = layer;
				activeLayerId = layerId;
				break;
			}
		}
		if (!activeLayer) {
			activeLayerId = "layer_" + Math.random().toString(36).substring(2, 6);
			activeLayer = {
				layerId: activeLayerId,
				layerName: config.layerName,
				type: "drawing",
				visible: true,
				entities: new Set()
			};
			window.allDrawingLayers.set(activeLayerId, activeLayer);
		}
	}

	// Step 3) Create entity per result polygon
	polylines.forEach(function (points, idx) {
		var entityName = config.layerName + "_" + Math.random().toString(36).substring(2, 6) + "_" + idx;
		var entityData = {
			entityType: "poly",
			layerId: activeLayerId,
			data: points.map(function (pt, i) {
				return {
					entityName: entityName,
					entityType: "poly",
					pointID: i + 1,
					pointXLocation: pt.x,
					pointYLocation: pt.y,
					pointZLocation: pt.z,
					lineWidth: config.lineWidth || 3,
					color: config.color || "#FFCC00",
					closed: true,
					visible: true
				};
			})
		};
		window.allKADDrawingsMap.set(entityName, entityData);
		if (activeLayer) activeLayer.entities.add(entityName);

		// Step 4) Push undo action
		if (window.undoManager) {
			var action = new AddKADEntityAction(entityName, JSON.parse(JSON.stringify(entityData)));
			window.undoManager.pushAction(action);
		}
	});

	// Step 5) End undo batch
	if (window.undoManager && polylines.length > 1) {
		window.undoManager.endBatch();
	}

	// Step 6) Post-creation refresh
	window.threeKADNeedsRebuild = true;
	if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
	if (typeof window.debouncedSaveKAD === "function") window.debouncedSaveKAD();
	if (typeof window.debouncedSaveLayers === "function") window.debouncedSaveLayers();
	if (typeof window.debouncedUpdateTreeView === "function") window.debouncedUpdateTreeView();
}
