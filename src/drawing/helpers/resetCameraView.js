//Need to FIX

import * as THREE from "three";
import { setArcBallControls } from "../setArcBallControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

// Make sure to import your specific controls like OrbitControls, TrackballControls, or ArcballControls

// Assuming you have a scene, camera, renderer, and controls already set up

export function calculateBoundingBox(scene) {
	const box = new THREE.Box3();

	scene.traverse(function (object) {
		if (object) {
			const objectBox = new THREE.Box3().setFromObject(object);
			box.union(objectBox);
		}
	});
	console.log(box);
	return box;
}

export function resetCameraViewNotGood(scene, camera, controls) {
	const box = calculateBoundingBox(scene);
	//calculate the distance the camera needs to be from the centre of the bounding box to see everything that is in the view
	if (camera.isOrthographicCamera) {
		camera.frustumSize = Math.max(box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min);
		document.getElementById("infolabel").innerHTML = "Orthographic Camera Frustrum Size: " + camera.frustumSize;
	}
	if (camera.isPerspectiveCamera) {
		const fov = camera.fov;
		const aspect = camera.aspect;
		const near = camera.near;
		const far = camera.far;
		const cameraDistance = Math.max(boxWidth, boxHeight) / (2 * Math.tan(fov / 2));
	}
	// Interaction with Three.js scene
	//store the current camera position

	const target = controls.target.clone();
	camera.position.set(boxCentre.x, boxCentre.y, boxCentre.z + cameraDistance);
	camera.lookAt(boxCentre);
	camera.updateProjectionMatrix();

	camera.lookAt(boxCentre.x, boxCentre.y, boxCentre.z);
	camera.up.set(0, 1, 0);
	controls.target.set(boxCentre.x, boxCentre.y, boxCentre.z);
	//set the controls to the stored position and target
	camera.position.set(position);
	controls.target.set(target);
}

export function resetCameraView(scene, camera, controls, objectCenter, params) {
	//Interaction with Three.js scene
	//store the current camera position
	const position = new Vector3(0, 0, 0 + parseFloat(params.cameraDistance));
	const target = new Vector3(0, 0, objectCenter.z);
	//reset the camera rotation to 0 (Y+ is at the top of the canvas X+ to the Right and Z+ toward the camera)
	if (controls instanceof TrackballControls) {
		controls.object.up.set(0, 1, 0);
	}
	if (controls instanceof ArcballControls) {
		camera.position.copy(position);
		camera.lookAt(0, 0, params.worldZCenter);
		camera.up.set(0, 1, 0);
		controls.target.set(0, 0, params.worldZCenter);
		//set the controls to the stored position and target
		camera.position.copy(position);
		controls.target.copy(target);
	}
	if (params.debugComments) {
		console.log("View Reset");
	}
	document.querySelector("#info-label").textContent = "View Reset";
}
