import * as THREE from "three";
import { OrthographicCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { getCentroid } from "../file/import/fileUpload";

export const createScene = (data, scene, camera, renderer) => {
	scene = new THREE.Scene();

	renderer = new THREE.WebGLRenderer();
	const canvas = document.querySelector("#canvas");
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector("#canvas").appendChild(renderer.domElement);

	const frustumSize = 50; // Adjust this value based on your scene size

	const aspect = window.innerWidth / window.innerHeight;
	camera = new OrthographicCamera(
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
	// Function to draw points in the scene
	function drawPoints() {
		if (Array.isArray(data)) {
			for (const d of data) {
				drawDummy(d.startXLocation, d.startYLocation, d.startZLocation, 5);
				console.log("Data point: ", d);
			}
		} else {
			console.error("Data is not iterable", data);
		}
	}
	// Handle initial drawing of points
	if (data) {
		drawPoints();
	}

	const { x, y, z } = getCentroid(data);
	console.log("Centroid: ", x, y, z);

	camera.position.set(x, y, z + 100);
	camera.lookAt(x, y, z);

	return { scene, camera, renderer };
};

export const updateScene = (data, scene, camera, renderer) => {
	// Clear the existing scene
	scene.children.forEach(object => {
		scene.remove(object);
	});

	// Draw new objects based on the updated data
	for (const d of data) {
		drawDummy(d.startXLocation, d.startYLocation, d.startZLocation, 5);
	}

	// Additional logic based on your requirements

	// Render the scene
	renderer.render(scene, camera);
};
