//createScene.js
//consistently import THREE
import * as THREE from "three";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { ArrowHelper } from "three";
import { AxesHelper } from "three";
import { BoxGeometry } from "three";
import { BoxHelper } from "three";
import { drawHoles } from "./entities/drawHoles";
import { getCentroid } from "./helpers/getCentroid";
import { GridHelper } from "three";
import { Group } from "three";
import { handleFileUpload, handleFileUploadNoEvent } from "../file/import/fileUpload";
import { Mesh } from "three";
import { Object3D } from "three";
import { OrthographicCamera } from "three";
import { PerspectiveCamera } from "three";
import { Plane } from "three";
import { PlaneHelper } from "three";
import { GUI } from "lil-gui";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { Vector3 } from "three";
import { changeHoleMesh } from "./helpers/changeHoleMesh";
import { WireframeGeometry } from "three";
import { SphereGeometry } from "three";
import { CircleGeometry } from "three";

let controls, camera, scene, renderer, targetObject;

const gui = new GUI();
let frustumSize = 100;

export const params = {
	cameraPerspective: false,
	upDirection: "Z",
	rotationAngle: 0,
	holeDisplay: "meshCylinder",
	holeText: "ID",
	debugComments: true
	// holeColour: "white",
	// holeSubdrillColour: "red"
};

export { controls };

function createLighting(scene) {
	//create ambient light
	const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
	scene.add(ambientLight);
	//create directional light
	const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
	directionalLight.position.set(0, 500, 500);
	scene.add(directionalLight);
}

export function createScene(points) {
	scene = new THREE.Scene();
	renderer = new THREE.WebGLRenderer({ antialias: true }); // Add the antialias parameter here
	const canvas = document.querySelector("#canvas");
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector("#canvas").appendChild(renderer.domElement);

	let aspect = canvas.offsetWidth / canvas.offsetHeight;
	const cameraPerspective = new PerspectiveCamera(75, aspect, 0.1, 1000);
	const cameraOrthographic = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 1000);
	createLighting(scene);

	// Initialize camera with one of the cameras
	camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
	controls = new TrackballControls(camera, renderer.domElement);
	controls = new ArcballControls(camera, renderer.domElement);

	//create Gizmos for the ArcballControls
	const gizmos = new Object3D();
	gizmos.add(new AxesHelper(30));
	gizmos.add(new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0, 0), 30, 0xff0000, 5, 2));
	gizmos.add(new ArrowHelper(new Vector3(0, 1, 0), new Vector3(0, 0, 0), 30, 0x00ff00, 5, 2));
	gizmos.add(new ArrowHelper(new Vector3(0, 0, 1), new Vector3(0, 0, 0), 30, 0x0000ff, 5, 2));
	//add new grid helper on the XY plane
	const gridXY = new GridHelper(1000, 50, 0xffffff, 0x808080);
	gridXY.rotation.x = Math.PI / 2;

	gizmos.add(gridXY);
	scene.add(gizmos);

	function setControls() {
		controls.rotateSpeed = 20.0;
		controls.zoomSpeed = 1;
		controls.panSpeed = 1;
		//controls.dynamicDampingFactor = 0.3;

		//arcball controls
		controls.cursorZoom = true;
	}
	setControls();

	function animate() {
		requestAnimationFrame(animate);
		gizmos.position.set(controls.target.x, controls.target.y, controls.target.z);
		controls.update();
		renderer.render(scene, camera);
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
					//const position = new Vector3(controls.target.x, controls.target.y, controls.target.z + 100);
					const position = new Vector3(0, 0, 0 + 200);

					//reset the camera rotation to 0 (Y+ is at the top of the canvas X+ to the Right and Z+ toward the camera)
					if (controls instanceof TrackballControls) {
						controls.object.up.set(0, 1, 0);
					}
					if (controls instanceof ArcballControls) {
						camera.position.copy(position);
						camera.lookAt(0, 0, 0);
						camera.up.set(0, 1, 0);
					}
				}
			},
			"resetCamera"
		)
		.name("Reset Camera");

	gui.add(params, "cameraPerspective").name("Use Perspective Camera").onChange(function() {
		// Update camera when the perspective checkbox changes
		camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
		//store the current camera position
		//const position = controls.object.position; //Trackball Controls
		const position = new Vector3(0, 0, 0 + 200);
		//store the current look at target
		const target = controls.target;
		//when the camera is switched, reset the controls
		controls = new TrackballControls(camera, renderer.domElement);
		controls = new ArcballControls(camera, renderer.domElement);
		setControls();
		//set the controls to the stored position and target
		//controls.object.position.copy(position);
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
	//Only functions prior to upload of the csv file
	if (points !== null || points.length > 0) {
		const holeFolder = gui.addFolder("Hole Options");
		holeFolder.close();
		const holeOptions = ["meshCross", "meshCircle", "meshDiamond", "meshSquare", "meshCylinder", "lineCross", "lineCircle", "lineDiamond", "lineSquare"];
		holeFolder.add(params, "holeDisplay", holeOptions).name("Hole Display Type").onChange(function() {
			// changeHoleMesh(scene, points);
			// if (params.debugComments) {
			// 	scene.traverse(function(object) {
			// 		console.log(object);
			// 	});
			// 	console.log("holeDisplay: " + params.holeDisplay);
			// }
		});
		const holeTextOptions = ["Off", "ID", "Length"];
		holeFolder.add(params, "holeText", holeTextOptions).name("Hole Text").onChange(function() {
			// changeHoleMesh(scene, points);
			// if (params.debugComments) {
			// 	console.log("holeText: " + params.holeText);
			// }
		});
		// const holeColourOptions = ["Random", "White", "Red", "Green", "Blue"];
		// holeFolder.add(params, "holeColour", holeColourOptions).name("Hole Colour").onChange(redrawHoles);
		// const subdrilColourOptions = ["Random", "White", "Red", "Green", "Blue"];
		// holeFolder.add(params, "holeSubdrillColour", subdrilColourOptions).name("Subdrill Colour").onChange(redrawHoles);
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
	if (camera instanceof THREE.OrthographicCamera) {
		camera.left = -frustumSize * aspect / 2;
		camera.right = frustumSize * aspect / 2;
		camera.top = frustumSize / 2;
		camera.bottom = -frustumSize / 2;
	} else if (camera instanceof THREE.PerspectiveCamera) {
		camera.aspect = aspect;
	}
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onWindowResize, false);
