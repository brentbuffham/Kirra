import { camera, renderer, scene, objectCenter } from "./createScene.js"; // Import objectCenter
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

export function setArcBallControls(controls, viewHelper) {
	//viewHelper.controls = controls;
	controls.rotateSpeed = 1.0;
	controls.enableRotate = true;
	controls.enableZoom = true;
	controls.enablePan = true;
	controls.zoomSpeed = 1;
	controls.panSpeed = 1;
	controls.cursorZoom = true;
	controls.enableGrid = true;
	controls.activateGizmos(false);
	controls.setGizmosVisible(false);
	camera.updateProjectionMatrix();

	// Ensure controls.target is set to objectCenter
	if (objectCenter) {
		controls.target.copy(objectCenter.position);
		controls.update();
	}

	return { controls, viewHelper };
}
