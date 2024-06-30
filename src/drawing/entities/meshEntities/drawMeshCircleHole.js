import { getRandomColor } from "../../helpers/getRandomColor";
import { createCylinder } from "../../shapes/createCylinder";
import { createTorus } from "../../shapes/createTorus";
import { Group } from "three";

export function drawMeshCircleHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, thickness, radialSegments, tubularSegments, arc) {
	diameter = diameter || 500;
	//colour = colour || white;

	const hole = new Group();
	hole.add(createTorus("lime", materialType, collarXYZ, diameter, thickness, radialSegments, tubularSegments, arc));
	hole.add(createCylinder("white", materialType, collarXYZ, intervalXYZ, thickness, radialSegments));
	hole.add(createTorus("orange", materialType, intervalXYZ, diameter / 2, thickness, radialSegments, tubularSegments, arc));
	hole.add(createCylinder("grey", materialType, intervalXYZ, toeXYZ, thickness, radialSegments));
	hole.add(createTorus("red", materialType, toeXYZ, diameter / 2, thickness, radialSegments, tubularSegments, arc));
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
		displayType: "mesh-circle"
	};
	scene.add(hole);
}
