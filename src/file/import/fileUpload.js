//fileUpload.js
import { updateScene } from "../../drawing/createScene.js";
import { parseCSV } from "./csvHandler.js";

let sceneObject; // Variable to store the scene object

export function renderFileUpload(containerId, initialSceneObject) {
	sceneObject = initialSceneObject; // Set the initial scene object

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

	document.getElementById("file-input").addEventListener("change", handleFileUpload);
}

function handleFileUpload(event) {
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
		points = parseCSV(data, sceneObject);
		updateScene(points, sceneObject); // Update the scene with new points
	};

	reader.readAsText(file);
}
export function getCentroid(data) {
	if (typeof data !== "string") {
		console.error("Data is not a string:", data);
		return { x: 0, y: 0, z: 0 }; // Provide default values or handle the error appropriately
	}

	const lines = data.split("\n");

	let sumX = 0;
	let sumY = 0;
	let sumZ = 0;

	const points = lines.map(line => {
		const values = line.split(",");
		return {
			pointId: values[0],
			startXLocation: parseFloat(values[1]),
			startYLocation: parseFloat(values[2]),
			startZLocation: parseFloat(values[3])
		};
	});

	for (let i = 0; i < points.length; i++) {
		sumX += points[i].startXLocation;
		sumY += points[i].startYLocation;
		sumZ += points[i].startZLocation;
	}

	const centroidX = sumX / points.length;
	const centroidY = sumY / points.length;
	const centroidZ = sumZ / points.length;

	return { x: centroidX, y: centroidY, z: centroidZ };
}
