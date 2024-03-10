import { TransformControls } from "three/addons/controls/TransformControls.js";
import { setArcBallControls } from "./setArcBallControls.js";
import { renderer, scene } from "./createScene.js";

export const bindingKeys = (camera, objectCenter, controls, viewHelper, transformControls) => {
	addEventListener("keydown", function(event) {
		switch (event.key) {
			case "r":
				if (transformControls === undefined || transformControls === null) {
					controls.activateGizmos(true);
					controls.setGizmosVisible(true);
					console.log("rotate (r) pressed");
					controls.enableRotate = true;
					controls.enableZoom = true;
					controls.enablePan = false;
					controls.cursorZoom = false;
				}
				controls.target.set(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);
				camera.lookAt(controls.target);
				camera.updateProjectionMatrix();
				controls.update();
				break;
			case "p":
				objectCenter.visible = false;
				if (transformControls === undefined || transformControls === null) {
					transformControls = new TransformControls(camera, renderer.domElement);
					transformControls.attach(objectCenter);
					scene.add(transformControls);
					transformControls.name = "TransformControls";
				}
				transformControls.addEventListener("dragging-changed", function(event) {
					controls.enabled = !event.value;
				});
				break;
		}
	});
	addEventListener("keyup", function(event) {
		switch (event.key) {
			case "r":
				controls.activateGizmos(false);
				controls.setGizmosVisible(false);
				console.log("rotate (r) pressed");
				controls.enableRotate = false;
				controls.enableZoom = true;
				controls.enablePan = true;
				controls.cursorZoom = true;
				//setArcBallControls(controls, viewHelper, scene);
				camera.updateProjectionMatrix();
				controls.update();
				break;
			case "p":
				objectCenter.visible = true;
				transformControls.detach(objectCenter);
				scene.remove(transformControls);
				transformControls.dispose();
				transformControls = null;
				break;
		}
	});
};
