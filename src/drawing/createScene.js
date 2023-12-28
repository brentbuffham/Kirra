import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { PerspectiveCamera } from "three";
import { OrthographicCamera } from "three";
import Stats from "stats.js";
import { GUI } from "dat.gui";
import { renderFileUpload } from "../file/import/fileUpload";

// ...

let controls, camera, scene, renderer, stats;
const params = {
	cameraPerspective: false
};

export { controls };

export function createScene() {
	const scene = new THREE.Scene();
	const renderer = new THREE.WebGLRenderer();
	const canvas = document.querySelector("#canvas");
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector("#canvas").appendChild(renderer.domElement);

	const frustumSize = 100;
	const aspect = canvas.offsetWidth / canvas.offsetHeight;
	const cameraPerspective = new PerspectiveCamera(75, aspect, 0.1, 1000);
	const cameraOrthographic = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 1000);

	stats = new Stats();

	// Initialize camera with one of the cameras
	camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;

	controls = new TrackballControls(camera, renderer.domElement);
	controls.rotateSpeed = 20.0;
	controls.zoomSpeed = 0.5;
	controls.panSpeed = 1;
	controls.dynamicDampingFactor = 0.3;

	function animate() {
		requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
		stats.update();
	}

	const orthographicCameraProps = {
		frustumSize: 100
	};

	const gui = new GUI();
	const perspectiveFolder = gui.addFolder("Perspective Camera");
	const orthographicFolder = gui.addFolder("Orthographic Camera");
	gui.add(params, "cameraPerspective").name("Perspective View").onChange(function() {
		// Update camera when the perspective checkbox changes
		camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
		//store the current camera position
		const position = controls.object.position;
		//store the current look at target
		const target = controls.target;
		//when the camera is switched, reset the controls
		controls = new TrackballControls(camera, renderer.domElement);
		controls.rotateSpeed = 20.0;
		controls.zoomSpeed = 0.5;
		controls.panSpeed = 1;
		controls.dynamicDampingFactor = 0.3;
		//set the controls to the stored position and target
		controls.object.position.copy(position);
		controls.target.copy(target);
	});
	perspectiveFolder.add(cameraPerspective, "fov", 0, 180).name("Field of View").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(cameraPerspective, "near", 0.1, 1000).name("Near Plane").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(cameraPerspective, "far", 0.1, 1000).name("Far Plane").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	orthographicFolder.add(orthographicCameraProps, "frustumSize", 0, 200).name("Frustum Size").onChange(function() {
		const aspect = canvas.offsetWidth / canvas.offsetHeight;
		const frustumSize = orthographicCameraProps.frustumSize;
		cameraOrthographic.left = -frustumSize * aspect / 2;
		cameraOrthographic.right = frustumSize * aspect / 2;
		cameraOrthographic.top = frustumSize / 2;
		cameraOrthographic.bottom = -frustumSize / 2;
		cameraOrthographic.updateProjectionMatrix();
	});
	orthographicFolder.add(cameraOrthographic, "near", 0.1, 1000).name("Near Plane").onChange(function() {
		cameraOrthographic.updateProjectionMatrix();
	});
	orthographicFolder.add(cameraOrthographic, "far", 0.1, 1000).name("Far Plane").onChange(function() {
		cameraOrthographic.updateProjectionMatrix();
	});

	animate();

	return { scene, camera };
}
