/**
 * @fileoverview ProductDialog - Product management UI for the charging system
 * Uses FloatingDialog (per project conventions) for product CRUD operations
 */

import { FloatingDialog, createEnhancedFormContent, getFormData, showConfirmationDialog } from "../dialog/FloatingDialog.js";
import { Product } from "./products/Product.js";
import { NonExplosiveProduct } from "./products/NonExplosiveProduct.js";
import { BulkExplosiveProduct } from "./products/BulkExplosiveProduct.js";
import { HighExplosiveProduct } from "./products/HighExplosiveProduct.js";
import { InitiatorProduct, ElectronicDetonator, ShockTubeDetonator, ElectricDetonator, DetonatingCordProduct } from "./products/InitiatorProduct.js";
import { SpacerProduct } from "./products/SpacerProduct.js";
import {
	NON_EXPLOSIVE_TYPES,
	BULK_EXPLOSIVE_TYPES,
	HIGH_EXPLOSIVE_TYPES,
	INITIATOR_TYPES,
	SPACER_TYPES,
	DECK_COLORS
} from "./ChargingConstants.js";
import {
	exportBaseConfigTemplate,
	exportCurrentConfig,
	importConfigFromZip,
	clearAllProducts,
	clearAllChargeConfigs,
	backupChargingConfig
} from "./ConfigImportExport.js";

// Product type options by category
var PRODUCT_TYPE_OPTIONS = {
	NonExplosive: Object.values(NON_EXPLOSIVE_TYPES),
	BulkExplosive: Object.values(BULK_EXPLOSIVE_TYPES),
	HighExplosive: Object.values(HIGH_EXPLOSIVE_TYPES),
	Initiator: Object.values(INITIATOR_TYPES),
	Spacer: Object.values(SPACER_TYPES)
};

var CATEGORY_LABELS = {
	NonExplosive: "Non-Explosive",
	BulkExplosive: "Bulk Explosive",
	HighExplosive: "High Explosive",
	Initiator: "Initiator",
	Spacer: "Spacer"
};

/**
 * Show the product manager dialog
 * Lists all products with add/edit/delete capability
 */
export function showProductManagerDialog() {
	var productsMap = window.loadedProducts || new Map();

	var contentDiv = document.createElement("div");
	contentDiv.style.display = "flex";
	contentDiv.style.flexDirection = "column";
	contentDiv.style.height = "100%";

	// Product list table
	var tableContainer = document.createElement("div");
	tableContainer.style.flex = "1";
	tableContainer.style.overflow = "auto";
	tableContainer.style.border = "1px solid #555";
	tableContainer.style.borderRadius = "4px";

	var table = document.createElement("table");
	table.style.width = "100%";
	table.style.borderCollapse = "collapse";
	table.style.fontSize = "11px";

	var thead = document.createElement("thead");
	thead.innerHTML = '<tr style="background: #333; color: #fff; position: sticky; top: 0;">' +
		'<th style="padding: 4px 6px; text-align: left;">Name</th>' +
		'<th style="padding: 4px 6px; text-align: left;">Category</th>' +
		'<th style="padding: 4px 6px; text-align: left;">Type</th>' +
		'<th style="padding: 4px 6px; text-align: right;">Density</th>' +
		'<th style="padding: 4px 6px; text-align: center;">Color</th>' +
		"</tr>";
	table.appendChild(thead);

	var tbody = document.createElement("tbody");
	table.appendChild(tbody);
	tableContainer.appendChild(table);
	contentDiv.appendChild(tableContainer);

	// Action bar - uses floating-dialog-footer/btn styling for consistency
	// Placed inside content so dialog stays open during CRUD operations
	var actionBar = document.createElement("div");
	actionBar.className = "floating-dialog-footer";

	var addBtn = document.createElement("button");
	addBtn.textContent = "Add Product";
	addBtn.className = "floating-dialog-btn confirm";

	var editBtn = document.createElement("button");
	editBtn.textContent = "Edit";
	editBtn.className = "floating-dialog-btn";

	var deleteBtn = document.createElement("button");
	deleteBtn.textContent = "Delete";
	deleteBtn.className = "floating-dialog-btn";

	actionBar.appendChild(deleteBtn);
	actionBar.appendChild(editBtn);
	actionBar.appendChild(addBtn);
	contentDiv.appendChild(actionBar);

	// Second action bar: Import/Export/Clear operations
	var ioBar = document.createElement("div");
	ioBar.className = "floating-dialog-footer";
	ioBar.style.borderTop = "1px solid #555";
	ioBar.style.flexWrap = "wrap";
	ioBar.style.gap = "4px";

	var importBtn = document.createElement("button");
	importBtn.textContent = "Import";
	importBtn.className = "floating-dialog-btn";
	importBtn.title = "Import products & rules from ZIP";

	var exportBtn = document.createElement("button");
	exportBtn.textContent = "Export";
	exportBtn.className = "floating-dialog-btn";
	exportBtn.title = "Export current products & rules as ZIP";

	var exportTemplateBtn = document.createElement("button");
	exportTemplateBtn.textContent = "Export Template";
	exportTemplateBtn.className = "floating-dialog-btn";
	exportTemplateBtn.title = "Export blank config template ZIP";

	var clearProductsBtn = document.createElement("button");
	clearProductsBtn.textContent = "Clear Products";
	clearProductsBtn.className = "floating-dialog-btn";
	clearProductsBtn.title = "Remove all products";

	var clearRulesBtn = document.createElement("button");
	clearRulesBtn.textContent = "Clear Rules";
	clearRulesBtn.className = "floating-dialog-btn";
	clearRulesBtn.title = "Remove all charge rules";

	ioBar.appendChild(importBtn);
	ioBar.appendChild(exportBtn);
	ioBar.appendChild(exportTemplateBtn);
	ioBar.appendChild(clearProductsBtn);
	ioBar.appendChild(clearRulesBtn);
	contentDiv.appendChild(ioBar);

	var selectedProductID = null;

	function refreshTable() {
		tbody.innerHTML = "";
		productsMap = window.loadedProducts || new Map();
		productsMap.forEach(function (product, productID) {
			var row = document.createElement("tr");
			row.style.cursor = "pointer";
			row.style.borderBottom = "1px solid #444";
			row.setAttribute("data-product-id", productID);

			var isSelected = (productID === selectedProductID);

			row.innerHTML =
				'<td style="padding: 3px 6px;">' + (product.name || "") + "</td>" +
				'<td style="padding: 3px 6px;">' + (CATEGORY_LABELS[product.productCategory] || product.productCategory) + "</td>" +
				'<td style="padding: 3px 6px;">' + (product.productType || "") + "</td>" +
				'<td style="padding: 3px 6px; text-align: right;">' + (product.density != null ? product.density.toFixed(3) : "-") + "</td>" +
				'<td style="padding: 3px 6px; text-align: center;"><span style="display:inline-block;width:16px;height:16px;border-radius:2px;border:1px solid #999;background:' + (product.colorHex || "#ccc") + ';"></span></td>';

			if (isSelected) {
				var cells = row.querySelectorAll("td");
				for (var c = 0; c < cells.length; c++) {
					cells[c].style.setProperty("background-color", "#FF4455", "important");
					cells[c].style.setProperty("color", "#fff", "important");
				}
			}

			row.addEventListener("click", function () {
				selectedProductID = productID;
				refreshTable();
			});

			row.addEventListener("dblclick", function () {
				selectedProductID = productID;
				showEditProductDialog(product, function (updatedProduct) {
					productsMap.set(productID, updatedProduct);
					window.loadedProducts = productsMap;
					triggerProductSave();
					refreshTable();
				});
			});

			tbody.appendChild(row);
		});
	}

	refreshTable();

	// Button handlers - dialog stays open, sub-dialogs overlay on top
	addBtn.addEventListener("click", function () {
		showAddProductDialog(function (newProduct) {
			productsMap.set(newProduct.productID, newProduct);
			window.loadedProducts = productsMap;
			triggerProductSave();
			selectedProductID = newProduct.productID;
			refreshTable();
		});
	});

	editBtn.addEventListener("click", function () {
		if (!selectedProductID) return;
		var product = productsMap.get(selectedProductID);
		if (!product) return;
		showEditProductDialog(product, function (updatedProduct) {
			productsMap.set(selectedProductID, updatedProduct);
			window.loadedProducts = productsMap;
			triggerProductSave();
			refreshTable();
		});
	});

	deleteBtn.addEventListener("click", function () {
		if (!selectedProductID) return;
		var product = productsMap.get(selectedProductID);
		if (!product) return;
		showConfirmationDialog(
			"Delete Product",
			"Delete product '" + product.name + "'?",
			"Delete",
			"Cancel",
			function () {
				productsMap.delete(selectedProductID);
				window.loadedProducts = productsMap;
				triggerProductSave();
				selectedProductID = null;
				refreshTable();
			}
		);
	});

	// I/O button handlers
	importBtn.addEventListener("click", function () {
		var fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".zip";
		fileInput.style.display = "none";
		fileInput.addEventListener("change", async function () {
			if (!fileInput.files || fileInput.files.length === 0) return;
			try {
				var results = await importConfigFromZip(fileInput.files[0]);
				// Detect conflicts by name
				var productConflicts = detectConflicts(results.products, window.loadedProducts || new Map(), "name");
				var configConflicts = detectConflicts(results.configs, window.loadedChargeConfigs || new Map(), "configName");

				if (productConflicts.length > 0 || configConflicts.length > 0) {
					showImportConflictDialog(productConflicts, configConflicts, results, function () {
						refreshTable();
					});
				} else {
					// No conflicts - import directly
					applyImportResults(results);
					refreshTable();
				}
			} catch (err) {
				console.error("Error importing config:", err);
				showConfirmationDialog("Import Error", "Error importing config: " + err.message, "OK", null, null);
			}
			document.body.removeChild(fileInput);
		});
		document.body.appendChild(fileInput);
		fileInput.click();
	});

	exportBtn.addEventListener("click", function () {
		exportCurrentConfig(window.loadedProducts || new Map(), window.loadedChargeConfigs || new Map());
	});

	exportTemplateBtn.addEventListener("click", function () {
		exportBaseConfigTemplate();
	});

	clearProductsBtn.addEventListener("click", function () {
		var countBefore = (window.loadedProducts || new Map()).size;
		clearAllProducts();
		// Poll briefly to detect when products are actually cleared
		var checkInterval = setInterval(function () {
			var currentCount = (window.loadedProducts || new Map()).size;
			if (currentCount !== countBefore || currentCount === 0) {
				clearInterval(checkInterval);
				selectedProductID = null;
				refreshTable();
			}
		}, 200);
		// Safety timeout: stop polling after 10s
		setTimeout(function () { clearInterval(checkInterval); }, 10000);
	});

	clearRulesBtn.addEventListener("click", function () {
		clearAllChargeConfigs();
	});

	var dialog = new FloatingDialog({
		title: "Product Manager",
		content: contentDiv,
		width: 550,
		height: 400,
		showConfirm: false,
		showCancel: true,
		cancelText: "Close",
		draggable: true,
		resizable: true,
		layoutType: "default"
	});

	dialog.show();
	return dialog;
}

/**
 * Show dialog for adding a new product
 */
function showAddProductDialog(onSave) {
	var category = "NonExplosive";

	var contentDiv = document.createElement("div");
	contentDiv.style.display = "flex";
	contentDiv.style.flexDirection = "column";
	contentDiv.style.gap = "4px";

	// Category selector (changes available fields)
	var categoryFields = [
		{
			label: "Category",
			name: "productCategory",
			type: "select",
			value: category,
			options: [
				{ value: "NonExplosive", text: "Non-Explosive" },
				{ value: "BulkExplosive", text: "Bulk Explosive" },
				{ value: "HighExplosive", text: "High Explosive" },
				{ value: "Initiator", text: "Initiator" },
				{ value: "Spacer", text: "Spacer" }
			]
		}
	];

	var categoryForm = createEnhancedFormContent(categoryFields);
	contentDiv.appendChild(categoryForm);

	// Dynamic fields container
	var fieldsContainer = document.createElement("div");
	contentDiv.appendChild(fieldsContainer);

	function buildFields(cat, existingFormData) {
		fieldsContainer.innerHTML = "";
		var fields = getFieldsForCategory(cat, existingFormData);
		var form = createEnhancedFormContent(fields);
		fieldsContainer.appendChild(form);
		// For Initiator category, listen for initiatorType change to rebuild conditional fields
		if (cat === "Initiator") {
			var initSelect = form.querySelector('select[name="initiatorType"]');
			if (initSelect) {
				initSelect.addEventListener("change", function () {
					var currentData = getFormData(fieldsContainer);
					currentData.initiatorType = this.value;
					buildFields(cat, currentData);
				});
			}
		}
	}

	buildFields(category);

	// Listen for category change
	var catSelect = categoryForm.querySelector('select[name="productCategory"]');
	if (catSelect) {
		catSelect.addEventListener("change", function () {
			category = this.value;
			buildFields(category, null);
		});
	}

	var dialog = new FloatingDialog({
		title: "Add Product",
		content: contentDiv,
		width: 400,
		height: 530,
		showConfirm: true,
		showCancel: true,
		confirmText: "Add",
		draggable: true,
		resizable: true,
		layoutType: "default",
		onConfirm: function () {
			var catData = getFormData(categoryForm);
			var fieldData = getFormData(fieldsContainer);
			var merged = Object.assign({}, catData, fieldData);
			var product = createProductFromFormData(merged);
			dialog.close();
			if (onSave) onSave(product);
		}
	});

	dialog.show();
}

/**
 * Show dialog for editing an existing product
 */
function showEditProductDialog(product, onSave) {
	var json = product.toJSON();

	// Add category as read-only info
	var categoryLabel = document.createElement("div");
	categoryLabel.style.fontSize = "11px";
	categoryLabel.style.padding = "4px 0";
	categoryLabel.style.color = "#999";
	categoryLabel.textContent = "Category: " + (CATEGORY_LABELS[json.productCategory] || json.productCategory);

	// Dynamic fields container for initiatorType rebuild
	var fieldsContainer = document.createElement("div");

	function buildEditFields(data) {
		fieldsContainer.innerHTML = "";
		var fields = getFieldsForCategory(json.productCategory, data);
		var form = createEnhancedFormContent(fields);
		fieldsContainer.appendChild(form);
		// For Initiator category, listen for initiatorType change
		if (json.productCategory === "Initiator") {
			var initSelect = form.querySelector('select[name="initiatorType"]');
			if (initSelect) {
				initSelect.addEventListener("change", function () {
					var currentData = getFormData(fieldsContainer);
					currentData.initiatorType = this.value;
					// Merge with original JSON to preserve fields not in current form
					// (e.g. delayMs, minDelayMs, coreLoadGramsPerMeter)
					var mergedData = Object.assign({}, json, currentData);
					buildEditFields(mergedData);
				});
			}
		}
	}

	buildEditFields(json);

	var contentDiv = document.createElement("div");
	contentDiv.appendChild(categoryLabel);
	contentDiv.appendChild(fieldsContainer);

	var dialog = new FloatingDialog({
		title: "Edit Product: " + product.name,
		content: contentDiv,
		width: 400,
		height: 530,
		showConfirm: true,
		showCancel: true,
		confirmText: "Save",
		draggable: true,
		resizable: true,
		layoutType: "default",
		onConfirm: function () {
			var formData = getFormData(fieldsContainer);
			formData.productCategory = json.productCategory;
			formData.productID = json.productID;
			formData.created = json.created;
			var updatedProduct = createProductFromFormData(formData);
			dialog.close();
			if (onSave) onSave(updatedProduct);
		}
	});

	dialog.show();
}

/**
 * Get form field definitions for a product category
 */
function getFieldsForCategory(category, existingData) {
	var d = existingData || {};
	var typeOptions = (PRODUCT_TYPE_OPTIONS[category] || []).map(function (t) {
		return { value: t, text: t };
	});

	// Common fields
	var fields = [
		{ label: "Type", name: "productType", type: "select", value: d.productType || "", options: typeOptions },
		{ label: "Name", name: "name", type: "text", value: d.name || "" },
		{ label: "Supplier", name: "supplier", type: "text", value: d.supplier || "" },
		{ label: "Density (g/cc)", name: "density", type: "number", value: d.density || "", step: "0.001" },
		{ label: "Color", name: "colorHex", type: "color", value: d.colorHex || "#CCCCCC" },
		{ label: "Description", name: "description", type: "text", value: d.description || "" }
	];

	// Category-specific fields
	if (category === "NonExplosive") {
		fields.push({ label: "Particle Size (mm)", name: "particleSizeMm", type: "number", value: d.particleSizeMm || "", step: "0.1" });
	} else if (category === "BulkExplosive") {
		fields.push(
			{ label: "Compressible", name: "isCompressible", type: "checkbox", checked: d.isCompressible || false },
			{ label: "Min Density (g/cc)", name: "minDensity", type: "number", value: d.minDensity || "", step: "0.01" },
			{ label: "Max Density (g/cc)", name: "maxDensity", type: "number", value: d.maxDensity || "", step: "0.01" },
			{ label: "Limiting Density (g/cc)", name: "limitingDensity", type: "number", value: d.limitingDensity || "", step: "0.01" },
			{ label: "Critical Density (g/cc)", name: "criticalDensity", type: "number", value: d.criticalDensity || "", step: "0.01" },
			{ label: "VOD (m/s)", name: "vodMs", type: "number", value: d.vodMs || "", step: "1" },
			{ label: "RE (kJ/kg)", name: "reKjKg", type: "number", value: d.reKjKg || "", step: "1" },
			{ label: "RWS (%)", name: "rws", type: "number", value: d.rws || "", step: "1" },
			{ label: "Water Resistant", name: "waterResistant", type: "checkbox", checked: d.waterResistant || false }
		);
	} else if (category === "HighExplosive") {
		fields.push(
			{ label: "Mass (grams)", name: "massGrams", type: "number", value: d.massGrams || "", step: "1" },
			{ label: "Diameter (mm)", name: "diameterMm", type: "number", value: d.diameterMm || "", step: "0.1" },
			{ label: "Length (mm)", name: "lengthMm", type: "number", value: d.lengthMm || "", step: "0.1" },
			{ label: "VOD (m/s)", name: "vodMs", type: "number", value: d.vodMs || "", step: "1" },
			{ label: "RE (kJ/kg)", name: "reKjKg", type: "number", value: d.reKjKg || "", step: "1" },
			{ label: "Water Resistant", name: "waterResistant", type: "checkbox", checked: d.waterResistant || false },
			{ label: "Cap Sensitive", name: "capSensitive", type: "checkbox", checked: d.capSensitive || false }
		);
	} else if (category === "Initiator") {
		var initType = d.initiatorType || "Electronic";
		fields.push(
			{
				label: "Initiator Type", name: "initiatorType", type: "select", value: initType, options: [
					{ value: "Electronic", text: "Electronic" },
					{ value: "ShockTube", text: "Shock Tube" },
					{ value: "Electric", text: "Electric" },
					{ value: "DetonatingCord", text: "Detonating Cord" },
					{ value: "SurfaceConnector", text: "Surface Connector" },
					{ value: "SurfaceWire", text: "Surface Wire" },
					{ value: "SurfaceCord", text: "Surface Cord" }
				]
			},
			{ label: "Delivery VOD (m/s)", name: "deliveryVodMs", type: "number", value: d.deliveryVodMs != null ? d.deliveryVodMs : "", step: "1" }
		);
		// Programmable delay fields: Electronic and SurfaceWire only
		if (initType === "Electronic" || initType === "SurfaceWire") {
			fields.push(
				{ label: "Min Delay (ms)", name: "minDelayMs", type: "number", value: d.minDelayMs != null ? d.minDelayMs : "", step: "1" },
				{ label: "Max Delay (ms)", name: "maxDelayMs", type: "number", value: d.maxDelayMs || "", step: "1" },
				{ label: "Delay Inc. (ms)", name: "delayIncrementMs", type: "number", value: d.delayIncrementMs || "", step: "0.1" }
			);
		}
		// Fixed delay: ShockTube, SurfaceConnector, SurfaceCord, Electric
		if (initType === "ShockTube" || initType === "SurfaceConnector" || initType === "SurfaceCord" || initType === "Electric") {
			fields.push(
				{ label: "Delay (ms)", name: "delayMs", type: "number", value: d.delayMs != null ? d.delayMs : "", step: "1" }
			);
		}
		// Core load: DetonatingCord only
		if (initType === "DetonatingCord") {
			fields.push(
				{ label: "Core Load (g/m)", name: "coreLoadGramsPerMeter", type: "number", value: d.coreLoadGramsPerMeter || "", step: "1" }
			);
		}
	} else if (category === "Spacer") {
		fields.push(
			{
				label: "Spacer Type", name: "spacerType", type: "select", value: d.spacerType || "GasBag", options: [
					{ value: "GasBag", text: "Gas Bag" },
					{ value: "StemCap", text: "Stem Cap" },
					{ value: "StemBrush", text: "Stem Brush" },
					{ value: "StemPlug", text: "Stem Plug" },
					{ value: "StemLock", text: "Stem Lock" }
				]
			},
			{ label: "Length (mm)", name: "lengthMm", type: "number", value: d.lengthMm || "", step: "0.1" },
			{ label: "Diameter (mm)", name: "diameterMm", type: "number", value: d.diameterMm || "", step: "0.1" }
		);
	}

	return fields;
}

/**
 * Create a product instance from form data
 */
function createProductFromFormData(data) {
	// Parse numeric fields
	var opts = {
		productID: data.productID || undefined,
		productCategory: data.productCategory,
		productType: data.productType,
		name: data.name,
		supplier: data.supplier,
		density: data.density ? parseFloat(data.density) : 0,
		colorHex: data.colorHex || "#CCCCCC",
		description: data.description || "",
		created: data.created || undefined
	};

	switch (data.productCategory) {
		case "NonExplosive":
			opts.particleSizeMm = data.particleSizeMm ? parseFloat(data.particleSizeMm) : null;
			return new NonExplosiveProduct(opts);

		case "BulkExplosive":
			opts.isCompressible = data.isCompressible === "true" || data.isCompressible === true;
			opts.minDensity = data.minDensity ? parseFloat(data.minDensity) : null;
			opts.maxDensity = data.maxDensity ? parseFloat(data.maxDensity) : null;
			opts.limitingDensity = data.limitingDensity ? parseFloat(data.limitingDensity) : null;
			opts.criticalDensity = data.criticalDensity ? parseFloat(data.criticalDensity) : null;
			opts.vodMs = data.vodMs ? parseFloat(data.vodMs) : null;
			opts.reKjKg = data.reKjKg ? parseFloat(data.reKjKg) : null;
			opts.rws = data.rws ? parseFloat(data.rws) : null;
			opts.waterResistant = data.waterResistant === "true" || data.waterResistant === true;
			return new BulkExplosiveProduct(opts);

		case "HighExplosive":
			opts.massGrams = data.massGrams ? parseFloat(data.massGrams) : null;
			opts.diameterMm = data.diameterMm ? parseFloat(data.diameterMm) : null;
			opts.lengthMm = data.lengthMm ? parseFloat(data.lengthMm) : null;
			opts.vodMs = data.vodMs ? parseFloat(data.vodMs) : null;
			opts.reKjKg = data.reKjKg ? parseFloat(data.reKjKg) : null;
			opts.waterResistant = data.waterResistant === "true" || data.waterResistant === true;
			opts.capSensitive = data.capSensitive === "true" || data.capSensitive === true;
			return new HighExplosiveProduct(opts);

		case "Initiator":
			opts.initiatorType = data.initiatorType || "Electronic";
			opts.deliveryVodMs = data.deliveryVodMs != null && data.deliveryVodMs !== "" ? parseFloat(data.deliveryVodMs) : 0;
			opts.shellDiameterMm = data.shellDiameterMm ? parseFloat(data.shellDiameterMm) : 7.6;
			opts.shellLengthMm = data.shellLengthMm ? parseFloat(data.shellLengthMm) : 98;
			opts.minDelayMs = data.minDelayMs !== "" && data.minDelayMs != null ? parseFloat(data.minDelayMs) : 0;
			opts.maxDelayMs = data.maxDelayMs ? parseFloat(data.maxDelayMs) : null;
			opts.delayIncrementMs = data.delayIncrementMs ? parseFloat(data.delayIncrementMs) : null;
			opts.coreLoadGramsPerMeter = data.coreLoadGramsPerMeter ? parseFloat(data.coreLoadGramsPerMeter) : null;
			opts.delayMs = data.delayMs != null && data.delayMs !== "" ? parseFloat(data.delayMs) : null;
			// Create correct subclass based on initiatorType
			// SurfaceConnector/SurfaceCord use ShockTubeDetonator; SurfaceWire uses ElectronicDetonator
			switch (opts.initiatorType) {
				case "Electronic": return new ElectronicDetonator(opts);
				case "ShockTube": return new ShockTubeDetonator(opts);
				case "Electric": return new ElectricDetonator(opts);
				case "DetonatingCord": return new DetonatingCordProduct(opts);
				case "SurfaceConnector":
				case "SurfaceCord": {
					var p = new ShockTubeDetonator(opts);
					p.initiatorType = opts.initiatorType;
					return p;
				}
				case "SurfaceWire": {
					var p = new ElectronicDetonator(opts);
					p.initiatorType = "SurfaceWire";
					return p;
				}
				default: return new InitiatorProduct(opts);
			}

		case "Spacer":
			opts.spacerType = data.spacerType || "GasBag";
			opts.lengthMm = data.lengthMm ? parseFloat(data.lengthMm) : null;
			opts.diameterMm = data.diameterMm ? parseFloat(data.diameterMm) : null;
			return new SpacerProduct(opts);

		default:
			return new Product(opts);
	}
}

/**
 * Trigger debounced save of products via window function
 */
function triggerProductSave() {
	if (typeof window.debouncedSaveProducts === "function") {
		window.debouncedSaveProducts();
	}
	if (typeof window.buildSurfaceConnectorPresets === "function") {
		window.buildSurfaceConnectorPresets();
	}
}

// ============ IMPORT CONFLICT RESOLUTION ============

/**
 * Detect name-based conflicts between imported items and existing items.
 * @param {Array} importedItems - Array of imported products or configs
 * @param {Map} existingMap - Existing items map (productID/configID -> item)
 * @param {string} nameField - Field to match on ("name" for products, "configName" for configs)
 * @returns {Array<{imported, existing, existingKey}>} Array of conflicts
 */
function detectConflicts(importedItems, existingMap, nameField) {
	var conflicts = [];
	if (!importedItems || !existingMap || existingMap.size === 0) return conflicts;

	for (var i = 0; i < importedItems.length; i++) {
		var imported = importedItems[i];
		var importedName = imported[nameField];
		if (!importedName) continue;

		existingMap.forEach(function (existing, key) {
			if (existing[nameField] === importedName) {
				conflicts.push({ imported: imported, existing: existing, existingKey: key });
			}
		});
	}
	return conflicts;
}

/**
 * Show conflict resolution dialog for import.
 * Each conflict can be resolved as Update, Skip, or Copy.
 * @param {Array} productConflicts - Product name conflicts
 * @param {Array} configConflicts - Config name conflicts
 * @param {Object} results - Full import results { products, configs, errors }
 * @param {Function} onComplete - Called after resolution is applied
 */
function showImportConflictDialog(productConflicts, configConflicts, results, onComplete) {
	var allConflicts = [];
	for (var i = 0; i < productConflicts.length; i++) {
		allConflicts.push({ type: "product", nameField: "name", conflict: productConflicts[i] });
	}
	for (var j = 0; j < configConflicts.length; j++) {
		allConflicts.push({ type: "config", nameField: "configName", conflict: configConflicts[j] });
	}

	var contentDiv = document.createElement("div");
	contentDiv.style.display = "flex";
	contentDiv.style.flexDirection = "column";
	contentDiv.style.gap = "8px";

	// Summary
	var summary = document.createElement("div");
	summary.style.fontSize = "12px";
	summary.style.padding = "4px";
	summary.textContent = allConflicts.length + " item(s) already exist by name. Choose how to handle each:";
	contentDiv.appendChild(summary);

	// Apply-to-all bar
	var applyAllBar = document.createElement("div");
	applyAllBar.style.display = "flex";
	applyAllBar.style.gap = "6px";
	applyAllBar.style.padding = "4px 0";

	var applyAllLabel = document.createElement("span");
	applyAllLabel.style.fontSize = "11px";
	applyAllLabel.style.lineHeight = "24px";
	applyAllLabel.textContent = "Apply to all:";
	applyAllBar.appendChild(applyAllLabel);

	var allUpdateBtn = document.createElement("button");
	allUpdateBtn.textContent = "Update All";
	allUpdateBtn.className = "floating-dialog-btn";
	allUpdateBtn.style.fontSize = "10px";
	allUpdateBtn.style.padding = "2px 8px";

	var allSkipBtn = document.createElement("button");
	allSkipBtn.textContent = "Skip All";
	allSkipBtn.className = "floating-dialog-btn";
	allSkipBtn.style.fontSize = "10px";
	allSkipBtn.style.padding = "2px 8px";

	var allCopyBtn = document.createElement("button");
	allCopyBtn.textContent = "Copy All";
	allCopyBtn.className = "floating-dialog-btn";
	allCopyBtn.style.fontSize = "10px";
	allCopyBtn.style.padding = "2px 8px";

	applyAllBar.appendChild(allUpdateBtn);
	applyAllBar.appendChild(allSkipBtn);
	applyAllBar.appendChild(allCopyBtn);
	contentDiv.appendChild(applyAllBar);

	// Scrollable conflict table
	var tableContainer = document.createElement("div");
	tableContainer.style.flex = "1";
	tableContainer.style.overflow = "auto";
	tableContainer.style.border = "1px solid #555";
	tableContainer.style.borderRadius = "4px";
	tableContainer.style.maxHeight = "300px";

	var table = document.createElement("table");
	table.style.width = "100%";
	table.style.borderCollapse = "collapse";
	table.style.fontSize = "11px";

	var thead = document.createElement("thead");
	thead.innerHTML = '<tr style="background: #333; color: #fff; position: sticky; top: 0;">' +
		'<th style="padding: 4px 6px; text-align: left;">Type</th>' +
		'<th style="padding: 4px 6px; text-align: left;">Name</th>' +
		'<th style="padding: 4px 6px; text-align: left;">Resolution</th>' +
		"</tr>";
	table.appendChild(thead);

	var tbody = document.createElement("tbody");
	var selects = [];

	for (var k = 0; k < allConflicts.length; k++) {
		var entry = allConflicts[k];
		var name = entry.conflict.imported[entry.nameField] || "Unknown";
		var row = document.createElement("tr");
		row.style.borderBottom = "1px solid #444";

		var typeCell = document.createElement("td");
		typeCell.style.padding = "3px 6px";
		typeCell.textContent = entry.type === "product" ? "Product" : "Config";
		row.appendChild(typeCell);

		var nameCell = document.createElement("td");
		nameCell.style.padding = "3px 6px";
		nameCell.textContent = name;
		row.appendChild(nameCell);

		var selectCell = document.createElement("td");
		selectCell.style.padding = "3px 6px";
		var select = document.createElement("select");
		select.style.fontSize = "11px";
		select.style.width = "100%";
		select.innerHTML = '<option value="update">Update (overwrite)</option>' +
			'<option value="skip">Skip (don\'t import)</option>' +
			'<option value="copy">Copy (import with suffix)</option>';
		selectCell.appendChild(select);
		row.appendChild(selectCell);

		tbody.appendChild(row);
		selects.push(select);
	}
	table.appendChild(tbody);
	tableContainer.appendChild(table);
	contentDiv.appendChild(tableContainer);

	// Apply-to-all handlers
	allUpdateBtn.addEventListener("click", function () {
		for (var s = 0; s < selects.length; s++) selects[s].value = "update";
	});
	allSkipBtn.addEventListener("click", function () {
		for (var s = 0; s < selects.length; s++) selects[s].value = "skip";
	});
	allCopyBtn.addEventListener("click", function () {
		for (var s = 0; s < selects.length; s++) selects[s].value = "copy";
	});

	var dialog = new FloatingDialog({
		title: "Import Conflicts",
		content: contentDiv,
		width: 500,
		height: 450,
		showConfirm: true,
		confirmText: "Import",
		showCancel: true,
		cancelText: "Cancel",
		draggable: true,
		resizable: true,
		layoutType: "default",
		onConfirm: function () {
			// Build resolution map: index -> "update"|"skip"|"copy"
			var resolutions = [];
			for (var r = 0; r < selects.length; r++) {
				resolutions.push(selects[r].value);
			}

			// Build sets of conflicting imported item names to exclude from direct import
			var conflictProductNames = new Set();
			var conflictConfigNames = new Set();

			for (var c = 0; c < allConflicts.length; c++) {
				var entry = allConflicts[c];
				var resolution = resolutions[c];
				var imported = entry.conflict.imported;
				var existingKey = entry.conflict.existingKey;

				if (entry.type === "product") {
					conflictProductNames.add(imported.name);
					if (resolution === "update") {
						// Overwrite existing by key
						(window.loadedProducts || new Map()).set(existingKey, imported);
					} else if (resolution === "copy") {
						// Import with suffix
						var copyName = findUniqueName(imported.name, window.loadedProducts || new Map(), "name");
						imported.name = copyName;
						imported.productID = imported.productID + "_copy_" + Date.now();
						(window.loadedProducts || new Map()).set(imported.productID, imported);
					}
					// "skip" = do nothing
				} else {
					conflictConfigNames.add(imported.configName);
					if (resolution === "update") {
						(window.loadedChargeConfigs || new Map()).set(existingKey, imported);
					} else if (resolution === "copy") {
						var copyCName = findUniqueName(imported.configName, window.loadedChargeConfigs || new Map(), "configName");
						imported.configName = copyCName;
						imported.configID = imported.configID + "_copy_" + Date.now();
						(window.loadedChargeConfigs || new Map()).set(imported.configID, imported);
					}
				}
			}

			// Now import non-conflicting items directly
			var prodMap = window.loadedProducts || new Map();
			for (var p = 0; p < results.products.length; p++) {
				var prod = results.products[p];
				if (!conflictProductNames.has(prod.name)) {
					prodMap.set(prod.productID, prod);
				}
			}
			window.loadedProducts = prodMap;

			var cfgMap = window.loadedChargeConfigs || new Map();
			for (var q = 0; q < results.configs.length; q++) {
				var cfg = results.configs[q];
				if (!conflictConfigNames.has(cfg.configName)) {
					cfgMap.set(cfg.configID, cfg);
				}
			}
			window.loadedChargeConfigs = cfgMap;

			// Save
			if (typeof window.debouncedSaveProducts === "function") window.debouncedSaveProducts();
			if (typeof window.debouncedSaveConfigs === "function") window.debouncedSaveConfigs();
			if (typeof window.buildSurfaceConnectorPresets === "function") window.buildSurfaceConnectorPresets();

			dialog.close();
			if (onComplete) onComplete();
		}
	});
	dialog.show();
}

/**
 * Find a unique name by appending {N} suffix.
 * @param {string} baseName - Original name
 * @param {Map} existingMap - Map of existing items
 * @param {string} nameField - Field to check ("name" or "configName")
 * @returns {string} Unique name
 */
function findUniqueName(baseName, existingMap, nameField) {
	var existingNames = new Set();
	existingMap.forEach(function (item) {
		existingNames.add(item[nameField]);
	});

	var counter = 1;
	var candidate = baseName + " {" + counter + "}";
	while (existingNames.has(candidate)) {
		counter++;
		candidate = baseName + " {" + counter + "}";
	}
	return candidate;
}

/**
 * Apply import results directly (no conflicts).
 * @param {Object} results - { products, configs, errors }
 */
function applyImportResults(results) {
	var prodMap = window.loadedProducts || new Map();
	for (var i = 0; i < results.products.length; i++) {
		var product = results.products[i];
		prodMap.set(product.productID, product);
	}
	window.loadedProducts = prodMap;

	var cfgMap = window.loadedChargeConfigs || new Map();
	for (var j = 0; j < results.configs.length; j++) {
		var config = results.configs[j];
		cfgMap.set(config.configID, config);
	}
	window.loadedChargeConfigs = cfgMap;

	if (typeof window.debouncedSaveProducts === "function") window.debouncedSaveProducts();
	if (typeof window.debouncedSaveConfigs === "function") window.debouncedSaveConfigs();
	if (typeof window.buildSurfaceConnectorPresets === "function") window.buildSurfaceConnectorPresets();

	var msg = "Imported " + results.products.length + " products and " + results.configs.length + " configs.";
	if (results.errors.length > 0) {
		msg += "\nWarnings: " + results.errors.join(", ");
	}
	if (typeof window.showModalMessage === "function") {
		window.showModalMessage("Import Complete", msg, "success");
	}
}
