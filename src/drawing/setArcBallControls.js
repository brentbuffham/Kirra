import { camera, renderer, scene } from "./createScene.js";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

export function setArcBallControls(controls, viewHelper) {
	// if (controls) {
	// 	controls.dispose(); // Dispose of the current controls
	// }
	// controls = new ArcballControls(camera, renderer.domElement, scene);

	// if (viewHelper) {
	// 	viewHelper.dispose(); // Dispose of the current view helper
	// }
	// viewHelper = new ViewHelper(camera, renderer.domElement);
	viewHelper.controls = controls;
	controls.rotateSpeed = 1.0;
	controls.enableRotate = false;
	controls.enableZoom = true;
	controls.enablePan = true;
	controls.zoomSpeed = 1;
	controls.panSpeed = 1;
	controls.cursorZoom = true;
	controls.enableGrid = true;
	controls.activateGizmos(false);
	controls.setGizmosVisible(false);
	camera.updateProjectionMatrix();
	controls.update();

	return { controls, viewHelper };
}
