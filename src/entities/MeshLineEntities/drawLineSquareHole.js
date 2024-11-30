//drawCrossHole.js
import { createLine } from "../../entities/shapes/createLine.js";
import { createSquare } from "../../entities/shapes/createSquare.js";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Group } from "three";
import { createAnyShape } from "../../entities/shapes/createAnyShape.js";

export function drawLineSquareHole(scene, color, uuid, blastName, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled) {
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
	hole.name = name;
	hole.userData = {
		uuid: uuid,
		blastName: blastName,
		entityType: "hole",
		pointID: name,
		collarXYZ: collarXYZ,
		intervalXYZ: intervalXYZ,
		toeXYZ: toeXYZ,
		diameter: diameter,
		holeLength: collarXYZ.distanceTo(toeXYZ).toFixed(3),
		subdrill: intervalXYZ.distanceTo(toeXYZ).toFixed(3),
		benchLength: collarXYZ.distanceTo(intervalXYZ).toFixed(3),
		holeType: "unknown",
		displayType: "line-square"
	};
	// Check if a blast group with the given blastName already exists
	let blastGroup = scene.children.find((child) => child.isGroup && child.name === blastName);

	if (!blastGroup) {
		// If the blast group doesn't exist, create a new one
		blastGroup = new Group();
		blastGroup.name = blastName;
		scene.add(blastGroup);
	}

	// Add the hole to the blast group
	blastGroup.add(hole);
}
