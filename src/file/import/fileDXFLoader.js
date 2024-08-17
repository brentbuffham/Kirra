import DXFParser from "dxf-parser";
import * as THREE from "three";
import { params, scene, controls, camera, objectCenter } from "../../drawing/createScene.js";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TTFLoader } from "three/examples/jsm/loaders/TTFLoader.js";
import { globalFont } from "../../helpers/loadGlobalFont.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";
import { sceneConfig } from "../../drawing/sceneConfig.js";

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

		const group = new THREE.Group();

		// Use the world center parameters as offsets
		const offset = new THREE.Vector3(params.worldXCenter, params.worldYCenter, params.worldZCenter);

		dxf.entities.forEach((entity) => {
			// Compute the bounding box of the object
			const boundingBox = new THREE.Box3().setFromObject(group);
			const center = boundingBox.getCenter(new THREE.Vector3());

			const offsetX = params.worldXCenter !== 0 ? params.worldXCenter : center.x;
			const offsetY = params.worldYCenter !== 0 ? params.worldYCenter : center.y;

			if (params.worldXCenter === 0 || params.worldYCenter === 0) {
				params.worldXCenter = center.x;
				params.worldYCenter = center.y;
				updateGuiControllers();
			}

			if (entity.type === "LINE") {
				const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.vertices[0].x - offsetX, entity.vertices[0].y - offsetY, entity.vertices[0].z), new THREE.Vector3(entity.vertices[1].x - offsetX, entity.vertices[1].y - offsetY, entity.vertices[1].z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				const line = new THREE.Line(geometry, material);
				console.log("DXF LINE:", line);
				//allBounds.expandByObject(line);
				group.add(line);
			}
			if (entity.type === "POLYLINE" || entity.type === "LWPOLYLINE") {
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
				console.log("DXF POLYLINE:", line);
				group.add(line);
			}
			if (entity.type === "CIRCLE") {
				let geometry = new THREE.CircleGeometry(entity.radius, 32);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let circle = new THREE.Line(geometry, material);
				circle.position.set(entity.center.x - offsetX, entity.center.y - offsetY, entity.center.z);
				//allBounds.expandByObject(circle);
				console.log("DXF CIRCLE:", circle);
				group.add(circle);
			}
			if (entity.type === "ARC") {
				let geometry = new THREE.CircleGeometry(entity.radius, 32, entity.startAngle, entity.endAngle);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let arc = new THREE.Line(geometry, material);
				arc.position.set(entity.center.x - offsetX, entity.center.y - offsetY, entity.center.z);
				console.log("DXF ARC:", arc);
				group.add(arc);
			}
			if (entity.type === "SPLINE") {
				let points = entity.controlPoints.map((vertex) => {
					return new THREE.Vector3(vertex.x - offsetX, vertex.y - offsetY, vertex.z);
				});
				let curve = new THREE.CatmullRomCurve3(points);
				let geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let line = new THREE.Line(geometry, material);
				//allBounds.expandByObject(line);
				console.log("DXF SPLINE:", line);
				group.add(line);
			}
			if (entity.type === "ELLIPSE") {
				let ellipse = new THREE.EllipseCurve(entity.x - offsetX, entity.y - offsetY, entity.xRadius, entity.yRadius, entity.startAngle, entity.endAngle, entity.clockwise, entity.rotation);
				let points = ellipse.getPoints(50);
				let geometry = new THREE.BufferGeometry().setFromPoints(points);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let line = new THREE.Line(geometry, material);
				//allBounds.expandByObject(line);
				console.log("DXF ELLIPSE:", line);
				group.add(line);
			}
			if (entity.type === "TEXT") {
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
				console.log("DXF TEXT:", mesh);
				group.add(mesh);
			}
			if (entity.type === "MTEXT") {
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
				mesh.position.set(entity.startPoint.x - offsetX, entity.startPoint.y - offsetY, entity.startPoint.z);
				mesh.dxfType = entity.type;
				//allBounds.expandByObject(mesh);
				console.log("DXF MTEXT:", mesh);
				group.add(mesh);
			}
			if (entity.type === "DIMENSION") {
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
			if (entity.type === "POINT") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				console.log("DXF POINT:", point);
				group.add(point);
			}
			if (entity.type === "INSERT") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				console.log("DXF INSERT:", point);
				group.add(point);
			}
			if (entity.type === "BLOCK") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				console.log("DXF BLOCK:", point);
				group.add(point);
			}
			if (entity.type === "HATCH") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x - offsetX, entity.position.y - offsetY, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				//allBounds.expandByObject(point);
				console.log("DXF HATCH:", point);
				group.add(point);
			}
		});

		// Force position to 0, 0, 0
		group.position.set(0, 0, 0);
		group.scale.set(1, 1, 1);
		group.name = file.name;

		// Add the group to the scene
		scene.add(group);

		console.log("Object position after load:", group.position);
		console.log("Object rotation after load:", group.rotation);
		console.log("Object scale after load:", group.scale);

		if (params.debugComments) {
			console.log("Loaded DXF position:", group.position);
			console.log("Loaded DXF rotation:", group.rotation);
			console.log("Loaded DXF scale:", group.scale);
		}
	};

	reader.onerror = function (error) {
		console.log("Error reading the DXF file:", error);
	};

	reader.readAsText(file);
}
