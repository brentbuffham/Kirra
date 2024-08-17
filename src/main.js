//main.js
// Import the crappy boostrap stuff
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import * as bootstrap from "bootstrap"; // Import Bootstrap as a namespace

window.bootstrap = bootstrap; // Attach Bootstrap to the window object
// Import the necessary functions from the other files
import "./style.css";
import { createLilGuiFileUpload, handleFileUploadNoEvent, points } from "./file/import/fileK3DUpload.js";
import { preloadFont } from "./helpers/loadGlobalFont.js";
import { Vector3, Box3 } from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { controls, createScene, objectCenter, params, updateCameraType } from "./drawing/createScene.js";
import { getCentroid } from "./helpers/getCentroid.js";
import { drawDummys, drawHoles, drawHoleText } from "./entities/drawHoles.js";
import { handleOBJNoEvent } from "./file/import/fileOBJLoader.js";
import { resetCameraView, calculateBoundingBox } from "./helpers/resetCameraView.js";
import { createMainView } from "./views/viewMain.js";
import { getSceneBoundingBox } from "./helpers/resetCameraView.js";
import * as THREE from "three";
import { bindListenerToImportK3DButton } from "./buttons/csv/openHolesButton.js";
import { bindListenerToImportCSVButton } from "./buttons/csv/importHolesButton.js";
import { bindListenerToImportOBJButton } from "./buttons/mesh/importOBJButton.js";
import { bindListenerToImportDXFButton } from "./buttons/autocad/importDXFButton.js";
import { bindListenerToImportPointCloudButton } from "./buttons/csv/importPointCloudButton.js";
import { bindListenerToWorldOriginSettingsButton } from "./settings/worldOriginSetting.js";
import { bindListenerToClearMemoryButton } from "./buttons/memory/clearMemoryButton.js";
import { bindListenerToResetCameraViewButton } from "./buttons/camera/resetCameraButton.js";
import { bindListenerToObjMaterialCycleButton } from "./buttons/mesh/objMaterialCycleButton.js";
import { bindListenerToCameraTypeCycleButton } from "./buttons/camera/cameraTypeCycleButton.js";

createMainView();

const canvas = createScene(points);
const { scene, camera, renderer } = canvas;

preloadFont(); // Preload the font

export const counter = {
	cloudPointFileCount: 0,
	csvFileCount: 0,
	k3DFileCount: 0,
	objFileCount: 0
};

//Button Binding
bindListenerToImportK3DButton();
bindListenerToImportCSVButton();
bindListenerToImportOBJButton(canvas);
bindListenerToImportDXFButton(canvas);
bindListenerToImportPointCloudButton();
bindListenerToWorldOriginSettingsButton();
bindListenerToClearMemoryButton();
bindListenerToResetCameraViewButton(camera, controls, scene, params);
bindListenerToObjMaterialCycleButton(scene, params);
bindListenerToCameraTypeCycleButton(scene, camera, controls, params);

function getCurrentPoints() {
	//Get all the holes from the localStorage.
	// the holes are stored in k3DStore0, k3DStore1, k3DStore2, ... etc. and in csvBlast0, csvBlast1, csvBlast2, ... etc.
	//Join them together in one array called currentPoints
	const currentPoints = [];
	for (let i = 0; i < localStorage.length; i++) {
		if (localStorage.key(i).includes("k3DBlastStore") || localStorage.key(i).includes("csvBlastStore")) {
			const tempPoints = JSON.parse(localStorage.getItem(localStorage.key(i)));
			currentPoints.push(...tempPoints);
		}
	}
	return currentPoints;
}

// Function to update the hole display - remove this in future.
function updateHoleDisplay() {
	const currentPoints = getCurrentPoints();
	document.querySelector("#info-label").textContent = "Holes in Scene: " + currentPoints.length + " - Current Test Display: " + params.holeDisplay;
	//Define the hole options
	const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "mesh-cube", "line-cross", "outline-circle", "filled-circle", "line-diamond", "line-square", "line-triangle"];
	const currentHoleDisplay = params.holeDisplay;

	const currentIndex = holeOptions.indexOf(currentHoleDisplay);
	const nextIndex = (1 + currentIndex) % holeOptions.length;
	params.holeDisplay = holeOptions[nextIndex];

	const holeObjectsArray = [];
	let dummyholescount = 0;
	scene.traverse(function (object) {
		if (object.userData.entityType === "hole" && object.userData.entityType !== "dummy") {
			holeObjectsArray.push(object);
		}
	});

	for (const hole of holeObjectsArray) {
		scene.remove(hole);
	}

	let x, y, z;
	if (params.worldXCenter === 0 && params.worldYCenter === 0 && params.worldZCenter === 0) {
		(x = 0), (y = 0), (z = 0);
	} else {
		x = params.worldXCenter || 0;
		y = params.worldYCenter || 0;
		z = 0; //No offset for Z
	}
	if (currentPoints.length > 0) {
		const colour = 0xffffff;
		currentPoints.forEach((point) => {
			const tempPoint = {
				pointID: point.pointID,
				startXLocation: point.startXLocation - x,
				startYLocation: point.startYLocation - y,
				startZLocation: point.startZLocation - z,
				endXLocation: isNaN(point.endXLocation) ? null : point.endXLocation - x,
				endYLocation: isNaN(point.endYLocation) ? null : point.endYLocation - y,
				endZLocation: isNaN(point.endZLocation) ? null : point.endZLocation - z,
				diameter: point.diameter,
				subdrill: point.subdrill,
				shapeType: point.endXLocation != null || point.endYLocation != null || point.endZLocation != null ? params.holeDisplay : "mesh-dummy",
				holeColour: point.holeColour
			};
			if (tempPoint.diameter > 0) {
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, params.holeDisplay);
				console.log("diameter is greater then 0");
			} else if (isNaN(tempPoint.diameter)) {
				shapeType = "mesh-cube";
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, shapeType);
				console.log("diameter is not a number");
			} else if (endXLocation != null || endYLocation != null || endZLocation != null) {
				drawDummys(scene, "cyan", tempPoint);
				console.log("of type dummy");
			}

			document.querySelector("#info-label").textContent = "Current Hole Display: " + params.holeDisplay;
		});
	} else {
		console.log("Not enough points to draw holes - no end points");
	}

	if (renderer) {
		console.log("Rendering scene with updated hole display"); // Debug statement
		renderer.render(scene, camera);
	} else {
		console.error("Renderer is not initialized.");
	}
}

/**
 * Updates the scene by removing existing hole objects and rendering new ones based on the provided parameters.
 */
function updateScene() {
	const currentPoints = getCurrentPoints();
	document.querySelector("#info-label").textContent = "Holes in Scene: " + currentPoints.length;
	console.clear();
	console.log("Objects in scene BEFORE updateScene():\n", scene.children);
	// Gather all objects of entity type "hole" into an array
	const holeObjectsArray = [];
	const holeNameTextArray = [];
	const holeLengthTextArray = [];
	const holeDiameterTextArray = [];

	scene.traverse(function (object) {
		if (object.userData.entityType === "hole") {
			holeObjectsArray.push(object);
		}
		if (object.userData.entityType === "holeNameText") {
			holeNameTextArray.push(object);
		}
		if (object.userData.entityType === "holeLengthText") {
			holeLengthTextArray.push(object);
		}
		if (object.userData.entityType === "holeDiameterText") {
			holeDiameterTextArray.push(object);
		}
	});

	// Remove the collected hole objects from the scene
	for (const hole of holeObjectsArray) {
		scene.remove(hole);
	}
	for (const holeNameText of holeNameTextArray) {
		scene.remove(holeNameText);
	}
	for (const holeLengthText of holeLengthTextArray) {
		scene.remove(holeLengthText);
	}
	for (const holeDiameterText of holeDiameterTextArray) {
		scene.remove(holeDiameterText);
	}

	let x, y, z;
	if (params.worldXCenter === 0 && params.worldYCenter === 0 && params.worldZCenter === 0) {
		(x = 0), (y = 0), (z = 0);
	} else {
		x = params.worldXCenter || 0;
		y = params.worldYCenter || 0;
		z = 0; //No offset for Z
	}

	if (currentPoints.length > 0) {
		const colour = 0xffffff;
		currentPoints.forEach((point) => {
			const tempPoint = {
				pointID: point.pointID,
				startXLocation: point.startXLocation - x,
				startYLocation: point.startYLocation - y,
				startZLocation: point.startZLocation - z,
				endXLocation: isNaN(point.endXLocation) ? null : point.endXLocation - x,
				endYLocation: isNaN(point.endYLocation) ? null : point.endYLocation - y,
				endZLocation: isNaN(point.endZLocation) ? null : point.endZLocation - z,
				diameter: point.diameter,
				subdrill: point.subdrill,
				shapeType: point.shapeType,
				holeColour: point.holeColour
			};

			console.log("Inside updateScene drawing holes");
			if (point.endXLocation !== null && point.endYLocation !== null && point.endZLocation !== null && point.diameter !== null) {
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
			}
		});
	} else {
		console.log("Not enough points to draw holes - no end points");
	}

	// Render the scene with updated parameters
	if (renderer) {
		console.log("Rendering scene with updated parameters");
		renderer.render(scene, camera);
	} else {
		console.error("Renderer is not initialized.");
	}
	console.log("Objects in scene AFTER updateScene():\n", scene.children);
}

// Attach event listener to the button
document.querySelector("#swap-all-hole-visuals").addEventListener("click", updateHoleDisplay);

//function to toggle the hole name display
document.querySelector("#hole-name-on-off").addEventListener("click", () => {
	params.holeNameDisplay = !params.holeNameDisplay;

	updateScene();
	if (params.holeNameDisplay) {
		document.querySelector("#info-label").textContent = "Hole Name Display On";
		// Redraw the scene with hole name display on
	} else {
		document.querySelector("#info-label").textContent = "Hole Name Display Off";
		// Redraw the scene with hole name display off
	}
});

//function to toggle the hole Length display
document.querySelector("#hole-length-on-off").addEventListener("click", () => {
	params.holeLengthDisplay = !params.holeLengthDisplay;
	updateScene();
	if (params.holeLengthDisplay) {
		document.querySelector("#info-label").textContent = "Hole Length Display On";
		// Redraw the scene with hole length display on
	} else {
		document.querySelector("#info-label").textContent = "Hole Length Display Off";
		// Redraw the scene with hole length display off
	}
});

//function to toggle the hole Diameter display
document.querySelector("#hole-diameter-on-off").addEventListener("click", () => {
	params.holeDiameterDisplay = !params.holeDiameterDisplay;
	updateScene();
	if (params.holeDiameterDisplay) {
		document.querySelector("#info-label").textContent = "Hole Diameter Display On";
		// Redraw the scene with hole diameter display on
	} else {
		document.querySelector("#info-label").textContent = "Hole Diameter Display Off";
		// Redraw the scene with hole diameter display off
	}
});

createLilGuiFileUpload(canvas);
