import { TransformControls } from "three/addons/controls/TransformControls.js";
import { setArcBallControls } from "./setArcBallControls.js";
import { renderer, scene } from "./createScene.js";

export const bindingKeys = (camera, objectCenter, controls, viewHelper, transformControls) => {
	addEventListener("keydown", function (event) {
		switch (event.key) {
			case "r":
				if (!transformControls) {
					controls.activateGizmos(true);
					controls.setGizmosVisible(true);
					controls.enableRotate = true;
					console.log("rotate (r) pressed - controls.enableRotate = true");
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
				if (!transformControls) {
					console.log("pan (p) pressed - enabling TransformControls");
					transformControls = new TransformControls(camera, renderer.domElement);
					transformControls.attach(objectCenter);
					scene.add(transformControls);
					controls.enableRotate = false;
					transformControls.name = "TransformControls";
				}
				transformControls.addEventListener("dragging-changed", function (event) {
					controls.enabled = !event.value;
				});
				break;
		}
	});

	addEventListener("keyup", function (event) {
		switch (event.key) {
			case "r":
				if (!transformControls) {
					controls.activateGizmos(false);
					controls.setGizmosVisible(false);
					controls.enableRotate = true;
					console.log("rotate (r) released - controls.enableRotate = false");
					controls.enableZoom = true;
					controls.enablePan = true;
					controls.cursorZoom = true;
				}
				camera.updateProjectionMatrix();
				controls.update();
				break;
			case "p":
				console.log("pan (p) released - disabling TransformControls");
				objectCenter.visible = true;
				if (transformControls) {
					transformControls.detach(objectCenter);
					scene.remove(transformControls);
					transformControls.dispose();
					transformControls = null;
				}
				controls.enableRotate = true;
				break;
		}
	});
};
