// src/dialog/contextMenu/ContextMenuManager.js
//=============================================================
// CONTEXT MENU MANAGER
//=============================================================
// Step 0) Converted to ES Module for Vite bundling - 2025-12-26

// Step 1) Central dispatcher that handles all context menu routing
// Detects 2D vs 3D environment and routes right-clicks to appropriate context menu

// Step 2) Handle 2D context menu
export function handle2DContextMenu(event) {
	event.preventDefault();
	closeAllContextMenus();

	// Step 2a) Prevent right-click from triggering drag behavior
	if (typeof window.isDragging !== "undefined") {
		window.isDragging = false;
	}
	if (typeof window.longPressTimeout !== "undefined") {
		clearTimeout(window.longPressTimeout);
	}

	const anyKADToolActive = window.addPointDraw.checked || window.addLineDraw.checked || window.addCircleDraw.checked || window.addPolyDraw.checked || window.addTextDraw.checked;

	const rect = window.canvas.getBoundingClientRect();
	const clickX = event.clientX - rect.left;
	const clickY = event.clientY - rect.top;

	// Step 2b) If a KAD tool is active, right-click ends the current entity
	if (anyKADToolActive) {
		kadContextMenu(event);
		return;
	}

	// Step 2c) Get the clicked object to check if it's within snap radius
	const clickedHole = window.getClickedHole(clickX, clickY);
	const clickedKADObject = window.getClickedKADObject(clickX, clickY);

	console.log("🖱️  [2D Context Menu] Clicked objects - Hole:", clickedHole ? clickedHole.holeID : "null", "| KAD:", clickedKADObject ? clickedKADObject.entityType + " - " + clickedKADObject.entityName : "null");

	// Step 2d) Check if we clicked within snap radius of a selected object
	const snapRadius = window.getSnapToleranceInWorldUnits();
	const worldCoords = window.canvasToWorld(clickX, clickY);

	// Step 2e) PRIORITY: For multiple KAD objects selected (match 3D behavior)
	// Show multi-edit panel regardless of where you right-click
	if (window.selectedMultipleKADObjects && window.selectedMultipleKADObjects.length > 1) {
		console.log("📋 [2D CONTEXT] Multiple KAD objects selected (" + window.selectedMultipleKADObjects.length + "), showing multi-editor");
		if (typeof window.showMultipleKADPropertyEditor === "function") {
			window.showMultipleKADPropertyEditor(window.selectedMultipleKADObjects);
		}
		if (typeof window.debouncedUpdateTreeView === "function") {
			window.debouncedUpdateTreeView();
		}
		return;
	}

	// Step 2f) For holes: Check multiple selection first, then single hole
	if (window.selectedMultipleHoles && window.selectedMultipleHoles.length > 1) {
		// Check if we clicked on one of the selected holes
		let clickedOnSelected = false;
		for (const hole of window.selectedMultipleHoles) {
			const distance = Math.sqrt(Math.pow(hole.startXLocation - worldCoords[0], 2) + Math.pow(hole.startYLocation - worldCoords[1], 2));
			if (distance <= snapRadius) {
				clickedOnSelected = true;
				break;
			}
		}

		if (clickedOnSelected) {
			window.showHolePropertyEditor(window.selectedMultipleHoles);
			window.debouncedUpdateTreeView();
			return;
		}
	}

	if (clickedHole) {
		const holeDistance = Math.sqrt(Math.pow(clickedHole.startXLocation - worldCoords[0], 2) + Math.pow(clickedHole.startYLocation - worldCoords[1], 2));
		if (holeDistance <= snapRadius) {
			window.showHolePropertyEditor(clickedHole);
			window.debouncedUpdateTreeView();
			return;
		}
	}

	// Step 2g) For KAD objects (Points, Lines, Polys, Circles, Text)
	// IMPORTANT: Show context menu for ANY clicked KAD object, not just when selection tools are active
	if (clickedKADObject) {
		console.log("📋 [2D Context Menu] KAD object detected:", clickedKADObject.entityType, clickedKADObject.entityName);
		// Check if within snap radius
		let withinSnapRadius = false;
		const entity = window.allKADDrawingsMap.get(clickedKADObject.entityName);

		if (entity) {
			if (clickedKADObject.selectionType === "vertex") {
				// For vertex selection, check distance to the specific vertex
				const point = entity.data[clickedKADObject.elementIndex];
				const distance = Math.sqrt(Math.pow(point.pointXLocation - worldCoords[0], 2) + Math.pow(point.pointYLocation - worldCoords[1], 2));
				withinSnapRadius = distance <= snapRadius;
				console.log("  📏 Vertex distance:", distance.toFixed(2), "| Snap radius:", snapRadius.toFixed(2), "| Within:", withinSnapRadius);
			} else if (clickedKADObject.selectionType === "segment") {
				// For segment selection, use the clicked position
				withinSnapRadius = true; // Already validated by getClickedKADObject
				console.log("  📏 Segment - auto within snap radius");
			}
		} else {
			console.log("  ❌ Entity not found in allKADDrawingsMap:", clickedKADObject.entityName);
		}

		if (withinSnapRadius) {
			console.log("  ✅ Showing KAD property editor");
			window.showKADPropertyEditorPopup(clickedKADObject);
			window.debouncedUpdateTreeView();
			return;
		} else {
			console.log("  ❌ Outside snap radius - not showing context menu");
		}
	} else {
		console.log("📋 [2D Context Menu] No KAD object detected");
	}

	// Step 2h) Check for surfaces and other context menus...
	const clickedSurfaceId = window.isPointInSurface(clickX, clickY);
	if (clickedSurfaceId) {
		window.showSurfaceContextMenu(clickX, clickY, clickedSurfaceId);
		return;
	}

	// Step 2i) Check for background images...
	let clickedImageId = null;
	for (const [imageId, image] of window.loadedImages.entries()) {
		if (image.visible && window.isPointInBackgroundImage(clickX, clickY, image)) {
			clickedImageId = imageId;
			break;
		}
	}

	if (clickedImageId) {
		window.showImageContextMenu(clickX, clickY, clickedImageId);
		return;
	}

	// Step 2j) Default canvas context menu...
	try {
		window.showContextMenu(event);
	} catch (err) {
		// Show status message for right clicks without objects
		window.updateStatusMessage("Right clicks need to be performed on an Object.");
		setTimeout(() => {
			window.updateStatusMessage("");
		}, 2000);
		console.log(err);
	}
}

// Step 3) Handle 3D context menu
export function handle3DContextMenu(event) {
	// Step 3a) Only handle if in 3D mode
	if (!window.onlyShowThreeJS) {
		return;
	}

	// Step 3a1) Cancel right-click drag delay if context menu is shown
	if (window.cameraControls && typeof window.cameraControls.cancelRightClickDrag === "function") {
		window.cameraControls.cancelRightClickDrag();
	}

	// Step 3b) Prevent default context menu
	event.preventDefault();
	closeAllContextMenus();

	// Step 3b.1) If a KAD tool is active, right-click ends the current entity (same as 2D)
	const anyKADToolActive = window.addPointDraw.checked || window.addLineDraw.checked || window.addCircleDraw.checked || window.addPolyDraw.checked || window.addTextDraw.checked;
	if (anyKADToolActive) {
		kadContextMenu(event);
		return;
	}

	// Step 3c) Early return if dependencies not ready
	if (!window.threeInitialized || !window.threeRenderer || !window.interactionManager) {
		if (typeof window.updateStatusMessage === "function") {
			window.updateStatusMessage("Right clicks need to be performed on an Object.");
			setTimeout(() => {
				window.updateStatusMessage("");
			}, 2000);
		}
		return;
	}

	// Step 3d) Get 3D canvas and update mouse position
	const threeCanvas = window.threeRenderer.getCanvas();
	if (!threeCanvas) {
		return;
	}

	window.interactionManager.updateMousePosition(event, threeCanvas);

	// Step 3e) Perform raycast to find clicked objects
	console.log("🔍 [3D] Performing raycast...");
	const intersects = window.interactionManager.raycast();
	console.log("🔍 [3D] Raycast result: " + (intersects ? intersects.length : 0) + " intersects");

	if (intersects && intersects.length > 0) {
		for (let i = 0; i < Math.min(3, intersects.length); i++) {
			const obj = intersects[i].object;
			console.log("  [" + i + "] distance:", intersects[i].distance.toFixed(2), "| type:", obj.type, "| userData:", obj.userData);
		}
	}

	// Step 3f) Get click position for context menu placement
	const rect = threeCanvas.getBoundingClientRect();
	const clickX = event.clientX - rect.left;
	const clickY = event.clientY - rect.top;

	// Step 3g) Find clicked hole
	const clickedHole = window.interactionManager.findClickedHole(intersects, window.allBlastHoles);

	// Step 3h) Check for multiple hole selection
	if (window.selectedMultipleHoles && window.selectedMultipleHoles.length > 1) {
		// Check if we clicked on one of the selected holes
		let clickedOnSelected = false;
		if (clickedHole) {
			for (const hole of window.selectedMultipleHoles) {
				if (hole.entityName === clickedHole.entityName && hole.holeID === clickedHole.holeID) {
					clickedOnSelected = true;
					break;
				}
			}
		}

		if (clickedOnSelected) {
			window.showHolePropertyEditor(window.selectedMultipleHoles);
			window.debouncedUpdateTreeView();
			return;
		}
	}

	// Step 3i) Handle single hole click
	if (clickedHole) {
		window.showHolePropertyEditor(clickedHole);
		window.debouncedUpdateTreeView();
		return;
	}

	// Step 3j) Get clicked KAD object using 3D raycast (mimics LEFT-CLICK logic)
	// IMPORTANT: Iterate through ALL intersects like left-click does!
	let clickedKADObject = null;

	// Search intersects for KAD objects (they have userData.kadId)
	for (const intersect of intersects) {
		let object = intersect.object;

		// Skip if this intersect is a selection highlight
		let isHighlight = false;
		let checkObj = object;
		let depth = 0;
		while (checkObj && depth < 10) {
			if (checkObj.userData && checkObj.userData.type === "kadSelectionHighlight") {
				isHighlight = true;
				break;
			}
			checkObj = checkObj.parent;
			depth++;
		}

		if (isHighlight) {
			continue;
		}

		// Traverse up to find actual KAD object
		depth = 0;
		while (object && depth < 10) {
			// Check for actual KAD objects (kadPoint, kadLine, kadPolygon, kadCircle, kadText)
			if (object.userData && object.userData.kadId && object.userData.type && (object.userData.type === "kadPoint" || object.userData.type === "kadLine" || object.userData.type === "kadPolygon" || object.userData.type === "kadCircle" || object.userData.type === "kadText")) {
				console.log("✅ [3D CONTEXT] Found KAD object:", object.userData.kadId, "type:", object.userData.type);

				// Get the KAD entity from the map
				const entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(object.userData.kadId) : null;
				if (entity) {
					// Find which specific element was clicked
					let closestElementIndex = 0;
					let minDistance = Infinity;

					if (entity.data && entity.data.length > 1 && intersect.point) {
						// Convert intersection point from local to world coordinates
						const intersectWorldX = intersect.point.x + (window.threeLocalOriginX || 0);
						const intersectWorldY = intersect.point.y + (window.threeLocalOriginY || 0);

						// Find closest element by distance
						entity.data.forEach((element, index) => {
							const elemX = element.pointXLocation || element.centerX;
							const elemY = element.pointYLocation || element.centerY;
							const dx = elemX - intersectWorldX;
							const dy = elemY - intersectWorldY;
							const distance = Math.sqrt(dx * dx + dy * dy);

							if (distance < minDistance) {
								minDistance = distance;
								closestElementIndex = index;
							}
						});
					}

					// Create KAD object descriptor (matching left-click format)
					clickedKADObject = {
						entityName: object.userData.kadId,
						entityType: entity.entityType,
						elementIndex: closestElementIndex,
						selectionType: "vertex" // Use "vertex" to match 2D
					};

					break; // Found it, stop searching
				}
			}
			object = object.parent;
			depth++;
		}

		if (clickedKADObject) {
			break; // Found a KAD object, stop searching intersects
		}
	}

	// FALLBACK: If no KAD object found via raycast, try screen-space distance selection (like left-click)
	// CRITICAL: Run this even if intersects.length > 0, because intersects might only be surface meshes!
	if (!clickedKADObject && window.allKADDrawingsMap) {
		console.log("🔍 [3D CONTEXT] No KAD found in raycast, trying screen-space distance selection...");

		// Get snap tolerance from global or default to 13px
		const tolerancePx = window.snapRadiusPixels || 13;

		console.log("📏 [3D CONTEXT] Mouse at (" + clickX + "px, " + clickY + "px), tolerance: " + tolerancePx + "px");

		let closestEntity = null;
		let closestDistance = tolerancePx;

		// Check all KAD entities - LINES AND POLYGONS (segment-by-segment like left-click)
		for (const [name, entity] of window.allKADDrawingsMap.entries()) {
			if (entity.visible === false) continue;

			if (entity.entityType === "line" || entity.entityType === "poly") {
				// Check segments (same logic as left-click lines 1392-1470)
				const points = entity.data.filter(p => p.visible !== false);
				if (points.length < 2) continue;

				const isClosedShape = entity.entityType === "poly";
				const numSegments = isClosedShape ? points.length : points.length - 1;

				for (let i = 0; i < numSegments; i++) {
					const p1 = points[i];
					const p2 = isClosedShape ? points[(i + 1) % points.length] : points[i + 1];

					// Project to screen
					const screen1 = window.worldToScreen ? window.worldToScreen(p1.pointXLocation, p1.pointYLocation, p1.pointZLocation || 0) : null;
					const screen2 = window.worldToScreen ? window.worldToScreen(p2.pointXLocation, p2.pointYLocation, p2.pointZLocation || 0) : null;

					if (screen1 && screen2) {
						// Calculate distance from mouse to line segment
						const dx = screen2.x - screen1.x;
						const dy = screen2.y - screen1.y;
						const lengthSq = dx * dx + dy * dy;

						let t = 0;
						if (lengthSq > 0) {
							t = ((clickX - screen1.x) * dx + (clickY - screen1.y) * dy) / lengthSq;
							t = Math.max(0, Math.min(1, t));
						}

						const projX = screen1.x + t * dx;
						const projY = screen1.y + t * dy;
						const distX = clickX - projX;
						const distY = clickY - projY;
						const distance = Math.sqrt(distX * distX + distY * distY);

						if (distance < closestDistance) {
							closestDistance = distance;
							// For lines/polys, clicking on a segment means selectionType should be "segment"
							closestEntity = {
								entityName: name,
								entityType: entity.entityType,
								elementIndex: i,
								selectionType: "segment", // Changed from "vertex" - this is a segment click
								distance: distance
							};
						}
					}
				}
			} else {
				// Points, circles, text - check each data point
				for (let i = 0; i < entity.data.length; i++) {
					const point = entity.data[i];
					if (point.visible === false) continue;

					// Project world position to screen position
					const screenPos = window.worldToScreen ? window.worldToScreen(point.pointXLocation, point.pointYLocation, point.pointZLocation || 0) : null;

					if (screenPos) {
						const dx = screenPos.x - clickX;
						const dy = screenPos.y - clickY;
						const distance = Math.sqrt(dx * dx + dy * dy);

						if (distance < closestDistance) {
							closestDistance = distance;
							closestEntity = {
								entityName: name,
								entityType: entity.entityType,
								elementIndex: i,
								selectionType: "vertex",
								distance: distance
							};
						}
					}
				}
			}
		}

		if (closestEntity) {
			console.log("✅ [3D CONTEXT] Found entity by screen distance:", closestEntity.entityName, "type:", closestEntity.entityType, "distance:", closestEntity.distance.toFixed(1) + "px");
			clickedKADObject = closestEntity;
		}
	}

	console.log("🖱️  [3D Context Menu] Clicked objects - Hole:", clickedHole ? clickedHole.holeID : "null", "| KAD:", clickedKADObject ? clickedKADObject.entityType + " - " + clickedKADObject.entityName : "null");

	// Step 3k) PRIORITY: Check for multiple KAD selection FIRST (before single selection)
	// If multiple entities are selected, show the multi-edit dialog regardless of where you right-click
	if (window.selectedMultipleKADObjects && window.selectedMultipleKADObjects.length > 1) {
		console.log("📋 [3D CONTEXT] Multiple KAD objects selected (" + window.selectedMultipleKADObjects.length + "), showing multi-editor");
		if (typeof window.showMultipleKADPropertyEditor === "function") {
			window.showMultipleKADPropertyEditor(window.selectedMultipleKADObjects);
		}
		if (typeof window.debouncedUpdateTreeView === "function") {
			window.debouncedUpdateTreeView();
		}
		return;
	}

	// Step 3k.1) If a single KAD object is selected, show its context menu
	if (window.selectedKADObject) {
		console.log("📋 [3D CONTEXT] Selected KAD object found, showing context menu:", window.selectedKADObject.entityName);
		if (typeof window.showKADPropertyEditorPopup === "function") {
			window.showKADPropertyEditorPopup(window.selectedKADObject);
		}
		if (typeof window.debouncedUpdateTreeView === "function") {
			window.debouncedUpdateTreeView();
		}
		return;
	}

	// Step 3l) For KAD objects (Points, Lines, Polys, Circles, Text)
	// IMPORTANT: Show context menu for ANY clicked KAD object, not just when selection tools are active (matches 2D behavior)
	if (clickedKADObject) {
		console.log("📋 [3D CONTEXT] KAD object detected:", clickedKADObject.entityType, clickedKADObject.entityName);

		// Step 3l.1) Check if within snap radius (same as 2D)
		let withinSnapRadius = false;
		const entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(clickedKADObject.entityName) : null;

		if (entity) {
			if (clickedKADObject.selectionType === "vertex") {
				// Step 3l.1a) For vertex selection, check distance to the specific vertex
				const point = entity.data[clickedKADObject.elementIndex];
				if (point) {
					// Get world position from raycast
					const worldPos = window.interactionManager.getMouseWorldPositionOnPlane();
					if (worldPos) {
						const distance = Math.sqrt(Math.pow(point.pointXLocation - worldPos.x, 2) + Math.pow(point.pointYLocation - worldPos.y, 2));
						const snapRadius = window.getSnapToleranceInWorldUnits ? window.getSnapToleranceInWorldUnits() : 1.0;
						withinSnapRadius = distance <= snapRadius;
						console.log("  📏 [3D CONTEXT] Vertex distance:", distance.toFixed(2), "| Snap radius:", snapRadius.toFixed(2), "| Within:", withinSnapRadius);
					}
				}
			} else if (clickedKADObject.selectionType === "segment") {
				// Step 3l.1b) For segment selection, already validated by screen-space check
				withinSnapRadius = true;
				console.log("  📏 [3D CONTEXT] Segment - auto within snap radius");
			}
		} else {
			console.log("  ❌ [3D CONTEXT] Entity not found in allKADDrawingsMap:", clickedKADObject.entityName);
		}

		if (withinSnapRadius) {
			console.log("  ✅ [3D CONTEXT] Showing KAD property editor");
			if (typeof window.showKADPropertyEditorPopup === "function") {
				window.showKADPropertyEditorPopup(clickedKADObject);
			}
			if (typeof window.debouncedUpdateTreeView === "function") {
				window.debouncedUpdateTreeView();
			}
			return;
		} else {
			console.log("  ❌ [3D CONTEXT] Outside snap radius - not showing context menu");
		}
	} else {
		console.log("📋 [3D CONTEXT] No KAD object detected");
	}

	// Step 3m) Find clicked surface
	const clickedSurfaceId = window.interactionManager.findClickedSurface(intersects);
	if (clickedSurfaceId) {
		if (typeof window.showSurfaceContextMenu === "function") {
			window.showSurfaceContextMenu(event.clientX, event.clientY, clickedSurfaceId);
		}
		if (typeof window.debouncedUpdateTreeView === "function") {
			window.debouncedUpdateTreeView();
		}
		return;
	}

	// Step 3n) Find clicked image
	const clickedImageId = window.interactionManager.findClickedImage(intersects);
	if (clickedImageId) {
		if (typeof window.showImageContextMenu === "function") {
			window.showImageContextMenu(event.clientX, event.clientY, clickedImageId);
		}
		if (typeof window.debouncedUpdateTreeView === "function") {
			window.debouncedUpdateTreeView();
		}
		return;
	}

	// Step 3o) Default context menu - show status message if no object clicked
	if (typeof window.updateStatusMessage === "function") {
		window.updateStatusMessage("Right clicks need to be performed on an Object.");
		setTimeout(() => {
			window.updateStatusMessage("");
		}, 2000);
	}
}

// Step 4) Helper function to close all context menus
export function closeAllContextMenus() {
	// Find all elements that could be context menus
	const existingMenus = document.querySelectorAll('.context-menu, [style*="position: absolute"][style*="background"], div[onclick]');

	let menusClosed = false;
	existingMenus.forEach(menu => {
		// Check if it looks like a context menu (has background and position styling)
		const style = menu.style;
		if (style.position === "absolute" && (style.background || style.backgroundColor) && document.body.contains(menu)) {
			try {
				document.body.removeChild(menu);
				console.log("🗑️ Removed existing context menu");
				menusClosed = true;
				if (typeof window.debouncedUpdateTreeView === "function") {
					window.debouncedUpdateTreeView(); // Use debounced version
				}
			} catch (error) {
				// Menu already removed
			}
		}
	});

	// Step 4a) Trigger 3D redraw after closing menus to ensure geometry updates are visible
	if (menusClosed) {
		if (typeof window.redraw3D === "function") {
			window.redraw3D();
		} else if (typeof window.drawData === "function") {
			window.drawData(window.allBlastHoles, window.selectedHole);
		}
	}
}

// Step 5) KAD context menu for when KAD tools are active
export function kadContextMenu(e) {
	e.preventDefault(); // Prevent context menu

	// Check if any KAD drawing tool is active
	const anyKADToolActive = window.addPointDraw.checked || window.addLineDraw.checked || window.addCircleDraw.checked || window.addPolyDraw.checked || window.addTextDraw.checked;

	if (anyKADToolActive) {
		// Step 5a) Use endKadTools() to properly handle ending entities and tools (like Escape key)
		window.endKadTools();
	}
}

//===========================================
// CONTEXT MENU MANAGER END
//===========================================

// Make functions available globally via namespace
export const ContextMenuManager = {
	handle2DContextMenu: handle2DContextMenu,
	handle3DContextMenu: handle3DContextMenu,
	closeAllContextMenus: closeAllContextMenus,
	kadContextMenu: kadContextMenu
};
window.ContextMenuManager = ContextMenuManager;

// Also expose directly for backwards compatibility
window.handle2DContextMenu = handle2DContextMenu;
window.handle3DContextMenu = handle3DContextMenu;
window.closeAllContextMenus = closeAllContextMenus;
window.kadContextMenu = kadContextMenu;
