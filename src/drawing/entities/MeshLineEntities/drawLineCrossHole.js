//drawCrossHole.js
import { createLine } from "../../shapes/createLine.js";
import { getRandomColor } from "../../helpers/getRandomColor.js";
import { Group } from "three";

export function drawLineCrossHole(scene, color, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation) {
	diameter = diameter || 500;
	const diameterMM = diameter / 1000;
	const radius = diameterMM / 2;
	const vectors = {
		topLeft: { x: collarXYZ.x - radius, y: collarXYZ.y + radius, z: collarXYZ.z },
		topRight: { x: collarXYZ.x + radius, y: collarXYZ.y + radius, z: collarXYZ.z },
		bottomLeft: { x: collarXYZ.x - radius, y: collarXYZ.y - radius, z: collarXYZ.z },
		bottomRight: { x: collarXYZ.x + radius, y: collarXYZ.y - radius, z: collarXYZ.z }
	};

	const hole = new Group();
	//draw Cross
	hole.add(createLine(vectors.topLeft, vectors.bottomRight, color, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation));
	hole.add(createLine(vectors.bottomLeft, vectors.topRight, color, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation));
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
		displayType: "line-cross"
	};
	scene.add(hole);
}
