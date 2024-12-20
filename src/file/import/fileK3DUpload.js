//fileUpload.js
import { parseCSV } from "./fileK3DLoader.js";
import { getCentroid } from "../../helpers/getCentroid.js";
import { camera, controls, scene, objectCenter } from "../../drawing/createScene.js";
import { drawDummys, drawHoles, drawHoleText } from "../../entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";
import { counter } from "../../main.js";
import { populatePanelWithSceneObjects } from "../../views/treeView.js";

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
		//points.length = 0; clears the points array
		const newPoints = parseCSV(data, file.name);
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
					//console.log("fileK3DUpload " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation + " Diameter: " + point.diameter + " Subdrill: " + point.subdrill + " ShapeType: " + point.shapeType);
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
		//console.log("objectCenter: ", objectCenter.position);
		//console.log("Centroid: ", centroid);
		controls.target.set(0, 0, 0);

		if (params.debugComments) {
			//console.log(controls.target);
		}
		canvas.camera.updateMatrixWorld();
	};

	reader.readAsText(file);
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

		const k3DStoreName = "K3D_BlastStore";
		//const k3DStoreName = "k3DBlastStore" + counter.k3DFileCount;

		//so the points array reference is not lost
		points.length = 0;
		const newPoints = parseCSV(data, k3DStoreName);
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
			//console.log("fileUpload/handleFileUploadNoEvent/points: ", points);
		}
		let colour = 0xffffff;
		if (data.split("\n")[0].split(",").length === 12) {
			for (const point of points) {
				if (logit && params.debugComments) {
					//console.log("fileK3DUpload " + point.pointID + " X: " + point.startXLocation + " Y: " + point.startYLocation + " Z: " + point.startZLocation + " Diameter: " + point.diameter + " Subdrill: " + point.subdrill + " ShapeType: " + point.shapeType);
				}
				const tempPoint = {
					uuid: point.uuid,
					blastName: point.blastName,
					pointID: point.pointID,
					startXLocation: point.startXLocation - x,
					startYLocation: point.startYLocation - y,
					startZLocation: point.startZLocation,
					endXLocation: point.endXLocation - x,
					endYLocation: point.endYLocation - y,
					endZLocation: point.endZLocation,
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
			//console.log("fileUpload/handleFileUploadNoEvent/centroidPoints: ", x, y, z);
			//console.log("fileUpload/handleFileUploadNoEvent/centroidActual: ", x - x, y - y, z - z);
		}
		if (params.debugComments) {
			console.log("fileK3DUpload/handleFileUploadNoEvent/points: ", points);
			console.log("Objects in scene: ", scene.children);
		}

		centroid = getCentroid(points);
		objectCenter.position.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		camera.position.set(objectCenter.position.x, objectCenter.position.y, parseFloat(params.cameraDistance));
		controls.target.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		camera.lookAt(objectCenter.position);
		camera.updateProjectionMatrix();
		controls.update();
		// After adding the object, refresh the panel
		populatePanelWithSceneObjects(scene, camera);

		if (params.debugComments) {
			console.log("fileUpload/handleFileUploadNoEvent/controls.target", controls.target);
		}
		camera.updateMatrixWorld();
	};
	reader.readAsText(file);
}
