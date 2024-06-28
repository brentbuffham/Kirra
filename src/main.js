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
	<img src="public/assets/svg/kirralogo.svg" class="white-svg" alt="Kirra Logo" />
		<button id="btn-import-csv" title="File Import">
			<img src="public/assets/tabler-icons-2.36.0/png/file-import.png" alt="File Import" />
		</button>
	  <button title="File OBJ Loader">
			<img src="public/assets/tabler-icons-2.36.0/png/3d-cube-sphere.png" alt="File OBJ Loader" />
		</button>
		<!--<button title="File Export">
			<img src="public/assets/tabler-icons-2.36.0/png/file-export.png" alt="File Export" />
		</button>
		<button title="Save">
			<img src="public/assets/tabler-icons-2.36.0/png/device-floppy.png" alt="Save" />
		</button>
		<button title="Add Hole">
			<img src="public/assets/tabler-icons-2.36.0/png/circle-plus.png" alt="Add Hole" />
		</button>
		<button title="Remove Hole">
			<img src="public/assets/tabler-icons-2.36.0/png/circle-x.png" alt="Remove Hole" />
		</button>
		<button title="Add Pattern">
			<img src="public/assets/tabler-icons-2.36.0/png/grain.png" alt="Add Pattern" />
		</button>
		<button title="Add Pattern2">
			<img src="public/assets/tabler-icons-2.36.0/png/grid-dots.png" alt="Add Pattern2" />
		</button>
		<button title="Measure">
			<img src="public/assets/tabler-icons-2.36.0/png/ruler-measure.png" alt="Measure" />
		</button>
		<button title="Bearing and Angle Measure">
			<img src="public/assets/tabler-icons-2.36.0/png/geometry.png" alt="Bearing and Angle Measure" />
		</button>
		<button title="Help">
			<img src="public/assets/tabler-icons-2.36.0/png/help-triangle.png" alt="Help" />
		</button>
		<button title="Settings">
			<img src="public/assets/tabler-icons-2.36.0/png/settings.png" alt="Settings" />
		</button>
-->
	</nav>
  <nav id= horizontal-nav>
	<nav>
		<button title="Reset">
			<img src="public/assets/tabler-icons-2.36.0/png/circle-letter-r.png" alt="Reset" />
		</button>
		<button title="Swap Hole Visual">
			<img src="public/assets/tabler-icons-2.36.0/png/replace.png" alt="Swap Hole Visual" />
		</button>
		<!--
		<button title="Dark-Light Mode">
			<img src="src/assets/tabler-icons-2.36.0/png/sun-moon.png" alt="Dark-Light Mode" />
		 </button>
-->
		<button title="Perspective Mode">
			<img src="public/assets/tabler-icons-2.36.0/png/view-360.png" alt="Perspective Mode" />
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

// Function to update the hole display
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
		currentPoints.forEach(point => {
			const tempPoint = {
				pointID: point.pointID,
				startXLocation: point.startXLocation - x,
				startYLocation: point.startYLocation - y,
				startZLocation: point.startZLocation - z,
				endXLocation: point.endXLocation - x,
				endYLocation: point.endYLocation - y,
				endZLocation: point.endZLocation - z
			};
			const colour = 0xffffff;
			drawHoles(scene, colour, tempPoint, 165, 1, params.holeDisplay); // Pass the correct shape parameter
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

// Attach event listener to the button
document.querySelectorAll("#horizontal-nav button")[1].addEventListener("click", updateHoleDisplay);

//change Camera Type
document.querySelectorAll("#horizontal-nav button")[2].addEventListener("click", () => {
	params.usePerspectiveCam = !params.usePerspectiveCam;
	updateCameraType();
	if (params.usePerspectiveCam) {
		document.querySelector("#info-label").textContent = "Camera Type Updated: Perspective";
	} else {
		document.querySelector("#info-label").textContent = "Camera Type Updated: Orthographic";
	}
});

createLilGuiFileUpload(canvas);
