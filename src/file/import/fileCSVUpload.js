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
			//console.log("CSV parsed", results);
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
		//points.length = 0; // Clear the existing points
		const newPoints = parseCSV(data, columnOrder);
		//console.log("New points: ", newPoints);
		points.push(...newPoints);
		//console.log("Points: ", points);

		let x, y, z;
		let diameterUnits = columnOrder.diameter_units || "mm";

		//console.log("Column Order: ", columnOrder);

		if (params.worldXCenter === 0 && params.worldYCenter === 0) {
			//console.log("Calculating centroid...");
			centroid = getCentroid(points);
			x = centroid.x;
			y = centroid.y;
			z = centroid.z;
			//console.log("Centroid: ", centroid);
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
		//console.log("Points List from points[]: ", points);
		for (const point of points) {
			//console.log("Processing point: ", point);
			const tempPoint = {
				blastName: point.blastName,
				pointID: `${point.pointID}`,
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
			if (tempPoint.blastName === null || tempPoint.blastName === undefined || tempPoint.blastName === "" || tempPoint.blastName === "null" || tempPoint.blastName === "undefined" || tempPoint.blastName === " ") {
				tempPoint.blastName = tempBlastName;
				//console.log("Due to like null value Blastname has been altered: ", tempPoint.blastName);
			}

			// Apply drawing conditions
			// Draw dummy if endXLocation, endYLocation, endZLocation, subdrill, diameter, holeColour, shapeType are null
			if (
				(tempPoint.pointID !== null || tempPoint.pointID !== undefined) && //pointID is not null
				(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) && //startXLocation is not null
				(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) && //startYLocation is not null
				(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) && //startZLocation is not null
				(tempPoint.endXLocation === null || tempPoint.endXLocation === undefined) && //endXLocation is null
				(tempPoint.endYLocation === null || tempPoint.endYLocation === undefined) && //endYLocation is null
				(tempPoint.endZLocation === null || tempPoint.endZLocation === undefined) && //endZLocation is null
				(tempPoint.subdrill === null || tempPoint.subdrill === undefined) && //subdrill is null
				(tempPoint.diameter === null || tempPoint.diameter === undefined) && //diameter is null
				(tempPoint.holeColour === null || tempPoint.holeColour === undefined) && //holeColour is null
				(tempPoint.shapeType === null || tempPoint.shapeType === undefined) //shapeType is null
			) {
				drawDummys(scene, tempPoint.holeColour, tempPoint);
				console.log("Drawing dummy...");
			}
			// Draw mesh-cube if subdrill, diameter, holeColour, shapeType are null
			else if (
				(tempPoint.pointID !== null || tempPoint.pointID !== undefined) && //pointID is not null
				(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) && //startXLocation is not null
				(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) && //startYLocation is not null
				(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) && //startZLocation is not null
				(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) && //endXLocation is not null
				(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) && //endYLocation is not null
				(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) && //endZLocation is not null
				(tempPoint.subdrill === null || tempPoint.subdrill === undefined || tempPoint.subdrill !== null || tempPoint.subdrill !== undefined) && //subdrill is null or not null
				(tempPoint.diameter === null || tempPoint.diameter === undefined || tempPoint.diameter === 0) && //diameter is null
				(tempPoint.holeColour === null || tempPoint.holeColour === undefined || tempPoint.holeColour !== null || tempPoint.holeColour !== undefined) && //holeColour is null
				(tempPoint.shapeType === null || tempPoint.shapeType === undefined || tempPoint.shapeType !== null || tempPoint.shapeType !== undefined) //shapeType is null
			) {
				//console.log("1)Drawing mesh-cube...BEFORE", tempPoint);
				if (!tempPoint.shapeType) {
					tempPoint.shapeType = "mesh-cube";
				}
				if (!tempPoint.holeColour) {
					tempPoint.holeColour = 0xffffff;
				}
				if (!tempPoint.subdrill) {
					tempPoint.subdrill = 0;
				}
				if (!tempPoint.diameter) {
					tempPoint.diameter = 0;
				}
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				//console.log("2)Drawing mesh-cube...AFTER", tempPoint);
				console.log("Drawing mesh-cube...");
			}
			// Draw mesh-cylinder if subdrill, holeColour, shapeType are null
			else if (
				(tempPoint.pointID !== null || tempPoint.pointID !== undefined) && //pointID is not null
				(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) && //startXLocation is not null
				(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) && //startYLocation is not null
				(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) && //startZLocation is not null
				(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) && //endXLocation is not null
				(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) && //endYLocation is not null
				(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) && //endZLocation is not null
				(tempPoint.subdrill === null || tempPoint.subdrill === undefined) && //subdrill is null
				(tempPoint.diameter !== null || tempPoint.diameter !== undefined) && //diameter is not null
				(tempPoint.holeColour === null || tempPoint.holeColour === undefined) && //holeColour is null
				(tempPoint.shapeType === null || tempPoint.shapeType === undefined) //shapeType is null
			) {
				if (!tempPoint.shapeType) {
					tempPoint.shapeType = "mesh-cylinder";
				}
				if (!tempPoint.holeColour) {
					tempPoint.holeColour = 0xffffff;
				}
				if (!tempPoint.subdrill) {
					tempPoint.subdrill = 0;
				}
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, 0, tempPoint.shapeType);
				console.log("Drawing mesh-cylinder...");
			}
			// Draw hole with colour if subdrill, shapeType are null
			else if (
				(tempPoint.pointID !== null || tempPoint.pointID !== undefined) && //pointID is not null
				(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) && //startXLocation is not null
				(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) && //startYLocation is not null
				(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) && //startZLocation is not null
				(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) && //endXLocation is not null
				(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) && //endYLocation is not null
				(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) && //endZLocation is not null
				(tempPoint.subdrill === null || tempPoint.subdrill === undefined) && //subdrill is null
				(tempPoint.diameter !== null || tempPoint.diameter !== undefined) && //diameter is not null
				(tempPoint.holeColour !== null || tempPoint.holeColour !== undefined) && //holeColour is not null
				(tempPoint.shapeType === null || tempPoint.shapeType === undefined) //shapeType is null
			) {
				if (tempPoint.shapeType === null || tempPoint.shapeType === undefined) {
					tempPoint.shapeType = "mesh-cylinder";
				}
				if (!tempPoint.subdrill) {
					tempPoint.subdrill = 0;
				}
				if (!tempPoint.shapeType) {
					tempPoint.shapeType = "mesh-cylinder";
				}
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				console.log("Drawing Hole with colour...");
			}
			// Draw hole with everything if subdrill, diameter, holeColour, shapeType are not null
			else if (
				(tempPoint.pointID !== null || tempPoint.pointID !== undefined) && //pointID is not null
				(tempPoint.startXLocation !== null || tempPoint.startXLocation !== undefined) && //startXLocation is not null
				(tempPoint.startYLocation !== null || tempPoint.startYLocation !== undefined) && //startYLocation is not null
				(tempPoint.startZLocation !== null || tempPoint.startZLocation !== undefined) && //startZLocation is not null
				(tempPoint.endXLocation !== null || tempPoint.endXLocation !== undefined) && //endXLocation is not null
				(tempPoint.endYLocation !== null || tempPoint.endYLocation !== undefined) && //endYLocation is not null
				(tempPoint.endZLocation !== null || tempPoint.endZLocation !== undefined) && //endZLocation is not null
				(tempPoint.subdrill !== null || tempPoint.subdrill !== undefined) && //subdrill is not null
				(tempPoint.diameter !== null || tempPoint.diameter !== undefined) && //diameter is not null
				(tempPoint.holeColour !== null || tempPoint.holeColour !== undefined) && //holeColour is not null
				(tempPoint.shapeType !== null || tempPoint.shapeType !== undefined) //shapeType is not null
			) {
				drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
				console.log("Drawing Hole with everything...");
			}
		}

		if (params.debugComments) {
			console.log("fileCSVUpload/handleFileSubmit/points: ", points);
			console.log("Objects in scene: ", scene.children);
		}

		camera.position.set(0, 0, parseFloat(params.cameraDistance));
		//camera.lookAt(0, 0, 0);
		centroid = getCentroid(points);
		objectCenter.position.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		//console.log("objectCenter: ", objectCenter.position);
		//console.log("Centroid: ", centroid);
		controls.target.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		camera.lookAt(objectCenter.position);
		camera.updateProjectionMatrix();
		controls.update();

		if (params.debugComments) {
			//console.log("fileUpload/handleFileSubmit/controls.target", controls.target);
		}
		camera.updateMatrixWorld();
	} catch (err) {
		//console.error("Error in handleFileSubmit: ", err);
	}
};
