import * as THREE from "three";
import { OrthographicCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"; // Import from the correct path

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
	const camera = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 500);

	// Set a new rotation (in radians)
	const newRotation = new THREE.Euler(Math.PI / 4, 0, 0); // Rotate 45 degrees around the X-axis
	controls = new OrbitControls(camera, renderer.domElement);
	controls.dampingFactor = 0.25; // Adjust the damping factor to your liking
	controls.enableDamping = true; // Enable damping
	// Set properties to remove constraints
	controls.minPolarAngle = -(2 * Math.PI); // Minimum polar angle in radians
	controls.maxPolarAngle = 2 * Math.PI; // Maximum polar angle in radians (180 degrees)
	controls.minAzimuthAngle = -Infinity; // No minimum azimuth angle
	controls.maxAzimuthAngle = Infinity; // No maximum azimuth angle

	function animate() {
		requestAnimationFrame(animate);
		controls.update(); // Update the controls in the animation loop
		renderer.render(scene, camera);
	}

	animate();

	return { scene, camera };
}
