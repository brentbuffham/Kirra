//drawCrossCylinderHole.js
import { createCylinder } from "../../shapes/createCylinder.js";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Vector3 } from "three";

export function drawCrossCylinderHole(scene, color, materialType, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	diameter = diameter || 500;
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;
	const points = {
		topLeft: new Vector3(collarXYZ.x - radius, collarXYZ.y + radius, collarXYZ.z),
		topRight: new Vector3(collarXYZ.x + radius, collarXYZ.y + radius, collarXYZ.z),
		bottomLeft: new Vector3(collarXYZ.x - radius, collarXYZ.y - radius, collarXYZ.z),
		bottomRight: new Vector3(collarXYZ.x + radius, collarXYZ.y - radius, collarXYZ.z)
	};

	createCylinder(scene, color, materialType, points.topLeft, points.bottomRight, 100, radialSegments);
	createCylinder(scene, color, materialType, points.bottomLeft, points.topRight, 100, radialSegments);

	createCylinder(scene, color, materialType, collarXYZ, intervalXYZ, 100, radialSegments);
	//color = getRandomColor();
	color = "red";
	createCylinder(scene, color, materialType, intervalXYZ, toeXYZ, 100, radialSegments);
}
