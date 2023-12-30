import { createLine } from "../shapes/createLine";
import { createDiamond } from "../shapes/createDiamond";
import { getRandomColor } from "../helpers/getRandomColor";

export function drawDiamondHole(scene, color, collarXYZ, intervalXYZ, toeXYZ, diameter) {
	diameter = diameter || 500;
	createDiamond(scene, color, collarXYZ, diameter);

	createLine(scene, collarXYZ, intervalXYZ, color);
	//color = getRandomColor();
	color = "red";
	createLine(scene, intervalXYZ, toeXYZ, color);
}
