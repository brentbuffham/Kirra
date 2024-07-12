//Need to FIX

import * as THREE from "three";
import { setArcBallControls } from "../setArcBallControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
// Make sure to import your specific controls like OrbitControls, TrackballControls, or ArcballControls

// Assuming you have a scene, camera, renderer, and controls already set up

export function calculateBoundingBox(scene) {
	const box = new THREE.Box3();

	scene.traverse(function (object) {
		if (object.isMesh) {
			const objectBox = new THREE.Box3().setFromObject(object);
			box.union(objectBox);
		}
	});
	console.log(box);
	return box;
}

export function resetCameraView(scene, camera, controls) {
	const box = calculateBoundingBox(scene);
	const boxWidth = box.getSize().x;
	const boxHeight = box.getSize().y;

	//calculate the distance the camera needs to be from the centre of the bounding box to see everythin that is in the view
	const distance = Math.max(boxWidth, boxHeight) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

	// Interaction with Three.js scene
	//store the current camera position
	const position = new THREE.Vector3(0, 0, 0 + distance);
	const target = boxCentre;

	//reset the camera rotation to 0 (Y+ is at the top of the canvas X+ to the Right and Z+ toward the camera)

	camera.position.copy(position);
	camera.lookAt(0, 0, 0);
	camera.up.set(0, 1, 0);
	controls.target.set(0, 0, 0);
	//set the controls to the stored position and target
	camera.position.set(position);
	controls.target.set(target);
}
