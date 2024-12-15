import DXFParser from "dxf-parser";
import * as THREE from "three";
import { params, scene, controls, camera, objectCenter } from "../../drawing/createScene.js";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TTFLoader } from "three/examples/jsm/loaders/TTFLoader.js";
import { globalFont } from "../../helpers/loadGlobalFont.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";
import { sceneConfig } from "../../drawing/sceneConfig.js";
import { populatePanelWithSceneObjects } from "../../views/treeView.js";
import { getDXFCentroid } from "../../helpers/getCentroid.js";

export function handleDXFNoEvent(file, canvas) {
	if (!file) {
		return;
	}
	const reader = new FileReader();

	reader.onload = function (event) {
		const contents = event.target.result;

		// Parse the DXF contents
		const parser = new DXFParser();
		const dxf = parser.parseSync(contents);
		console.log("DXF:", dxf);

		const defaultMaterial = new THREE.LineBasicMaterial({ color: 0xffbb00 });

		// Create a parent group for the DXF file
		const dxfGroup = new THREE.Group();
		dxfGroup.name = file.name;

		let dxfGroupCenter;
		//get the centroid of the dxf group

		// Group entities by type
		const entityGroups = {};

		// Use the world center parameters as offsets
		const offset = new THREE.Vector3(params.worldXCenter, params.worldYCenter, params.worldZCenter);

		dxf.entities.forEach((entity) => {
			const entityType = entity.type.toLowerCase();

			// Use entity-specific names if available
			const entityName = entity.name || `${entityType} - ${entity.layer || "default"}`;

			// Create a group for each entity type if it doesn't exist
			if (!entityGroups[entityType]) {
				entityGroups[entityType] = new THREE.Group();
				entityGroups[entityType].name = `${entityType}s`; // Pluralize type name
				dxfGroup.add(entityGroups[entityType]);
			}

			// Compute the bounding box of the object
			const boundingBox = new THREE.Box3().setFromObject(dxfGroup);
			const center = boundingBox.getCenter(new THREE.Vector3());

			// Update the objectCenter vector
			objectCenter.position.x = center.x;
			objectCenter.position.y = center.y;
			objectCenter.position.z = center.z;
			console.log("Updated Object Center:", objectCenter);

			const offsetX = params.worldXCenter !== 0 ? params.worldXCenter : center.x;
			const offsetY = params.worldYCenter !== 0 ? params.worldYCenter : center.y;

			if (params.worldXCenter === 0 || params.worldYCenter === 0) {
				params.worldXCenter = center.x;
				params.worldYCenter = center.y;
				updateGuiControllers();
			}

			if (entityType === "line") {
				const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.vertices[0].x - offsetX, entity.vertices[0].y - offsetY, entity.vertices[0].z), new THREE.Vector3(entity.vertices[1].x - offsetX, entity.vertices[1].y - offsetY, entity.vertices[1].z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				const line = new THREE.Line(geometry, material);
				//console.log("DXF LINE:", line);
				//allBounds.expandByObject(line);
				if (line) {
					line.name = entityName;
					entityGroups[entityType].add(line);
				}
			}
			if (entityType === "polyline" || entity.type === "lwpolyline") {
				let points = entity.vertices.map((vertex) => {
					return new THREE.Vector3(vertex.x - offsetX, vertex.y - offsetY, vertex.z);
				});
				// close the polyline Determine if this is correct in the future.
				if (entity.shape) {
					points.push(points[0]);
				}
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let geometry = new THREE.BufferGeometry().setFromPoints(points);
				let line = new THREE.Line(geometry, material);
				//allBounds.expandByObject(line);
				//console.log("DXF POLYLINE:", line);
				if (line) {
					line.name = entityName;
					entityGroups[entityType].add(line);
				}
			}
			if (entityType === "circle") {
				let geometry = new THREE.CircleGeometry(entity.radius, 32);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let circle = new THREE.Line(geometry, material);
				circle.position.set(entity.center.x - offsetX, entity.center.y - offsetY, entity.center.z);
				//allBounds.expandByObject(circle);
				//console.log("DXF CIRCLE:", circle);
				if (circle) {
					circle.name = entityName;
					entityGroups[entityType].add(circle);
				}
			}
			if (entityType === "arc") {
				let geometry = new THREE.CircleGeometry(entity.radius, 32, entity.startAngle, entity.endAngle);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let arc = new THREE.Line(geometry, material);
				arc.position.set(entity.center.x - offsetX, entity.center.y - offsetY, entity.center.z);
				//console.log("DXF ARC:", arc);
				//allBounds.expandByObject(arc);
				if (arc) {
					arc.name = entityName;
					entityGroups[entityType].add(arc);
				}
			}
			if (entityType === "spline") {
				let points = entity.controlPoints.map((vertex) => {
					return new THREE.Vector3(vertex.x - offsetX, vertex.y - offsetY, vertex.z);
				});
				let curve = new THREE.CatmullRomCurve3(points);
				let geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let spline = new THREE.Line(geometry, material);
				//allBounds.expandByObject(line);
				//console.log("DXF SPLINE:", line);
				if (spline) {
					spline.name = entityName;
					entityGroups[entityType].add(spline);
				}
			}
			if (entityType === "ellipse") {
				let ellipse = new THREE.EllipseCurve(entity.x - offsetX, entity.y - offsetY, entity.xRadius, entity.yRadius, entity.startAngle, entity.endAngle, entity.clockwise, entity.rotation);
				let points = ellipse.getPoints(50);
				let geometry = new THREE.BufferGeometry().setFromPoints(points);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let lineEllipse = new THREE.Line(geometry, material);
				//allBounds.expandByObject(line);
				// console.log("DXF ELLIPSE:", line);
				if (lineEllipse) {
					lineEllipse.name = entityName;
					entityGroups[entityType].add(lineEllipse);
				}
			}
			if (entityType === "text") {
				if (!entity.startPoint) {
					console.warn("TEXT entity does not have a startPoint property. Skipping.");
					return;
				}
				let text = new TextGeometry(entity.text, {
					font: globalFont,
					size: entity.textHeight,
					depth: 0.01, // Set height to 0 for flat text
					curveSegments: 6,
					bevelEnabled: true,
					bevelThickness: 0.01,
					bevelSize: 0.01,
					bevelSegments: 1
				});
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let mesh = new THREE.Mesh(text, material);
				mesh.position.set(entity.startPoint.x - offsetX, entity.startPoint.y - offsetY, entity.startPoint.z);
				mesh.dxfType = entity.type;
				//allBounds.expandByObject(mesh);
				//console.log("DXF TEXT:", mesh);
				if (mesh) {
					mesh.name = entityName;
					entityGroups[entityType].add(mesh);
				}
			}
			if (entityType === "mtext" || entityType === "acdbmtext") {
				const startPoint = {
					x: entity.position.x,
					y: entity.position.y,
					z: entity.position.z
				};
				let text = new TextGeometry(entity.text, {
					font: globalFont,
					size: entity.height,
					depth: 0.01, // Set height to 0 for flat text
					curveSegments: 6,
					bevelEnabled: true,
					bevelThickness: 0.01,
					bevelSize: 0.01,
					bevelSegments: 1
				});
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let mesh = new THREE.Mesh(text, material);
				mesh.position.set(startPoint.x - offsetX, startPoint.y - offsetY, startPoint.z);
				mesh.dxfType = entity.type;
				if (mesh) {
					mesh.name = entityName;
					entityGroups[entityType].add(mesh);
				}
			}
			if (entityType === "dimension") {
				let points = entity.points.map((vertex) => {
					return new THREE.Vector3(vertex.x - offsetX, vertex.y - offsetY, vertex.z);
				});
				let geometry = new THREE.BufferGeometry().setFromPoints(points);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let line = new THREE.Line(geometry, material);
				console.log("DXF DIMENSION:", line);
				group.add(line);
			}
			if (entity.type === "point") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				// console.log("DXF POINT:", point);
				if (point) {
					point.name = entityName;
					entityGroups[entityType].add(point);
				}
			}
			if (entityType === "insert") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				//console.log("DXF INSERT:", point);
				if (point) {
					point.name = entityName;
					entityGroups[entityType].add(point);
				}
			}
			if (entityType === "block") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				//console.log("DXF BLOCK:", point);
				if (point) {
					point.name = entityName;
					entityGroups[entityType].add(point);
				}
			}
			if (entity.type === "hatch") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				//console.log("DXF HATCH:", point);
				if (point) {
					point.name = entityName;
					entityGroups[entityType].add(point);
				}
			}
		});

		dxfGroup.name = file.name;

		// Add the group to the scene
		scene.add(dxfGroup);

		// Update the tree view with the new group and its children
		populatePanelWithSceneObjects(scene, camera);

		console.log("Object position after load:", dxfGroup.position);
		console.log("Object rotation after load:", dxfGroup.rotation);
		console.log("Object scale after load:", dxfGroup.scale);

		if (params.debugComments) {
			console.log("Loaded DXF position:", dxfGroup.position);
			console.log("Loaded DXF rotation:", dxfGroup.rotation);
			console.log("Loaded DXF scale:", dxfGroup.scale);
		}
	};

	reader.onerror = function (error) {
		console.log("Error reading the DXF file:", error);
	};

	reader.readAsText(file);
}
