// createScene.js
import * as THREE from "three";
import { AmbientLight, ArrowHelper, DirectionalLight, Object3D, OrthographicCamera, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { debugGui, gui } from "./debugGui.js";
import { setArcBallControls } from "./setArcBallControls.js";
import { bindingKeys } from "./sceneKeybinds.js";
import { createViewHelper } from "./viewHelper.js";
import { onWindowResize } from "./ResizeScene.js";
import { sceneConfig } from "./sceneConfig.js";

//load in local starge for the world origin settings
const worldOriginSettings = JSON.parse(localStorage.getItem("WorldOriginSettings"));

export let camera, scene, controls;
export let params = {
	worldXCenter: worldOriginSettings && worldOriginSettings.worldXCenter !== null ? worldOriginSettings.worldXCenter : 0,
	worldYCenter: worldOriginSettings && worldOriginSettings.worldYCenter !== null ? worldOriginSettings.worldYCenter : 0,
	worldZCenter: worldOriginSettings && worldOriginSettings.worldZCenter !== null ? worldOriginSettings.worldZCenter : 0,
	cameraDistance: worldOriginSettings && worldOriginSettings.cameraDistance !== null ? worldOriginSettings.cameraDistance : 1000,
	usePerspectiveCam: false,
	upDirection: "Z",
	rotationAngle: 0,
	holeDisplay: "mesh-cross",
	holeNameDisplay: true,
	holeLengthDisplay: false,
	holeDiameterDisplay: false,
	wireframeSolidTransparentTexture: "solid",
	debugComments: true
};

export let renderer, clock;
export let transformControls;
export let cameraPerspective, cameraOrthographic;

function createLighting() {
	const ambientLight = new AmbientLight(0xffffff, sceneConfig.ambientIntensity);
	ambientLight.userData = { entityType: "light", lightType: "ambient" };
	scene.add(ambientLight);
	scene.background = new THREE.Color(sceneConfig.sceneBackground);
	const directionalLight1 = new DirectionalLight(0xffffff, sceneConfig.lightIntensity);
	directionalLight1.position.set(sceneConfig.directionalLightPosition.x, sceneConfig.directionalLightPosition.y, sceneConfig.directionalLightPosition.z);
	const directionalLight2 = new DirectionalLight(0xffffff, sceneConfig.lightIntensity);
	directionalLight2.position.set(-2 * sceneConfig.directionalLightPosition.x, sceneConfig.directionalLightPosition.y, sceneConfig.directionalLightPosition.z);
	directionalLight1.userData = { entityType: "light", lightType: "directional" };
	directionalLight2.userData = { entityType: "light", lightType: "directional" };
	scene.add(directionalLight1);
	scene.add(directionalLight2);
}

function setCamera(aspect) {
	const { frustumSize } = sceneConfig;

	cameraPerspective = new PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.001, 10000); // don't use a NEGATIVE or ZERO near value it will break the camera
	cameraOrthographic = new OrthographicCamera((-frustumSize * aspect) / 2, (frustumSize * aspect) / 2, frustumSize / 2, -frustumSize / 2, -10000, 10000);

	const cameraPosition = new Vector3(0, 0, params.cameraDistance);
	camera = params.usePerspectiveCam ? cameraPerspective : cameraOrthographic;
	return { cameraPerspective, cameraOrthographic };
}

export function updateCameraType(sceneX, sceneY, sceneZ) {
	const position = camera.position.clone();
	console.log("Position: ", position);
	const target = controls.target.clone();
	const up = camera.up.clone();

	// Update camera aspect ratio
	const aspect = window.innerWidth / window.innerHeight;
	cameraPerspective.aspect = aspect;
	cameraPerspective.updateProjectionMatrix();
	cameraOrthographic.aspect = aspect;
	cameraOrthographic.updateProjectionMatrix();

	// Swap camera type
	camera = params.usePerspectiveCam ? cameraPerspective : cameraOrthographic;

	// Dispose and reinitialize controls
	controls.dispose();
	controls = new ArcballControls(camera, renderer.domElement, scene);
	viewHelper.controls = controls;
	controls.rotateSpeed = 1.0;
	controls.enableRotate = true;
	controls.enableZoom = true;
	controls.enablePan = true;
	controls.zoomSpeed = 1;
	controls.panSpeed = 1;
	controls.cursorZoom = true;
	controls.enableGrid = true;
	controls.activateGizmos(false);
	controls.setGizmosVisible(false);

	// Maintain camera state
	camera.position.copy(position);
	//controls.target.copy(target);
	controls.target.copy(new Vector3(sceneX, sceneY, sceneZ));

	camera.up.copy(up);
	//camera.lookAt(target);
	camera.lookAt(new Vector3(sceneX, sceneY, sceneZ));
	controls.update();
	camera.updateProjectionMatrix();

	// Update camera userData
	camera.userData = {
		entityType: "camera",
		isPerspective: params.usePerspectiveCam,
		isOrthographic: !params.usePerspectiveCam,
		up: camera.up,
		cameraLookAt: new Vector3(sceneX, sceneY, sceneZ),
		controlsTarget: new Vector3(sceneX, sceneY, sceneZ)
	};

	console.log("Camera updated:", camera);
	console.log("Controls updated:", controls);
	console.log("Camera User Data: ", camera.userData);

	bindingKeys(camera, objectCenter, controls, viewHelper, transformControls);
}

export let objectCenter = new Object3D();
export function createScene(points) {
	console.log("createScene(points)", points);
	scene = new Scene();
	const canvasElement = document.querySelector("#canvas");

	let aspect = canvasElement.offsetWidth / canvasElement.offsetHeight;
	clock = new THREE.Clock();

	if (points === null || points.length === 0) {
		objectCenter.position.set(0, 0, 0);
	}
	// Create an ArrowHelper with 50% opacity
	function createTransparentArrowHelper(dir, origin, length, hex, headLength, headWidth) {
		const arrowHelper = new THREE.ArrowHelper(dir, origin, length, hex, headLength, headWidth);

		// Set the opacity to 50% for both the shaft and the head of the arrow
		arrowHelper.line.material.transparent = true;
		arrowHelper.line.material.opacity = 0.5;

		arrowHelper.cone.material.transparent = true;
		arrowHelper.cone.material.opacity = 0.5;

		return arrowHelper;
	}

	//const objectCenter = new THREE.Object3D();

	objectCenter.add(createTransparentArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 10, 0xff0000, 5, 2));
	objectCenter.add(createTransparentArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 10, 0x00ff00, 5, 2));
	objectCenter.add(createTransparentArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 10, 0x0000ff, 5, 2));

	objectCenter.name = "objectCenter";
	scene.add(objectCenter);

	let { cameraOrthographic, cameraPerspective } = setCamera(aspect);

	renderer = new WebGLRenderer({
		antialias: true,
		depth: true,
		precision: "highp",
		powerPreference: "high-performance",
		stencil: false
	});
	renderer.setSize(canvasElement.offsetWidth, canvasElement.offsetHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.autoClear = false;
	canvasElement.appendChild(renderer.domElement);

	controls = new ArcballControls(camera, renderer.domElement, scene);

	createLighting(scene);

	let position = new Vector3(0, 0, 0);
	camera.position.set(0, 0, parseFloat(params.cameraDistance)); // Corrected here
	camera.lookAt(0, 0, 0);
	camera.up.set(0, 1, 0);
	controls.target.set(position.x, position.y, position.z);
	camera.position.copy(position);
	controls.target.copy(objectCenter.position);
	controls.update();

	let viewHelper = createViewHelper();

	setArcBallControls(controls, viewHelper);

	bindingKeys(camera, objectCenter, controls, viewHelper, transformControls);

	debugGui(cameraPerspective, cameraOrthographic, controls, viewHelper, camera);

	if (points !== null && points.length > 0) {
		const holeFolder = gui.addFolder("Hole Text Display Options");
		holeFolder.close();
		holeFolder
			.add(params, "holeNameDisplay")
			.name("Hole Name")
			.onChange(function () {});
		holeFolder
			.add(params, "holeLengthDisplay")
			.name("Hole Length")
			.onChange(function () {});
		holeFolder
			.add(params, "holeDiameterDisplay")
			.name("Hole Diameter")
			.onChange(function () {});
	}

	animate();

	function animate() {
		requestAnimationFrame(animate);
		renderer.clear();
		const delta = clock.getDelta();

		if (viewHelper.animating) viewHelper.update(delta);

		renderer.render(scene, camera);
		viewHelper.render(renderer);
	}

	if (params.debugComments) {
		console.log("Initialized canvas:", { scene, camera, renderer });
	}

	return { scene, camera, renderer };
}

onWindowResize();
