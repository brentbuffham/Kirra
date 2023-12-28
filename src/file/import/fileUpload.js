import { getCentroid, parseCSV } from "./csvParser.js";
import { drawDummy } from "../../drawing/entities/drawDummy.js";
import { controls } from "../../drawing/createScene.js";
import { drawHole } from "../../drawing/entities/drawHole.js";
import { Vector3 } from "three";
import { drawText } from "../../drawing/entities/drawText.js";

export function renderFileUpload(containerId, canvas) {
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

	document.getElementById("file-input").addEventListener("change", e => handleFileUpload(e, canvas));
	// document.getElementById("file-input").addEventListener("change", function (e) {
	// 	handleFileUpload(e, scene)
	// });
}

export function handleFileUpload(event, canvas) {
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
		let colour = 0xffffff;
		if (data.split("\n")[0].split(",").length === 4) {
			for (const point of points) {
				drawDummy(canvas.scene, colour, point.startXLocation, point.startYLocation, point.startZLocation);
				drawText(canvas.scene, colour, { x: point.startXLocation, y: point.startYLocation, z: point.startZLocation }, point.pointID);
				colour = getRandomColor();
			}
		} else if (data.split("\n")[0].split(",").length === 7) {
			for (const point of points) {
				const collarVector = new Vector3(point.startXLocation, point.startYLocation, point.startZLocation);
				const toeVector = new Vector3(point.endXLocation, point.endYLocation, point.endZLocation);
				const intervalVector = new Vector3(point.endXLocation, point.endYLocation, point.endZLocation);
				drawHole(canvas.scene, colour, collarVector, intervalVector, toeVector);
				drawText(canvas.scene, colour, { x: point.startXLocation + 0.1, y: point.startYLocation + 0.1, z: point.startZLocation + 0.1 }, point.pointID);
				colour = getRandomColor();
			}
		}

		const { x, y, z } = getCentroid(points);

		//console.log(x, y, z);

		canvas.camera.position.set(x, y, z + 100);
		canvas.camera.lookAt(x, y, z);
		controls.target.set(x, y, z);
		//canvas.camera.up.set(0, 0, 1); // Set Z axis as the up axis
		//console.log(controls.target);
		canvas.camera.updateMatrixWorld();
	};

	reader.readAsText(file);
}

function getRandomColor() {
	const letters = "0123456789ABCDEF";
	let color = "#";
	for (let i = 0; i < 6; i++) {
		color += letters[Math.floor(Math.random() * 16)];
	}

	// Convert hex to RGB
	const hex = color.substring(1); // Remove the '#' character
	const bigint = parseInt(hex, 16);
	const r = (bigint >> 16) & 255;
	const g = (bigint >> 8) & 255;
	const b = bigint & 255;

	// Adjust brightness (make it 20% whiter)
	const adjustedR = Math.min(255, r + 0.2 * (255 - r));
	const adjustedG = Math.min(255, g + 0.2 * (255 - g));
	const adjustedB = Math.min(255, b + 0.2 * (255 - b));

	// Convert back to hex
	const adjustedColor = "#" + Math.round(adjustedR).toString(16).padStart(2, "0") + Math.round(adjustedG).toString(16).padStart(2, "0") + Math.round(adjustedB).toString(16).padStart(2, "0");

	return adjustedColor;
}
