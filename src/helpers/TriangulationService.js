/**
 * TriangulationService.js - Main-thread API for the triangulation Web Worker
 *
 * Singleton wrapper that creates and manages the triangulation worker.
 * Exposes async methods that return Promises and forward progress updates
 * to a callback.
 */

let workerInstance = null;

function getWorker() {
	if (!workerInstance) {
		workerInstance = new Worker(
			new URL("../workers/triangulationWorker.js", import.meta.url),
			{ type: "module" }
		);
	}
	return workerInstance;
}

/**
 * Run a constrained Delaunay triangulation in the Web Worker.
 *
 * @param {Object} payload
 * @param {Array} payload.points       - Array of {x, y, z, ...} vertex objects
 * @param {Array} payload.constraintSegments - Pre-extracted constraint segments (optional)
 * @param {Array} payload.kadEntities  - KAD entity data for constraint extraction (optional)
 * @param {Object} payload.options     - { tolerance, entitiesWithUnmappedSegments, ... }
 * @param {Function} [onProgress]      - Callback: (percent, message) => void
 * @returns {Promise<{resultTriangles, points, stats}>}
 */
export function triangulate(payload, onProgress) {
	return new Promise(function (resolve, reject) {
		var worker = getWorker();

		function handler(e) {
			var msg = e.data;
			if (msg.type === "progress") {
				if (onProgress) {
					onProgress(msg.percent, msg.message);
				}
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

		worker.postMessage({ type: "triangulate", payload: payload });
	});
}

/**
 * Run a basic (unconstrained) Delaunay triangulation in the Web Worker.
 *
 * @param {Array} points   - Array of {x, y, z} vertex objects
 * @param {Object} options - { tolerance, minAngle, maxEdgeLength }
 * @param {Function} [onProgress] - Callback: (percent, message) => void
 * @returns {Promise<{resultTriangles, points, stats}>}
 */
export function triangulateBasic(points, options, onProgress) {
	return new Promise(function (resolve, reject) {
		var worker = getWorker();

		function handler(e) {
			var msg = e.data;
			if (msg.type === "progress") {
				if (onProgress) {
					onProgress(msg.percent, msg.message);
				}
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
			type: "triangulateBasic",
			payload: { points: points, options: options || {} },
		});
	});
}

/**
 * Terminate the worker (e.g. for cancel). A new worker will be created on next call.
 */
export function terminateWorker() {
	if (workerInstance) {
		workerInstance.terminate();
		workerInstance = null;
	}
}
