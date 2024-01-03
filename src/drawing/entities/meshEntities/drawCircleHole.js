import { getRandomColor } from "../../helpers/getRandomColor";
import { createCylinder } from "../../shapes/createCylinder";
import { createTorus } from "../../shapes/createTorus";

export function drawCircleHole(scene, color, collarXYZ, intervalXYZ, toeXYZ, diameter, thickness, radialSegments, tubularSegments, arc) {
	diameter = diameter || 500;
	//color = "lime";
	createTorus(scene, color, "basic", collarXYZ, diameter, thickness, radialSegments, tubularSegments, arc);
	//color = "white";
	createCylinder(scene, color, "basic", collarXYZ, intervalXYZ, thickness, radialSegments);
	//color = getRandomColor();
	color = "red";
	createCylinder(scene, color, "basic", intervalXYZ, toeXYZ, thickness, radialSegments);
}
