//drawCrossHole.js
import { createLine } from "../../shapes/createLine.js";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Group } from "three";
import { createSquare } from "../../shapes/createSquare.js";

export function drawLineSquareHole(scene, color, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled) {
	diameter = diameter || 500;
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;

	const hole = new Group();
	//draw Cross
	hole.add(createSquare(color, collarXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, true, isFilled));
	//draw BenchLength of hole
	hole.add(createLine(collarXYZ, intervalXYZ, color, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation));
	//color = getRandomColor();
	color = "red";
	//draw subdrill of hole
	hole.add(createLine(intervalXYZ, toeXYZ, color, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation));
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
		displayType: "line-square"
	};
	scene.add(hole);
}
