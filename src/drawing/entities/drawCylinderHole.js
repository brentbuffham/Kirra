import { createCylinder } from "../shapes/createCylinder";
import { getRandomColor } from "../helpers/getRandomColor";

export function drawCylinderHole(scene, color, materialType, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	diameter = diameter || 500;
	materialType = materialType || "phong";
	createCylinder(scene, color, materialType, collarXYZ, intervalXYZ, diameter / 2, radialSegments);
	color = getRandomColor();
	color = "red";
	createCylinder(scene, color, materialType, intervalXYZ, toeXYZ, diameter, radialSegments);
}
