import DXFParser from "dxf-parser";
import * as THREE from "three";
import { params, scene } from "../../drawing/createScene.js";

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

		dxf.entities.forEach((entity) => {
			if (entity.type === "LINE") {
				const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.vertices[0].x, entity.vertices[0].y, entity.vertices[0].z), new THREE.Vector3(entity.vertices[1].x, entity.vertices[1].y, entity.vertices[1].z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				const line = new THREE.Line(geometry, material);
				console.log("DXF LINE:", line);
				group.add(line);
			}
			if (entity.type === "POLYLINE" || entity.type === "LWPOLYLINE") {
				let points = entity.vertices.map((vertex) => {
					return new THREE.Vector3(vertex.x, vertex.y, vertex.z);
				});
				// close the polyline Determine if this is correct in the future.
				if (entity.closed) {
					points.push(points[0]);
				}
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let geometry = new THREE.BufferGeometry().setFromPoints(points);
				let line = new THREE.Line(geometry, material);
				console.log("DXF POLYLINE:", line);
				group.add(line);
			}
			if (entity.type === "CIRCLE") {
				let geometry = new THREE.CircleGeometry(entity.radius, 32);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let circle = new THREE.Line(geometry, material);
				circle.position.set(entity.center.x, entity.center.y, entity.center.z);
				console.log("DXF CIRCLE:", circle);
				group.add(circle);
			}
			if (entity.type === "ARC") {
				let geometry = new THREE.CircleGeometry(entity.radius, 32, entity.startAngle, entity.endAngle);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let arc = new THREE.Line(geometry, material);
				arc.position.set(entity.center.x, entity.center.y, entity.center.z);
				console.log("DXF ARC:", arc);
				group.add(arc);
			}
			if (entity.type === "SPLINE") {
				let points = entity.controlPoints.map((vertex) => {
					return new THREE.Vector3(vertex.x, vertex.y, vertex.z);
				});
				let curve = new THREE.CatmullRomCurve3(points);
				let geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let line = new THREE.Line(geometry, material);
				console.log("DXF SPLINE:", line);
				group.add(line);
			}
			if (entity.type === "ELLIPSE") {
				let ellipse = new THREE.EllipseCurve(entity.x, entity.y, entity.xRadius, entity.yRadius, entity.startAngle, entity.endAngle, entity.clockwise, entity.rotation);
				let points = ellipse.getPoints(50);
				let geometry = new THREE.BufferGeometry().setFromPoints(points);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let line = new THREE.Line(geometry, material);
				console.log("DXF ELLIPSE:", line);
				group.add(line);
			}
			if (entity.type === "TEXT") {
				let text = new THREE.TextGeometry(entity.text, {
					font: new THREE.FontLoader().load("fonts/Roboto/Roboto_Regular.ttf"),
					size: entity.height,
					height: 0.1
				});
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let mesh = new THREE.Mesh(text, material);
				mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
				console.log("DXF TEXT:", mesh);
				group.add(mesh);
			}
			if (entity.type === "MTEXT") {
				let text = new THREE.TextGeometry(entity.text, {
					font: new THREE.FontLoader().load("fonts/helvetiker_regular.typeface.json"),
					size: entity.height,
					height: 0.1
				});
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let mesh = new THREE.Mesh(text, material);
				mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
				group.add(mesh);
			}
			if (entity.type === "DIMENSION") {
				let points = entity.points.map((vertex) => {
					return new THREE.Vector3(vertex.x, vertex.y, vertex.z);
				});
				let geometry = new THREE.BufferGeometry().setFromPoints(points);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let line = new THREE.Line(geometry, material);
				group.add(line);
			}
			if (entity.type === "POINT") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				group.add(point);
			}
			if (entity.type === "INSERT") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				group.add(point);
			}
			if (entity.type === "BLOCK") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				group.add(point);
			}
			if (entity.type === "HATCH") {
				let geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z)]);
				let color = entity.color ? entity.color : 0xffffff;
				let material = new THREE.MeshBasicMaterial({ color: color });
				let point = new THREE.Points(geometry, material);
				group.add(point);
			}
		});

		// Compute the bounding box of the object
		const boundingBox = new THREE.Box3().setFromObject(group);
		const center = boundingBox.getCenter(new THREE.Vector3());

		// Determine the offsets based on world center parameters
		const offsetX = params.worldXCenter !== 0 ? params.worldXCenter : center.x;
		const offsetY = params.worldYCenter !== 0 ? params.worldYCenter : center.y;
		const offsetZ = params.worldZCenter !== 0 ? params.worldZCenter : center.z;

		// Reposition vertices to center the object at the world center
		group.traverse(function (child) {
			if (child.isMesh || child.isLine) {
				const position = child.geometry.attributes.position;

				// Offset the positions
				for (let i = 0; i < position.count; i++) {
					position.setXYZ(i, position.getX(i) - offsetX, position.getY(i) - offsetY, position.getZ(i) - offsetZ);
				}

				// Mark positions as needing update
				position.needsUpdate = true;

				// Recompute bounding box and sphere
				child.geometry.computeBoundingBox();
				child.geometry.computeBoundingSphere();
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

		// Adjust the camera to ensure the object is visible
		const size = boundingBox.getSize(new THREE.Vector3());

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
