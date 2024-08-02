// fileCSVUpload.js
import { showCustomModal } from "../../modals/csvModal.js";
import Papa from "papaparse";
import { getCentroid } from "../../drawing/helpers/getCentroid.js";
import { camera, controls, scene, objectCenter } from "../../drawing/createScene.js";
import { drawDummys, drawHoles, drawHoleText } from "../../drawing/entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";
import { parseCSV } from "./fileCSVLoader.js";
import { Vector3 } from "three";
import { points } from "./fileK3DUpload.js";

export const handleFileUploadNoEvent = (data) => {
	const results = Papa.parse(data, {
		header: false,
		skipEmptyLines: true,
		dynamicTyping: true,
		complete: function (results) {
			const columns = results.meta.fields;
			const csvData = results.data;

			const columnOrder = JSON.parse(localStorage.getItem("columnOrder") || "{}");

			const headerRows = parseInt(columnOrder.headerRows) || 0;

			let previewContent;
			if (headerRows === 0) {
				previewContent = [Object.keys(csvData[0]).join(","), ...csvData.map((row) => Object.values(row).join(","))].join("\n");
			} else {
				previewContent = csvData
					.slice(headerRows)
					.map((row) => Object.values(row).join(","))
					.join("\n");
			}

			showCustomModal(columns, previewContent, csvData);
		}
	});
};

let centroid = new Vector3(0, 0, 0);

export const handleFileSubmit = (data, columnOrder) => {
	try {
		const newPoints = parseCSV(data, columnOrder);
		points.push(...newPoints);

		let x, y, z;
		let diameterUnits = columnOrder.diameter_units || "mm";

		if (params.worldXCenter === 0 && params.worldYCenter === 0) {
			centroid = getCentroid(points);
			x = centroid.x;
			y = centroid.y;
			z = centroid.z;
			params.worldXCenter = x;
			params.worldYCenter = y;
			updateGuiControllers();
		} else {
			x = params.worldXCenter || 0;
			y = params.worldYCenter || 0;
			z = 0;
		}

		const timeDateNow = Date.now();
		const tempBlastName = "tempBlast" + timeDateNow;

		let colour = 0xffffff;
		for (const point of points) {
			const tempPoint = {
				blastName: point.blastName,
				pointID: `${point.pointID}`,
				startXLocation: point.startXLocation - x,
				startYLocation: point.startYLocation - y,
				startZLocation: point.startZLocation - z,
				endXLocation: point.endXLocation !== null && point.endXLocation !== undefined ? point.endXLocation - x : null,
				endYLocation: point.endYLocation !== null && point.endYLocation !== undefined ? point.endYLocation - y : null,
				endZLocation: point.endZLocation !== null && point.endZLocation !== undefined ? point.endZLocation - z : null,
				diameter: point.diameter || null,
				subdrill: point.subdrill || null,
				shapeType: point.shapeType || null,
				holeColour: point.holeColour || null
			};
			if (!tempPoint.blastName) {
				tempPoint.blastName = tempBlastName;
			}

			// Apply drawing conditions
			// Draw dummy if endXLocation, endYLocation, endZLocation, subdrill, diameter, holeColour, shapeType are null
			if (tempPoint.pointID && tempPoint.startXLocation !== null && tempPoint.startYLocation !== null && tempPoint.startZLocation !== null && tempPoint.endXLocation === null && tempPoint.endYLocation === null && tempPoint.endZLocation === null && tempPoint.subdrill === null && tempPoint.diameter === null && tempPoint.holeColour === null && tempPoint.shapeType === null) {
				drawDummys(scene, tempPoint.holeColour, tempPoint);
				console.log("Drawing dummy...");
			}
			// Draw mesh-cube if diameter is null or 0, regardless of other properties
			else if (tempPoint.pointID && tempPoint.startXLocation !== null && tempPoint.startYLocation !== null && tempPoint.startZLocation !== null && tempPoint.endXLocation !== null && tempPoint.endYLocation !== null && tempPoint.endZLocation !== null && (tempPoint.diameter === null || tempPoint.diameter === 0)) {
				tempPoint.shapeType = "mesh-cube";
				tempPoint.holeColour = tempPoint.holeColour || 0xffffff;
				tempPoint.subdrill = tempPoint.subdrill || 0;
				tempPoint.diameter = tempPoint.diameter || 0;
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				console.log("Drawing mesh-cube...");
			}
			// Draw mesh-cylinder if subdrill, holeColour, shapeType are null
			else if (tempPoint.pointID && tempPoint.startXLocation !== null && tempPoint.startYLocation !== null && tempPoint.startZLocation !== null && tempPoint.endXLocation !== null && tempPoint.endYLocation !== null && tempPoint.endZLocation !== null && tempPoint.subdrill === null && tempPoint.diameter !== null && tempPoint.holeColour === null && tempPoint.shapeType === null) {
				tempPoint.shapeType = "mesh-cylinder";
				tempPoint.holeColour = tempPoint.holeColour || 0xffffff;
				tempPoint.subdrill = tempPoint.subdrill || 0;
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, 0, tempPoint.shapeType);
				console.log("Drawing mesh-cylinder...");
			}
			// Draw hole with colour if subdrill, shapeType are null
			else if (tempPoint.pointID && tempPoint.startXLocation !== null && tempPoint.startYLocation !== null && tempPoint.startZLocation !== null && tempPoint.endXLocation !== null && tempPoint.endYLocation !== null && tempPoint.endZLocation !== null && tempPoint.subdrill === null && tempPoint.diameter !== null && tempPoint.holeColour !== null && tempPoint.shapeType === null) {
				tempPoint.shapeType = "mesh-cylinder";
				tempPoint.subdrill = tempPoint.subdrill || 0;
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				console.log("Drawing Hole with colour...");
			}
			// Draw hole with everything if subdrill, diameter, holeColour, shapeType are not null
			else if (tempPoint.pointID && tempPoint.startXLocation !== null && tempPoint.startYLocation !== null && tempPoint.startZLocation !== null && tempPoint.endXLocation !== null && tempPoint.endYLocation !== null && tempPoint.endZLocation !== null && tempPoint.subdrill !== null && tempPoint.diameter !== null && tempPoint.holeColour !== null && tempPoint.shapeType !== null) {
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				console.log("Drawing Hole with everything...");
			}
		}

		if (params.debugComments) {
			console.log("fileCSVUpload/handleFileSubmit/points: ", points);
			console.log("Objects in scene: ", scene.children);
		}

		camera.position.set(0, 0, parseFloat(params.cameraDistance));
		centroid = getCentroid(points);
		objectCenter.position.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		controls.target.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		camera.lookAt(objectCenter.position);
		camera.updateProjectionMatrix();
		controls.update();

		if (params.debugComments) {
			console.log("fileUpload/handleFileSubmit/controls.target", controls.target);
		}
		camera.updateMatrixWorld();
	} catch (err) {
		console.error("Error in handleFileSubmit: ", err);
	}
};
