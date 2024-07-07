//drawDummy.js
import { Vector3 } from "three";
import { createCylinder } from "../../shapes/createCylinder.js";
import { Group } from "three";

export function drawMeshCrossDummy(scene, color, materialType, name, vector, thickness, radialSegments) {
	const size = 0.5;

	const points = {
		topLeft: new Vector3(vector.x - size, vector.y + size, vector.z),
		topRight: new Vector3(vector.x + size, vector.y + size, vector.z),
		bottomLeft: new Vector3(vector.x - size, vector.y - size, vector.z),
		bottomRight: new Vector3(vector.x + size, vector.y - size, vector.z)
	};
	const dummy = new Group();
	dummy.add(createCylinder(color, materialType, points.topLeft, points.bottomRight, thickness, radialSegments));
	dummy.add(createCylinder(color, materialType, points.bottomLeft, points.topRight, thickness, radialSegments));

	dummy.name = "dummy";
	dummy.userData = {
		entityType: "dummy",
		pointID: name,
		collarXYZ: vector,
		displayType: "mesh-dummy"
	};
	scene.add(dummy);
}
