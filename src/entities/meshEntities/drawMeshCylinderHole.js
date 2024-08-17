import { createCylinder } from "../shapes/createCylinder";
import { Group } from "three";
import { drawHoleText } from "../drawHoles";
import { params } from "../../drawing/createScene";

export function drawMeshCylinderHole(scene, color, materialType, blastName, name, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	diameter = diameter || 500;
	materialType = materialType || "phong";

	// Create the hole group
	const hole = new Group();
	hole.name = name;
	hole.position.set(0, 0, 0);

	// Create the cylinders (bench and subdrill)
	hole.add(createCylinder(color, materialType, collarXYZ, intervalXYZ, diameter, radialSegments));
	hole.children[0].name = collarXYZ.distanceTo(intervalXYZ) + "m (bench)";

	if (intervalXYZ.distanceTo(toeXYZ) > 0) {
		color = "red";
		hole.add(createCylinder(color, materialType, intervalXYZ, toeXYZ, diameter, radialSegments));
		hole.children[1].name = intervalXYZ.distanceTo(toeXYZ) + "m (subdrill)";
	}

	// Set hole's user data
	hole.userData = {
		blastName: blastName,
		entityType: "hole",
		pointID: name,
		collarXYZ: collarXYZ,
		intervalXYZ: intervalXYZ,
		toeXYZ: toeXYZ,
		diameter: diameter,
		holeLength: collarXYZ.distanceTo(toeXYZ),
		subdrill: intervalXYZ.distanceTo(toeXYZ),
		benchLength: collarXYZ.distanceTo(intervalXYZ),
		holeType: "unknown",
		displayType: "mesh-cylinder"
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
