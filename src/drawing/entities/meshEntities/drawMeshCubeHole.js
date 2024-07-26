import { createCylinder } from "../../shapes/createCylinder";
import { getRandomColor } from "../../helpers/getRandomColor";
import { Group } from "three";
import { params } from "../../createScene";

//Use this to draw holes that don't have diameter provided
export function drawMeshCubeHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	diameter = diameter || 100;
	materialType = materialType || "phong";
	const hole = new Group();
	hole.add(createCylinder(color, materialType, collarXYZ, intervalXYZ, diameter, radialSegments));
	color = getRandomColor();
	if (intervalXYZ.distanceTo(toeXYZ) > 0) {
		color = "red";
		hole.add(createCylinder(color, materialType, intervalXYZ, toeXYZ, diameter, radialSegments));
	}

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
		displayType: "mesh-cube"
	};

	scene.add(hole);
	if (params.debugComments) {
		console.log("drawCubeHole > UUID: " + hole.uuid + " Name: " + hole.name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
	}
}
