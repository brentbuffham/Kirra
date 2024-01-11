//fileUpload.js
import { parseCSV } from "./csvParser.js";
import { getCentroid } from "../../drawing/helpers/getCentroid.js";
import { controls } from "../../drawing/createScene.js";
import { drawDummys, drawHoles } from "../../drawing/entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";

export let points = [];
const logit = false;

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

export function handleFileUpload(event, canvas) {
	const file = event.target.files[0];
	if (!file) {
		return;
	}
	const reader = new FileReader();

	reader.onload = function(event) {
		const data = event.target.result;

		if (!file.name.toLowerCase().endsWith(".csv")) {
			return;
		}

		//so the points array reference is not lost
		points.length = 0;
		const newPoints = parseCSV(data);
		points.push(...newPoints);

		const { x, y, z } = getCentroid(points);
		let colour = 0xffffff;
		if (data.split("\n")[0].split(",").length === 4) {
			for (const point of points) {
				if (logit && params.debugComments) {
					console.log("fileUpload/handleFileUpload/drawDummys: " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				}
				const tempPoint = {
					pointID: point.pointID,
					startXLocation: point.startXLocation - x,
					startYLocation: point.startYLocation - y,
					startZLocation: point.startZLocation - z
				};
				drawDummys(canvas.scene, colour, tempPoint);
			}
		} else if (data.split("\n")[0].split(",").length === 7) {
			for (const point of points) {
				if (logit && params.debugComments) {
					console.log("fileUpload/handleFileUpload/draw " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				}
				const tempPoint = {
					pointID: point.pointID,
					startXLocation: point.startXLocation - x,
					startYLocation: point.startYLocation - y,
					startZLocation: point.startZLocation - z,
					endXLocation: point.endXLocation - x,
					endYLocation: point.endYLocation - y,
					endZLocation: point.endZLocation - z
				};
				drawHoles(canvas.scene, colour, tempPoint, 165, 1);
			}
		}

		canvas.camera.position.set(0, 0, 0 + 100);
		canvas.camera.lookAt(0, 0, 0);
		controls.target.set(0, 0, 0);

		if (params.debugComments) {
			console.log(controls.target);
		}
		canvas.camera.updateMatrixWorld();
	};

	reader.readAsText(file);
}

//Only use for the lilGUI
export function createLilGuiFileUpload(canvas) {
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.style.display = "none";
	fileInput.addEventListener("change", e => handleFileUpload(e.target.files[0], canvas));
	document.body.appendChild(fileInput);
}

export function handleFileUploadNoEvent(file, canvas) {
	if (!file) {
		return;
	}
	const reader = new FileReader();

	reader.onload = function(event) {
		const data = event.target.result;

		if (!file.name.toLowerCase().endsWith(".csv")) {
			return;
		}
		console.log("FileName: " + file.name);

		//so the points array reference is not lost
		points.length = 0;
		const newPoints = parseCSV(data);
		points.push(...newPoints);

		const { x, y, z } = getCentroid(points);
		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/points: ", points);
		}
		let colour = 0xffffff;
		if (data.split("\n")[0].split(",").length === 4) {
			for (const point of points) {
				if (logit && params.debugComments) {
					console.log("fileUpload/handleFileUploadNoEvent/drawDummy: " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				}
				const tempPoint = {
					pointID: point.pointID,
					startXLocation: point.startXLocation - x,
					startYLocation: point.startYLocation - y,
					startZLocation: point.startZLocation - z
				};
				drawDummys(canvas.scene, colour, tempPoint);
			}
		} else if (data.split("\n")[0].split(",").length === 7) {
			for (const point of points) {
				if (logit && params.debugComments) {
					console.log("fileUpload/handleFileUploadNoEvent/drawHoles: " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation);
				}
				const tempPoint = {
					pointID: point.pointID,
					startXLocation: point.startXLocation - x,
					startYLocation: point.startYLocation - y,
					startZLocation: point.startZLocation - z,
					endXLocation: point.endXLocation - x,
					endYLocation: point.endYLocation - y,
					endZLocation: point.endZLocation - z
				};
				drawHoles(canvas.scene, colour, tempPoint, 165, 1);
			}
		}

		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/centroidPoints: ", x, y, z);
			console.log("fileUpload/handleFileUploadNoEvent/centroidActual: ", x - x, y - y, z - z);
		}

		canvas.camera.position.set(0, 0, 0 + 100);
		canvas.camera.lookAt(0, 0, 0);
		controls.target.set(0, 0, 0);

		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/controls.target", controls.target);
		}
		canvas.camera.updateMatrixWorld();
	};
	reader.readAsText(file);
}
