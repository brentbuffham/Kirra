import { createCylinder } from "../shapes/createCylinder";
import { getRandomColor } from "../../helpers/getRandomColor";
import { Group } from "three";
import { params } from "../../drawing/createScene";

//Use this to draw holes that don't have diameter provided drawMeshCubeHole(scene, colour, materialType, uuid, blastName, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, subdrill, 4);
export function drawMeshCubeHole(scene, color, materialType, uuid, blastName, name, collarXYZ, intervalXYZ, toeXYZ, diameter, subdrill, radialSegments) {
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
		displayType: "mesh-cube"
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
