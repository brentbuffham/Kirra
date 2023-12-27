//createScene.js
import * as THREE from "three";
import { OrthographicCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { getCentroid } from "../file/import/fileUpload";
import { drawDummy } from "./drawDummy";

export function createScene(data) {
	const scene = new THREE.Scene();
	const renderer = new THREE.WebGLRenderer();
	const canvas = document.querySelector("#canvas");
	renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
	document.querySelector("#canvas").appendChild(renderer.domElement);

	const frustumSize = 50;
	const aspect = window.innerWidth / window.innerHeight;
	const camera = new OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.001, 1000);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.25;
	controls.screenSpacePanning = false;

	function animate() {
		requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
	}

	animate();

	function drawPoints() {
		if (Array.isArray(data)) {
			for (const d of data) {
				drawDummy(d.startXLocation, d.startYLocation, d.startZLocation, 5);
				console.log("Data point: ", d);
			}
		} else {
			console.error("Data is not iterable", data);
		}
	}

	if (data) {
		drawPoints();
	}

	const { x, y, z } = getCentroid(data);
	console.log("Centroid: ", x, y, z);

	camera.position.set(x, y, z + 100);
	camera.lookAt(x, y, z);

	return { scene, camera, renderer };
}

export function updateScene(data, sceneObject) {
	const { scene, camera, renderer } = sceneObject;

	scene.children.forEach(object => {
		scene.remove(object);
	});

	for (const d of data) {
		drawDummy(d.startXLocation, d.startYLocation, d.startZLocation, 5);
		centroid = getCentroid(data);
		console.log("Centroid: ", centroid);
		console.log("Data point: ", d);
	}

	renderer.render(scene, camera);
}
