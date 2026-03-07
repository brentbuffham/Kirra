/**
 * SurfaceDecimationDialog.js
 *
 * Shows a progress dialog when a surface exceeds the triangle budget,
 * offering the user the option to decimate (reduce points + retriangulate)
 * to a manageable size. Uses FloatingDialog for consistent UI.
 *
 * The decimation samples points uniformly then retriangulates via Delaunator
 * in a web worker, producing a gap-free surface.
 */

import { FloatingDialog } from "../../FloatingDialog.js";
import { decimateSurfaceAndRetriangulate } from "../../../helpers/PointDeduplication.js";

/** Default triangle budget for 3D rendering */
var MAX_TRIANGLE_BUDGET = 2000000;

/**
 * Check if a surface needs decimation and offer a dialog if so.
 * Returns a Promise that resolves with the (possibly decimated) surface data.
 *
 * @param {Object} surfaceData - Surface object with .triangles and .points
 * @param {Object} [options]
 * @param {number} [options.budget] - Triangle budget (default 2,000,000)
 * @returns {Promise<Object>} Resolves with surfaceData (mutated if decimated)
 */
export function checkAndOfferDecimation(surfaceData, options) {
	options = options || {};
	var budget = options.budget || MAX_TRIANGLE_BUDGET;

	var triCount = surfaceData.triangles ? surfaceData.triangles.length : 0;

	// Under budget — resolve immediately
	if (triCount <= budget) {
		return Promise.resolve(surfaceData);
	}

	return new Promise(function (resolve) {
		var surfaceName = surfaceData.name || surfaceData.id || "Unknown";
		var estMB = Math.round(triCount * 108 / 1048576);
		var pointCount = surfaceData.points ? surfaceData.points.length : 0;

		// Build dialog content
		var container = document.createElement("div");
		container.className = "surface-decimation-container";

		var warningDiv = document.createElement("div");
		warningDiv.style.cssText = "margin-bottom:12px;font-size:13px;";
		warningDiv.innerHTML =
			"<strong>" + escapeHtml(surfaceName) + "</strong> has <strong>" +
			triCount.toLocaleString() + "</strong> triangles (" +
			pointCount.toLocaleString() + " points, ~" + estMB +
			" MB GPU memory).<br><br>" +
			"This exceeds the 3D render budget of <strong>" +
			budget.toLocaleString() + "</strong> triangles and will cause GPU memory exhaustion.<br><br>" +
			"<strong>Decimate</strong> will sample points and retriangulate (gap-free).<br>" +
			"<strong>Skip 3D</strong> will keep the surface in 2D only.";
		container.appendChild(warningDiv);

		// Target triangle count input
		var inputRow = document.createElement("div");
		inputRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:12px;";
		var inputLabel = document.createElement("label");
		inputLabel.textContent = "Target triangles:";
		inputLabel.style.cssText = "font-size:12px;min-width:110px;";
		var targetInput = document.createElement("input");
		targetInput.type = "number";
		targetInput.value = budget;
		targetInput.min = 10000;
		targetInput.max = triCount;
		targetInput.step = 100000;
		targetInput.style.cssText = "font-size:12px;flex:1;padding:4px;";
		inputRow.appendChild(inputLabel);
		inputRow.appendChild(targetInput);
		container.appendChild(inputRow);

		// Progress bar (hidden initially)
		var progressContainer = document.createElement("div");
		progressContainer.style.cssText = "display:none;margin-top:8px;";
		var progressBar = document.createElement("div");
		progressBar.style.cssText = "width:100%;height:20px;background:var(--input-bg, #e0e0e0);border-radius:4px;overflow:hidden;";
		var progressFill = document.createElement("div");
		progressFill.style.cssText = "width:0%;height:100%;background:linear-gradient(90deg, #4CAF50, #8BC34A);transition:width 0.3s ease;";
		progressBar.appendChild(progressFill);
		progressContainer.appendChild(progressBar);
		var progressLabel = document.createElement("div");
		progressLabel.style.cssText = "font-size:12px;color:var(--text-secondary, #888);margin-top:4px;";
		progressLabel.textContent = "Preparing...";
		progressContainer.appendChild(progressLabel);
		container.appendChild(progressContainer);

		var dialog = new FloatingDialog({
			title: "Surface Too Large",
			content: container,
			width: 460,
			height: 340,
			showConfirm: true,
			confirmText: "Decimate",
			showCancel: true,
			cancelText: "Skip 3D",
			onConfirm: function () {
				// Prevent double-click — disable buttons in the dialog
				var btns = dialog.element ? dialog.element.querySelectorAll("button") : [];
				for (var b = 0; b < btns.length; b++) btns[b].disabled = true;

				var target = parseInt(targetInput.value, 10);
				if (isNaN(target) || target < 10000) target = budget;
				if (target >= triCount) {
					resolve(surfaceData);
					return;
				}

				// Show progress
				progressContainer.style.display = "block";

				// Collect all unique points from triangles (the .points array may not
				// contain all vertices if it was trimmed or from a different source)
				var allPoints = surfaceData.points;
				if (!allPoints || allPoints.length === 0) {
					allPoints = collectPointsFromTriangles(surfaceData.triangles);
				}

				var originalTriCount = surfaceData.triangles.length;

				decimateSurfaceAndRetriangulate(allPoints, target, function (percent, message) {
					progressFill.style.width = percent + "%";
					progressLabel.textContent = message || ("Processing... " + percent + "%");
				}).then(function (result) {
					if (result.skipped || !result.triangles) {
						// Nothing to do
						dialog.close();
						resolve(surfaceData);
						return;
					}

					// Update surface data in place
					surfaceData.triangles = result.triangles;
					surfaceData.points = result.points;
					surfaceData._decimated = true;
					surfaceData._originalTriCount = originalTriCount;

					progressFill.style.width = "100%";
					progressFill.style.background = "linear-gradient(90deg, #4CAF50, #81C784)";
					progressLabel.textContent = "Done: " +
						originalTriCount.toLocaleString() + " tri → " +
						result.triangles.length.toLocaleString() + " tri (" +
						result.decimatedPointCount.toLocaleString() + " points)";

					// Brief pause so user sees the result, then close
					setTimeout(function () {
						dialog.close();
						resolve(surfaceData);
					}, 1200);
				}).catch(function (err) {
					progressFill.style.background = "#f44336";
					progressLabel.textContent = "Error: " + (err.message || String(err));
					console.error("Decimation error:", err);

					// Re-enable buttons so user can try again or skip
					var btns2 = dialog.element ? dialog.element.querySelectorAll("button") : [];
					for (var b2 = 0; b2 < btns2.length; b2++) btns2[b2].disabled = false;
				});

				return false; // Don't auto-close
			},
			onCancel: function () {
				// Skip 3D — mark the surface so canvas3DDrawing knows to skip it
				surfaceData._skipped3DTooBig = true;
				resolve(surfaceData);
			}
		});

		dialog.show();
	});
}

/**
 * Collect unique points from a triangles array.
 */
function collectPointsFromTriangles(triangles) {
	var pointMap = new Map();
	var pts = [];
	for (var t = 0; t < triangles.length; t++) {
		var tri = triangles[t];
		if (!tri.vertices) continue;
		for (var v = 0; v < tri.vertices.length; v++) {
			var vert = tri.vertices[v];
			var key = vert.x + "_" + vert.y + "_" + vert.z;
			if (!pointMap.has(key)) {
				pointMap.set(key, vert);
				pts.push(vert);
			}
		}
	}
	return pts;
}

/**
 * Trim a surface's points array to only include vertices referenced by its triangles.
 * Useful when multiple surface groups share a single large points array.
 *
 * @param {Object} surfaceData - Surface with .triangles and .points
 * @returns {Object} Same surfaceData with .points trimmed
 */
export function trimUnreferencedPoints(surfaceData) {
	if (!surfaceData || !surfaceData.triangles || !surfaceData.points) return surfaceData;
	if (surfaceData.triangles.length === 0) return surfaceData;

	// Quick check — if points are roughly proportional to triangles, skip
	var expectedPoints = surfaceData.triangles.length * 0.6; // rough heuristic
	if (surfaceData.points.length < expectedPoints * 3) return surfaceData;

	var trimmedPoints = collectPointsFromTriangles(surfaceData.triangles);
	if (trimmedPoints.length < surfaceData.points.length) {
		console.log("Trimmed points for '" + (surfaceData.name || surfaceData.id) + "': " +
			surfaceData.points.length.toLocaleString() + " -> " + trimmedPoints.length.toLocaleString());
		surfaceData.points = trimmedPoints;
	}

	return surfaceData;
}

function escapeHtml(text) {
	var div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}
