// src/dialog/popups/generic/MoveToLayerDialog.js
//=============================================================
// MOVE TO LAYER DIALOG
//=============================================================
// Allows moving surfaces or KAD drawing entities to a different layer.
// Follows the AssignBlastDialog pattern.

console.log("MoveToLayerDialog.js: Loading...");

/**
 * Show the Move to Layer dialog for surfaces or KAD drawing entities.
 * @param {string} layerType - "surface" or "drawing"
 * @param {Array<string>} itemIds - Array of surface IDs or KAD entity names
 */
export function moveToLayerDialog(layerType, itemIds) {
	if (!itemIds || itemIds.length === 0) {
		if (typeof window.showModalMessage === "function") {
			window.showModalMessage("No Selection", "No items selected to move.", "warning");
		}
		return;
	}

	var layersMap = layerType === "surface" ? window.allSurfaceLayers : window.allDrawingLayers;
	if (!layersMap) {
		if (typeof window.showModalMessage === "function") {
			window.showModalMessage("Error", "Layer system not initialized.", "error");
		}
		return;
	}

	// Step 1) Determine current layer(s) of selected items
	var currentLayerNames = new Set();
	itemIds.forEach(function (itemId) {
		var foundLayer = false;
		for (var [layerId, layer] of layersMap) {
			if (layer.entities && layer.entities.has(itemId)) {
				currentLayerNames.add(layer.layerName);
				foundLayer = true;
				break;
			}
		}
		if (!foundLayer) currentLayerNames.add("Default");
	});
	var currentLayerText = Array.from(currentLayerNames).join(", ");

	// Step 2) Build select options from existing layers + "Create New"
	var selectOptions = [];
	for (var [layerId, layer] of layersMap) {
		selectOptions.push({ value: layerId, text: layer.layerName });
	}
	selectOptions.sort(function (a, b) { return a.text.localeCompare(b.text); });
	selectOptions.push({ value: "__NEW__", text: "+ Create New Layer..." });

	// Step 3) Build form fields
	var fields = [
		{
			label: "Selected Items",
			name: "selectedCount",
			type: "text",
			value: itemIds.length + " item(s) from: " + currentLayerText,
			disabled: true
		},
		{
			label: "Target Layer",
			name: "targetLayer",
			type: "select",
			value: selectOptions.length > 1 ? selectOptions[0].value : "__NEW__",
			options: selectOptions
		},
		{
			label: "New Layer Name",
			name: "newLayerName",
			type: "text",
			value: "",
			placeholder: "Enter new layer name",
			disabled: true
		}
	];

	var formContent = window.createEnhancedFormContent(fields, false);

	// Step 4) Wire up select to enable/disable new name field
	var targetSelect = formContent.querySelector("[name='targetLayer']");
	var newNameRow = formContent.querySelector("[data-field='newLayerName']");
	var newNameInput = newNameRow ? newNameRow.querySelector("input") : null;
	var newNameLabel = newNameRow ? newNameRow.querySelector("label") : null;

	if (targetSelect && newNameInput) {
		var updateNewNameState = function () {
			if (targetSelect.value === "__NEW__") {
				newNameInput.disabled = false;
				newNameInput.style.opacity = "1";
				if (newNameLabel) newNameLabel.style.opacity = "1";
				newNameInput.focus();
			} else {
				newNameInput.disabled = true;
				newNameInput.style.opacity = "0.3";
				if (newNameLabel) newNameLabel.style.opacity = "0.3";
				newNameInput.value = "";
			}
		};

		updateNewNameState();
		targetSelect.addEventListener("change", updateNewNameState);
	}

	// Step 5) Create and show the dialog
	var dialog = new window.FloatingDialog({
		title: "Move to Layer",
		content: formContent,
		layoutType: "compact",
		width: 400,
		height: 220,
		showConfirm: true,
		showCancel: true,
		confirmText: "Move",
		cancelText: "Cancel",
		onConfirm: function () {
			var formData = window.getFormData(formContent);
			var targetLayerId = formData.targetLayer;

			// Step 6) Handle "Create New Layer"
			if (targetLayerId === "__NEW__") {
				var newName = (formData.newLayerName || "").trim();
				if (!newName) {
					window.showModalMessage("Invalid Name", "Please enter a new layer name.", "warning");
					return false;
				}

				// Check for duplicate name
				var nameExists = false;
				for (var [lid, lyr] of layersMap) {
					if (lyr.layerName === newName) {
						nameExists = true;
						targetLayerId = lid;
						break;
					}
				}

				if (!nameExists) {
					// Create new layer
					if (typeof window.createLayer === "function") {
						var result = window.createLayer(layerType, newName);
						if (result.success) {
							targetLayerId = result.layerId;
						} else {
							window.showModalMessage("Error", result.message || "Failed to create layer.", "error");
							return false;
						}
					} else {
						window.showModalMessage("Error", "Layer creation not available.", "error");
						return false;
					}
				}
			}

			// Step 7) Perform the move
			performMove(layerType, layersMap, itemIds, targetLayerId);
		}
	});

	dialog.show();
}

/**
 * Move items from their current layer to a target layer.
 * @param {string} layerType - "surface" or "drawing"
 * @param {Map} layersMap - allSurfaceLayers or allDrawingLayers
 * @param {Array<string>} itemIds - IDs to move
 * @param {string} targetLayerId - Destination layer ID
 */
function performMove(layerType, layersMap, itemIds, targetLayerId) {
	var targetLayer = layersMap.get(targetLayerId);
	if (!targetLayer) {
		console.error("Move to Layer: target layer not found:", targetLayerId);
		return;
	}

	var movedCount = 0;

	itemIds.forEach(function (itemId) {
		// Step 8) Remove from old layer(s)
		for (var [layerId, layer] of layersMap) {
			if (layer.entities && layer.entities.has(itemId)) {
				layer.entities.delete(itemId);
				break;
			}
		}

		// Step 9) Add to target layer
		targetLayer.entities.add(itemId);

		// Step 10) Update layerId on the item object itself
		if (layerType === "surface") {
			var surface = window.loadedSurfaces ? window.loadedSurfaces.get(itemId) : null;
			if (surface) {
				surface.layerId = targetLayerId;
			}
		} else if (layerType === "drawing") {
			var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(itemId) : null;
			if (entity) {
				entity.layerId = targetLayerId;
			}
		}

		movedCount++;
	});

	// Step 11) Persist and refresh
	if (typeof window.debouncedSaveLayers === "function") {
		window.debouncedSaveLayers();
	}
	if (layerType === "surface") {
		// Save updated layerId on surfaces
		itemIds.forEach(function (id) {
			if (typeof window.saveSurfaceToDB === "function") {
				window.saveSurfaceToDB(id).catch(function (err) {
					console.error("Failed to save surface after layer move:", err);
				});
			}
		});
	} else if (layerType === "drawing") {
		// Save updated layerId on KAD entities
		if (typeof window.debouncedSaveKAD === "function") {
			window.debouncedSaveKAD();
		}
	}
	if (typeof window.debouncedUpdateTreeView === "function") {
		window.debouncedUpdateTreeView();
	}

	// Step 12) Status message
	if (typeof window.updateStatusMessage === "function") {
		window.updateStatusMessage("Moved " + movedCount + " item(s) to layer '" + targetLayer.layerName + "'");
		setTimeout(function () { window.updateStatusMessage(""); }, 3000);
	}

	console.log("Move to Layer: moved " + movedCount + " item(s) to '" + targetLayer.layerName + "'");
}

// Make available globally
window.moveToLayerDialog = moveToLayerDialog;
