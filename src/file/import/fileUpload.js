//fileUpload.js
import { getCentroid, parseCSV } from "./csvParser.js";
import { controls } from "../../drawing/createScene.js";
import { drawDummys, drawHoles } from "../../drawing/entities/drawHoles.js";

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
}

export function createLilGuiFileUpload(canvas) {
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.style.display = "none";
	fileInput.addEventListener("change", e => handleFileUpload(e.target.files[0], canvas));
	document.body.appendChild(fileInput);
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
				//console.log("fileUpload/drawDummy: " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				drawDummys(canvas.scene, colour, point);
			}
		} else if (data.split("\n")[0].split(",").length === 7) {
			for (const point of points) {
				//console.log("fileUpload/drawHoles: " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				drawHoles(canvas.scene, colour, point, 1000, 1);
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
export function handleFileUploadNoEvent(file, canvas) {
	//console.log(canvas);
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
		console.log("FileName: " + file.name);
		points = parseCSV(data);
		console.log(points);
		let colour = 0xffffff;
		if (data.split("\n")[0].split(",").length === 4) {
			for (const point of points) {
				//console.log("fileUpload/drawDummy: " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				drawDummys(canvas.scene, colour, point);
			}
		} else if (data.split("\n")[0].split(",").length === 7) {
			for (const point of points) {
				//console.log("fileUpload/drawHoles: " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				drawHoles(canvas.scene, colour, point, 1000, 1);
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
