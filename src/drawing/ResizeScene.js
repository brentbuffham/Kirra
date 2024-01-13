import {OrthographicCamera, PerspectiveCamera} from "three";
import {camera, renderer} from "./createScene.js";
import {sceneConfig} from "./sceneConfig.js";

export function onWindowResize() {
    const resize = () => {

        const {frustumSize} = sceneConfig;

        const aspect = window.innerWidth / window.innerHeight;
        if (camera instanceof OrthographicCamera) {
            camera.left = -frustumSize * aspect / 2;
            camera.right = frustumSize * aspect / 2;
            camera.top = frustumSize / 2;
            camera.bottom = -frustumSize / 2;
        } else if (camera instanceof PerspectiveCamera) {
            camera.aspect = aspect;
        }
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener("resize", resize, false);
}


