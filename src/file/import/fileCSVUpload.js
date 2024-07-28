// fileCSVUpload.js
import { showCustomModal } from "../../modals/csvModal.js";
import Papa from "papaparse";
import { getCentroid } from "../../drawing/helpers/getCentroid.js";
import { camera, controls, scene } from "../../drawing/createScene.js";
import { drawDummys, drawHoles } from "../../drawing/entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";
import { parseCSV } from "./fileCSVLoader.js";

let points = []; // To store parsed points

export const handleFileUploadNoEvent = (data) => {
	const results = Papa.parse(data, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: true,
		complete: function (results) {
			console.log("CSV parsed", results);
			const columns = results.meta.fields;
			const csvData = results.data;

			const columnOrder = JSON.parse(localStorage.getItem("columnOrder") || "{}");
			const headerRows = parseInt(columnOrder.headerRows) || 0;

			let previewContent;
			if (headerRows === 0) {
				previewContent = [Object.keys(csvData[0]).join(","), ...csvData.map((row) => Object.values(row).join(","))].join("\n");
			} else {
				previewContent = csvData
					.slice(headerRows - 1)
					.map((row) => Object.values(row).join(","))
					.join("\n");
			}

			showCustomModal(columns, previewContent, csvData);

			// Call handleFileSubmit with csvData and columnOrder after showing the modal
			//handleFileSubmit(csvData, columnOrder);
		}
	});
};

export const handleFileSubmit = (data, columnOrder) => {
	points.length = 0; // Clear the existing points
	const newPoints = parseCSV(data, columnOrder);
	points.push(...newPoints);

	let x, y, z;

	if (params.worldXCenter === 0 && params.worldYCenter === 0) {
		console.log("Calculating centroid...");
		const centroid = getCentroid(points);
		x = centroid.x;
		y = centroid.y;
		params.worldXCenter = x;
		params.worldYCenter = y;
		updateGuiControllers();
	} else {
		x = params.worldXCenter || 0;
		y = params.worldYCenter || 0;
		z = params.worldZCenter || 0;
	}

	const timeDateNow = Date.now();
	const tempBlastName = "tempBlast" + timeDateNow;

	let colour = 0xffffff;
	for (const point of points) {
		console.log("Processing point: ", point);
		const tempPoint = {
			blastName: point.blastName || null,
			pointID: point.pointID.toString(),
			startXLocation: point.startXLocation - x,
			startYLocation: point.startYLocation - y,
			startZLocation: point.startZLocation - z,
			endXLocation: point.endXLocation - x || null,
			endYLocation: point.endYLocation - y || null,
			endZLocation: point.endZLocation - z || null,
			diameter: point.diameter || null,
			subdrill: point.subdrill || null,
			shapeType: point.shapeType || null,
			holeColour: point.holeColour || null
		};

		// Apply drawing conditions
		// Draw dummy if endXLocation, endYLocation, endZLocation, subdrill, diameter, holeColour, shapeType are null
		if (
			(tempPoint.pointID !== null || tempPoint.pointID !== undefined) &&
			(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) &&
			(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) &&
			(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) &&
			(tempPoint.endXLocation === null || tempPoint.endXLocation === undefined) &&
			(tempPoint.endYLocation === null || tempPoint.endYLocation === undefined) &&
			(tempPoint.endZLocation === null || tempPoint.endZLocation === undefined) &&
			(tempPoint.subdrill === null || tempPoint.subdrill === undefined) &&
			(tempPoint.diameter === null || tempPoint.diameter === undefined) &&
			(tempPoint.holeColour === null || tempPoint.holeColour === undefined) &&
			(tempPoint.shapeType === null || tempPoint.shapeType === undefined)
		) {
			drawDummys(scene, tempPoint.holeColour, tempPoint);
			console.log("Drawing dummy...");
		}
		// Draw mesh-cube if subdrill, diameter, holeColour, shapeType are null
		else if (
			(tempPoint.pointID !== null || tempPoint.pointID !== undefined) &&
			(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) &&
			(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) &&
			(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) &&
			(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) &&
			(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) &&
			(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) &&
			(tempPoint.subdrill === null || tempPoint.subdrill === undefined) &&
			(tempPoint.diameter === null || tempPoint.diameter === undefined) &&
			(tempPoint.holeColour === null || tempPoint.holeColour === undefined) &&
			(tempPoint.shapeType === null || tempPoint.shapeType === undefined)
		) {
			drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, "mesh-cube");
			console.log("Drawing mesh-cube...");
		}
		// Draw mesh-cylinder if subdrill, holeColour, shapeType are null
		else if (
			(tempPoint.pointID !== null || tempPoint.pointID !== undefined) &&
			(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) &&
			(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) &&
			(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) &&
			(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) &&
			(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) &&
			(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) &&
			(tempPoint.subdrill === null || tempPoint.subdrill === undefined) &&
			(tempPoint.diameter !== null || tempPoint.diameter !== undefined) &&
			(tempPoint.holeColour === null || tempPoint.holeColour === undefined) &&
			(tempPoint.shapeType === null || tempPoint.shapeType === undefined)
		) {
			drawHoles(scene, colour, tempPoint, tempPoint.diameter, 0, "mesh-cylinder");
			console.log("Drawing mesh-cylinder...");
		}
		// Draw hole with colour if subdrill, shapeType are null
		else if (
			(tempPoint.pointID !== null || tempPoint.pointID !== undefined) &&
			(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) &&
			(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) &&
			(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) &&
			(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) &&
			(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) &&
			(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) &&
			(tempPoint.subdrill === null || tempPoint.subdrill === undefined) &&
			(tempPoint.diameter !== null || tempPoint.diameter !== undefined) &&
			(tempPoint.holeColour !== null || tempPoint.holeColour !== undefined) &&
			(tempPoint.shapeType === null || tempPoint.shapeType === undefined)
		) {
			drawHoles(scene, colour, tempPoint, tempPoint.diameter, 0, tempPoint.shapeType);
			console.log("Drawing Hole with colour...");
		}
		// Draw hole with everything if subdrill, diameter, holeColour, shapeType are not null
		else if (
			(tempPoint.pointID !== null || tempPoint.pointID !== undefined) &&
			(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) &&
			(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) &&
			(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) &&
			(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) &&
			(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) &&
			(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) &&
			(tempPoint.subdrill !== null || tempPoint.subdrill !== undefined) &&
			(tempPoint.diameter !== null || tempPoint.diameter !== undefined) &&
			(tempPoint.holeColour !== null || tempPoint.holeColour !== undefined) &&
			(tempPoint.shapeType !== null || tempPoint.shapeType !== undefined)
		) {
			drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
			console.log("Drawing Hole with everything...");
		}
	}

	if (params.debugComments) {
		console.log("fileUpload/handleFileSubmit/points: ", points);
	}

	camera.position.set(0, 0, 200);
	camera.lookAt(0, 0, 0);
	controls.target.set(0, 0, 0);

	if (params.debugComments) {
		console.log("fileUpload/handleFileSubmit/controls.target", controls.target);
	}
	camera.updateMatrixWorld();
};
