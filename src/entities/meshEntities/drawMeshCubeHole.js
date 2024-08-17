import { createCylinder } from "../shapes/createCylinder";
import { getRandomColor } from "../../helpers/getRandomColor";
import { Group } from "three";

//Use this to draw holes that don't have diameter provided
export function drawMeshCubeHole(scene, color, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments) {
	materialType = materialType || "basic";
	const hole = new Group();
	hole.add(createCylinder(color, materialType, collarXYZ, intervalXYZ, 500, radialSegments));
	//set to wireframe
	hole.children[0].material.wireframe = true;

	color = getRandomColor();
	if (intervalXYZ.distanceTo(toeXYZ) > 0) {
		color = "red";
		hole.add(createCylinder(color, materialType, intervalXYZ, toeXYZ, 500, radialSegments));
		//set to wireframe
		hole.children[1].material.wireframe = true;
	}

	hole.name = name + "-hole";
	hole.userData = {
		entityType: "hole",
		pointID: `${name}`,
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
