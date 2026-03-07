/**
 * PointDeduplication.js
 *
 * XY-only point deduplication using spatial hash grid (O(n) amortized).
 * Designed for 2.5D surface triangulation where one Z per XY location is expected.
 * Also provides uniform stride-based decimation.
 */

/**
 * Deduplicate points based on XY distance using a spatial hash grid.
 * Points within the tolerance distance (XY only) are merged - the first
 * encountered point is kept and subsequent duplicates are discarded.
 *
 * @param {Array} points - Array of point objects with x, y, z properties
 * @param {number} tolerance - XY distance tolerance for merging (default 0.001)
 * @returns {{ uniquePoints: Array, originalCount: number, uniqueCount: number }}
 */
export function deduplicatePoints(points, tolerance) {
	if (!points || points.length === 0) {
		return { uniquePoints: [], originalCount: 0, uniqueCount: 0 };
	}

	tolerance = tolerance || 0.001;
	if (tolerance <= 0) tolerance = 0.001;

	var toleranceSq = tolerance * tolerance;
	var cellSize = tolerance;
	var grid = new Map();
	var uniquePoints = [];

	for (var i = 0; i < points.length; i++) {
		var point = points[i];
		var px = point.x;
		var py = point.y;

		// Compute grid cell indices
		var cellX = Math.floor(px / cellSize);
		var cellY = Math.floor(py / cellSize);

		// Check current cell and 8 XY neighbors for existing points within tolerance
		var foundDuplicate = false;

		for (var dx = -1; dx <= 1 && !foundDuplicate; dx++) {
			for (var dy = -1; dy <= 1 && !foundDuplicate; dy++) {
				var key = (cellX + dx) + "_" + (cellY + dy);
				var cell = grid.get(key);
				if (!cell) continue;

				for (var j = 0; j < cell.length; j++) {
					var existing = cell[j];
					var ex = existing.x - px;
					var ey = existing.y - py;
					if (ex * ex + ey * ey <= toleranceSq) {
						foundDuplicate = true;
						break;
					}
				}
			}
		}

		if (!foundDuplicate) {
			// Add to grid and unique list
			var ownKey = cellX + "_" + cellY;
			var ownCell = grid.get(ownKey);
			if (!ownCell) {
				ownCell = [];
				grid.set(ownKey, ownCell);
			}
			ownCell.push(point);
			uniquePoints.push(point);
		}
	}

	return {
		uniquePoints: uniquePoints,
		originalCount: points.length,
		uniqueCount: uniquePoints.length
	};
}

/**
 * Decimate a point array to a target count using uniform stride-based sampling.
 * Always keeps the first point. Evenly samples across the array.
 *
 * @param {Array} points - Array of point objects
 * @param {number} targetCount - Maximum number of points to keep
 * @returns {Array} Decimated array of points
 */
export function decimatePoints(points, targetCount) {
	if (!points || points.length <= targetCount) return points;
	if (targetCount <= 0) return points;

	var step = Math.floor(points.length / targetCount);
	if (step < 1) step = 1;

	var decimatedPoints = [];
	for (var i = 0; i < points.length; i += step) {
		decimatedPoints.push(points[i]);
	}

	return decimatedPoints;
}

/**
 * Decimate a surface by reducing its point count and retriangulating with Delaunator.
 * Uses the existing triangulation worker for off-main-thread processing.
 * This produces a gap-free surface (no holes), unlike stride-based triangle sampling.
 *
 * @param {Array} points - Original points array [{x, y, z}, ...]
 * @param {number} targetTriCount - Desired maximum triangle count
 * @param {Function} [onProgress] - Optional callback(percent, message) for progress updates
 * @returns {Promise<{ triangles: Array, points: Array, originalPointCount: number, decimatedPointCount: number }>}
 */
export function decimateSurfaceAndRetriangulate(points, targetTriCount, onProgress) {
	// Delaunator produces ~2x as many triangles as points for well-distributed 2D points.
	// So target point count ≈ targetTriCount / 2 (with some headroom).
	var targetPoints = Math.ceil(targetTriCount / 2);
	if (!points || points.length <= targetPoints) {
		return Promise.resolve({ triangles: null, points: points, originalPointCount: points ? points.length : 0, decimatedPointCount: points ? points.length : 0, skipped: true });
	}

	var originalCount = points.length;

	// Stride-based point sampling
	if (onProgress) onProgress(5, "Sampling " + targetPoints.toLocaleString() + " points from " + originalCount.toLocaleString() + "...");

	var step = originalCount / targetPoints;
	var sampledPoints = [];
	for (var i = 0; i < targetPoints; i++) {
		var idx = Math.floor(i * step);
		if (idx >= originalCount) idx = originalCount - 1;
		sampledPoints.push(points[idx]);
	}

	if (onProgress) onProgress(15, "Sampled " + sampledPoints.length.toLocaleString() + " points. Retriangulating...");

	// Use the triangulation worker (off main thread)
	return import("./TriangulationService.js").then(function (service) {
		return service.triangulateBasic(sampledPoints, { tolerance: 0.001 }, function (percent, message) {
			// Map worker progress (0-100) into our 15-95 range
			var mappedPercent = 15 + Math.floor(percent * 0.8);
			if (onProgress) onProgress(mappedPercent, message);
		});
	}).then(function (result) {
		// The worker creates new vertex objects via parseFloat() in each triangle,
		// breaking object identity. Rebuild triangles so vertices reference the
		// shared points array — this enables indexed geometry in GeometryFactory
		// (3-4x GPU memory savings).
		var pts = result.points;
		var coordToIdx = new Map();
		for (var pi = 0; pi < pts.length; pi++) {
			coordToIdx.set(pts[pi].x + "_" + pts[pi].y + "_" + pts[pi].z, pi);
		}

		var tris = result.resultTriangles;
		for (var ti = 0; ti < tris.length; ti++) {
			var verts = tris[ti].vertices;
			for (var vi = 0; vi < verts.length; vi++) {
				var v = verts[vi];
				var key = v.x + "_" + v.y + "_" + v.z;
				var idx = coordToIdx.get(key);
				if (idx !== undefined) {
					verts[vi] = pts[idx]; // share reference
				}
			}
		}

		if (onProgress) onProgress(100, "Complete: " + tris.length.toLocaleString() + " triangles from " + pts.length.toLocaleString() + " points");

		return {
			triangles: tris,
			points: pts,
			originalPointCount: originalCount,
			decimatedPointCount: pts.length
		};
	});
}
