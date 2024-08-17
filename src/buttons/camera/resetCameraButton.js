import * as THREE from "three";
import { getSceneBoundingBox } from "../../helpers/resetCameraView.js";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";

export function bindListenerToResetCameraViewButton(camera, controls, scene, params) {
	document.querySelector("#reset").addEventListener("click", function () {
		console.log("Camera Type Before Reset: ", camera.isPerspectiveCamera ? "Perspective" : "Orthographic");
		const boxCentre = getSceneBoundingBox(scene).getCenter(new THREE.Vector3());
		console.log("Box Centre: ", boxCentre.x, boxCentre.y, boxCentre.z);
		camera.up.set(0, 1, 0); // Y-axis pointing up on the screen

		// Position the camera along the Z-axis, looking at the center of the scene
		const cameraDistance = parseFloat(params.cameraDistance) * 0.5;
		const cameraPosition = new THREE.Vector3(boxCentre.x, boxCentre.y, boxCentre.z + cameraDistance);

		if (controls instanceof TrackballControls) {
			console.log("Trackball Controls");
			camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
			camera.lookAt(boxCentre.x, boxCentre.y, boxCentre.z);
			controls.target.set(boxCentre.x, boxCentre.y, boxCentre.z);
			console.log("Target set to: ", boxCentre.x, boxCentre.y, boxCentre.z);
		}

		if (controls instanceof ArcballControls) {
			console.log("Arcball Controls");
			camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
			camera.lookAt(boxCentre.x, boxCentre.y, boxCentre.z);
			controls.target.set(boxCentre.x, boxCentre.y, boxCentre.z);
			console.log("Target set to: ", boxCentre.x, boxCentre.y, boxCentre.z);
			//controls.update();
		}

		camera.updateProjectionMatrix();
		if (params.debugComments) {
			console.log("View Reset");
		}
		document.querySelector("#info-label").textContent = "View Reset";
	});
}
