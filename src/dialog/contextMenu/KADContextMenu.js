// src/dialog/contextMenu/KADContextMenu.js
//=============================================================
// KAD CONTEXT MENU
//=============================================================
// Step 0) Converted to ES Module for Vite bundling - 2025-12-26

// Step 1) Show KAD property editor popup for single KAD object
export function showKADPropertyEditorPopup(kadObject) {
	const isMultiElement = kadObject.entityType === "line" || kadObject.entityType === "poly" || kadObject.entityType === "point" || kadObject.entityType === "circle" || kadObject.entityType === "text";

	const entity = window.getEntityFromKADObject(kadObject);
	const hasMultipleElements = entity && entity.data.length > 1;

	// Step 1a) Populate kadObject with element data
	// CRITICAL: For segments, ALWAYS get properties from the endpoint (next point), not the start point
	// The 2D getClickedKADObject spreads point1 properties, so we must override them here
	if (entity && entity.data && kadObject.elementIndex !== undefined) {
		let dataIndex = kadObject.elementIndex;

		// For segment selections in lines/polygons, use the endpoint (next point)
		const isLineOrPolySegment = (kadObject.entityType === "line" || kadObject.entityType === "poly") && kadObject.selectionType === "segment";
		if (isLineOrPolySegment) {
			const isPoly = kadObject.entityType === "poly";
			const numPoints = entity.data.length;
			dataIndex = isPoly ? (dataIndex + 1) % numPoints : dataIndex + 1;
			console.log("🎨 [KAD DIALOG] Segment selected - loading properties from endpoint index " + dataIndex + " instead of " + kadObject.elementIndex);
		}

		const element = entity.data[dataIndex];
		if (element) {
			// ALWAYS populate from the correct element (override any spread properties from getClickedKADObject)
			kadObject.pointXLocation = element.pointXLocation || 0;
			kadObject.pointYLocation = element.pointYLocation || 0;
			kadObject.pointZLocation = element.pointZLocation || 0;
			kadObject.color = element.color || "#FF0000";
			kadObject.lineWidth = element.lineWidth || 1;
			kadObject.radius = element.radius;
			kadObject.text = element.text || "";
			kadObject.fontHeight = element.fontHeight || element.lineWidth || 12;
		}
	}

	// Step 1b) Determine if this is a line/poly (they share the same dialog)
	const isLineOrPoly = kadObject.entityType === "line" || kadObject.entityType === "poly";

	// Step 1c) Create title showing correct element/segment number
	let displayIndex = kadObject.elementIndex + 1;
	let elementTypeLabel = "Element";

	// For segments, show "Segment X" instead of "Element X"
	if (kadObject.selectionType === "segment") {
		elementTypeLabel = "Segment";
		displayIndex = kadObject.elementIndex + 1; // Segments are numbered starting from 1
	}

	const title = hasMultipleElements ? "Edit " + kadObject.entityType.toUpperCase() + " - " + kadObject.entityName + " - " + elementTypeLabel + " " + displayIndex : "Edit " + kadObject.entityType.toUpperCase() + " - " + kadObject.entityName;

	const currentColor = kadObject.color || "#FF0000";

	// Step 2) Define form fields using the same pattern as showHolePropertyEditor
	const fields = [
		{
			label: "Color",
			name: "editKADColor",
			type: "color",
			value: currentColor
		},
		{
			label: "X Location",
			name: "editXLocation",
			type: "number",
			value: kadObject.pointXLocation || 0,
			step: "0.001"
		},
		{
			label: "Y Location",
			name: "editYLocation",
			type: "number",
			value: kadObject.pointYLocation || 0,
			step: "0.001"
		},
		{
			label: "Z Location",
			name: "editZLocation",
			type: "number",
			value: kadObject.pointZLocation || 0,
			step: "0.001"
		},
		{
			label: "Only Z (set all Z values to this value)",
			name: "onlyZCheckbox",
			type: "checkbox",
			checked: kadObject.onlyZ || false
		}
	];

	// Step 3) Add specific fields based on entity type
	if (isLineOrPoly) {
		fields.push({
			label: "Line Width",
			name: "editLineWidth",
			type: "number",
			value: kadObject.lineWidth || 1,
			min: "0.1",
			max: "10",
			step: "0.1"
		});

		fields.push({
			label: "Type",
			name: "editType",
			type: "select",
			value: kadObject.entityType,
			options: [
				{
					value: "line",
					text: "Open (Line)"
				},
				{
					value: "poly",
					text: "Closed (Polygon)"
				}
			]
		});
	} else if (kadObject.entityType === "circle") {
		fields.push({
			label: "Radius",
			name: "editRadius",
			type: "number",
			value: kadObject.radius || 1,
			min: "0.1",
			max: "100",
			step: "0.1"
		});
	} else if (kadObject.entityType === "text") {
		// Step 3a) Text field for text entities
		fields.push({
			label: "Text",
			name: "editText",
			type: "text",
			value: kadObject.text || ""
		});
		// Step 3b) Font Height field for text entities
		fields.push({
			label: "Font Height",
			name: "editFontHeight",
			type: "number",
			value: kadObject.fontHeight || 12,
			min: "1",
			max: "200",
			step: "1"
		});
	} else if (kadObject.entityType === "point") {
		fields.push({
			label: "Point Diameter/Line Width",
			name: "editLineWidth",
			type: "number",
			value: kadObject.lineWidth || 1,
			min: "0.1",
			max: "10",
			step: "0.1"
		});
	}

	// Step 4) Create enhanced form content using the existing helper function
	const formContent = window.createEnhancedFormContent(fields, hasMultipleElements, false);

	// Step 4b) Store initial values for dirty tracking (only apply explicitly changed fields on "All")
	const initialValues = {
		editKADColor: currentColor,
		editXLocation: String(kadObject.pointXLocation || 0),
		editYLocation: String(kadObject.pointYLocation || 0),
		editZLocation: String(kadObject.pointZLocation || 0),
		editLineWidth: String(kadObject.lineWidth || 1),
		editRadius: String(kadObject.radius || 1),
		editText: kadObject.text || "",
		editFontHeight: String(kadObject.fontHeight || 12),
		editType: kadObject.entityType,
		onlyZCheckbox: kadObject.onlyZ || false
	};

	// Step 4a) Add info note
	const noteDiv = document.createElement("div");
	noteDiv.style.fontSize = "12px";
	noteDiv.style.color = "#aaa";
	noteDiv.style.gridColumn = "1 / -1";
	noteDiv.style.marginTop = "10px";
	noteDiv.innerHTML = "<b>All:</b> Move all points by the same offset as this point (unless Only Z is checked).<br>" + "<b>This:</b> Move only this point (unless Only Z is checked).";
	formContent.appendChild(noteDiv);

	// Step 5) Check if Insert button should be shown (only for line/poly segments)
	const showInsertButton = isLineOrPoly && kadObject.selectionType === "segment";

	// Step 5a) Create the dialog with 6 buttons (added Insert)
	const dialog = new window.FloatingDialog({
		title: title,
		content: formContent,
		layoutType: "compact",
		showConfirm: hasMultipleElements, // Show "All" button only for multi-element objects
		showDeny: true, // "This" button
		showCancel: true, // "Cancel" button
		showOption1: true, // "Hide" button
		showOption2: true, // "Delete" button
		showOption3: showInsertButton, // "Insert" button (only for line/poly segments)
		confirmText: "All",
		denyText: "This",
		cancelText: "Cancel",
		option1Text: "Hide",
		option2Text: "Delete",
		option3Text: "Insert",
		width: 430,
		height: isLineOrPoly ? 400 : 350,
		onConfirm: () => {
			// Step 5a) Get form values and apply to all elements
			const formData = window.getFormData(formContent);

			// Step 5a.1) Handle line/poly conversion first (explicit action via dropdown)
			const isLineOrPolyEntity = kadObject.entityType === "line" || kadObject.entityType === "poly";
			if (isLineOrPolyEntity && formData.editType && formData.editType !== initialValues.editType) {
				convertLinePolyType(kadObject, formData.editType);
			}

			// Step 5a.2) Build properties object with ONLY explicitly changed fields
			// This prevents unwanted Z flattening when user only changes color/lineWidth
			const newProperties = {};
			var hasChanges = false;

			// Step 5a.3) Compare each field to initial value - only include if changed
			if (formData.editKADColor !== initialValues.editKADColor) {
				newProperties.color = formData.editKADColor;
				hasChanges = true;
			}
			if (formData.editLineWidth !== initialValues.editLineWidth) {
				newProperties.lineWidth = formData.editLineWidth;
				hasChanges = true;
			}
			if (formData.editXLocation !== initialValues.editXLocation) {
				newProperties.pointXLocation = parseFloat(formData.editXLocation);
				hasChanges = true;
			}
			if (formData.editYLocation !== initialValues.editYLocation) {
				newProperties.pointYLocation = parseFloat(formData.editYLocation);
				hasChanges = true;
			}
			if (formData.editZLocation !== initialValues.editZLocation) {
				newProperties.pointZLocation = parseFloat(formData.editZLocation);
				hasChanges = true;
			}
			if (formData.editRadius !== initialValues.editRadius) {
				newProperties.radius = formData.editRadius;
				hasChanges = true;
			}
			if (formData.editText !== initialValues.editText) {
				newProperties.text = formData.editText;
				hasChanges = true;
			}
			// Step B3) Include fontHeight in dirty tracking
			if (formData.editFontHeight !== initialValues.editFontHeight) {
				newProperties.fontHeight = formData.editFontHeight;
				hasChanges = true;
			}

			// Step 5a.4) Always include onlyZ flag (behavior flag, not data)
			newProperties.onlyZ = formData.onlyZCheckbox;

			// Step 5a.5) Only update if something actually changed
			if (hasChanges) {
				updateKADObjectProperties(kadObject, newProperties, "all");
			}

			window.debouncedSaveKAD();
			window.clearAllSelectionState();
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
		},
		onDeny: () => {
			// Step 5b) Get form values and apply to this element only
			const formData = window.getFormData(formContent);

			// Handle line/poly conversion first
			const isLineOrPoly = kadObject.entityType === "line" || kadObject.entityType === "poly";
			if (isLineOrPoly && formData.editType && formData.editType !== kadObject.entityType) {
				convertLinePolyType(kadObject, formData.editType);
			}

			// Build properties object - for "This" button, apply all values
			const newProperties = {
				color: formData.editKADColor,
				pointXLocation: parseFloat(formData.editXLocation),
				pointYLocation: parseFloat(formData.editYLocation),
				pointZLocation: parseFloat(formData.editZLocation),
				lineWidth: formData.editLineWidth,
				radius: formData.editRadius,
				text: formData.editText,
				fontHeight: formData.editFontHeight,
				onlyZ: formData.onlyZCheckbox
			};

			// Use existing function
			updateKADObjectProperties(kadObject, newProperties, "element");
			window.debouncedSaveKAD();
			window.clearAllSelectionState();
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
		},
		onCancel: () => {
			// Step 5c) Clear selection and redraw when dialog closes
			window.clearAllSelectionState();
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
		},
		onOption1: () => {
			// Step 5d) Hide entire entity using the proper visibility function
			window.setKADEntityVisibility(kadObject.entityName, false);
			window.clearAllSelectionState();
			//window.debouncedSaveKAD(); don't save visbility it is only for the view.
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
			dialog.close();
		},
		onOption2: () => {
			// Step 5e) Delete point/segment/element with auto-renumber
			// Close the property dialog first
			dialog.close();

			const entity = window.getEntityFromKADObject(kadObject);
			if (!entity) return;

			let deletionIndex = kadObject.elementIndex;

			// For segment selections, delete the endpoint (next point)
			const isLineOrPolySegment = (kadObject.entityType === "line" || kadObject.entityType === "poly") && kadObject.selectionType === "segment";
			if (isLineOrPolySegment) {
				const isPoly = kadObject.entityType === "poly";
				const numPoints = entity.data.length;
				deletionIndex = isPoly ? (deletionIndex + 1) % numPoints : deletionIndex + 1;
			}

			// Step #) Capture vertex data for undo BEFORE deletion
			var vertexDataForUndo = JSON.parse(JSON.stringify(entity.data[deletionIndex]));
			var entityNameForUndo = kadObject.entityName;

			// Remove the point/vertex
			entity.data.splice(deletionIndex, 1);

			// Step #) Create undo action for deleted vertex
			if (window.undoManager) {
				var deleteVertexAction = new window.DeleteKADVertexAction(entityNameForUndo, vertexDataForUndo, deletionIndex);
				window.undoManager.pushAction(deleteVertexAction);
			}

			// Handle edge cases
			if (entity.data.length === 0) {
				// Delete entire entity if no points left
				window.allKADDrawingsMap.delete(kadObject.entityName);
				window.updateStatusMessage("Deleted entity " + kadObject.entityName);
			} else if (entity.data.length === 1 && (entity.entityType === "line" || entity.entityType === "poly")) {
				// Delete entity if only 1 point remains in line/poly
				window.allKADDrawingsMap.delete(kadObject.entityName);
				window.updateStatusMessage("Deleted entity " + kadObject.entityName + " (insufficient points)");
			} else if (entity.data.length === 2 && entity.entityType === "poly") {
				// Convert poly to line if only 2 points remain
				entity.entityType = "line";
				entity.data.forEach(point => {
					point.entityType = "line";
					point.closed = false;
				});
				window.updateStatusMessage("Converted " + kadObject.entityName + " to line (2 points)");
				// Auto-renumber remaining points (USE FACTORY CODE)
				window.renumberEntityPoints(entity);
			} else {
				// Normal case: just renumber (USE FACTORY CODE)
				window.renumberEntityPoints(entity);
				window.updateStatusMessage("Deleted point from " + kadObject.entityName);
			}

			// Save and redraw (USE FACTORY CODE)
			window.debouncedSaveKAD();
			window.debouncedUpdateTreeView();
			window.clearAllSelectionState();
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }

			setTimeout(() => window.updateStatusMessage(""), 2000);
		},
		onOption3: () => {
			// Step 5f) Insert point at midpoint of selected segment
			dialog.close();

			const entity = window.getEntityFromKADObject(kadObject);
			if (!entity) return;

			// Get the segment indices
			const segmentStartIndex = kadObject.elementIndex;
			const isPoly = kadObject.entityType === "poly";
			const numPoints = entity.data.length;
			const segmentEndIndex = isPoly ? (segmentStartIndex + 1) % numPoints : segmentStartIndex + 1;

			if (segmentEndIndex >= numPoints && !isPoly) {
				window.updateStatusMessage("Cannot insert after last point in line");
				setTimeout(() => window.updateStatusMessage(""), 2000);
				return;
			}

			const p1 = entity.data[segmentStartIndex];
			const p2 = entity.data[segmentEndIndex];

			// Calculate midpoint and interpolated Z
			const midX = (p1.pointXLocation + p2.pointXLocation) / 2;
			const midY = (p1.pointYLocation + p2.pointYLocation) / 2;
			const midZ = (p1.pointZLocation + p2.pointZLocation) / 2;

			// Create new point with interpolated properties
			const newPoint = {
				entityName: kadObject.entityName,
				entityType: kadObject.entityType,
				pointID: 0, // Will be renumbered
				pointXLocation: midX,
				pointYLocation: midY,
				pointZLocation: midZ,
				lineWidth: p2.lineWidth || p1.lineWidth || 1,
				color: p2.color || p1.color || "#FF0000",
				visible: true,
				closed: isPoly
			};

			// Insert the new point after the segment start
			const insertIndex = isPoly ? segmentEndIndex : segmentStartIndex + 1;
			entity.data.splice(insertIndex, 0, newPoint);

			// Renumber points
			window.renumberEntityPoints(entity);

			// Save and redraw
			window.debouncedSaveKAD();
			window.debouncedUpdateTreeView();
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
			window.updateStatusMessage("Inserted point in " + kadObject.entityName);
			setTimeout(() => window.updateStatusMessage(""), 2000);
		}
	});

	dialog.show();
}

// Step 6) Function to show property editor for multiple KAD objects
export function showMultipleKADPropertyEditor(kadObjects) {
	if (!kadObjects || kadObjects.length === 0) return;

	// Step 6a) Get first entity to determine default values
	const firstEntity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(kadObjects[0].entityName) : null;
	const firstColor = firstEntity && firstEntity.data && firstEntity.data[0] ? firstEntity.data[0].color || "#FF0000" : "#FF0000";
	const firstLineWidth = firstEntity && firstEntity.data && firstEntity.data[0] ? firstEntity.data[0].lineWidth || 2 : 2;
	const firstZ = firstEntity && firstEntity.data && firstEntity.data[0] ? firstEntity.data[0].pointZLocation || 0 : 0;
	const firstFontHeight = firstEntity && firstEntity.data && firstEntity.data[0] ? firstEntity.data[0].fontHeight || 12 : 12;
	const entityType = kadObjects[0].entityType || "polygon";

	// Step 6b) Common properties that can be edited for all KAD objects
	const fields = [
		{
			label: "Color",
			name: "editKADColor",
			type: "color",
			value: firstColor
		},
		{
			label: "Line Width",
			name: "editLineWidth",
			type: "number",
			value: firstLineWidth,
			step: "0.1",
			min: "0.1",
			max: "10"
		},
		{
			label: "Z Elevation",
			name: "editZLocation",
			type: "number",
			value: firstZ,
			step: "0.1"
		}
	];

	// Step 6b.1) Add Font Height field for text entities
	if (entityType === "text") {
		fields.push({
			label: "Font Height",
			name: "editFontHeight",
			type: "number",
			value: firstFontHeight,
			min: "1",
			max: "200",
			step: "1"
		});
	}

	// Step 6c) Use the same enhanced form content helper for consistent styling
	const formContent = window.createEnhancedFormContent ? window.createEnhancedFormContent(fields, false, false) : document.createElement("div");

	// Fallback if createEnhancedFormContent doesn't exist
	if (!window.createEnhancedFormContent) {
		fields.forEach(field => {
			const fieldDiv = document.createElement("div");
			fieldDiv.className = "form-field";
			fieldDiv.style.marginBottom = "10px";

			const label = document.createElement("label");
			label.textContent = field.label + ":";
			label.style.display = "inline-block";
			label.style.width = "100px";
			fieldDiv.appendChild(label);

			const input = document.createElement("input");
			input.type = field.type;
			input.name = field.name;
			input.value = field.value;

			if (field.type === "number") {
				input.step = field.step || "1";
				if (field.min) input.min = field.min;
				if (field.max) input.max = field.max;
			}

			if (field.type === "color") {
				input.className = "jscolor";
				input.setAttribute("data-jscolor", "{}");
			}

			fieldDiv.appendChild(input);
			formContent.appendChild(fieldDiv);
		});
	}

	// Step 6d) Add note about multiple selection (matching single editor styling)
	const noteDiv = document.createElement("div");
	noteDiv.style.fontSize = "12px";
	noteDiv.style.color = "#aaa";
	noteDiv.style.gridColumn = "1 / -1";
	noteDiv.style.marginTop = "10px";
	noteDiv.innerHTML = "Editing " + kadObjects.length + " " + (kadObjects[0].entityType || "polygon") + "(s)";
	formContent.appendChild(noteDiv);

	// Step 6e) Determine entity type display for title (entityType already defined above)
	const entityTypeDisplay = entityType.charAt(0).toUpperCase() + entityType.slice(1) + (entityType.endsWith("s") ? "es" : "s");

	// Step 6e.1) Store initial values for dirty tracking
	const initialMultiValues = {
		editKADColor: firstColor,
		editLineWidth: String(firstLineWidth),
		editZLocation: String(firstZ),
		editFontHeight: String(firstFontHeight)
	};

	// Step 6f) Create dialog
	const dialog = new window.FloatingDialog({
		title: "Edit Multiple " + entityTypeDisplay,
		content: formContent,
		layoutType: "default",
		width: 350,
		height: 250,
		showConfirm: true,
		showCancel: true,
		confirmText: "Apply",
		cancelText: "Cancel",
		onConfirm: () => {
			// Step 6f.1) Get form values
			const formData = window.getFormData(formContent);

			// Step 6f.2) Apply changes to all selected KAD objects - ONLY if field was modified (dirty flag)
			kadObjects.forEach(kadObj => {
				const entity = window.allKADDrawingsMap.get(kadObj.entityName);
				if (entity) {
					// Update all points in the entity
					entity.data.forEach(point => {
						// Only apply if value changed from initial (dirty flag check)
						if (formData.editKADColor && formData.editKADColor !== initialMultiValues.editKADColor) {
							point.color = formData.editKADColor;
						}
						if (formData.editLineWidth && formData.editLineWidth !== initialMultiValues.editLineWidth) {
							point.lineWidth = parseFloat(formData.editLineWidth);
						}
						if (formData.editZLocation && formData.editZLocation !== initialMultiValues.editZLocation) {
							point.pointZLocation = parseFloat(formData.editZLocation);
						}
						// Step 6f.2a) Apply fontHeight for text entities (only if changed)
						if (formData.editFontHeight && formData.editFontHeight !== initialMultiValues.editFontHeight) {
							point.fontHeight = parseFloat(formData.editFontHeight);
						}
					});
				}
			});

			// Step 6f.3) Save and redraw
			window.debouncedSaveKAD();
			window.clearAllSelectionState();
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
			window.updateStatusMessage("Updated " + kadObjects.length + " " + entityType + "(s)");
			setTimeout(() => window.updateStatusMessage(""), 2000);
		},
		onCancel: () => {
			// Step 6f.4) Just close
			window.clearAllSelectionState();
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
		}
	});

	dialog.show();

	// Step 6g) Initialize color picker (JSCOLOR) if present - must be done after dialog is shown
	if (typeof jscolor !== "undefined") {
		setTimeout(() => {
			jscolor.install();
		}, 100);
	}
}

// Step 7) Function to convert between line and poly
export function convertLinePolyType(kadObject, newType) {
	const entity = window.getEntityFromKADObject(kadObject);
	if (!entity) return;

	// Step 7a) Validate: closing a line requires 3+ points
	var pointCount = entity.data ? entity.data.length : 0;
	if (newType === "poly" && pointCount < 3) {
		window.updateStatusMessage("Cannot close — need 3+ points (has " + pointCount + ")");
		setTimeout(() => window.updateStatusMessage(""), 3000);
		return;
	}

	// Step 7b) Update entity type
	entity.entityType = newType;

	// Step 7c) Update all data points to reflect the new type
	entity.data.forEach(point => {
		point.entityType = newType;
		if (newType === "poly") {
			point.closed = true;
		} else {
			point.closed = false;
		}
	});

	window.updateStatusMessage("Converted " + kadObject.entityName + " to " + newType);
	window.debouncedUpdateTreeView(); // Update tree view swatches
	setTimeout(() => window.updateStatusMessage(""), 2000);
}

// Step 8) Function to update KAD object properties
export function updateKADObjectProperties(kadObject, newProperties, scope = "all") {
	const map = window.allKADDrawingsMap;
	const entity = map.get(kadObject.entityName);

	if (entity) {
		const onlyZ = newProperties.onlyZ;
		if (scope === "element") {
			// Step 8a) Only this point/segment
			let elementIndex = kadObject.elementIndex;

			// Step 8a.1) CRITICAL FIX: For segments in lines/polygons, modify the endpoint (next point)
			// A segment from point[i] to point[i+1] uses point[i+1]'s color/properties
			const isLineOrPoly = entity.entityType === "line" || entity.entityType === "poly";
			if (isLineOrPoly && kadObject.selectionType === "segment") {
				// For a segment, we want to modify the "to" point (endpoint), not the "from" point
				const isPoly = entity.entityType === "poly";
				const numPoints = entity.data.length;
				elementIndex = isPoly ? (elementIndex + 1) % numPoints : elementIndex + 1;
				console.log("🔧 [KAD MODIFY] Segment selected - modifying endpoint at index " + elementIndex + " instead of " + kadObject.elementIndex);
			}

			if (elementIndex !== undefined && elementIndex < entity.data.length) {
				const item = entity.data[elementIndex];
				if (newProperties.color) item.color = newProperties.color;
				if (newProperties.lineWidth) item.lineWidth = parseFloat(newProperties.lineWidth);
				if (newProperties.radius) item.radius = parseFloat(newProperties.radius);
				if (newProperties.text) item.text = newProperties.text;
				// Step B3) Handle fontHeight for text entities
				if (newProperties.fontHeight) item.fontHeight = parseFloat(newProperties.fontHeight);

				if (onlyZ) {
					if (newProperties.pointZLocation !== undefined) item.pointZLocation = parseFloat(newProperties.pointZLocation);
				} else {
					if (newProperties.pointXLocation !== undefined) item.pointXLocation = parseFloat(newProperties.pointXLocation);
					if (newProperties.pointYLocation !== undefined) item.pointYLocation = parseFloat(newProperties.pointYLocation);
					if (newProperties.pointZLocation !== undefined) item.pointZLocation = parseFloat(newProperties.pointZLocation);
				}

				const displayIndex = kadObject.selectionType === "segment" ? kadObject.elementIndex + 1 : elementIndex + 1;
				updateStatusMessage("Updated element " + displayIndex + " of " + kadObject.entityType + " " + kadObject.entityName);
			}
		} else {
			// Step 8b) All points
			const elementIndex = kadObject.elementIndex;
			const item = entity.data[elementIndex];
			let dx = 0,
				dy = 0,
				dz = 0;
			if (!onlyZ && item) {
				if (newProperties.pointXLocation !== undefined) dx = parseFloat(newProperties.pointXLocation) - item.pointXLocation;
				if (newProperties.pointYLocation !== undefined) dy = parseFloat(newProperties.pointYLocation) - item.pointYLocation;
				if (newProperties.pointZLocation !== undefined) dz = parseFloat(newProperties.pointZLocation) - item.pointZLocation;
			}
			entity.data.forEach(pt => {
				if (newProperties.color) pt.color = newProperties.color;
				if (newProperties.lineWidth) pt.lineWidth = parseFloat(newProperties.lineWidth);
				if (newProperties.radius) pt.radius = parseFloat(newProperties.radius);
				if (newProperties.text) pt.text = newProperties.text;
				if (newProperties.fontHeight) pt.fontHeight = parseFloat(newProperties.fontHeight);
				if (newProperties.pointDiameter) pt.pointDiameter = parseFloat(newProperties.pointDiameter);
				// Step B3) Handle fontHeight for text entities
				if (newProperties.fontHeight) pt.fontHeight = parseFloat(newProperties.fontHeight);

				if (onlyZ) {
					if (newProperties.pointZLocation !== undefined) pt.pointZLocation = parseFloat(newProperties.pointZLocation);
				} else {
					if (newProperties.pointXLocation !== undefined) pt.pointXLocation += dx;
					if (newProperties.pointYLocation !== undefined) pt.pointYLocation += dy;
					if (newProperties.pointZLocation !== undefined) pt.pointZLocation += dz;
				}
			});
			window.updateStatusMessage("Updated all elements of " + kadObject.entityType + " " + kadObject.entityName);
		}
		setTimeout(() => window.updateStatusMessage(""), 2000);
	}
}

//===========================================
// KAD CONTEXT MENU END
//===========================================

// Make functions available globally
window.showKADPropertyEditorPopup = showKADPropertyEditorPopup;
window.showMultipleKADPropertyEditor = showMultipleKADPropertyEditor;
window.convertLinePolyType = convertLinePolyType;
window.updateKADObjectProperties = updateKADObjectProperties;
