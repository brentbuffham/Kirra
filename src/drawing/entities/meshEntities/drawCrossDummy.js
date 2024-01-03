//drawDummy.js
import { Vector3 } from "three";
import { createCylinder } from "../../shapes/createCylinder.js";

export function drawCrossDummy(scene, color, materialType, vector, thickness, radialSegments) {
	const size = 0.5;
	const x = vector.x;
	const y = vector.y;
	const z = vector.z;

	const points = {
		topLeft: new Vector3(x - size, y + size, z),
		topRight: new Vector3(x + size, y + size, z),
		bottomLeft: new Vector3(x - size, y - size, z),
		bottomRight: new Vector3(x + size, y - size, z)
	};

	createCylinder(scene, color, materialType, points.topLeft, points.bottomRight, thickness, radialSegments);
	createCylinder(scene, color, materialType, points.bottomLeft, points.topRight, thickness, radialSegments);
}
