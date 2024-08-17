import * as THREE from "three";
import { getSceneBoundingBox } from "../../helpers/resetCameraView.js";
import { updateCameraType } from "../../drawing/createScene.js";

export function bindListenerToCameraTypeCycleButton(scene, camera, controls, params) {
	document.querySelector("#camera-mode").addEventListener("click", () => {
		// Toggle between perspective and orthographic
		params.usePerspectiveCam = !params.usePerspectiveCam;
		console.log("Switching Camera Mode to: ", params.usePerspectiveCam ? "Perspective" : "Orthographic");

		let boxCentre = getSceneBoundingBox(scene).getCenter(new THREE.Vector3());

		// Update camera and controls based on the current mode
		updateCameraType(boxCentre.x, boxCentre.y, boxCentre.z);

		// Set camera position and look-at based on the new camera type
		camera.position.set(boxCentre.x, boxCentre.y, boxCentre.z + parseFloat(params.cameraDistance) * 0.5);
		camera.lookAt(boxCentre.x, boxCentre.y, boxCentre.z);
		controls.target.set(boxCentre.x, boxCentre.y, boxCentre.z);
		camera.updateProjectionMatrix();

		// Update the icon based on the camera type
		document.querySelector("#camera-mode").innerHTML = params.usePerspectiveCam ? `<img src="./assets/tabler-icons-2.36.0/png/cube-perspective.png" alt="Perspective Mode" />` : `<img src="./assets/tabler-icons-2.36.0/png/cube.png" alt="Orthographic Mode" />`;

		console.log("Camera Type After Change: ", camera.isPerspectiveCamera ? "Perspective" : "Orthographic");
		console.log("Camera Position After Change: ", camera.position.x, camera.position.y, camera.position.z);
		console.log("boxCentre after change: ", boxCentre.x, boxCentre.y, boxCentre.z);
	});
}
