/**
 * @fileoverview KAP (Kirra Application Project) Parser
 * Imports a .kap ZIP archive and restores the full project state.
 *
 * Import flow:
 *   1. Read ZIP file
 *   2. Parse manifest.json for version check
 *   3. Clear existing data (clearAllDataStructures)
 *   4. Restore all data: holes, drawings, surfaces, images, charging, layers
 *   5. Rebuild 3D meshes for textured surfaces
 *   6. Trigger refresh: calculateTimes, drawData, updateTreeView, centroid recalculation
 *   7. Save all to IndexedDB
 */

import BaseParser from "../BaseParser.js";
import JSZip from "jszip";
import { KAP_VERSION } from "../../charging/ChargingConstants.js";
import { createProductFromJSON } from "../../charging/products/productFactory.js";
import { HoleCharging, chargingKey } from "../../charging/HoleCharging.js";
import { ChargeConfig } from "../../charging/ChargeConfig.js";

class KAPParser extends BaseParser {
	constructor(options) {
		super(options || {});
	}

	/**
	 * Parse a .kap ZIP file and restore project state
	 * @param {File} file - The .kap file
	 * @returns {Promise<Object>} Import summary
	 */
	async parse(file) {
		var zip = await JSZip.loadAsync(file);
		var summary = { holes: 0, drawings: 0, surfaces: 0, images: 0, products: 0, charging: 0, configs: 0, errors: [] };

		// ============ MANIFEST ============
		var manifest = null;
		var manifestFile = zip.file("manifest.json");
		if (manifestFile) {
			try {
				manifest = JSON.parse(await manifestFile.async("string"));
				console.log("KAP manifest: version=" + manifest.kapVersion + ", project=" + manifest.projectName);
			} catch (err) {
				summary.errors.push("Failed to parse manifest: " + err.message);
			}
		}

		// ============ COORDINATE DELTA CHECK ============
		// Pre-parse KAP contents to compute incoming centroid for coordinate delta warning
		var kapHoles = [];
		var kapKad = [];
		var kapSurfaces = [];
		var holesFilePre = zip.file("holes.json");
		if (holesFilePre) {
			try {
				var hd = JSON.parse(await holesFilePre.async("string"));
				if (Array.isArray(hd)) kapHoles = hd;
			} catch (e) { /* ignore */ }
		}
		var drawingsFilePre = zip.file("drawings.json");
		if (drawingsFilePre) {
			try {
				var dd = JSON.parse(await drawingsFilePre.async("string"));
				if (Array.isArray(dd)) kapKad = dd.map(function (kv) { return kv[1]; }).filter(Boolean);
			} catch (e) { /* ignore */ }
		}
		var surfacesFilePre = zip.file("surfaces.json");
		if (surfacesFilePre) {
			try {
				var sd = JSON.parse(await surfacesFilePre.async("string"));
				if (Array.isArray(sd)) kapSurfaces = sd;
			} catch (e) { /* ignore */ }
		}
		var kapIncoming = { holes: kapHoles, kadEntities: kapKad, surfaces: kapSurfaces };
		if (typeof window.checkCoordinateDeltaBeforeImport === "function") {
			var hasAnyIncoming = kapHoles.length > 0 || kapKad.length > 0 || kapSurfaces.length > 0;
			if (hasAnyIncoming) {
				var proceedKap = await window.checkCoordinateDeltaBeforeImport(kapIncoming, file.name || "KAP");
				if (!proceedKap) {
					throw new Error("KAP import cancelled by user (coordinate delta warning)");
				}
				// Step 1) Clean & Replace: wipe data first so hasExistingData is false; Import KAP dialog is skipped
				if (proceedKap === "cleanReplace" && typeof window.performCleanAndReplaceBeforeImport === "function") {
					await window.performCleanAndReplaceBeforeImport();
				}
			}
		}

		// ============ CLEAR EXISTING DATA ============
		// CRITICAL: Set flag to prevent debounced saves during import
		window._kapImporting = true;

		// Flush any pending debounced saves to prevent stale data overwriting new import
		if (typeof window.clearAllPendingTimers === "function") {
			window.clearAllPendingTimers();
		}

		// Check if user has existing data (allKADDrawingsMap is the KAD store; loadedKADs is legacy alias)
		var hasExistingData =
			(window.allBlastHoles && window.allBlastHoles.length > 0) ||
			(window.loadedSurfaces && window.loadedSurfaces.size > 0) ||
			((window.allKADDrawingsMap && window.allKADDrawingsMap.size > 0) || (window.loadedKADs && window.loadedKADs.size > 0)) ||
			(window.loadedImages && window.loadedImages.size > 0);

		var shouldMerge = false;

		if (hasExistingData) {
			// Show dialog: Merge or Replace?
			shouldMerge = await this._showMergeReplaceDialog();

			if (shouldMerge) {
				console.log("Merging imported data with existing data");
				// Don't clear data structures - will merge below
			} else {
				console.log("Replacing all existing data - wiping IndexedDB stores then memory");
				// Step 1) Wipe IndexedDB stores first so replace = clean import
				if (typeof window.clearAllIndexedDBStoresForKAPReplace === "function") {
					await window.clearAllIndexedDBStoresForKAPReplace();
				}
				// Step 2) Clear in-memory structures
				if (typeof window.clearAllDataStructures === "function") {
					window.clearAllDataStructures();
				}
				// Step 3) Force 3D rebuild so scene reflects cleared state and new import
				window.threeDataNeedsRebuild = true;
			}
		} else {
			// No existing data, just clear to be safe
			if (typeof window.clearAllDataStructures === "function") {
				window.clearAllDataStructures();
			}
		}

		// Clear 3D scene objects
		if (window.threeRenderer && window.threeRenderer.surfaceMeshMap) {
			window.threeRenderer.surfaceMeshMap.forEach(function(mesh, id) {
				window.threeRenderer.scene.remove(mesh);
			});
			window.threeRenderer.surfaceMeshMap.clear();
		}

		// ============ BLAST HOLES ============
		var holesFile = zip.file("holes.json");
		if (holesFile) {
			try {
				var holesData = JSON.parse(await holesFile.async("string"));
				if (Array.isArray(holesData)) {
					// Push into existing array to maintain reference identity with module-scoped variable
					// (replacing with = would break the link between window.allBlastHoles and kirra.js internal allBlastHoles)
					if (!shouldMerge) {
						// Replace mode: clear existing holes
						window.allBlastHoles.length = 0;
					}

					// Build set of existing hole IDs for merge mode
					var existingHoleIds = new Set();
					if (shouldMerge) {
						for (var ehi = 0; ehi < window.allBlastHoles.length; ehi++) {
							if (window.allBlastHoles[ehi].holeID) {
								existingHoleIds.add(window.allBlastHoles[ehi].holeID);
							}
						}
					}

					// Add imported holes (skip duplicates in merge mode)
					var addedCount = 0;
					var skippedCount = 0;
					for (var hi = 0; hi < holesData.length; hi++) {
						var hole = holesData[hi];
						if (shouldMerge && hole.holeID && existingHoleIds.has(hole.holeID)) {
							skippedCount++;
							continue; // Skip duplicate
						}
						window.allBlastHoles.push(hole);
						addedCount++;
					}

					summary.holes = addedCount;
					if (shouldMerge && skippedCount > 0) {
						console.log("Merged holes: added " + addedCount + ", skipped " + skippedCount + " duplicates");
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse holes: " + err.message);
			}
		}

		// ============ KAD DRAWINGS ============
		var drawingsFile = zip.file("drawings.json");
		if (drawingsFile) {
			try {
				var drawingsData = JSON.parse(await drawingsFile.async("string"));
				if (Array.isArray(drawingsData)) {
					// Clear and repopulate existing map to maintain reference identity with module-scoped variable
					if (!shouldMerge) {
						// Replace mode: clear existing drawings
						window.allKADDrawingsMap.clear();
					}

					var tempMap = new Map(drawingsData);
					var addedCount = 0;
					var skippedCount = 0;
					tempMap.forEach(function(value, key) {
						if (shouldMerge && window.allKADDrawingsMap.has(key)) {
							skippedCount++;
							return; // Skip duplicate key
						}
						window.allKADDrawingsMap.set(key, value);
						addedCount++;
					});

					summary.drawings = shouldMerge ? addedCount : window.allKADDrawingsMap.size;
					if (shouldMerge && skippedCount > 0) {
						console.log("Merged KAD drawings: added " + addedCount + ", skipped " + skippedCount + " duplicates");
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse drawings: " + err.message);
			}
		}

		// ============ SURFACES ============
		var surfacesFile = zip.file("surfaces.json");
		if (surfacesFile) {
			try {
				var surfacesData = JSON.parse(await surfacesFile.async("string"));
				var texturedSurfaceIds = [];

				for (var si = 0; si < surfacesData.length; si++) {
					var sd = surfacesData[si];
					var surfaceEntry = {
						id: sd.id,
						name: sd.name,
						type: sd.type || "triangulated",
						points: sd.points,
						triangles: sd.triangles,
						visible: sd.visible !== false,
						gradient: sd.isTexturedMesh ? "texture" : (sd.gradient || "default"),
						transparency: (sd.transparency !== undefined && sd.transparency !== null) ? sd.transparency : 1.0,
						hillshadeColor: sd.hillshadeColor || null,
						minLimit: sd.minLimit || null,
						maxLimit: sd.maxLimit || null,
						layerId: sd.layerId || null,
						created: sd.created || null,
						metadata: sd.metadata || {},
						isTexturedMesh: sd.isTexturedMesh || false,
						meshBounds: sd.meshBounds || null,
						// Restore flattened image properties (if surface was flattened before export)
						flattenedImageDataURL: sd.flattenedImageDataURL || null,
						flattenedImageBounds: sd.flattenedImageBounds || null,
						flattenedImageDimensions: sd.flattenedImageDimensions || null
					};

					// Restore textured mesh data
					if (sd.isTexturedMesh) {
						console.log("📦 KAP IMPORT: Found textured surface: " + sd.id + " - has OBJ=" + !!sd.objContent + ", has MTL=" + !!sd.mtlContent);
						console.log("📦 KAP IMPORT: materialProperties from JSON: " +
							(sd.materialProperties ? Object.keys(sd.materialProperties).length + " materials" : "NULL"));
						surfaceEntry.objContent = sd.objContent || null;
						surfaceEntry.mtlContent = sd.mtlContent || null;
						surfaceEntry.materialProperties = sd.materialProperties || null;
						surfaceEntry.textureFileNames = sd.textureFileNames || null; // CRITICAL: Must copy for rebuild validation
						surfaceEntry.textureFolderKey = sd.textureFolderKey || null;  // CRITICAL: Must copy for rebuild
						surfaceEntry.threeJSMesh = null; // Will be rebuilt

						// Restore texture blobs from ZIP
						if (sd.textureFileNames && sd.textureFolderKey) {
							console.log("📦 KAP IMPORT: Loading " + sd.textureFileNames.length + " texture(s) from folder: " + sd.textureFolderKey);
							surfaceEntry.textureBlobs = {};
							for (var ti = 0; ti < sd.textureFileNames.length; ti++) {
								var texName = sd.textureFileNames[ti];
								var texPath = "textures/" + sd.textureFolderKey + "/" + texName;
								var texFile = zip.file(texPath);
								if (texFile) {
									surfaceEntry.textureBlobs[texName] = await texFile.async("blob");
									console.log("📦 KAP IMPORT: Loaded texture blob: " + texName + " (" + surfaceEntry.textureBlobs[texName].size + " bytes)");
								} else {
									console.warn("📦 KAP IMPORT: Texture file not found in ZIP: " + texPath);
								}
							}
						} else {
							console.warn("📦 KAP IMPORT: Missing textureFileNames or textureFolderKey for: " + sd.id);
						}

						texturedSurfaceIds.push(sd.id);
					}

					// Check for duplicates in merge mode
					if (shouldMerge && window.loadedSurfaces.has(sd.id)) {
						console.log("Skipping duplicate surface: " + sd.id);
						continue; // Skip duplicate surface
					}

					window.loadedSurfaces.set(sd.id, surfaceEntry);
					summary.surfaces++;
				}

				// Rebuild textured meshes - CRITICAL: await all rebuilds before continuing
				if (texturedSurfaceIds.length > 0 && typeof window.rebuildTexturedMesh === "function") {
					console.log("📦 KAP IMPORT: Starting rebuild of " + texturedSurfaceIds.length + " textured surface(s)");
					var rebuildPromises = [];
					for (var i = 0; i < texturedSurfaceIds.length; i++) {
						var surfaceId = texturedSurfaceIds[i];
						var surface = window.loadedSurfaces.get(surfaceId);
						console.log("📦 KAP IMPORT: Processing textured surface: " + surfaceId);
						console.log("📦 KAP IMPORT: Surface has materialProperties: " +
							(surface.materialProperties ? Object.keys(surface.materialProperties).length + " materials" : "NULL"));

						// Validate required texture data exists
						if (!surface.textureFileNames || surface.textureFileNames.length === 0) {
							console.warn("Surface missing textureFileNames: " + surfaceId);
							continue;
						}
						if (!surface.textureBlobs || Object.keys(surface.textureBlobs).length === 0) {
							console.warn("Surface missing texture blobs: " + surfaceId);
							continue;
						}

						// Rebuild asynchronously but track promise
						var rebuildPromise = window.rebuildTexturedMesh(surfaceId).then(function(sid) {
							console.log("Rebuilt textured mesh: " + sid);
							return sid;
						}).catch(function(err) {
							console.error("Failed to rebuild textured mesh: " + surfaceId, err);
							return null;
						});

						rebuildPromises.push(rebuildPromise);
					}

					// WAIT for all rebuilds BEFORE continuing
					await Promise.all(rebuildPromises);
					console.log("✅ KAP IMPORT: All textured meshes rebuilt (" + rebuildPromises.length + " surfaces)");

					// Diagnostic: Check final surface states
					for (var j = 0; j < texturedSurfaceIds.length; j++) {
						var sid = texturedSurfaceIds[j];
						var surf = window.loadedSurfaces.get(sid);
						if (surf) {
							console.log("📊 Surface state: " + sid + " - gradient=" + surf.gradient + ", visible=" + surf.visible + ", hasMesh=" + !!surf.threeJSMesh);
						}
					}
				}

				// Restore flattened images from surface data (if present)
				for (var si = 0; si < surfacesData.length; si++) {
					var sd = surfacesData[si];
					if (sd.flattenedImageDataURL && sd.flattenedImageBounds && sd.flattenedImageDimensions) {
						console.log("🖼️ Restoring flattened image for surface: " + sd.id);
						try {
							await restoreFlattenedImageFromDataURL(
								sd.id,
								sd.flattenedImageDataURL,
								sd.flattenedImageBounds,
								sd.flattenedImageDimensions
							);
							summary.images++; // Count restored flattened images
						} catch (flatErr) {
							console.warn("Failed to restore flattened image for " + sd.id + ": " + flatErr.message);
							summary.errors.push("Flattened image restore failed: " + sd.id);
						}
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse surfaces: " + err.message);
			}
		}

		// ============ IMAGES ============
		var imagesFile = zip.file("images.json");
		if (imagesFile) {
			try {
				var imagesData = JSON.parse(await imagesFile.async("string"));

				for (var ii = 0; ii < imagesData.length; ii++) {
					var imgRecord = imagesData[ii];

					// Check for duplicates in merge mode
					if (shouldMerge && window.loadedImages && window.loadedImages.has(imgRecord.id)) {
						console.log("Skipping duplicate image: " + imgRecord.id);
						continue; // Skip duplicate image
					}

					// Restore image blob from ZIP
					var imgBlob = null;
					if (imgRecord.blobFileName) {
						var imgBlobFile = zip.file("images/" + imgRecord.blobFileName);
						if (imgBlobFile) {
							imgBlob = await imgBlobFile.async("blob");
						}
					}

					if (imgBlob) {
						// Reconstruct canvas from blob
						try {
							await restoreImageFromBlob(imgRecord, imgBlob);
							summary.images++;
						} catch (restoreErr) {
							console.warn("Failed to restore image blob: " + imgRecord.id, restoreErr);
							summary.errors.push("Image restore failed: " + imgRecord.id);
						}
					} else {
						// FIX 4: Warn when images are skipped due to missing blob
						console.warn("⚠️ Image skipped - no blob data in KAP file: " + imgRecord.id);
						summary.errors.push("Image missing blob data: " + imgRecord.id);
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse images: " + err.message);
			}
		}

		// ============ CHARGING: PRODUCTS ============
		var productsFile = zip.file("products.json");
		if (productsFile) {
			try {
				var productsData = JSON.parse(await productsFile.async("string"));
				if (Array.isArray(productsData)) {
					for (var pi = 0; pi < productsData.length; pi++) {
						var entry = productsData[pi];
						var productID = entry[0];
						var productJSON = entry[1];

						// Check for duplicates in merge mode
						if (shouldMerge && window.loadedProducts && window.loadedProducts.has(productID)) {
							console.log("Skipping duplicate product: " + productID);
							continue; // Skip duplicate product
						}

						try {
							var product = createProductFromJSON(productJSON);
							window.loadedProducts.set(productID, product);
							summary.products++;
						} catch (prodErr) {
							summary.errors.push("Product " + productID + ": " + prodErr.message);
						}
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse products: " + err.message);
			}
		}

		// ============ CHARGING: HOLE CHARGING ============
		var chargingFile = zip.file("charging.json");
		if (chargingFile) {
			try {
				var chargingData = JSON.parse(await chargingFile.async("string"));
				if (Array.isArray(chargingData)) {
					for (var ci = 0; ci < chargingData.length; ci++) {
						var cEntry = chargingData[ci];
						var storedKey = cEntry[0];
						var chargingJSON = cEntry[1];

						try {
							var holeCharging = HoleCharging.fromJSON(chargingJSON);
							// Migrate old plain-holeID keys to composite keys
							var key = storedKey;
							if (storedKey.indexOf(":::") === -1) {
								key = (holeCharging.entityName || "") + ":::" + (holeCharging.holeID || storedKey);
							}

							// Check for duplicates in merge mode
							if (shouldMerge && window.loadedCharging && window.loadedCharging.has(key)) {
								console.log("Skipping duplicate charging for key: " + key);
								continue; // Skip duplicate charging
							}

							window.loadedCharging.set(key, holeCharging);
							summary.charging++;
						} catch (chgErr) {
							summary.errors.push("Charging for key " + storedKey + ": " + chgErr.message);
						}
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse charging: " + err.message);
			}
		}

		// ============ CHARGING: CONFIGS ============
		var configsFile = zip.file("configs.json");
		if (configsFile) {
			try {
				var configsData = JSON.parse(await configsFile.async("string"));
				if (Array.isArray(configsData)) {
					for (var cfi = 0; cfi < configsData.length; cfi++) {
						var cfEntry = configsData[cfi];
						var configID = cfEntry[0];
						var configJSON = cfEntry[1];
						try {
							var config = ChargeConfig.fromJSON(configJSON);
							window.loadedChargeConfigs.set(configID, config);
							summary.configs++;
						} catch (cfgErr) {
							summary.errors.push("Config " + configID + ": " + cfgErr.message);
						}
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse configs: " + err.message);
			}
		}

		// ============ LAYERS ============
		var layersFile = zip.file("layers.json");
		if (layersFile) {
			try {
				var layersData = JSON.parse(await layersFile.async("string"));

				if (layersData.drawingLayers && window.allDrawingLayers) {
					window.allDrawingLayers.clear();
					for (var dli = 0; dli < layersData.drawingLayers.length; dli++) {
						var dl = layersData.drawingLayers[dli];
						dl.entities = new Set(dl.entities || []);
						window.allDrawingLayers.set(dl.layerId, dl);
					}
				}

				if (layersData.surfaceLayers && window.allSurfaceLayers) {
					window.allSurfaceLayers.clear();
					for (var sli = 0; sli < layersData.surfaceLayers.length; sli++) {
						var sl = layersData.surfaceLayers[sli];
						sl.entities = new Set(sl.entities || []);
						window.allSurfaceLayers.set(sl.layerId, sl);
					}
				}
			} catch (err) {
				summary.errors.push("Failed to parse layers: " + err.message);
			}
		}

		// ============ APPLY LAYER VISIBILITY TO ENTITIES ============
		// Layers are restored after surfaces/drawings, so propagate
		// layer.visible state to all child entities now.
		if (window.allDrawingLayers) {
			window.allDrawingLayers.forEach(function (layer) {
				if (layer.visible === false && layer.entities && window.allKADDrawingsMap) {
					layer.entities.forEach(function (entityName) {
						var entity = window.allKADDrawingsMap.get(entityName);
						if (entity) {
							entity.visible = false;
						}
					});
				}
			});
		}
		if (window.allSurfaceLayers) {
			window.allSurfaceLayers.forEach(function (layer) {
				if (layer.visible === false && layer.entities) {
					layer.entities.forEach(function (surfaceId) {
						if (window.loadedSurfaces && window.loadedSurfaces.has(surfaceId)) {
							window.loadedSurfaces.get(surfaceId).visible = false;
						}
					});
				}
			});
		}

		// ============ REFRESH APPLICATION STATE ============
		try {
			// Recalculate massPerHole from charging
			if (typeof window.recalcMassPerHole === "function") {
				window.recalcMassPerHole();
			}

			// Recalculate timing
			if (typeof window.calculateTimes === "function" && window.allBlastHoles.length > 0) {
				window.calculateTimes(window.allBlastHoles);
			}

			// Recalculate centroid
			if (typeof window.requestCentroidRecalculation === "function") {
				window.requestCentroidRecalculation();
			}

			// Redraw
			if (typeof window.drawData === "function") {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}

			// Update tree view
			if (typeof window.debouncedUpdateTreeView === "function") {
				window.debouncedUpdateTreeView();
			}

			// Reset view to fit new data (zoom and camera)
			if (typeof window.zoomToFitAll === "function") {
				window.zoomToFitAll();
			}

			// Save everything to IndexedDB immediately (not debounced) to prevent race conditions
			if (typeof window.saveHolesToDB === "function" && window.allBlastHoles) {
				window.saveHolesToDB(window.allBlastHoles);
			}
			if (typeof window.saveKADToDB === "function" && window.allKADDrawingsMap) {
				window.saveKADToDB(window.allKADDrawingsMap);
			}
			if (typeof window.saveLayersToDB === "function") {
				window.saveLayersToDB();
			}

			// Save surfaces to IndexedDB
			if (typeof window.saveSurfaceToDB === "function") {
				window.loadedSurfaces.forEach(function(surface, surfaceId) {
					window.saveSurfaceToDB(surfaceId);
				});
			}

			// Save images to IndexedDB
			if (typeof window.saveImageToDB === "function") {
				window.loadedImages.forEach(function(image, imageId) {
					window.saveImageToDB(imageId);
				});
			}

			// Save charging data immediately (not debounced) to prevent race conditions
			if (typeof window.saveProductsNow === "function") window.saveProductsNow();
			if (typeof window.saveChargingNow === "function") window.saveChargingNow();
			if (typeof window.saveConfigsNow === "function") window.saveConfigsNow();

			// CRITICAL: Re-enable debounced saves after import completes
			window._kapImporting = false;
			console.log("KAP import complete - debounced saves re-enabled");
		} catch (refreshErr) {
			summary.errors.push("Refresh error: " + refreshErr.message);
			// Re-enable even on error
			window._kapImporting = false;
		}

		summary.projectName = manifest ? manifest.projectName : file.name;
		return summary;
	}

	/**
	 * Show dialog to ask user whether to merge or replace existing data
	 * @returns {Promise<boolean>} true = merge, false = replace
	 */
	async _showMergeReplaceDialog() {
		return new Promise(function(resolve, reject) {
			// Dynamically import FloatingDialog if not available
			if (typeof window.FloatingDialog === "undefined") {
				// Try to load it
				import("../../dialog/FloatingDialog.js").then(function(module) {
					showDialog(module.FloatingDialog);
				}).catch(function() {
					// Fallback to window.confirm if FloatingDialog not available
					var result = window.confirm(
						"You have existing data in the project.\n\n" +
						"Click OK to MERGE imported data with existing data (skip duplicates).\n" +
						"Click Cancel to REPLACE all existing data with imported data."
					);
					resolve(result); // true = merge, false = replace
				});
			} else {
				showDialog(window.FloatingDialog);
			}

			function showDialog(FloatingDialogClass) {
				var contentHTML =
					"<div style='padding: 20px;'>" +
					"<p><strong>You have existing data in the project.</strong></p>" +
					"<p>How should the import proceed?</p>" +
					"<ul style='margin: 10px 0; padding-left: 20px;'>" +
					"<li><strong>Replace:</strong> Clear all existing data and load imported data</li>" +
					"<li><strong>Merge:</strong> Add imported data to existing (skip items with duplicate IDs)</li>" +
					"</ul>" +
					"<p style='margin-top: 15px; font-size: 0.9em; color: #666;'>" +
					"Tip: Choose Merge if you want to combine multiple KAP files." +
					"</p>" +
					"</div>";

				var dialog = new FloatingDialogClass({
					title: "Import KAP File",
					content: contentHTML,
					width: 500,
					height: 350,
					showConfirm: true,
					showCancel: true,
					showOption1: true,
					confirmText: "Merge",
					cancelText: "Cancel Import",
					option1Text: "Replace All",
					onConfirm: function() {
						resolve(true); // true = merge
					},
					onCancel: function() {
						reject(new Error("Import cancelled by user"));
					},
					onOption1: function() {
						resolve(false); // false = replace
					}
				});

				dialog.show();
			}
		});
	}
}

/**
 * Restore an image entry from blob data (reconstructs canvas)
 * CRITICAL: Fixed race condition - blob URL created before assignment, revoked only after validation
 */
/**
 * Restore a flattened image from dataURL saved in surface
 * @param {string} surfaceId - Original surface ID
 * @param {string} dataURL - Image data URL
 * @param {Object} bounds - {minX, maxX, minY, maxY}
 * @param {Object} dimensions - {width, height}
 * @returns {Promise<void>}
 */
function restoreFlattenedImageFromDataURL(surfaceId, dataURL, bounds, dimensions) {
	return new Promise(function(resolve, reject) {
		var img = new Image();
		var canvas = document.createElement("canvas");
		var ctx = canvas.getContext("2d");

		img.onload = function() {
			canvas.width = dimensions.width;
			canvas.height = dimensions.height;
			ctx.drawImage(img, 0, 0);

			var imageId = "flattened_" + surfaceId;
			var worldWidth = bounds.maxX - bounds.minX;
			var worldHeight = bounds.maxY - bounds.minY;

			// DIAGNOSTIC: Check bounds structure
			console.log("🖼️ Restoring flattened image bounds:", JSON.stringify(bounds));
			console.log("🖼️ Has minZ/maxZ?", "minZ" in bounds, "maxZ" in bounds);

			// Create image entry matching the structure from flattenTexturedMeshToImage
			var imageEntry = {
				id: imageId,
				name: surfaceId + "_flattened",
				canvas: canvas,
				bbox: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
				width: dimensions.width,
				height: dimensions.height,
				visible: true,
				transparency: 1.0,
				zElevation: (bounds.minZ !== undefined && bounds.minZ !== null) ? bounds.minZ : (window.drawingZLevel !== undefined ? window.drawingZLevel : 0),
				isGeoReferenced: true,
				bounds: bounds,
				pixelWidth: worldWidth / dimensions.width,
				pixelHeight: worldHeight / dimensions.height,
				sourceType: "flattened_obj",
				sourceSurfaceId: surfaceId
			};

			window.loadedImages.set(imageId, imageEntry);
			console.log("✅ Restored flattened image: " + imageId + " (" + dimensions.width + "x" + dimensions.height + ")");
			console.log("✅ Image bbox (world coords): [" + imageEntry.bbox.join(", ") + "], zElevation: " + imageEntry.zElevation);
			resolve();
		};

		img.onerror = function(err) {
			console.error("Failed to restore flattened image from dataURL: " + surfaceId, err);
			reject(err);
		};

		img.src = dataURL;
	});
}

function restoreImageFromBlob(imgRecord, blob) {
	return new Promise(function(resolve, reject) {
		// CRITICAL: Create blob URL BEFORE setting up handlers
		var blobURL = URL.createObjectURL(blob);
		var img = new Image();
		var canvas = document.createElement("canvas");
		var ctx = canvas.getContext("2d");

		img.onload = function() {
			canvas.width = img.width;
			canvas.height = img.height;
			ctx.drawImage(img, 0, 0);

			// VALIDATE: Ensure canvas has actual pixel data
			// Check a sample of pixels (10x10 grid) for ANY non-zero values
			var sampleSize = Math.min(img.width, 10);
			var imageData = ctx.getImageData(0, 0, sampleSize, Math.min(img.height, 10));
			var hasData = false;

			// Check for any non-zero RGB values (alpha channel can be 0 for transparency)
			for (var i = 0; i < imageData.data.length; i += 4) {
				var r = imageData.data[i];
				var g = imageData.data[i + 1];
				var b = imageData.data[i + 2];
				// Image has data if ANY pixel has R, G, or B value
				if (r > 0 || g > 0 || b > 0) {
					hasData = true;
					break;
				}
			}

			// RELAXED VALIDATION: Even if sample appears black, still load the image
			// This prevents false negatives from images with mostly black content
			if (!hasData) {
				console.warn("⚠️ Image sample appears all black (may be valid): " + imgRecord.id);
			}

			// Create image entry with all properties from imgRecord
			var imageEntry = {
				id: imgRecord.id,
				name: imgRecord.name || imgRecord.id,
				canvas: canvas,
				blob: blob,
				bbox: imgRecord.bbox || null,
				type: imgRecord.type || "imagery",
				visible: imgRecord.visible !== false,
				transparency: (imgRecord.transparency !== undefined && imgRecord.transparency !== null) ? imgRecord.transparency : 1.0,
				zElevation: (imgRecord.zElevation !== undefined && imgRecord.zElevation !== null) ? imgRecord.zElevation : 0,
				isGeoReferenced: imgRecord.isGeoReferenced || false,
				bounds: imgRecord.bounds || null,
				pixelWidth: imgRecord.pixelWidth || null,
				pixelHeight: imgRecord.pixelHeight || null,
				sourceType: imgRecord.sourceType || null,
				sourceSurfaceId: imgRecord.sourceSurfaceId || null,
				width: img.width,
				height: img.height
			};

			window.loadedImages.set(imgRecord.id, imageEntry);

			console.log("✅ Restored image: " + imgRecord.id + " (" + img.width + "x" + img.height + ")");
			console.log("✅ Image transparency: " + imageEntry.transparency + ", visible: " + imageEntry.visible);
			if (imageEntry.bbox) {
				console.log("✅ Image bbox (world coords): [" + imageEntry.bbox.join(", ") + "]");
			}

			// CRITICAL: Only revoke AFTER canvas confirmed loaded
			URL.revokeObjectURL(blobURL);
			resolve();
		};

		img.onerror = function(err) {
			console.error("Failed to restore image: " + imgRecord.id, err);
			URL.revokeObjectURL(blobURL);
			reject(err);
		};

		// Set source AFTER handlers are registered
		img.src = blobURL;
	});
}

export default KAPParser;
