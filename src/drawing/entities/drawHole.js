import { Vector3 } from "three";
import { createLine } from "../shapes/createLine";
import { createCircle } from "../shapes/createCircle";

export function drawHole(scene, color, collarXYZ, intervalXYZ, toeXYZ, diameter) {
	diameter = diameter || 500;
	createCircle(scene, color, collarXYZ, diameter);

	createLine(scene, collarXYZ, intervalXYZ, color);
	createLine(scene, intervalXYZ, toeXYZ, color);
}
