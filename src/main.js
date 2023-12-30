import "./style.css";
import { createScene } from "./drawing/createScene.js";
import { renderFileUpload, createLilGuiFileUpload, handleFileUploadNoEvent } from "./file/import/fileUpload.js";

// document.querySelector("#app").innerHTML = `
//   <div id="header">header</div>
//   <div id="left-panel">left panel</div>
//   <div id="canvas">canvas</div>
//   <div id="right-panel">right panel</div>
//   <div id="bottom">bottom</div>
// `;

document.querySelector("#app").innerHTML = `
<div id="header">
    <img src="src/assets/svg/kirralogo.svg" alt="Kirra Logo" />
</div>
<div id="scene-container">
    <div id="canvas"></div> <!-- Three.js Canvas -->
    <nav id="vertical-nav">
    <!-- Vertical Nav Buttons -->
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
    <!-- Add more buttons as needed -->
</nav>
</div>
<!--<div id="canvas"></div>-->
  `;

let points = []; // Define and initialize the 'points' array

const canvas = createScene(points);

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
	console.log("First button clicked");
});
createLilGuiFileUpload(canvas);
