/* prettier-ignore-file */
//=================================================
// canvas3DDrawSelection.js - 3D KAD Selection Visuals
// Mimics 2D selection highlighting for Three.js
//=================================================

import * as THREE from "three";
import { GeometryFactory } from "../three/GeometryFactory.js";

// Step 0) Restore original colors on text meshes that were highlighted
// Called before drawing new highlights or when clearing selection
export function restoreTextColorsThreeJS() {
	if (!window.threeRenderer || !window.threeRenderer.kadGroup) return;

	window.threeRenderer.kadGroup.traverse(function(obj) {
		// Step 0a) Check if this object was highlighted
		if (obj.userData && obj.userData.isHighlighted && obj.userData.originalColor !== undefined) {
			// Step 0b) Restore original color
			obj.color = obj.userData.originalColor;
			obj.userData.isHighlighted = false;

			// Step 0c) Sync to update the color
			if (obj.sync) {
				obj.sync();
			}
		}
	});
}

// Step 1) Highlight selected KAD objects in Three.js
// Mimics drawKADHighlightSelectionVisuals() for 2D canvas
export function highlightSelectedKADThreeJS() {
	// Step 1a) Check if Three.js is initialized
	if (!window.threeInitialized || !window.threeRenderer) {
		console.log("⚠️ highlightSelectedKADThreeJS - Three.js not initialized");
		return;
	}

	// Step 1a.1) Restore any previously highlighted text colors before new highlighting
	restoreTextColorsThreeJS();

	// Step 1b) Access globals from window object
	const selectedKADObject = window.selectedKADObject;
	const selectedMultipleKADObjects = window.selectedMultipleKADObjects;
	const isSelectionPointerActive = window.isSelectionPointerActive;

	const developerModeEnabled = window.developerModeEnabled;
	const getEntityFromKADObject = window.getEntityFromKADObject;
	const worldToThreeLocal = window.worldToThreeLocal;
	const dataCentroidZ = window.dataCentroidZ;

	if (developerModeEnabled) {
		console.log("=== 3D SELECTION DRAWING DEBUG ===");
		console.log("🎨 highlightSelectedKADThreeJS called:");
		console.log("  selectedKADObject:", selectedKADObject);
		console.log("  selectedMultipleKADObjects.length:", selectedMultipleKADObjects ? selectedMultipleKADObjects.length : 0);

		// Step 1c) Early exit if no selection
		if (!selectedKADObject && (!selectedMultipleKADObjects || selectedMultipleKADObjects.length === 0)) {
			console.log("  → Early exit: No KAD selection");
			return;
		}
	}

	// Step 1d) Define colors (match 2D)
	const selectedSegmentColor = "rgba(255, 68, 255, 0.8)";
	const selectedVertexColor = "rgba(255, 68, 255, 0.8)";
	const nonSelectedSegmentColor = "#00FF00"; // Green for non-selected segments
	const nonSelectedPointColor = "rgba(0, 255, 0, 0.5)"; // Green for non-selected points
	const verticesColor = "rgba(255,0,0,0.5)";

	// Step 2) Handle single selection
	// Ignore normal KAD/hole selection when pattern tools are active
	const isPatternInPolygonActive = window.isPatternInPolygonActive;
	const isHolesAlongPolyLineActive = window.isHolesAlongPolyLineActive;

	// Only highlight if:
	// 1. Selection pointer is active (normal selection mode), OR
	// 2. PatternInPolygon tool is active AND selected entity is a poly, OR
	// 3. HolesAlongPolyLine tool is active AND selected entity is a line OR a poly, OR
	// 4. SplitKAD or JoinKAD interactive tool is active (always highlight picked vertex)
	const isSplitKADActive = window.isSplitKADActive;
	const isJoinKADActive = window.isJoinKADActive;
	const shouldHighlight = selectedKADObject && ((isSelectionPointerActive && !isPatternInPolygonActive && !isHolesAlongPolyLineActive) || (isPatternInPolygonActive && selectedKADObject.entityType === "poly") || (isHolesAlongPolyLineActive && (selectedKADObject.entityType === "line" || selectedKADObject.entityType === "poly")) || isSplitKADActive || isJoinKADActive);

	if (shouldHighlight) {
		// if (developerModeEnabled) {
		console.log("🎨 [HIGHLIGHT DEBUG] shouldHighlight=true, selectedKADObject:", selectedKADObject);
		console.log("🎨 [HIGHLIGHT DEBUG] entityName:", selectedKADObject.entityName, "entityType:", selectedKADObject.entityType);
		//}
		const entity = getEntityFromKADObject(selectedKADObject);

		if (!entity) return;
		//if (developerModeEnabled) {
		console.log("🎨 [HIGHLIGHT DEBUG] getEntityFromKADObject returned:", entity);
		//}
		if (!entity) {
			//if (developerModeEnabled) {
			console.log("🎨 [HIGHLIGHT DEBUG] entity is null, returning early");
			//}
			return;
		}
		drawKADEntityHighlight(selectedKADObject, entity, selectedSegmentColor, nonSelectedSegmentColor, verticesColor, worldToThreeLocal, dataCentroidZ, developerModeEnabled);
	}

	// Step 3) Handle multiple selections
	// PERFORMANCE FIX 2025-12-28: Use BATCHED fat lines (LineSegments2) instead of individual MeshLine objects
	if (selectedMultipleKADObjects && selectedMultipleKADObjects.length > 0) {
		// Step 3.0) Count selected entities by type (same pattern as HUD stats)
		var kadPointCount = 0,
			kadLineCount = 0,
			kadPolyCount = 0,
			kadCircleCount = 0,
			kadTextCount = 0;
		for (var i = 0; i < selectedMultipleKADObjects.length; i++) {
			var type = selectedMultipleKADObjects[i].entityType;
			if (type === "point") kadPointCount++;
			else if (type === "line") kadLineCount++;
			else if (type === "poly") kadPolyCount++;
			else if (type === "circle") kadCircleCount++;
			else if (type === "text") kadTextCount++;
		}

		// Step 3.0a) Only draw vertices if NO type has more than 1 entity
		var maxTypeCount = Math.max(kadPointCount, kadLineCount, kadPolyCount, kadCircleCount, kadTextCount);
		var skipVertices3D = maxTypeCount > 1;

		// Step 3.0b) No render cap needed with batched approach - collect ALL segments
		var selectionCount = selectedMultipleKADObjects.length;

		console.log("🎨 Drawing 3D multiple KAD selections (BATCHED):", selectionCount, "objects");
		console.log("Type counts - Point:" + kadPointCount + " Line:" + kadLineCount + " Poly:" + kadPolyCount + " Circle:" + kadCircleCount + " Text:" + kadTextCount);
		console.log("Performance mode: skipVertices3D=" + skipVertices3D + " (maxTypeCount=" + maxTypeCount + ")");

		// Step 3.1) Collect ALL segments for batched rendering
		var greenSegments = []; // Non-selected segments (green)
		var greenCircles = []; // Non-selected circles

		selectedMultipleKADObjects.forEach(function(kadObj) {
			var entity = getEntityFromKADObject(kadObj);
			if (!entity || !entity.data) return;

			var entityType = kadObj.entityType || entity.entityType;

			if (entityType === "line" || entityType === "poly") {
				// Step 3.1a) Collect line/poly segments
				console.log("🎨 Drawing 3D multiple KAD selections (BATCHED):", selectionCount, "objects");
				var points = entity.data;
				var isClosedShape = entityType === "poly";
				var numSegments = isClosedShape ? points.length : points.length - 1;

				for (var i = 0; i < numSegments; i++) {
					var point1 = points[i];
					var point2 = isClosedShape ? points[(i + 1) % points.length] : points[i + 1];

					var local1 = worldToThreeLocal(point1.pointXLocation, point1.pointYLocation);
					var local2 = worldToThreeLocal(point2.pointXLocation, point2.pointYLocation);

					var z1 = point1.pointZLocation || dataCentroidZ || 0;
					var z2 = point2.pointZLocation || dataCentroidZ || 0;

					greenSegments.push({
						x1: local1.x,
						y1: local1.y,
						z1: z1,
						x2: local2.x,
						y2: local2.y,
						z2: z2
					});
				}
			} else if (entityType === "circle") {
				// Step 3.1b) Collect circles
				entity.data.forEach(function(circle) {
					var centerX = circle.centerX || circle.pointXLocation;
					var centerY = circle.centerY || circle.pointYLocation;
					var centerZ = circle.centerZ || circle.pointZLocation || dataCentroidZ || 0;
					var radius = circle.radius * 1.1 || 1;
					var local = worldToThreeLocal(centerX, centerY);

					greenCircles.push({
						cx: local.x,
						cy: local.y,
						cz: centerZ,
						radius: radius
					});
				});
			} else if (entityType === "text") {
				// Step 3.1c) Color-based highlight for text (more efficient than boxes)
				entity.data.forEach(function(textData, index) {
					var kadId = kadObj.entityName + ":::" + index;

					// Find the existing text mesh in kadGroup by kadId
					var textMesh = null;
					window.threeRenderer.kadGroup.traverse(function(obj) {
						if (obj.userData && obj.userData.kadId === kadId && obj.userData.type === "kadText") {
							textMesh = obj;
						}
					});

					if (textMesh) {
						// Store original color if not already stored
						if (textMesh.userData.originalColor === undefined) {
							textMesh.userData.originalColor = textMesh.color;
						}

						// All selected text gets green highlight
						textMesh.color = 0x00ff00;

						// Sync to update the color
						if (textMesh.sync) {
							textMesh.sync();
						}

						// Mark for color restoration later
						textMesh.userData.isHighlighted = true;
					}
				});
			}
			// Note: Points are handled individually (they're already efficient)
		});

		// Step 3.2) Create batched highlight geometry (ONE object for all segments)
		var resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
		var greenLineWidth = 3; // Pixel width for highlights

		if (greenSegments.length > 0) {
			var batchedLines = GeometryFactory.createBatchedHighlightLines(greenSegments, null, greenLineWidth, 0, resolution);
			if (batchedLines.greenLines) {
				batchedLines.greenLines.userData.type = "kadSelectionHighlight";
				window.threeRenderer.kadGroup.add(batchedLines.greenLines);
			}
		}

		if (greenCircles.length > 0) {
			var batchedCircles = GeometryFactory.createBatchedHighlightCircles(greenCircles, null, greenLineWidth, 0, resolution);
			if (batchedCircles.greenCircles) {
				batchedCircles.greenCircles.userData.type = "kadSelectionHighlight";
				window.threeRenderer.kadGroup.add(batchedCircles.greenCircles);
			}
		}

		console.log("✅ Batched highlights created - Segments:" + greenSegments.length + " Circles:" + greenCircles.length);
	}

	// Step 4) Draw individual vertex highlight if selectedPoint is set
	const selectedPoint = window.selectedPoint;

	if (developerModeEnabled) {
		// DEBUG: Log what we're checking
		console.log("🔍 [3D Draw] Checking for pink vertex highlight:");
		console.log("  selectedPoint:", selectedPoint ? selectedPoint.pointID : "null");
		console.log("  selectedKADObject:", selectedKADObject ? selectedKADObject.entityName : "null");
	}

	if (selectedPoint && selectedKADObject) {
		if (developerModeEnabled) {
			console.log("✅ [3D Draw] BOTH conditions met - drawing pink sphere");
		}
		const entity = getEntityFromKADObject(selectedKADObject);
		const allKADDrawingsMap = window.allKADDrawingsMap;
		let entityToUse = entity;
		if (!entityToUse && allKADDrawingsMap) {
			entityToUse = allKADDrawingsMap.get(selectedKADObject.entityName);
		}

		if (entityToUse && entityToUse.data) {
			// Find the selected point
			const point = entityToUse.data.find(function(p) {
				return p.pointID === selectedPoint.pointID;
			});
			if (point) {
				const localPos = worldToThreeLocal(point.pointXLocation, point.pointYLocation);
				// Step #) Use Z directly WITHOUT subtracting dataCentroidZ - must match entity vertex Z
				const worldZ = point.pointZLocation || dataCentroidZ || 0;

				// Use factory method for consistency (matches line 260 - selected segment vertex)
				const sphere = GeometryFactory.createKADPointHighlight(
					localPos.x,
					localPos.y,
					worldZ,
					1.0, // radius - matches selected segment vertex
					selectedVertexColor // Pink
				);
				sphere.userData.type = "vertexSelectionHighlight";
				window.threeRenderer.kadGroup.add(sphere);
			}
		}
	}

	// Step 5) Draw multiple selected vertices (from TreeView multi-select or polygon/shift-click selection)
	// PERFORMANCE: Super-batch all selected vertices into ONE THREE.Points draw call
	const selectedMultiplePoints = window.selectedMultiplePoints;
	if (selectedMultiplePoints && selectedMultiplePoints.length > 0) {
		var positions = new Float32Array(selectedMultiplePoints.length * 3);
		var writeIdx = 0;

		for (var vi = 0; vi < selectedMultiplePoints.length; vi++) {
			var point = selectedMultiplePoints[vi];
			if (point && point.pointXLocation !== undefined && point.pointYLocation !== undefined) {
				var localPos = worldToThreeLocal(point.pointXLocation, point.pointYLocation);
				positions[writeIdx]     = localPos.x;
				positions[writeIdx + 1] = localPos.y;
				positions[writeIdx + 2] = point.pointZLocation || dataCentroidZ || 0;
				writeIdx += 3;
			}
		}

		if (writeIdx > 0) {
			// Trim if some points were skipped
			var finalPositions = writeIdx < positions.length ? positions.subarray(0, writeIdx) : positions;

			var batchGeometry = new THREE.BufferGeometry();
			batchGeometry.setAttribute("position", new THREE.BufferAttribute(finalPositions, 3));

			// Parse the selectedVertexColor for material
			var colorObj = GeometryFactory.parseRGBA(selectedVertexColor);
			var batchMaterial = new THREE.PointsMaterial({
				color: new THREE.Color(colorObj.r, colorObj.g, colorObj.b),
				size: 10, // 0.5 baseRadius * 20 = 10 pixels
				sizeAttenuation: false,
				transparent: colorObj.a < 1,
				opacity: colorObj.a,
				depthTest: true,
				depthWrite: false
			});

			var batchPoints = new THREE.Points(batchGeometry, batchMaterial);
			batchPoints.userData.type = "vertexSelectionHighlight";
			batchPoints.renderOrder = 9999;
			window.threeRenderer.kadGroup.add(batchPoints);

			if (developerModeEnabled) {
				console.log("Batched " + (writeIdx / 3) + " selected vertex highlights into 1 draw call");
			}
		}
	}
}

// Step 4) Draw highlight for a single KAD entity
// skipVertices parameter controls whether to skip vertex geometry for performance
function drawKADEntityHighlight(kadObject, entity, selectedSegmentColor, nonSelectedSegmentColor, verticesColor, worldToThreeLocal, dataCentroidZ, developerModeEnabled, skipVertices) {
	// Step 4a) Create group for highlights
	const highlightGroup = new THREE.Group();
	highlightGroup.userData = {
		type: "kadSelectionHighlight",
		kadId: kadObject.entityName
	};

	// Step 4a.1) Convert snap tolerance from pixels to world units to match selection tolerance
	const snapRadiusPixels = window.snapRadiusPixels || 20;
	const currentScale = window.currentScale || 5;
	const tolerance = snapRadiusPixels / currentScale; // 3D tolerance in world units

	// Debug: Check entityType
	const entityType = kadObject.entityType || entity.entityType;
	if (developerModeEnabled) {
		console.log("🔍 drawKADEntityHighlight - entityName:", kadObject.entityName, "entityType:", entityType);
	}

	switch (entityType) {
		case "point":
			// Step 4b) Highlight points
			entity.data.forEach((point, index) => {
				const local = worldToThreeLocal(point.pointXLocation, point.pointYLocation);
				const z = point.pointZLocation || dataCentroidZ || 0;

				// Step 4b.1) Selected point gets magenta highlight
				if (index === kadObject.elementIndex) {
					const sphere = GeometryFactory.createKADPointHighlight(local.x, local.y, z, 1, selectedSegmentColor);
					highlightGroup.add(sphere);
				} else {
					// Step 4b.2) Other points get green highlight
					const sphere = GeometryFactory.createKADPointHighlight(local.x, local.y, z, 1, nonSelectedSegmentColor);
					highlightGroup.add(sphere);
				}

				// Step 4b.3) Add red vertex markers for all points - SKIP if large selection
				if (!skipVertices) {
					const vertex = GeometryFactory.createKADPointHighlight(local.x, local.y, z, 0.5, verticesColor);
					highlightGroup.add(vertex);
				}
			});
			break;

		case "line":
		case "poly":
			// Step 4c) Highlight line/poly segments using batched fat lines (matches multiple selection aesthetic)
			const points = entity.data;
			const isClosedShape = entityType === "poly";
			const numSegments = isClosedShape ? points.length : points.length - 1;

			if (developerModeEnabled) {
				console.log("🎨 [3D HIGHLIGHT] Drawing " + entityType + " with " + numSegments + " segments, isClosedShape:", isClosedShape);
				console.log("🎨 [3D HIGHLIGHT] First point:", points[0]);
			}

			// Step 4c.1) Collect all segments into arrays for batched rendering
			var greenSegments = [];
			var magentaSegments = [];

			// Step 4c.2) Collect ALL segments for green highlighting
			for (let i = 0; i < numSegments; i++) {
				const point1 = points[i];
				const point2 = isClosedShape ? points[(i + 1) % points.length] : points[i + 1];

				// Step 4c.2a) Validate points have coordinates
				if (!point1 || point1.pointXLocation === undefined || point1.pointYLocation === undefined) continue;
				if (!point2 || point2.pointXLocation === undefined || point2.pointYLocation === undefined) continue;

				const local1 = worldToThreeLocal(point1.pointXLocation, point1.pointYLocation);
				const local2 = worldToThreeLocal(point2.pointXLocation, point2.pointYLocation);

				// Step 4c.2b) Validate conversion results
				if (!local1 || local1.x === undefined || local1.y === undefined) continue;
				if (!local2 || local2.x === undefined || local2.y === undefined) continue;

				const z1 = point1.pointZLocation || dataCentroidZ || 0;
				const z2 = point2.pointZLocation || dataCentroidZ || 0;

				// Step 4c.2c) Final NaN check before adding to array
				if (!isNaN(local1.x) && !isNaN(local1.y) && !isNaN(z1) && !isNaN(local2.x) && !isNaN(local2.y) && !isNaN(z2)) {
					greenSegments.push({
						x1: local1.x,
						y1: local1.y,
						z1: z1,
						x2: local2.x,
						y2: local2.y,
						z2: z2
					});
				} else {
					console.warn("🎨 [3D HIGHLIGHT] Skipping segment with NaN values:", {
						point1Index: i,
						point1: point1,
						point2Index: isClosedShape ? (i + 1) % points.length : i + 1,
						point2: point2,
						local1: local1,
						local2: local2,
						z1: z1,
						z2: z2
					});
				}
			}

			// Step 4c.3) Collect selected segment for magenta highlighting
			if (kadObject.selectionType === "segment" && kadObject.segmentIndex !== undefined) {
				const segmentIndex = kadObject.segmentIndex;
				if (segmentIndex >= 0 && segmentIndex < numSegments) {
					const point1 = points[segmentIndex];
					const point2 = isClosedShape ? points[(segmentIndex + 1) % points.length] : points[segmentIndex + 1];

					// Step 4c.3a) Validate points have coordinates
					if (point1 && point1.pointXLocation !== undefined && point1.pointYLocation !== undefined && point2 && point2.pointXLocation !== undefined && point2.pointYLocation !== undefined) {
						const local1 = worldToThreeLocal(point1.pointXLocation, point1.pointYLocation);
						const local2 = worldToThreeLocal(point2.pointXLocation, point2.pointYLocation);

						// Step 4c.3b) Validate conversion results
						if (local1 && local1.x !== undefined && local1.y !== undefined && local2 && local2.x !== undefined && local2.y !== undefined) {
							const z1 = point1.pointZLocation || dataCentroidZ || 0;
							const z2 = point2.pointZLocation || dataCentroidZ || 0;

							// Step 4c.3c) Final NaN check before adding to array
							if (!isNaN(local1.x) && !isNaN(local1.y) && !isNaN(z1) && !isNaN(local2.x) && !isNaN(local2.y) && !isNaN(z2)) {
								magentaSegments.push({
									x1: local1.x,
									y1: local1.y,
									z1: z1,
									x2: local2.x,
									y2: local2.y,
									z2: z2
								});

								if (developerModeEnabled) {
									console.log("🎨 [3D HIGHLIGHT] Drawing selected segment " + segmentIndex + " in magenta for " + kadObject.entityType);
								}
							} else {
								console.warn("🎨 [3D HIGHLIGHT] Skipping selected segment with NaN values:", {
									segmentIndex: segmentIndex,
									point1: point1,
									point2: point2,
									local1: local1,
									local2: local2,
									z1: z1,
									z2: z2
								});
							}
						}
					}
				}
			}

			// Step 4c.4) Create batched fat lines (ONE draw call, matches multiple selection aesthetic)
			var resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
			var greenLineWidth = 3; // Match multiple selection line width
			var magentaLineWidth = 5; // Slightly thicker for selected segment
			var batchedLines = GeometryFactory.createBatchedHighlightLines(greenSegments, magentaSegments, greenLineWidth, magentaLineWidth, resolution);

			if (batchedLines.greenLines) {
				highlightGroup.add(batchedLines.greenLines);
			}
			if (batchedLines.magentaLines) {
				highlightGroup.add(batchedLines.magentaLines);
			}

			// Step 4c.5) Draw vertices for all points using billboard points - SKIP if large selection
			if (!skipVertices) {
				points.forEach((point, index) => {
					// Step 4c.5.0) Validate point has coordinates
					if (!point || point.pointXLocation === undefined || point.pointYLocation === undefined) {
						console.warn("🎨 [3D HIGHLIGHT] Skipping vertex " + index + " - invalid coordinates");
						return;
					}

					const local = worldToThreeLocal(point.pointXLocation, point.pointYLocation);
					const z = point.pointZLocation || dataCentroidZ || 0;

					// Step 4c.5.1) Validate conversion result and check for NaN
					if (!local || local.x === undefined || local.y === undefined || isNaN(local.x) || isNaN(local.y) || isNaN(z)) {
						console.warn("🎨 [3D HIGHLIGHT] Skipping vertex " + index + " - NaN in converted coordinates:", {
							point: point,
							local: local,
							z: z
						});
						return;
					}

					// Step 4c.5a) If this is the start vertex of the selected segment, draw it in magenta
					const isSelectedSegmentVertex = kadObject.selectionType === "segment" && kadObject.segmentIndex === index;

					if (isSelectedSegmentVertex) {
						// Larger magenta billboard point for selected segment's start vertex
						const selectedVertex = GeometryFactory.createKADPointHighlight(local.x, local.y, z, 1.0, selectedSegmentColor);
						highlightGroup.add(selectedVertex);
					} else {
						// Standard red billboard point for vertex marker
						const vertex = GeometryFactory.createKADPointHighlight(local.x, local.y, z, 0.5, verticesColor);
						highlightGroup.add(vertex);
					}
				});
			}
			break;

	case "circle":
		// Step 4e) Highlight circles
		entity.data.forEach((circle, index) => {
			const centerX = circle.centerX || circle.pointXLocation;
			const centerY = circle.centerY || circle.pointYLocation;
			// FIX: Z=0 is valid elevation (-27000m to +16000m range). Use explicit null/undefined check.
			const centerZ = (circle.centerZ !== undefined && circle.centerZ !== null) ? circle.centerZ :
			                ((circle.pointZLocation !== undefined && circle.pointZLocation !== null) ? circle.pointZLocation : (dataCentroidZ || 0));
			const radius = circle.radius * 1.1 || 1;

				const local = worldToThreeLocal(centerX, centerY);

				// Step 4e.1) Selected circle gets magenta highlight
				if (index === kadObject.elementIndex) {
					const circleMesh = GeometryFactory.createKADCircleHighlight(local.x, local.y, centerZ, radius, 30, selectedSegmentColor);
					highlightGroup.add(circleMesh);

					// Step 4e.2) Add center point - SKIP if large selection
					if (!skipVertices) {
						const centerPoint = GeometryFactory.createKADPointHighlight(local.x, local.y, centerZ, 0.5, verticesColor);
						highlightGroup.add(centerPoint);
					}
				} else {
					// Step 4e.3) Other circles get green highlight
					const circleMesh = GeometryFactory.createKADCircleHighlight(local.x, local.y, centerZ, radius, 30, nonSelectedSegmentColor);
					highlightGroup.add(circleMesh);
				}
			});
			break;

		case "text":
			// Step 4f) Highlight text by changing text color (no boxes/verts for better performance)
			// Find and colorize the existing troika text meshes in kadGroup
			entity.data.forEach((textData, index) => {
				const kadId = kadObject.entityName + ":::" + index;

				// Step 4f.1) Find the existing text mesh in kadGroup by kadId
				var textMesh = null;
				window.threeRenderer.kadGroup.traverse(function(obj) {
					if (obj.userData && obj.userData.kadId === kadId && obj.userData.type === "kadText") {
						textMesh = obj;
					}
				});

				if (textMesh) {
					// Step 4f.2) Store original color if not already stored
					if (textMesh.userData.originalColor === undefined) {
						textMesh.userData.originalColor = textMesh.color;
					}

					// Step 4f.3) Selected text gets magenta color, others get green
					if (index === kadObject.elementIndex) {
						// Selected text: bright magenta/pink
						textMesh.color = 0xff44ff;
					} else {
						// Non-selected text in same entity: bright green
						textMesh.color = 0x00ff00;
					}

					// Step 4f.4) Sync to update the color
					if (textMesh.sync) {
						textMesh.sync();
					}

					// Step 4f.5) Mark for color restoration later
					textMesh.userData.isHighlighted = true;
				}
			});
			break;
	}

	// Step 5) Add highlight group to scene
	const childCount = highlightGroup.children.length;
	if (developerModeEnabled) {
		console.log("✅ Adding highlight group to scene - Children count:", childCount, "for entity:", kadObject.entityName);
	}
	window.threeRenderer.kadGroup.add(highlightGroup);
	if (developerModeEnabled) {
		console.log("✓ Highlight group added to kadGroup");
	}
}
