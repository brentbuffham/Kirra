import { TransformControls } from "three/addons/controls/TransformControls.js";
import { setArcBallControls } from "../../drawing/setArcBallControls.js";
import { renderer, scene, camera, controls, objectCenter } from "../../drawing/createScene.js";
import { params } from "../../drawing/createScene.js";
import { deactivateRotateAroundObjCenter } from "./rotateAroundObjCenter.js";

let localTransformControls = null;

export const deactivateTransformControls = () => {
	if (localTransformControls) {
		localTransformControls.detach(objectCenter);
		scene.remove(localTransformControls);
		localTransformControls.dispose();
		localTransformControls = null;
		objectCenter.visible = true;
		controls.enableRotate = true;
		document.getElementById("translate-object-centre").classList.remove("highlighted");
		if (params.debugComments) {
			console.log("TransformControls deactivated");
		}
	}
};

export const bindListenerToTranslateObjectCentreButton = (canvas) => {
	const button = document.getElementById("translate-object-centre");

	button.addEventListener("click", function () {
		if (params.debugComments) {
			console.log("Translate Object Centre button clicked");
		}

		// Deactivate gizmo if active
		deactivateRotateAroundObjCenter();

		if (localTransformControls) {
			// Dispose of the TransformControls
			deactivateTransformControls();
		} else {
			// Create and attach the TransformControls
			objectCenter.visible = false;
			localTransformControls = new TransformControls(camera, renderer.domElement);
			localTransformControls.attach(objectCenter);
			scene.add(localTransformControls);
			controls.enableRotate = false;
			localTransformControls.name = "TransformControls";
			localTransformControls.addEventListener("dragging-changed", function (event) {
				controls.enabled = !event.value;
			});
			button.classList.add("highlighted");
			if (params.debugComments) {
				console.log("TransformControls created and attached");
			}
		}
	});
};
