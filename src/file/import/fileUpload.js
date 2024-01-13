//fileUpload.js
import { parseCSV } from "./csvParser.js";
import { getCentroid } from "../../drawing/helpers/getCentroid.js";
import {camera, controls, scene} from "../../drawing/createScene.js";
import { drawDummys, drawHoles } from "../../drawing/entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";

export let points = [];
//const logit = false;
const logit = true;

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
			const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "line-circle", "line-diamond", "line-square", "line-triangle"];
			const currentHoleDisplay = params.holeDisplay;
			const currentIndex = holeOptions.indexOf(currentHoleDisplay);
			let nextIndex = currentIndex;
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
				//with each point cycle through the hole display options and assign to the shapeType variable

				nextIndex = (currentIndex + 1) % holeOptions.length;
				const shapeType = holeOptions[nextIndex];
				console.log("shapeType: ", shapeType);
				drawHoles(canvas.scene, colour, tempPoint, 165, 1, shapeType);
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

export function handleFileUploadNoEvent(file) {
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

		//console log the file contents
		console.log("FileContents: " + data);

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
				drawDummys(scene, colour, tempPoint);
			}
		} else if (data.split("\n")[0].split(",").length === 7) {
			// const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "outline-circle", "filled-circle","line-diamond", "line-square", "line-triangle"];

			// let nextIndex = 0;
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
				const shapeType = params.holeDisplay;
				drawHoles(scene, colour, tempPoint, 165, 1, shapeType);
			}
		} else if (data.split("\n")[0].split(",").length === 10) {
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
					endZLocation: point.endZLocation - z,
					diameter: point.diameter,
					subdrill: point.subdrill,
					shapeType: point.shapeType
				};
				drawHoles(scene, colour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
			}
		}

		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/centroidPoints: ", x, y, z);
			console.log("fileUpload/handleFileUploadNoEvent/centroidActual: ", x - x, y - y, z - z);
		}

		camera.position.set(0, 0, 0 + 200);
		camera.lookAt(0, 0, 0);
		controls.target.set(0, 0, 0);

		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/controls.target", controls.target);
		}
		camera.updateMatrixWorld();
	};
	reader.readAsText(file);
}
