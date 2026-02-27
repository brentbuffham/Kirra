/**
 * lasImportWorker.js - Web Worker for LAS point cloud import
 *
 * Uses Struct-of-Arrays (typed arrays) for memory efficiency.
 * A 1GB LAS file (~35M points) uses ~1GB of typed arrays instead of ~14GB of JS objects.
 * Results are transferred back via Transferable typed arrays (zero-copy) to avoid
 * structured clone OOM on large datasets.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'parsePoints', payload: { arrayBuffer, header, config } }
 *
 *   Worker → Main:
 *     { type: 'progress', percent, message }
 *     { type: 'result', data: { resultType, ... } }
 *     { type: 'error', message }
 */

import proj4 from "proj4";
import { Delaunay } from "d3-delaunay";

var LAS_CLASSIFICATIONS = {
	0: "Created, never classified",
	1: "Unclassified",
	2: "Ground",
	3: "Low Vegetation",
	4: "Medium Vegetation",
	5: "High Vegetation",
	6: "Building",
	7: "Low Point (noise)",
	8: "Model Key-point",
	9: "Water",
	10: "Rail",
	11: "Road Surface",
	12: "Reserved (Overlap)",
	13: "Wire - Guard (Shield)",
	14: "Wire - Conductor (Phase)",
	15: "Transmission Tower",
	16: "Wire-structure Connector",
	17: "Bridge Deck",
	18: "High Noise"
};

var CLASSIFICATION_FILTERS = {
	all: null,
	ground: [2],
	vegetation: [3, 4, 5],
	buildings: [6],
	unclassified: [1]
};

var LITTLE_ENDIAN = true;

// ─── Typed Array Point Cloud ─────────────────────────────────────

function createPointCloud(count, hasRgb) {
	return {
		count: count,
		x: new Float64Array(count),
		y: new Float64Array(count),
		z: new Float64Array(count),
		classification: new Uint8Array(count),
		intensity: new Uint16Array(count),
		returnNumber: new Uint8Array(count),
		numberOfReturns: new Uint8Array(count),
		hasRgb: hasRgb,
		r: hasRgb ? new Uint8Array(count) : null,
		g: hasRgb ? new Uint8Array(count) : null,
		b: hasRgb ? new Uint8Array(count) : null
	};
}

function trimPointCloud(pc, n) {
	if (n === pc.count) return pc;
	var trimmed = {
		count: n,
		x: pc.x.slice(0, n),
		y: pc.y.slice(0, n),
		z: pc.z.slice(0, n),
		classification: pc.classification.slice(0, n),
		intensity: pc.intensity.slice(0, n),
		returnNumber: pc.returnNumber.slice(0, n),
		numberOfReturns: pc.numberOfReturns.slice(0, n),
		hasRgb: pc.hasRgb,
		r: pc.hasRgb ? pc.r.slice(0, n) : null,
		g: pc.hasRgb ? pc.g.slice(0, n) : null,
		b: pc.hasRgb ? pc.b.slice(0, n) : null
	};
	pc.x = pc.y = pc.z = null;
	pc.classification = pc.intensity = null;
	pc.returnNumber = pc.numberOfReturns = null;
	pc.r = pc.g = pc.b = null;
	return trimmed;
}

function gatherPointCloud(pc, indices) {
	var n = indices.length;
	var out = createPointCloud(n, pc.hasRgb);
	for (var i = 0; i < n; i++) {
		var idx = indices[i];
		out.x[i] = pc.x[idx];
		out.y[i] = pc.y[idx];
		out.z[i] = pc.z[idx];
		out.classification[i] = pc.classification[idx];
		out.intensity[i] = pc.intensity[idx];
		out.returnNumber[i] = pc.returnNumber[idx];
		out.numberOfReturns[i] = pc.numberOfReturns[idx];
		if (pc.hasRgb) {
			out.r[i] = pc.r[idx];
			out.g[i] = pc.g[idx];
			out.b[i] = pc.b[idx];
		}
	}
	return out;
}

// ─── Binary Parsing into Typed Arrays ────────────────────────────

function formatHasRgb(formatID) {
	return formatID === 2 || formatID === 3 || formatID === 5 ||
		formatID === 7 || formatID === 8 || formatID === 10;
}

function parseToTypedArrays(dataView, header, stride, classFilter, maxPoints, sendProgress) {
	var baseOffset = header.offsetToPointData;
	var recordLength = header.pointDataRecordLength;
	var formatID = header.pointDataFormatID;
	var numPoints = Number(header.numberOfPoints);
	var hasRgb = formatHasRgb(formatID);
	var xScale = header.xScaleFactor;
	var yScale = header.yScaleFactor;
	var zScale = header.zScaleFactor;
	var xOff = header.xOffset;
	var yOff = header.yOffset;
	var zOff = header.zOffset;

	var estSize = Math.ceil(numPoints / stride);
	if (maxPoints > 0 && estSize > maxPoints) estSize = maxPoints;
	var cap = (maxPoints > 0) ? maxPoints : Infinity;

	var pc = createPointCloud(estSize, hasRgb);
	var writeIdx = 0;

	var classInnerOffset, classMask;
	if (formatID <= 5) {
		classInnerOffset = 15;
		classMask = 0x1f;
	} else {
		classInnerOffset = 16;
		classMask = 0xff;
	}

	var PROGRESS_EVERY = Math.max(1, Math.floor(numPoints / 40));

	for (var i = 0; i < numPoints && writeIdx < cap; i += stride) {
		if (i % PROGRESS_EVERY === 0) {
			sendProgress(
				5 + Math.floor((i / numPoints) * 30),
				"Parsing " + (i + 1).toLocaleString() + " / " + numPoints.toLocaleString() +
				" (" + writeIdx.toLocaleString() + " kept)..."
			);
		}

		var offset = baseOffset + i * recordLength;

		if (classFilter) {
			var cls = dataView.getUint8(offset + classInnerOffset) & classMask;
			if (classFilter.indexOf(cls) === -1) continue;
		}

		pc.x[writeIdx] = dataView.getInt32(offset, LITTLE_ENDIAN) * xScale + xOff;
		pc.y[writeIdx] = dataView.getInt32(offset + 4, LITTLE_ENDIAN) * yScale + yOff;
		pc.z[writeIdx] = dataView.getInt32(offset + 8, LITTLE_ENDIAN) * zScale + zOff;
		pc.intensity[writeIdx] = dataView.getUint16(offset + 12, LITTLE_ENDIAN);

		if (formatID <= 5) {
			var flagByte = dataView.getUint8(offset + 14);
			pc.returnNumber[writeIdx] = flagByte & 0x07;
			pc.numberOfReturns[writeIdx] = (flagByte >> 3) & 0x07;
			pc.classification[writeIdx] = dataView.getUint8(offset + 15) & 0x1f;
		} else {
			var retByte = dataView.getUint8(offset + 14);
			pc.returnNumber[writeIdx] = retByte & 0x0f;
			pc.numberOfReturns[writeIdx] = (retByte >> 4) & 0x0f;
			pc.classification[writeIdx] = dataView.getUint8(offset + 16);
		}

		if (hasRgb) {
			var rgbOffset;
			if (formatID <= 5) {
				rgbOffset = offset + 20;
				if (formatID === 1 || formatID === 3 || formatID === 4 || formatID === 5) {
					rgbOffset += 8;
				}
			} else {
				rgbOffset = offset + 30;
			}
			pc.r[writeIdx] = Math.min(255, Math.max(0, Math.round(dataView.getUint16(rgbOffset, LITTLE_ENDIAN) / 256)));
			pc.g[writeIdx] = Math.min(255, Math.max(0, Math.round(dataView.getUint16(rgbOffset + 2, LITTLE_ENDIAN) / 256)));
			pc.b[writeIdx] = Math.min(255, Math.max(0, Math.round(dataView.getUint16(rgbOffset + 4, LITTLE_ENDIAN) / 256)));
		}

		writeIdx++;
	}

	return trimPointCloud(pc, writeIdx);
}

// ─── Coordinate Transformation ───────────────────────────────────

function applyTransform(pc, config, sendProgress) {
	if (!config.transform) return;

	sendProgress(38, "Transforming " + pc.count.toLocaleString() + " coordinates...");

	var sourceDef = "+proj=longlat +datum=WGS84 +no_defs";
	var targetDef = config.proj4Source || "EPSG:" + config.epsgCode;

	if (config.epsgDef) {
		proj4.defs("EPSG:" + config.epsgCode, config.epsgDef);
	}

	var PROGRESS_EVERY = Math.max(1, Math.floor(pc.count / 10));
	for (var i = 0; i < pc.count; i++) {
		if (i % PROGRESS_EVERY === 0) {
			sendProgress(38 + Math.floor((i / pc.count) * 5), "Transforming coordinates " + i.toLocaleString() + "...");
		}
		var transformed = proj4(sourceDef, targetDef, [pc.x[i], pc.y[i]]);
		pc.x[i] = transformed[0];
		pc.y[i] = transformed[1];
	}
}

// ─── Statistics ──────────────────────────────────────────────────

function computeStats(pc) {
	var minX = Infinity, maxX = -Infinity;
	var minY = Infinity, maxY = -Infinity;
	var minZ = Infinity, maxZ = -Infinity;
	var classCounts = {};
	var returnCounts = {};

	for (var i = 0; i < pc.count; i++) {
		var x = pc.x[i], y = pc.y[i], z = pc.z[i];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;

		var cls = pc.classification[i];
		if (!classCounts[cls]) classCounts[cls] = { count: 0, name: LAS_CLASSIFICATIONS[cls] || "Reserved" };
		classCounts[cls].count++;

		var ret = pc.returnNumber[i];
		if (!returnCounts[ret]) returnCounts[ret] = 0;
		returnCounts[ret]++;
	}

	return {
		totalPoints: pc.count,
		minX: minX, maxX: maxX,
		minY: minY, maxY: maxY,
		minZ: minZ, maxZ: maxZ,
		centroidX: (minX + maxX) / 2,
		centroidY: (minY + maxY) / 2,
		centroidZ: (minZ + maxZ) / 2,
		classifications: classCounts,
		returnNumbers: returnCounts
	};
}

// ─── Deduplication on Typed Arrays ───────────────────────────────

function deduplicateTyped(pc, tolerance, sendProgress, progressBase) {
	if (pc.count === 0) return pc;
	tolerance = tolerance || 0.001;
	if (tolerance <= 0) tolerance = 0.001;

	var toleranceSq = tolerance * tolerance;
	var cellSize = tolerance;
	var grid = new Map();
	var keepMask = new Uint8Array(pc.count);
	var keepCount = 0;
	var PROGRESS_EVERY = Math.max(1, Math.floor(pc.count / 10));

	for (var i = 0; i < pc.count; i++) {
		if (i % PROGRESS_EVERY === 0 && sendProgress) {
			sendProgress(progressBase + Math.floor((i / pc.count) * 8),
				"Deduplicating " + i.toLocaleString() + " / " + pc.count.toLocaleString() + "...");
		}

		var px = pc.x[i];
		var py = pc.y[i];
		var cellX = Math.floor(px / cellSize);
		var cellY = Math.floor(py / cellSize);

		var foundDuplicate = false;
		for (var dx = -1; dx <= 1 && !foundDuplicate; dx++) {
			for (var dy = -1; dy <= 1 && !foundDuplicate; dy++) {
				var key = (cellX + dx) + "_" + (cellY + dy);
				var cell = grid.get(key);
				if (!cell) continue;
				for (var j = 0; j < cell.length; j++) {
					var idx = cell[j];
					var ex = pc.x[idx] - px;
					var ey = pc.y[idx] - py;
					if (ex * ex + ey * ey <= toleranceSq) {
						foundDuplicate = true;
						break;
					}
				}
			}
		}

		if (!foundDuplicate) {
			keepMask[i] = 1;
			keepCount++;
			var ownKey = cellX + "_" + cellY;
			var ownCell = grid.get(ownKey);
			if (!ownCell) {
				ownCell = [];
				grid.set(ownKey, ownCell);
			}
			ownCell.push(i);
		}
	}

	if (keepCount === pc.count) return pc;

	var kept = new Uint32Array(keepCount);
	var wi = 0;
	for (var i = 0; i < pc.count; i++) {
		if (keepMask[i]) kept[wi++] = i;
	}

	grid = null;
	keepMask = null;
	return gatherPointCloud(pc, kept);
}

// ─── Elevation Color ─────────────────────────────────────────────

function elevationColorRGB(z, minZ, range) {
	if (range < 0.001) return [255, 165, 0];
	var ratio = Math.max(0, Math.min(1, (z - minZ) / range));
	var r, g, b;
	if (ratio < 0.25) {
		r = 0; g = Math.floor(ratio * 4 * 255); b = 255;
	} else if (ratio < 0.5) {
		r = 0; g = 255; b = Math.floor(255 - (ratio - 0.25) * 4 * 255);
	} else if (ratio < 0.75) {
		r = Math.floor((ratio - 0.5) * 4 * 255); g = 255; b = 0;
	} else {
		r = 255; g = Math.floor(255 - (ratio - 0.75) * 4 * 255); b = 0;
	}
	return [r, g, b];
}

function rgbToHex(r, g, b) {
	return "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
}

// ─── Surface Triangulation (typed array output) ──────────────────

/**
 * Triangulates the point cloud and returns typed arrays for the result.
 * Returns Float64Arrays for points and Uint32Array for triangle indices
 * instead of object arrays — this allows Transferable postMessage.
 */
function createTriangulatedSurface(pc, config, stats, sendProgress) {
	var maxEdgeLength = config.maxEdgeLength || 0;
	var consider3DLength = config.consider3DLength || false;
	var minAngle = config.minAngle || 0;
	var consider3DAngle = config.consider3DAngle || false;
	var surfaceName = config.surfaceName || "LAS_Surface";
	var surfaceStyle = config.surfaceStyle || "default";

	sendProgress(65, "Triangulating " + pc.count.toLocaleString() + " points...");

	// Delaunay on flat coords from typed arrays
	var flatCoords = new Float64Array(pc.count * 2);
	for (var i = 0; i < pc.count; i++) {
		flatCoords[i * 2] = pc.x[i];
		flatCoords[i * 2 + 1] = pc.y[i];
	}

	var delaunay = new Delaunay(flatCoords);
	var rawTriIdx = delaunay.triangles; // Uint32Array from d3-delaunay
	flatCoords = null;

	sendProgress(80, "Filtering " + (rawTriIdx.length / 3).toLocaleString() + " triangles...");

	// Filter triangles — collect surviving triangle indices into a new Uint32Array
	var culledByEdge = 0;
	var culledByAngle = 0;
	var maxEdgeSq = maxEdgeLength > 0 ? maxEdgeLength * maxEdgeLength : 0;
	var needsCulling = maxEdgeSq > 0 || minAngle > 0;

	var keptIndices;
	if (needsCulling) {
		// Worst case: all survive. Write into temp buffer, trim later.
		var temp = new Uint32Array(rawTriIdx.length);
		var writePos = 0;

		for (var t = 0; t < rawTriIdx.length; t += 3) {
			var ai = rawTriIdx[t], bi = rawTriIdx[t + 1], ci = rawTriIdx[t + 2];
			var ax = pc.x[ai], ay = pc.y[ai], az = pc.z[ai];
			var bx = pc.x[bi], by = pc.y[bi], bz = pc.z[bi];
			var cx = pc.x[ci], cy = pc.y[ci], cz = pc.z[ci];

			if (maxEdgeSq > 0) {
				var d1 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
				var d2 = (cx - bx) * (cx - bx) + (cy - by) * (cy - by);
				var d3 = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
				if (consider3DLength) {
					d1 += (bz - az) * (bz - az);
					d2 += (cz - bz) * (cz - bz);
					d3 += (az - cz) * (az - cz);
				}
				if (d1 > maxEdgeSq || d2 > maxEdgeSq || d3 > maxEdgeSq) {
					culledByEdge++;
					continue;
				}
			}

			if (minAngle > 0) {
				var e1 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
				var e2 = (cx - bx) * (cx - bx) + (cy - by) * (cy - by);
				var e3 = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
				if (consider3DAngle) {
					e1 += (bz - az) * (bz - az);
					e2 += (cz - bz) * (cz - bz);
					e3 += (az - cz) * (az - cz);
				}
				var le1 = Math.sqrt(e1), le2 = Math.sqrt(e2), le3 = Math.sqrt(e3);
				var a1 = Math.acos(Math.max(-1, Math.min(1, (e2 + e3 - e1) / (2 * le2 * le3)))) * 57.29577951308232;
				var a2 = Math.acos(Math.max(-1, Math.min(1, (e1 + e3 - e2) / (2 * le1 * le3)))) * 57.29577951308232;
				var a3 = Math.acos(Math.max(-1, Math.min(1, (e1 + e2 - e3) / (2 * le1 * le2)))) * 57.29577951308232;
				if (Math.min(a1, a2, a3) < minAngle) {
					culledByAngle++;
					continue;
				}
			}

			temp[writePos++] = ai;
			temp[writePos++] = bi;
			temp[writePos++] = ci;
		}

		keptIndices = temp.slice(0, writePos);
		temp = null;
	} else {
		// No culling needed — use raw indices directly
		keptIndices = rawTriIdx;
	}

	rawTriIdx = null;

	var surfaceId = surfaceName.replace(/\s+/g, "_") + "_" + Date.now();
	var triangleCount = keptIndices.length / 3;

	sendProgress(95, "Preparing transfer (" + pc.count.toLocaleString() + " points, " + triangleCount.toLocaleString() + " triangles)...");

	return {
		surfaceId: surfaceId,
		surfaceName: surfaceName,
		surfaceStyle: surfaceStyle,
		pointsX: pc.x,
		pointsY: pc.y,
		pointsZ: pc.z,
		pointCount: pc.count,
		triangleIndices: keptIndices,
		triangleCount: triangleCount,
		culledByEdge: culledByEdge,
		culledByAngle: culledByAngle,
		maxEdgeLength: maxEdgeLength,
		minAngle: minAngle,
		hasRgb: pc.hasRgb,
		r: pc.r,
		g: pc.g,
		b: pc.b
	};
}

// ─── KAD Format Conversion ───────────────────────────────────────

function convertToKadFormat(pc, stats, preserveColors) {
	if (preserveColors === undefined) preserveColors = true;

	var range = stats.maxZ - stats.minZ;
	var classBuckets = {};

	for (var i = 0; i < pc.count; i++) {
		var cls = pc.classification[i];
		var clsName = LAS_CLASSIFICATIONS[cls] || "Reserved";
		var classKey = "Class_" + cls + "_" + clsName.replace(/[^a-zA-Z0-9]/g, "_");

		if (!classBuckets[classKey]) {
			classBuckets[classKey] = [];
		}

		var pointColor;
		if (preserveColors && pc.hasRgb && (pc.r[i] || pc.g[i] || pc.b[i])) {
			pointColor = rgbToHex(pc.r[i], pc.g[i], pc.b[i]);
		} else {
			var rgb = elevationColorRGB(pc.z[i], stats.minZ, range);
			pointColor = rgbToHex(rgb[0], rgb[1], rgb[2]);
		}

		classBuckets[classKey].push({
			entityName: classKey,
			entityType: "point",
			pointID: i,
			pointXLocation: pc.x[i],
			pointYLocation: pc.y[i],
			pointZLocation: pc.z[i],
			lineWidth: 1,
			color: pointColor,
			intensity: pc.intensity[i],
			classification: cls,
			returnNumber: pc.returnNumber[i],
			numberOfReturns: pc.numberOfReturns[i],
			connected: false,
			closed: false
		});
	}

	var kadEntries = [];
	var keys = Object.keys(classBuckets);
	for (var k = 0; k < keys.length; k++) {
		var className = keys[k];
		kadEntries.push({
			key: className,
			value: { entityName: className, entityType: "point", data: classBuckets[className] }
		});
	}

	return kadEntries;
}

// ─── Worker Message Handler ──────────────────────────────────────

self.onmessage = function(e) {
	var msg = e.data;

	function sendProgress(percent, message) {
		self.postMessage({ type: "progress", percent: percent, message: message });
	}

	try {
		if (msg.type === "parsePoints") {
			var payload = msg.payload;
			var arrayBuffer = payload.arrayBuffer;
			var header = payload.header;
			var config = payload.config;
			var numPoints = Number(header.numberOfPoints);

			var dataView = new DataView(arrayBuffer);

			var targetPoints;
			if (config.importType === "surface") {
				targetPoints = config.maxSurfacePoints || 0;
			} else {
				targetPoints = config.maxPoints || 0;
			}

			var stride = 1;
			if (targetPoints > 0 && numPoints > targetPoints) {
				stride = Math.max(1, Math.floor(numPoints / targetPoints));
			}

			var classFilter = null;
			if (config.classificationFilter && config.classificationFilter !== "all") {
				classFilter = CLASSIFICATION_FILTERS[config.classificationFilter] || null;
			}

			// Phase 1: Parse binary → typed arrays
			sendProgress(5, "Parsing " + numPoints.toLocaleString() + " records (stride " + stride + ")...");
			var pc = parseToTypedArrays(dataView, header, stride, classFilter, targetPoints, sendProgress);
			sendProgress(36, "Parsed " + pc.count.toLocaleString() + " points from " + numPoints.toLocaleString() + " records");

			dataView = null;
			arrayBuffer = null;

			// Phase 2: Coordinate transformation
			if (config.transform) {
				applyTransform(pc, config, sendProgress);
			}

			// Phase 3: Statistics
			sendProgress(44, "Computing statistics...");
			var stats = computeStats(pc);

			if (config.importType === "surface") {
				// ─── Surface Path ─────────────────────────────────

				if (config.xyzTolerance > 0) {
					sendProgress(48, "Deduplicating...");
					pc = deduplicateTyped(pc, config.xyzTolerance, sendProgress, 48);
					sendProgress(58, "Deduplicated to " + pc.count.toLocaleString() + " points");
				}

				// Triangulate — returns typed arrays
				var surfResult = createTriangulatedSurface(pc, config, stats, sendProgress);
				pc = null;

				// Transfer typed arrays (zero-copy) to avoid structured clone OOM
				var transferList = [
					surfResult.pointsX.buffer,
					surfResult.pointsY.buffer,
					surfResult.pointsZ.buffer,
					surfResult.triangleIndices.buffer
				];
				if (surfResult.hasRgb && surfResult.r) {
					transferList.push(surfResult.r.buffer, surfResult.g.buffer, surfResult.b.buffer);
				}

				sendProgress(100, "Complete!");
				self.postMessage({
					type: "result",
					data: {
						resultType: "surface_typed",
						surfaceId: surfResult.surfaceId,
						surfaceName: surfResult.surfaceName,
						surfaceStyle: surfResult.surfaceStyle,
						pointsX: surfResult.pointsX,
						pointsY: surfResult.pointsY,
						pointsZ: surfResult.pointsZ,
						pointCount: surfResult.pointCount,
						triangleIndices: surfResult.triangleIndices,
						triangleCount: surfResult.triangleCount,
						hasRgb: surfResult.hasRgb,
						r: surfResult.r,
						g: surfResult.g,
						b: surfResult.b,
						meshBounds: {
							minX: stats.minX, maxX: stats.maxX,
							minY: stats.minY, maxY: stats.maxY,
							minZ: stats.minZ, maxZ: stats.maxZ
						},
						statistics: stats,
						config: config,
						metadata: {
							source: "LAS_import",
							pointCount: surfResult.pointCount,
							triangleCount: surfResult.triangleCount,
							culledByEdge: surfResult.culledByEdge,
							culledByAngle: surfResult.culledByAngle,
							maxEdgeLength: surfResult.maxEdgeLength,
							minAngle: surfResult.minAngle
						}
					}
				}, transferList);
			} else {
				// ─── Point Cloud Path ─────────────────────────────
				var originalCount = pc.count;

				if (config.pcXyTolerance > 0) {
					sendProgress(50, "Deduplicating " + pc.count.toLocaleString() + " points...");
					pc = deduplicateTyped(pc, config.pcXyTolerance, sendProgress, 50);
					sendProgress(60, "Deduplicated to " + pc.count.toLocaleString() + " points");
				}

				// Always send typed arrays via Transferable — no structured clone OOM
				sendProgress(70, "Preparing transfer (" + pc.count.toLocaleString() + " points)...");

				var transferList = [pc.x.buffer, pc.y.buffer, pc.z.buffer,
					pc.classification.buffer, pc.intensity.buffer,
					pc.returnNumber.buffer, pc.numberOfReturns.buffer];
				if (pc.hasRgb) {
					transferList.push(pc.r.buffer, pc.g.buffer, pc.b.buffer);
				}

				sendProgress(100, "Complete!");
				self.postMessage({
					type: "result",
					data: {
						resultType: "pointcloud_typed",
						typedArrays: {
							count: pc.count,
							x: pc.x,
							y: pc.y,
							z: pc.z,
							classification: pc.classification,
							intensity: pc.intensity,
							returnNumber: pc.returnNumber,
							numberOfReturns: pc.numberOfReturns,
							hasRgb: pc.hasRgb,
							r: pc.r,
							g: pc.g,
							b: pc.b
						},
						statistics: stats,
						header: header,
						config: config,
						originalPointCount: originalCount,
						processedPointCount: pc.count
					}
				}, transferList);
			}
		} else {
			self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
		}
	} catch (err) {
		self.postMessage({ type: "error", message: err.message || String(err) });
	}
};
