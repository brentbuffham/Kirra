//drawCrossHole.js
import { createLine } from "../shapes/createLine.js";
import { getRandomColor } from "../helpers/getRandomColor.js";

export function drawCrossHole(scene, color, collarXYZ, intervalXYZ, toeXYZ, diameter) {
	diameter = diameter || 500;
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;
	const points = {
		topLeft: { x: collarXYZ.x - radius, y: collarXYZ.y + radius, z: collarXYZ.z },
		topRight: { x: collarXYZ.x + radius, y: collarXYZ.y + radius, z: collarXYZ.z },
		bottomLeft: { x: collarXYZ.x - radius, y: collarXYZ.y - radius, z: collarXYZ.z },
		bottomRight: { x: collarXYZ.x + radius, y: collarXYZ.y - radius, z: collarXYZ.z }
	};

	createLine(scene, points.topLeft, points.bottomRight, color);
	createLine(scene, points.bottomLeft, points.topRight, color);

	createLine(scene, collarXYZ, intervalXYZ, color);
	//color = getRandomColor();
	color = "red";
	createLine(scene, intervalXYZ, toeXYZ, color);
}
