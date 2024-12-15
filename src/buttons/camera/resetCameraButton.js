import * as THREE from "three";
import { getSceneBoundingBox } from "../../helpers/resetCameraView.js";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { objectCenter } from "../../drawing/createScene.js";

export function bindListenerToResetCameraViewButton(camera, controls, scene, params) {
	document.querySelector("#reset").addEventListener("click", function () {
		console.log("Camera Type Before Reset: ", camera.isPerspectiveCamera ? "Perspective" : "Orthographic");
		const boxCentre = getSceneBoundingBox(scene).getCenter(new THREE.Vector3());
		console.log("Box Centre: ", boxCentre.x, boxCentre.y, boxCentre.z);
		camera.up.set(0, 1, 0); // Y-axis pointing up on the screen

		// Position the camera along the Z-axis, looking at the center of the scene
		const cameraDistance = parseFloat(params.cameraDistance) * 0.5;
		const cameraPosition = new THREE.Vector3(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z + cameraDistance);
		console.log("Camera Position: ", cameraPosition.x, cameraPosition.y, cameraPosition.z);
		console.log("Object Center Position: ", objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);

		if (controls instanceof TrackballControls) {
			console.log("Trackball Controls");
			camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
			camera.lookAt(objectCenter.position);
			controls.target.set(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);
			console.log("Look At: x", objectCenter.position.x, " y", objectCenter.position.y, " z", objectCenter.position.z);
			controls.update();
		}

		if (controls instanceof ArcballControls) {
			console.log("Arcball Controls");
			camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
			camera.lookAt(objectCenter.position);
			controls.target.set(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);
			console.log("Look At: x", objectCenter.position.x, " y", objectCenter.position.y, " z", objectCenter.position.z);
			controls.update();
		}

		camera.updateProjectionMatrix();
		if (params.debugComments) {
			console.log("View Reset");
		}
		document.querySelector("#info-label").textContent = "View Reset";
	});
}
