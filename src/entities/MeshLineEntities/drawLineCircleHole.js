//drawCrossHole.js
import { createLine } from "../../entities/shapes/createLine.js";
import { createCircle } from "../../entities/shapes/createCircle.js";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Group, Vector3 } from "three";
import { createAnyShape } from "../../entities/shapes/createAnyShape.js";

export function drawLineCircleHole(scene, color, uuid, blastName, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled) {
	diameter = diameter || 500;
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;

	// Ensure collarXYZ, intervalXYZ, and toeXYZ are Vector3 instances
	collarXYZ = collarXYZ instanceof Vector3 ? collarXYZ : new Vector3(collarXYZ.x, collarXYZ.y, collarXYZ.z);
	intervalXYZ = intervalXYZ instanceof Vector3 ? intervalXYZ : new Vector3(intervalXYZ.x, intervalXYZ.y, intervalXYZ.z);
	toeXYZ = toeXYZ instanceof Vector3 ? toeXYZ : new Vector3(toeXYZ.x, toeXYZ.y, toeXYZ.z);

	const hole = new Group();
	//draw Cross
	hole.add(createCircle(color, collarXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled));
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
		displayType: "line-circle"
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
