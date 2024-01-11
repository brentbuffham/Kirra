//main.js
import "./style.css";
import { renderFileUpload, createLilGuiFileUpload, handleFileUploadNoEvent, points } from "./file/import/fileUpload.js";
import { preloadFont } from "./drawing/helpers/loadGlobalFont.js";
import { Vector3 } from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { controls, camera, createScene, params, scene } from "./drawing/createScene.js";
import { getCentroid } from "./drawing/helpers/getCentroid.js";
import { drawHoles } from "./drawing/entities/drawHoles.js";
import { handleOBJNoEvent } from "./file/import/fileOBJLoader.js";

// document.querySelector("#app").innerHTML = `
//   <div id="header">header</div>
//   <div id="left-panel">left panel</div>
//   <div id="canvas">canvas</div>
//   <div id="right-panel">right panel</div>
//   <div id="bottom">bottom</div>
// `;

document.querySelector("#app").innerHTML = `
</div>
<div id="scene-container">
    <div id="canvas"></div> <!-- Three.js Canvas -->

    <nav id="vertical-nav">
    <!-- Vertical Nav Buttons -->
    <img src="src/assets/svg/kirralogo.svg" class="white-svg" alt="Kirra Logo" />
    	<button>
        	<img src="src/assets/tabler-icons-2.36.0/png/file-import.png" alt="File Import" />
    	</button>
	  <button>
	  		<img src="src/assets/tabler-icons-2.36.0/png/3d-cube-sphere.png" alt="File OBJ Loader" />
		</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/file-export.png" alt="File Export" />
    	</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/device-floppy.png" alt="Save" />
    	</button>
    	<button>
    	 	<img src="src/assets/tabler-icons-2.36.0/png/circle-plus.png" alt="Add Hole" />
    	</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/circle-x.png" alt="Remove Hole" />
    	</button>
    	<button>
    	 	<img src="src/assets/tabler-icons-2.36.0/png/grain.png" alt="Add Pattern" />
    	</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/grid-dots.png" alt="Add Pattern2" />
    	</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/ruler-measure.png" alt="Measure" />
    	</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/geometry.png" alt="Bearing and Angle Measure" />
    	</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/help-triangle.png" alt="Help" />
    	</button>
    	<button>
    		<img src="src/assets/tabler-icons-2.36.0/png/settings.png" alt="Settings" />
    	</button>
    </nav>
  <nav id= horizontal-nav>
    <nav>
      <button>
        <img src="src/assets/tabler-icons-2.36.0/png/circle-letter-r.png" alt="Reset" />
      </button>
      <button>
        <img src="src/assets/tabler-icons-2.36.0/png/replace.png" alt="Swap Hole Visual" />
      </button>
      <button>
        <img src="src/assets/tabler-icons-2.36.0/png/sun-moon.png" alt="Dark-Light Mode" />
      </button>
      <!-- Add more buttons as needed -->
    </nav>
</div>
<!--<div id="canvas"></div>-->
  `;

const canvas = createScene(points);

preloadFont(); // Preload the font

// Example: Adding event listeners to the first button
document.querySelectorAll("#vertical-nav button")[0].addEventListener("click", function() {
	// Interaction with Three.js scene
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = ".csv";
	fileInput.style.display = "none"; // Hide the file input

	fileInput.onchange = e => {
		if (e.target.files && e.target.files[0]) {
			handleFileUploadNoEvent(e.target.files[0], canvas);
		}
	};

	document.body.appendChild(fileInput); // Add file input to the document
	fileInput.click(); // Trigger the file input
	document.body.removeChild(fileInput); // Remove the file input after use
	if (params.debugComments) {
		console.log("Load File button clicked");
	}
});
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
		console.log("12th button clicked");
	}
});

const currentPoints = points; //store the current points
console.log("main: ", currentPoints);

document.querySelectorAll("#horizontal-nav button")[1].addEventListener("click", function() {
	//swap hole visual - redrawing the scene with a different blast hole representation
	// Each click will cycle through the createScene params hole visual options
	const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "line-circle", "line-diamond", "line-square", "line-triangle"];
	const currentHoleDisplay = params.holeDisplay;
	console.log("holeDisplay: ", currentHoleDisplay);

	const currentIndex = holeOptions.indexOf(currentHoleDisplay);
	const nextIndex = (currentIndex + 1) % holeOptions.length;
	params.holeDisplay = holeOptions[nextIndex];

	const holeObjectsArray = [];
	canvas.scene.traverse(function(object) {
		if (object.userData.entityType === "hole") {
			holeObjectsArray.push(object);
		}
	});

	for (const hole of holeObjectsArray) {
		canvas.scene.remove(hole);
	}
	const { x, y, z } = getCentroid(currentPoints);
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
		drawHoles(canvas.scene, colour, tempPoint, 165, 1);
	});
});
createLilGuiFileUpload(canvas);
