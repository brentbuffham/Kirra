//main.js
// Import the crappy boostrap stuff
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import * as bootstrap from "bootstrap"; // Import Bootstrap as a namespace

window.bootstrap = bootstrap; // Attach Bootstrap to the window object
// Import the necessary functions from the other files
import "./style.css";
import { createLilGuiFileUpload, handleFileUploadNoEvent, points } from "./file/import/fileK3DUpload.js";
import { preloadFont } from "./drawing/helpers/loadGlobalFont.js";
import { Vector3, Box3 } from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { controls, createScene, objectCenter, params, updateCameraType } from "./drawing/createScene.js";
import { getCentroid } from "./drawing/helpers/getCentroid.js";
import { drawDummys, drawHoles, drawHoleText } from "./drawing/entities/drawHoles.js";
import { handleOBJNoEvent } from "./file/import/fileOBJLoader.js";
import { bindListenerToImportK3DButton } from "./import/csv/openHolesButton.js";
import { bindListenerToImportCSVButton } from "./import/csv/importHolesButton.js";
import { bindListenerToImportOBJButton } from "./import/mesh/importOBJButton.js";
import { bindListenerToImportDXFButton } from "./import/autocad/importDXFButton.js";
import { bindListenerToImportPointCloudButton } from "./import/csv/importPointCloudButton.js";
import { bindListenerToWorldOriginSettingsButton } from "./settings/worldOriginSetting.js";
import { bindListenerToClearMemoryButton } from "./import/buttons/clearMemoryButton.js";
import { resetCameraView, calculateBoundingBox } from "./drawing/helpers/resetCameraView.js";

import * as THREE from "three";

// document.querySelector("#app").innerHTML = `
//   <div id="header">header</div>
//   <div id="left-panel">left panel</div>
//   <div id="canvas">canvas</div>
//   <div id="right-panel">right panel</div>
//   <div id="bottom">bottom</div>
// `;

document.querySelector("#app").innerHTML = /*html*/ `
</div>
<div id="scene-container">
	<!-- Three.js Canvas -->
	<div id="canvas"></div> <!-- Three.js Canvas -->

	<nav id="vertical-nav">
	<!-- Vertical Nav Buttons -->
	<img src="./assets/svg/kirralogo.svg" class="white-svg" alt="Kirra Logo" />
		<button id=open-holes title="File Open">
			<img src="./assets/tabler-icons-2.36.0/png/load-holes-k3d.png" alt="File Open Holes" />
		</button>
		<button id=import-holes title="File Import">
			<img src="./assets/tabler-icons-2.36.0/png/load-holes-csv.png" alt="File Import Holes" />
		</button>
	  	<button id=import-obj title="File OBJ Loader">
			<img src="./assets/tabler-icons-2.36.0/png/load-obj.png" alt="File Import OBJ" />
		</button>
		<button id=import-dxf title="File Import DXF">
			<img src="./assets/tabler-icons-2.36.0/png/load-dxf.png" alt="File Import DXF" />
		</button>
		<button id=import-pointcloud title="File Import Point Cloud CSV">
			<img src="./assets/tabler-icons-2.36.0/png/load-csv.png" alt="File Import Text Based Point Cloud" />
		</button>
		<button id=settings-world title="Settings World Origin">
			<img src="./assets/tabler-icons-2.36.0/png/world-cog.png" alt="World Origin Point" />
		</button>
		<button id=clear-local-storage title="Clear Local Storage" >
			<img src="./assets/tabler-icons-2.36.0/png/browser-x.png" alt="Clear Local Storage" />
		</button>

	</nav>
  <nav id= horizontal-nav>
	<nav>
		<button id="reset" title="Reset" >
			<img src="./assets/tabler-icons-2.36.0/png/circle-letter-r.png" alt="Reset" />
		</button>
		<button id=swap-all-hole-visuals title="Swap Hole Visual" >
			<img src="./assets/tabler-icons-2.36.0/png/replace.png" alt="Swap Hole Visual" />
		</button>
		<button id=obj-display title="OBJ Display" >
			<img src="./assets/tabler-icons-2.36.0/png/hexagon-filled.png" alt="OBJ Display" />
		</button>
		<button id=hole-name-on-off title="Name On Off" >
			<img src="./assets/tabler-icons-2.36.0/png/holename.png" alt="Hole Name Display" />
		</button>
		<button id=hole-length-on-off title="Length On Off" >
			<img src="./assets/tabler-icons-2.36.0/png/holelength.png" alt="Hole Length Display" />
		</button>
		<button id=hole-diameter-on-off title="Diameter On Off">
			<img src="./assets/tabler-icons-2.36.0/png/holediam.png" alt="Hole Diameter Display" />
		</button>
		<button id=camera-mode title="Camera Mode" >
			<img src="./assets/tabler-icons-2.36.0/png/cube.png" alt="Perspective Mode" />
		</button>

		<label id="info-label" style="color: red;">Info Label</label>
	  <!-- Add more buttons as needed -->
	</nav>
</div>
<!--<div id="canvas"></div>-->
  `;

const canvas = createScene(points);
const { scene, camera, renderer } = canvas;

preloadFont(); // Preload the font

export const counter = {
	cloudPointFileCount: 0,
	csvFileCount: 0,
	k3DFileCount: 0,
	objFileCount: 0
};

// Example: Adding event listeners to the first button
bindListenerToImportK3DButton();
bindListenerToImportCSVButton();
bindListenerToImportOBJButton(canvas);
bindListenerToImportDXFButton(canvas);
bindListenerToImportPointCloudButton();
bindListenerToWorldOriginSettingsButton();
bindListenerToClearMemoryButton();

function getSceneBoundingBox(scene) {
	//Get all the objects in the scene except the camera and lights
	const objects = scene.children.filter((object) => object.userData.entityType !== "camera" && object.userData.entityType !== "light");
	const sceneBoundingBox = new Box3();
	objects.forEach((object) => {
		sceneBoundingBox.expandByObject(object);
		//console.log("Refresh View - Object: ", object);
	});
	return sceneBoundingBox;
}

document.querySelector("#reset").addEventListener("click", function () {
	console.log("Camera Type Before Reset: ", camera.isPerspectiveCamera ? "Perspective" : "Orthographic");
	const boxCentre = getSceneBoundingBox(scene).getCenter(new THREE.Vector3());
	console.log("Box Centre: ", boxCentre.x, boxCentre.y, boxCentre.z);
	camera.up.set(0, 1, 0); // Y-axis pointing up on the screen

	// Position the camera along the Z-axis, looking at the center of the scene
	const cameraDistance = parseFloat(params.cameraDistance) * 0.5;
	const cameraPosition = new THREE.Vector3(boxCentre.x, boxCentre.y, boxCentre.z + cameraDistance);

	if (controls instanceof TrackballControls) {
		console.log("Trackball Controls");
		camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
		camera.lookAt(boxCentre.x, boxCentre.y, boxCentre.z);
		controls.target.set(boxCentre.x, boxCentre.y, boxCentre.z);
		console.log("Target set to: ", boxCentre.x, boxCentre.y, boxCentre.z);
	}

	if (controls instanceof ArcballControls) {
		console.log("Arcball Controls");
		camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
		camera.lookAt(boxCentre.x, boxCentre.y, boxCentre.z);
		controls.target.set(boxCentre.x, boxCentre.y, boxCentre.z);
		console.log("Target set to: ", boxCentre.x, boxCentre.y, boxCentre.z);
		//controls.update();
	}

	camera.updateProjectionMatrix();
	if (params.debugComments) {
		console.log("View Reset");
	}
	document.querySelector("#info-label").textContent = "View Reset";
});

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

//function to turn params.wireframeOn on and off
document.querySelector("#obj-display").addEventListener("click", () => {
	params.wireframeSolidTransparentTexture = params.wireframeSolidTransparentTexture === "Texture" ? "Solid" : params.wireframeSolidTransparentTexture === "Solid" ? "Transparent" : params.wireframeSolidTransparentTexture === "Transparent" ? "Wireframe" : params.wireframeSolidTransparentTexture === "Wireframe" ? "Invisible" : "Texture";

	scene.traverse(function (child) {
		if (child.userData.isOBJMesh || child.userData.isTXTMesh) {
			// Check if it is the OBJ mesh
			if (params.wireframeSolidTransparentTexture === "Texture") {
				document.querySelector("#info-label").textContent = "Texture On";
				document.querySelector("#obj-display").innerHTML = `<img src="./assets/tabler-icons-2.36.0/png/cube-material.png" alt="Texture Display" />`;
				child.material = child.userData.originalMaterial || child.material;
				scene.traverse(function (object) {
					if (object instanceof THREE.DirectionalLight) {
						object.intensity = 0.6;
					}
				});
			} else if (params.wireframeSolidTransparentTexture === "Solid") {
				document.querySelector("#info-label").textContent = "Solid On";
				document.querySelector("#obj-display").innerHTML = `<img src="./assets/tabler-icons-2.36.0/png/hexagon-filled.png" alt="Solid Display" />`;
				child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: false, side: THREE.DoubleSide });
				scene.traverse(function (object) {
					if (object instanceof THREE.DirectionalLight) {
						object.intensity = 0.6;
					}
				});
			} else if (params.wireframeSolidTransparentTexture === "Transparent") {
				document.querySelector("#info-label").textContent = "Transparent On";
				document.querySelector("#obj-display").innerHTML = `<img src="./assets/tabler-icons-2.36.0/png/cube-transparent.png" alt="Transparent Display" />`;
				child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
			} else if (params.wireframeSolidTransparentTexture === "Wireframe") {
				document.querySelector("#info-label").textContent = "Wireframe On";
				document.querySelector("#obj-display").innerHTML = `<img src="./assets/tabler-icons-2.36.0/png/cube-wireframe.png" alt="Wireframe Display" />`;
				child.material = new THREE.MeshBasicMaterial({ color: child.material.color, wireframe: true });
			} else if (params.wireframeSolidTransparentTexture === "Invisible") {
				document.querySelector("#info-label").textContent = "Invisible On";
				document.querySelector("#obj-display").innerHTML = `<img src="./assets/tabler-icons-2.36.0/png/hexagon-letter-x.png" alt="Invisible Display" />`;
				child.material = new THREE.MeshBasicMaterial({ color: child.material.color, visible: false });
			}
			child.material.needsUpdate = true;
		}
	});
	//Update the holes as they are meshes as well
	//updateScene();
});

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

document.querySelector("#camera-mode").addEventListener("click", () => {
	// Toggle between perspective and orthographic
	params.usePerspectiveCam = !params.usePerspectiveCam;
	console.log("Switching Camera Mode to: ", params.usePerspectiveCam ? "Perspective" : "Orthographic");

	let boxCentre = getSceneBoundingBox(scene).getCenter(new Vector3());

	// Update camera and controls based on the current mode
	updateCameraType(boxCentre.x, boxCentre.y, boxCentre.z);

	// Set camera position and look-at based on the new camera type
	camera.position.set(boxCentre.x, boxCentre.y, boxCentre.z + parseFloat(params.cameraDistance) * 0.5);
	camera.lookAt(boxCentre.x, boxCentre.y, boxCentre.z);
	controls.target.set(boxCentre.x, boxCentre.y, boxCentre.z);
	camera.updateProjectionMatrix();

	// Update the icon based on the camera type
	document.querySelector("#camera-mode").innerHTML = params.usePerspectiveCam ? `<img src="./assets/tabler-icons-2.36.0/png/cube-perspective.png" alt="Perspective Mode" />` : `<img src="./assets/tabler-icons-2.36.0/png/cube.png" alt="Orthographic Mode" />`;

	console.log("Camera Type After Change: ", camera.isPerspectiveCamera ? "Perspective" : "Orthographic");
	console.log("Camera Position After Change: ", camera.position.x, camera.position.y, camera.position.z);
	console.log("boxCentre after change: ", boxCentre.x, boxCentre.y, boxCentre.z);
});

createLilGuiFileUpload(canvas);
