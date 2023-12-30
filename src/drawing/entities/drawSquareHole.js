import { getRandomColor } from "../helpers/getRandomColor";
import { createLine } from "../shapes/createLine";
import { createSquare } from "../shapes/createSquare";

export function drawSquareHole(scene, color, collarXYZ, intervalXYZ, toeXYZ, diameter) {
	diameter = diameter || 500;
	createSquare(scene, color, collarXYZ, diameter);

	createLine(scene, collarXYZ, intervalXYZ, color);
	//color = getRandomColor();
	color = "red";
	createLine(scene, intervalXYZ, toeXYZ, color);
}
