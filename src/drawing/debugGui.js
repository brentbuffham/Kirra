import { Vector3 } from "three";
import * as THREE from "three";
import { params, camera, scene } from "./createScene.js";
import { GUI } from "lil-gui";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { setArcBallControls } from "./setArcBallControls.js";
import { updateCameraType } from "./createScene.js";

export const gui = new GUI();
export function debugGui(cameraPerspective, cameraOrthographic, controls, viewHelper, camera) {
	gui.close();
	gui.add(params, "debugComments").name("Debug Comments").onChange(function() {
		// update the debug comments when the checkbox changes
		params.debugComments = params.debugComments ? true : false;
	});

	gui.add(params, "usePerspectiveCam").name("Use Perspective Camera").onChange(function(value) {
		updateCameraType(); // This now handles the camera switching logic
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
		rollCamera(axis, 0, controls);
		rollCamera(axis, deltaAngleRad, controls);
	});

	const cameraFolder = gui.addFolder("Camera Options");
	cameraFolder.close();

	const orthographicFolder = cameraFolder.addFolder("Orthographic Camera");
	const perspectiveFolder = cameraFolder.addFolder("Perspective Camera");

	perspectiveFolder.add(cameraPerspective, "fov", 0, 180).name("Field of View").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(cameraPerspective, "near", 0.1, 10000).name("Near Plane").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(cameraPerspective, "far", 0.1, 10000).name("Far Plane").onChange(function() {
		cameraPerspective.updateProjectionMatrix();
	});
	perspectiveFolder.add(controls, "rotateSpeed", 0.0, 50.0).name("Rotate Speed").onChange(function() {
		controls.update();
	});

	const orthographicCameraProps = {
		frustumSize: 100
	};

	orthographicFolder.add(orthographicCameraProps, "frustumSize", 0, 200).name("Frustum Size").onChange(function() {
		const canvas = document.querySelector("#canvas");
		const aspect = canvas.offsetWidth / canvas.offsetHeight;
		const frustumSize = orthographicCameraProps.frustumSize;
		cameraOrthographic.left = -frustumSize * aspect / 2;
		cameraOrthographic.right = frustumSize * aspect / 2;
		cameraOrthographic.top = frustumSize / 2;
		cameraOrthographic.bottom = -frustumSize / 2;
		cameraOrthographic.updateProjectionMatrix();
	});
	orthographicFolder.add(cameraOrthographic, "near", 0.1, 10000).name("Near Plane").onChange(function() {
		cameraOrthographic.updateProjectionMatrix();
	});
	orthographicFolder.add(cameraOrthographic, "far", 0.1, 10000).name("Far Plane").onChange(function() {
		cameraOrthographic.updateProjectionMatrix();
	});

	const textDisplayFolder = gui.addFolder("Text Display Options");
	textDisplayFolder.close();
	const textOptions = ["Off", "ID", "Length"];
	textDisplayFolder.add(params, "holeText", textOptions).name("Hole Text").onChange(function() {
		// Update the hole text display when the dropdown changes
		params.holeText = params.holeText;
	});
}

function rollCamera(axis, radians, controls) {
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
