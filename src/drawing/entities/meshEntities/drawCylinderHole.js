import { createCylinder } from "../../shapes/createCylinder";
import { getRandomColor } from "../../helpers/getRandomColor";
import { Group } from "three";
import { params } from "../../createScene";

export function drawCylinderHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	diameter = diameter || 500;
	materialType = materialType || "phong";
	const hole = new Group();
	hole.add(createCylinder(color, materialType, collarXYZ, intervalXYZ, diameter, radialSegments));
	color = getRandomColor();
	color = "red";
	hole.add(createCylinder(color, materialType, intervalXYZ, toeXYZ, diameter, radialSegments));
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
		displayType: "mesh-cylinder"
	};

	scene.add(hole);
	if (params.debugComments) {
		console.log("drawCylinderHole > UUID: " + hole.uuid + " Name: " + hole.name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
	}
}
