import { handleDXFNoEvent } from "../../file/import/fileDXFLoader.js";
import { params } from "../../drawing/createScene.js";
import { getCentroid, getOBJCentroid } from "../../drawing/helpers/getCentroid.js";

export const bindListenerToImportDXFButton = (canvas) => {
	document.getElementById("import-dxf").addEventListener("click", function () {
		// Interaction with Three.js scene
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".dxf";
		fileInput.style.display = "none"; // Hide the file input

		fileInput.onchange = (e) => {
			if (e.target.files && e.target.files[0]) {
				handleDXFNoEvent(e.target.files[0], canvas);
			}
		};

		document.body.appendChild(fileInput); // Add file input to the document
		fileInput.click(); // Trigger the file input
		document.body.removeChild(fileInput); // Remove the file input after use
		if (params.debugComments) {
			console.log("Load DXF button clicked");
		}
		document.querySelector("#info-label").textContent = "File DXF Loaded: " + fileInput.name;
	});
};
