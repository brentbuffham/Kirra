//drawCrossCylinderHole.js
import { createCylinder } from "../../shapes/createCylinder.js";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Vector3 } from "three";
import { Group } from "three";

export function drawMeshCrossHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, thickness, radialSegments) {
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;

	const points = {
		topLeft: new Vector3(collarXYZ.x - radius, collarXYZ.y + radius, collarXYZ.z),
		topRight: new Vector3(collarXYZ.x + radius, collarXYZ.y + radius, collarXYZ.z),
		bottomLeft: new Vector3(collarXYZ.x - radius, collarXYZ.y - radius, collarXYZ.z),
		bottomRight: new Vector3(collarXYZ.x + radius, collarXYZ.y - radius, collarXYZ.z)
	};
	const hole = new Group();
	hole.add(createCylinder(color, materialType, points.topLeft, points.bottomRight, thickness, radialSegments));
	hole.add(createCylinder(color, materialType, points.bottomLeft, points.topRight, thickness, radialSegments));

	hole.add(createCylinder(color, materialType, collarXYZ, intervalXYZ, thickness, radialSegments));
	//color = getRandomColor();
	color = "red";
	hole.add(createCylinder(color, materialType, intervalXYZ, toeXYZ, thickness, radialSegments));
	hole.name = name;
	hole.userData = {
		entityType: "hole",
		pointID: name,
		collarXYZ: collarXYZ,
		intervalXYZ: intervalXYZ,
		toeXYZ: toeXYZ,
		diameter: diameter,
		subdrill: intervalXYZ.distanceTo(toeXYZ),
		benchLength: collarXYZ.distanceTo(intervalXYZ),
		holeType: "unknown",
		displayType: "mesh-cross"
	};
	scene.add(hole);
}
