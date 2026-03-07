// src/fileIO/AutoCadIO/DXF3DFACEWriter.js
//=============================================================
// DXF 3DFACE WRITER - SURFACE TRIANGLES
//=============================================================
// Exports surface triangles as DXF 3DFACE entities.
// Produces AC1015 (AutoCAD 2000) compatible DXF with proper
// entity handles, subclass markers, and table structure.
// Compatible with AutoCAD, Vulcan, Surpac, QCAD, LibreCAD.

import BaseWriter from "../BaseWriter.js";

class DXF3DFACEWriter extends BaseWriter {
	constructor(options = {}) {
		super(options);
		this.layerName = options.layerName || "SURFACE";
		this.decimalPlaces = options.decimalPlaces !== undefined ? options.decimalPlaces : 3;
		// Start handles well above any reserved/special values.
		// Handles are hex strings — start at 0x200 to avoid collisions
		// with table object handles which start at 0x1-0x1F.
		this.handleCounter = 0x200;
	}

	nextHandle() {
		var h = this.handleCounter.toString(16).toUpperCase();
		this.handleCounter++;
		return h;
	}

	async write(data) {
		if (!data) {
			throw new Error("Invalid data: data object required");
		}

		var dxf = "";

		if (data.triangles && Array.isArray(data.triangles)) {
			dxf = this.generateDXF(data.triangles, data.layerName || this.layerName);
		} else if (data.surface && data.surface.triangles && Array.isArray(data.surface.triangles)) {
			dxf = this.generateDXF(data.surface.triangles, data.layerName || this.layerName);
		} else if (data.faces && Array.isArray(data.faces)) {
			dxf = this.generateDXFFromFaces(data.faces, data.vertices, data.layerName || this.layerName);
		} else {
			throw new Error("Invalid data: triangles, surface, or faces required");
		}

		return this.createBlob(dxf, "application/dxf");
	}

	generateDXF(triangles, layerName) {
		var dxf = "";
		dxf += this.writeHeader();
		dxf += this.writeClasses();
		dxf += this.writeTables(layerName);
		dxf += this.writeBlocks();

		// ENTITIES section
		dxf += "0\nSECTION\n2\nENTITIES\n";
		for (var i = 0; i < triangles.length; i++) {
			var triangle = triangles[i];
			dxf += this.write3DFace(triangle.vertices, layerName);
		}
		dxf += "0\nENDSEC\n";

		// OBJECTS section (required by AC1015)
		dxf += this.writeObjects();

		dxf += "0\nEOF\n";
		return dxf;
	}

	generateDXFFromFaces(faces, vertices, layerName) {
		var dxf = "";
		dxf += this.writeHeader();
		dxf += this.writeClasses();
		dxf += this.writeTables(layerName);
		dxf += this.writeBlocks();

		dxf += "0\nSECTION\n2\nENTITIES\n";
		for (var i = 0; i < faces.length; i++) {
			var face = faces[i];
			var faceVertices = [];
			for (var j = 0; j < face.length && j < 4; j++) {
				var vertexIndex = face[j];
				if (vertexIndex < vertices.length) {
					faceVertices.push(vertices[vertexIndex]);
				}
			}
			if (faceVertices.length >= 3) {
				dxf += this.write3DFace(faceVertices, layerName);
			}
		}
		dxf += "0\nENDSEC\n";

		dxf += this.writeObjects();
		dxf += "0\nEOF\n";
		return dxf;
	}

	// ── HEADER section ──
	writeHeader() {
		var s = "";
		s += "0\nSECTION\n2\nHEADER\n";
		s += "9\n$ACADVER\n1\nAC1015\n";
		s += "9\n$HANDSEED\n5\nFFFFF\n"; // Next available handle (high value)
		s += "9\n$INSUNITS\n70\n6\n"; // 6 = meters
		s += "0\nENDSEC\n";
		return s;
	}

	// ── CLASSES section (required but can be empty) ──
	writeClasses() {
		return "0\nSECTION\n2\nCLASSES\n0\nENDSEC\n";
	}

	// ── TABLES section ──
	writeTables(layerName) {
		var s = "";
		s += "0\nSECTION\n2\nTABLES\n";

		// VPORT table
		var vportTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nVPORT\n";
		s += "5\n" + vportTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n0\n";
		s += "0\nENDTAB\n";

		// LTYPE table with CONTINUOUS linetype
		var ltypeTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nLTYPE\n";
		s += "5\n" + ltypeTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n1\n";

		var continuousHandle = this.nextHandle();
		s += "0\nLTYPE\n";
		s += "5\n" + continuousHandle + "\n";
		s += "100\nAcDbSymbolTableRecord\n";
		s += "100\nAcDbLinetypeTableRecord\n";
		s += "2\nCONTINUOUS\n";
		s += "70\n0\n";
		s += "3\nSolid line\n";
		s += "72\n65\n";
		s += "73\n0\n";
		s += "40\n0.0\n";
		s += "0\nENDTAB\n";

		// LAYER table
		var layerTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nLAYER\n";
		s += "5\n" + layerTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n1\n";

		// Layer "0" (default, required)
		var layer0Handle = this.nextHandle();
		s += "0\nLAYER\n";
		s += "5\n" + layer0Handle + "\n";
		s += "100\nAcDbSymbolTableRecord\n";
		s += "100\nAcDbLayerTableRecord\n";
		s += "2\n0\n";
		s += "70\n0\n";
		s += "62\n7\n";
		s += "6\nCONTINUOUS\n";

		// Surface layer
		var layerHandle = this.nextHandle();
		s += "0\nLAYER\n";
		s += "5\n" + layerHandle + "\n";
		s += "100\nAcDbSymbolTableRecord\n";
		s += "100\nAcDbLayerTableRecord\n";
		s += "2\n" + layerName + "\n";
		s += "70\n0\n";
		s += "62\n7\n";
		s += "6\nCONTINUOUS\n";
		s += "0\nENDTAB\n";

		// STYLE table (text styles — required)
		var styleTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nSTYLE\n";
		s += "5\n" + styleTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n0\n";
		s += "0\nENDTAB\n";

		// VIEW table
		var viewTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nVIEW\n";
		s += "5\n" + viewTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n0\n";
		s += "0\nENDTAB\n";

		// UCS table
		var ucsTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nUCS\n";
		s += "5\n" + ucsTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n0\n";
		s += "0\nENDTAB\n";

		// APPID table
		var appidTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nAPPID\n";
		s += "5\n" + appidTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n1\n";

		var acadAppHandle = this.nextHandle();
		s += "0\nAPPID\n";
		s += "5\n" + acadAppHandle + "\n";
		s += "100\nAcDbSymbolTableRecord\n";
		s += "100\nAcDbRegAppTableRecord\n";
		s += "2\nACAD\n";
		s += "70\n0\n";
		s += "0\nENDTAB\n";

		// DIMSTYLE table
		var dimstyleTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nDIMSTYLE\n";
		s += "5\n" + dimstyleTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n0\n";
		s += "0\nENDTAB\n";

		// BLOCK_RECORD table
		var blockRecTableHandle = this.nextHandle();
		s += "0\nTABLE\n2\nBLOCK_RECORD\n";
		s += "5\n" + blockRecTableHandle + "\n";
		s += "100\nAcDbSymbolTable\n";
		s += "70\n2\n";

		// *Model_Space block record
		this._modelSpaceBlockRecHandle = this.nextHandle();
		s += "0\nBLOCK_RECORD\n";
		s += "5\n" + this._modelSpaceBlockRecHandle + "\n";
		s += "100\nAcDbSymbolTableRecord\n";
		s += "100\nAcDbBlockTableRecord\n";
		s += "2\n*Model_Space\n";

		// *Paper_Space block record
		this._paperSpaceBlockRecHandle = this.nextHandle();
		s += "0\nBLOCK_RECORD\n";
		s += "5\n" + this._paperSpaceBlockRecHandle + "\n";
		s += "100\nAcDbSymbolTableRecord\n";
		s += "100\nAcDbBlockTableRecord\n";
		s += "2\n*Paper_Space\n";

		s += "0\nENDTAB\n";
		s += "0\nENDSEC\n";
		return s;
	}

	// ── BLOCKS section ──
	writeBlocks() {
		var s = "";
		s += "0\nSECTION\n2\nBLOCKS\n";

		// *Model_Space block
		var msBlockHandle = this.nextHandle();
		s += "0\nBLOCK\n";
		s += "5\n" + msBlockHandle + "\n";
		s += "100\nAcDbEntity\n";
		s += "8\n0\n";
		s += "100\nAcDbBlockBegin\n";
		s += "2\n*Model_Space\n";
		s += "70\n0\n";
		s += "10\n0.0\n20\n0.0\n30\n0.0\n";
		s += "3\n*Model_Space\n";
		s += "1\n\n";
		var msEndHandle = this.nextHandle();
		s += "0\nENDBLK\n";
		s += "5\n" + msEndHandle + "\n";
		s += "100\nAcDbEntity\n";
		s += "8\n0\n";
		s += "100\nAcDbBlockEnd\n";

		// *Paper_Space block
		var psBlockHandle = this.nextHandle();
		s += "0\nBLOCK\n";
		s += "5\n" + psBlockHandle + "\n";
		s += "100\nAcDbEntity\n";
		s += "8\n0\n";
		s += "100\nAcDbBlockBegin\n";
		s += "2\n*Paper_Space\n";
		s += "70\n0\n";
		s += "10\n0.0\n20\n0.0\n30\n0.0\n";
		s += "3\n*Paper_Space\n";
		s += "1\n\n";
		var psEndHandle = this.nextHandle();
		s += "0\nENDBLK\n";
		s += "5\n" + psEndHandle + "\n";
		s += "100\nAcDbEntity\n";
		s += "8\n0\n";
		s += "100\nAcDbBlockEnd\n";

		s += "0\nENDSEC\n";
		return s;
	}

	// ── OBJECTS section (required by AC1015) ──
	writeObjects() {
		var dictHandle = this.nextHandle();
		var s = "";
		s += "0\nSECTION\n2\nOBJECTS\n";
		s += "0\nDICTIONARY\n";
		s += "5\n" + dictHandle + "\n";
		s += "100\nAcDbDictionary\n";
		s += "281\n1\n";
		s += "0\nENDSEC\n";
		return s;
	}

	// ── Single 3DFACE entity ──
	write3DFace(vertices, layerName) {
		if (!vertices || vertices.length < 3) return "";

		var handle = this.nextHandle();
		var s = "";

		s += "0\n3DFACE\n";
		s += "5\n" + handle + "\n";
		s += "330\n" + this._modelSpaceBlockRecHandle + "\n"; // Owner (Model_Space)
		s += "100\nAcDbEntity\n";
		s += "8\n" + layerName + "\n";
		s += "100\nAcDbFace\n";

		// Vertex 1
		var v1 = vertices[0];
		s += "10\n" + this.formatCoord(v1.x) + "\n";
		s += "20\n" + this.formatCoord(v1.y) + "\n";
		s += "30\n" + this.formatCoord(v1.z) + "\n";

		// Vertex 2
		var v2 = vertices[1];
		s += "11\n" + this.formatCoord(v2.x) + "\n";
		s += "21\n" + this.formatCoord(v2.y) + "\n";
		s += "31\n" + this.formatCoord(v2.z) + "\n";

		// Vertex 3
		var v3 = vertices[2];
		s += "12\n" + this.formatCoord(v3.x) + "\n";
		s += "22\n" + this.formatCoord(v3.y) + "\n";
		s += "32\n" + this.formatCoord(v3.z) + "\n";

		// Vertex 4 (repeat v3 for triangles)
		var v4 = vertices.length > 3 ? vertices[3] : v3;
		s += "13\n" + this.formatCoord(v4.x) + "\n";
		s += "23\n" + this.formatCoord(v4.y) + "\n";
		s += "33\n" + this.formatCoord(v4.z) + "\n";

		return s;
	}

	formatCoord(value) {
		if (value === undefined || value === null || isNaN(value)) return "0.000";
		return parseFloat(value).toFixed(this.decimalPlaces);
	}
}

export default DXF3DFACEWriter;
