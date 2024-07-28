// importHolesButton.js
import { handleFileUploadNoEvent } from "../../file/import/fileCSVUpload.js";
import { params } from "../../drawing/createScene.js";

export const bindListenerToImportCSVButton = () => {
	document.getElementById("import-holes").addEventListener("click", function () {
		console.clear();
		console.log("Import button clicked");

		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".csv";
		fileInput.style.display = "none";

		fileInput.onchange = (e) => {
			console.log("File selected");
			if (e.target.files && e.target.files[0]) {
				const file = e.target.files[0];
				const reader = new FileReader();

				reader.onload = (event) => {
					const data = event.target.result;
					handleFileUploadNoEvent(data); // Corrected function call to pass data instead of file
				};

				reader.readAsText(file); // Corrected to read the file as text
			}
		};

		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
		if (params.debugComments) {
			console.clear();
			console.log("Load File button clicked");
		}
	});
};
