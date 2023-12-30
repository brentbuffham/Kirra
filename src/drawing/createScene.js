//createScene.js
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { PerspectiveCamera } from "three";
import { OrthographicCamera } from "three";
import Stats from "stats.js";
import { GUI } from "lil-gui";
import { drawHoles } from "./entities/drawHoles";
import { handleFileUpload, handleFileUploadNoEvent } from "../file/import/fileUpload";

let controls, camera, scene, renderer, stats;

const gui = new GUI();

export const params = {
	cameraPerspective: false,
	upDirection: "Z",
	rotationAngle: 0,
	holeDisplay: "cylinder",
	holeText: "ID"
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
	const scene = new THREE.Scene();
	const renderer = new THREE.WebGLRenderer({ antialias: true }); // Add the antialias parameter here
	const canvas = document.querySelector("#canvas");
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector("#canvas").appendChild(renderer.domElement);

	const frustumSize = 100;
	const aspect = canvas.offsetWidth / canvas.offsetHeight;
	const cameraPerspective = new PerspectiveCamera(75, aspect, 0.1, 1000);
	const cameraOrthographic = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 1000);

	stats = new Stats();

	createLighting(scene);

	// Initialize camera with one of the cameras
	camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
	controls = new TrackballControls(camera, renderer.domElement);

	function setControls() {
		controls.rotateSpeed = 20.0;
		controls.zoomSpeed = 0.5;
		controls.panSpeed = 1;
		controls.dynamicDampingFactor = 0.3;
	}
	setControls();

	function animate() {
		requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
		stats.update();
	}

	const orthographicCameraProps = {
		frustumSize: 100
	};
	gui.close();
	// Function to handle the file input
	function triggerFileInput() {
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".csv";
		fileInput.style.display = "none"; // Hide the file input

		fileInput.onchange = e => {
			if (e.target.files && e.target.files[0]) {
				handleFileUploadNoEvent(e.target.files[0], { scene, camera });
			}
		};

		document.body.appendChild(fileInput); // Add file input to the document
		fileInput.click(); // Trigger the file input
		document.body.removeChild(fileInput); // Remove the file input after use
	}
	gui.add({ triggerFileUpload: triggerFileInput }, "triggerFileUpload").name("Upload CSV");

	gui.add(params, "cameraPerspective").name("Use Perspective Camera").onChange(function() {
		// Update camera when the perspective checkbox changes
		camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
		//store the current camera position
		const position = controls.object.position;
		//store the current look at target
		const target = controls.target;
		//when the camera is switched, reset the controls
		controls = new TrackballControls(camera, renderer.domElement);
		setControls();
		//set the controls to the stored position and target
		controls.object.position.copy(position);
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

	//NOT FUNCTIONING YET
	let holeObjects = []; // Array to keep track of hole objects

	function clearHoles() {
		console.log("Clearing holes");
		console.log(holeObjects);
		holeObjects.forEach(obj => scene.remove(obj));
		holeObjects = []; // Reset the array after removing objects
	}

	// Callback for redrawing holes
	function redrawHoles() {
		clearHoles(); // Clear existing holes
		console.log("Redrawing holes");
		for (const point of points) {
			drawHoles(scene, colour, point, 1000, 1);
			holeObjects.push(hole); // Store the new hole object
		}
	}
	///////////////////////
	//Only functions prior to upload of the csv file
	if (points !== null || points.length > 0) {
		const holeFolder = gui.addFolder("Hole Options");
		holeFolder.close();
		const holeOptions = ["cross", "circle", "diamond", "square", "cylinder"];
		holeFolder.add(params, "holeDisplay", holeOptions).name("Hole Display Type").onChange(redrawHoles);
		const holeTextOptions = ["Off", "ID", "Length"];
		holeFolder.add(params, "holeText", holeTextOptions).name("Hole Text").onChange(redrawHoles);
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
