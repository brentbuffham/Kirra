import { createCylinder } from "../shapes/createCylinder";
import { createSquareTorus } from "../shapes/createSquareTorus";
import { createTorus } from "../shapes/createTorus";
import { getRandomColor } from "../../helpers/getRandomColor";
import { Group } from "three";

export function drawMeshCylinderHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	diameter = diameter || 500;
	materialType = materialType || "phong";
	const hole = new Group();
	hole.add(createCylinder(color, materialType, collarXYZ, intervalXYZ, diameter, radialSegments));
	color = getRandomColor();
	if (intervalXYZ.distanceTo(toeXYZ) > 0) {
		color = "red";
		hole.add(createCylinder(color, materialType, intervalXYZ, toeXYZ, diameter, radialSegments));
	}

	hole.name = name + "-" + "hole";
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
}
