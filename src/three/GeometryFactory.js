/* prettier-ignore-file */
//=================================================
// GeometryFactory.js - Reusable Three.js geometry creators
//=================================================
import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
// MeshLine removed - now using LineMaterial/LineSegments2 (fat lines) for all thick lines
import { Text } from "troika-three-text";
// Step A1) Fat Line imports for variable line thickness
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
// Step A2) BVH for accelerated raycasting on large surfaces
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
// Step A2b) Vector Font for high-performance text rendering (Hershey Simplex)
import * as VectorFont from "./VectorFont.js";

// Step A3) BVH configuration - minimum triangles to enable BVH acceleration
const BVH_MIN_TRIANGLES = 1000;

// Step 0) Text object cache to prevent recreation (performance)
const textCache = new Map(); // key: "x,y,z,text,fontSize,color"

// Step 0a) Clear text cache (call when clearing scene)
// CRITICAL FIX: Must dispose Troika text objects to prevent GPU memory leaks
export function clearTextCache() {
	// Step 0a.1) Dispose all cached text objects before clearing
	textCache.forEach(function(cachedItem) {
		if (cachedItem) {
			// Step 0a.1a) Troika Text objects have their own dispose method
			if (typeof cachedItem.dispose === "function") {
				cachedItem.dispose();
			}
			// Step 0a.1b) Also dispose geometry if it exists
			if (cachedItem.geometry) {
				cachedItem.geometry.dispose();
			}
			// Step 0a.1c) Dispose material and textures
			if (cachedItem.material) {
				if (cachedItem.material.map) {
					cachedItem.material.map.dispose();
				}
				cachedItem.material.dispose();
			}
			// Step 0a.1d) Handle groups (text with background) - dispose children
			if (cachedItem.isGroup && cachedItem.children) {
				cachedItem.children.forEach(function(child) {
					if (typeof child.dispose === "function") {
						child.dispose();
					}
					if (child.geometry) {
						child.geometry.dispose();
					}
					if (child.material) {
						if (child.material.map) {
							child.material.map.dispose();
						}
						child.material.dispose();
					}
				});
			}
		}
	});
	// Step 0a.2) Now clear the cache
	textCache.clear();
}

export class GeometryFactory {
	// Step 1) Create complete hole visualization (collar + grade circle + lines)
	// Matches 2D canvas drawTrack() implementation
	static createHole(collarX, collarY, collarZ, gradeX, gradeY, gradeZ, toeX, toeY, toeZ, diameter, color, holeScale = 1, subdrillAmount = 0, isDarkMode = false) {
		const group = new THREE.Group();

		// Step 2) Calculate dimensions
		const diameterInMeters = diameter / 1000;
		const radiusInMeters = (diameterInMeters / 2) * (holeScale * 2);
		const gradeRadiusInMeters = radiusInMeters * 0.5; // Grade circle is 30% of collar size

		// Step 3) Check if subdrill is negative
		const hasNegativeSubdrill = subdrillAmount < 0;

		// Step 4) Determine colors based on dark mode
		const collarColor = isDarkMode ? 0xffffff : 0x000000; // White in dark mode, black in light mode
		const lineColor = isDarkMode ? 0xffffff : 0x000000;

		// Step 5) Create collar circle (ALWAYS solid, never transparent)
		const collarGeometry = new THREE.CircleGeometry(radiusInMeters, 32);
		const collarMaterial = new THREE.MeshBasicMaterial({
			color: collarColor,
			side: THREE.DoubleSide,
			transparent: false, // Collar is NEVER transparent
			opacity: 1.0,
			depthTest: true, // Enable depth testing so holes don't show through surfaces
			depthWrite: true, // Write to depth buffer
		});
		const collarMesh = new THREE.Mesh(collarGeometry, collarMaterial);
		collarMesh.position.set(collarX, collarY, collarZ);
		group.add(collarMesh);

		if (hasNegativeSubdrill) {
			// NEGATIVE SUBDRILL CASE
			// Step 6a) Draw line from collar to toe (solid)
			const collarToToePoints = [new THREE.Vector3(collarX, collarY, collarZ), new THREE.Vector3(toeX, toeY, toeZ)];
			const collarToToeGeometry = new THREE.BufferGeometry().setFromPoints(collarToToePoints);
			const collarToToeMaterial = new THREE.LineBasicMaterial({
				color: lineColor,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const collarToToeLine = new THREE.Line(collarToToeGeometry, collarToToeMaterial);
			group.add(collarToToeLine);

			// Step 6b) Draw RED line from toe to grade (20% opacity = 80% transparent)
			const toeToGradePoints = [new THREE.Vector3(toeX, toeY, toeZ), new THREE.Vector3(gradeX, gradeY, gradeZ)];
			const toeToGradeGeometry = new THREE.BufferGeometry().setFromPoints(toeToGradePoints);
			const toeToGradeMaterial = new THREE.LineBasicMaterial({
				color: 0xff0000,
				linewidth: 1,
				transparent: true,
				opacity: 0.2,
			});
			const toeToGradeLine = new THREE.Line(toeToGradeGeometry, toeToGradeMaterial);
			group.add(toeToGradeLine);

			// Step 6c) Create RED grade circle (20% opacity)
			const gradeCircleGeometry = new THREE.CircleGeometry(gradeRadiusInMeters, 32);
			const gradeCircleMaterial = new THREE.MeshBasicMaterial({
				color: 0xff0000, // RED
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.2,
				depthTest: true, // Enable depth testing
				depthWrite: false, // Transparent objects shouldn't write to depth buffer
			});
			const gradeCircleMesh = new THREE.Mesh(gradeCircleGeometry, gradeCircleMaterial);
			gradeCircleMesh.position.set(gradeX, gradeY, gradeZ);
			group.add(gradeCircleMesh);
		} else {
			// POSITIVE SUBDRILL CASE (normal)
			// Step 7a) Draw line from collar to grade (solid, black/white)
			const collarToGradePoints = [new THREE.Vector3(collarX, collarY, collarZ), new THREE.Vector3(gradeX, gradeY, gradeZ)];
			const collarToGradeGeometry = new THREE.BufferGeometry().setFromPoints(collarToGradePoints);
			const collarToGradeMaterial = new THREE.LineBasicMaterial({
				color: lineColor,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const collarToGradeLine = new THREE.Line(collarToGradeGeometry, collarToGradeMaterial);
			group.add(collarToGradeLine);

			// Step 7b) Draw RED line from grade to toe (solid)
			const gradeToToePoints = [new THREE.Vector3(gradeX, gradeY, gradeZ), new THREE.Vector3(toeX, toeY, toeZ)];
			const gradeToToeGeometry = new THREE.BufferGeometry().setFromPoints(gradeToToePoints);
			const gradeToToeMaterial = new THREE.LineBasicMaterial({
				color: 0xff0000,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const gradeToToeLine = new THREE.Line(gradeToToeGeometry, gradeToToeMaterial);
			group.add(gradeToToeLine);

			// Step 7c) Create RED grade circle (solid)
			const gradeCircleGeometry = new THREE.CircleGeometry(gradeRadiusInMeters, 32);
			const gradeCircleMaterial = new THREE.MeshBasicMaterial({
				color: 0xff0000, // RED
				side: THREE.DoubleSide,
				transparent: false,
				opacity: 1.0,
				depthTest: true, // Enable depth testing
				depthWrite: true, // Write to depth buffer
			});
			const gradeCircleMesh = new THREE.Mesh(gradeCircleGeometry, gradeCircleMaterial);
			gradeCircleMesh.position.set(gradeX, gradeY, gradeZ);
			group.add(gradeCircleMesh);
		}

		return group;
	}

	// Step 4.5) Create hole track lines ONLY (no collar circle) - for use with instanced collars
	// Creates the track lines from collar->grade->toe without the collar/grade circles
	static createHoleTrack(collarX, collarY, collarZ, gradeX, gradeY, gradeZ, toeX, toeY, toeZ, diameter, color, holeScale = 1, subdrillAmount = 0, isDarkMode = false) {
		const group = new THREE.Group();

		// Step 1) Check if subdrill is negative
		const hasNegativeSubdrill = subdrillAmount < 0;

		// Step 2) Determine colors based on dark mode
		const lineColor = isDarkMode ? 0xffffff : 0x000000;

		if (hasNegativeSubdrill) {
			// NEGATIVE SUBDRILL CASE
			// Step 3a) Draw line from collar to toe (solid)
			const collarToToePoints = [new THREE.Vector3(collarX, collarY, collarZ), new THREE.Vector3(toeX, toeY, toeZ)];
			const collarToToeGeometry = new THREE.BufferGeometry().setFromPoints(collarToToePoints);
			const collarToToeMaterial = new THREE.LineBasicMaterial({
				color: lineColor,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const collarToToeLine = new THREE.Line(collarToToeGeometry, collarToToeMaterial);
			group.add(collarToToeLine);

			// Step 3b) Draw RED line from toe to grade (20% opacity = 80% transparent)
			const toeToGradePoints = [new THREE.Vector3(toeX, toeY, toeZ), new THREE.Vector3(gradeX, gradeY, gradeZ)];
			const toeToGradeGeometry = new THREE.BufferGeometry().setFromPoints(toeToGradePoints);
			const toeToGradeMaterial = new THREE.LineBasicMaterial({
				color: 0xff0000,
				linewidth: 1,
				transparent: true,
				opacity: 0.2,
			});
			const toeToGradeLine = new THREE.Line(toeToGradeGeometry, toeToGradeMaterial);
			group.add(toeToGradeLine);
		} else {
			// POSITIVE SUBDRILL CASE (normal)
			// Step 4a) Draw line from collar to grade (solid, black/white)
			const collarToGradePoints = [new THREE.Vector3(collarX, collarY, collarZ), new THREE.Vector3(gradeX, gradeY, gradeZ)];
			const collarToGradeGeometry = new THREE.BufferGeometry().setFromPoints(collarToGradePoints);
			const collarToGradeMaterial = new THREE.LineBasicMaterial({
				color: lineColor,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const collarToGradeLine = new THREE.Line(collarToGradeGeometry, collarToGradeMaterial);
			group.add(collarToGradeLine);

			// Step 4b) Draw RED SOLID line from grade to toe (subdrill portion)
			if (subdrillAmount > 0) {
				const gradeToToePoints = [new THREE.Vector3(gradeX, gradeY, gradeZ), new THREE.Vector3(toeX, toeY, toeZ)];
				const gradeToToeGeometry = new THREE.BufferGeometry().setFromPoints(gradeToToePoints);
				const gradeToToeMaterial = new THREE.LineBasicMaterial({
					color: 0xff0000,
					linewidth: 1,
					transparent: false,
					opacity: 1.0,
				});
				const gradeToToeLine = new THREE.Line(gradeToToeGeometry, gradeToToeMaterial);
				group.add(gradeToToeLine);
			}
		}

		return group;
	}

	// Step 5) Create a hole toe mesh (circle at toe elevation, facing upward for plan view visibility)
	static createHoleToe(worldX, worldY, worldZ, radius, color) {
		const geometry = new THREE.CircleGeometry(radius, 32);
		const material = new THREE.MeshBasicMaterial({
			color: new THREE.Color(color),
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.2,
			depthTest: true,
			depthWrite: false, // Prevent z-fighting with hole geometry
		});

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(worldX, worldY, worldZ);

		// Step 5a) CircleGeometry is created in XY plane facing +Z
		// In Kirra's Z-up coordinate system, this is already correct for plan view visibility
		// No rotation needed - circle lies flat in XY plane, visible from above

		return mesh;
	}

	// Step 6) Create a dummy hole (X shape) - 200mm * holeScale
	static createDummyHole(worldX, worldY, worldZ, radius, color) {
		const group = new THREE.Group();

		// Step 7) Create X with two lines
		const material = new THREE.LineBasicMaterial({
			color: color, // Use color directly (already a hex number)
			linewidth: 2,
		});

		// Line 1: top-left to bottom-right
		const points1 = [];
		points1.push(new THREE.Vector3(-radius, radius, 0));
		points1.push(new THREE.Vector3(radius, -radius, 0));
		const geometry1 = new THREE.BufferGeometry().setFromPoints(points1);
		const line1 = new THREE.Line(geometry1, material);

		// Line 2: top-right to bottom-left
		const points2 = [];
		points2.push(new THREE.Vector3(radius, radius, 0));
		points2.push(new THREE.Vector3(-radius, -radius, 0));
		const geometry2 = new THREE.BufferGeometry().setFromPoints(points2);
		const line2 = new THREE.Line(geometry2, material);

		group.add(line1);
		group.add(line2);
		group.position.set(worldX, worldY, worldZ);

		return group;
	}

	// Step 6b) Create a square hole (unfilled square) for zero diameter holes WITH track
	// This replaces the old createSquareHole which didn't include the track
	static createZeroDiameterHole(collarX, collarY, collarZ, gradeX, gradeY, gradeZ, toeX, toeY, toeZ, squareSize, subdrillAmount = 0, isDarkMode = false) {
		const group = new THREE.Group();

		// Step 7b) Determine colors based on dark mode
		const lineColor = isDarkMode ? 0xffffff : 0x000000;
		const hasNegativeSubdrill = subdrillAmount < 0;

		// Step 7c) Create unfilled square at collar
		const squareMaterial = new THREE.LineBasicMaterial({
			color: lineColor,
			linewidth: 2,
			depthTest: true, // Enable depth testing
		});

		const halfSide = squareSize / 2;
		const squarePoints = [new THREE.Vector3(-halfSide, -halfSide, 0), new THREE.Vector3(halfSide, -halfSide, 0), new THREE.Vector3(halfSide, halfSide, 0), new THREE.Vector3(-halfSide, halfSide, 0)];

		const squareGeometry = new THREE.BufferGeometry().setFromPoints(squarePoints);
		const square = new THREE.LineLoop(squareGeometry, squareMaterial);
		square.position.set(collarX, collarY, collarZ);
		square.renderOrder = 10;
		group.add(square);

		// Step 7d) Draw hole track (same logic as normal holes)
		if (hasNegativeSubdrill) {
			// NEGATIVE SUBDRILL: collar to toe (solid), toe to grade (transparent red)
			const collarToToePoints = [new THREE.Vector3(collarX, collarY, collarZ), new THREE.Vector3(toeX, toeY, toeZ)];
			const collarToToeGeometry = new THREE.BufferGeometry().setFromPoints(collarToToePoints);
			const collarToToeMaterial = new THREE.LineBasicMaterial({
				color: lineColor,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const collarToToeLine = new THREE.Line(collarToToeGeometry, collarToToeMaterial);
			group.add(collarToToeLine);

			// Red line from toe to grade (20% opacity)
			const toeToGradePoints = [new THREE.Vector3(toeX, toeY, toeZ), new THREE.Vector3(gradeX, gradeY, gradeZ)];
			const toeToGradeGeometry = new THREE.BufferGeometry().setFromPoints(toeToGradePoints);
			const toeToGradeMaterial = new THREE.LineBasicMaterial({
				color: 0xff0000,
				linewidth: 1,
				transparent: true,
				opacity: 0.2,
			});
			const toeToGradeLine = new THREE.Line(toeToGradeGeometry, toeToGradeMaterial);
			group.add(toeToGradeLine);
		} else {
			// POSITIVE SUBDRILL: collar to grade (solid black/white), grade to toe (solid red)
			const collarToGradePoints = [new THREE.Vector3(collarX, collarY, collarZ), new THREE.Vector3(gradeX, gradeY, gradeZ)];
			const collarToGradeGeometry = new THREE.BufferGeometry().setFromPoints(collarToGradePoints);
			const collarToGradeMaterial = new THREE.LineBasicMaterial({
				color: lineColor,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const collarToGradeLine = new THREE.Line(collarToGradeGeometry, collarToGradeMaterial);
			group.add(collarToGradeLine);

			// Red line from grade to toe (solid)
			const gradeToToePoints = [new THREE.Vector3(gradeX, gradeY, gradeZ), new THREE.Vector3(toeX, toeY, toeZ)];
			const gradeToToeGeometry = new THREE.BufferGeometry().setFromPoints(gradeToToePoints);
			const gradeToToeMaterial = new THREE.LineBasicMaterial({
				color: 0xff0000,
				linewidth: 1,
				transparent: false,
				opacity: 1.0,
			});
			const gradeToToeLine = new THREE.Line(gradeToToeGeometry, gradeToToeMaterial);
			group.add(gradeToToeLine);
		}

		return group;
	}

	// Step 8) Create hexagon hole
	static createHexagonHole(worldX, worldY, worldZ, sideLength, fillColor, strokeColor) {
		const geometry = new THREE.CircleGeometry(sideLength, 6);
		const material = new THREE.MeshBasicMaterial({
			color: new THREE.Color(fillColor),
			side: THREE.DoubleSide,
		});

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(worldX, worldY, worldZ);
		mesh.rotation.z = Math.PI / 6; // Rotate 30 degrees

		return mesh;
	}

	// Step 9) Create KAD point as flat circle Not used
	static createKADPointAsFlatCircle(worldX, worldY, worldZ, size, color) {
		const geometry = new THREE.CircleGeometry(size, 16);
		const material = new THREE.MeshBasicMaterial({
			color: new THREE.Color(color),
			side: THREE.DoubleSide,
		});

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(worldX, worldY, worldZ);

		return mesh;
	}

	static createKADPointAsOctahedron(worldX, worldY, worldZ, size, color) {
		// Step 1) Convert pixel size to world units
		const currentScale = window.currentScale || 5;
		const pixelRadius = size * 10;
		const worldRadius = pixelRadius / currentScale;

		// Step 2) Use OctahedronGeometry (cheaper than Cuboctahedron - 8 faces vs 14)
		const geometry = new THREE.OctahedronGeometry(worldRadius, 0);
		const material = new THREE.MeshBasicMaterial({
			color: new THREE.Color(color),
			side: THREE.DoubleSide,
		});

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(worldX, worldY, worldZ);

		// Step 3) Store for screen-space scaling
		mesh.userData.screenSpaceSize = pixelRadius;
		mesh.userData.isScreenSpacePoint = true;

		return mesh;
	}

	static createKADPoint(worldX, worldY, worldZ, size, color) {
		// Step 1) Convert pixel size to world units
		// Step 2) Convert size to pixel size (size is diameter in pixels)
		const pixelSize = size * 10; // Scale factor for visibility

		// Step 3) Create BufferGeometry with single point
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute([worldX, worldY, worldZ], 3));

		// Step 4) Create simple PointsMaterial WITHOUT texture (more efficient)
		// No canvas texture = no WebGL context exhaustion, better performance
		const material = new THREE.PointsMaterial({
			color: new THREE.Color(color), // Direct color (no texture tinting)
			size: pixelSize, // Size in pixels when sizeAttenuation is false
			sizeAttenuation: false, // KEY: Maintains constant pixel size regardless of zoom
			depthTest: true,
			depthWrite: true
		});

		// Step 5) Create Points object
		const points = new THREE.Points(geometry, material);
		points.position.set(0, 0, 0); // Points are positioned via geometry attributes

		return points;
	}

	// Step 9a) Split large polyline into manageable chunks to prevent GPU exhaustion
	// For polylines with >maxVerticesPerChunk vertices, split into multiple smaller geometries
	// This prevents WebGL context loss from oversized buffers (72k vertices causes crashes)
	static splitPolylineIntoChunks(pointsArray, maxVerticesPerChunk) {
		if (!pointsArray || pointsArray.length <= maxVerticesPerChunk) {
			// Step 9a.1) Small enough - return as single chunk
			return [pointsArray];
		}
		
		// Step 9a.2) Split into overlapping chunks (overlap by 1 vertex to maintain continuity)
		var chunks = [];
		var startIdx = 0;
		
		while (startIdx < pointsArray.length) {
			// Step 9a.3) Calculate chunk end (ensure we don't exceed array bounds)
			var endIdx = Math.min(startIdx + maxVerticesPerChunk, pointsArray.length);
			
			// Step 9a.4) Extract chunk
			var chunk = pointsArray.slice(startIdx, endIdx);
			chunks.push(chunk);
			
			// Step 9a.5) Move to next chunk with 1-vertex overlap for continuity
			// If this was the last chunk, break
			if (endIdx >= pointsArray.length) break;
			
			// Overlap by 1 vertex so lines connect visually
			startIdx = endIdx - 1;
		}
		
		console.log("✂️ Split large polyline (" + pointsArray.length + " vertices) into " + chunks.length + " chunks to prevent GPU exhaustion");
		return chunks;
	}

	// Step 9a.5) Shared material cache to reduce GPU memory
	// Instead of creating new material for each polyline, reuse materials with same properties
	static _lineMaterialCache = new Map();

	static getSharedLineMaterial(lineWidth, resolution) {
		// Step 9a.5a) Create cache key based on material properties
		var cacheKey = "lw" + lineWidth + "_res" + resolution.width + "x" + resolution.height;
		
		// Step 9a.5b) Return cached material if exists
		if (this._lineMaterialCache.has(cacheKey)) {
			return this._lineMaterialCache.get(cacheKey);
		}
		
		// Step 9a.5c) Create new material and cache it
		var material = new LineMaterial({
			color: 0xffffff,
			linewidth: lineWidth,
			vertexColors: true,
			resolution: resolution,
			dashed: false,
			alphaToCoverage: true
		});
		material.depthTest = true;
		material.depthWrite = true;
		
		this._lineMaterialCache.set(cacheKey, material);
		console.log("📦 Created new LineMaterial (cache size: " + this._lineMaterialCache.size + ")");
		return material;
	}

	// Step 9b) FAST: Create batched polyline - OPTIMIZED for large DXF files
	// HYBRID: Thin lines use LineBasicMaterial, thick lines use LineMaterial
	// Key optimizations: pre-allocated typed arrays, inline hex parsing, no THREE.Color overhead
	static createBatchedPolyline(pointsArray, lineWidth, defaultColor, isPolygon = false) {
		var len = pointsArray.length;
		if (len < 2) return null;

		// Step 0) Parse default color ONCE (inline hex parsing - 10x faster than THREE.Color.set)
		var defR = 0.467, defG = 0.467, defB = 0.467; // #777777 default
		if (defaultColor && defaultColor.charAt(0) === "#" && defaultColor.length >= 7) {
			var hex = parseInt(defaultColor.slice(1, 7), 16);
			defR = ((hex >> 16) & 255) / 255;
			defG = ((hex >> 8) & 255) / 255;
			defB = (hex & 255) / 255;
		}

		// Step 1) Build segment arrays (same format for both thin and thick lines)
		var numSegments = isPolygon ? len : len - 1;
		var positions = new Float32Array(numSegments * 6); // 2 points per segment, 3 floats per point
		var colors = new Float32Array(numSegments * 6);
		
		var posIdx = 0;
		var colIdx = 0;
		
		for (var i = 0; i < numSegments; i++) {
			var p1 = pointsArray[i];
			var p2 = pointsArray[(i + 1) % len]; // Wrap around for polygon
			
			// Start point
			positions[posIdx++] = p1.x;
			positions[posIdx++] = p1.y;
			positions[posIdx++] = p1.z || 0;
			// End point
			positions[posIdx++] = p2.x;
			positions[posIdx++] = p2.y;
			positions[posIdx++] = p2.z || 0;
			
			// Parse color for this segment (use p2's color - segment TO the point uses that point's color)
			var col = p2.color; 
			var r = defR, g = defG, b = defB;
			if (col && col.charAt(0) === "#" && col.length >= 7) {
				var hex = parseInt(col.slice(1, 7), 16);
				r = ((hex >> 16) & 255) / 255;
				g = ((hex >> 8) & 255) / 255;
				b = (hex & 255) / 255;
			}
			// Both vertices of segment get same color
			colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
			colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
		}
		
		// Step 2) Choose rendering path based on lineWidth
		var effectiveLineWidth = lineWidth || 1;
		
		if (effectiveLineWidth > 1) {
			// Step 2a) THICK LINES: Use LineMaterial + LineSegments2 (supports variable width)
			var geometry = new LineSegmentsGeometry();
			geometry.setPositions(positions);
			geometry.setColors(colors);
			
			// Step 2b) Create NEW LineMaterial for each chunk (no sharing to avoid shader issues)
			var material = new LineMaterial({
				color: 0xffffff,
				linewidth: effectiveLineWidth,
				vertexColors: true,
				resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
				dashed: false,
				alphaToCoverage: true
			});
			material.depthTest = true;
			material.depthWrite = true;
			
			// Step 2c) Create LineSegments2
			var lineSegments = new LineSegments2(geometry, material);
			lineSegments.computeLineDistances();
			lineSegments.name = isPolygon ? "kad-polygon-fat" : "kad-line-fat";
			
			return lineSegments;
		} else {
			// Step 2d) THIN LINES: Use LineBasicMaterial (simple, fast, no shader complexity)
			var geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
			
			var material = new THREE.LineBasicMaterial({
				vertexColors: true,
				linewidth: 1,
				depthTest: true,
				depthWrite: true
			});
			
			var lineSegments = new THREE.LineSegments(geometry, material);
			lineSegments.name = isPolygon ? "kad-polygon-thin" : "kad-line-thin";
			
			return lineSegments;
		}
	}

	// Step 9c) SUPER-BATCH: Merge ALL KAD lines/polys into ONE geometry (ONE draw call!)
	// This is the ultimate optimization for large DXF files (3000+ entities)
	// Uses THREE.LineSegments which draws disconnected line pairs
	// Returns { lineSegments: THREE.LineSegments, entityRanges: Map } for selection support
	static createSuperBatchedLines(allEntities, worldToThreeLocal) {
		if (!allEntities || allEntities.length === 0) return null;
		
		// Step 1) Count total segments to pre-allocate arrays
		var totalSegments = 0;
		for (var i = 0; i < allEntities.length; i++) {
			var entity = allEntities[i];
			if (entity.visible === false) continue;
			if (entity.entityType !== "line" && entity.entityType !== "poly") continue;
			var points = entity.data;
			if (!points || points.length < 2) continue;
			
			// Each polyline of N points has N-1 segments (or N for closed polygons)
			var numSegments = entity.entityType === "poly" ? points.length : points.length - 1;
			totalSegments += numSegments;
		}
		
		if (totalSegments === 0) return null;
		
		// Step 2) Pre-allocate arrays: each segment = 2 vertices, each vertex = 3 floats
		var positions = new Float32Array(totalSegments * 6); // 2 verts * 3 floats
		var colors = new Float32Array(totalSegments * 6);    // 2 verts * 3 RGB
		
		// Step 3) Track entity ranges for selection: Map<entityName, {start, end}>
		var entityRanges = new Map();
		var segmentIndex = 0;
		var posIdx = 0;
		var colIdx = 0;
		
		// Step 4) Default color parsing
		var defR = 0.467, defG = 0.467, defB = 0.467; // #777777
		
		// Step 5) Fill arrays by iterating all entities
		for (var i = 0; i < allEntities.length; i++) {
			var entity = allEntities[i];
			if (entity.visible === false) continue;
			if (entity.entityType !== "line" && entity.entityType !== "poly") continue;
			var points = entity.data;
			if (!points || points.length < 2) continue;
			
			// Filter visible points
			var visiblePoints = [];
			for (var j = 0; j < points.length; j++) {
				if (points[j].visible !== false) visiblePoints.push(points[j]);
			}
			if (visiblePoints.length < 2) continue;
			
			// Record start segment index for this entity
			var startSegment = segmentIndex;
			var isPoly = entity.entityType === "poly";
			var numPts = visiblePoints.length;
			var numSegs = isPoly ? numPts : numPts - 1;
			
			// Step 5a) Add segments for this entity
			for (var s = 0; s < numSegs; s++) {
				var p1 = visiblePoints[s];
				var p2 = visiblePoints[(s + 1) % numPts]; // Wrap for polygons
				
				// Convert to local coords
				var local1 = worldToThreeLocal(p1.pointXLocation, p1.pointYLocation);
				var local2 = worldToThreeLocal(p2.pointXLocation, p2.pointYLocation);
				
				// Positions: vertex 1
				positions[posIdx++] = local1.x;
				positions[posIdx++] = local1.y;
				positions[posIdx++] = p1.pointZLocation || 0;
				// Positions: vertex 2
				positions[posIdx++] = local2.x;
				positions[posIdx++] = local2.y;
				positions[posIdx++] = p2.pointZLocation || 0;
				
				// Colors: parse p1 color for both vertices of this segment
				var col = p1.color;
				var r = defR, g = defG, b = defB;
				if (col && col.charAt(0) === "#" && col.length >= 7) {
					var hex = parseInt(col.slice(1, 7), 16);
					r = ((hex >> 16) & 255) / 255;
					g = ((hex >> 8) & 255) / 255;
					b = (hex & 255) / 255;
				}
				colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
				colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
				
				segmentIndex++;
			}
			
			// Record entity range
			entityRanges.set(entity.entityName, { start: startSegment, end: segmentIndex - 1 });
		}
		
		// Step 6) Create geometry
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		
		// Step 7) Create material
		var material = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: true,
			depthWrite: true,
		});
		
		// Step 8) Create LineSegments (draws pairs of vertices as disconnected lines)
		var lineSegments = new THREE.LineSegments(geometry, material);
		lineSegments.name = "kad-super-batch";
		lineSegments.userData = { type: "kadSuperBatch", entityRanges: entityRanges };
		
		return { lineSegments: lineSegments, entityRanges: entityRanges, segmentCount: totalSegments };
	}

	// Step 9c-v2) HYBRID SUPER-BATCH: Thin lines use LineBasic, thick lines use FatLines
	// Splits entities by lineWidth: <=1 goes to fast LineSegments, >1 goes to LineSegments2
	// Returns { thinLineSegments, fatLinesByWidth, entityRanges }
	static createHybridSuperBatchedLines(allEntities, worldToThreeLocal, resolution) {
		if (!allEntities || allEntities.length === 0) return null;

		// Step 1) Separate thin (<=1) vs thick (>1) entities
		var thinEntities = [];
		var thickEntitiesByWidth = new Map(); // lineWidth -> [entities]

		for (var i = 0; i < allEntities.length; i++) {
			var entity = allEntities[i];
			if (entity.visible === false) continue;
			if (entity.entityType !== "line" && entity.entityType !== "poly") continue;
			var points = entity.data;
			if (!points || points.length < 2) continue;

			// Check if lineWidths vary within entity - if they do, skip super-batching
			var firstWidth = (points[0] && points[0].lineWidth) || 1;
			var hasVaryingWidths = false;
			for (var j = 1; j < points.length; j++) {
				var currentWidth = (points[j] && points[j].lineWidth) || 1;
				if (currentWidth !== firstWidth) {
					hasVaryingWidths = true;
					break;
				}
			}

			// Skip entities with varying lineWidths - they should use segment-by-segment rendering
			if (hasVaryingWidths) continue;

			var lineWidth = firstWidth;
			
			if (lineWidth <= 1) {
				// Standard thin line - goes to fast LineBasicMaterial batch
				thinEntities.push(entity);
			} else {
				// Thick line - goes to FatLine batch grouped by width
				var roundedWidth = Math.round(lineWidth * 2) / 2; // Round to 0.5
				if (!thickEntitiesByWidth.has(roundedWidth)) {
					thickEntitiesByWidth.set(roundedWidth, []);
				}
				thickEntitiesByWidth.get(roundedWidth).push(entity);
			}
		}
		
		var entityRanges = new Map(); // Maps entityName -> {start, end, lineWidth} (also serves as list of batched entities)
		var result = {
			thinLineSegments: null,
			fatLinesByWidth: new Map(),
			entityRanges: entityRanges, // Caller can use entityRanges.has(entityName) to check if batched
			thinCount: 0,
			thickCount: 0
		};
		
		// Step 2) Create thin lines batch (existing LineBasicMaterial approach)
		if (thinEntities.length > 0) {
			var thinResult = this._createThinLinesBatch(thinEntities, worldToThreeLocal, entityRanges, 0);
			if (thinResult) {
				result.thinLineSegments = thinResult.lineSegments;
				result.thinCount = thinResult.segmentCount;
			}
		}
		
		// Step 3) Create thick lines batches (FatLine approach) - only if any exist
		if (thickEntitiesByWidth.size > 0) {
			var globalSegmentOffset = result.thinCount;
			
			thickEntitiesByWidth.forEach(function(entities, lineWidth) {
				var fatBatch = GeometryFactory._createFatLinesBatch(
					entities, worldToThreeLocal, entityRanges, lineWidth, resolution, globalSegmentOffset
				);
				if (fatBatch) {
					result.fatLinesByWidth.set(lineWidth, fatBatch.lineSegments);
					result.thickCount += fatBatch.segmentCount;
					globalSegmentOffset += fatBatch.segmentCount;
				}
			});
		}
		
		return result;
	}
	
	// Step 9c-v2a) Helper: Create thin lines batch with LineBasicMaterial (fast, 1 draw call)
	static _createThinLinesBatch(entities, worldToThreeLocal, entityRanges, segmentOffset) {
		// Step 1) Count total segments
		var totalSegments = 0;
		for (var i = 0; i < entities.length; i++) {
			var entity = entities[i];
			if (entity.visible === false) continue;
			var points = entity.data;
			if (!points || points.length < 2) continue;

			var visiblePoints = [];
			for (var j = 0; j < points.length; j++) {
				if (points[j].visible !== false) visiblePoints.push(points[j]);
			}
			if (visiblePoints.length < 2) continue;

			var numSegments = entity.entityType === "poly" ? visiblePoints.length : visiblePoints.length - 1;
			totalSegments += numSegments;
		}

		if (totalSegments === 0) return null;

		// Step 2) Pre-allocate arrays
		var positions = new Float32Array(totalSegments * 6);
		var colors = new Float32Array(totalSegments * 6);

		var posIdx = 0;
		var colIdx = 0;
		var segmentIndex = 0;
		var defR = 0.467, defG = 0.467, defB = 0.467;

		// Step 3) Fill arrays
		for (var i = 0; i < entities.length; i++) {
			var entity = entities[i];
			if (entity.visible === false) continue;
			var points = entity.data;
			if (!points || points.length < 2) continue;

			var visiblePoints = [];
			for (var j = 0; j < points.length; j++) {
				if (points[j].visible !== false) visiblePoints.push(points[j]);
			}
			if (visiblePoints.length < 2) continue;

			var startSegment = segmentOffset + segmentIndex;
			var isPoly = entity.entityType === "poly";
			var numPts = visiblePoints.length;
			var numSegs = isPoly ? numPts : numPts - 1;

			for (var s = 0; s < numSegs; s++) {
				var p1 = visiblePoints[s];
				var p2 = visiblePoints[(s + 1) % numPts];

				var local1 = worldToThreeLocal(p1.pointXLocation, p1.pointYLocation);
				var local2 = worldToThreeLocal(p2.pointXLocation, p2.pointYLocation);

				positions[posIdx++] = local1.x;
				positions[posIdx++] = local1.y;
				positions[posIdx++] = p1.pointZLocation || 0;
				positions[posIdx++] = local2.x;
				positions[posIdx++] = local2.y;
				positions[posIdx++] = p2.pointZLocation || 0;

				// Use p2's color - segment TO the point uses that point's color (matches 2D)
				var col = p2.color;
				var r = defR, g = defG, b = defB;
				if (col && col.charAt(0) === "#" && col.length >= 7) {
					var hex = parseInt(col.slice(1, 7), 16);
					r = ((hex >> 16) & 255) / 255;
					g = ((hex >> 8) & 255) / 255;
					b = (hex & 255) / 255;
				}
				colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
				colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
				
				segmentIndex++;
			}
			
			entityRanges.set(entity.entityName, { start: startSegment, end: segmentOffset + segmentIndex - 1, lineWidth: 1 });
		}
		
		// Step 4) Create geometry and material
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		
		var material = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: true,
			depthWrite: true
		});
		
		var lineSegments = new THREE.LineSegments(geometry, material);
		lineSegments.name = "kad-hybrid-thin";
		lineSegments.userData = { type: "kadHybridThin", segmentCount: totalSegments };
		
		return { lineSegments: lineSegments, segmentCount: totalSegments };
	}
	
	// Step 9c-v2b) Helper: Create fat lines batch with LineMaterial (screen-space thick lines)
	static _createFatLinesBatch(entities, worldToThreeLocal, entityRanges, lineWidth, resolution, segmentOffset) {
		// Step 1) Count segments for this group
		var groupSegments = 0;
		for (var i = 0; i < entities.length; i++) {
			var entity = entities[i];
			if (entity.visible === false) continue;
			var points = entity.data;
			if (!points || points.length < 2) continue;

			var visiblePoints = [];
			for (var j = 0; j < points.length; j++) {
				if (points[j].visible !== false) visiblePoints.push(points[j]);
			}
			if (visiblePoints.length < 2) continue;

			var numSegs = entity.entityType === "poly" ? visiblePoints.length : visiblePoints.length - 1;
			groupSegments += numSegs;
		}

		if (groupSegments === 0) return null;

		// Step 2) Pre-allocate arrays - LineSegmentsGeometry uses flat array format
		var positions = new Float32Array(groupSegments * 6);
		var colors = new Float32Array(groupSegments * 6);

		var posIdx = 0;
		var colIdx = 0;
		var segmentIndex = 0;
		var defR = 0.467, defG = 0.467, defB = 0.467;

		// Step 3) Fill arrays
		for (var i = 0; i < entities.length; i++) {
			var entity = entities[i];
			if (entity.visible === false) continue;
			var points = entity.data;
			if (!points || points.length < 2) continue;

			var visiblePoints = [];
			for (var j = 0; j < points.length; j++) {
				if (points[j].visible !== false) visiblePoints.push(points[j]);
			}
			if (visiblePoints.length < 2) continue;

			var startSegment = segmentOffset + segmentIndex;
			var isPoly = entity.entityType === "poly";
			var numPts = visiblePoints.length;
			var numSegs = isPoly ? numPts : numPts - 1;

			for (var s = 0; s < numSegs; s++) {
				var p1 = visiblePoints[s];
				var p2 = visiblePoints[(s + 1) % numPts];

				var local1 = worldToThreeLocal(p1.pointXLocation, p1.pointYLocation);
				var local2 = worldToThreeLocal(p2.pointXLocation, p2.pointYLocation);

				positions[posIdx++] = local1.x;
				positions[posIdx++] = local1.y;
				positions[posIdx++] = p1.pointZLocation || 0;
				positions[posIdx++] = local2.x;
				positions[posIdx++] = local2.y;
				positions[posIdx++] = p2.pointZLocation || 0;

				// Use p2's color - segment TO the point uses that point's color (matches 2D)
				var col = p2.color;
				var r = defR, g = defG, b = defB;
				if (col && col.charAt(0) === "#" && col.length >= 7) {
					var hex = parseInt(col.slice(1, 7), 16);
					r = ((hex >> 16) & 255) / 255;
					g = ((hex >> 8) & 255) / 255;
					b = (hex & 255) / 255;
				}
				colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
				colors[colIdx++] = r; colors[colIdx++] = g; colors[colIdx++] = b;
				
				segmentIndex++;
			}
			
			entityRanges.set(entity.entityName, { start: startSegment, end: segmentOffset + segmentIndex - 1, lineWidth: lineWidth });
		}
		
		// Step 4) Create LineSegmentsGeometry (fat line compatible)
		var geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);
		geometry.setColors(colors);
		
		// Step 5) Create LineMaterial with screen-space linewidth
		var material = new LineMaterial({
			color: 0xffffff,
			linewidth: lineWidth,
			vertexColors: true,
			resolution: resolution,
			dashed: false,
			alphaToCoverage: true
		});
		material.depthTest = true;
		material.depthWrite = true;
		
		// Step 6) Create LineSegments2
		var lineSegments = new LineSegments2(geometry, material);
		lineSegments.computeLineDistances();
		lineSegments.name = "kad-hybrid-fat-" + lineWidth;
		lineSegments.userData = { 
			type: "kadHybridFat", 
			lineWidth: lineWidth,
			segmentCount: groupSegments
		};
		
		return { lineSegments: lineSegments, segmentCount: groupSegments };
	}

	// Step 9.5) SUPER-BATCH: Create a single THREE.Points geometry for ALL KAD points
	// One draw call for thousands of points!
	static createSuperBatchedPoints(allPointEntities, worldToThreeLocal) {
		if (!allPointEntities || allPointEntities.length === 0) return null;
		
		// Step 1) Count total points to pre-allocate arrays
		var totalPoints = 0;
		var entityMetadata = []; // Store entity info for selection
		
		for (var i = 0; i < allPointEntities.length; i++) {
			var entity = allPointEntities[i];
			if (!entity.data) continue;
			for (var j = 0; j < entity.data.length; j++) {
				if (entity.data[j].visible !== false) {
					totalPoints++;
				}
			}
		}
		
		if (totalPoints === 0) return null;
		
		// Step 2) Pre-allocate typed arrays (3 floats per position, 3 per color, 1 per size)
		var positions = new Float32Array(totalPoints * 3);
		var colors = new Float32Array(totalPoints * 3);
		var sizes = new Float32Array(totalPoints);
		
		// Step 3) Default color parsing
		var defaultR = 1.0, defaultG = 0.0, defaultB = 0.0; // Red default
		
		// Step 4) Fill arrays
		var posIdx = 0;
		var colorIdx = 0;
		var sizeIdx = 0;
		var pointIndex = 0; // Global index for selection
		
		for (var i = 0; i < allPointEntities.length; i++) {
			var entity = allPointEntities[i];
			if (!entity.data) continue;
			
			var entityStartIndex = pointIndex;
			
			for (var j = 0; j < entity.data.length; j++) {
				var pt = entity.data[j];
				if (pt.visible === false) continue;
				
				// Position
				var local = worldToThreeLocal(pt.pointXLocation, pt.pointYLocation);
				positions[posIdx++] = local.x;
				positions[posIdx++] = local.y;
				positions[posIdx++] = pt.pointZLocation || 0;
				
				// Color - parse hex inline for speed
				var r = defaultR, g = defaultG, b = defaultB;
				var col = pt.color;
				if (col && typeof col === "string" && col.length >= 7 && col.charAt(0) === "#") {
					var hex = parseInt(col.slice(1, 7), 16);
					r = ((hex >> 16) & 255) / 255;
					g = ((hex >> 8) & 255) / 255;
					b = (hex & 255) / 255;
				}
				colors[colorIdx++] = r;
				colors[colorIdx++] = g;
				colors[colorIdx++] = b;
				
				// Size - convert lineWidth to pixel size
				var size = ((pt.lineWidth || 2) / 2) * 5; // Scale factor for visibility
				sizes[sizeIdx++] = size;
				
				// Store metadata for this point
				entityMetadata.push({
					entityName: entity.entityName,
					vertexIndex: j,
					kadId: entity.entityName + ":::" + j
				});
				
				pointIndex++;
			}
		}
		
		// Step 5) Create geometry
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
		
		// Step 6) Create circular texture for points (shared)
		//Commented out to improve performance and not use texture
		// var canvas = document.createElement("canvas");
		// canvas.width = 64;
		// canvas.height = 64;
		// var ctx = canvas.getContext("2d");
		// ctx.fillStyle = "#ffffff";
		// ctx.beginPath();
		// ctx.arc(32, 32, 30, 0, Math.PI * 2);
		// ctx.fill();
		// var circleTexture = new THREE.CanvasTexture(canvas);
		
		// Step 7) Create PointsMaterial with vertex colors
		var material = new THREE.PointsMaterial({
			vertexColors: true,
			size: 5,  // Adjust size as needed
			sizeAttenuation: false,  // ✅ Key: constant pixel size
			alphaTest: 0.1,
			depthTest: true,
			depthWrite: false
		});
		
		// Step 8) Create Points object
		var points = new THREE.Points(geometry, material);
		points.name = "kad-super-batch-points";
		points.userData = {
			type: "kadSuperBatchPoints",
			entityMetadata: entityMetadata,
			totalPoints: totalPoints
		};
		
		return { points: points, entityMetadata: entityMetadata, totalPoints: totalPoints };
	}

	// Step 9.6) SUPER-BATCH: Create a single geometry for ALL KAD circles
	// Uses LineSegments with many circle outlines batched together
	static createSuperBatchedCircles(allCircleEntities, worldToThreeLocal) {
		if (!allCircleEntities || allCircleEntities.length === 0) return null;
		
		// Step 1) Count total segments (each circle has 64 segments)
		var segmentsPerCircle = 64;
		var totalCircles = 0;
		
		for (var i = 0; i < allCircleEntities.length; i++) {
			var entity = allCircleEntities[i];
			if (!entity.data) continue;
			for (var j = 0; j < entity.data.length; j++) {
				if (entity.data[j].visible !== false) {
					totalCircles++;
				}
			}
		}
		
		if (totalCircles === 0) return null;
		
		var totalSegments = totalCircles * segmentsPerCircle;
		
		// Step 2) Pre-allocate typed arrays (2 vertices per segment, 3 floats each)
		var positions = new Float32Array(totalSegments * 6); // 2 vertices * 3 coords
		var colors = new Float32Array(totalSegments * 6); // 2 vertices * 3 colors
		var entityMetadata = []; // Store entity info for selection
		
		// Step 3) Default color
		var defaultR = 0.0, defaultG = 0.5, defaultB = 1.0; // Blue default
		
		// Step 4) Fill arrays
		var posIdx = 0;
		var colorIdx = 0;
		var circleIndex = 0;
		
		for (var i = 0; i < allCircleEntities.length; i++) {
			var entity = allCircleEntities[i];
			if (!entity.data) continue;
			
			for (var j = 0; j < entity.data.length; j++) {
				var circleData = entity.data[j];
				if (circleData.visible === false) continue;
				
				// Get circle center and radius
				var local = worldToThreeLocal(circleData.pointXLocation, circleData.pointYLocation);
				var cx = local.x;
				var cy = local.y;
				var cz = circleData.pointZLocation || 0;
				var radius = circleData.radius || 1;
				
				// Parse color
				var r = defaultR, g = defaultG, b = defaultB;
				var col = circleData.color;
				if (col && typeof col === "string" && col.length >= 7 && col.charAt(0) === "#") {
					var hex = parseInt(col.slice(1, 7), 16);
					r = ((hex >> 16) & 255) / 255;
					g = ((hex >> 8) & 255) / 255;
					b = (hex & 255) / 255;
				}
				
				// Generate circle segments
				for (var k = 0; k < segmentsPerCircle; k++) {
					var theta1 = (k / segmentsPerCircle) * Math.PI * 2;
					var theta2 = ((k + 1) / segmentsPerCircle) * Math.PI * 2;
					
					var x1 = cx + radius * Math.cos(theta1);
					var y1 = cy + radius * Math.sin(theta1);
					var x2 = cx + radius * Math.cos(theta2);
					var y2 = cy + radius * Math.sin(theta2);
					
					// Start vertex
					positions[posIdx++] = x1;
					positions[posIdx++] = y1;
					positions[posIdx++] = cz;
					colors[colorIdx++] = r;
					colors[colorIdx++] = g;
					colors[colorIdx++] = b;
					
					// End vertex
					positions[posIdx++] = x2;
					positions[posIdx++] = y2;
					positions[posIdx++] = cz;
					colors[colorIdx++] = r;
					colors[colorIdx++] = g;
					colors[colorIdx++] = b;
				}
				
				// Store metadata
				entityMetadata.push({
					entityName: entity.entityName,
					vertexIndex: j,
					kadId: entity.entityName + ":::" + j,
					startSegment: circleIndex * segmentsPerCircle,
					endSegment: (circleIndex + 1) * segmentsPerCircle - 1
				});
				
				circleIndex++;
			}
		}
		
		// Step 5) Create geometry
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		
		// Step 6) Create material
		var material = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: true,
			depthWrite: true
		});
		
		// Step 7) Create LineSegments object
		var lineSegments = new THREE.LineSegments(geometry, material);
		lineSegments.name = "kad-super-batch-circles";
		lineSegments.userData = {
			type: "kadSuperBatchCircles",
			entityMetadata: entityMetadata,
			totalCircles: totalCircles
		};
		
		return { lineSegments: lineSegments, entityMetadata: entityMetadata, totalCircles: totalCircles };
	}

	// ========================================
	// HOLE LOD BATCH METHODS - For pixel-based LOD rendering
	// ========================================
	// These methods create batched geometry for holes at lower LOD levels
	// Used when holes are small on screen (< 20px) to reduce draw calls

	/**
	 * Step LOD-BATCH1) Create batched points for POINT_ONLY LOD level
	 * Used when hole screen size < 10px
	 * Creates a single THREE.Points object for all holes = 1 draw call
	 * 
	 * @param {Array} holes - Array of blast hole objects
	 * @param {Function} worldToThreeLocal - Coordinate transform function
	 * @param {number} pointSize - Point size in pixels (default 2)
	 * @returns {Object} { points: THREE.Points, holeCount: number }
	 */
	static createHoleLODPoints(holes, worldToThreeLocal, pointSize) {
		// Step LOD-BATCH1a) Validate input
		if (!holes || holes.length === 0) return null;
		
		// Step LOD-BATCH1b) Default point size is 2 pixels (constant screen size)
		var finalPointSize = pointSize !== undefined ? pointSize : 2;
		
		// Step LOD-BATCH1c) Count visible holes for array pre-allocation
		var visibleCount = 0;
		for (var i = 0; i < holes.length; i++) {
			if (holes[i].visible !== false) {
				visibleCount++;
			}
		}
		
		if (visibleCount === 0) return null;
		
		// Step LOD-BATCH1d) Pre-allocate typed arrays (1 point per hole)
		var positions = new Float32Array(visibleCount * 3);
		var colors = new Float32Array(visibleCount * 3);
		
		// Step LOD-BATCH1e) Fill position and color arrays
		var posIdx = 0;
		var colorIdx = 0;
		var holeMetadata = []; // For selection support
		
		for (var i = 0; i < holes.length; i++) {
			var hole = holes[i];
			if (hole.visible === false) continue;
			
			// Step LOD-BATCH1f) Transform collar position to local coords
			var local = worldToThreeLocal(hole.startXLocation, hole.startYLocation);
			positions[posIdx++] = local.x;
			positions[posIdx++] = local.y;
			positions[posIdx++] = hole.startZLocation || 0;
			
			// Step LOD-BATCH1g) Parse hole color
			var colorHex = hole.colorHexDecimal || hole.holeColor || "#FF0000";
			var threeColor = new THREE.Color(colorHex);
			colors[colorIdx++] = threeColor.r;
			colors[colorIdx++] = threeColor.g;
			colors[colorIdx++] = threeColor.b;
			
			// Step LOD-BATCH1h) Store metadata for selection
			holeMetadata.push({
				index: holeMetadata.length,
				holeID: hole.holeID,
				entityName: hole.entityName
			});
		}
		
		// Step LOD-BATCH1i) Create BufferGeometry
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		
		// Step LOD-BATCH1j) Create PointsMaterial with vertex colors
		// sizeAttenuation: false = constant screen pixel size
		var material = new THREE.PointsMaterial({
			vertexColors: true,
			size: finalPointSize,
			sizeAttenuation: false, // KEY: Constant 2px regardless of zoom
			depthTest: true,
			depthWrite: true
		});
		
		// Step LOD-BATCH1k) Create Points object
		var points = new THREE.Points(geometry, material);
		points.name = "hole-lod-points-batch";
		points.userData = {
			type: "holeLODPoints",
			lodLevel: "POINT_ONLY",
			holeMetadata: holeMetadata,
			holeCount: visibleCount
		};
		
		return {
			points: points,
			holeMetadata: holeMetadata,
			holeCount: visibleCount
		};
	}

	/**
	 * Step LOD-BATCH2) Create batched points + track lines for POINT_TRACK LOD level
	 * Used when hole screen size 10-20px
	 * Creates TWO objects: points batch + lines batch = 2 draw calls
	 * 
	 * @param {Array} holes - Array of blast hole objects
	 * @param {Function} worldToThreeLocal - Coordinate transform function
	 * @param {number} pointSize - Point size in pixels (default 2)
	 * @returns {Object} { points: THREE.Points, lines: THREE.LineSegments, holeCount: number }
	 */
	static createHoleLODPointsWithTrack(holes, worldToThreeLocal, pointSize) {
		// Step LOD-BATCH2a) Validate input
		if (!holes || holes.length === 0) return null;
		
		// Step LOD-BATCH2b) Default point size is 2 pixels
		var finalPointSize = pointSize !== undefined ? pointSize : 2;
		
		// Step LOD-BATCH2c) Count visible holes
		var visibleCount = 0;
		for (var i = 0; i < holes.length; i++) {
			if (holes[i].visible !== false) {
				visibleCount++;
			}
		}
		
		if (visibleCount === 0) return null;
		
		// Step LOD-BATCH2d) Pre-allocate arrays for points (collar position)
		var pointPositions = new Float32Array(visibleCount * 3);
		var pointColors = new Float32Array(visibleCount * 3);
		
		// Step LOD-BATCH2e) Pre-allocate arrays for lines (collar to toe)
		// Each line has 2 vertices (start and end)
		var linePositions = new Float32Array(visibleCount * 6); // 2 vertices * 3 coords
		var lineColors = new Float32Array(visibleCount * 6);
		
		// Step LOD-BATCH2f) Fill arrays
		var pointPosIdx = 0;
		var pointColorIdx = 0;
		var linePosIdx = 0;
		var lineColorIdx = 0;
		var holeMetadata = [];
		
		for (var i = 0; i < holes.length; i++) {
			var hole = holes[i];
			if (hole.visible === false) continue;
			
			// Step LOD-BATCH2g) Transform positions
			var collarLocal = worldToThreeLocal(hole.startXLocation, hole.startYLocation);
			var toeLocal = worldToThreeLocal(hole.endXLocation, hole.endYLocation);
			
			var collarX = collarLocal.x;
			var collarY = collarLocal.y;
			var collarZ = hole.startZLocation || 0;
			
			var toeX = toeLocal.x;
			var toeY = toeLocal.y;
			var toeZ = hole.endZLocation || 0;
			
			// Step LOD-BATCH2h) Parse color
			var colorHex = hole.colorHexDecimal || hole.holeColor || "#FF0000";
			var threeColor = new THREE.Color(colorHex);
			
			// Step LOD-BATCH2i) Fill point arrays (collar position)
			pointPositions[pointPosIdx++] = collarX;
			pointPositions[pointPosIdx++] = collarY;
			pointPositions[pointPosIdx++] = collarZ;
			
			pointColors[pointColorIdx++] = threeColor.r;
			pointColors[pointColorIdx++] = threeColor.g;
			pointColors[pointColorIdx++] = threeColor.b;
			
			// Step LOD-BATCH2j) Fill line arrays (collar to toe)
			// Start vertex (collar)
			linePositions[linePosIdx++] = collarX;
			linePositions[linePosIdx++] = collarY;
			linePositions[linePosIdx++] = collarZ;
			// End vertex (toe)
			linePositions[linePosIdx++] = toeX;
			linePositions[linePosIdx++] = toeY;
			linePositions[linePosIdx++] = toeZ;
			
			// Line colors (same for both vertices)
			lineColors[lineColorIdx++] = threeColor.r;
			lineColors[lineColorIdx++] = threeColor.g;
			lineColors[lineColorIdx++] = threeColor.b;
			lineColors[lineColorIdx++] = threeColor.r;
			lineColors[lineColorIdx++] = threeColor.g;
			lineColors[lineColorIdx++] = threeColor.b;
			
			// Step LOD-BATCH2k) Store metadata
			holeMetadata.push({
				index: holeMetadata.length,
				holeID: hole.holeID,
				entityName: hole.entityName
			});
		}
		
		// Step LOD-BATCH2l) Create points geometry and mesh
		var pointGeometry = new THREE.BufferGeometry();
		pointGeometry.setAttribute("position", new THREE.BufferAttribute(pointPositions, 3));
		pointGeometry.setAttribute("color", new THREE.BufferAttribute(pointColors, 3));
		
		var pointMaterial = new THREE.PointsMaterial({
			vertexColors: true,
			size: finalPointSize,
			sizeAttenuation: false, // Constant screen pixel size
			depthTest: true,
			depthWrite: true
		});
		
		var points = new THREE.Points(pointGeometry, pointMaterial);
		points.name = "hole-lod-points-track-batch";
		points.userData = {
			type: "holeLODPointsTrack",
			lodLevel: "POINT_TRACK",
			holeMetadata: holeMetadata,
			holeCount: visibleCount
		};
		
		// Step LOD-BATCH2m) Create lines geometry and mesh
		var lineGeometry = new THREE.BufferGeometry();
		lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
		lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
		
		var lineMaterial = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: true,
			depthWrite: true
		});
		
		var lines = new THREE.LineSegments(lineGeometry, lineMaterial);
		lines.name = "hole-lod-tracklines-batch";
		lines.userData = {
			type: "holeLODTrackLines",
			lodLevel: "POINT_TRACK",
			holeCount: visibleCount
		};
		
		return {
			points: points,
			lines: lines,
			holeMetadata: holeMetadata,
			holeCount: visibleCount
		};
	}

	// Step 9.7) HYBRID SUPER-BATCH for CIRCLES: Thin circles use LineBasic, thick use FatLines
	// Splits circles by lineWidth: <=1 goes to fast LineSegments, >1 goes to LineSegments2
	static createHybridSuperBatchedCircles(allCircleEntities, worldToThreeLocal, resolution) {
		if (!allCircleEntities || allCircleEntities.length === 0) return null;
		
		// Step 1) Separate thin vs thick circles
		var thinCircles = [];
		var thickCirclesByWidth = new Map();
		
		for (var i = 0; i < allCircleEntities.length; i++) {
			var entity = allCircleEntities[i];
			if (!entity.data) continue;
			
			for (var j = 0; j < entity.data.length; j++) {
				var circleData = entity.data[j];
				if (circleData.visible === false) continue;
				
				var lineWidth = circleData.lineWidth || 1;
				var circleInfo = {
					entity: entity,
					circleData: circleData,
					vertexIndex: j
				};
				
				if (lineWidth <= 1) {
					thinCircles.push(circleInfo);
				} else {
					var roundedWidth = Math.round(lineWidth * 2) / 2;
					if (!thickCirclesByWidth.has(roundedWidth)) {
						thickCirclesByWidth.set(roundedWidth, []);
					}
					thickCirclesByWidth.get(roundedWidth).push(circleInfo);
				}
			}
		}
		
		var result = {
			thinLineSegments: null,
			fatLinesByWidth: new Map(),
			entityMetadata: [],
			thinCount: 0,
			thickCount: 0
		};
		
		var segmentsPerCircle = 64;
		
		// Step 2) Create thin circles batch
		if (thinCircles.length > 0) {
			result.thinLineSegments = this._createThinCirclesBatch(thinCircles, worldToThreeLocal, segmentsPerCircle, result.entityMetadata);
			result.thinCount = thinCircles.length;
		}
		
		// Step 3) Create thick circles batches
		if (thickCirclesByWidth.size > 0) {
			thickCirclesByWidth.forEach(function(circles, lineWidth) {
				var fatBatch = GeometryFactory._createFatCirclesBatch(
					circles, worldToThreeLocal, segmentsPerCircle, lineWidth, resolution, result.entityMetadata
				);
				if (fatBatch) {
					result.fatLinesByWidth.set(lineWidth, fatBatch);
					result.thickCount += circles.length;
				}
			});
		}
		
		return result;
	}
	
	// Step 9.7a) Helper: Create thin circles batch with LineBasicMaterial
	static _createThinCirclesBatch(circles, worldToThreeLocal, segmentsPerCircle, entityMetadata) {
		var totalSegments = circles.length * segmentsPerCircle;
		if (totalSegments === 0) return null;
		
		var positions = new Float32Array(totalSegments * 6);
		var colors = new Float32Array(totalSegments * 6);
		
		var posIdx = 0;
		var colorIdx = 0;
		var defaultR = 0.0, defaultG = 0.5, defaultB = 1.0;
		
		for (var i = 0; i < circles.length; i++) {
			var circleInfo = circles[i];
			var circleData = circleInfo.circleData;
			var entity = circleInfo.entity;
			
			var local = worldToThreeLocal(circleData.pointXLocation, circleData.pointYLocation);
			var cx = local.x;
			var cy = local.y;
			var cz = circleData.pointZLocation || 0;
			var radius = circleData.radius || 1;
			
			var r = defaultR, g = defaultG, b = defaultB;
			var col = circleData.color;
			if (col && typeof col === "string" && col.length >= 7 && col.charAt(0) === "#") {
				var hex = parseInt(col.slice(1, 7), 16);
				r = ((hex >> 16) & 255) / 255;
				g = ((hex >> 8) & 255) / 255;
				b = (hex & 255) / 255;
			}
			
			for (var k = 0; k < segmentsPerCircle; k++) {
				var theta1 = (k / segmentsPerCircle) * Math.PI * 2;
				var theta2 = ((k + 1) / segmentsPerCircle) * Math.PI * 2;
				
				positions[posIdx++] = cx + radius * Math.cos(theta1);
				positions[posIdx++] = cy + radius * Math.sin(theta1);
				positions[posIdx++] = cz;
				colors[colorIdx++] = r; colors[colorIdx++] = g; colors[colorIdx++] = b;
				
				positions[posIdx++] = cx + radius * Math.cos(theta2);
				positions[posIdx++] = cy + radius * Math.sin(theta2);
				positions[posIdx++] = cz;
				colors[colorIdx++] = r; colors[colorIdx++] = g; colors[colorIdx++] = b;
			}
			
			entityMetadata.push({
				entityName: entity.entityName,
				vertexIndex: circleInfo.vertexIndex,
				kadId: entity.entityName + ":::" + circleInfo.vertexIndex,
				startSegment: i * segmentsPerCircle,
				endSegment: (i + 1) * segmentsPerCircle - 1,
				lineWidth: 1
			});
		}
		
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		
		var material = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: true,
			depthWrite: true
		});
		
		var lineSegments = new THREE.LineSegments(geometry, material);
		lineSegments.name = "kad-hybrid-circles-thin";
		lineSegments.userData = { type: "kadHybridCirclesThin" };
		
		return lineSegments;
	}
	
	// Step 9.7b) Helper: Create fat circles batch with LineMaterial
	static _createFatCirclesBatch(circles, worldToThreeLocal, segmentsPerCircle, lineWidth, resolution, entityMetadata) {
		var totalSegments = circles.length * segmentsPerCircle;
		if (totalSegments === 0) return null;
		
		var positions = new Float32Array(totalSegments * 6);
		var colors = new Float32Array(totalSegments * 6);
		
		var posIdx = 0;
		var colorIdx = 0;
		var defaultR = 0.0, defaultG = 0.5, defaultB = 1.0;
		
		for (var i = 0; i < circles.length; i++) {
			var circleInfo = circles[i];
			var circleData = circleInfo.circleData;
			var entity = circleInfo.entity;
			
			var local = worldToThreeLocal(circleData.pointXLocation, circleData.pointYLocation);
			var cx = local.x;
			var cy = local.y;
			var cz = circleData.pointZLocation || 0;
			var radius = circleData.radius || 1;
			
			var r = defaultR, g = defaultG, b = defaultB;
			var col = circleData.color;
			if (col && typeof col === "string" && col.length >= 7 && col.charAt(0) === "#") {
				var hex = parseInt(col.slice(1, 7), 16);
				r = ((hex >> 16) & 255) / 255;
				g = ((hex >> 8) & 255) / 255;
				b = (hex & 255) / 255;
			}
			
			for (var k = 0; k < segmentsPerCircle; k++) {
				var theta1 = (k / segmentsPerCircle) * Math.PI * 2;
				var theta2 = ((k + 1) / segmentsPerCircle) * Math.PI * 2;
				
				positions[posIdx++] = cx + radius * Math.cos(theta1);
				positions[posIdx++] = cy + radius * Math.sin(theta1);
				positions[posIdx++] = cz;
				colors[colorIdx++] = r; colors[colorIdx++] = g; colors[colorIdx++] = b;
				
				positions[posIdx++] = cx + radius * Math.cos(theta2);
				positions[posIdx++] = cy + radius * Math.sin(theta2);
				positions[posIdx++] = cz;
				colors[colorIdx++] = r; colors[colorIdx++] = g; colors[colorIdx++] = b;
			}
			
			entityMetadata.push({
				entityName: entity.entityName,
				vertexIndex: circleInfo.vertexIndex,
				kadId: entity.entityName + ":::" + circleInfo.vertexIndex,
				startSegment: i * segmentsPerCircle,
				endSegment: (i + 1) * segmentsPerCircle - 1,
				lineWidth: lineWidth
			});
		}
		
		var geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);
		geometry.setColors(colors);
		
		var material = new LineMaterial({
			color: 0xffffff,
			linewidth: lineWidth,
			vertexColors: true,
			resolution: resolution,
			dashed: false,
			alphaToCoverage: true
		});
		material.depthTest = true;
		material.depthWrite = true;
		
		var lineSegments = new LineSegments2(geometry, material);
		lineSegments.computeLineDistances();
		lineSegments.name = "kad-hybrid-circles-fat-" + lineWidth;
		lineSegments.userData = { type: "kadHybridCirclesFat", lineWidth: lineWidth };
		
		return lineSegments;
	}

	// Step 10) Create KAD line segment (single segment between two points)
	// Uses LineMaterial/LineSegments2 (fat lines) for consistent screen-space thickness
	// Matches 2D canvas drawKADLines() - each segment has its own lineWidth and color
	static createKADLineSegment(startX, startY, startZ, endX, endY, endZ, lineWidth, color) {
		// Step 10a) Use pixel width directly (matches 2D canvas)
		const pixelWidth = lineWidth || 1;

		// Step 10b) Create LineSegmentsGeometry with flat position array
		const geometry = new LineSegmentsGeometry();
		geometry.setPositions([startX, startY, startZ, endX, endY, endZ]);

		// Step 10c) Create LineMaterial with screen-space linewidth
		// worldUnits: false ensures line width is in screen pixels (not world units)
		const material = new LineMaterial({
			color: new THREE.Color(color),
			linewidth: pixelWidth, // Pixel width (screen-space)
			worldUnits: false, // CRITICAL: Line width in screen pixels, not world units
			resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
			dashed: false,
			alphaToCoverage: false
		});
		material.transparent = true;
		material.depthTest = true;
		material.depthWrite = true;

		// Step 10d) Create LineSegments2 and compute distances
		const lineSegments = new LineSegments2(geometry, material);
		lineSegments.computeLineDistances();
		lineSegments.name = "kad-line-segment";

		return lineSegments;
	}

	// Step 11) Create KAD polygon segment (single segment between two points)
	// Matches 2D canvas drawKADPolys() - each segment has its own lineWidth and color
	static createKADPolygonSegment(startX, startY, startZ, endX, endY, endZ, lineWidth, color) {
		// Step 11a) Same as line segment - polygon is just a closed series of segments
		return GeometryFactory.createKADLineSegment(startX, startY, startZ, endX, endY, endZ, lineWidth, color);
	}

	// Step 12) Create KAD circle with LineMaterial/LineSegments2 (fat lines)
	static createKADCircle(worldX, worldY, worldZ, radius, lineWidth, color) {
		// Step 12a) Use pixel width directly (matches 2D canvas)
		const pixelWidth = lineWidth || 1;

		// Step 12b) Create circle points as line segments (pairs of points)
		const segments = 64;
		const positions = [];
		for (let i = 0; i < segments; i++) {
			const theta1 = (i / segments) * Math.PI * 2;
			const theta2 = ((i + 1) / segments) * Math.PI * 2;
			// Start point of segment
			positions.push(worldX + radius * Math.cos(theta1), worldY + radius * Math.sin(theta1), worldZ);
			// End point of segment
			positions.push(worldX + radius * Math.cos(theta2), worldY + radius * Math.sin(theta2), worldZ);
		}

		// Step 12c) Create LineSegmentsGeometry
		const geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);

		// Step 12d) Create LineMaterial with screen-space linewidth
		// worldUnits: false ensures line width is in screen pixels (not world units)
		const material = new LineMaterial({
			color: new THREE.Color(color),
			linewidth: pixelWidth, // Pixel width (screen-space)
			worldUnits: false, // CRITICAL: Line width in screen pixels, not world units
			resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
			dashed: false,
			alphaToCoverage: false
		});
		material.transparent = true;
		material.depthTest = true;
		material.depthWrite = true;

		// Step 12e) Create LineSegments2
		const circleSegments = new LineSegments2(geometry, material);
		circleSegments.computeLineDistances();
		circleSegments.name = "kad-circle";

		return circleSegments;
	}

	// Step 12b) Create KAD text using troika-three-text (crisp SDF rendering)
	// 3D text ALWAYS uses fixed screen pixel size (fontSize / cameraZoom)
	// This ensures text appears at consistent size regardless of zoom level
	// fontLock checkbox only affects 2D canvas behavior, not 3D
	static createKADText(worldX, worldY, worldZ, text, fontSize, color, backgroundColor = null, anchorX = "center") {
		// Step 1) Calculate world units that give consistent PIXEL size on screen
		// With orthographic camera: screenPixels = worldUnits * camera.zoom
		// So: worldUnits = screenPixels / camera.zoom
		const cameraZoom = (window.threeRenderer && window.threeRenderer.camera) ? window.threeRenderer.camera.zoom : 1;
		const fontSizeWorldUnits = fontSize / cameraZoom;
		
		// Step 1a) Create cache key WITHOUT zoom - zoom changes just update fontSize
		const cacheKey = worldX.toFixed(2) + "," + worldY.toFixed(2) + "," + worldZ.toFixed(2) + "," + String(text) + "," + fontSize + "," + color + "," + anchorX;

		// Step 1b) Return cached text if it exists
		if (textCache.has(cacheKey)) {
			const cachedText = textCache.get(cacheKey);

			// Step 1b.1) Ensure cached text has multi-channel SDF settings
			if (cachedText.sdfGlyphSize !== 128) {
				cachedText.sdfGlyphSize = 128;
				cachedText.glyphSize = 256;
				cachedText.glyphResolution = 1;
			}

			// Step 1b.2) ALWAYS update fontSize based on current camera zoom
			// This ensures text maintains fixed screen pixel size as zoom changes
			const newFontSizeWorldUnits = fontSize / cameraZoom;
			if (Math.abs(cachedText.fontSize - newFontSizeWorldUnits) > 0.001) {
				cachedText.fontSize = newFontSizeWorldUnits;
				cachedText.sync(); // Update geometry
			}

			// Step 1b.3) Update position (might have changed)
			cachedText.position.set(worldX, worldY, worldZ);

			return cachedText;
		}

		// Step 2) Create troika Text object (only if not cached)
		const textMesh = new Text();

		// Step 2a) Enable multi-channel SDF for superior text quality
		textMesh.sdfGlyphSize = 128; // Multi-channel SDF (64=standard, 128=high quality, 256=ultra)

		// Optional: Fine-tune SDF rendering parameters
		textMesh.glyphSize = 256;     // Texture size for glyph rendering (default: 256)
		textMesh.glyphResolution = 1; // Glyph detail level (1=normal, higher=more detail)

		// Step 3) Apply fontSize based on fontLock setting
		// When fontLock enabled: divide by zoom for consistent screen pixel size
		// When fontLock disabled: use raw fontSize so text scales with zoom (like 2D behavior)

		// Step 3a) Set text content and properties
		textMesh.text = String(text);
		textMesh.fontSize = fontSizeWorldUnits; // Respects fontLock setting
		textMesh.color = color;
		textMesh.anchorX = anchorX; // Left, center, or right alignment
		textMesh.anchorY = "middle"; // Center vertically

		// Step 2a) Load Roboto font from fonts folder
		try {
			const robotoFontUrl = new URL("../fonts/Roboto-Regular.ttf", import.meta.url).href;
			textMesh.font = robotoFontUrl;
		} catch (error) {
			console.warn("⚠️ Could not load Roboto font, using Arial fallback:", error);
			textMesh.font = "Arial";
		}

		// Step 4) Set position
		textMesh.position.set(worldX, worldY, worldZ);

		// Step 5) Configure render order (material properties set after sync)
		textMesh.renderOrder = 100; // Render on top of other meshes

		// Step 6) CRITICAL: Sync troika text to create geometry and material
		// Force immediate sync to prevent flashing (blocks briefly but ensures visibility)
		textMesh.sync();

		// Step 6a) Configure material for depth testing and transparency immediately
		if (textMesh.material) {
			textMesh.material.depthTest = true; // Enable occlusion behind objects
			textMesh.material.depthWrite = false; // Don't write to depth buffer (for transparency)
			textMesh.material.transparent = true; // Enable transparency
		}

		// Step 6b) Mark as cached text for special handling
		textMesh.userData.isCachedText = true;
		textMesh.userData.cacheKey = cacheKey;

		// Step 6c) Request render after text is ready
		if (window.threeRenderer) {
			window.threeRenderer.requestRender();
		}

		// Step 7) Add background if specified (draw as plane behind text)
		if (backgroundColor) {
			// Create a background plane
			const bgWidth = fontSize * 2; // Approximate width
			const bgHeight = fontSize * 0.6; // Approximate height
			const bgGeometry = new THREE.PlaneGeometry(bgWidth, bgHeight);
			const bgMaterial = new THREE.MeshBasicMaterial({
				color: backgroundColor,
				transparent: true,
				opacity: 0.7,
				depthTest: true,
				depthWrite: false,
			});
			const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
			bgMesh.position.z = -0.1; // Slightly behind text
			bgMesh.renderOrder = 99;

			// Group text and background together
			const group = new THREE.Group();
			group.position.set(worldX, worldY, worldZ);
			group.add(bgMesh);

			// Adjust text to be relative to group
			textMesh.position.set(0, 0, 0);
			group.add(textMesh);

			// Store reference to textMesh for billboard rotation
			group.userData.textMesh = textMesh;
			group.userData.isTroikaText = true;
			group.userData.isCachedText = true; // Mark group as cached too
			group.userData.cacheKey = cacheKey;

			// Step 7a) Store group in cache instead of textMesh when background exists
			textCache.set(cacheKey, group);

			// Step 7b) Ensure text is synced in group
			textMesh.sync();

			return group;
		}

		// Step 7c) Store textMesh in cache when no background
		textCache.set(cacheKey, textMesh);

		// Step 7d) Mark as troika text for billboard behavior
		textMesh.userData.isTroikaText = true;

		return textMesh;
	}

	// Step 12.3) Create Vector Text using Hershey Simplex font (high performance)
	// Returns LineSegments2 with LineMaterial for proper line thickness
	// Benefits: No textures, no sync(), instant render, batchable, consistent 2D/3D look
	// 3D text ALWAYS uses fixed screen pixel size (fontSize / cameraZoom)
	static createVectorText(worldX, worldY, worldZ, text, fontSize, color, anchorX = "center") {
		// Step 1) Calculate font size in world units for fixed screen pixel size
		// With orthographic camera: screenPixels = worldUnits * camera.zoom
		// So: worldUnits = screenPixels / camera.zoom
		const cameraZoom = (window.threeRenderer && window.threeRenderer.camera) ? window.threeRenderer.camera.zoom : 1;
		const fontSizeWorldUnits = fontSize / cameraZoom;
		
		// Step 2) Get line segments from VectorFont (flipY=false for 3D Y-up coordinate system)
		const segments = VectorFont.getTextLineSegments(String(text), fontSizeWorldUnits, anchorX, "middle", false);
		
		if (segments.length === 0) {
			return null;
		}
		
		// Step 3) Create positions array for LineSegmentsGeometry (uses pairs of points)
		const positions = [];
		
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			// Add start point
			positions.push(seg.x1, seg.y1, 0);
			// Add end point
			positions.push(seg.x2, seg.y2, 0);
		}
		
		// Step 4) Create LineSegmentsGeometry for fat lines
		const geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);
		
		// Step 5) Create LineMaterial with thin crisp lines (matching 2D canvas)
		// Use screen pixels (worldUnits: false) for consistent thin appearance
		const lineWidth = 1; // 1 pixel width for crisp lines like 2D canvas
		const threeColor = new THREE.Color(color || "#000000");
		
		const material = new LineMaterial({
			color: threeColor,
			linewidth: lineWidth,
			worldUnits: false, // Line width in screen pixels (crisp like 2D)
			dashed: false,
			alphaToCoverage: false,
			depthTest: true,
			depthWrite: true,
			transparent: false
		});
		
		// Step 5a) Set resolution for LineMaterial (required for screen-space line width)
		material.resolution.set(window.innerWidth || 1920, window.innerHeight || 1080);
		
		// Step 6) Create LineSegments2 mesh
		const lineSegments = new LineSegments2(geometry, material);
		
		// Step 7) Position in 3D space
		lineSegments.position.set(worldX, worldY, worldZ);
		
		// Step 8) Compute line distances for proper rendering
		lineSegments.computeLineDistances();
		
		// Step 9) Mark as vector text for identification and billboard handling
		lineSegments.userData.isVectorText = true;
		lineSegments.userData.text = text;
		lineSegments.userData.originalFontSize = fontSize;
		lineSegments.userData.lineWidth = lineWidth;
		lineSegments.renderOrder = 100; // Render on top
		
		return lineSegments;
	}

	// Step 12.3b) Create Vector Text with fixed screen size (doesn't scale with zoom)
	// Use this for labels that should maintain constant screen pixel size
	static createVectorTextFixed(worldX, worldY, worldZ, text, screenPixelSize, color, anchorX = "center") {
		// Step 1) Get current camera zoom
		const cameraZoom = (window.threeRenderer && window.threeRenderer.camera) ? window.threeRenderer.camera.zoom : 1;
		
		// Step 2) Calculate world units for desired screen pixel size
		const fontSizeWorldUnits = screenPixelSize / cameraZoom;
		
		// Step 3) Get line segments (flipY=false for 3D Y-up coordinate system)
		const segments = VectorFont.getTextLineSegments(String(text), fontSizeWorldUnits, anchorX, "middle", false);
		
		if (segments.length === 0) {
			return null;
		}
		
		// Step 4) Create positions array for LineSegmentsGeometry
		const positions = [];
		
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			positions.push(seg.x1, seg.y1, 0);
			positions.push(seg.x2, seg.y2, 0);
		}
		
		// Step 5) Create LineSegmentsGeometry for fat lines
		const geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);
		
		// Step 6) Create LineMaterial with thin crisp lines (matching 2D canvas)
		const lineWidth = 1; // 1 pixel width for crisp lines like 2D canvas
		const threeColor = new THREE.Color(color || "#000000");
		
		const material = new LineMaterial({
			color: threeColor,
			linewidth: lineWidth,
			worldUnits: false, // Line width in screen pixels (crisp like 2D)
			dashed: false,
			alphaToCoverage: false,
			depthTest: true,
			depthWrite: true,
			transparent: false
		});
		
		material.resolution.set(window.innerWidth || 1920, window.innerHeight || 1080);
		
		// Step 7) Create LineSegments2
		const lineSegments = new LineSegments2(geometry, material);
		lineSegments.position.set(worldX, worldY, worldZ);
		lineSegments.computeLineDistances();
		
		// Step 8) Mark for zoom-based scaling updates
		lineSegments.userData.isVectorText = true;
		lineSegments.userData.isFixedScreenSize = true;
		lineSegments.userData.text = text;
		lineSegments.userData.screenPixelSize = screenPixelSize;
		lineSegments.userData.anchorX = anchorX;
		lineSegments.userData.lineWidth = lineWidth;
		lineSegments.renderOrder = 100;
		
		return lineSegments;
	}

	// Step 12.3c) Update vector text geometry for new zoom level
	// Call this when camera zoom changes to maintain fixed screen size
	// Works with LineSegments2 / LineSegmentsGeometry
	static updateVectorTextForZoom(lineSegments) {
		if (!lineSegments || !lineSegments.userData.isVectorText || !lineSegments.userData.isFixedScreenSize) {
			return;
		}
		
		const screenPixelSize = lineSegments.userData.screenPixelSize;
		const text = lineSegments.userData.text;
		const anchorX = lineSegments.userData.anchorX || "center";
		
		// Step 1) Get current camera zoom
		const cameraZoom = (window.threeRenderer && window.threeRenderer.camera) ? window.threeRenderer.camera.zoom : 1;
		
		// Step 2) Calculate new world units
		const fontSizeWorldUnits = screenPixelSize / cameraZoom;
		
		// Step 3) Get new line segments (flipY=false for 3D)
		const segments = VectorFont.getTextLineSegments(String(text), fontSizeWorldUnits, anchorX, "middle", false);
		
		if (segments.length === 0) {
			return;
		}
		
		// Step 4) Create new positions array for LineSegmentsGeometry
		const positions = [];
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			positions.push(seg.x1, seg.y1, 0);
			positions.push(seg.x2, seg.y2, 0);
		}
		
		// Step 5) Update geometry using setPositions (LineSegmentsGeometry method)
		lineSegments.geometry.setPositions(positions);
		
		// Step 6) Line width stays at 1 pixel (screen space) - no update needed
		// The text geometry scales but line thickness remains crisp
		
		// Step 7) Recompute line distances
		lineSegments.computeLineDistances();
	}

	// Step 12.4) Create contour label (billboarded, italic, no background)
	// Used for timing contour labels that always face the camera
	static createContourLabel(worldX, worldY, worldZ, text, fontSize, color) {
		// Step 1) Create troika Text object
		const textMesh = new Text();

		// Step 1a) Enable multi-channel SDF for superior text quality
		textMesh.sdfGlyphSize = 128; // Multi-channel SDF (64=standard, 128=high quality, 256=ultra)
		textMesh.glyphSize = 256;     // Texture size for glyph rendering (default: 256)
		textMesh.glyphResolution = 1; // Glyph detail level (1=normal, higher=more detail)

		// Step 2) Convert pixel-based fontSize to world units
		const currentScale = window.currentScale || 5;
		const fontSizeWorldUnits = fontSize / currentScale;

		// Step 3) Set text content and properties
		textMesh.text = String(text);
		textMesh.fontSize = fontSizeWorldUnits;
		textMesh.color = color;
		textMesh.anchorX = "center";
		textMesh.anchorY = "middle";
		textMesh.fontStyle = "italic"; // Italicized text

		// Step 4)
		// original font loading code:
		try {
			const robotoFontUrl = new URL("../fonts/Roboto-Regular.ttf", import.meta.url).href;
			textMesh.font = robotoFontUrl;
		} catch (error) {
			console.warn("⚠️ Could not load Roboto font, using Arial fallback:", error);
			textMesh.font = "Arial";
		}

		// Step 5) Set position
		textMesh.position.set(worldX, worldY, worldZ);

		// Step 6) Configure for depth testing
		textMesh.renderOrder = 100;

		// Step 7) Sync troika text
		textMesh.sync();

		// Step 8) Configure material
		if (textMesh.material) {
			textMesh.material.depthTest = true;
			textMesh.material.depthWrite = false;
			textMesh.material.transparent = true;
		}

		// Step 9) Mark as billboard text (will be updated in render loop to face camera)
		textMesh.userData.isTroikaText = true;
		textMesh.userData.billboard = true;
		textMesh.userData.isContourLabel = true;

		// Step 10) Request render
		if (window.threeRenderer) {
			window.threeRenderer.requestRender();
		}

		return textMesh;
	}

	// Step 12.5) Helper function to find nearest hole for a point
	static findNearestHole(x, y, allBlastHoles) {
		if (!allBlastHoles || allBlastHoles.length === 0) return null;

		let nearestHole = null;
		let minDistance = Infinity;

		for (const hole of allBlastHoles) {
			const dx = x - hole.startXLocation;
			const dy = y - hole.startYLocation;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (distance < minDistance) {
				minDistance = distance;
				nearestHole = hole;
			}
		}

		return nearestHole;
	}

	// Step 12.6) Helper function to get slope color based on angle
	static getSlopeColor(slopeAngle) {
		if (slopeAngle >= 0 && slopeAngle < 5) {
			return "rgb(51, 139, 255)";
		} else if (slopeAngle >= 5 && slopeAngle < 7) {
			return "rgb(0, 102, 204)";
		} else if (slopeAngle >= 7 && slopeAngle < 9) {
			return "rgb(0, 204, 204)";
		} else if (slopeAngle >= 9 && slopeAngle < 12) {
			return "rgb(102, 204, 0)";
		} else if (slopeAngle >= 12 && slopeAngle < 15) {
			return "rgb(204, 204, 0)";
		} else if (slopeAngle >= 15 && slopeAngle < 17) {
			return "rgb(255, 128, 0)";
		} else if (slopeAngle >= 17 && slopeAngle < 20) {
			return "rgb(255, 0, 0)";
		} else {
			return "rgb(153, 0, 76)";
		}
	}

	// Step 12.7) Helper function to get burden relief color
	static getBurdenReliefColor(burdenRelief) {
		if (burdenRelief < 4) {
			return "rgb(75, 20, 20)";
		} else if (burdenRelief < 7) {
			return "rgb(255, 40, 40)";
		} else if (burdenRelief < 10) {
			return "rgb(255, 120, 50)";
		} else if (burdenRelief < 13) {
			return "rgb(255, 255, 50)";
		} else if (burdenRelief < 16) {
			return "rgb(50, 255, 70)";
		} else if (burdenRelief < 19) {
			return "rgb(50, 255, 200)";
		} else if (burdenRelief < 22) {
			return "rgb(50, 230, 255)";
		} else if (burdenRelief < 25) {
			return "rgb(50, 180, 255)";
		} else if (burdenRelief < 30) {
			return "rgb(50, 100, 255)"; // Blue
		} else if (burdenRelief < 40) {
			return "rgb(0, 0, 180)"; // Navy (actual dark blue)
		} else {
			return "rgb(75, 0, 150)"; // Purple - slow
		}
	}

	// Step 12.8) Helper function to calculate dip angle from triangle vertices
	static getDipAngle(triangle) {
		const edge1 = [triangle[1][0] - triangle[0][0], triangle[1][1] - triangle[0][1], triangle[1][2] - triangle[0][2]];
		const edge2 = [triangle[2][0] - triangle[0][0], triangle[2][1] - triangle[0][1], triangle[2][2] - triangle[0][2]];

		// Calculate the normal vector of the triangle's plane
		const normalVector = [edge1[1] * edge2[2] - edge1[2] * edge2[1], edge1[2] * edge2[0] - edge1[0] * edge2[2], edge1[0] * edge2[1] - edge1[1] * edge2[0]];

		// Calculate the dot product with the vertical direction (0, 0, 1)
		const dotProduct = normalVector[0] * 0 + normalVector[1] * 0 + normalVector[2] * 1;
		const magNormal = Math.sqrt(normalVector[0] ** 2 + normalVector[1] ** 2 + normalVector[2] ** 2);

		const epsilon = 1e-6;
		if (Math.abs(magNormal) < epsilon) {
			return 0;
		}

		const angleRadians = Math.acos(dotProduct / magNormal);
		const angleDegrees = (angleRadians * 180) / Math.PI;

		const dipAngle = 180 - angleDegrees;
		return dipAngle;
	}

	// Step 12.9) Helper function to calculate burden relief from triangle vertices with timing data
	// Relief triangle format: [[x, y, holeTime], [x, y, holeTime], [x, y, holeTime]]
	// Note: For relief triangles, the Z position contains the holeTime
	static getBurdenRelief(triangle) {
		// Step 12.9a) Extract timing data (time is in index 2 for relief triangles)
		const tAX = triangle[0][0],
			tAY = triangle[0][1],
			tAZ = triangle[0][2] || 0;
		const tBX = triangle[1][0],
			tBY = triangle[1][1],
			tBZ = triangle[1][2] || 0;
		const tCX = triangle[2][0],
			tCY = triangle[2][1],
			tCZ = triangle[2][2] || 0;

		// Step 12.9b) Find earliest and latest firing times
		const earliestTime = Math.min(tAZ, tBZ, tCZ);
		const latestTime = Math.max(tAZ, tBZ, tCZ);
		const timeDifference = latestTime - earliestTime;

		if (timeDifference <= 0) return 0;

		// Step 12.9c) Find the earliest and latest points
		let p1, p2;
		if (earliestTime === tAZ) {
			p1 = { x: tAX, y: tAY };
		} else if (earliestTime === tBZ) {
			p1 = { x: tBX, y: tBY };
		} else {
			p1 = { x: tCX, y: tCY };
		}

		if (latestTime === tAZ) {
			p2 = { x: tAX, y: tAY };
		} else if (latestTime === tBZ) {
			p2 = { x: tBX, y: tBY };
		} else {
			p2 = { x: tCX, y: tCY };
		}

		// Step 12.9d) Calculate distance and burden relief
		const distance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
		const burdenRelief = distance > 0 ? timeDifference / distance : 0;

		return burdenRelief;
	}

	// Step 13) Create surface from triangle objects (Kirra format)
	static createSurface(triangles, colorFunction, transparency = 1.0, options) {
		// Step 14) Build geometry from triangles
		// Each triangle has: { vertices: [{x, y, z}, {x, y, z}, {x, y, z}], minZ, maxZ }
		// options.originX/originY: world-to-local offset (avoids intermediate .map() copy)

		// Debug logging (only in developer mode)
		if (window.developerModeEnabled) {
			console.log("🏗️ [createSurface] Building mesh from " + triangles.length + " triangles");
		}

		var opts = options || {};
		var ox = opts.originX || 0;
		var oy = opts.originY || 0;

		// Pre-allocate typed arrays directly — avoids ~2GB of intermediate JS arrays for large surfaces
		var maxVerts = triangles.length * 9; // 3 verts * 3 floats
		var positions = new Float32Array(maxVerts);
		var colors = colorFunction ? new Float32Array(maxVerts) : null;
		var writeIdx = 0;
		var skippedCount = 0;

		for (var ti = 0; ti < triangles.length; ti++) {
			var triangle = triangles[ti];
			if (!triangle.vertices || triangle.vertices.length !== 3) {
				skippedCount++;
				continue;
			}

			var p1 = triangle.vertices[0];
			var p2 = triangle.vertices[1];
			var p3 = triangle.vertices[2];

			// Validate vertices have valid numbers
			if (isNaN(p1.x) || isNaN(p1.y) || isNaN(p1.z) ||
			    isNaN(p2.x) || isNaN(p2.y) || isNaN(p2.z) ||
			    isNaN(p3.x) || isNaN(p3.y) || isNaN(p3.z)) {
				skippedCount++;
				continue;
			}

			// Add vertices (apply world-to-local offset inline)
			positions[writeIdx]     = p1.x - ox;
			positions[writeIdx + 1] = p1.y - oy;
			positions[writeIdx + 2] = p1.z;
			positions[writeIdx + 3] = p2.x - ox;
			positions[writeIdx + 4] = p2.y - oy;
			positions[writeIdx + 5] = p2.z;
			positions[writeIdx + 6] = p3.x - ox;
			positions[writeIdx + 7] = p3.y - oy;
			positions[writeIdx + 8] = p3.z;

			// Add colors if colorFunction provided
			if (colors) {
				var color1 = colorFunction(p1.z);
				var color2 = colorFunction(p2.z);
				var color3 = colorFunction(p3.z);

				colors[writeIdx]     = color1.r;
				colors[writeIdx + 1] = color1.g;
				colors[writeIdx + 2] = color1.b;
				colors[writeIdx + 3] = color2.r;
				colors[writeIdx + 4] = color2.g;
				colors[writeIdx + 5] = color2.b;
				colors[writeIdx + 6] = color3.r;
				colors[writeIdx + 7] = color3.g;
				colors[writeIdx + 8] = color3.b;
			}

			writeIdx += 9;
		}

		// Debug logging (only in developer mode)
		if (window.developerModeEnabled) {
			console.log("🏗️ [createSurface] Built " + (writeIdx / 9) + " triangles, skipped " + skippedCount);
		}

		if (writeIdx === 0) {
			// Return null if no triangles - don't create empty meshes with empty materials
			console.warn("🏗️ [createSurface] No valid positions - returning null");
			return null;
		}

		// Trim typed arrays if some triangles were skipped
		if (writeIdx < maxVerts) {
			positions = positions.subarray(0, writeIdx);
			if (colors) colors = colors.subarray(0, writeIdx);
		}

		// Step 15) Create BufferGeometry
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

		if (colors) {
			geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		}

		geometry.computeVertexNormals();

		// Step 16) Create material with vertex colors and Phong shading
		const material = new THREE.MeshPhongMaterial({
			vertexColors: colors.length > 0,
			side: THREE.DoubleSide,
			transparent: transparency < 1.0,
			opacity: transparency,
			shininess: 30,
			specular: 0x222222,
			flatShading: false,
		});

		const mesh = new THREE.Mesh(geometry, material);
		
		// Step 17) Add BVH for accelerated raycasting on large surfaces
		var triangleCount = positions.length / 9;
		if (triangleCount >= BVH_MIN_TRIANGLES) {
			try {
				var bvhStartTime = performance.now();
				geometry.boundsTree = new MeshBVH(geometry);
				mesh.raycast = acceleratedRaycast;
				mesh.userData.hasBVH = true;
				var bvhTime = performance.now() - bvhStartTime;
				console.log("🏗️ [createSurface] BVH built for " + triangleCount + " triangles in " + bvhTime.toFixed(2) + "ms");
			} catch (error) {
				console.warn("🏗️ [createSurface] BVH build failed: " + error.message);
				mesh.userData.hasBVH = false;
			}
		}
		
		return mesh;
	}

	// Step 16) Create slope surface (triangles positioned at collar Z, colored by slope angle)
	static createSlopeSurface(triangles, allBlastHoles, worldToThreeLocalFn, transparency = 1.0) {
		if (!triangles || triangles.length === 0) {
			// Return null if no triangles - don't create empty meshes with empty materials
			return null;
		}

		const positions = [];
		const colors = [];

		for (const triangle of triangles) {
			if (!triangle || triangle.length !== 3) continue;

			// Step 16a) For each vertex, find nearest hole and use its collar Z
			const vertices = [];
			for (let i = 0; i < 3; i++) {
				const [worldX, worldY, originalZ] = triangle[i];
				const nearestHole = this.findNearestHole(worldX, worldY, allBlastHoles);
				const collarZ = nearestHole ? nearestHole.startZLocation || 0 : originalZ;

				// Step 16a.1) Convert to local Three.js coordinates
				const local = worldToThreeLocalFn ? worldToThreeLocalFn(worldX, worldY) : { x: worldX, y: worldY };
				vertices.push({ x: local.x, y: local.y, z: collarZ });
			}

			// Step 16b) Calculate slope angle from triangle vertices (using collar Z)
			const triangleForSlope = [
				[vertices[0].x, vertices[0].y, vertices[0].z],
				[vertices[1].x, vertices[1].y, vertices[1].z],
				[vertices[2].x, vertices[2].y, vertices[2].z],
			];
			const slopeAngle = this.getDipAngle(triangleForSlope);

			// Step 16c) Get color based on slope angle
			const colorString = this.getSlopeColor(slopeAngle);
			const colorMatch = colorString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
			const color = colorMatch
				? {
						r: parseInt(colorMatch[1]) / 255,
						g: parseInt(colorMatch[2]) / 255,
						b: parseInt(colorMatch[3]) / 255,
				  }
				: { r: 1, g: 1, b: 1 };

			// Step 16d) Add vertices and colors
			positions.push(vertices[0].x, vertices[0].y, vertices[0].z);
			positions.push(vertices[1].x, vertices[1].y, vertices[1].z);
			positions.push(vertices[2].x, vertices[2].y, vertices[2].z);

			colors.push(color.r, color.g, color.b);
			colors.push(color.r, color.g, color.b);
			colors.push(color.r, color.g, color.b);
		}

		if (positions.length === 0) {
			// Return null if no triangles - don't create empty meshes with empty materials
			return null;
		}

		// Step 16e) Create BufferGeometry
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
		geometry.computeVertexNormals();

		// Step 16f) Create material with vertex colors - use MeshBasicMaterial for flat/unshaded colors
		// MeshBasicMaterial shows true colors without lighting effects (no dulling/muting)
		const material = new THREE.MeshBasicMaterial({
			vertexColors: true,
			side: THREE.DoubleSide,
			transparent: transparency < 1.0,
			opacity: transparency,
		});

		const mesh = new THREE.Mesh(geometry, material);
		return mesh;
	}

	// Step 16.5) Create burden relief surface (triangles positioned at collar Z, colored by burden relief)
	static createReliefSurface(triangles, allBlastHoles, worldToThreeLocalFn, transparency = 1.0) {
		if (!triangles || triangles.length === 0) {
			// Return null if no triangles - don't create empty meshes with empty materials
			return null;
		}

		const positions = [];
		const colors = [];

		for (const triangle of triangles) {
			if (!triangle || triangle.length !== 3) continue;

			// Step 16.5a) Extract original timing values from triangle Z (for burden relief calculation)
			const [tAX, tAY, tAZ] = triangle[0]; // timing in Z
			const [tBX, tBY, tBZ] = triangle[1]; // timing in Z
			const [tCX, tCY, tCZ] = triangle[2]; // timing in Z

			// Step 16.5b) Find nearest holes for each vertex to get collar Z
			const vertices = [];
			for (let i = 0; i < 3; i++) {
				const [worldX, worldY] = triangle[i];
				const nearestHole = this.findNearestHole(worldX, worldY, allBlastHoles);
				const collarZ = nearestHole ? nearestHole.startZLocation || 0 : 0;

				// Step 16.5b.1) Convert to local Three.js coordinates
				const local = worldToThreeLocalFn ? worldToThreeLocalFn(worldX, worldY) : { x: worldX, y: worldY };
				vertices.push({ x: local.x, y: local.y, z: collarZ });
			}

			// Step 16.5c) Calculate burden relief from timing data (using original world coordinates)
			const earliestTime = Math.min(tAZ, tBZ, tCZ);
			const latestTime = Math.max(tAZ, tBZ, tCZ);
			const timeDifference = latestTime - earliestTime;

			// Find points corresponding to earliest and latest times
			let p1, p2;
			if (earliestTime === tAZ) {
				p1 = { x: tAX, y: tAY };
			} else if (earliestTime === tBZ) {
				p1 = { x: tBX, y: tBY };
			} else {
				p1 = { x: tCX, y: tCY };
			}

			if (latestTime === tAZ) {
				p2 = { x: tAX, y: tAY };
			} else if (latestTime === tBZ) {
				p2 = { x: tBX, y: tBY };
			} else {
				p2 = { x: tCX, y: tCY };
			}

			const distance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
			const burdenRelief = distance > 0 ? timeDifference / distance : 0;

			// Step 16.5d) Get color based on burden relief
			const colorString = this.getBurdenReliefColor(burdenRelief);
			const colorMatch = colorString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
			const color = colorMatch
				? {
						r: parseInt(colorMatch[1]) / 255,
						g: parseInt(colorMatch[2]) / 255,
						b: parseInt(colorMatch[3]) / 255,
				  }
				: { r: 1, g: 1, b: 1 };

			// Step 16.5e) Add vertices (using collar Z) and colors
			positions.push(vertices[0].x, vertices[0].y, vertices[0].z);
			positions.push(vertices[1].x, vertices[1].y, vertices[1].z);
			positions.push(vertices[2].x, vertices[2].y, vertices[2].z);

			colors.push(color.r, color.g, color.b);
			colors.push(color.r, color.g, color.b);
			colors.push(color.r, color.g, color.b);
		}

		if (positions.length === 0) {
			// Return null if no triangles - don't create empty meshes with empty materials
			return null;
		}

		// Step 16.5f) Create BufferGeometry
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
		geometry.computeVertexNormals();

		// Step 16.5g) Create material with vertex colors - use MeshBasicMaterial for flat/unshaded colors
		// MeshBasicMaterial shows true colors without lighting effects (no dulling/muting)
		const material = new THREE.MeshBasicMaterial({
			vertexColors: true,
			side: THREE.DoubleSide,
			transparent: transparency < 1.0,
			opacity: transparency,
		});

		const mesh = new THREE.Mesh(geometry, material);
		return mesh;
	}

	// Step 17) Create contour lines (positioned at collar Z elevation)
	// Uses two overlapping fat dashed lines: yellow dashes and magenta dashes offset to create alternating pattern
	static createContourLines(contourLinesArray, color, allBlastHoles, worldToThreeLocalFn) {
		const group = new THREE.Group();

		for (let levelIndex = 0; levelIndex < contourLinesArray.length; levelIndex++) {
			const contourLines = contourLinesArray[levelIndex];

			for (let i = 0; i < contourLines.length; i++) {
				const line = contourLines[i];
				if (line.length === 2) {
					// Step 17a) Get world coordinates from contour line
					const worldX1 = line[0].x;
					const worldY1 = line[0].y;
					const worldX2 = line[1].x;
					const worldY2 = line[1].y;

					// Step 17b) Find nearest hole for each endpoint to get collar Z
					const nearestHole1 = this.findNearestHole(worldX1, worldY1, allBlastHoles);
					const nearestHole2 = this.findNearestHole(worldX2, worldY2, allBlastHoles);
					const z1 = nearestHole1 ? nearestHole1.startZLocation || 0 : 0;
					const z2 = nearestHole2 ? nearestHole2.startZLocation || 0 : 0;

					// Step 17c) Convert to local Three.js coordinates
					const local1 = worldToThreeLocalFn ? worldToThreeLocalFn(worldX1, worldY1) : { x: worldX1, y: worldY1 };
					const local2 = worldToThreeLocalFn ? worldToThreeLocalFn(worldX2, worldY2) : { x: worldX2, y: worldY2 };

					// Step 17d) Create LineSegmentsGeometry
					const geometry = new LineSegmentsGeometry();
					geometry.setPositions([local1.x, local1.y, z1, local2.x, local2.y, z2]);

					// Step 17e) Create YELLOW dashed line (first layer) using LineMaterial
					const yellowMaterial = new LineMaterial({
						color: new THREE.Color(0xffff00), // Yellow
						linewidth: 3, // Pixel width
						resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
						dashed: true,
						dashScale: 1,
						dashSize: 1,
						gapSize: 1,
						alphaToCoverage: true,
						transparent: true,
						opacity: 1.0
					});
					yellowMaterial.depthTest = true;
					yellowMaterial.depthWrite = false;

					const yellowLine = new LineSegments2(geometry.clone(), yellowMaterial);
					yellowLine.computeLineDistances();
					group.add(yellowLine);

					// Step 17f) Create MAGENTA dashed line (second layer, offset) using LineMaterial
					const magentaMaterial = new LineMaterial({
						color: new THREE.Color(0xff00ff), // Magenta
						linewidth: 3, // Same width
						resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
						dashed: true,
						dashScale: 1,
						dashSize: 1,
						gapSize: 1,
						dashOffset: 1, // Offset by dash size to fill the gaps
						alphaToCoverage: true,
						transparent: true,
						opacity: 1.0
					});
					magentaMaterial.depthTest = true;
					magentaMaterial.depthWrite = false;

					const magentaLine = new LineSegments2(geometry.clone(), magentaMaterial);
					magentaLine.computeLineDistances();
					group.add(magentaLine);
				}
			}
		}

		return group;
	}

	// Step 18) Create direction arrows (positioned at collar Z elevation)
	// Creates 3D arrows visible from all angles using cone (arrowhead) + box (shaft)
	static createDirectionArrows(directionArrows, allBlastHoles, worldToThreeLocalFn) {
		const group = new THREE.Group();

		for (const arrow of directionArrows) {
			const [startX, startY, endX, endY, fillColor, size] = arrow;

			// Step 18a) Find nearest hole for start position to get collar Z
			const nearestHole = this.findNearestHole(startX, startY, allBlastHoles);
			const collarZ = nearestHole ? nearestHole.startZLocation || 0 : 0;

			// Step 18b) Convert to local Three.js coordinates
			const localStart = worldToThreeLocalFn ? worldToThreeLocalFn(startX, startY) : { x: startX, y: startY };
			const localEnd = worldToThreeLocalFn ? worldToThreeLocalFn(endX, endY) : { x: endX, y: endY };

			// Step 18c) Calculate arrow dimensions
			const dx = localEnd.x - localStart.x;
			const dy = localEnd.y - localStart.y;
			const totalLength = Math.sqrt(dx * dx + dy * dy);
			const angle = Math.atan2(dy, dx);

			// Step 18d) Arrow proportions - square cross-section shaft, proportional cone
			const shaftSize = size * 0.2;         // Square cross-section (width = height)
			const arrowHeadLength = size * 0.4;   // Cone length
			const arrowHeadRadius = size * 0.35;  // Cone base radius (slightly larger than shaft)
			const shaftLength = totalLength - arrowHeadLength;

			// Step 18e) Create material (shared for performance)
			const fillMaterial = new THREE.MeshBasicMaterial({
				color: new THREE.Color(fillColor),
			});
			const strokeColor = window.darkModeEnabled ? 0xffffff : 0x000000;

			// Step 18f) Create shaft (square prism) if there's length for it
			if (shaftLength > 0.1) {
				// BoxGeometry(width, height, depth) - width along X, height along Y, depth along Z
				// We want square cross-section in Y-Z, length along X
				const boxGeometry = new THREE.BoxGeometry(shaftLength, shaftSize, shaftSize);
				const boxMesh = new THREE.Mesh(boxGeometry, fillMaterial);
				
				// Position box at center of shaft
				const shaftCenterX = localStart.x + (shaftLength / 2) * Math.cos(angle);
				const shaftCenterY = localStart.y + (shaftLength / 2) * Math.sin(angle);
				boxMesh.position.set(shaftCenterX, shaftCenterY, collarZ + shaftSize / 2);
				boxMesh.rotation.z = angle; // Rotate to align with direction
				
				// Step 18g) Create outline for shaft (edges for cartoon look)
				const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
				const edgesMaterial = new THREE.LineBasicMaterial({ color: strokeColor });
				const edgesLine = new THREE.LineSegments(edgesGeometry, edgesMaterial);
				edgesLine.position.copy(boxMesh.position);
				edgesLine.rotation.copy(boxMesh.rotation);
				
				group.add(boxMesh);
				group.add(edgesLine);
			}

			// Step 18h) Create arrowhead (cone/pyramid) - 4 sided for performance
			// ConeGeometry creates cone pointing UP (+Y axis)
			const coneGeometry = new THREE.ConeGeometry(arrowHeadRadius, arrowHeadLength, 4);
			const coneMesh = new THREE.Mesh(coneGeometry, fillMaterial);
			
			// Step 18i) Rotate cone to point in direction of travel
			// Default cone points +Y, we need it to point along XY plane in direction of arrow
			// Rotate -90° around Z so tip points in direction of travel
			coneMesh.rotation.order = 'ZYX'; // Set rotation order for predictable results
			coneMesh.rotation.z = angle - Math.PI / 2; // Point in direction (cone tip toward end)
			
			// Position cone at arrow tip (cone center is at half its height)
			const coneCenterX = localEnd.x - (arrowHeadLength / 2) * Math.cos(angle);
			const coneCenterY = localEnd.y - (arrowHeadLength / 2) * Math.sin(angle);
			coneMesh.position.set(coneCenterX, coneCenterY, collarZ + shaftSize / 2);

			// Step 18j) Create outline for cone (edges for cartoon look)
			const coneEdgesGeometry = new THREE.EdgesGeometry(coneGeometry);
			const coneEdgesMaterial = new THREE.LineBasicMaterial({ color: strokeColor });
			const coneEdgesLine = new THREE.LineSegments(coneEdgesGeometry, coneEdgesMaterial);
			coneEdgesLine.position.copy(coneMesh.position);
			coneEdgesLine.rotation.copy(coneMesh.rotation);

			group.add(coneMesh);
			group.add(coneEdgesLine);
		}

		return group;
	}

	// Step 20.5) Create connector line with curve and arrowhead
	static createConnectorLine(fromX, fromY, fromZ, toX, toY, toZ, color, curve, delayText, connScale) {
		const group = new THREE.Group();

		// Step 20.5a) Convert color string to Three.js Color
		const threeColor = new THREE.Color(color);

		// Step 20.5b) Calculate arrow size based on connScale
		const arrowSize = (connScale / 4) * 2; // Match 2D sizing

		// Step 20.5c) Check if self-connecting (fromHole === toHole)
		const isSelfConnecting = Math.abs(fromX - toX) < 0.001 && Math.abs(fromY - toY) < 0.001;

		if (isSelfConnecting) {
			// Step 20.5c.1) Draw house shape for self-referencing (matching 2D style)
			const size = arrowSize;
			// Create shape geometry for filled house
			const shape = new THREE.Shape();
			shape.moveTo(toX, toY); // Peak
			shape.lineTo(toX - size / 2, toY + size); // Left bottom
			shape.lineTo(toX - size / 2, toY + 1.5 * size); // Left top
			shape.lineTo(toX + size / 2, toY + 1.5 * size); // Right top
			shape.lineTo(toX + size / 2, toY + size); // Right bottom
			shape.lineTo(toX, toY); // Close back to peak

			const houseGeometry = new THREE.ShapeGeometry(shape);
			const houseMaterial = new THREE.MeshBasicMaterial({ color: threeColor, side: THREE.DoubleSide });
			const houseMesh = new THREE.Mesh(houseGeometry, houseMaterial);
			houseMesh.position.z = toZ;
			group.add(houseMesh);

			// Step 20.5c.2) Draw outline/stroke
			const houseOutlinePoints = [
				new THREE.Vector3(toX, toY, toZ), // Peak
				new THREE.Vector3(toX - size / 2, toY + size, toZ), // Left bottom
				new THREE.Vector3(toX - size / 2, toY + 1.5 * size, toZ), // Left top
				new THREE.Vector3(toX + size / 2, toY + 1.5 * size, toZ), // Right top
				new THREE.Vector3(toX + size / 2, toY + size, toZ), // Right bottom
				new THREE.Vector3(toX, toY, toZ), // Close back to peak
			];

			const houseOutlineGeometry = new THREE.BufferGeometry().setFromPoints(houseOutlinePoints);
			const houseOutlineMaterial = new THREE.LineBasicMaterial({ color: threeColor, linewidth: 2 });
			const houseOutline = new THREE.Line(houseOutlineGeometry, houseOutlineMaterial);
			group.add(houseOutline);
		}
		// Step 20.5d) Handle straight connector (curve = 0)
		else if (curve === 0) {
			// Straight line
			const points = [new THREE.Vector3(fromX, fromY, fromZ), new THREE.Vector3(toX, toY, toZ)];
			const geometry = new THREE.BufferGeometry().setFromPoints(points);
			const material = new THREE.LineBasicMaterial({ color: threeColor, linewidth: 2 });
			const line = new THREE.Line(geometry, material);
			group.add(line);

			// Step 20.5d.1) Create arrowhead for straight line
			const direction = new THREE.Vector3(toX - fromX, toY - fromY, toZ - fromZ).normalize();
			const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0);
			const arrowBase = new THREE.Vector3(toX, toY, toZ);

			// Step 20.5d.2) Calculate arrow vertices
			const tip = new THREE.Vector3(toX, toY, toZ);
			const left = arrowBase
				.clone()
				.add(direction.clone().multiplyScalar(-arrowSize))
				.add(perpendicular.clone().multiplyScalar(arrowSize * 0.5));
			const right = arrowBase
				.clone()
				.add(direction.clone().multiplyScalar(-arrowSize))
				.add(perpendicular.clone().multiplyScalar(-arrowSize * 0.5));

			// Step 20.5d.3) Create filled arrow using THREE.Shape (fixes missing arrows)
			const arrowShape = new THREE.Shape();
			arrowShape.moveTo(tip.x, tip.y);
			arrowShape.lineTo(left.x, left.y);
			arrowShape.lineTo(right.x, right.y);
			arrowShape.lineTo(tip.x, tip.y);

			const arrowGeometry = new THREE.ShapeGeometry(arrowShape);
			const arrowMaterial = new THREE.MeshBasicMaterial({ color: threeColor, side: THREE.DoubleSide });
			const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
			arrowMesh.position.z = toZ;
			group.add(arrowMesh);
		} else {
			// Step 20.5e) Handle curved connector
			const midX = (fromX + toX) / 2;
			const midY = (fromY + toY) / 2;
			const midZ = (fromZ + toZ) / 2;
			const dx = toX - fromX;
			const dy = toY - fromY;
			const distance = Math.sqrt(dx * dx + dy * dy);

			// Step 20.5f) Calculate control point based on curve angle
			const radians = (curve * Math.PI) / 180;
			const curveFactor = (curve / 90) * distance * 0.5;

			// Perpendicular vector for curve direction
			const perpX = -dy / distance;
			const perpY = dx / distance;

			const controlX = midX - perpX * curveFactor;
			const controlY = midY - perpY * curveFactor;
			const controlZ = midZ;

			// Step 20.5g) Create quadratic bezier curve
			const curvePoints = [];
			const segments = 20; // Number of segments for smooth curve
			for (let i = 0; i <= segments; i++) {
				const t = i / segments;
				const x = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * controlX + t * t * toX;
				const y = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * controlY + t * t * toY;
				const z = (1 - t) * (1 - t) * fromZ + 2 * (1 - t) * t * controlZ + t * t * toZ;
				curvePoints.push(new THREE.Vector3(x, y, z));
			}

			const curveGeometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
			const curveMaterial = new THREE.LineBasicMaterial({ color: threeColor, linewidth: 2 });
			const curveLine = new THREE.Line(curveGeometry, curveMaterial);
			group.add(curveLine);

			// Step 20.5h) Create arrowhead for curved line (tangent at end point)
			// Calculate tangent at end point (derivative of quadratic bezier at t=1)
			const tangentX = 2 * (toX - controlX);
			const tangentY = 2 * (toY - controlY);
			const tangentZ = 2 * (toZ - controlZ);
			const tangentLength = Math.sqrt(tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ);
			const direction = new THREE.Vector3(tangentX / tangentLength, tangentY / tangentLength, tangentZ / tangentLength);

			const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0);
			const arrowBase = new THREE.Vector3(toX, toY, toZ);

			// Step 20.5h.1) Calculate arrow vertices
			const tip = new THREE.Vector3(toX, toY, toZ);
			const left = arrowBase
				.clone()
				.add(direction.clone().multiplyScalar(-arrowSize))
				.add(perpendicular.clone().multiplyScalar(arrowSize * 0.5));
			const right = arrowBase
				.clone()
				.add(direction.clone().multiplyScalar(-arrowSize))
				.add(perpendicular.clone().multiplyScalar(-arrowSize * 0.5));

			// Step 20.5h.2) Create filled arrow using THREE.Shape (fixes missing arrows)
			const arrowShape = new THREE.Shape();
			arrowShape.moveTo(tip.x, tip.y);
			arrowShape.lineTo(left.x, left.y);
			arrowShape.lineTo(right.x, right.y);
			arrowShape.lineTo(tip.x, tip.y);

			const arrowGeometry = new THREE.ShapeGeometry(arrowShape);
			const arrowMaterial = new THREE.MeshBasicMaterial({ color: threeColor, side: THREE.DoubleSide });
			const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
			arrowMesh.position.z = toZ;
			group.add(arrowMesh);
		}

		// Step 20.5i) Add delay text if provided (matching 2D drawArrowDelayText behavior)
		// NOTE: Cannot use createKADText cache here because connector groups are cleared/rebuilt
		// and cached text would get orphaned. Use fresh Troika text for connectors.
		if (delayText !== null && delayText !== undefined) {
			// Step 20.5i.1) Calculate text position and angle based on curve
			let textX, textY, textAngle;
			const dx = toX - fromX;
			const dy = toY - fromY;
			const distance = Math.sqrt(dx * dx + dy * dy);
			
			if (curve === 0 || distance < 0.001) {
				// Step 20.5i.2) Straight connector - use midpoint
				textX = (fromX + toX) / 2;
				textY = (fromY + toY) / 2;
				textAngle = Math.atan2(dy, dx);
			} else {
				// Step 20.5i.3) Curved connector - calculate point on curve at t=0.5
				const curveFactor = (curve / 90) * distance * 0.5;
				const perpX = -dy / distance;
				const perpY = dx / distance;
				
				// Control point for quadratic bezier
				const controlX = (fromX + toX) / 2 + perpX * curveFactor;
				const controlY = (fromY + toY) / 2 + perpY * curveFactor;
				
				// Calculate actual point on curve at t=0.5
				const t = 0.5;
				const oneMinusT = 1 - t;
				textX = oneMinusT * oneMinusT * fromX + 2 * oneMinusT * t * controlX + t * t * toX;
				textY = oneMinusT * oneMinusT * fromY + 2 * oneMinusT * t * controlY + t * t * toY;
				
				// Calculate tangent angle at t=0.5 for text rotation
				const tangentX = 2 * oneMinusT * (controlX - fromX) + 2 * t * (toX - controlX);
				const tangentY = 2 * oneMinusT * (controlY - fromY) + 2 * t * (toY - controlY);
				textAngle = Math.atan2(tangentY, tangentX);
			}
			
			// Step 20.5i.4) Offset text perpendicular to line (above it)
			const perpAngle = textAngle - Math.PI / 2;
			const offsetDistance = 0.3;
			textX += Math.cos(perpAngle) * offsetDistance;
			textY += Math.sin(perpAngle) * offsetDistance;
			
			// Step 20.5i.5) Z position slightly above connector
			const textZ = Math.max(fromZ, toZ) + 0.2;
			
			// Step 20.5i.6) Create Troika text for delay (NOT cached - connectors are rebuilt)
			const delayString = String(delayText);
			const cameraZoom = (window.threeRenderer && window.threeRenderer.camera) ? window.threeRenderer.camera.zoom : 1;
			const fontSizeWorldUnits = 10 / cameraZoom;
			
			const textMesh = new Text();
			textMesh.text = delayString;
			textMesh.fontSize = fontSizeWorldUnits;
			textMesh.color = color;
			textMesh.anchorX = "center";
			textMesh.anchorY = "middle";
			textMesh.position.set(textX, textY, textZ);
			
			// Step 20.5i.7) Rotate text to align with connector shaft
			textMesh.rotation.z = textAngle;
			
			textMesh.renderOrder = 100;
			
			// Step 20.5i.8) Load font
			try {
				const robotoFontUrl = new URL("../fonts/Roboto-Regular.ttf", import.meta.url).href;
				textMesh.font = robotoFontUrl;
			} catch (error) {
				textMesh.font = "Arial";
			}
			
			// Step 20.5i.9) Sync and configure material
			textMesh.sync();
			if (textMesh.material) {
				textMesh.material.depthTest = true;
				textMesh.material.depthWrite = false;
				textMesh.material.transparent = true;
			}
			
			textMesh.userData = { type: "connectorDelayText", isTroikaText: true };
			group.add(textMesh);
		}

		return group;
	}

	// Step 20.6) Create standalone connector delay text (without connector line)
	// Used when delay values are shown but connectors are hidden
	static createConnectorDelayText(fromX, fromY, fromZ, toX, toY, toZ, color, curve, delayValue) {
		if (delayValue === null || delayValue === undefined) return null;
		
		const group = new THREE.Group();
		
		// Step 20.6a) Calculate text position and angle based on curve
		let textX, textY, textAngle;
		const dx = toX - fromX;
		const dy = toY - fromY;
		const distance = Math.sqrt(dx * dx + dy * dy);
		
		if (curve === 0 || distance < 0.001) {
			// Step 20.6b) Straight path - use midpoint
			textX = (fromX + toX) / 2;
			textY = (fromY + toY) / 2;
			textAngle = Math.atan2(dy, dx);
		} else {
			// Step 20.6c) Curved path - calculate point on curve at t=0.5
			const curveFactor = (curve / 90) * distance * 0.5;
			const perpX = -dy / distance;
			const perpY = dx / distance;
			
			const controlX = (fromX + toX) / 2 + perpX * curveFactor;
			const controlY = (fromY + toY) / 2 + perpY * curveFactor;
			
			const t = 0.5;
			const oneMinusT = 1 - t;
			textX = oneMinusT * oneMinusT * fromX + 2 * oneMinusT * t * controlX + t * t * toX;
			textY = oneMinusT * oneMinusT * fromY + 2 * oneMinusT * t * controlY + t * t * toY;
			
			const tangentX = 2 * oneMinusT * (controlX - fromX) + 2 * t * (toX - controlX);
			const tangentY = 2 * oneMinusT * (controlY - fromY) + 2 * t * (toY - controlY);
			textAngle = Math.atan2(tangentY, tangentX);
		}
		
		// Step 20.6d) Offset text perpendicular to line
		const perpAngle = textAngle - Math.PI / 2;
		const offsetDistance = 0.3;
		textX += Math.cos(perpAngle) * offsetDistance;
		textY += Math.sin(perpAngle) * offsetDistance;
		
		// Step 20.6e) Z position
		const textZ = Math.max(fromZ, toZ) + 0.2;
		
		// Step 20.6f) Create Troika text
		const delayString = String(delayValue);
		const cameraZoom = (window.threeRenderer && window.threeRenderer.camera) ? window.threeRenderer.camera.zoom : 1;
		const fontSizeWorldUnits = 10 / cameraZoom;
		
		const textMesh = new Text();
		textMesh.text = delayString;
		textMesh.fontSize = fontSizeWorldUnits;
		textMesh.color = color;
		textMesh.anchorX = "center";
		textMesh.anchorY = "middle";
		textMesh.position.set(textX, textY, textZ);
		textMesh.rotation.z = textAngle;
		textMesh.renderOrder = 100;
		
		// Step 20.6g) Load font
		try {
			const robotoFontUrl = new URL("../fonts/Roboto-Regular.ttf", import.meta.url).href;
			textMesh.font = robotoFontUrl;
		} catch (error) {
			textMesh.font = "Arial";
		}
		
		// Step 20.6h) Sync and configure material
		textMesh.sync();
		if (textMesh.material) {
			textMesh.material.depthTest = true;
			textMesh.material.depthWrite = false;
			textMesh.material.transparent = true;
		}
		
		textMesh.userData = { type: "standaloneDelayText", isTroikaText: true };
		group.add(textMesh);
		
		return group;
	}

	// Step 20.6) Create selection highlight ring (matching drawHiHole style)
	// Uses torus flat on X-Y plane (horizontal in world coords) for plan view visibility
	// Plan view = looking from Z+ve to Z-ve, so torus should be flat on X-Y plane (no rotation needed)
	static createSelectionHighlight(x, y, z, radius, fillColor, strokeColor, collarX, collarY, collarZ, toeX, toeY, toeZ) {
		const group = new THREE.Group();

		// Step 20.6a) Parse RGBA colors
		const fillColorObj = this.parseRGBA(fillColor);
		const strokeColorObj = this.parseRGBA(strokeColor);

		// Step 20.6b) Create fill ring using torus geometry (flat on X-Y plane for plan view)
		// Three.js TorusGeometry is created flat on X-Y plane by default (horizontal in world coords)
		// No rotation needed - it's already oriented correctly for plan view (looking down Z-axis)
		const torusRadius = radius * 0.9; // Slightly smaller for inner fill
		const tubeRadius = radius * 0.4; // Thick tube for fill visibility
		const fillTorusGeometry = new THREE.TorusGeometry(torusRadius, tubeRadius, 16, 32);
		const fillMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(fillColorObj.r, fillColorObj.g, fillColorObj.b),
			transparent: true,
			opacity: fillColorObj.a,
			side: THREE.DoubleSide,
		});
		const fillTorusMesh = new THREE.Mesh(fillTorusGeometry, fillMaterial);
		fillTorusMesh.position.set(x, y, z);
		// No rotation - torus is flat on X-Y plane (horizontal in world coords), visible in plan view
		group.add(fillTorusMesh);

		// Step 20.6c) Create outer stroke ring using torus geometry (flat on X-Y plane for plan view)
		const strokeTorusRadius = radius * 1.2;
		const strokeTubeRadius = radius * 0.2; // Thin tube for stroke
		const strokeTorusGeometry = new THREE.TorusGeometry(strokeTorusRadius, strokeTubeRadius, 16, 32);
		const strokeMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(strokeColorObj.r, strokeColorObj.g, strokeColorObj.b),
			transparent: false,
			opacity: strokeColorObj.a,
			side: THREE.DoubleSide,
		});
		const strokeTorusMesh = new THREE.Mesh(strokeTorusGeometry, strokeMaterial);
		strokeTorusMesh.position.set(x, y, z);
		// No rotation - torus is flat on X-Y plane (horizontal in world coords), visible in plan view
		group.add(strokeTorusMesh);

		// Step 20.6d) Create transparent tube geometry connecting collar to toe (visible when orbiting)
		if (collarX !== undefined && collarY !== undefined && collarZ !== undefined && toeX !== undefined && toeY !== undefined && toeZ !== undefined) {
			// Step 20.6d.1) Create straight line curve from collar to toe using LineCurve3
			const collarPoint = new THREE.Vector3(collarX, collarY, collarZ);
			const toePoint = new THREE.Vector3(toeX, toeY, toeZ);
			const curve = new THREE.LineCurve3(collarPoint, toePoint);

			// Step 20.6d.2) Create tube geometry with transparent torus radius
			// segments = 1, radialSegments = 8, radius = transparent torus radius (tubeRadius)
			const tubeGeometry = new THREE.TubeGeometry(curve, 1, tubeRadius, 8, false);

			// Step 20.6d.3) Create transparent material matching fill color
			const tubeMaterial = new THREE.MeshBasicMaterial({
				color: new THREE.Color(fillColorObj.r, fillColorObj.g, fillColorObj.b),
				transparent: true,
				opacity: fillColorObj.a,
				side: THREE.DoubleSide,
				wireframe: false, // No wireframe
			});

			// Step 20.6d.4) Create mesh and add to group
			const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
			group.add(tubeMesh);
		}

		return group;
	}

	// Step 20.7) Parse RGBA color string to object
	static parseRGBA(rgbaString) {
		const match = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
		if (match) {
			return {
				r: parseInt(match[1]) / 255,
				g: parseInt(match[2]) / 255,
				b: parseInt(match[3]) / 255,
				a: match[4] ? parseFloat(match[4]) : 1.0,
			};
		}
		// Fallback to white
		return { r: 1, g: 1, b: 1, a: 1 };
	}

	// Step 20.7.5) Calculate zoom scale factor based on current scale
	// Returns a multiplier that increases highlight size when zoomed out
	static getZoomScaleFactor() {
		const currentScale = window.currentScale || 5;
		// Base scale is 5, so when zoomed out (lower scale), increase highlight size
		// When scale = 1 (very zoomed out), factor = 5
		// When scale = 5 (normal), factor = 1
		// When scale = 10 (zoomed in), factor = 0.5
		const baseScale = 5;
		const zoomFactor = baseScale / currentScale;
		// Clamp between 0.5 and 5 to prevent extreme sizes
		return Math.max(0.5, Math.min(5, zoomFactor));
	}

	// Step 20.8) Create KAD line highlight for selection using LineMaterial/LineSegments2 (fat lines)
	// Used to highlight selected/non-selected line segments
	// Uses LineMaterial for consistent screen-space line width
	static createKADLineHighlight(x1, y1, z1, x2, y2, z2, baseRadius, color) {
		// Step 20.8a) Parse color
		let colorObj;
		if (typeof color === "string" && color.startsWith("#")) {
			// Hex color
			const c = new THREE.Color(color);
			colorObj = { r: c.r, g: c.g, b: c.b, a: 1.0 };
		} else if (typeof color === "string" && color.startsWith("rgba")) {
			// RGBA color
			colorObj = this.parseRGBA(color);
		} else {
			// Default fallback
			colorObj = { r: 0, g: 1, b: 0, a: 1 };
		}

		// Step 20.8b) Convert baseRadius to pixel line width
		// baseRadius is in world units (typically 0.3-0.6), convert to pixel width
		const lineWidth = baseRadius * 20; // Convert to pixel width

		// Step 20.8c) Create LineSegmentsGeometry
		const geometry = new LineSegmentsGeometry();
		geometry.setPositions([x1, y1, z1, x2, y2, z2]);

		// Step 20.8d) Create LineMaterial with screen-space linewidth
		const material = new LineMaterial({
			color: new THREE.Color(colorObj.r, colorObj.g, colorObj.b),
			linewidth: lineWidth, // Pixel width (screen-space)
			resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
			dashed: false,
			alphaToCoverage: true,
			transparent: colorObj.a < 1,
			opacity: colorObj.a
		});
		material.depthTest = true;
		material.depthWrite = false;

		// Step 20.8e) Create LineSegments2
		const lineSegments = new LineSegments2(geometry, material);
		lineSegments.computeLineDistances();
		lineSegments.name = "kad-line-highlight";

		return lineSegments;
	}

	// Step 20.9) Create KAD point highlight for selection
	// Uses simple Points geometry WITHOUT texture for efficient rendering
	// No canvas texture = no WebGL context exhaustion, better performance
	static createKADPointHighlight(x, y, z, baseRadius, color) {
		// Step 20.9a) Parse color to THREE.Color
		var threeColor;
		var opacity = 1.0;
		
		if (typeof color === "string" && color.startsWith("#")) {
			// Hex color
			threeColor = new THREE.Color(color);
		} else if (typeof color === "string" && color.startsWith("rgba")) {
			// RGBA color - parse it
			var colorObj = this.parseRGBA(color);
			threeColor = new THREE.Color(colorObj.r, colorObj.g, colorObj.b);
			opacity = colorObj.a;
		} else {
			// Default fallback - red
			threeColor = new THREE.Color(1, 0, 0);
			opacity = 0.5;
		}

		// Step 20.9b) Convert baseRadius to pixel size
		// baseRadius typically ranges from 0.5 to 1.0, scale for visibility
		// Highlight points are larger (doubled) for visibility
		var pixelSize = baseRadius * 20; // Convert world units to pixels

		// Step 20.9c) Create BufferGeometry with single point
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute([x, y, z], 3));

		// Step 20.9d) Create simple PointsMaterial WITHOUT texture (efficient!)
		// No canvas texture = no WebGL context exhaustion, better performance
		var material = new THREE.PointsMaterial({
			color: threeColor, // Direct color (no texture)
			size: pixelSize, // Size in pixels when sizeAttenuation is false
			sizeAttenuation: false, // KEY: Maintains constant pixel size regardless of zoom/distance
			transparent: opacity < 1,
			opacity: opacity,
			depthTest: true,
			depthWrite: false
		});

		// Step 20.9e) Create Points object
		var points = new THREE.Points(geometry, material);
		points.position.set(0, 0, 0); // Points are positioned via geometry attributes

		return points;
	}

	// Step 20.10) Create KAD circle highlight for selection using LineMaterial/LineSegments2 (fat lines)
	// Creates a circle outline with consistent screen-space line width
	static createKADCircleHighlight(x, y, z, radius, lineWidth, color) {
		// Step 20.10a) Parse color
		let colorObj;
		if (typeof color === "string" && color.startsWith("#")) {
			// Hex color
			const c = new THREE.Color(color);
			colorObj = { r: c.r, g: c.g, b: c.b, a: 1.0 };
		} else if (typeof color === "string" && color.startsWith("rgba")) {
			// RGBA color
			colorObj = this.parseRGBA(color);
		} else {
			// Default fallback
			colorObj = { r: 0, g: 1, b: 0, a: 1 };
		}

		// Step 20.10b) Create circle geometry as line segments (64 segments for smooth circle)
		const segments = 64;
		const positions = [];
		for (let i = 0; i < segments; i++) {
			const angle1 = (i / segments) * Math.PI * 2;
			const angle2 = ((i + 1) / segments) * Math.PI * 2;
			// Start point of segment
			positions.push(x + Math.cos(angle1) * radius, y + Math.sin(angle1) * radius, z);
			// End point of segment
			positions.push(x + Math.cos(angle2) * radius, y + Math.sin(angle2) * radius, z);
		}

		// Step 20.10c) Create LineSegmentsGeometry
		const geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);

		// Step 20.10d) Create LineMaterial with screen-space linewidth
		const pixelWidth = lineWidth || 3; // Default highlight width
		const material = new LineMaterial({
			color: new THREE.Color(colorObj.r, colorObj.g, colorObj.b),
			linewidth: pixelWidth, // Pixel width (screen-space)
			resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
			dashed: false,
			alphaToCoverage: true,
			transparent: colorObj.a < 1,
			opacity: colorObj.a
		});
		material.depthTest = true;
		material.depthWrite = false;

		// Step 20.10e) Create LineSegments2
		const circleSegments = new LineSegments2(geometry, material);
		circleSegments.computeLineDistances();
		return circleSegments;
	}

	// Step 20.11) Create KAD text box highlight for selection
	// Creates a transparent box outline around text
	static createKADTextBoxHighlight(x, y, z, width, height, color) {
		const group = new THREE.Group();

		// Step 20.11a) Parse color
		let colorObj;
		if (typeof color === "string" && color.startsWith("#")) {
			// Hex color
			const c = new THREE.Color(color);
			colorObj = { r: c.r, g: c.g, b: c.b, a: 1.0 };
		} else if (typeof color === "string" && color.startsWith("rgba")) {
			// RGBA color
			colorObj = this.parseRGBA(color);
		} else {
			// Default fallback
			colorObj = { r: 0, g: 1, b: 0, a: 1 };
		}

		// Step 20.11b) Create box geometry
		const boxGeometry = new THREE.PlaneGeometry(width, height);

		// Step 20.11c) Create edges from the box for outline
		const edges = new THREE.EdgesGeometry(boxGeometry);
		const lineMaterial = new THREE.LineBasicMaterial({
			color: new THREE.Color(colorObj.r, colorObj.g, colorObj.b),
			transparent: colorObj.a < 1,
			opacity: colorObj.a,
			linewidth: 2,
			depthTest: true,
			depthWrite: false,
		});

		const boxEdges = new THREE.LineSegments(edges, lineMaterial);
		boxEdges.position.set(x, y, z);
		group.add(boxEdges);

		return group;
	}

	// Step 20.12) Create stadium zone (capsule: cylinder with hemispheres on ends)
	// Visible from all orientations in 3D
	static createStadiumZone(startX, startY, startZ, endX, endY, endZ, radius, strokeColor, fillColor) {
		const group = new THREE.Group();

		// Step 1) Validate inputs to prevent NaN values
		if (!isFinite(startX) || !isFinite(startY) || !isFinite(startZ) || !isFinite(endX) || !isFinite(endY) || !isFinite(endZ) || !isFinite(radius) || radius <= 0) {
			console.warn("createStadiumZone: Invalid coordinates or radius", {
				startX,
				startY,
				startZ,
				endX,
				endY,
				endZ,
				radius,
			});
			return group; // Return empty group if invalid
		}

		// Step 2) Parse colors
		const strokeColorObj = this.parseRGBA(strokeColor);
		const fillColorObj = this.parseRGBA(fillColor);

		// Step 3) Calculate vector from start to end
		const dx = endX - startX;
		const dy = endY - startY;
		const dz = endZ - startZ;
		const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

		if (length < 0.001) return group; // Avoid zero-length capsules

		// Step 4) Create cylinder (main body of capsule)
		const cylinderGeometry = new THREE.CylinderGeometry(radius, radius, length, 16, 1);
		const fillMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(fillColorObj.r, fillColorObj.g, fillColorObj.b),
			transparent: true,
			opacity: fillColorObj.a,
			side: THREE.DoubleSide,
			depthWrite: false, // Allow transparency to work correctly
		});
		const cylinder = new THREE.Mesh(cylinderGeometry, fillMaterial);

		// Step 5) Create hemispheres for ends
		const sphereGeometry = new THREE.SphereGeometry(radius, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
		const startHemisphere = new THREE.Mesh(sphereGeometry, fillMaterial.clone());
		const endHemisphere = new THREE.Mesh(sphereGeometry, fillMaterial.clone());

		// Step 6) Position and orient cylinder
		// Cylinder is created along Y-axis, need to align with our vector
		const midX = (startX + endX) / 2;
		const midY = (startY + endY) / 2;
		const midZ = (startZ + endZ) / 2;
		cylinder.position.set(midX, midY, midZ);

		// Step 7) Rotate cylinder to align with start->end vector
		// Default cylinder is along Y-axis (0, 1, 0)
		const axis = new THREE.Vector3(dx, dy, dz).normalize();
		const yAxis = new THREE.Vector3(0, 1, 0);
		const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, axis);
		cylinder.quaternion.copy(quaternion);

		// Step 8) Position hemispheres at ends
		startHemisphere.position.set(startX, startY, startZ);
		endHemisphere.position.set(endX, endY, endZ);

		// Step 9) Orient hemispheres to face outward
		startHemisphere.quaternion.copy(quaternion);
		startHemisphere.rotateX(Math.PI); // Flip to face start direction
		endHemisphere.quaternion.copy(quaternion);

		// Step 10) Add all meshes to group
		group.add(cylinder);
		group.add(startHemisphere);
		group.add(endHemisphere);

		return group;
	}

	// Step 20.9) Create mouse position indicator (single grey torus)
	// Now supports billboarding to always face camera
	static createMousePositionIndicator(x, y, z, size = 1.0, color = "rgba(128, 128, 128, 0.2)", billboard = false) {
		const group = new THREE.Group();

		// Step 20.9a) Validate inputs
		if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(size) || size <= 0) {
			return group; // Return empty group if invalid
		}

		// Step 20.9b) Parse color (grey, 20% opaque / 80% transparent)
		const colorObj = this.parseRGBA(color);
		const material = new THREE.MeshBasicMaterial({
			color: new THREE.Color(colorObj.r, colorObj.g, colorObj.b),
			transparent: true,
			opacity: colorObj.a,
			side: THREE.DoubleSide,
			depthTest: true, // Respect depth for proper 3D visualization
			depthWrite: false, // But don't block other transparent objects
		});

		// Step 20.9c) Create sphere to represent snap radius zone (no billboarding needed!)
		const sphereRadius = size; // Radius matches snap tolerance
		const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 16, 12); // 16x12 segments for smoothness
		const sphereMesh = new THREE.Mesh(sphereGeometry, material);

		// Step 20.9d) Position sphere at mouse location
		sphereMesh.position.set(x, y, z);

		// No billboarding needed - sphere looks the same from all angles!

		group.add(sphereMesh);

		return group;
	}

	// Step 21) Create voronoi cells (extruded, positioned below reference Z)
	// useToeLocation: false = collar (0.1m below, extrude 0.2m down), true = toe (0.1m above toe, extrude 0.2m up)
	// selectedMetric: the property name to use for coloring (e.g., "powderFactor", "mass", "volume", "area", "measuredLength", "designedLength", "holeFiringTime")
	static createVoronoiCells(cells, getColorFunction, allBlastHoles, worldToThreeLocalFn, extrusionHeight, useToeLocation, selectedMetric) {
		var group = new THREE.Group();

		// Step 21a) Default parameters
		if (extrusionHeight === undefined || extrusionHeight === null) {
			extrusionHeight = 0.2;
		}
		if (useToeLocation === undefined || useToeLocation === null) {
			useToeLocation = false;
		}
		// Default to powderFactor if no metric specified (backward compatibility)
		if (!selectedMetric) {
			selectedMetric = "powderFactor";
		}

		for (var c = 0; c < cells.length; c++) {
			var cell = cells[c];
			if (!cell.polygon || cell.polygon.length < 3) continue;

			// Step 21b) Find nearest hole to get reference Z (collar or toe)
			var sumX = 0,
				sumY = 0;
			for (var p = 0; p < cell.polygon.length; p++) {
				var pt = cell.polygon[p];
				sumX += pt.x !== undefined ? pt.x : pt[0];
				sumY += pt.y !== undefined ? pt.y : pt[1];
			}
			var cellCenterX = sumX / cell.polygon.length;
			var cellCenterY = sumY / cell.polygon.length;
			var nearestHole = this.findNearestHole(cellCenterX, cellCenterY, allBlastHoles);

			var baseZ;
			if (useToeLocation) {
				// Step 21b.1) Toe mode: 0.1m above toe, extrude up 0.2m
				var toeZ = nearestHole ? nearestHole.endZLocation || 0 : 0;
				baseZ = toeZ + 0.1; // 0.1m above toe
			} else {
				// Step 21b.2) Collar mode: 0.1m below collar, extrude down 0.2m
				var collarZ = nearestHole ? nearestHole.startZLocation || 0 : 0;
				baseZ = collarZ - 0.1 - extrusionHeight; // Start 0.1m + extrusion below collar
			}

			// Step 21c) Create shape from polygon (convert to local coordinates)
			var shape = new THREE.Shape();
			var firstPt = cell.polygon[0];
			var firstX = firstPt.x !== undefined ? firstPt.x : firstPt[0];
			var firstY = firstPt.y !== undefined ? firstPt.y : firstPt[1];
			var firstLocal = worldToThreeLocalFn ? worldToThreeLocalFn(firstX, firstY) : { x: firstX, y: firstY };
			shape.moveTo(firstLocal.x, firstLocal.y);

			for (var i = 1; i < cell.polygon.length; i++) {
				var pt2 = cell.polygon[i];
				var x = pt2.x !== undefined ? pt2.x : pt2[0];
				var y = pt2.y !== undefined ? pt2.y : pt2[1];
				var local = worldToThreeLocalFn ? worldToThreeLocalFn(x, y) : { x: x, y: y };
				shape.lineTo(local.x, local.y);
			}
			shape.closePath();

			// Step 21d) Get color based on selected metric - matches 2D behavior (line 22172 in kirra.js)
			// Use cell[selectedMetric] to dynamically get the correct property value
			var value = cell[selectedMetric];
			if (value === undefined || value === null || isNaN(value)) {
				value = 0;
			}
			var color = getColorFunction(value);

			// Step 21e) Create extruded geometry
			var extrudeSettings = {
				depth: extrusionHeight,
				bevelEnabled: false,
			};
			var geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
			geometry.translate(0, 0, baseZ);

			var material = new THREE.MeshPhongMaterial({
				color: new THREE.Color(color),
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.6,
			});

			var mesh = new THREE.Mesh(geometry, material);
			group.add(mesh);
		}

		return group;
	}

	// Step 23) Create background image plane
	// zElevation parameter allows placing image at specific Z level in 3D space
	// Default uses drawingZLevel, then dataCentroidZ, then 0
	static createImagePlane(imageCanvas, bbox, transparency = 1.0, zElevation = null) {
		// Step 24) Validate bbox before calculating dimensions
		if (!bbox || bbox.length < 4 || !bbox.every(v => isFinite(v))) {
			console.error("Invalid bbox for image plane:", bbox);
			return null;
		}

		// Step 24) Calculate dimensions
		const width = bbox[2] - bbox[0];
		const height = bbox[3] - bbox[1];

		// Step 24b) Validate dimensions
		if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
			console.error("Invalid image plane dimensions:", { width, height, bbox });
			return null;
		}

		const centerX = (bbox[0] + bbox[2]) / 2;
		const centerY = (bbox[1] + bbox[3]) / 2;

		// Step 24a) Determine Z elevation for the image plane
		// Priority: explicit zElevation > drawingZLevel > dataCentroidZ > 0
		var z;
		if (zElevation !== null && zElevation !== undefined && isFinite(zElevation)) {
			z = zElevation;
		} else if (window.drawingZLevel !== undefined && isFinite(window.drawingZLevel)) {
			z = window.drawingZLevel;
		} else if (window.dataCentroidZ !== undefined && isFinite(window.dataCentroidZ)) {
			z = window.dataCentroidZ;
		} else {
			z = 0;
		}
		// Offset slightly below to avoid z-fighting with data at same elevation
		z = z - 1;

		// Step 25) Create texture from canvas
		const texture = new THREE.CanvasTexture(imageCanvas);
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		// Step 25a) CRITICAL: Set correct color space encoding for accurate colors
		texture.colorSpace = THREE.SRGBColorSpace;

		// Step 26) Create plane geometry
		const geometry = new THREE.PlaneGeometry(width, height);
		const material = new THREE.MeshBasicMaterial({
			map: texture,
			transparent: true,
			alphaTest: 0.01,
			opacity: transparency,
			side: THREE.DoubleSide,
		});

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(centerX, centerY, z);

		return mesh;
	}

	// Step 27) Create highlight mesh for selection
	static createHighlightMesh(originalMesh, highlightColor) {
		const geometry = originalMesh.geometry.clone();
		const material = new THREE.MeshBasicMaterial({
			color: new THREE.Color(highlightColor),
			transparent: true,
			opacity: 0.5,
			side: THREE.DoubleSide,
		});

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(originalMesh.position);
		mesh.rotation.copy(originalMesh.rotation);
		mesh.scale.copy(originalMesh.scale);

		return mesh;
	}

	// Step 28) Create instanced holes for performance optimization
	// Returns an object containing InstancedMesh objects and mapping tables
	static createInstancedHoles(allBlastHoles, holeScale, isDarkMode, worldToThreeLocal, toeSizeInMeters, showConnectors) {
		if (!allBlastHoles || allBlastHoles.length === 0) {
			return null;
		}

		// Default values
		toeSizeInMeters = toeSizeInMeters || 1.0;
		showConnectors = showConnectors !== undefined ? showConnectors : false;

		var visibleHoles = allBlastHoles.filter(function(hole) {
			return hole.visible !== false;
		});
		var holeCount = visibleHoles.length;
		
		if (holeCount === 0) {
			return null;
		}

		// Step 28a) Create shared geometry for collar circles
		// Use average diameter for shared geometry
		var avgDiameter = 0;
		var totalDiameter = 0;
		for (var i = 0; i < visibleHoles.length; i++) {
			var d = parseFloat(visibleHoles[i].holeDiameter) || 89;
			totalDiameter += d;
		}
		avgDiameter = totalDiameter / visibleHoles.length;
		var avgRadiusMeters = (avgDiameter / 1000 / 2) * (holeScale * 2);
		
		var collarGeometry = new THREE.CircleGeometry(avgRadiusMeters, 32);
		var collarColor = isDarkMode ? 0xffffff : 0x000000;
		var collarMaterial = new THREE.MeshBasicMaterial({
			color: collarColor,
			side: THREE.DoubleSide,
			transparent: false,
			depthTest: true,
			depthWrite: true
		});

		// Step 28b) Create InstancedMesh for collars
		var instancedCollars = new THREE.InstancedMesh(collarGeometry, collarMaterial, holeCount);
		instancedCollars.userData = { type: "instancedHoleCollars" };

		// Step 28c) Count holes by subdrill type (positive vs negative/zero)
		var positiveSubdrillHoles = [];
		var negativeSubdrillHoles = [];
		for (var i = 0; i < visibleHoles.length; i++) {
			var subdrill = visibleHoles[i].subdrillAmount || 0;
			if (subdrill > 0) {
				positiveSubdrillHoles.push(visibleHoles[i]);
			} else {
				negativeSubdrillHoles.push(visibleHoles[i]);
			}
		}

		// Step 28d) Create shared geometry for grade circles (smaller than collar, RED)
		var gradeRadiusMeters = avgRadiusMeters * 0.5;
		var gradeGeometry = new THREE.CircleGeometry(gradeRadiusMeters, 32);

		// Step 28d.1) Create material for POSITIVE subdrill grades (RED, solid)
		var gradeMatPos = new THREE.MeshBasicMaterial({
			color: 0xff0000, // RED
			side: THREE.DoubleSide,
			transparent: false,
			opacity: 1.0,
			depthTest: true,
			depthWrite: true
		});

		// Step 28d.2) Create material for NEGATIVE/ZERO subdrill grades (RED, transparent)
		var gradeMatNeg = new THREE.MeshBasicMaterial({
			color: 0xff0000, // RED
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.2,
			depthTest: true,
			depthWrite: false
		});

		// Step 28e) Create InstancedMesh for positive subdrill grades (may be 0 if no positive grades)
		var instancedGradesPositive = null;
		if (positiveSubdrillHoles.length > 0) {
			instancedGradesPositive = new THREE.InstancedMesh(gradeGeometry, gradeMatPos, positiveSubdrillHoles.length);
			instancedGradesPositive.userData = { type: "instancedHoleGrades" };
		}

		// Step 28f) Create InstancedMesh for negative/zero subdrill grades
		var instancedGradesNegative = null;
		if (negativeSubdrillHoles.length > 0) {
			instancedGradesNegative = new THREE.InstancedMesh(gradeGeometry.clone(), gradeMatNeg, negativeSubdrillHoles.length);
			instancedGradesNegative.userData = { type: "instancedHoleGrades" };
		}

		// Step 28g) Create mapping tables
		var instanceIdToHole = new Map();
		var holeToInstanceId = new Map();

		// Step 28h) Set positions for each hole instance
		var matrix = new THREE.Matrix4();
		var gradeMatrix = new THREE.Matrix4();
		var posIdx = 0;
		var negIdx = 0;

		for (var i = 0; i < visibleHoles.length; i++) {
			var hole = visibleHoles[i];
			var holeId = hole.entityName + ":::" + hole.holeID;

			// Step 28h.1) Convert world coordinates to local Three.js coordinates
			var collarLocal = worldToThreeLocal(hole.startXLocation, hole.startYLocation);
			var collarZ = hole.startZLocation || 0;

			// Step 28h.2) Set collar instance matrix
			matrix.identity();
			matrix.setPosition(collarLocal.x, collarLocal.y, collarZ);
			instancedCollars.setMatrixAt(i, matrix);

			// Step 28h.3) Set grade circle instance matrix (in correct InstancedMesh)
			var gradeLocal = worldToThreeLocal(hole.gradeXLocation, hole.gradeYLocation);
			var gradeZ = hole.gradeZLocation || 0;
			gradeMatrix.identity();
			gradeMatrix.setPosition(gradeLocal.x, gradeLocal.y, gradeZ);

			var subdrill = hole.subdrillAmount || 0;
			if (subdrill > 0 && instancedGradesPositive) {
				instancedGradesPositive.setMatrixAt(posIdx, gradeMatrix);
				posIdx++;
			} else if (instancedGradesNegative) {
				instancedGradesNegative.setMatrixAt(negIdx, gradeMatrix);
				negIdx++;
			}

			// Step 28h.4) Store mappings
			instanceIdToHole.set(i, hole);
			holeToInstanceId.set(holeId, i);
		}

		// Step 28i) Update instance matrices
		instancedCollars.instanceMatrix.needsUpdate = true;
		if (instancedGradesPositive) {
			instancedGradesPositive.instanceMatrix.needsUpdate = true;
		}
		if (instancedGradesNegative) {
			instancedGradesNegative.instanceMatrix.needsUpdate = true;
		}

		// Step 28j) Create instanced toe circles (all same size and color)
		var toeColor = isDarkMode ? 0x5eacff : 0x26ff00; // Blue in dark mode, green in light mode
		var toeRadiusMeters = toeSizeInMeters; // Use slider value

		var toeGeometry = new THREE.CircleGeometry(toeRadiusMeters, 32);
		var toeMaterial = new THREE.MeshBasicMaterial({
			color: toeColor,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.2,
			depthTest: true,
			depthWrite: false
		});

		var instancedToes = new THREE.InstancedMesh(toeGeometry, toeMaterial, holeCount);
		instancedToes.userData = { type: "instancedHoleToes" };

		// Set toe positions
		var toeMatrix = new THREE.Matrix4();
		for (var i = 0; i < visibleHoles.length; i++) {
			var hole = visibleHoles[i];
			var toeLocal = worldToThreeLocal(hole.endXLocation, hole.endYLocation);
			var toeZ = hole.endZLocation || 0;
			toeMatrix.identity();
			toeMatrix.setPosition(toeLocal.x, toeLocal.y, toeZ);
			instancedToes.setMatrixAt(i, toeMatrix);
		}
		instancedToes.instanceMatrix.needsUpdate = true;

		// Step 28k) Return all components
		return {
			instancedCollars: instancedCollars,
			instancedGradesPositive: instancedGradesPositive,
			instancedGradesNegative: instancedGradesNegative,
			instancedToes: instancedToes,
			instanceIdToHole: instanceIdToHole,
			holeToInstanceId: holeToInstanceId,
			holeCount: holeCount
		};
	}

	// Step 28.5) Create instanced first movement direction arrows
	// Takes directionArrows array: [startX, startY, endX, endY, fillColor, size]
	// Returns Group containing two InstancedMeshes (shafts and heads separate for proper scaling)
	static createInstancedDirectionArrows(directionArrows, allBlastHoles, worldToThreeLocalFn) {
		if (!directionArrows || directionArrows.length === 0) {
			return null;
		}

		const arrowCount = directionArrows.length;

		// Step 28.5a) Extract arrow size from first arrow (all arrows same size currently)
		const firstArrow = directionArrows[0];
		const size = firstArrow[5]; // size parameter

		// Step 28.5b) Calculate arrow dimensions (matching createDirectionArrows logic)
		const shaftSize = size * 0.2;         // Square cross-section
		const arrowHeadLength = size * 0.4;   // Cone length
		const arrowHeadRadius = size * 0.35;  // Cone base radius

		// Step 28.5c) Create shaft geometry (box) - unit length, will be scaled per instance
		const shaftGeometry = new THREE.BoxGeometry(1, shaftSize, shaftSize);
		shaftGeometry.translate(0.5, 0, 0); // Move pivot to start (left edge at origin)

		// Step 28.5d) Create arrowhead geometry (cone pointing along +X)
		const coneGeometry = new THREE.ConeGeometry(arrowHeadRadius, arrowHeadLength, 4);
		coneGeometry.rotateZ(-Math.PI / 2); // Rotate to point along +X axis

		// Step 28.5e) Create material (goldenrod for all arrows)
		const arrowMaterial = new THREE.MeshBasicMaterial({
			color: 0xdaa520, // goldenrod
			side: THREE.DoubleSide
		});

		// Step 28.5f) Create InstancedMesh for shafts (scaled per instance)
		const instancedShafts = new THREE.InstancedMesh(shaftGeometry, arrowMaterial, arrowCount);
		instancedShafts.userData = { type: "instancedDirectionArrowShafts" };

		// Step 28.5g) Create InstancedMesh for heads (positioned per instance, not scaled)
		const instancedHeads = new THREE.InstancedMesh(coneGeometry, arrowMaterial, arrowCount);
		instancedHeads.userData = { type: "instancedDirectionArrowHeads" };

		// Step 28.5h) Set position, rotation, and scale for each arrow
		const shaftMatrix = new THREE.Matrix4();
		const headMatrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const quaternion = new THREE.Quaternion();
		const shaftScale = new THREE.Vector3(1, 1, 1);
		const headScale = new THREE.Vector3(1, 1, 1);

		for (let i = 0; i < arrowCount; i++) {
			const arrow = directionArrows[i];
			const [startX, startY, endX, endY, fillColor, arrowSize] = arrow;

			// Step 28.5i) Find nearest hole for collar Z elevation
			const nearestHole = this.findNearestHole(startX, startY, allBlastHoles);
			const collarZ = nearestHole ? nearestHole.startZLocation || 0 : 0;

			// Step 28.5j) Convert to local Three.js coordinates
			const localStart = worldToThreeLocalFn ? worldToThreeLocalFn(startX, startY) : { x: startX, y: startY };
			const localEnd = worldToThreeLocalFn ? worldToThreeLocalFn(endX, endY) : { x: endX, y: endY };

			// Step 28.5k) Calculate arrow vector and length
			const dx = localEnd.x - localStart.x;
			const dy = localEnd.y - localStart.y;
			const totalLength = Math.sqrt(dx * dx + dy * dy);
			const angle = Math.atan2(dy, dx);
			const shaftLength = totalLength - arrowHeadLength;

			// Step 28.5l) Set shaft matrix (position at start, scale to shaft length)
			position.set(localStart.x, localStart.y, collarZ + shaftSize / 2);
			quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
			shaftScale.set(shaftLength, 1, 1);
			shaftMatrix.compose(position, quaternion, shaftScale);
			instancedShafts.setMatrixAt(i, shaftMatrix);

			// Step 28.5m) Set head matrix (position at end of shaft, same rotation, no scale)
			// Cone center needs to be at (shaftLength + arrowHeadLength/2) from start
			const headCenterX = localStart.x + (shaftLength + arrowHeadLength / 2) * Math.cos(angle);
			const headCenterY = localStart.y + (shaftLength + arrowHeadLength / 2) * Math.sin(angle);
			position.set(headCenterX, headCenterY, collarZ + shaftSize / 2);
			headMatrix.compose(position, quaternion, headScale);
			instancedHeads.setMatrixAt(i, headMatrix);
		}

		// Step 28.5n) Mark instance matrices as needing update
		instancedShafts.instanceMatrix.needsUpdate = true;
		instancedHeads.instanceMatrix.needsUpdate = true;

		// Step 28.5o) Create group and add both instanced meshes
		const arrowGroup = new THREE.Group();
		arrowGroup.add(instancedShafts);
		arrowGroup.add(instancedHeads);
		arrowGroup.userData = { type: "instancedDirectionArrows" };

		return arrowGroup;
	}

	// Step 29) Create batched highlight lines for multi-selection performance
	// Collects all highlight segments and creates ONE or TWO LineSegments2 objects
	// Returns { greenLines, magentaLines } for non-selected and selected segments
	static createBatchedHighlightLines(greenSegments, magentaSegments, greenLineWidth, magentaLineWidth, resolution) {
		var result = { greenLines: null, magentaLines: null };
		
		// Step 29a) Create green (non-selected) highlights
		if (greenSegments && greenSegments.length > 0) {
			result.greenLines = this._createHighlightLinesBatch(greenSegments, greenLineWidth, resolution, "rgba(0, 255, 0, 0.8)");
		}
		
		// Step 29b) Create magenta (selected) highlights  
		if (magentaSegments && magentaSegments.length > 0) {
			result.magentaLines = this._createHighlightLinesBatch(magentaSegments, magentaLineWidth, resolution, "rgba(255, 68, 255, 0.8)");
		}
		
		return result;
	}
	
	// Step 29c) Helper: Create highlight lines batch with LineMaterial
	static _createHighlightLinesBatch(segments, lineWidth, resolution, colorString) {
		if (!segments || segments.length === 0) return null;
		
		var totalSegments = segments.length;
		var positions = new Float32Array(totalSegments * 6);
		
		var posIdx = 0;
		for (var i = 0; i < segments.length; i++) {
			var seg = segments[i];
			positions[posIdx++] = seg.x1;
			positions[posIdx++] = seg.y1;
			positions[posIdx++] = seg.z1;
			positions[posIdx++] = seg.x2;
			positions[posIdx++] = seg.y2;
			positions[posIdx++] = seg.z2;
		}
		
		var geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);
		
		// Parse color
		var color = new THREE.Color(colorString);
		
		var material = new LineMaterial({
			color: color,
			linewidth: lineWidth,
			resolution: resolution,
			dashed: false,
			alphaToCoverage: true,
			transparent: true,
			opacity: 0.8
		});
		material.depthTest = true;
		material.depthWrite = false;
		
		var lineSegments = new LineSegments2(geometry, material);
		lineSegments.computeLineDistances();
		lineSegments.name = "kad-highlight-batch";
		lineSegments.userData = { type: "kadHighlightBatch" };
		
		return lineSegments;
	}
	
	// Step 30) Create batched highlight circles for multi-selection performance
	static createBatchedHighlightCircles(greenCircles, magentaCircles, greenLineWidth, magentaLineWidth, resolution) {
		var result = { greenCircles: null, magentaCircles: null };
		var segmentsPerCircle = 64;
		
		if (greenCircles && greenCircles.length > 0) {
			result.greenCircles = this._createHighlightCirclesBatch(greenCircles, segmentsPerCircle, greenLineWidth, resolution, "rgba(0, 255, 0, 0.8)");
		}
		
		if (magentaCircles && magentaCircles.length > 0) {
			result.magentaCircles = this._createHighlightCirclesBatch(magentaCircles, segmentsPerCircle, magentaLineWidth, resolution, "rgba(255, 68, 255, 0.8)");
		}
		
		return result;
	}
	
	// Step 30a) Helper: Create highlight circles batch
	static _createHighlightCirclesBatch(circles, segmentsPerCircle, lineWidth, resolution, colorString) {
		if (!circles || circles.length === 0) return null;
		
		var totalSegments = circles.length * segmentsPerCircle;
		var positions = new Float32Array(totalSegments * 6);
		
		var posIdx = 0;
		for (var i = 0; i < circles.length; i++) {
			var c = circles[i];
			for (var k = 0; k < segmentsPerCircle; k++) {
				var theta1 = (k / segmentsPerCircle) * Math.PI * 2;
				var theta2 = ((k + 1) / segmentsPerCircle) * Math.PI * 2;
				
				positions[posIdx++] = c.cx + c.radius * Math.cos(theta1);
				positions[posIdx++] = c.cy + c.radius * Math.sin(theta1);
				positions[posIdx++] = c.cz;
				positions[posIdx++] = c.cx + c.radius * Math.cos(theta2);
				positions[posIdx++] = c.cy + c.radius * Math.sin(theta2);
				positions[posIdx++] = c.cz;
			}
		}
		
		var geometry = new LineSegmentsGeometry();
		geometry.setPositions(positions);
		
		var color = new THREE.Color(colorString);
		
		var material = new LineMaterial({
			color: color,
			linewidth: lineWidth,
			resolution: resolution,
			dashed: false,
			alphaToCoverage: true,
			transparent: true,
			opacity: 0.8
		});
		material.depthTest = true;
		material.depthWrite = false;
		
		var lineSegments = new LineSegments2(geometry, material);
		lineSegments.computeLineDistances();
		lineSegments.name = "kad-highlight-circles-batch";
		lineSegments.userData = { type: "kadHighlightCirclesBatch" };
		
		return lineSegments;
	}

	/**
	 * Create a charge deck tube (open-ended cylinder) oriented along a hole axis.
	 * @param {THREE.Vector3} topPos - World position of deck top (closer to collar)
	 * @param {THREE.Vector3} basePos - World position of deck base (closer to toe)
	 * @param {number} radiusMeters - Radius in meters
	 * @param {string|number} color - Hex color
	 * @param {number} opacity - 0..1
	 * @returns {THREE.Mesh}
	 */
	static createChargeDeck(topPos, basePos, radiusMeters, color, opacity = 0.7) {
		var dx = basePos.x - topPos.x;
		var dy = basePos.y - topPos.y;
		var dz = basePos.z - topPos.z;
		var length = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (length < 0.001) return null;

		var geometry = new THREE.CylinderGeometry(radiusMeters, radiusMeters, length, 10, 1, true);
		var material = new THREE.MeshBasicMaterial({
			color: color,
			transparent: opacity < 1.0,
			opacity: opacity,
			side: THREE.DoubleSide,
			depthTest: true,
			depthWrite: opacity >= 0.99,
		});
		var mesh = new THREE.Mesh(geometry, material);

		// Position at midpoint
		var midX = (topPos.x + basePos.x) / 2;
		var midY = (topPos.y + basePos.y) / 2;
		var midZ = (topPos.z + basePos.z) / 2;
		mesh.position.set(midX, midY, midZ);

		// Orient cylinder along hole axis
		// CylinderGeometry is oriented along Y by default
		var direction = new THREE.Vector3(dx, dy, dz).normalize();
		var yAxis = new THREE.Vector3(0, 1, 0);
		var quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, direction);
		mesh.quaternion.copy(quaternion);

		mesh.name = "charge-deck";
		return mesh;
	}

	/**
	 * Create a primer marker (small octahedron) at a position along a hole.
	 * @param {number} x - World X
	 * @param {number} y - World Y
	 * @param {number} z - World Z
	 * @param {number} size - Marker size in meters
	 * @param {string|number} color - Hex color (default red)
	 * @returns {THREE.Mesh}
	 */
	static createPrimerMarker(x, y, z, size, color = 0xdd1111) {
		var geometry = new THREE.OctahedronGeometry(size, 0);
		var material = new THREE.MeshBasicMaterial({
			color: color,
			transparent: false,
			depthTest: true,
			depthWrite: true,
		});
		var mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(x, y, z);
		mesh.name = "primer-marker";
		return mesh;
	}
}
