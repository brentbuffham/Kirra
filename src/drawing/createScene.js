import * as THREE from "three";
import { OrthographicCamera } from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";

export const createScene = () => {
	const scene = new THREE.Scene();

	const renderer = new THREE.WebGLRenderer();
	const canvas = document.querySelector('#canvas');
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector('#canvas').appendChild(renderer.domElement);

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

	// Add controls
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true; // an animation loop is required when either damping or auto-rotation are enabled
	controls.dampingFactor = 0.25;
	controls.screenSpacePanning = false;

	// Animation loop
	const animate = () => {
		requestAnimationFrame(animate);

		// Add animation logic here if needed
		controls.update(); // only required if controls.enableDamping = true, or if controls.autoRotate = true

		renderer.render(scene, camera);
	};

	animate();

	//const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.001, 1000);

	camera.position.set(0, 0, 30);
	camera.lookAt(0, 0, 0);

	return { scene, camera, renderer };
};
