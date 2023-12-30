import { getRandomColor } from "../helpers/getRandomColor";
import { createCylinder } from "../shapes/createCylinder";
import { createSquareTorus } from "../shapes/createSquareTorus";

export function drawSquareHole(scene, color, materialType, collarXYZ, intervalXYZ, toeXYZ, diameter, thickness, radialSegments, tubularSegments, arc) {
	diameter = diameter || 500;
	createSquareTorus(scene, color, "basic", collarXYZ, diameter, thickness, radialSegments, tubularSegments, arc, true);

	createCylinder(scene, color, materialType, collarXYZ, intervalXYZ, 100, radialSegments);
	//color = getRandomColor();
	color = "red";
	createCylinder(scene, color, materialType, intervalXYZ, toeXYZ, 100, radialSegments);
}
