//main.js
import "./style.css";
import { createLilGuiFileUpload, handleFileUploadNoEvent, points } from "./file/import/fileUpload.js";
import { preloadFont } from "./drawing/helpers/loadGlobalFont.js";
import { Vector3 } from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { controls, createScene, params, updateCameraType } from "./drawing/createScene.js";
import { getCentroid } from "./drawing/helpers/getCentroid.js";
import { drawHoles } from "./drawing/entities/drawHoles.js";
import { handleOBJNoEvent } from "./file/import/fileOBJLoader.js";
import { bindListenerToImportCsvButton } from "./import/csv/importButton.js";

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
	<div id="canvas"></div> <!-- Three.js Canvas -->

	<nav id="vertical-nav">
	<!-- Vertical Nav Buttons -->
	<img src="./assets/svg/kirralogo.svg" class="white-svg" alt="Kirra Logo" />
		<button id="btn-import-csv" title="File Import">
			<img src="./assets/tabler-icons-2.36.0/png/file-import.png" alt="File Import" />
		</button>
	  <button title="File OBJ Loader">
			<img src="./assets/tabler-icons-2.36.0/png/3d-cube-sphere.png" alt="File OBJ Loader" />
		</button>
		<!-- 
		<button title="Colour Change">
			<img src="./assets/tabler-icons-2.36.0/png/holecolour.png" alt="Colour Change" />
		 </button>
		<button title="File Export">
			<img src="/assets/tabler-icons-2.36.0/png/file-export.png" alt="File Export" />
		</button>
		<button title="Save">
			<img src="/assets/tabler-icons-2.36.0/png/device-floppy.png" alt="Save" />
		</button>
		<button title="Add Hole">
			<img src="/assets/tabler-icons-2.36.0/png/circle-plus.png" alt="Add Hole" />
		</button>
		<button title="Remove Hole">
			<img src="/assets/tabler-icons-2.36.0/png/circle-x.png" alt="Remove Hole" />
		</button>
		<button title="Add Pattern">
			<img src="/assets/tabler-icons-2.36.0/png/grain.png" alt="Add Pattern" />
		</button>
		<button title="Add Pattern2">
			<img src="/assets/tabler-icons-2.36.0/png/grid-dots.png" alt="Add Pattern2" />
		</button>
		<button title="Measure">
			<img src="/assets/tabler-icons-2.36.0/png/ruler-measure.png" alt="Measure" />
		</button>
		<button title="Bearing and Angle Measure">
			<img src="/assets/tabler-icons-2.36.0/png/geometry.png" alt="Bearing and Angle Measure" />
		</button>
		<button title="Help">
			<img src="/assets/tabler-icons-2.36.0/png/help-triangle.png" alt="Help" />
		</button>
		<button title="Settings">
			<img src="public/assets/tabler-icons-2.36.0/png/settings.png" alt="Settings" />
		</button>
-->
	</nav>
  <nav id= horizontal-nav>
	<nav>
		<button title="Reset" id="reset">
			<img src="./assets/tabler-icons-2.36.0/png/circle-letter-r.png" alt="Reset" />
		</button>
		<button id=swap-all-hole-visuals title="Swap Hole Visual" >
			<img src="./assets/tabler-icons-2.36.0/png/replace.png" alt="Swap Hole Visual" />
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
			<img src="./assets/tabler-icons-2.36.0/png/view-360.png" alt="Perspective Mode" />
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

// Example: Adding event listeners to the first button
bindListenerToImportCsvButton();

// Example: Adding event listeners to the first button
document.querySelectorAll("#vertical-nav button")[1].addEventListener("click", function() {
	// Interaction with Three.js scene
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = ".obj";
	fileInput.style.display = "none"; // Hide the file input

	fileInput.onchange = e => {
		if (e.target.files && e.target.files[0]) {
			handleOBJNoEvent(e.target.files[0], canvas);
		}
	};

	document.body.appendChild(fileInput); // Add file input to the document
	fileInput.click(); // Trigger the file input
	document.body.removeChild(fileInput); // Remove the file input after use
	if (params.debugComments) {
		console.log("Load File button clicked");
	}
	document.querySelector("#info-label").textContent = "File Loaded: " + points.length + " holes";
});
// Example: Adding event listeners to the first button
document.querySelectorAll("#horizontal-nav button")[0].addEventListener("click", function() {
	// Interaction with Three.js scene
	//store the current camera position
	const position = new Vector3(0, 0, 0 + 200);
	const target = new Vector3(0, 0, 0);

	//reset the camera rotation to 0 (Y+ is at the top of the canvas X+ to the Right and Z+ toward the camera)
	if (controls instanceof TrackballControls) {
		controls.object.up.set(0, 1, 0);
	}
	if (controls instanceof ArcballControls) {
		camera.position.copy(position);
		camera.lookAt(0, 0, 0);
		camera.up.set(0, 1, 0);
		controls.target.set(0, 0, 0);
		//set the controls to the stored position and target
		camera.position.copy(position);
		controls.target.copy(target);
	}
	if (params.debugComments) {
		console.log("View Reset");
	}
	document.querySelector("#info-label").textContent = "View Reset";
});

const currentPoints = points; //store the current points
console.log("main: ", currentPoints);
//document.querySelector("#info-label").textContent = "File Loaded: " + currentPoints.length + " holes";
addPointsToLocalStorage(currentPoints); // Add the points to the local storage
// Add the points to the local storage
export function addPointsToLocalStorage(points) {
	localStorage.setItem("points", JSON.stringify(points));
}
// Get the points from the local storage
export function getPointsFromLocalStorage() {
	return JSON.parse(localStorage.getItem("points"));
}
// Clear the points from the local storage
export function clearPointsFromLocalStorage() {
	localStorage.removeItem("points");
}

//function to reload the points on browser refresh confirm with user if they want to clear the points
export function reloadPoints() {
	getPointsFromLocalStorage();
	if (confirm("Do you want to clear the points?")) {
		clearPointsFromLocalStorage();
	}
}

// Function to update the hole display - remove this in future.
function updateHoleDisplay() {
	const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "outline-circle", "filled-circle", "line-diamond", "line-square", "line-triangle"];
	const currentHoleDisplay = params.holeDisplay;
	console.log("holeDisplay: ", currentHoleDisplay);
	document.querySelector("#info-label").textContent = "Current Hole Display: " + params.holeDisplay;

	const currentIndex = holeOptions.indexOf(currentHoleDisplay);
	const nextIndex = (1 + currentIndex) % holeOptions.length;
	params.holeDisplay = holeOptions[nextIndex];

	const holeObjectsArray = [];
	scene.traverse(function(object) {
		if (object.userData.entityType === "hole") {
			holeObjectsArray.push(object);
		}
	});

	for (const hole of holeObjectsArray) {
		scene.remove(hole);
	}

	const { x, y, z } = getCentroid(currentPoints);
	if (currentPoints.endXLocation !== null && currentPoints.endYLocation !== null && currentPoints.endZLocation !== null && currentPoints.diameter !== null) {
		const colour = 0xffffff;
		currentPoints.forEach(point => {
			const tempPoint = {
				pointID: point.pointID,
				startXLocation: point.startXLocation - x,
				startYLocation: point.startYLocation - y,
				startZLocation: point.startZLocation - z,
				endXLocation: point.endXLocation - x,
				endYLocation: point.endYLocation - y,
				endZLocation: point.endZLocation - z,
				diameter: point.diameter,
				subdrill: point.subdrill,
				shapeType: params.holeDisplay,
				holeColour: point.holeColour
			};

			drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, params.holeDisplay); // Pass the correct shape parameter
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

function updateScene() {
	// Gather all objects of entity type "hole" into an array
	const holeObjectsArray = [];
	const holeNameTextArray = [];
	const holeLengthTextArray = [];
	const holeDiameterTextArray = [];

	scene.traverse(function(object) {
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


	// Re-add the holes with updated parameters
	const { x, y, z } = getCentroid(points);
	if (points.endXLocation !== null && points.endYLocation !== null && points.endZLocation !== null && points.diameter !== null) {
		const colour = 0xffffff;
		points.forEach(point => {
			const tempPoint = {
				pointID: point.pointID,
				startXLocation: point.startXLocation - x,
				startYLocation: point.startYLocation - y,
				startZLocation: point.startZLocation - z,
				endXLocation: point.endXLocation - x,
				endYLocation: point.endYLocation - y,
				endZLocation: point.endZLocation - z,
				diameter: point.diameter,
				subdrill: point.subdrill,
				shapeType: point.shapeType,
				holeColour: point.holeColour
			};

			// Draw the holes again with updated parameters
			drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType); 
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


//change Camera Type
document.querySelector("#camera-mode").addEventListener("click", () => {
	params.usePerspectiveCam = !params.usePerspectiveCam;
	updateCameraType();
	if (params.usePerspectiveCam) {
		document.querySelector("#info-label").textContent = "Camera Type Updated: Perspective";
	} else {
		document.querySelector("#info-label").textContent = "Camera Type Updated: Orthographic";
	}
});

createLilGuiFileUpload(canvas);
