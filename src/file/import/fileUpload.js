//fileUpload.js
import { updateScene } from "../../drawing/createScene.js";
import { parseCSV } from "./csvHandler.js";


export function renderFileUpload(containerId, scene) {

	const container = document.querySelector(containerId);
	const fileUpload = `
    <div id="file-upload">
         <input type="file" id="file-input" />
         <label for="file-input">Choose a file</label>
    </div>
`;

	const tempContainer = document.createElement("div");
	tempContainer.innerHTML = fileUpload;
	container.appendChild(tempContainer);

	document.getElementById("file-input").addEventListener("change", (e) => handleFileUpload(e, scene));
	// document.getElementById("file-input").addEventListener("change", function (e) {
	// 	handleFileUpload(e, scene)
	// });

}
function handleFileUpload(event, scene) {
	const file = event.target.files[0];
	if (!file) {
		return;
	}
	const reader = new FileReader();

	let points = [];

	reader.onload = function(event) {
		const data = event.target.result;

		if (!file.name.toLowerCase().endsWith(".csv")) {
			return;
		}
		points = parseCSV(data);
	};

	reader.readAsText(file);
}
