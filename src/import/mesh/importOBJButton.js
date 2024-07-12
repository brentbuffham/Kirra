import { handleOBJNoEvent } from "../../file/import/fileOBJLoader.js";
import { params } from "../../drawing/createScene.js";

export const bindListenerToImportOBJButton = (canvas) => {
	document.getElementById("import-obj").addEventListener("click", function () {
		// Interaction with Three.js scene
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".obj";
		fileInput.style.display = "none"; // Hide the file input

		fileInput.onchange = (e) => {
			if (e.target.files && e.target.files[0]) {
				handleOBJNoEvent(e.target.files[0], canvas);
			}
		};

		document.body.appendChild(fileInput); // Add file input to the document
		fileInput.click(); // Trigger the file input
		document.body.removeChild(fileInput); // Remove the file input after use
		if (params.debugComments) {
			console.log("Load OBJ button clicked");
		}
		document.querySelector("#info-label").textContent = "File OBJ Loaded: " + fileInput.name;
	});
};
