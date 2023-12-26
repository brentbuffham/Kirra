import * as THREE from "three";
import { PerspectiveCamera } from "three";
import { OrthographicCamera } from "three";

export const createScene = () => {
	const scene = new THREE.Scene();

	const renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight - 20);
	document.body.appendChild(renderer.domElement);

	const frustumSize = 50; // Adjust this value based on your scene size

	const aspect = window.innerWidth / window.innerHeight;
	const camera = new OrthographicCamera(
		frustumSize * aspect / -2, // left
		frustumSize * aspect / 2, // right
		frustumSize / 2, // top
		frustumSize / -2, // bottom
		0.001, // near
		1000 // far
	);

	//const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.001, 1000);

	camera.position.set(0, 0, 30);
	camera.lookAt(0, 0, 0);

	return { scene, camera, renderer };
};
