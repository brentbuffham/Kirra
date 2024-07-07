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

export let camera, scene, controls;
export const params = {
	worldXCenter: 478786,
	worldYCenter: 6772350,
	worldZCenter: 390,
	usePerspectiveCam: false,
	upDirection: "Z",
	rotationAngle: 0,
	holeDisplay: "mesh-cross",
	holeNameDisplay: true,
	holeLengthDisplay: false,
	holeDiameterDisplay: false,
	debugComments: true
};

export let renderer, clock;
export let transformControls;
export let cameraPerspective, cameraOrthographic;

function createLighting() {
	const ambientLight = new AmbientLight(0xffffff, 0.5);
	scene.add(ambientLight);
	const directionalLight = new DirectionalLight(0xffffff, 2);
	directionalLight.position.set(0, 500, 500);
	scene.add(directionalLight);
}

function setCamera(aspect) {
	const { frustumSize } = sceneConfig;

	cameraPerspective = new PerspectiveCamera(35, window.innerWidth / window.innerHeight, -10000, 10000);
	cameraOrthographic = new OrthographicCamera((-frustumSize * aspect) / 2, (frustumSize * aspect) / 2, frustumSize / 2, -frustumSize / 2, -10000, 10000);

	camera = params.usePerspectiveCam ? cameraPerspective : cameraOrthographic;
	return { cameraPerspective, cameraOrthographic };
}

export function updateCameraType() {
	const position = camera.position.clone();
	const target = controls.target.clone();
	const up = camera.up.clone();

	const aspect = window.innerWidth / window.innerHeight;
	camera = params.usePerspectiveCam ? cameraPerspective : cameraOrthographic;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	controls.dispose();
	controls = new ArcballControls(camera, renderer.domElement, scene);
	viewHelper.controls = controls;
	controls.rotateSpeed = 1.0;
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

	camera.position.copy(position);
	controls.target.copy(target);
	camera.up.copy(up);
	camera.lookAt(target);

	console.log("Camera updated:", camera);
	console.log("Controls updated:", controls);

	bindingKeys(camera, objectCenter, controls, viewHelper, transformControls);
}

const objectCenter = new Object3D();
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

	let position = new Vector3(0, 0, 0 + 200);
	camera.position.copy(position);
	camera.lookAt(0, 0, 0);
	camera.up.set(0, 1, 0);
	controls.target.set(0, 0, 0);
	camera.position.copy(position);
	controls.target.copy(objectCenter.position);

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
