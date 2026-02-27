// src/fileIO/LASIO/LASParser.js
//=============================================================
// LAS FILE PARSER
//=============================================================
// Step 1) Parses ASPRS LAS (LiDAR) binary format files
// Step 2) Supports LAS versions 1.2, 1.3, and 1.4
// Step 3) Supports Point Data Record Formats 0, 1, 2, 3, 6, 7, 8
// Step 4) Created: 2026-01-16
// Step 5) Reference: ASPRS LAS Specification 1.4-R15

import BaseParser from "../BaseParser.js";
import proj4 from "proj4";
import { top100EPSGCodes, isLikelyWGS84 } from "../../dialog/popups/generic/ProjectionDialog.js";
import { showWorkerProgressDialog } from "../../dialog/popups/generic/WorkerProgressDialog.js";
// Delaunay and PointDeduplication now handled in Web Worker (lasImportWorker.js)

// LAS classifications now in lasImportWorker.js

// Point record sizes and parsing now handled by lasImportWorker.js

// Step 8) LASParser class
class LASParser extends BaseParser {
	constructor(options = {}) {
		super(options);
		this.littleEndian = true; // LAS is always little-endian
	}

	// Step 9) Main parse method — header on main thread, heavy compute in Web Worker
	async parse(file) {
		try {
			// Step 10) Read file as ArrayBuffer for binary parsing
			var arrayBuffer = await this.readAsArrayBuffer(file);

			// Step 11) Parse ONLY the header on the main thread (fast — just reads header bytes)
			var headerData = this.parseLASHeader(arrayBuffer);

			// Step 12) Detect coordinate system from bounds
			var isWGS84 = this.detectCoordinateSystem(headerData.header);

			// Step 13) Prompt user for import configuration (needs DOM)
			var config = await this.promptForImportConfiguration(file.name, isWGS84);

			if (config.cancelled) {
				return { success: false, message: "Import cancelled by user" };
			}

			// Step 14) If transform needed, resolve EPSG definition on main thread (needs proj4 registry)
			if (config.transform && config.epsgCode) {
				try {
					var epsgDef = proj4.defs("EPSG:" + config.epsgCode);
					if (epsgDef) {
						config.epsgDef = typeof epsgDef === "string" ? epsgDef : proj4.defs("EPSG:" + config.epsgCode);
					}
				} catch (e) {
					// Worker will handle registration via epsgDef
				}
				// Pass the proj4 definition string to the worker
				if (typeof config.epsgDef === "object" && config.epsgDef !== null) {
					// proj4 defs returns an object, need to pass the raw proj4 string
					config.proj4Source = config.proj4Source || proj4.defs("EPSG:" + config.epsgCode);
				}
			}

			// Step 15) Delegate heavy computation to Web Worker
			console.log("LAS import: sending " + headerData.header.numberOfPoints + " point records to worker...");
			var workerResult = await this.processInWorker(arrayBuffer, headerData.header, config);

			// Step 16) Process worker result
			if (workerResult.resultType === "surface_typed") {
				// Surface — reconstruct from typed arrays (Transferable, no structured clone OOM)
				var px = workerResult.pointsX;
				var py = workerResult.pointsY;
				var pz = workerResult.pointsZ;
				var triIdx = workerResult.triangleIndices;
				var nPts = workerResult.pointCount;
				var nTris = workerResult.triangleCount;

				// Rebuild points array
				var surfPoints = new Array(nPts);
				for (var pi = 0; pi < nPts; pi++) {
					surfPoints[pi] = { x: px[pi], y: py[pi], z: pz[pi] };
				}

				// Rebuild triangles array
				var surfTriangles = new Array(nTris);
				for (var ti = 0; ti < nTris; ti++) {
					var i0 = triIdx[ti * 3], i1 = triIdx[ti * 3 + 1], i2 = triIdx[ti * 3 + 2];
					surfTriangles[ti] = {
						vertices: [surfPoints[i0], surfPoints[i1], surfPoints[i2]]
					};
				}

				var surfaceId = workerResult.surfaceId;
				var surface = {
					id: surfaceId,
					name: workerResult.surfaceName,
					type: "delaunay",
					points: surfPoints,
					triangles: surfTriangles,
					meshBounds: workerResult.meshBounds,
					visible: true,
					gradient: workerResult.surfaceStyle,
					hasVertexColors: false,
					transparency: 1.0,
					metadata: workerResult.metadata
				};

				console.log("LAS surface: " + nPts + " points, " + nTris + " triangles");
				return {
					surfaces: new Map([[surfaceId, surface]]),
					dataType: "surfaces",
					config: config,
					success: true
				};
			} else if (workerResult.resultType === "pointcloud_typed") {
				// Large point cloud — typed arrays transferred directly from worker
				var ta = workerResult.typedArrays;
				console.log("LAS import: received typed array point cloud with " + ta.count + " points");
				return {
					header: workerResult.header || headerData.header,
					statistics: workerResult.statistics,
					typedPointCloud: ta,
					config: config,
					dataType: "pointcloud_typed",
					success: true,
					originalPointCount: workerResult.originalPointCount,
					processedPointCount: workerResult.processedPointCount
				};
			} else {
				// Point cloud — reconstruct kadDrawingsMap from serialized entries
				var kadDrawingsMap = new Map();
				if (workerResult.kadEntries) {
					for (var i = 0; i < workerResult.kadEntries.length; i++) {
						var entry = workerResult.kadEntries[i];
						kadDrawingsMap.set(entry.key, entry.value);
					}
				}
				return {
					header: workerResult.header || headerData.header,
					statistics: workerResult.statistics,
					kadDrawingsMap: kadDrawingsMap,
					config: config,
					dataType: "pointcloud",
					success: true,
					originalPointCount: workerResult.originalPointCount,
					processedPointCount: workerResult.processedPointCount
				};
			}
		} catch (error) {
			console.error("LAS parse error:", error);
			throw error;
		}
	}

	// Step 9b) Send heavy computation to Web Worker
	processInWorker(arrayBuffer, header, config) {
		var progressDialog = showWorkerProgressDialog("Importing LAS File", {
			initialMessage: "Parsing " + (header.numberOfPoints || 0).toLocaleString() + " point records..."
		});

		return new Promise(function(resolve, reject) {
			var worker = new Worker(
				new URL("../../workers/lasImportWorker.js", import.meta.url),
				{ type: "module" }
			);

			function handler(e) {
				var msg = e.data;
				if (msg.type === "progress") {
					progressDialog.update(msg.percent, msg.message);
				} else if (msg.type === "result") {
					worker.removeEventListener("message", handler);
					worker.removeEventListener("error", errHandler);
					worker.terminate();
					progressDialog.complete("LAS import complete!");
					resolve(msg.data);
				} else if (msg.type === "error") {
					worker.removeEventListener("message", handler);
					worker.removeEventListener("error", errHandler);
					worker.terminate();
					progressDialog.fail("LAS import failed: " + msg.message);
					reject(new Error(msg.message));
				}
			}

			function errHandler(err) {
				worker.removeEventListener("message", handler);
				worker.removeEventListener("error", errHandler);
				worker.terminate();
				progressDialog.fail("LAS worker error");
				reject(new Error("LAS Worker error: " + (err.message || String(err))));
			}

			worker.addEventListener("message", handler);
			worker.addEventListener("error", errHandler);

			// Transfer the ArrayBuffer (zero-copy)
			worker.postMessage(
				{ type: "parsePoints", payload: { arrayBuffer: arrayBuffer, header: header, config: config } },
				[arrayBuffer]
			);
		});
	}

	// Step 12) Read file as ArrayBuffer
	readAsArrayBuffer(file) {
		return new Promise((resolve, reject) => {
			var reader = new FileReader();
			reader.onload = event => resolve(event.target.result);
			reader.onerror = error => reject(error);
			reader.readAsArrayBuffer(file);
		});
	}

	// Step 12b) Parse ONLY the LAS header (fast — no point records)
	parseLASHeader(arrayBuffer) {
		var dataView = new DataView(arrayBuffer);
		var signature = this.readString(dataView, 0, 4);
		if (signature !== "LASF") {
			throw new Error("Invalid LAS file: File signature must be 'LASF', got '" + signature + "'");
		}
		var header = this.parsePublicHeader(dataView);
		var vlrs = [];
		if (header.numberOfVLRs > 0) {
			vlrs = this.parseVLRs(dataView, header);
		}
		console.log("LAS Version: " + header.versionMajor + "." + header.versionMinor +
			", Format: " + header.pointDataFormatID +
			", Points: " + header.numberOfPoints);
		return { header: header, vlrs: vlrs };
	}

	// parseLASData — point parsing now handled by lasImportWorker.js

	// Step 21) Parse Public Header Block
	parsePublicHeader(dataView) {
		var header = {};
		var offset = 0;

		// File Signature (already validated) - 4 bytes
		header.fileSignature = this.readString(dataView, offset, 4);
		offset += 4;

		// File Source ID - 2 bytes (unsigned short)
		header.fileSourceID = dataView.getUint16(offset, this.littleEndian);
		offset += 2;

		// Global Encoding - 2 bytes (unsigned short)
		header.globalEncoding = dataView.getUint16(offset, this.littleEndian);
		offset += 2;

		// Project ID (GUID) - 16 bytes
		header.projectID_GUID_data1 = dataView.getUint32(offset, this.littleEndian);
		offset += 4;
		header.projectID_GUID_data2 = dataView.getUint16(offset, this.littleEndian);
		offset += 2;
		header.projectID_GUID_data3 = dataView.getUint16(offset, this.littleEndian);
		offset += 2;
		header.projectID_GUID_data4 = new Uint8Array(dataView.buffer, offset, 8);
		offset += 8;

		// Version Major - 1 byte
		header.versionMajor = dataView.getUint8(offset);
		offset += 1;

		// Version Minor - 1 byte
		header.versionMinor = dataView.getUint8(offset);
		offset += 1;

		// System Identifier - 32 bytes
		header.systemIdentifier = this.readString(dataView, offset, 32);
		offset += 32;

		// Generating Software - 32 bytes
		header.generatingSoftware = this.readString(dataView, offset, 32);
		offset += 32;

		// File Creation Day of Year - 2 bytes
		header.fileCreationDayOfYear = dataView.getUint16(offset, this.littleEndian);
		offset += 2;

		// File Creation Year - 2 bytes
		header.fileCreationYear = dataView.getUint16(offset, this.littleEndian);
		offset += 2;

		// Header Size - 2 bytes
		header.headerSize = dataView.getUint16(offset, this.littleEndian);
		offset += 2;

		// Offset to Point Data - 4 bytes
		header.offsetToPointData = dataView.getUint32(offset, this.littleEndian);
		offset += 4;

		// Number of Variable Length Records - 4 bytes
		header.numberOfVLRs = dataView.getUint32(offset, this.littleEndian);
		offset += 4;

		// Point Data Record Format - 1 byte
		header.pointDataFormatID = dataView.getUint8(offset);
		offset += 1;

		// Point Data Record Length - 2 bytes
		header.pointDataRecordLength = dataView.getUint16(offset, this.littleEndian);
		offset += 2;

		// Legacy Number of Point Records - 4 bytes (LAS 1.0-1.3)
		header.legacyNumberOfPointRecords = dataView.getUint32(offset, this.littleEndian);
		offset += 4;

		// Legacy Number of Points by Return - 5 x 4 bytes = 20 bytes
		header.legacyNumberOfPointsByReturn = [];
		for (var i = 0; i < 5; i++) {
			header.legacyNumberOfPointsByReturn.push(dataView.getUint32(offset, this.littleEndian));
			offset += 4;
		}

		// X Scale Factor - 8 bytes (double)
		header.xScaleFactor = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Y Scale Factor - 8 bytes (double)
		header.yScaleFactor = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Z Scale Factor - 8 bytes (double)
		header.zScaleFactor = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// X Offset - 8 bytes (double)
		header.xOffset = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Y Offset - 8 bytes (double)
		header.yOffset = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Z Offset - 8 bytes (double)
		header.zOffset = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Max X - 8 bytes (double)
		header.maxX = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Min X - 8 bytes (double)
		header.minX = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Max Y - 8 bytes (double)
		header.maxY = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Min Y - 8 bytes (double)
		header.minY = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Max Z - 8 bytes (double)
		header.maxZ = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// Min Z - 8 bytes (double)
		header.minZ = dataView.getFloat64(offset, this.littleEndian);
		offset += 8;

		// LAS 1.3+ fields
		if (header.versionMinor >= 3) {
			// Start of Waveform Data Packet Record - 8 bytes
			header.startOfWaveformDataPacketRecord = this.readUint64(dataView, offset);
			offset += 8;
		}

		// LAS 1.4+ fields
		if (header.versionMinor >= 4) {
			// Start of First Extended Variable Length Record - 8 bytes
			header.startOfFirstEVLR = this.readUint64(dataView, offset);
			offset += 8;

			// Number of Extended Variable Length Records - 4 bytes
			header.numberOfEVLRs = dataView.getUint32(offset, this.littleEndian);
			offset += 4;

			// Number of Point Records (64-bit) - 8 bytes
			header.numberOfPoints = this.readUint64(dataView, offset);
			offset += 8;

			// Number of Points by Return (15 x 8 bytes) - 120 bytes
			header.numberOfPointsByReturn = [];
			for (var i = 0; i < 15; i++) {
				header.numberOfPointsByReturn.push(this.readUint64(dataView, offset));
				offset += 8;
			}
		} else {
			// Use legacy values for LAS 1.0-1.3
			header.numberOfPoints = header.legacyNumberOfPointRecords;
			header.numberOfPointsByReturn = header.legacyNumberOfPointsByReturn;
		}

		return header;
	}

	// Step 22) Parse Variable Length Records
	parseVLRs(dataView, header) {
		var vlrs = [];
		var offset = header.headerSize;

		for (var i = 0; i < header.numberOfVLRs; i++) {
			var vlr = {};

			// Reserved - 2 bytes
			vlr.reserved = dataView.getUint16(offset, this.littleEndian);
			offset += 2;

			// User ID - 16 bytes
			vlr.userID = this.readString(dataView, offset, 16);
			offset += 16;

			// Record ID - 2 bytes
			vlr.recordID = dataView.getUint16(offset, this.littleEndian);
			offset += 2;

			// Record Length After Header - 2 bytes
			vlr.recordLengthAfterHeader = dataView.getUint16(offset, this.littleEndian);
			offset += 2;

			// Description - 32 bytes
			vlr.description = this.readString(dataView, offset, 32);
			offset += 32;

			// VLR Data
			vlr.data = new Uint8Array(dataView.buffer, offset, vlr.recordLengthAfterHeader);
			offset += vlr.recordLengthAfterHeader;

			// Try to parse known VLR types
			vlr.parsedData = this.parseVLRData(vlr);

			vlrs.push(vlr);
		}

		return vlrs;
	}

	// Step 23) Parse known VLR data types
	parseVLRData(vlr) {
		// GeoTIFF GeoKeyDirectoryTag
		if (vlr.userID.trim() === "LASF_Projection" && vlr.recordID === 34735) {
			return this.parseGeoKeyDirectory(vlr.data);
		}
		// WKT Coordinate System
		if (vlr.userID.trim() === "LASF_Projection" && vlr.recordID === 2112) {
			return { wkt: this.readString(new DataView(vlr.data.buffer, vlr.data.byteOffset), 0, vlr.data.length) };
		}
		return null;
	}

	// Step 24) Parse GeoKey Directory
	parseGeoKeyDirectory(data) {
		if (data.length < 8) return null;

		var dv = new DataView(data.buffer, data.byteOffset, data.length);
		var keys = {};

		keys.keyDirectoryVersion = dv.getUint16(0, this.littleEndian);
		keys.keyRevision = dv.getUint16(2, this.littleEndian);
		keys.minorRevision = dv.getUint16(4, this.littleEndian);
		keys.numberOfKeys = dv.getUint16(6, this.littleEndian);

		keys.entries = [];
		var offset = 8;
		for (var i = 0; i < keys.numberOfKeys && offset + 8 <= data.length; i++) {
			keys.entries.push({
				keyID: dv.getUint16(offset, this.littleEndian),
				tiffTagLocation: dv.getUint16(offset + 2, this.littleEndian),
				count: dv.getUint16(offset + 4, this.littleEndian),
				valueOffset: dv.getUint16(offset + 6, this.littleEndian)
			});
			offset += 8;
		}

		return keys;
	}

	// parsePointRecords + parsePointRecord — now handled by lasImportWorker.js

	// convertToKadFormat, getElevationColor, calculateStatistics — now handled by lasImportWorker.js

	// Step 35) Helper: Read string from DataView
	readString(dataView, offset, length) {
		var chars = [];
		for (var i = 0; i < length; i++) {
			var charCode = dataView.getUint8(offset + i);
			if (charCode === 0) break; // Null terminator
			chars.push(String.fromCharCode(charCode));
		}
		return chars.join("");
	}

	// Step 36) Helper: Read 64-bit unsigned integer
	readUint64(dataView, offset) {
		// JavaScript doesn't have native 64-bit integer support
		// Read as two 32-bit values and combine
		var low = dataView.getUint32(offset, this.littleEndian);
		var high = dataView.getUint32(offset + 4, this.littleEndian);
		// For values that fit in 53 bits (Number.MAX_SAFE_INTEGER)
		return high * 0x100000000 + low;
	}

	// rgb16ToHex — now handled by lasImportWorker.js

	// createTriangulatedSurface, getClassificationColor — now handled by lasImportWorker.js

	// Step 39) Detect coordinate system from LAS header bounds
	detectCoordinateSystem(header) {
		var bbox = [header.minX, header.minY, header.maxX, header.maxY];
		return isLikelyWGS84(bbox);
	}

	// Step 40) Prompt user for import configuration
	async promptForImportConfiguration(filename, isWGS84) {
		return new Promise(function(resolve) {
			// Step 41) Create dialog content HTML
			var contentHTML = '<div style="display: flex; flex-direction: column; gap: 15px; padding: 10px;">';

			// Step 42) File information
			contentHTML += '<div style="text-align: left;">';
			contentHTML += '<p class="labelWhite15" style="margin: 0 0 10px 0;"><strong>File:</strong> ' + filename + "</p>";
			contentHTML += '<p class="labelWhite15" style="margin: 0 0 10px 0;">Detected coordinate system: <strong>' + (isWGS84 ? "WGS84 (latitude/longitude)" : "Projected (UTM/local)") + "</strong></p>";
			contentHTML += '<p class="labelWhite15" style="margin: 0;">LAS files contain point cloud data. How would you like to import this data?</p>';
			contentHTML += "</div>";

			// Step 43) Import type selection
			contentHTML += '<div style="border: 1px solid var(--light-mode-border); border-radius: 4px; padding: 10px; background: var(--dark-mode-bg);">';
			contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-weight: bold;">Import As:</p>';

			contentHTML += '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">';
			contentHTML += '<input type="radio" id="import-pointcloud" name="import-type" value="pointcloud" checked style="margin: 0;">';
			contentHTML += '<label for="import-pointcloud" class="labelWhite15" style="margin: 0; cursor: pointer;">Point Cloud (KAD points by classification)</label>';
			contentHTML += "</div>";

			contentHTML += '<div style="display: flex; align-items: center; gap: 8px;">';
			contentHTML += '<input type="radio" id="import-surface" name="import-type" value="surface" style="margin: 0;">';
			contentHTML += '<label for="import-surface" class="labelWhite15" style="margin: 0; cursor: pointer;">Surface (triangulated mesh)</label>';
			contentHTML += "</div>";

			contentHTML += "</div>";

			// Step 44) Coordinate transformation options (only if WGS84 detected)
			if (isWGS84) {
				contentHTML += '<div style="border: 1px solid var(--light-mode-border); border-radius: 4px; padding: 10px; background: var(--dark-mode-bg);">';
				contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-weight: bold;">Coordinate Transformation:</p>';

				contentHTML += '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">';
				contentHTML += '<input type="radio" id="keep-wgs84-las" name="transform" value="keep" style="margin: 0;">';
				contentHTML += '<label for="keep-wgs84-las" class="labelWhite15" style="margin: 0; cursor: pointer;">Keep as WGS84 (latitude/longitude)</label>';
				contentHTML += "</div>";

				contentHTML += '<div style="display: flex; align-items: center; gap: 8px;">';
				contentHTML += '<input type="radio" id="transform-utm-las" name="transform" value="transform" checked style="margin: 0;">';
				contentHTML += '<label for="transform-utm-las" class="labelWhite15" style="margin: 0; cursor: pointer;">Transform to projected coordinates</label>';
				contentHTML += "</div>";

				// EPSG dropdown
				contentHTML += '<div id="las-epsg-section" style="margin-top: 10px; display: grid; grid-template-columns: 100px 1fr; gap: 8px; align-items: center;">';
				contentHTML += '<label class="labelWhite15">EPSG Code:</label>';
				contentHTML += '<select id="las-import-epsg-code" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
				contentHTML += '<option value="">-- Select EPSG Code --</option>';

				// Add EPSG codes
				top100EPSGCodes.forEach(function(item) {
					contentHTML += '<option value="' + item.code + '">' + item.code + " - " + item.name + "</option>";
				});

				contentHTML += "</select>";
				contentHTML += "</div>";

				// Custom Proj4
				contentHTML += '<div style="margin-top: 8px; display: grid; grid-template-columns: 100px 1fr; gap: 8px; align-items: start;">';
				contentHTML += '<label class="labelWhite15" style="padding-top: 4px;">Or Custom Proj4:</label>';
				contentHTML += '<textarea id="las-import-custom-proj4" placeholder="+proj=utm +zone=50 +south +datum=WGS84 +units=m +no_defs" style="height: 60px; padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 11px; font-family: monospace; resize: vertical;"></textarea>';
				contentHTML += "</div>";

				contentHTML += "</div>";
			}

			// Step 45) Master RL offset
			// contentHTML += '<div style="border: 1px solid var(--light-mode-border); border-radius: 4px; padding: 10px; background: var(--dark-mode-bg);">';
			// contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-weight: bold;">Master Reference Location (Optional):</p>';
			// contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-size: 11px; opacity: 0.8;">Apply offset to all imported coordinates</p>';

			// contentHTML += '<div style="display: grid; grid-template-columns: 80px 1fr 80px 1fr; gap: 8px; align-items: center;">';
			// contentHTML += '<label class="labelWhite15">Easting:</label>';
			// contentHTML += '<input type="number" id="las-master-rl-x" value="0" step="0.001" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			// contentHTML += '<label class="labelWhite15">Northing:</label>';
			// contentHTML += '<input type="number" id="las-master-rl-y" value="0" step="0.001" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			// contentHTML += "</div>";

			// contentHTML += "</div>";

			// Step 46) Point decimation options (shown for Point Cloud import)
			contentHTML += '<div id="las-pointcloud-options" style="border: 1px solid var(--light-mode-border); border-radius: 4px; padding: 10px; background: var(--dark-mode-bg);">';
			contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-weight: bold;">Point Cloud Options:</p>';

			// Max Points (decimation)
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">Max Points:</label>';
			contentHTML += '<input type="number" id="las-max-points" value="50000" min="1000" max="1000000" step="1000" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<p class="labelWhite15" style="font-size: 10px; opacity: 0.7; margin: 2px 0 0 0; grid-column: 2;">Decimates to this count (0 = no limit).</p>';
			contentHTML += "</div>";

			// XY Tolerance (deduplication)
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">XY Tolerance:</label>';
			contentHTML += '<input type="number" id="las-pc-xy-tolerance" value="0.01" min="0" max="10" step="0.001" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<p class="labelWhite15" style="font-size: 10px; opacity: 0.7; margin: 2px 0 0 0; grid-column: 2;">Deduplicates points within XY distance (0 = disabled).</p>';
			contentHTML += "</div>";

			// Classification Filter
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">Classification Filter:</label>';
			contentHTML += '<select id="las-classification-filter" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<option value="all">All Classifications</option>';
			contentHTML += '<option value="ground">Ground Only (2)</option>';
			contentHTML += '<option value="vegetation">Vegetation (3,4,5)</option>';
			contentHTML += '<option value="buildings">Buildings (6)</option>';
			contentHTML += '<option value="unclassified">Unclassified Only (1)</option>';
			contentHTML += "</select>";
			contentHTML += "</div>";

			// Preserve LAS Colors
			contentHTML += '<div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">';
			contentHTML += '<input type="checkbox" id="las-pc-preserve-colors" checked style="margin: 0;">';
			contentHTML += '<label for="las-pc-preserve-colors" class="labelWhite15" style="margin: 0; cursor: pointer; font-size: 11px;">Preserve LAS point colors (if available)</label>';
			contentHTML += "</div>";

			contentHTML += "</div>";

			// Step 46b) Surface triangulation options (shown for Surface import)
			contentHTML += '<div id="las-surface-options" style="display: none; border: 1px solid var(--light-mode-border); border-radius: 4px; padding: 10px; background: var(--dark-mode-bg);">';
			contentHTML += '<p class="labelWhite15" style="margin: 0 0 8px 0; font-weight: bold;">Surface Triangulation Options:</p>';

			// Surface Name
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">Surface Name:</label>';
			contentHTML += '<input type="text" id="las-surface-name" value="LAS_Surface" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += "</div>";

			// Max Edge Length
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">Max Edge Length:</label>';
			contentHTML += '<input type="number" id="las-max-edge-length" value="0" min="0" max="10000" step="1" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<p class="labelWhite15" style="font-size: 10px; opacity: 0.7; margin: 2px 0 0 0; grid-column: 2;">0 = disabled. Removes convex hull triangles with long edges.</p>';
			contentHTML += "</div>";

			// Consider 3D Edge Length
			contentHTML += '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; margin-left: 140px;">';
			contentHTML += '<input type="checkbox" id="las-consider-3d-length" style="margin: 0;">';
			contentHTML += '<label for="las-consider-3d-length" class="labelWhite15" style="margin: 0; cursor: pointer; font-size: 11px;">Consider 3D edge length (includes Z difference)</label>';
			contentHTML += "</div>";

			// Min Internal Angle
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">Min Internal Angle:</label>';
			contentHTML += '<input type="number" id="las-min-angle" value="0" min="0" max="60" step="1" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<p class="labelWhite15" style="font-size: 10px; opacity: 0.7; margin: 2px 0 0 0; grid-column: 2;">0 = disabled. Removes skinny triangles (degrees).</p>';
			contentHTML += "</div>";

			// Consider 3D Angle
			contentHTML += '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; margin-left: 140px;">';
			contentHTML += '<input type="checkbox" id="las-consider-3d-angle" style="margin: 0;">';
			contentHTML += '<label for="las-consider-3d-angle" class="labelWhite15" style="margin: 0; cursor: pointer; font-size: 11px;">Consider 3D angle (includes Z in calculation)</label>';
			contentHTML += "</div>";

			// XY Tolerance (for deduplication)
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">XY Tolerance:</label>';
			contentHTML += '<input type="number" id="las-xyz-tolerance" value="0.001" min="0.001" max="10" step="0.001" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<p class="labelWhite15" style="font-size: 10px; opacity: 0.7; margin: 2px 0 0 0; grid-column: 2;">Merge points within this XY distance.</p>';
			contentHTML += "</div>";

			// Max Surface Points (decimation before triangulation)
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">Max Surface Points:</label>';
			contentHTML += '<input type="number" id="las-max-surface-points" value="0" min="0" max="5000000" step="10000" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<p class="labelWhite15" style="font-size: 10px; opacity: 0.7; margin: 2px 0 0 0; grid-column: 2;">0 = no limit. Decimates before triangulation.</p>';
			contentHTML += "</div>";

			// Surface Style (gradient)
			contentHTML += '<div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;">';
			contentHTML += '<label class="labelWhite15">Surface Style:</label>';
			contentHTML += '<select id="las-surface-style" style="padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--light-mode-border); border-radius: 3px; font-size: 12px;">';
			contentHTML += '<option value="default">Default (elevation)</option>';
			contentHTML += '<option value="lasColors">LAS Point Colors</option>';
			contentHTML += '<option value="hillshade">Hillshade</option>';
			contentHTML += '<option value="viridis">Viridis</option>';
			contentHTML += '<option value="turbo">Turbo</option>';
			contentHTML += '<option value="parula">Parula</option>';
			contentHTML += '<option value="cividis">Cividis</option>';
			contentHTML += '<option value="terrain">Terrain</option>';
			contentHTML += "</select>";
			contentHTML += '<p class="labelWhite15" style="font-size: 10px; opacity: 0.7; margin: 2px 0 0 0; grid-column: 2;">LAS Point Colors uses RGB from LAS file (if available).</p>';
			contentHTML += "</div>";

			contentHTML += "</div>";

			// Error message
			contentHTML += '<div id="las-import-error-message" style="display: none; margin-top: 8px; padding: 6px; background: #f44336; color: white; border-radius: 3px; font-size: 11px;"></div>';

			contentHTML += "</div>";

			// Step 47) Create dialog
			var dialog = new window.FloatingDialog({
				title: "Import LAS Point Cloud",
				content: contentHTML,
				layoutType: "default",
				width: 650,
				height: 780,
				showConfirm: true,
				showCancel: true,
				confirmText: "Import",
				cancelText: "Cancel",
				onConfirm: async function() {
					try {
						// Get form values
						var importType = document.querySelector('input[name="import-type"]:checked').value;
						var maxPoints = parseInt(document.getElementById("las-max-points").value) || 0;
						var classificationFilter = document.getElementById("las-classification-filter").value;
						var errorDiv = document.getElementById("las-import-error-message");

						var config = { cancelled: false, importType: importType, maxPoints: maxPoints, classificationFilter: classificationFilter, transform: false, epsgCode: null, proj4Source: null };

						// Step 47a) Get point cloud options
						if (importType === "pointcloud") {
							config.pcXyTolerance = parseFloat(document.getElementById("las-pc-xy-tolerance").value) || 0;
							config.pcPreserveColors = document.getElementById("las-pc-preserve-colors").checked;
						}

						// Step 47b) Get surface triangulation options if surface import selected
						if (importType === "surface") {
							config.surfaceName = document.getElementById("las-surface-name").value || "LAS_Surface";
							config.maxEdgeLength = parseFloat(document.getElementById("las-max-edge-length").value) || 0;
							config.consider3DLength = document.getElementById("las-consider-3d-length").checked;
							config.minAngle = parseFloat(document.getElementById("las-min-angle").value) || 0;
							config.consider3DAngle = document.getElementById("las-consider-3d-angle").checked;
							config.xyzTolerance = parseFloat(document.getElementById("las-xyz-tolerance").value) || 0.001;
							config.maxSurfacePoints = parseInt(document.getElementById("las-max-surface-points").value) || 0;
							config.surfaceStyle = document.getElementById("las-surface-style").value || "default";
						}

						// Check transformation options if WGS84
						if (isWGS84) {
							var transformRadio = document.querySelector('input[name="transform"]:checked');
							if (transformRadio && transformRadio.value === "transform") {
								config.masterRLX = masterRLX;
								config.masterRLY = masterRLY;
								config.transform = true;
								var epsgCode = document.getElementById("las-import-epsg-code").value.trim();
								var customProj4 = document.getElementById("las-import-custom-proj4").value.trim();

								if (!epsgCode && !customProj4) {
									errorDiv.textContent = "Please select an EPSG code or provide a custom Proj4 definition for transformation";
									errorDiv.style.display = "block";
									return;
								}

								config.epsgCode = epsgCode || null;
								config.proj4Source = customProj4 || null;

								// Load EPSG definition if needed
								if (epsgCode) {
									await window.loadEPSGCode(epsgCode);
								}
							}
						}

						dialog.close();
						resolve(config);
					} catch (error) {
						var errorDiv = document.getElementById("las-import-error-message");
						if (errorDiv) {
							errorDiv.textContent = "Configuration error: " + error.message;
							errorDiv.style.display = "block";
						}
						console.error("LAS import configuration error:", error);
					}
				},
				onCancel: function() {
					dialog.close();
					resolve({ cancelled: true });
				}
			});

			dialog.show();

			// Toggle EPSG section visibility
			if (isWGS84) {
				var transformRadios = document.querySelectorAll('input[name="transform"]');
				var epsgSection = document.getElementById("las-epsg-section");

				transformRadios.forEach(function(radio) {
					radio.addEventListener("change", function() {
						if (radio.value === "transform") {
							epsgSection.style.display = "grid";
						} else {
							epsgSection.style.display = "none";
						}
					});
				});
			}

			// Step 47b) Toggle Point Cloud / Surface options visibility based on import type
			var importTypeRadios = document.querySelectorAll('input[name="import-type"]');
			var pointcloudOptions = document.getElementById("las-pointcloud-options");
			var surfaceOptions = document.getElementById("las-surface-options");

			importTypeRadios.forEach(function(radio) {
				radio.addEventListener("change", function() {
					if (radio.value === "surface" && radio.checked) {
						pointcloudOptions.style.display = "none";
						surfaceOptions.style.display = "block";
					} else if (radio.value === "pointcloud" && radio.checked) {
						pointcloudOptions.style.display = "block";
						surfaceOptions.style.display = "none";
					}
				});
			});
		});
	}

	// applyCoordinateTransformation — now handled by lasImportWorker.js
}

export default LASParser;
