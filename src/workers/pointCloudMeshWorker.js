/**
 * pointCloudMeshWorker.js - Web Worker for point cloud mesh generation
 *
 * Runs decimation, deduplication, Delaunay triangulation, and triangle
 * culling off the main thread.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'meshFromPoints', payload: { points, config } }
 *       points: Array of {x, y, z}
 *       config: { maxSurfacePoints, xyzTolerance, maxEdgeLength, consider3DLength, minAngle, consider3DAngle }
 *
 *   Worker → Main:
 *     { type: 'progress', percent, message }
 *     { type: 'result', data: { points, triangles, meshBounds, stats } }
 *     { type: 'error', message }
 */

import Delaunator from "delaunator";
import { deduplicatePoints, decimatePoints } from "../helpers/PointDeduplication.js";

self.onmessage = function (e) {
	var msg = e.data;

	function sendProgress(percent, message) {
		self.postMessage({ type: "progress", percent: percent, message: message });
	}

	try {
		if (msg.type === "meshFromPoints") {
			var payload = msg.payload;
			var points = payload.points;
			var config = payload.config || {};

			var maxSurfacePoints = config.maxSurfacePoints || 0;
			var xyzTolerance = config.xyzTolerance || 0.001;
			var maxEdgeLength = config.maxEdgeLength || 0;
			var consider3DLength = config.consider3DLength || false;
			var minAngle = config.minAngle || 0;
			var consider3DAngle = config.consider3DAngle || false;

			// Step 1: Decimate
			sendProgress(5, "Decimating " + points.length + " points...");
			if (maxSurfacePoints > 0 && points.length > maxSurfacePoints) {
				points = decimatePoints(points, maxSurfacePoints);
			}

			// Step 2: Deduplicate
			sendProgress(15, "Deduplicating " + points.length + " points...");
			var dedupOriginal = points.length;
			if (xyzTolerance > 0) {
				var dedupResult = deduplicatePoints(points, xyzTolerance);
				points = dedupResult.uniquePoints;
			}

			if (points.length < 3) {
				self.postMessage({
					type: "result",
					data: {
						points: points,
						triangles: [],
						meshBounds: null,
						stats: { error: "Insufficient points after deduplication: " + points.length }
					}
				});
				return;
			}

			// Step 3: Delaunay triangulation
			sendProgress(30, "Triangulating " + points.length + " points...");
			var coords = [];
			for (var ci = 0; ci < points.length; ci++) {
				coords.push(points[ci].x, points[ci].y);
			}
			var delaunay = new Delaunator(coords);

			// Step 4: Triangle culling
			sendProgress(60, "Filtering triangles...");
			var triangles = [];
			var culledByEdge = 0;
			var culledByAngle = 0;
			var totalRaw = delaunay.triangles.length / 3;

			for (var i = 0; i < delaunay.triangles.length; i += 3) {
				var p1 = points[delaunay.triangles[i]];
				var p2 = points[delaunay.triangles[i + 1]];
				var p3 = points[delaunay.triangles[i + 2]];

				// Edge length culling
				if (maxEdgeLength > 0) {
					var maxEdgeSq = maxEdgeLength * maxEdgeLength;
					if (distSq(p1, p2, consider3DLength) > maxEdgeSq ||
						distSq(p2, p3, consider3DLength) > maxEdgeSq ||
						distSq(p3, p1, consider3DLength) > maxEdgeSq) {
						culledByEdge++;
						continue;
					}
				}

				// Min angle culling
				if (minAngle > 0) {
					var e1 = Math.sqrt(distSq(p1, p2, consider3DAngle));
					var e2 = Math.sqrt(distSq(p2, p3, consider3DAngle));
					var e3 = Math.sqrt(distSq(p3, p1, consider3DAngle));

					var a1 = Math.acos(Math.max(-1, Math.min(1, (e2 * e2 + e3 * e3 - e1 * e1) / (2 * e2 * e3)))) * (180 / Math.PI);
					var a2 = Math.acos(Math.max(-1, Math.min(1, (e1 * e1 + e3 * e3 - e2 * e2) / (2 * e1 * e3)))) * (180 / Math.PI);
					var a3 = Math.acos(Math.max(-1, Math.min(1, (e1 * e1 + e2 * e2 - e3 * e3) / (2 * e1 * e2)))) * (180 / Math.PI);

					if (Math.min(a1, a2, a3) < minAngle) {
						culledByAngle++;
						continue;
					}
				}

				triangles.push({
					vertices: [p1, p2, p3],
					minZ: Math.min(p1.z, p2.z, p3.z),
					maxZ: Math.max(p1.z, p2.z, p3.z)
				});
			}

			// Step 5: Compute mesh bounds
			sendProgress(90, "Computing bounds...");
			var minX = Infinity, maxX = -Infinity;
			var minY = Infinity, maxY = -Infinity;
			var minZ = Infinity, maxZ = -Infinity;
			for (var bi = 0; bi < points.length; bi++) {
				var bp = points[bi];
				if (bp.x < minX) minX = bp.x;
				if (bp.x > maxX) maxX = bp.x;
				if (bp.y < minY) minY = bp.y;
				if (bp.y > maxY) maxY = bp.y;
				if (bp.z < minZ) minZ = bp.z;
				if (bp.z > maxZ) maxZ = bp.z;
			}

			sendProgress(100, "Complete!");
			self.postMessage({
				type: "result",
				data: {
					points: points,
					triangles: triangles,
					meshBounds: { minX: minX, maxX: maxX, minY: minY, maxY: maxY, minZ: minZ, maxZ: maxZ },
					stats: {
						dedupOriginal: dedupOriginal,
						dedupFinal: points.length,
						totalRawTriangles: totalRaw,
						triangleCount: triangles.length,
						culledByEdge: culledByEdge,
						culledByAngle: culledByAngle
					}
				}
			});
		} else {
			self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
		}
	} catch (err) {
		self.postMessage({ type: "error", message: err.message || String(err) });
	}
};

function distSq(p1, p2, use3D) {
	var dx = p2.x - p1.x;
	var dy = p2.y - p1.y;
	if (use3D) {
		var dz = p2.z - p1.z;
		return dx * dx + dy * dy + dz * dz;
	}
	return dx * dx + dy * dy;
}
