/**
 * surfaceIntersectionWorker.js - Web Worker for surface intersection computation
 *
 * Runs triangle-triangle intersection (Moller algorithm), segment chaining,
 * and polyline simplification off the main thread.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'intersect', payload: { surfaceData, config } }
 *       surfaceData: Array of { id, triangles: [{v0,v1,v2}, ...], bbox }
 *       config: { vertexSpacing, closedPolygons }
 *
 *   Worker → Main:
 *     { type: 'progress', percent, message }
 *     { type: 'result', data: { polylines, segmentCount } }
 *     { type: 'error', message }
 */

import {
	extractTriangles,
	computeBBox,
	bboxOverlap,
	ensureZUpNormals,
	intersectSurfacePair,
	chainSegments,
	simplifyPolyline,
	dist3D
} from "../helpers/SurfaceIntersectionHelper.js";

self.onmessage = function(e) {
	var msg = e.data;

	function sendProgress(percent, message) {
		self.postMessage({ type: "progress", percent: percent, message: message });
	}

	try {
		if (msg.type === "intersect") {
			var payload = msg.payload;
			var surfaces = payload.surfaces; // Array of { id, points, triangles }
			var config = payload.config;

			sendProgress(5, "Extracting triangles...");

			// Step 1: Extract and normalize triangles from each surface
			var surfaceData = [];
			for (var i = 0; i < surfaces.length; i++) {
				var surf = surfaces[i];
				var tris = extractTriangles(surf);
				if (tris.length === 0) continue;
				tris = ensureZUpNormals(tris);
				var bbox = computeBBox(tris);
				surfaceData.push({ id: surf.id, triangles: tris, bbox: bbox });
			}

			if (surfaceData.length < 2) {
				self.postMessage({ type: "result", data: { polylines: [], segmentCount: 0, error: "Need at least 2 surfaces with triangles" } });
				return;
			}

			// Step 2: Process all surface pairs
			sendProgress(15, "Computing intersections for " + surfaceData.length + " surfaces...");
			var allSegments = [];
			var pairCount = 0;
			var totalPairs = (surfaceData.length * (surfaceData.length - 1)) / 2;

			for (var a = 0; a < surfaceData.length; a++) {
				for (var b = a + 1; b < surfaceData.length; b++) {
					pairCount++;
					var sA = surfaceData[a];
					var sB = surfaceData[b];

					if (!bboxOverlap(sA.bbox, sB.bbox)) continue;

					sendProgress(15 + Math.floor((pairCount / totalPairs) * 50),
						"Pair " + pairCount + "/" + totalPairs + ": " + sA.id + " x " + sB.id);

					var segments = intersectSurfacePair(sA.triangles, sB.triangles);
					for (var s = 0; s < segments.length; s++) {
						allSegments.push(segments[s]);
					}
				}
			}

			if (allSegments.length === 0) {
				self.postMessage({ type: "result", data: { polylines: [], segmentCount: 0, noIntersection: true } });
				return;
			}

			// Step 3: Chain segments into polylines
			sendProgress(70, "Chaining " + allSegments.length + " segments...");
			var avgSegLen = 0;
			for (var sl = 0; sl < allSegments.length; sl++) {
				avgSegLen += dist3D(allSegments[sl].p0, allSegments[sl].p1);
			}
			avgSegLen = allSegments.length > 0 ? avgSegLen / allSegments.length : 1.0;
			var chainThreshold = Math.max(avgSegLen * 0.01, 0.001);

			var polylines = chainSegments(allSegments, chainThreshold);

			// Step 4: Simplify
			sendProgress(85, "Simplifying " + polylines.length + " polylines...");
			if (config.vertexSpacing > 0) {
				for (var p = 0; p < polylines.length; p++) {
					polylines[p] = simplifyPolyline(polylines[p], config.vertexSpacing);
				}
			}

			// Filter degenerate
			polylines = polylines.filter(function(pl) { return pl.length >= 2; });

			sendProgress(100, "Complete!");
			self.postMessage({
				type: "result",
				data: {
					polylines: polylines,
					segmentCount: allSegments.length
				}
			});
		} else {
			self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
		}
	} catch (err) {
		self.postMessage({ type: "error", message: err.message || String(err) });
	}
};
