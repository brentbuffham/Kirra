//main.js
import "./style.css";
import { renderFileUpload, createLilGuiFileUpload, handleFileUploadNoEvent } from "./file/import/fileUpload.js";
import { preloadFont } from "./drawing/helpers/loadGlobalFont.js";
import { Vector3 } from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { controls, camera, createScene, params } from "./drawing/createScene.js";

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
      <button>
        <img src="src/assets/tabler-icons-2.36.0/png/circle-letter-r.png" alt="Reset" />
      </button>
      <!-- Add more buttons as needed -->
    </nav>
</div>
<!--<div id="canvas"></div>-->
  `;

let points = []; // Define and initialize the 'points' array

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
		console.log("First button clicked");
	}
});
// Example: Adding event listeners to the first button
document.querySelectorAll("#vertical-nav button")[11].addEventListener("click", function() {
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

createLilGuiFileUpload(canvas);
