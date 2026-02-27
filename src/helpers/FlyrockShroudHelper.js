// src/helpers/FlyrockShroudHelper.js

/**
 * FlyrockShroudHelper orchestrates the flyrock shroud generation workflow:
 *   1. Filter holes by blast pattern selection
 *   2. Extract per-hole flyrock params (needs window.loadedCharging — main thread)
 *   3. Send holeData to Web Worker for grid computation (off main thread)
 *   4. Add surface to loadedSurfaces via undo-able action
 *   5. Undo action refresh handles: save to IndexedDB, update TreeView, redraw
 */

import { extractHoleFlyrockData } from "../tools/flyrock/FlyrockShroudGenerator.js";
import { AddSurfaceAction } from "../tools/UndoActions.js";
import { FloatingDialog } from "../dialog/FloatingDialog.js";
import { getOrCreateSurfaceLayer } from "./LayerHelper.js";
import { showWorkerProgressDialog } from "../dialog/popups/generic/WorkerProgressDialog.js";

var workerInstance = null;

function getWorker() {
	if (!workerInstance) {
		workerInstance = new Worker(
			new URL("../workers/flyrockWorker.js", import.meta.url),
			{ type: "module" }
		);
	}
	return workerInstance;
}

/**
 * Run the flyrock grid computation in a Web Worker.
 * @param {Array} holeData - Pre-extracted hole flyrock data
 * @param {Object} params - Grid generation parameters
 * @returns {Promise<Object|null>} - Surface object or null
 */
function generateInWorker(holeData, params, progressDialog) {
	return new Promise(function (resolve, reject) {
		var worker = getWorker();

		function handler(e) {
			var msg = e.data;
			if (msg.type === "progress") {
				if (progressDialog) progressDialog.update(msg.percent, msg.message);
			} else if (msg.type === "result") {
				worker.removeEventListener("message", handler);
				worker.removeEventListener("error", errHandler);
				resolve(msg.data);
			} else if (msg.type === "error") {
				worker.removeEventListener("message", handler);
				worker.removeEventListener("error", errHandler);
				reject(new Error(msg.message));
			}
		}

		function errHandler(err) {
			worker.removeEventListener("message", handler);
			worker.removeEventListener("error", errHandler);
			reject(new Error("Worker error: " + (err.message || String(err))));
		}

		worker.addEventListener("message", handler);
		worker.addEventListener("error", errHandler);

		worker.postMessage({
			type: "generate",
			payload: { holeData: holeData, params: params }
		});
	});
}

/**
 * Apply flyrock shroud: filter holes, generate surface, add to scene.
 *
 * @param {Object} config - From FlyrockShroudDialog callback
 * @param {string} config.blastName - Blast entity name or "__ALL__"
 * @param {string} config.algorithm - Algorithm name
 * @param {number} config.K - Flyrock constant
 * @param {number} config.factorOfSafety - Safety factor
 * @param {number} config.stemEjectAngleDeg - Stem eject angle
 * @param {number} config.rockDensity - Rock density
 * @param {number} config.iterations - Grid resolution factor
 * @param {number} config.endAngleDeg - Face angle culling threshold (degrees from horizontal)
 * @param {number} config.transparency - Surface transparency
 */
export async function applyFlyrockShroud(config) {
	if (!config) {
		console.error("FlyrockShroudHelper: No config provided");
		return;
	}

	// Filter holes by entity
	var holes = [];
	if (window.allBlastHoles && window.allBlastHoles.length > 0) {
		if (config.blastName === "__ALL__") {
			holes = window.allBlastHoles;
		} else {
			holes = window.allBlastHoles.filter(function(hole) {
				return hole.entityName === config.blastName;
			});
		}
	}

	if (holes.length === 0) {
		showWarning("No blast holes found for the selected pattern.");
		return;
	}

	console.log("Generating flyrock shroud for " + holes.length + " holes using " + config.algorithm);

	// Phase 1: Extract per-hole flyrock params on main thread (needs window.loadedCharging)
	var extraction = extractHoleFlyrockData(holes, config);

	if (extraction.error === "NO_CHARGING") {
		showWarning(
			"Flyrock shroud requires charging data.\n\n" +
			extraction.total + " hole(s) selected but none have charging assigned.\n\n" +
			"Use the Deck Builder (right-click a hole) to assign explosive " +
			"products before generating a flyrock shroud."
		);
		return;
	}

	if (!extraction.holeData || extraction.holeData.length === 0) {
		console.error("FlyrockShroudHelper: No valid hole data extracted");
		return;
	}

	// Phase 2: Send to Web Worker for grid computation (off main thread)
	var progressDialog = showWorkerProgressDialog("Flyrock Shroud", {
		initialMessage: "Generating shroud for " + extraction.holeData.length + " holes..."
	});

	try {
		var surface = await generateInWorker(extraction.holeData, {
			algorithm: config.algorithm,
			iterations: config.iterations,
			endAngleDeg: config.endAngleDeg,
			transparency: config.transparency,
			extendBelowCollar: config.extendBelowCollar || 0,
			K: config.K,
			factorOfSafety: config.factorOfSafety,
			stemEjectAngleDeg: config.stemEjectAngleDeg,
			holesSkipped: extraction.skippedNoCharging
		}, progressDialog);

		if (!surface) {
			progressDialog.fail("No surface generated");
			return;
		}

		// Log if some holes were skipped
		if (surface.flyrockParams && surface.flyrockParams.holesSkipped > 0) {
			console.warn("Flyrock shroud: " + surface.flyrockParams.holesSkipped +
				" hole(s) skipped (no charging data), " +
				surface.flyrockParams.holeCount + " hole(s) used");
		}

		// Assign to "Flyrock" layer
		var layerId = getOrCreateSurfaceLayer("Flyrock");
		if (layerId) {
			surface.layerId = layerId;
			var layer = window.allSurfaceLayers.get(layerId);
			if (layer && layer.entities) layer.entities.add(surface.id);
		}

		// Execute via UndoManager
		if (window.undoManager) {
			var action = new AddSurfaceAction(surface);
			window.undoManager.execute(action);
		} else {
			if (window.loadedSurfaces) {
				window.loadedSurfaces.set(surface.id, surface);
			}
			if (window.saveSurfaceToDB) {
				window.saveSurfaceToDB(surface.id).catch(function(err) {
					console.error("Failed to save flyrock shroud to IndexedDB:", err);
				});
			}
			if (window.debouncedUpdateTreeView) {
				window.debouncedUpdateTreeView();
			}
			if (window.drawData) {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
		}

		progressDialog.complete("Shroud created: " + surface.triangles.length.toLocaleString() + " triangles");
		console.log("Flyrock shroud surface added: " + surface.id +
			" (" + surface.points.length + " points, " + surface.triangles.length + " triangles)");
	} catch (err) {
		console.error("FlyrockShroudHelper: Worker error:", err);
		progressDialog.fail("Generation failed: " + err.message);
		showWarning("Flyrock generation failed: " + err.message);
	}
}

/**
 * Show a warning dialog using FloatingDialog.
 * @param {string} message - Warning text
 */
function showWarning(message) {
	var content = document.createElement("div");
	content.style.padding = "15px";
	content.style.whiteSpace = "pre-wrap";
	content.textContent = message;

	var dialog = new FloatingDialog({
		title: "Flyrock Shroud - Warning",
		content: content,
		width: 450,
		height: 250,
		showConfirm: true,
		confirmText: "OK",
		showCancel: false
	});
	dialog.show();
}
