//fileOBJLoader.js
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { getOBJCentroid, getCentroid } from "../../drawing/helpers/getCentroid.js";
import { Vector3 } from "three";
import { points } from "../import/fileUpload.js";
import { params } from "../../drawing/createScene.js";

export let adjustedOBJCentroid, objectCentroid;

export function handleOBJNoEvent(file, canvas) {
	if (!file) {
		return;
	}
	adjustedOBJCentroid = new Vector3();
	objectCentroid = new Vector3();
	const objLoader = new OBJLoader();
	const mtlLoader = new MTLLoader();

	// Assuming file.name is just the filename, not a full path
	const fileName = file.name;
	const mtlFileName = fileName.replace(".obj", ".mtl");

	// Load MTL first if it exists
	mtlLoader.load(
		mtlFileName,
		mtl => {
			mtl.preload();
			objLoader.setMaterials(mtl);
			loadOBJFile(fileName);
		},
		undefined,
		() => {
			// MTL loading failed, try loading OBJ file directly
			loadOBJFile(fileName);
		}
	);

	function loadOBJFile(fileName) {
		objLoader.load(fileName, object => {
			// if (getCentroid(points) === undefined) {
			// 	objectCentroid = getOBJCentroid(object); // Get centroid of the OBJ object\
			// 	adjustedOBJCentroid = new Vector3(objectCentroid.x - objectCentroid.x, objectCentroid.x - objectCentroid.y, objectCentroid.x - objectCentroid.z);
			// 	//object.position.set(adjustedOBJCentroid.x, adjustedOBJCentroid.y, adjustedOBJCentroid.z);
			// } else {
			// 	objectCentroid = getOBJCentroid(object); // Get centroid of the OBJ object
			// 	adjustedOBJCentroid = new Vector3(objectCentroid.x - getCentroid(points).x, objectCentroid.y - getCentroid(points).y, objectCentroid.z - getCentroid(points).z);
			// 	//object.position.set(adjustedOBJCentroid.x, adjustedOBJCentroid.y, adjustedOBJCentroid.z);
			// }

			canvas.scene.add(object);

			if (params.debugComments) {
				console.log("fileUpload/handleFileUploadNoEvent/centroidOBJ: ", adjustedOBJCentroid.x, adjustedOBJCentroid.y, adjustedOBJCentroid.z);
			}
		});
	}
}
