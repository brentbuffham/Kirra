//drawDummy.js
import { Vector3 } from "three";
import { createCylinder } from "../shapes/createCylinder";
import { Group } from "three";

export function drawMeshCrossDummy(scene, colour, materialType, uuid, blastName, vector, thickness, radialSegments) {
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

	dummy.name = name;
	dummy.userData = {
		uuid: uuid,
		blastName: blastName,
		entityType: "hole",
		pointID: name,
		collarXYZ: vector,
		displayType: "mesh-dummy"
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
