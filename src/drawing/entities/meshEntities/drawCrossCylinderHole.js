//drawCrossCylinderHole.js
import { createCylinder } from "../../shapes/createCylinder.js";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Vector3 } from "three";
import { Group } from "three";

export function drawCrossCylinderHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	const diameterMM = diameter / 1000;
	const crossMultiplier = 5;
	const radius = diameterMM / 2 * crossMultiplier;

	const points = {
		topLeft: new Vector3(collarXYZ.x - radius, collarXYZ.y + radius, collarXYZ.z),
		topRight: new Vector3(collarXYZ.x + radius, collarXYZ.y + radius, collarXYZ.z),
		bottomLeft: new Vector3(collarXYZ.x - radius, collarXYZ.y - radius, collarXYZ.z),
		bottomRight: new Vector3(collarXYZ.x + radius, collarXYZ.y - radius, collarXYZ.z)
	};
	const hole = new Group();
	hole.add(createCylinder(color, materialType, points.topLeft, points.bottomRight, diameter, radialSegments));
	hole.add(createCylinder(color, materialType, points.bottomLeft, points.topRight, diameter, radialSegments));

	hole.add(createCylinder(color, materialType, collarXYZ, intervalXYZ, diameter, radialSegments));
	//color = getRandomColor();
	color = "red";
	hole.add(createCylinder(color, materialType, intervalXYZ, toeXYZ, diameter, radialSegments));
	hole.name = name;
	scene.add(hole);
}
