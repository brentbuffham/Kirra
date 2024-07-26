//openHoleButton.js
//Use the following code to commented code in the future to parse a specific k3D file format:
import { handleFileUploadNoEvent } from "../../file/import/fileK3DUpload.js";
import { params } from "../../drawing/createScene.js";

/**
 * Binds a listener to the import CSV button.
 */
export const bindListenerToImportK3DButton = () => {
	document.getElementById("open-holes").addEventListener("click", function () {
		console.clear();
		// Interaction with Three.js scene
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".k3d";
		fileInput.style.display = "none"; // Hide the file input

		fileInput.onchange = (e) => {
			if (e.target.files && e.target.files[0]) {
				handleFileUploadNoEvent(e.target.files[0]);
			}
		};

		document.body.appendChild(fileInput); // Add file input to the document
		fileInput.click(); // Trigger the file input
		document.body.removeChild(fileInput); // Remove the file input after use
		if (params.debugComments) {
			console.log("Load K3DFile button clicked");
		}
	});
};
