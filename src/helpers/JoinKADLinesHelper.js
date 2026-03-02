/**
 * JoinKADLinesHelper.js
 *
 * Pure logic for joining two KAD line entities end-to-end.
 * No UI — called by KADJoinLinesDialog.js.
 *
 * Uses AddKADEntityAction / DeleteKADEntityAction for undo support.
 */

import { AddKADEntityAction, DeleteKADEntityAction } from "../tools/UndoActions.js";

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Join two KAD line entities at selected endpoints.
 *
 * @param {Object} config
 * @param {string} config.entityNameA    - First entity name
 * @param {string} config.entityNameB    - Second entity name
 * @param {string} config.endpointA      - "start" or "end" (which end of A to join)
 * @param {string} config.endpointB      - "start" or "end" (which end of B to join)
 * @param {number} config.weldTolerance  - Max distance to weld duplicate point (default 0.01)
 * @param {string} config.newEntityName  - Name for the joined entity
 * @param {boolean} config.deleteOriginals - Whether to delete A and B (default true)
 * @returns {{ success: boolean, message: string, entityName?: string }}
 */
export function joinKADLines(config) {
	var nameA = config.entityNameA;
	var nameB = config.entityNameB;

	// Step 1) Validate
	if (nameA === nameB) {
		return { success: false, message: "Cannot join an entity to itself." };
	}

	var entityA = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(nameA) : null;
	var entityB = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(nameB) : null;

	if (!entityA || !entityA.data || entityA.data.length < 2) {
		return { success: false, message: "Entity A not found or has fewer than 2 points." };
	}
	if (!entityB || !entityB.data || entityB.data.length < 2) {
		return { success: false, message: "Entity B not found or has fewer than 2 points." };
	}
	if (entityA.entityType !== "line") {
		return { success: false, message: "Entity A must be a line (got: " + entityA.entityType + ")." };
	}
	if (entityB.entityType !== "line") {
		return { success: false, message: "Entity B must be a line (got: " + entityB.entityType + ")." };
	}

	var endpointA = config.endpointA || "end";
	var endpointB = config.endpointB || "start";
	var weldTolerance = config.weldTolerance != null ? config.weldTolerance : 0.01;
	var deleteOriginals = config.deleteOriginals !== false;
	var closeAsPoly = !!config.closeAsPoly;
	var newName = config.newEntityName || (nameA + "_joined");

	// Step 2) Deep-copy point arrays
	var pointsA = JSON.parse(JSON.stringify(entityA.data));
	var pointsB = JSON.parse(JSON.stringify(entityB.data));

	// Step 3) Arrange ordering so A's selected end meets B's selected end
	// Goal: final array = arrangedA + arrangedB, where arrangedA's last point
	// meets arrangedB's first point
	if (endpointA === "start" && endpointB === "start") {
		// reverse(A) + B
		pointsA.reverse();
	} else if (endpointA === "end" && endpointB === "end") {
		// A + reverse(B)
		pointsB.reverse();
	} else if (endpointA === "start" && endpointB === "end") {
		// B + A (swap)
		var temp = pointsA;
		pointsA = pointsB;
		pointsB = temp;
	}
	// else: endpointA === "end" && endpointB === "start" → natural order, no changes

	// Step 4) Weld check — if joining endpoints are within tolerance, remove duplicate
	var lastA = pointsA[pointsA.length - 1];
	var firstB = pointsB[0];
	var dx = lastA.pointXLocation - firstB.pointXLocation;
	var dy = lastA.pointYLocation - firstB.pointYLocation;
	var dz = (lastA.pointZLocation || 0) - (firstB.pointZLocation || 0);
	var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

	if (dist <= weldTolerance) {
		// Remove duplicate — drop first point of B
		pointsB.shift();
	}

	// Step 5) Combine points
	var combined = pointsA.concat(pointsB);

	if (combined.length < 2) {
		return { success: false, message: "Joined result has fewer than 2 points." };
	}

	// Get color/lineWidth from first entity
	var refPoint = entityA.data[0];
	var color = refPoint.color || "#FFFFFF";
	var lineWidth = refPoint.lineWidth || 2;

	// Determine output entity type
	var outputType = closeAsPoly ? "poly" : "line";

	// Renumber and set entity name
	for (var i = 0; i < combined.length; i++) {
		combined[i].pointID = i + 1;
		combined[i].entityName = newName;
		combined[i].entityType = outputType;
		combined[i].closed = closeAsPoly;
		combined[i].color = color;
		combined[i].lineWidth = lineWidth;
	}

	// Step 6) Determine layer
	var layerId = entityA.layerId || entityB.layerId || null;

	// Step 7) Create new entity
	var newEntityData = {
		entityType: outputType,
		layerId: layerId,
		data: combined
	};

	// Step 8) Undo batch
	var actionCount = 1 + (deleteOriginals ? 2 : 0);
	if (window.undoManager && actionCount > 1) {
		window.undoManager.beginBatch("Join KAD Lines: " + nameA + " + " + nameB);
	}

	// Add new entity
	window.allKADDrawingsMap.set(newName, newEntityData);
	if (window.undoManager) {
		var addAction = new AddKADEntityAction(newName, JSON.parse(JSON.stringify(newEntityData)));
		window.undoManager.pushAction(addAction);
	}

	// Assign to layer
	if (layerId && window.allDrawingLayers) {
		var layer = window.allDrawingLayers.get(layerId);
		if (layer && layer.entities) {
			layer.entities.add(newName);
		}
	}

	// Delete originals
	if (deleteOriginals) {
		if (window.undoManager) {
			var delActionA = new DeleteKADEntityAction(nameA, JSON.parse(JSON.stringify(entityA)));
			window.undoManager.pushAction(delActionA);
			var delActionB = new DeleteKADEntityAction(nameB, JSON.parse(JSON.stringify(entityB)));
			window.undoManager.pushAction(delActionB);
		}
		window.allKADDrawingsMap.delete(nameA);
		window.allKADDrawingsMap.delete(nameB);

		// Remove from layers
		if (window.allDrawingLayers) {
			window.allDrawingLayers.forEach(function (layer) {
				if (layer.entities) {
					layer.entities.delete(nameA);
					layer.entities.delete(nameB);
				}
			});
		}
	}

	if (window.undoManager && actionCount > 1) {
		window.undoManager.endBatch();
	}

	// Step 9) Post-creation refresh
	window.threeKADNeedsRebuild = true;
	if (window.drawData) window.drawData(window.allBlastHoles, window.selectedHole);
	if (typeof window.debouncedSaveKAD === "function") window.debouncedSaveKAD();
	if (typeof window.debouncedSaveLayers === "function") window.debouncedSaveLayers();
	if (typeof window.debouncedUpdateTreeView === "function") window.debouncedUpdateTreeView();

	console.log("JoinKADLines: Joined " + nameA + " + " + nameB + " → " + newName + " (" + combined.length + " points)");
	return { success: true, message: "Joined " + combined.length + " points into " + newName, entityName: newName };
}

/**
 * Get endpoint coordinates for display in the dialog.
 *
 * @param {string} entityName
 * @returns {{ start: {x,y,z}, end: {x,y,z}, pointCount: number } | null}
 */
export function getLineEndpoints(entityName) {
	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
	if (!entity || !entity.data || entity.data.length < 2) return null;

	var first = entity.data[0];
	var last = entity.data[entity.data.length - 1];

	return {
		start: {
			x: first.pointXLocation,
			y: first.pointYLocation,
			z: first.pointZLocation || 0
		},
		end: {
			x: last.pointXLocation,
			y: last.pointYLocation,
			z: last.pointZLocation || 0
		},
		pointCount: entity.data.length
	};
}

/**
 * Compute distance between two 3D points.
 */
export function distance3D(a, b) {
	var dx = a.x - b.x;
	var dy = a.y - b.y;
	var dz = (a.z || 0) - (b.z || 0);
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
