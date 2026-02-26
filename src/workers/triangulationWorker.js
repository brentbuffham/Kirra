/**
 * triangulationWorker.js - Web Worker for Delaunay and Constrained Delaunay Triangulation
 *
 * Runs triangulation computation off the main thread so the UI stays responsive.
 * No time limits, no requestAnimationFrame batching — just a simple loop that
 * processes ALL constraints and posts progress updates back to the main thread.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'triangulate',      payload: { points, constraintSegments, options } }
 *     { type: 'triangulateBasic', payload: { points, options } }
 *
 *   Worker → Main:
 *     { type: 'progress', percent, message }
 *     { type: 'result',   data: { resultTriangles, points, stats } }
 *     { type: 'error',    message }
 */

import Delaunator from "delaunator";
import Constrainautor from "@kninnug/constrainautor";

// ---------------------------------------------------------------------------
// Utility: deduplicate vertices using spatial hashing — O(n) performance
// ---------------------------------------------------------------------------

function getUniqueElementVertices(xyzVertices, tolerance, progressCallback) {
	var cellSize = tolerance * 2;
	var spatialHash = new Map();
	var uniqueVertices = [];
	var totalVertices = xyzVertices.length;
	var PROGRESS_INTERVAL = 10000;

	function getCellKey(x, y) {
		var cellX = Math.floor(x / cellSize);
		var cellY = Math.floor(y / cellSize);
		return cellX + "," + cellY;
	}

	function isDuplicateInNeighbors(vertex) {
		var cellX = Math.floor(vertex.x / cellSize);
		var cellY = Math.floor(vertex.y / cellSize);

		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				var neighborKey = (cellX + dx) + "," + (cellY + dy);
				var cellVertices = spatialHash.get(neighborKey);
				if (cellVertices) {
					for (var j = 0; j < cellVertices.length; j++) {
						var existing = cellVertices[j];
						var distX = vertex.x - existing.x;
						var distY = vertex.y - existing.y;
						var distSquared = distX * distX + distY * distY;
						if (distSquared <= tolerance * tolerance) {
							return true;
						}
					}
				}
			}
		}
		return false;
	}

	for (var i = 0; i < totalVertices; i++) {
		var vertex = xyzVertices[i];

		if (!isDuplicateInNeighbors(vertex)) {
			uniqueVertices.push(vertex);

			var cellKey = getCellKey(vertex.x, vertex.y);
			if (!spatialHash.has(cellKey)) {
				spatialHash.set(cellKey, []);
			}
			spatialHash.get(cellKey).push(vertex);
		}

		if (progressCallback && i > 0 && i % PROGRESS_INTERVAL === 0) {
			var progressPercent = Math.floor((i / totalVertices) * 100);
			progressCallback(progressPercent, "Deduplicating: " + i.toLocaleString() + " / " + totalVertices.toLocaleString() + " (" + uniqueVertices.length.toLocaleString() + " unique)");
		}
	}

	return uniqueVertices;
}

// ---------------------------------------------------------------------------
// Utility: spatial index for efficient vertex lookup
// ---------------------------------------------------------------------------

function createSpatialIndex(vertices, tolerance) {
	var index = new Map();

	vertices.forEach(function (vertex, vertexIndex) {
		var baseX = Math.floor(vertex.x / tolerance) * tolerance;
		var baseY = Math.floor(vertex.y / tolerance) * tolerance;

		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				var gridX = baseX + dx * tolerance;
				var gridY = baseY + dy * tolerance;
				var key = gridX.toFixed(10) + "_" + gridY.toFixed(10);

				if (!index.has(key)) {
					index.set(key, []);
				}
				index.get(key).push({ vertex: vertex, index: vertexIndex });
			}
		}

		var exactKey = "exact_" + vertex.x.toFixed(10) + "_" + vertex.y.toFixed(10);
		if (!index.has(exactKey)) {
			index.set(exactKey, []);
		}
		index.get(exactKey).push({ vertex: vertex, index: vertexIndex });
	});

	return index;
}

function findClosestVertexIndex(spatialIndex, targetX, targetY, tolerance) {
	var exactKey = "exact_" + targetX.toFixed(10) + "_" + targetY.toFixed(10);
	var exactCandidates = spatialIndex.get(exactKey) || [];

	if (exactCandidates.length > 0) {
		return exactCandidates[0].index;
	}

	var gridX = Math.floor(targetX / tolerance) * tolerance;
	var gridY = Math.floor(targetY / tolerance) * tolerance;
	var gridKey = gridX.toFixed(10) + "_" + gridY.toFixed(10);
	var gridCandidates = spatialIndex.get(gridKey) || [];

	var bestMatch = null;
	var bestDistance = Infinity;

	for (var c = 0; c < gridCandidates.length; c++) {
		var candidate = gridCandidates[c];
		var dx = candidate.vertex.x - targetX;
		var dy = candidate.vertex.y - targetY;
		var distance = Math.sqrt(dx * dx + dy * dy);

		if (distance <= tolerance && distance < bestDistance) {
			bestMatch = candidate;
			bestDistance = distance;
		}
	}

	return bestMatch ? bestMatch.index : null;
}

// ---------------------------------------------------------------------------
// Constraint extraction from deduplicated vertices
// ---------------------------------------------------------------------------

function extractConstraintsFromDeduplicatedVertices(elementVertices, kadEntities, tolerance) {
	var constraints = [];
	var entitiesWithUnmappedSegments = [];

	var spatialIndex = createSpatialIndex(elementVertices, tolerance);

	for (var e = 0; e < kadEntities.length; e++) {
		var entityInfo = kadEntities[e];
		var entity = entityInfo.entity;
		var entityName = entityInfo.entityName;

		if (entity.entityType !== "line" && entity.entityType !== "poly") {
			continue;
		}

		var unmappedCount = 0;

		for (var i = 0; i < entity.data.length - 1; i++) {
			var startPoint = entity.data[i];
			var endPoint = entity.data[i + 1];

			var startX = parseFloat(startPoint.pointXLocation) || parseFloat(startPoint.x);
			var startY = parseFloat(startPoint.pointYLocation) || parseFloat(startPoint.y);
			var endX = parseFloat(endPoint.pointXLocation) || parseFloat(endPoint.x);
			var endY = parseFloat(endPoint.pointYLocation) || parseFloat(endPoint.y);

			var startIdx = findClosestVertexIndex(spatialIndex, startX, startY, tolerance);
			var endIdx = findClosestVertexIndex(spatialIndex, endX, endY, tolerance);

			if (startIdx !== null && endIdx !== null && startIdx !== endIdx) {
				constraints.push({
					start: elementVertices[startIdx],
					end: elementVertices[endIdx],
					startIndex: startIdx,
					endIndex: endIdx,
					entityName: entityName,
					segmentIndex: i,
				});
			} else {
				unmappedCount++;
			}
		}

		// Close polygon
		if (entity.entityType === "poly" && entity.data.length > 2) {
			var firstPoint = entity.data[0];
			var lastPoint = entity.data[entity.data.length - 1];

			var firstX = parseFloat(firstPoint.pointXLocation) || parseFloat(firstPoint.x);
			var firstY = parseFloat(firstPoint.pointYLocation) || parseFloat(firstPoint.y);
			var lastX = parseFloat(lastPoint.pointXLocation) || parseFloat(lastPoint.x);
			var lastY = parseFloat(lastPoint.pointYLocation) || parseFloat(lastPoint.y);

			if (Math.abs(firstX - lastX) > tolerance || Math.abs(firstY - lastY) > tolerance) {
				var firstIdx = findClosestVertexIndex(spatialIndex, firstX, firstY, tolerance);
				var lastIdx = findClosestVertexIndex(spatialIndex, lastX, lastY, tolerance);

				if (firstIdx !== null && lastIdx !== null && firstIdx !== lastIdx) {
					constraints.push({
						start: elementVertices[lastIdx],
						end: elementVertices[firstIdx],
						startIndex: lastIdx,
						endIndex: firstIdx,
						entityName: entityName,
						segmentIndex: "closing",
					});
				}
			}
		}

		if (unmappedCount > 0) {
			entitiesWithUnmappedSegments.push(entityName);
		}
	}

	return {
		constraints: constraints,
		entitiesWithUnmappedSegments: entitiesWithUnmappedSegments,
	};
}

// ---------------------------------------------------------------------------
// Constrained Delaunay Triangulation (Constrainautor) — NO time limits
// ---------------------------------------------------------------------------

function createConstrainautorTriangulation(points, constraintSegments, options, sendProgress) {
	var entitiesWithUnmappedSegments = new Set(options.entitiesWithUnmappedSegments || []);

	// Build flat coordinate array
	var coords = new Float64Array(points.length * 2);
	for (var i = 0; i < points.length; i++) {
		coords[i * 2] = points[i].x;
		coords[i * 2 + 1] = points[i].y;
	}

	sendProgress(35, "Creating Delaunay triangulation with " + points.length + " points...");

	var delaunay = new Delaunator(coords);

	sendProgress(40, "Delaunay created: " + (delaunay.triangles.length / 3) + " triangles. Preparing constraints...");

	// Prepare constraint edges
	var constraintEdges = [];
	var validConstraints = [];

	for (var s = 0; s < constraintSegments.length; s++) {
		var segment = constraintSegments[s];
		var startIdx = segment.startIndex;
		var endIdx = segment.endIndex;

		if (startIdx !== undefined && endIdx !== undefined && startIdx !== endIdx &&
			startIdx >= 0 && startIdx < points.length && endIdx >= 0 && endIdx < points.length) {
			constraintEdges.push([startIdx, endIdx]);
			validConstraints.push(segment);
		}
	}

	// Sort: problematic entities first
	if (entitiesWithUnmappedSegments.size > 0) {
		var problematicEdges = [];
		var problematicConstraints = [];
		var normalEdges = [];
		var normalConstraints = [];

		for (var k = 0; k < constraintEdges.length; k++) {
			var constraint = validConstraints[k];
			var edge = constraintEdges[k];

			if (constraint && constraint.entityName && entitiesWithUnmappedSegments.has(constraint.entityName)) {
				problematicEdges.push(edge);
				problematicConstraints.push(constraint);
			} else {
				normalEdges.push(edge);
				normalConstraints.push(constraint);
			}
		}

		constraintEdges = problematicEdges.concat(normalEdges);
		validConstraints = problematicConstraints.concat(normalConstraints);
	}

	if (constraintEdges.length === 0) {
		sendProgress(90, "No constraints to apply, finalizing...");
		return finalizTriangles(delaunay, points, 0, 0);
	}

	// Create Constrainautor
	var constrainautor = new Constrainautor(delaunay);

	sendProgress(45, "Applying " + constraintEdges.length + " constraints...");

	// Edge tracking
	var constrainedEdges = new Set();
	var constrainedEdgeList = [];

	function getEdgeKey(a, b) {
		return Math.min(a, b) + "_" + Math.max(a, b);
	}
	function isEdgeConstrained(a, b) {
		return constrainedEdges.has(getEdgeKey(a, b));
	}
	function markEdgeConstrained(a, b) {
		constrainedEdges.add(getEdgeKey(a, b));
		constrainedEdgeList.push([a, b]);
	}

	// Segment intersection check
	function segmentsIntersect(p1, p2, p3, p4) {
		var d1 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
		var d2 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
		var d3 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
		var d4 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);

		if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
			((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
			return true;
		}
		return false;
	}

	// Find collinear points on an edge
	function findPointsOnEdge(sIdx, eIdx) {
		var p1 = points[sIdx];
		var p2 = points[eIdx];
		if (!p1 || !p2) return [];

		var dx = p2.x - p1.x;
		var dy = p2.y - p1.y;
		var lengthSq = dx * dx + dy * dy;
		if (lengthSq < 0.00000001) return [];

		var tol = 0.01;
		var tolSq = tol * tol;
		var result = [];

		var minX = Math.min(p1.x, p2.x) - tol;
		var maxX = Math.max(p1.x, p2.x) + tol;
		var minY = Math.min(p1.y, p2.y) - tol;
		var maxY = Math.max(p1.y, p2.y) + tol;

		for (var j = 0; j < points.length; j++) {
			if (j === sIdx || j === eIdx) continue;
			var p = points[j];
			if (!p) continue;
			if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;

			var px = p.x - p1.x;
			var py = p.y - p1.y;
			var t = (px * dx + py * dy) / lengthSq;
			if (t <= 0.001 || t >= 0.999) continue;

			var closestX = p1.x + t * dx;
			var closestY = p1.y + t * dy;
			var distSq = (p.x - closestX) * (p.x - closestX) + (p.y - closestY) * (p.y - closestY);

			if (distSq < tolSq) {
				result.push({ index: j, t: t });
			}
		}

		result.sort(function (a, b) { return a.t - b.t; });
		return result.map(function (item) { return item.index; });
	}

	// Split constraint through collinear points
	function splitConstraintThroughPoints(sIdx, eIdx) {
		var onEdge = findPointsOnEdge(sIdx, eIdx);
		if (onEdge.length === 0) return [[sIdx, eIdx]];

		var segments = [];
		var currentStart = sIdx;
		for (var j = 0; j < onEdge.length; j++) {
			segments.push([currentStart, onEdge[j]]);
			currentStart = onEdge[j];
		}
		segments.push([currentStart, eIdx]);
		return segments;
	}

	// Check if a new edge would intersect existing constrained edges
	function wouldIntersectConstrainedEdges(sIdx, eIdx) {
		var p1 = points[sIdx];
		var p2 = points[eIdx];
		if (!p1 || !p2) return false;

		for (var j = 0; j < constrainedEdgeList.length; j++) {
			var existingStart = constrainedEdgeList[j][0];
			var existingEnd = constrainedEdgeList[j][1];

			if (sIdx === existingStart || sIdx === existingEnd || eIdx === existingStart || eIdx === existingEnd) {
				continue;
			}

			var p3 = points[existingStart];
			var p4 = points[existingEnd];
			if (!p3 || !p4) continue;

			if (segmentsIntersect(p1, p2, p3, p4)) {
				return true;
			}
		}
		return false;
	}

	// -----------------------------------------------------------------------
	// Main constraint loop — NO time limit, NO batching, just a simple loop
	// -----------------------------------------------------------------------

	var successfulConstraints = 0;
	var PROGRESS_EVERY = 100;

	for (var ci = 0; ci < constraintEdges.length; ci++) {
		// Post progress every N constraints
		if (ci % PROGRESS_EVERY === 0) {
			var pct = 45 + Math.round((ci / constraintEdges.length) * 45);
			sendProgress(Math.min(pct, 90), "Applying constraints: " + ci + " / " + constraintEdges.length + " (" + successfulConstraints + " applied)");
		}

		var cEdge = constraintEdges[ci];
		var cStartIdx = cEdge[0];
		var cEndIdx = cEdge[1];
		var cConstraint = validConstraints[ci];

		// Skip already-constrained
		if (isEdgeConstrained(cStartIdx, cEndIdx)) continue;

		// Validate indices
		if (cStartIdx < 0 || cEndIdx < 0 || cStartIdx >= points.length || cEndIdx >= points.length || cStartIdx === cEndIdx) continue;

		// Skip extremely short edges
		var cp1 = points[cStartIdx];
		var cp2 = points[cEndIdx];
		if (cp1 && cp2) {
			var cdx = cp2.x - cp1.x;
			var cdy = cp2.y - cp1.y;
			if (Math.sqrt(cdx * cdx + cdy * cdy) < 0.0001) continue;
		}

		// Check for collinear points — split if found
		var collinear = findPointsOnEdge(cStartIdx, cEndIdx);
		if (collinear.length > 0) {
			var splitSegs = splitConstraintThroughPoints(cStartIdx, cEndIdx);
			var splitOk = 0;
			for (var si = 0; si < splitSegs.length; si++) {
				var ss = splitSegs[si][0];
				var se = splitSegs[si][1];
				if (isEdgeConstrained(ss, se)) continue;
				try {
					constrainautor.constrainOne(ss, se);
					markEdgeConstrained(ss, se);
					splitOk++;
				} catch (splitErr) {
					var splitMsg = splitErr.message || "";
					if (splitMsg.includes("already constrained") || splitMsg.includes("intersects already constrained")) {
						markEdgeConstrained(ss, se);
					}
				}
			}
			markEdgeConstrained(cStartIdx, cEndIdx);
			successfulConstraints += splitOk;
			continue;
		}

		// Check if would intersect existing constrained edges
		if (wouldIntersectConstrainedEdges(cStartIdx, cEndIdx)) {
			markEdgeConstrained(cStartIdx, cEndIdx);
			continue;
		}

		// Apply the constraint
		try {
			constrainautor.constrainOne(cStartIdx, cEndIdx);
			markEdgeConstrained(cStartIdx, cEndIdx);
			successfulConstraints++;
		} catch (constraintErr) {
			var errMsg = constraintErr.message || "";
			if (errMsg.includes("already constrained") || errMsg.includes("intersects already constrained") || errMsg.includes("intersects point")) {
				markEdgeConstrained(cStartIdx, cEndIdx);
			}
		}
	}

	sendProgress(92, "Finalizing " + (delaunay.triangles.length / 3) + " triangles...");

	var failedConstraints = constraintEdges.length - successfulConstraints;
	return finalizTriangles(delaunay, points, successfulConstraints, constraintEdges.length);
}

// ---------------------------------------------------------------------------
// Convert Delaunator output to the result triangle format
// ---------------------------------------------------------------------------

function finalizTriangles(delaunay, points, successfulConstraints, totalAttempts) {
	var resultTriangles = [];
	var triangles = delaunay.triangles;

	for (var i = 0; i < triangles.length; i += 3) {
		var idx1 = triangles[i];
		var idx2 = triangles[i + 1];
		var idx3 = triangles[i + 2];

		var v1 = points[idx1];
		var v2 = points[idx2];
		var v3 = points[idx3];

		if (v1 && v2 && v3) {
			resultTriangles.push({
				vertices: [v1, v2, v3],
				indices: [idx1, idx2, idx3],
				minZ: Math.min(v1.z || 0, v2.z || 0, v3.z || 0),
				maxZ: Math.max(v1.z || 0, v2.z || 0, v3.z || 0),
			});
		}
	}

	return {
		resultTriangles: resultTriangles,
		points: points,
		stats: {
			algorithm: "constrainautor",
			originalPoints: points.length,
			triangles: resultTriangles.length,
			constraints: successfulConstraints,
			constraintAttempts: totalAttempts,
			failedConstraints: totalAttempts - successfulConstraints,
		},
	};
}

// ---------------------------------------------------------------------------
// Basic Delaunay triangulation (no constraints)
// ---------------------------------------------------------------------------

function createBasicDelaunayTriangulation(points, options, sendProgress) {
	var tolerance = options.tolerance || 0.001;
	var minAngleTolerance = options.minAngle || 0;
	var maxEdgeLength = options.maxEdgeLength || 0;

	sendProgress(10, "Deduplicating " + points.length + " vertices...");

	// Deduplicate
	points = getUniqueElementVertices(points, tolerance, function (pct, msg) {
		sendProgress(10 + Math.floor(pct * 0.2), msg);
	});

	if (points.length < 3) {
		return { resultTriangles: [], points: [], stats: {} };
	}

	sendProgress(30, "Creating Delaunay triangulation with " + points.length + " vertices...");

	var getX = function (p) { return parseFloat(p.x); };
	var getY = function (p) { return parseFloat(p.y); };
	var delaunay = Delaunator.from(points, getX, getY);

	sendProgress(50, "Processing " + (delaunay.triangles.length / 3) + " triangles...");

	var resultTriangles = [];
	var maxEdgeLengthSquared = maxEdgeLength > 0 ? maxEdgeLength * maxEdgeLength : Infinity;
	var totalTriangles = delaunay.triangles.length / 3;
	var PROGRESS_EVERY = 5000;

	for (var i = 0; i < delaunay.triangles.length; i += 3) {
		var triIdx = i / 3;
		if (triIdx % PROGRESS_EVERY === 0) {
			sendProgress(50 + Math.floor((triIdx / totalTriangles) * 40), "Processing triangle " + triIdx.toLocaleString() + " / " + totalTriangles.toLocaleString());
		}

		var p1 = points[delaunay.triangles[i]];
		var p2 = points[delaunay.triangles[i + 1]];
		var p3 = points[delaunay.triangles[i + 2]];

		// Edge length filter
		var e1sq = (p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y);
		var e2sq = (p2.x - p3.x) * (p2.x - p3.x) + (p2.y - p3.y) * (p2.y - p3.y);
		var e3sq = (p3.x - p1.x) * (p3.x - p1.x) + (p3.y - p1.y) * (p3.y - p1.y);

		if (e1sq > maxEdgeLengthSquared || e2sq > maxEdgeLengthSquared || e3sq > maxEdgeLengthSquared) {
			continue;
		}

		// Angle filter
		if (minAngleTolerance > 0) {
			var e1 = Math.sqrt(e1sq);
			var e2 = Math.sqrt(e2sq);
			var e3 = Math.sqrt(e3sq);
			var a1 = Math.acos(Math.max(-1, Math.min(1, (e2sq + e3sq - e1sq) / (2 * e2 * e3)))) * (180 / Math.PI);
			var a2 = Math.acos(Math.max(-1, Math.min(1, (e1sq + e3sq - e2sq) / (2 * e1 * e3)))) * (180 / Math.PI);
			var a3 = Math.acos(Math.max(-1, Math.min(1, (e1sq + e2sq - e3sq) / (2 * e1 * e2)))) * (180 / Math.PI);
			if (Math.min(a1, a2, a3) < minAngleTolerance) {
				continue;
			}
		}

		resultTriangles.push({
			vertices: [
				{ x: parseFloat(p1.x), y: parseFloat(p1.y), z: parseFloat(p1.z) },
				{ x: parseFloat(p2.x), y: parseFloat(p2.y), z: parseFloat(p2.z) },
				{ x: parseFloat(p3.x), y: parseFloat(p3.y), z: parseFloat(p3.z) },
			],
			minZ: Math.min(parseFloat(p1.z), parseFloat(p2.z), parseFloat(p3.z)),
			maxZ: Math.max(parseFloat(p1.z), parseFloat(p2.z), parseFloat(p3.z)),
		});
	}

	sendProgress(95, "Generated " + resultTriangles.length + " triangles");

	return {
		resultTriangles: resultTriangles,
		points: points,
		stats: {
			algorithm: "delaunator",
			originalPoints: points.length,
			triangles: resultTriangles.length,
		},
	};
}

// ---------------------------------------------------------------------------
// Constrained Delaunay — full pipeline (dedup + extract constraints + CDT)
// ---------------------------------------------------------------------------

function runConstrainedTriangulation(payload, sendProgress) {
	var points = payload.points;
	var constraintSegments = payload.constraintSegments;
	var kadEntities = payload.kadEntities;
	var options = payload.options || {};
	var tolerance = options.tolerance || 0.001;

	sendProgress(10, "Deduplicating " + points.length + " vertices...");

	// Deduplicate
	var originalCount = points.length;
	points = getUniqueElementVertices(points, tolerance, function (pct, msg) {
		sendProgress(10 + Math.floor(pct * 0.1), msg);
	});

	sendProgress(22, "Deduplication: " + originalCount + " -> " + points.length + " vertices");

	if (points.length < 3) {
		return { resultTriangles: [], points: [], stats: {} };
	}

	// Extract constraints if kadEntities provided (otherwise use pre-extracted constraintSegments)
	if (kadEntities && kadEntities.length > 0 && (!constraintSegments || constraintSegments.length === 0)) {
		sendProgress(25, "Extracting constraints from " + kadEntities.length + " entities...");
		var constraintData = extractConstraintsFromDeduplicatedVertices(points, kadEntities, tolerance);
		constraintSegments = constraintData.constraints;
		options.entitiesWithUnmappedSegments = constraintData.entitiesWithUnmappedSegments;
	}

	if (!constraintSegments || constraintSegments.length === 0) {
		// No constraints — do basic Delaunay and convert
		sendProgress(30, "No constraints found, creating basic Delaunay...");
		var getX = function (p) { return p.x; };
		var getY = function (p) { return p.y; };
		var del = Delaunator.from(points, getX, getY);
		return finalizTriangles(del, points, 0, 0);
	}

	sendProgress(30, "Found " + constraintSegments.length + " constraints. Starting CDT...");

	// Run constrained triangulation
	var result = createConstrainautorTriangulation(points, constraintSegments, options, sendProgress);

	// Fallback if CDT produced no triangles
	if (!result || !result.resultTriangles || result.resultTriangles.length === 0) {
		sendProgress(95, "CDT produced no output, falling back to basic Delaunay...");
		var getX2 = function (p) { return p.x; };
		var getY2 = function (p) { return p.y; };
		var del2 = Delaunator.from(points, getX2, getY2);
		return finalizTriangles(del2, points, 0, 0);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = function (e) {
	var msg = e.data;

	function sendProgress(percent, message) {
		self.postMessage({ type: "progress", percent: percent, message: message });
	}

	try {
		if (msg.type === "triangulate") {
			sendProgress(5, "Starting constrained triangulation...");
			var result = runConstrainedTriangulation(msg.payload, sendProgress);
			sendProgress(100, "Complete!");
			self.postMessage({ type: "result", data: result });
		} else if (msg.type === "triangulateBasic") {
			sendProgress(5, "Starting basic Delaunay triangulation...");
			var basicResult = createBasicDelaunayTriangulation(
				msg.payload.points,
				msg.payload.options || {},
				sendProgress
			);
			sendProgress(100, "Complete!");
			self.postMessage({ type: "result", data: basicResult });
		} else {
			self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
		}
	} catch (err) {
		self.postMessage({ type: "error", message: err.message || String(err) });
	}
};
