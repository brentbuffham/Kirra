import { getRandomColor } from "../../helpers/getRandomColor";
import { createCylinder } from "../../shapes/createCylinder";
import { createSquareTorus } from "../../shapes/createSquareTorus";
import { createTorus } from "../../shapes/createTorus";
import { Group } from "three";

export function drawMeshSquareHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, thickness, radialSegments, tubularSegments, arc, isSquare) {
	diameter = diameter || 500;
	const hole = new Group();
	hole.add(createSquareTorus("lime", materialType, collarXYZ, diameter, thickness, radialSegments, tubularSegments, arc, isSquare));
	hole.add(createCylinder("white", materialType, collarXYZ, intervalXYZ, thickness, radialSegments));
	hole.add(createTorus("orange", materialType, intervalXYZ, diameter / 2, thickness, radialSegments, 32, arc));
	hole.add(createCylinder("grey", materialType, intervalXYZ, toeXYZ, thickness, radialSegments));
	hole.add(createTorus("red", materialType, toeXYZ, diameter / 2, thickness, radialSegments, 32, arc));
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
		displayType: "mesh-square"
	};
	scene.add(hole);
}
