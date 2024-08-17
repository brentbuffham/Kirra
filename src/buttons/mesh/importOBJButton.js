import { handleOBJNoEvent } from "../../file/import/fileOBJLoader.js";
import { params } from "../../drawing/createScene.js";

export const bindListenerToImportOBJButton = (canvas) => {
	document.getElementById("import-obj").addEventListener("click", function () {
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".obj,.mtl,image/*"; // Accept OBJ, MTL, and texture files
		fileInput.multiple = true; // Allow multiple file selection
		fileInput.style.display = "none"; // Hide the file input

		fileInput.onchange = (e) => {
			if (e.target.files) {
				const files = Array.from(e.target.files);
				handleOBJNoEvent(files, canvas);
			}
		};

		document.body.appendChild(fileInput); // Add file input to the document
		fileInput.click(); // Trigger the file input
		document.body.removeChild(fileInput); // Remove the file input after use
		if (params.debugComments) {
			console.log("Load OBJ button clicked");
		}
		document.querySelector("#info-label").textContent =
			"Files selected: " +
			Array.from(fileInput.files)
				.map((f) => f.name)
				.join(", ");
	});
};
