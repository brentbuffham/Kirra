import { getCentroid, parseCSV } from "./csvParser.js";
import { drawDummy } from "../../drawing/entities/drawDummy.js";
import { controls } from "../../drawing/createScene.js";
import { drawHole } from "../../drawing/entities/drawHole.js";
import { Vector3 } from "three";

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

function handleFileUpload(event, canvas) {
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
				colour = getRandomColor();
			}
		} else if (data.split("\n")[0].split(",").length === 7) {
			for (const point of points) {
				const collarVector = new Vector3(point.startXLocation, point.startYLocation, point.startZLocation);
				const toeVector = new Vector3(point.endXLocation, point.endYLocation, point.endZLocation);
				const intervalVector = new Vector3(point.endXLocation, point.endYLocation, point.endZLocation);
				drawHole(canvas.scene, colour, collarVector, intervalVector, toeVector);
				colour = getRandomColor();
			}
		}

		const { x, y, z } = getCentroid(points);

		console.log(x, y, z);

		canvas.camera.position.set(x, y, z + 100);
		canvas.camera.lookAt(x, y, z);
		controls.target.set(x, y, z);
		console.log(controls.target);
		canvas.camera.updateMatrixWorld();
	};

	reader.readAsText(file);
}

//test fuction to help with recognition of the display of the drawing
function getRandomColor() {
	const letters = "0123456789ABCDEF";
	let color = "#";
	for (let i = 0; i < 6; i++) {
		color += letters[Math.floor(Math.random() * 16)];
	}

	return color;
}
