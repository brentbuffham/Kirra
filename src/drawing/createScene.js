import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { PerspectiveCamera } from "three";
import { OrthographicCamera } from "three";

let controls;

export { controls };

export function createScene() {
	const scene = new THREE.Scene();
	const renderer = new THREE.WebGLRenderer();
	const canvas = document.querySelector("#canvas");
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector("#canvas").appendChild(renderer.domElement);

	const frustumSize = 100;
	const aspect = canvas.offsetWidth / canvas.offsetHeight;
	//const camera = new PerspectiveCamera(75, aspect, 0.1, 1000);
	const camera = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 1000);

	controls = new TrackballControls(camera, renderer.domElement);
	controls.rotateSpeed = 20.0;
	controls.zoomSpeed = 0.5;
	controls.panSpeed = 1;
	controls.dynamicDampingFactor = 0.3;

	function animate() {
		requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
	}

	animate();

	return { scene, camera };
}
