import * as THREE from "three";
import {OrthographicCamera, Vector3} from "three";
import {OrbitControls} from "three/addons";

export function createScene() {
	const scene = new THREE.Scene();
	const renderer = new THREE.WebGLRenderer();
	const canvas = document.querySelector("#canvas");
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector("#canvas").appendChild(renderer.domElement);

	const frustumSize = 50;
	const aspect = canvas.offsetWidth / canvas.offsetHeight;
	const camera = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.001, 1000);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.25;
	controls.screenSpacePanning = false;

	function animate() {
		requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
	}

	animate();

	camera.position.set(0, 0, 50);
	camera.lookAt(0, 0, 0);

	return {scene, camera};
}
