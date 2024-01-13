import {TransformControls} from "three/addons/controls/TransformControls.js";
import {setArcBallControls} from "./setArcBallControls.js";
import {camera, renderer, scene, transformControls} from "./createScene.js";

export const bindingKeys = (objectCenter, controls, viewHelper) => {
    addEventListener("keydown", function (event) {
        switch (event.key) {
            case "r":
                controls.enableRotate = true;
                controls.enableZoom = true;
                controls.enablePan = false;
                controls.cursorZoom = false;
                controls.activateGizmos(true);
                controls.setGizmosVisible(true);
                controls.target.set(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);
                camera.lookAt(controls.target);
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
                transformControls.addEventListener("dragging-changed", function (event) {
                    controls.enabled = !event.value;
                });
                break;
        }
    });
    addEventListener("keyup", function (event) {
        switch (event.key) {
            case "r":
                setArcBallControls(controls, viewHelper);
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
}
