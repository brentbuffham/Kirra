/**
 * trimeshBooleanWorker.js - Web Worker for trimesh-boolean library operations
 *
 * Delegates all computation to the trimesh-boolean NPM package.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'splitMeshPair', payload: { soupA, soupB, smallThreshold } }
 *     { type: 'mergeComponents', payload: { picks } }
 *     { type: 'repairMesh', payload: { soup, config } }
 *
 *   Worker → Main:
 *     { type: 'progress', percent, message }
 *     { type: 'result', data: { ... } }
 *     { type: 'error', message }
 */

import {
	splitMeshPair,
	splitToComponents,
	mergeSmallComponents,
	mergeComponents,
	repairMesh
} from "trimesh-boolean";

function progress(percent, message) {
	self.postMessage({ type: "progress", percent: percent, message: message });
}

self.onmessage = async function (e) {
	var msg = e.data;

	try {
		if (msg.type === "splitMeshPair") {
			var p = msg.payload;
			progress(5, "Starting split...");

			var result = splitMeshPair(p.soupA, p.soupB);
			if (!result) {
				self.postMessage({ type: "result", data: { components: [], segments: [] } });
				return;
			}

			progress(60, "Splitting to components...");
			var components = splitToComponents(result.groups);

			var threshold = p.smallThreshold !== undefined ? p.smallThreshold : 50;
			if (threshold > 0 && components.length > 0) {
				progress(80, "Merging small components (threshold=" + threshold + ")...");
				components = mergeSmallComponents(components, threshold);
			}

			progress(100, "Split complete: " + components.length + " components");
			self.postMessage({
				type: "result",
				data: {
					components: components,
					segments: result.segments
				}
			});

		} else if (msg.type === "mergeComponents") {
			var picks = msg.payload.picks;
			progress(10, "Merging " + picks.length + " components...");

			var merged = mergeComponents(picks);

			progress(100, "Merge complete");
			self.postMessage({
				type: "result",
				data: merged
			});

		} else if (msg.type === "repairMesh") {
			var rp = msg.payload;
			progress(5, "Starting repair...");

			var repaired = await repairMesh(rp.soup, rp.config, function (stepMsg) {
				progress(50, stepMsg);
			});

			progress(100, "Repair complete");
			self.postMessage({
				type: "result",
				data: repaired
			});

		} else {
			self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
		}
	} catch (err) {
		self.postMessage({ type: "error", message: err.message || String(err) });
	}
};
