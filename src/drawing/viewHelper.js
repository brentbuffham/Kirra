import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
import { camera, controls, renderer, objectCenter } from "./createScene.js";
import { Vector3, BufferGeometry, Line, LineBasicMaterial } from "three";

export const createViewHelper = () => {
	// Create the view helper
	const viewHelper = new ViewHelper(camera, renderer.domElement);
	viewHelper.controls = controls;
	viewHelper.controls.center = controls.target;

	// Set the controls target to objectCenter
	controls.target.copy(objectCenter.position);

	// Modify the negative axis colors
	applyNegativeAxisColorWithAlpha(viewHelper);

	// Draw lines to the negative axis labels
	drawLinesToNegativeAxes(viewHelper);

	// Match the view helper to the controls
	viewHelper.update();

	const div = document.createElement("div");
	div.id = "viewHelper";
	div.style.position = "absolute";
	div.style.right = "10px";
	div.style.bottom = "10px";
	div.style.height = "128px";
	div.style.width = "128px";
	viewHelper.setLabels("X", "Y", "Z");

	document.body.appendChild(div);

	div.addEventListener("pointerup", (event) => {
		viewHelper.handleClick(event);
		// Ensure the controls target is updated to objectCenter after clicking the view helper
		controls.target.copy(objectCenter.position);
		camera.lookAt(controls.target);
		camera.updateProjectionMatrix();
		controls.update();
	});

	return viewHelper;
};

function applyNegativeAxisColorWithAlpha(viewHelper) {
	const [posX, posY, posZ, negX, negY, negZ] = viewHelper.children.slice(3, 9);

	// Set the negative axes to the color of positive axes with 0.3 alpha
	negX.material = posX.material.clone();
	negY.material = posY.material.clone();
	negZ.material = posZ.material.clone();

	negX.material.opacity = 0.3;
	negY.material.opacity = 0.3;
	negZ.material.opacity = 0.3;

	negX.material.transparent = true;
	negY.material.transparent = true;
	negZ.material.transparent = true;
}

function drawLinesToNegativeAxes(viewHelper) {
	const [posX, posY, posZ, negX, negY, negZ] = viewHelper.children.slice(3, 9);

	const center = new Vector3(0, 0, 0);

	// Draw a line to each negative axis helper
	addLine(center, negX.position, negX.material.color, viewHelper);
	addLine(center, negY.position, negY.material.color, viewHelper);
	addLine(center, negZ.position, negZ.material.color, viewHelper);
}

function addLine(start, end, color, viewHelper) {
	const shortenedEnd = end.clone().multiplyScalar(0.75); // Scale the endpoint closer to the center

	const geometry = new BufferGeometry().setFromPoints([start, shortenedEnd]);

	const material = new LineBasicMaterial({
		color: color,
		transparent: true,
		opacity: 0.3
	});

	const line = new Line(geometry, material);
	viewHelper.add(line);
}
