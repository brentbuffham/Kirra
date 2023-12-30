import { createCylinder } from "../shapes/createCylinder";
import { getRandomColor } from "../helpers/getRandomColor";

export function drawCylinderHole(scene, color, collarXYZ, intervalXYZ, toeXYZ, diameter) {
	diameter = diameter || 500;
	createCylinder(scene, color, collarXYZ, intervalXYZ, diameter / 2);
	color = getRandomColor();
	color = "red";
	createCylinder(scene, color, intervalXYZ, toeXYZ, diameter);
}
