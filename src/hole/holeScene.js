import { drawHole } from "../threeTrail/drawhole.js";
import { createScene } from "../threeTrail/createScene.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

export function createHole() {
	const { scene, camera, renderer } = createScene();
	drawHole(scene);

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
}
