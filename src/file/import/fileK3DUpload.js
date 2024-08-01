//fileUpload.js
import { parseCSV } from "./fileK3DLoader.js";
import { getCentroid } from "../../drawing/helpers/getCentroid.js";
import { camera, controls, scene, objectCenter } from "../../drawing/createScene.js";
import { drawDummys, drawHoles, drawHoleText } from "../../drawing/entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";

export let points = [];
const logit = false;
//const logit = true;
let x = 0;
let y = 0;
let z = 0;
let centroid = { x: 0, y: 0, z: 0 };

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

		//so the points array reference is not lost
		points.length = 0;
		const newPoints = parseCSV(data);
		points.push(...newPoints);

		if (params.worldXCenter === 0 && params.worldYCenter === 0) {
			(x = getCentroid(points).x), (y = getCentroid(points).y), z;
			params.worldXCenter = x;
			params.worldYCenter = y;
			updateGuiControllers();
		} else {
			x = params.worldXCenter || 0;
			y = params.worldYCenter || 0;
			z = 0;
		}
		let colour = 0xffffff;

		if (data.split("\n")[0].split(",").length === 12) {
			const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "outline-circle", "filled-circle", "line-diamond", "line-square", "line-triangle"];
			const currentHoleDisplay = params.holeDisplay;
			const currentIndex = holeOptions.indexOf(currentHoleDisplay);
			let nextIndex = currentIndex;
			for (const point of points) {
				if (logit && params.debugComments) {
					console.log("fileK3DUpload " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation + " Diameter: " + point.diameter + " Subdrill: " + point.subdrill + " ShapeType: " + point.shapeType);
				}
				const tempPoint = {
					blastName: point.blastName,
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
				drawHoleText(scene, tempPoint.holeColour, tempPoint);
				drawHoles(canvas.scene, colour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
			}
		}

		canvas.camera.position.set(0, 0, 0 + 100);
		canvas.camera.lookAt(0, 0, 0);
		centroid = getCentroid(points);
		objectCenter.position.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		console.log("objectCenter: ", objectCenter.position);
		console.log("Centroid: ", centroid);
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

		if (!file.name.toLowerCase().endsWith(".k3d")) {
			return;
		}
		console.log("FileName: " + file.name);

		//console log the file contents
		console.log("FileContents: " + data);

		//so the points array reference is not lost
		points.length = 0;
		const newPoints = parseCSV(data);
		points.push(...newPoints);

		if (params.worldXCenter === 0 && params.worldYCenter === 0) {
			(x = getCentroid(points).x), (y = getCentroid(points).y), z;
			params.worldXCenter = x;
			params.worldYCenter = y;
			updateGuiControllers();
		} else {
			x = params.worldXCenter || 0;
			y = params.worldYCenter || 0;
			z = 0;
		}
		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/points: ", points);
		}
		let colour = 0xffffff;
		if (data.split("\n")[0].split(",").length === 12) {
			for (const point of points) {
				if (logit && params.debugComments) {
					console.log("fileK3DUpload " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation + " Diameter: " + point.diameter + " Subdrill: " + point.subdrill + " ShapeType: " + point.shapeType);
				}
				const tempPoint = {
					blastName: point.blastName,
					pointID: point.pointID,
					startXLocation: point.startXLocation - x,
					startYLocation: point.startYLocation - y,
					startZLocation: point.startZLocation - z,
					endXLocation: point.endXLocation - x,
					endYLocation: point.endYLocation - y,
					endZLocation: point.endZLocation - z,
					diameter: point.diameter,
					subdrill: point.subdrill,
					shapeType: point.shapeType,
					holeColour: point.holeColour
				};
				drawHoleText(scene, tempPoint.holeColour, tempPoint);
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
			}
		} else {
			alert("Invalid file format\n\nCheck the columns in the file.\nblastName,pointID,startXLocation,startYLocation,\nstartZLocation,endXLocation,endYLocation,\nendZLocation,diameter,subdrill,\nshapeType,holeColour");
		}

		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/centroidPoints: ", x, y, z);
			console.log("fileUpload/handleFileUploadNoEvent/centroidActual: ", x - x, y - y, z - z);
		}

		camera.position.set(0, 0, parseFloat(params.cameraDistance));
		//camera.lookAt(0, 0, 0);
		centroid = getCentroid(points);
		objectCenter.position.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		console.log("objectCenter: ", objectCenter.position);
		console.log("Centroid: ", centroid);
		controls.target.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		camera.lookAt(objectCenter.position);
		camera.updateProjectionMatrix();
		controls.update();

		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/controls.target", controls.target);
		}
		camera.updateMatrixWorld();
	};
	reader.readAsText(file);
}
