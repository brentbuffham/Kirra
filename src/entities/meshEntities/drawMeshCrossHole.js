//drawCrossCylinderHole.js
import { createCylinder } from "../shapes/createCylinder";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Vector3 } from "three";
import { Group } from "three";

export function drawMeshCrossHole(scene, color, materialType, uuid, blastName, name, collarXYZ, intervalXYZ, toeXYZ, diameter, subdrill, radialSegments) {
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;
	const thickness = 100;

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
		uuid: uuid,
		blastName: blastName,
		entityType: "hole",
		pointID: name,
		collarXYZ: collarXYZ,
		intervalXYZ: intervalXYZ,
		toeXYZ: toeXYZ,
		diameter: diameter,
		holeLength: collarXYZ.distanceTo(toeXYZ).toFixed(3),
		subdrill: intervalXYZ.distanceTo(toeXYZ).toFixed(3),
		benchLength: collarXYZ.distanceTo(intervalXYZ).toFixed(3),
		holeType: "unknown",
		displayType: "mesh-cross"
	};
	// Check if a blast group with the given blastName already exists
	let blastGroup = scene.children.find((child) => child.isGroup && child.name === blastName);

	if (!blastGroup) {
		// If the blast group doesn't exist, create a new one
		blastGroup = new Group();
		blastGroup.name = blastName;
		scene.add(blastGroup);
	}

	// Add the hole to the blast group
	blastGroup.add(hole);
}
