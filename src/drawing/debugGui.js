import { Vector3 } from "three";
import * as THREE from "three";
import { params, camera, scene } from "./createScene.js";
import { GUI } from "lil-gui";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { setArcBallControls } from "./setArcBallControls.js";
import { updateCameraType } from "./createScene.js";
//export const gui = new GUI();
const controllersMap = {};

export function debugGui(cameraPerspective, cameraOrthographic, controls, viewHelper, camera) {
	gui.close();
	controllersMap.worldXCenter = gui
		.add(params, "worldXCenter")
		.name("World X Center (Easting m)")
		.onChange(function (value) {
			if (isNaN(value)) {
				params.worldXCenter = 0;
			}
		});

	controllersMap.worldYCenter = gui
		.add(params, "worldYCenter")
		.name("World Y Center (Northing m)")
		.onChange(function (value) {
			if (isNaN(value)) {
				params.worldYCenter = 0;
			}
		});

	controllersMap.worldZCenter = gui
		.add(params, "worldZCenter")
		.name("World Z Center (RL m)")
		.onChange(function (value) {
			if (isNaN(value)) {
				params.worldZCenter = 0;
			}
		});
	controllersMap.cameraDistance = gui
		.add(params, "cameraDistance")
		.name("Camera Distance")
		.onChange(function (value) {
			if (isNaN(value)) {
				params.cameraDistance = 1000;
			}
		});

	gui.add(params, "debugComments")
		.name("Debug Comments")
		.onChange(function () {
			params.debugComments = params.debugComments ? true : false;
		});

	gui.add(params, "usePerspectiveCam")
		.name("Use Perspective Camera")
		.onChange(function (value) {
			updateCameraType();
		});

	const upOptions = ["X", "Y", "Z"];
	gui.add(params, "upDirection", upOptions)
		.name("Direction Axis")
		.onChange(function () {
			switch (params.upDirection) {
				case "Y":
					break;
				case "X":
					break;
				case "Z":
					break;
			}
			camera.updateProjectionMatrix();
		});

	let prevRotationAngle = params.rotationAngle;

	gui.add(params, "rotationAngle", 0, 360)
		.name("View Angle (°)")
		.onChange(function () {
			const deltaAngle = params.rotationAngle - prevRotationAngle;
			const deltaAngleRad = THREE.MathUtils.degToRad(deltaAngle);
			prevRotationAngle = params.rotationAngle;
			const axis = params.upDirection;
			rollCamera(axis, 0, controls);
			rollCamera(axis, deltaAngleRad, controls);
		});

	const cameraFolder = gui.addFolder("Camera Options");
	cameraFolder.close();

	const orthographicFolder = cameraFolder.addFolder("Orthographic Camera");
	const perspectiveFolder = cameraFolder.addFolder("Perspective Camera");

	perspectiveFolder
		.add(cameraPerspective, "fov", 0, 180)
		.name("Field of View")
		.onChange(function () {
			cameraPerspective.updateProjectionMatrix();
		});
	perspectiveFolder
		.add(cameraPerspective, "near", 0.1, 10000)
		.name("Near Plane")
		.onChange(function () {
			cameraPerspective.updateProjectionMatrix();
		});
	perspectiveFolder
		.add(cameraPerspective, "far", 0.1, 10000)
		.name("Far Plane")
		.onChange(function () {
			cameraPerspective.updateProjectionMatrix();
		});
	perspectiveFolder
		.add(controls, "rotateSpeed", 0.0, 50.0)
		.name("Rotate Speed")
		.onChange(function () {
			controls.update();
		});

	const orthographicCameraProps = {
		frustumSize: 100
	};

	orthographicFolder
		.add(orthographicCameraProps, "frustumSize", 0, 200)
		.name("Frustum Size")
		.onChange(function () {
			const canvas = document.querySelector("#canvas");
			const aspect = canvas.offsetWidth / canvas.offsetHeight;
			const frustumSize = orthographicCameraProps.frustumSize;
			cameraOrthographic.left = (-frustumSize * aspect) / 2;
			cameraOrthographic.right = (frustumSize * aspect) / 2;
			cameraOrthographic.top = frustumSize / 2;
			cameraOrthographic.bottom = -frustumSize / 2;
			cameraOrthographic.updateProjectionMatrix();
		});
	orthographicFolder
		.add(cameraOrthographic, "near", 0.1, 10000)
		.name("Near Plane")
		.onChange(function () {
			cameraOrthographic.updateProjectionMatrix();
		});
	orthographicFolder
		.add(cameraOrthographic, "far", 0.1, 10000)
		.name("Far Plane")
		.onChange(function () {
			cameraOrthographic.updateProjectionMatrix();
		});

	const textDisplayFolder = gui.addFolder("Holes Text Display Options");
	textDisplayFolder.open();
	textDisplayFolder
		.add(params, "holeNameDisplay")
		.name("Hole Name")
		.onChange(function () {
			params.holeNameDisplay = params.holeNameDisplay ? true : false;
		});
	textDisplayFolder
		.add(params, "holeLengthDisplay")
		.name("Hole Length")
		.onChange(function () {
			params.holeLengthDisplay = params.holeLengthDisplay ? true : false;
		});
	textDisplayFolder
		.add(params, "holeDiameterDisplay")
		.name("Hole Diameter")
		.onChange(function () {
			params.holeDiameter = params.holeDiameter ? true : false;
		});

	const wireframeSolidTransparentTexture = gui.addFolder("Holes Text Display Options");

	const objOptions = {
		Solid: "Solid",
		Transparent: "Transparent",
		Wireframe: "Wireframe"
	};
	wireframeSolidTransparentTexture.open();
	wireframeSolidTransparentTexture
		.add(params, "wireframeSolidTaranparentTexture", objOptions)
		.name("OBJ Display Options")
		.onChange(function () {
			scene.traverse(function (child) {
				if (child instanceof THREE.Mesh) {
					switch (params.wireframeSolidTransparentTexture) {
						case "Invisible":
							child.material.wireframe = false;
							child.material = new THREE.MeshBasicMaterial({ color: child.material.color, wireframe: false, opacity: 0 });
							break;
						case "Wireframe":
							child.material.wireframe = true;
							child.material = new THREE.MeshBasicMaterial({ color: child.material.color, wireframe: true });
							break;
						case "Transparent":
							child.material.wireframe = false;
							child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: true, transparent: true, opacity: 0.5 });
							break;
						case "Solid":
							child.material.wireframe = false;
							child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: false });
							break;
						case "Texture":
							child.material.wireframe = false;
							child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: false, map: child.material.map });
						default:
							child.material.wireframe = false;
							child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: false });
							break;
					}
					child.material.needsUpdate = true;
				}
			});
		});
}

function rollCamera(axis, radians, controls) {
	let vector = new THREE.Vector3(0, 0, 1);
	if (axis === "Z") {
		vector = new THREE.Vector3(0, 0, 1);
	} else if (axis === "Y") {
		vector = new THREE.Vector3(0, 1, 0);
	} else if (axis === "X") {
		vector = new THREE.Vector3(1, 0, 0);
	} else {
		vector = new THREE.Vector3(0, 0, 1);
	}
	if (controls instanceof ArcballControls) {
		const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
		const quaternion = new THREE.Quaternion();
		quaternion.setFromAxisAngle(vector, radians);
		direction.applyQuaternion(quaternion);
		const distance = camera.position.distanceTo(controls.target);
		const newPosition = new THREE.Vector3().addVectors(controls.target, direction.multiplyScalar(distance));
		camera.position.copy(newPosition);
		camera.up.applyQuaternion(quaternion);
		camera.lookAt(controls.target);
		controls.update();
	} else if (controls instanceof TrackballControls) {
		const position = controls.object.position.clone();
		const target = controls.target.clone();
		const cameraMatrix = new THREE.Matrix4();
		cameraMatrix.lookAt(position, target, controls.object.up);
		const cameraLocalZAxis = vector.applyMatrix4(cameraMatrix);
		controls.object.up.applyAxisAngle(cameraLocalZAxis, radians);
		controls.update();
	}
}

export { controllersMap };
