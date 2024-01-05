import { getRandomColor } from "../../helpers/getRandomColor";
import { createCylinder } from "../../shapes/createCylinder";
import { createTorus } from "../../shapes/createTorus";
import { Group } from "three";

export function drawCircleHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, thickness, radialSegments, tubularSegments, arc) {
	diameter = diameter || 500;

	const hole = new Group();
	hole.add(createTorus("lime", materialType, collarXYZ, diameter, thickness, radialSegments, tubularSegments, arc));
	hole.add(createCylinder("white", materialType, collarXYZ, intervalXYZ, thickness, radialSegments));
	hole.add(createTorus("orange", materialType, intervalXYZ, diameter / 2, thickness, radialSegments, tubularSegments, arc));
	hole.add(createCylinder("grey", materialType, intervalXYZ, toeXYZ, thickness, radialSegments));
	hole.add(createTorus("red", materialType, toeXYZ, diameter / 2, thickness, radialSegments, tubularSegments, arc));
	hole.name = name;
	scene.add(hole);
}
