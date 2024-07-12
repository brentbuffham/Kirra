import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
import { camera, controls, renderer } from "./createScene.js";

export const createViewHelper = () => {
	// Create the view helper

	const viewHelper = new ViewHelper(camera, renderer.domElement);
	viewHelper.controls = controls;
	viewHelper.controls.center = controls.target;

	//match the view helper to the controls
	viewHelper.update();

	const div = document.createElement("div");
	div.id = "viewHelper";
	div.style.position = "absolute";
	div.style.right = "10px";
	div.style.bottom = "10px";
	div.style.height = "128px";
	div.style.width = "128px";
	div.style.lables = "visible";

	document.body.appendChild(div);

	div.addEventListener("pointerup", (event) => viewHelper.handleClick(event));

	return viewHelper;
};
