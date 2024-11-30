import { getRandomColor } from "../../helpers/getRandomColor";
import { createCylinder } from "../shapes/createCylinder";
import { createSquareTorus } from "../shapes/createSquareTorus";
import { createTorus } from "../shapes/createTorus";
import { Group } from "three";

export function drawMeshDiamondHole(scene, color, materialType, uuid, blastName, name, collarXYZ, intervalXYZ, toeXYZ, diameter, thickness, radialSegments, tubularSegments, arc, isSquare) {
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;

	color = null; // Comment out if you don't want to use the colourSpectrum
	const colourSpectrum = ["lime", "white", "orange", "grey", "red"];

	const hole = new Group();
	hole.add(createSquareTorus(color ? color : colourSpectrum[0], materialType, collarXYZ, diameter, thickness, radialSegments, tubularSegments, arc, isSquare));
	hole.add(createCylinder(color ? color : colourSpectrum[1], materialType, collarXYZ, intervalXYZ, thickness, radialSegments));
	hole.add(createSquareTorus(color ? color : colourSpectrum[2], materialType, intervalXYZ, diameter / 2, thickness, radialSegments, tubularSegments, arc, isSquare));
	hole.add(createCylinder(color ? color : colourSpectrum[3], materialType, intervalXYZ, toeXYZ, thickness, radialSegments));
	hole.add(createSquareTorus(color ? color : colourSpectrum[4], materialType, toeXYZ, diameter / 2, thickness, radialSegments, tubularSegments, arc, isSquare));
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
		displayType: "mesh-diamond"
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
