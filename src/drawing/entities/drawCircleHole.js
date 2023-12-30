import { createLine } from "../shapes/createLine";
import { createCircle } from "../shapes/createCircle";
import { getRandomColor } from "../helpers/getRandomColor";

export function drawCircleHole(scene, color, collarXYZ, intervalXYZ, toeXYZ, diameter) {
	diameter = diameter || 500;
	//color = "lime";
	createCircle(scene, color, collarXYZ, diameter);
	//color = "white";
	createLine(scene, collarXYZ, intervalXYZ, color);
	//color = getRandomColor();
	color = "red";
	createLine(scene, intervalXYZ, toeXYZ, color);
}
