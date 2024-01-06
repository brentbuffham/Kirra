//createScene.js
//consistently import THREE
import * as THREE from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { ArrowHelper, AxesHelper } from "three";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
import { getCentroid } from "./helpers/getCentroid";
import { Object3D } from "three";
import { OrthographicCamera } from "three";
import { PerspectiveCamera } from "three";
import { GUI } from "lil-gui";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { Vector3, Scene, AmbientLight, DirectionalLight, WebGLRenderer } from "three";
import { changeHoleMesh } from "./helpers/changeHoleMesh";

export let controls, camera, scene, renderer, clock;
export let viewHelper;

const gui = new GUI();
export let frustumSize = 100;

export const params = {
	cameraPerspective: false,
	upDirection: "Z",
	rotationAngle: 0,
	holeDisplay: "mesh-circle",
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

export function createScene(points) {
	console.log("createScene(points)", points);
	scene = new Scene();
	const canvas = document.querySelector("#canvas");
	//Set up the Renderer
	renderer = new WebGLRenderer({ antialias: true }); // Add the antialias parameter here
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.autoClear = false;
	document.querySelector("#canvas").appendChild(renderer.domElement);

	let aspect = canvas.offsetWidth / canvas.offsetHeight;
	const cameraPerspective = new PerspectiveCamera(56.5, aspect, 0.01, 500);
	const cameraOrthographic = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.01, 500);
	// Initialize camera with one of the cameras
	camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
	controls = new ArcballControls(camera, renderer.domElement);
	camera = cameraOrthographic;
	createLighting(scene);

	const position = new Vector3(0, 0, 0 + 200);
	camera.position.copy(position);
	camera.lookAt(0, 0, 0);
	camera.up.set(0, 1, 0);

	// clock
	clock = new THREE.Clock();

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

	//create Gizmos for the ArcballControls
	const gizmos = new Object3D();
	//gizmos.add(new AxesHelper(10));
	gizmos.add(new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0, 0), 10, 0xff0000, 5, 2));
	gizmos.add(new ArrowHelper(new Vector3(0, 1, 0), new Vector3(0, 0, 0), 10, 0x00ff00, 5, 2));
	gizmos.add(new ArrowHelper(new Vector3(0, 0, 1), new Vector3(0, 0, 0), 10, 0x0000ff, 5, 2));

	scene.add(gizmos);

	function setControls() {
		controls.rotateSpeed = 20.0;
		controls.zoomSpeed = 1;
		controls.panSpeed = 1;
		controls.cursorZoom = true;
	}
	setControls();

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
	//Add a reset camera to the gui
	gui
		.add(
			{
				resetCamera: function() {
					//store the current camera position
					const position = new Vector3(0, 0, 0 + 200);
					const target = new Vector3(0, 0, 0);

					//reset the camera rotation to 0 (Y+ is at the top of the canvas X+ to the Right and Z+ toward the camera)
					if (controls instanceof TrackballControls) {
						controls.object.up.set(0, 1, 0);
					}
					if (controls instanceof ArcballControls) {
						camera.position.copy(position);
						camera.lookAt(0, 0, 0);
						camera.up.set(0, 1, 0);
						controls.target.set(0, 0, 0);
						//set the controls to the stored position and target
						camera.position.copy(position);
						controls.target.copy(target);
					}
				}
			},
			"resetCamera"
		)
		.name("Reset Camera");

	gui.add(params, "cameraPerspective").name("Use Perspective Camera").onChange(function() {
		// Update camera when the perspective checkbox changes
		camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
		const position = new Vector3(controls.target.x, controls.target.y, controls.target.z + 100);
		//store the current look at target
		const target = controls.target;
		//when the camera is switched, reset the controls
		controls = new ArcballControls(camera, renderer.domElement);
		setControls();
		//set the controls to the stored position and target
		camera.position.copy(position);
		controls.target.copy(target);
	});
	const upOptions = ["X", "Y", "Z"];
	gui.add(params, "upDirection", upOptions).name("Up Direction Axis").onChange(function() {
		switch (params.upDirection) {
			case "Y":
				camera.up.set(0, 1, 0);
				break;
			case "X":
				camera.up.set(1, 0, 0);
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
	gui.add(params, "rotationAngle", 0, 360).name("View Angle (°)").onChange(function() {
		// Calculate the delta rotation angle
		const deltaAngle = params.rotationAngle - prevRotationAngle;

		// Convert delta angle to radians
		const deltaAngleRad = THREE.MathUtils.degToRad(deltaAngle);

		// Update the previous rotation angle
		prevRotationAngle = params.rotationAngle;

		// Call the rollCamera function with the delta angle in radians
		rollCamera(0);
		rollCamera(deltaAngleRad);
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
		const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "line-circle", "line-diamond", "line-square"];
		holeFolder.add(params, "holeDisplay", holeOptions).name("Hole Display Type").onChange(function() {
			//nothing yet
		});
		const holeTextOptions = ["Off", "ID", "Length"];
		holeFolder.add(params, "holeText", holeTextOptions).name("Hole Text").onChange(function() {
			//nothing yet
		});
	}

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
