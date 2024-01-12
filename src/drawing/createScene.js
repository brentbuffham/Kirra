//createScene.js
//consistently import THREE
import * as THREE from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { ArrowHelper, AxesHelper } from "three";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
import { Object3D } from "three";
import { OrthographicCamera } from "three";
import { PerspectiveCamera } from "three";
import { GUI } from "lil-gui";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { Vector3, Scene, AmbientLight, DirectionalLight, WebGLRenderer } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

export let controls, camera, scene, renderer, clock;
export let viewHelper;

export let cameraPerspective = new PerspectiveCamera();
export let cameraOrthographic = new OrthographicCamera();
export let transformControls;

const gui = new GUI();
export let frustumSize = 100;

export const params = {
	cameraPerspective: false,
	upDirection: "Z",
	rotationAngle: 0,
	holeDisplay: "mesh-cross",
	holeText: "ID",
	debugComments: true
	// holeColour: "white",
	// holeSubdrillColour: "red"
};

function createLighting(scene) {
	//create ambient light
	const ambientLight = new AmbientLight(0xffffff, 0.5);
	scene.add(ambientLight);
	//create directional light
	const directionalLight = new DirectionalLight(0xffffff, 2);
	directionalLight.position.set(0, 500, 500);
	scene.add(directionalLight);
}

function setCamera(camera, aspect, frustumSize) {
	if (camera instanceof PerspectiveCamera) {
		camera.fov = 56.5;
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.near = 0.01;
		camera.far = 500;
	}
	if (camera instanceof OrthographicCamera) {
		camera.left = -frustumSize * aspect / 2;
		camera.right = frustumSize * aspect / 2;
		camera.top = frustumSize / 2;
		camera.bottom = -frustumSize / 2;
		camera.near = 0.01;
		camera.far = 500;
	}
}

export function createScene(points) {
	console.log("createScene(points)", points);
	scene = new Scene();
	const canvas = document.querySelector("#canvas");
	let aspect = canvas.offsetWidth / canvas.offsetHeight;
	// clock
	clock = new THREE.Clock();
	//create Gizmos for the ArcballControls
	const objectCenter = new Object3D();
	if (points === null || points.length === 0) {
		objectCenter.position.set(0, 0, 0);
	}
	//gizmos.add(new AxesHelper(10));
	objectCenter.add(new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0, 0), 10, 0xff0000, 5, 2));
	objectCenter.add(new ArrowHelper(new Vector3(0, 1, 0), new Vector3(0, 0, 0), 10, 0x00ff00, 5, 2));
	objectCenter.add(new ArrowHelper(new Vector3(0, 0, 1), new Vector3(0, 0, 0), 10, 0x0000ff, 5, 2));

	objectCenter.name = "objectCenter";
	scene.add(objectCenter);

	//Set up the Cameras
	setCamera(cameraPerspective, aspect, frustumSize);
	setCamera(cameraOrthographic, aspect, frustumSize);
	//Set up the Renderer
	renderer = new WebGLRenderer({ antialias: true }); // Add the antialias parameter here
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.autoClear = false;
	document.querySelector("#canvas").appendChild(renderer.domElement);

	// const transformControls = new TransformControls(camera, renderer.domElement);
	// Initialize camera with one of the cameras
	camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
	controls = new ArcballControls(camera, renderer.domElement, scene);
	controls.setGizmosVisible(true);
	camera = cameraOrthographic;
	createLighting(scene);

	const position = new Vector3(0, 0, 0 + 200);
	camera.position.copy(position);
	camera.lookAt(0, 0, 0);
	camera.up.set(0, 1, 0);
	controls.target.set(0, 0, 0);
	//set the controls to the stored position and target
	camera.position.copy(position);
	controls.target.copy(objectCenter.position);

	viewHelper = new ViewHelper(camera, renderer.domElement);
	viewHelper.controls = controls;
	viewHelper.controls.center = controls.target;
	//match the view helper to the controls
	viewHelper.update();

	const div = document.createElement("div");
	div.id = "viewHelper";
	div.style.position = "absolute";
	div.style.right = 0;
	div.style.bottom = 0;
	div.style.height = "128px";
	div.style.width = "128px";

	document.body.appendChild(div);

	div.addEventListener("pointerup", event => viewHelper.handleClick(event));

	function setArcBallControls() {
		if (controls) {
			controls.dispose(); // Dispose of the current controls
		}
		//set the controls to the arcball controls
		controls = new ArcballControls(camera, renderer.domElement, scene);

		if (viewHelper) {
			viewHelper.dispose(); // Dispose of the current view helper
		}
		viewHelper = new ViewHelper(camera, renderer.domElement);
		viewHelper.controls = controls;
		controls.rotateSpeed = 20.0;
		controls.enableRotate = false;
		controls.enableZoom = true;
		controls.enablePan = true;
		controls.zoomSpeed = 1;
		controls.panSpeed = 1;
		controls.cursorZoom = true;
		controls.enableGrid = true;
		controls.activateGizmos(false);
		controls.setGizmosVisible(false);

		controls.update();
	}

	setArcBallControls();

	addEventListener("keydown", function(event) {
		switch (event.key) {
			case "r":
				controls.enableRotate = true;
				controls.enableZoom = true;
				controls.enablePan = false;
				controls.cursorZoom = false;
				controls.activateGizmos(true);
				controls.setGizmosVisible(true);
				controls.target.set(objectCenter.position.x, objectCenter.position.y, objectCenter.position.z);
				camera.lookAt(controls.target);
				controls.update();
				break;
			case "p":
				objectCenter.visible = false;
				if (transformControls === undefined || transformControls === null) {
					transformControls = new TransformControls(camera, renderer.domElement);
					transformControls.attach(objectCenter);
					scene.add(transformControls);
					transformControls.name = "TransformControls";
				}
				transformControls.addEventListener("dragging-changed", function(event) {
					controls.enabled = !event.value;
				});
				break;
		}
	});
	addEventListener("keyup", function(event) {
		switch (event.key) {
			case "r":
				setArcBallControls();
				break;
			case "p":
				objectCenter.visible = true;
				transformControls.detach(objectCenter);
				scene.remove(transformControls);
				transformControls.dispose();
				transformControls = null;
				break;
		}
	});

	function animate() {
		requestAnimationFrame(animate);
		renderer.clear();
		const delta = clock.getDelta();

		if (viewHelper.animating) viewHelper.update(delta);

		renderer.render(scene, camera);
		viewHelper.render(renderer);
	}

	const orthographicCameraProps = {
		frustumSize: 100
	};
	gui.close();
	gui.add(params, "debugComments").name("Debug Comments").onChange(function() {
		// update the debug comments when the checkbox changes
		params.debugComments = params.debugComments ? true : false;
	});

	gui.add(params, "cameraPerspective").name("Use Perspective Camera").onChange(function() {
		// Update camera when the perspective checkbox changes
		camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
		const position = new Vector3(controls.target.x, controls.target.y, controls.target.z + 200);
		//store the current look at target
		const target = controls.target;
		//when the camera is switched, reset the controls
		setArcBallControls();
		//set the controls to the stored position and target
		camera.position.copy(position);
		controls.target.copy(target);
	});
	const upOptions = ["X", "Y", "Z"];
	gui.add(params, "upDirection", upOptions).name("Direction Axis").onChange(function() {
		switch (params.upDirection) {
			case "Y":
				//camera.up.set(0, 1, 0);
				break;
			case "X":
				//camera.up.set(1, 0, 0);
				break;
			case "Z":
				//camera.up.set(0, 0, 1);
				break;
		}
		camera.updateProjectionMatrix();
	});
	// Store the previous rotation angle
	let prevRotationAngle = params.rotationAngle;

	// Add a slider for rotation angle in degrees
	gui.add(params, "rotationAngle", 0, 360).name("View Angle (°)").onChange(function() {
		// Calculate the delta rotation angle
		const deltaAngle = params.rotationAngle - prevRotationAngle;

		// Convert delta angle to radians
		const deltaAngleRad = THREE.MathUtils.degToRad(deltaAngle);

		// Update the previous rotation angle
		prevRotationAngle = params.rotationAngle;

		// Call the rollCamera function with the delta angle in radians
		const axis = params.upDirection;
		rollCamera(axis, 0);
		rollCamera(axis, deltaAngleRad);
	});

	const cameraFolder = gui.addFolder("Camera Options");
	cameraFolder.close();

	const orthographicFolder = cameraFolder.addFolder("Orthographic Camera");
	const perspectiveFolder = cameraFolder.addFolder("Perspective Camera");

	perspectiveFolder.add(cameraPerspective, "fov", 0, 180).name("Field of View").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(cameraPerspective, "near", 0.1, 1000).name("Near Plane").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(cameraPerspective, "far", 0.1, 1000).name("Far Plane").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(controls, "rotateSpeed", 0.0, 50.0).name("Rotate Speed").onChange(function() {
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

	///////////////////////
	//Only functions prior to upload of the csv file at this stage.
	if (points !== null || points.length > 0) {
		const holeFolder = gui.addFolder("Hole Options");
		holeFolder.close();
		// const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "line-circle", "line-diamond", "line-square"];
		// holeFolder.add(params, "holeDisplay", holeOptions).name("Hole Display Type").onChange(function() {
		// 	//nothing yet
		// });
		const holeTextOptions = ["Off", "ID", "Length"];
		holeFolder.add(params, "holeText", holeTextOptions).name("Hole Text").onChange(function() {
			//nothing yet
		});
	}

	function rollCamera(axis, radians) {
		//check the axis and set the vector
		let vector = new Vector3(0, 0, 1);
		if (axis === "Z") {
			vector = new Vector3(0, 0, 1);
		} else if (axis === "Y") {
			vector = new Vector3(0, 1, 0);
		} else if (axis === "X") {
			vector = new Vector3(1, 0, 0);
		} else {
			vector = new Vector3(0, 0, 1);
		}
		if (controls instanceof ArcballControls) {
			// Get the vector from the camera to the target (controls.target)
			const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();

			// Create a quaternion representing the rotation around the Z axis
			const quaternion = new THREE.Quaternion();
			quaternion.setFromAxisAngle(vector, radians);

			// Rotate the direction vector
			direction.applyQuaternion(quaternion);

			// Calculate the new position of the camera
			const distance = camera.position.distanceTo(controls.target);
			const newPosition = new THREE.Vector3().addVectors(controls.target, direction.multiplyScalar(distance));

			// Apply the new position and up vector to the camera
			camera.position.copy(newPosition);
			camera.up.applyQuaternion(quaternion);

			// Look at the target
			camera.lookAt(controls.target);

			// Update the camera's matrix and the controls
			//camera.updateMatrixWorld();
			controls.update();
		} else if (controls instanceof TrackballControls) {
			//store the current camera position
			const position = controls.object.position.clone();
			// Store the current look at target
			const target = controls.target.clone();

			// Get the camera's local Z-axis (up direction)
			const cameraMatrix = new THREE.Matrix4();
			cameraMatrix.lookAt(position, target, controls.object.up);
			const cameraLocalZAxis = vector.applyMatrix4(cameraMatrix);

			// Rotate the camera around its local Z-axis (up direction)
			controls.object.up.applyAxisAngle(cameraLocalZAxis, radians);

			// Update the controls
			controls.update();
		}
	}

	animate();

	return { scene, camera };
}

function onWindowResize() {
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
window.addEventListener("resize", onWindowResize, false);
