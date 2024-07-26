// fileCSVUpload.js
import { parseHoles } from "./fileCSVLoader.js";
import { getCentroid } from "../../drawing/helpers/getCentroid.js";
import { camera, controls, scene } from "../../drawing/createScene.js";
import { drawDummys, drawHoles } from "../../drawing/entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";

export let points = [];
const logit = true;
let x = 0;
let y = 0;
let z = 0;

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

	document.getElementById("file-input").addEventListener("change", (e) => handleFileUpload(e, canvas));
}

export function handleFileUpload(event, canvas) {
	const file = event.target.files[0];
	if (!file) {
		return;
	}
	const reader = new FileReader();

	reader.onload = function (event) {
		const data = event.target.result;

		if (!file.name.toLowerCase().endsWith(".csv")) {
			return;
		}

		// Get selected columns from local storage or default
		const selectedColumns = JSON.parse(localStorage.getItem("columnOrder")) || {
			holeName: 0,
			startX: 1,
			startY: 2,
			startZ: 3
		};

		Papa.parse(data, {
			header: true,
			skipEmptyLines: true,
			complete: function (results) {
				const newPoints = parseHoles(results.data, selectedColumns);
				points.push(...newPoints);

				if (params.worldXCenter === 0 && params.worldYCenter === 0 && params.worldZCenter === 0) {
					const centroid = getCentroid(points);
					x = centroid.x;
					y = centroid.y;
					z = centroid.z;
				} else {
					x = params.worldXCenter;
					y = params.worldYCenter;
					z = params.worldZCenter;
				}
				let colour = 0xffffff;

				points.forEach((point) => {
					const tempPoint = {
						pointID: point.pointID,
						startXLocation: point.startXLocation - x,
						startYLocation: point.startYLocation - y,
						startZLocation: point.startZLocation - z,
						endXLocation: point.endXLocation !== null ? point.endXLocation - x : null,
						endYLocation: point.endYLocation !== null ? point.endYLocation - y : null,
						endZLocation: point.endZLocation !== null ? point.endZLocation - z : null,
						diameter: point.diameter,
						subdrill: point.subdrill,
						shapeType: point.shapeType,
						holeColour: point.holeColour
					};
					drawHoles(canvas.scene, colour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				});

				canvas.camera.position.set(0, 0, 100);
				canvas.camera.lookAt(0, 0, 0);
				controls.target.set(0, 0, 0);
				canvas.camera.updateMatrixWorld();
			}
		});
	};

	reader.readAsText(file);
}

// Only use for the lilGUI
export function createLilGuiFileUpload(canvas) {
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.style.display = "none";
	fileInput.addEventListener("change", (e) => handleFileUpload(e.target.files[0], canvas));
	document.body.appendChild(fileInput);
}

export function handleFileUploadNoEvent(file) {
	if (!file) {
		return;
	}
	const reader = new FileReader();

	reader.onload = function (event) {
		const data = event.target.result;

		if (!file.name.toLowerCase().endsWith(".csv")) {
			return;
		}
		console.log("FileName: " + file.name);

		// Get selected columns from local storage or default
		const selectedColumns = JSON.parse(localStorage.getItem("columnOrder")) || {
			holeName: 0,
			startX: 1,
			startY: 2,
			startZ: 3
		};

		Papa.parse(data, {
			header: true,
			skipEmptyLines: true,
			complete: function (results) {
				const newPoints = parseHoles(results.data, selectedColumns);
				points.push(...newPoints);

				if (params.worldXCenter === 0 && params.worldYCenter === 0) {
					const centroid = getCentroid(points);
					x = centroid.x;
					y = centroid.y;
					z = centroid.z;
					params.worldXCenter = x;
					params.worldYCenter = y;
					updateGuiControllers();
				} else {
					x = params.worldXCenter || 0;
					y = params.worldYCenter || 0;
					z = params.worldZCenter || 0;
				}
				if (params.debugComments) {
					console.log("fileUpload/handleFileUploadNoEvent/points: ", points);
				}
				let colour = 0xffffff;

				points.forEach((point) => {
					const tempPoint = {
						pointID: point.pointID,
						startXLocation: point.startXLocation - x,
						startYLocation: point.startYLocation - y,
						startZLocation: point.startZLocation - z,
						endXLocation: point.endXLocation !== null ? point.endXLocation - x : null,
						endYLocation: point.endYLocation !== null ? point.endYLocation - y : null,
						endZLocation: point.endZLocation !== null ? point.endZLocation - z : null,
						diameter: point.diameter,
						subdrill: point.subdrill,
						shapeType: point.shapeType,
						holeColour: point.holeColour
					};
					drawHoles(scene, colour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				});

				camera.position.set(0, 0, 200);
				camera.lookAt(0, 0, 0);
				controls.target.set(0, 0, 0);
				camera.updateMatrixWorld();
			}
		});
	};

	reader.readAsText(file);
}
