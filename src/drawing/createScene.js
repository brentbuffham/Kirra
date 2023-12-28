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
	cameraPerspective: false,
	upDirection: "Y",
	rotationAngle: 0 // in radians
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
	const cameraFolder = gui.addFolder("Camera");
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
	perspectiveFolder.add(controls, "rotateSpeed", 0.0, 10.0).name("Rotate Speed").onChange(function() {
		controls.update();
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
	const upOptions = ["X", "Y", "Z"];
	cameraFolder.add(params, "upDirection", upOptions).name("Up Direction").onChange(function() {
		switch (params.upDirection) {
			case "X":
				camera.up.set(1, 0, 0);
				break;
			case "Y":
				camera.up.set(0, 1, 0);
				break;
			case "Z":
				camera.up.set(0, 0, 1);
				break;
		}
		camera.updateProjectionMatrix();
	});
	// Store the previous rotation angle
	let prevRotationAngle = params.rotationAngle;

	// Add a slider for rotation angle in degrees
	cameraFolder.add(params, "rotationAngle", 0, 360).name("Rotation Angle (degrees)").onChange(function() {
		// Calculate the delta rotation angle
		const deltaAngle = params.rotationAngle - prevRotationAngle;

		// Convert delta angle to radians
		const deltaAngleRad = THREE.MathUtils.degToRad(deltaAngle);

		// Update the previous rotation angle
		prevRotationAngle = params.rotationAngle;

		// Call the rollCamera function with the delta angle in radians
		rollCamera(deltaAngleRad);
	});

	function rollCamera(angle) {
		// Store the current camera position
		const position = controls.object.position.clone();

		// Store the current look at target
		const target = controls.target.clone();

		// Get the camera's local Z-axis (up direction)
		const cameraMatrix = new THREE.Matrix4();
		cameraMatrix.lookAt(position, target, controls.object.up);
		const cameraLocalZAxis = new THREE.Vector3(0, 0, 1).applyMatrix4(cameraMatrix);

		// Rotate the camera around its local Z-axis (up direction)
		controls.object.up.applyAxisAngle(cameraLocalZAxis, angle);

		// Update the controls
		controls.update();
	}

	animate();

	return { scene, camera };
}
