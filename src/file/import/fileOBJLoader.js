//fileOBJLoader.js
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { getOBJCentroid, getCentroid } from "../../drawing/helpers/getCentroid.js";
import { Vector3 } from "three";
import { points } from "../import/fileUpload.js";
import { params } from "../../drawing/createScene.js";
import { DoubleSide } from "three";

export let adjustedOBJCentroid, objectCentroid;

export function handleOBJNoEvent(file, canvas) {
	if (!file) {
		return;
	}

	const reader = new FileReader();

	reader.onload = function(event) {
		const contents = event.target.result;
		const objLoader = new OBJLoader();

		const object = objLoader.parse(contents);
		objectCentroid = getOBJCentroid(object); // Assuming getOBJCentroid is properly implemented
		// Traverse the object and set all materials to DoubleSide
		object.traverse(function(child) {
			if (child.isMesh) {
				if (Array.isArray(child.material)) {
					child.material.forEach(material => {
						material.side = DoubleSide;
					});
				} else {
					child.material.side = DoubleSide;
				}
			}
		});
		if (points !== undefined && points !== null && points.length > 0) {
			const pointsCentroid = getCentroid(points);
			adjustedOBJCentroid = new Vector3().subVectors(objectCentroid, pointsCentroid);
		} else {
			adjustedOBJCentroid = new Vector3().subVectors(objectCentroid, objectCentroid);
		}

		object.position.set(adjustedOBJCentroid.x, adjustedOBJCentroid.y, adjustedOBJCentroid.z);
		canvas.scene.add(object);
		object.name = file.name;
		console.log("Object position after load:", object.position);
		console.log("Object scale:", object.scale);

		//update the scene to reflect the new object
		//canvas.scene.updateMatrixWorld(true);

		if (params.debugComments) {
			console.log("Loaded OBJ centroid:", adjustedOBJCentroid);
		}
	};

	reader.onerror = function(error) {
		console.log("Error reading the OBJ file:", error);
	};

	//traverse the scene and console log all the objects
	canvas.scene.traverse(function(object) {
		console.log("OBJ: ", object);
	});

	reader.readAsText(file);
}
