import { setArcBallControls } from "../../drawing/setArcBallControls.js";
import { renderer, scene, camera, controls, objectCenter } from "../../drawing/createScene.js";
import { params } from "../../drawing/createScene.js";
import { deactivateTransformControls } from "./translateObjectCenter.js"; // Import the function to deactivate transform controls

let gizmoActive = false;

export const deactivateRotateAroundObjCenter = () => {
	if (gizmoActive) {
		controls.activateGizmos(false);
		controls.setGizmosVisible(false);
		controls.enableRotate = true;
		controls.enableZoom = true;
		controls.enablePan = true;
		controls.cursorZoom = true;

		controls.target.set(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);
		camera.lookAt(controls.target);
		camera.updateProjectionMatrix();
		controls.update();
		document.getElementById("rotate-around-obj-center").classList.remove("highlighted");
		gizmoActive = false;
		// if (params.debugComments) {
		// 	console.log("Gizmo deactivated");
		// }
	}
};

export const bindListenerToRotateAroundObjCenterButton = (canvas) => {
	const button = document.getElementById("rotate-around-obj-center");

	button.addEventListener("click", function () {
		// if (params.debugComments) {
		// 	console.log("Rotate Around Object Center button clicked");
		// }

		// Deactivate transform controls if active
		deactivateTransformControls();

		if (gizmoActive) {
			// Deactivate gizmo
			deactivateRotateAroundObjCenter();
		} else {
			// Activate gizmo
			controls.activateGizmos(true);
			controls.setGizmosVisible(true);
			controls.enableRotate = true;
			controls.enableZoom = true;
			controls.enablePan = true;
			controls.cursorZoom = true;

			controls.target.set(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);
			camera.lookAt(controls.target);
			camera.updateProjectionMatrix();
			controls.update();
			button.classList.add("highlighted");
			gizmoActive = true;
			// if (params.debugComments) {
			// 	console.log("Gizmo activated");
			// }
		}
	});
};
