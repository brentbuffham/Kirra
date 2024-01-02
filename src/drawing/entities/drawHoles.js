//drawHoles.js
import { Vector3 } from "three";
import { drawCircleHole } from "./drawCircleHole";
import { drawDiamondHole } from "./drawDiamondHole";
import { drawSquareHole } from "./drawSquareHole";
import { drawCrossHole } from "./drawCrossHole";
import { drawCrossCylinderHole } from "./drawCrossCylinderHole";
import { drawCrossDummy } from "./drawCrossDummy";
import { drawText } from "./drawText";
import { params } from "../createScene";
import { getRandomColor } from "../helpers/getRandomColor";
import { drawCylinderHole } from "./drawCylinderHole";
import { globalFont } from "../helpers/loadGlobalFont";

//Draw points that consist of id, sx, sy, sz, ex, ey, ez, diameter, subdrill
export function drawHoles(scene, colour, point, diameter, subdrill) {
	colour = getRandomColor();
	//colour = "white";
	const pointID = point.pointID;
	const collarVector = new Vector3(point.startXLocation, point.startYLocation, point.startZLocation);
	const toeVector = new Vector3(point.endXLocation, point.endYLocation, point.endZLocation);
	const intervalVector = calculateIntervalVector(collarVector, toeVector, subdrill);

	switch (params.holeDisplay) {
		case "circle": {
			drawCircleHole(scene, colour, collarVector, intervalVector, toeVector, diameter, 100, 4, 32, 2 * Math.PI);
			if (params.debugComments) {
				console.log("circleHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			}
			break;
		}
		case "diamond": {
			const materialType = "basic";
			drawDiamondHole(scene, colour, materialType, collarVector, intervalVector, toeVector, diameter, 100, 4, 4, 2 * Math.PI);
			if (params.debugComments) {
				console.log("diamondHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			}
			break;
		}
		case "square": {
			const materialType = "basic";
			drawSquareHole(scene, colour, materialType, collarVector, intervalVector, toeVector, diameter, 100, 4, 4, 2 * Math.PI);
			if (params.debugComments) {
				console.log("squareHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			}
			break;
		}
		case "cross": {
			const materialType = "basic";
			drawCrossCylinderHole(scene, colour, materialType, collarVector, intervalVector, toeVector, diameter, 4);
			if (params.debugComments) {
				console.log("crossHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			}
			break;
		}
		case "cylinder": {
			const materialType = "phong";
			const holeScale = 3;
			const diameter = 165 * holeScale;
			drawCylinderHole(scene, colour, materialType, pointID, collarVector, intervalVector, toeVector, diameter, 32);
			if (params.debugComments) {
				console.log("cylinderHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			}
			break;
		}
		default: {
			drawCircleHole(scene, colour, collarVector, intervalVector, toeVector, diameter, 100, 4, 32, 2 * Math.PI);
			if (params.debugComments) {
				console.log("circleHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			}
			break;
		}
	}
	switch (params.holeText) {
		case "Off" || "off": {
			break;
		}
		case "ID": {
			if (globalFont) {
				drawText(scene, colour, globalFont, { x: collarVector.x + 0.1, y: collarVector.y + 0.1, z: collarVector.z + 0.1 }, pointID);
			}
			break;
		}
		case "Length": {
			if (globalFont) {
				drawText(scene, colour, globalFont, { x: collarVector.x + 0.1, y: collarVector.y + 0.1, z: collarVector.z + 0.1 }, collarVector.distanceTo(toeVector).toFixed(1));
			}
			break;
		}
	}
	//colour = getRandomColor();
}
//Draw points that consist of id, x, y, z
export function drawDummys(scene, colour, point) {
	const pointID = point.pointID;
	const materialType = "basic";
	const vector = new Vector3(point.startXLocation, point.startYLocation, point.startZLocation);
	drawCrossDummy(scene, colour, "basic", vector, 100, 4);
	if (params.debugComments) {
		console.log("drawHoles/drawDummys/crossDummyID: " + pointID + " X: " + vector.x + " Y: " + vector.y + " Z: " + vector.z);
	}
	if (globalFont) {
		drawText(scene, colour, globalFont, vector, pointID);
	}
	colour = getRandomColor();
}

function calculateIntervalVector(startXYZ, endXYZ, subdrill) {
	// Create Vector3 instances for startXYZ and endXYZ
	const start = new Vector3(...startXYZ);
	const end = new Vector3(...endXYZ);

	// Calculate the direction vector from startXYZ to endXYZ
	const directionVector = new Vector3().subVectors(end, start);

	// Calculate the total distance between startXYZ and endXYZ
	const totalDistance = directionVector.length();

	// Normalize the direction vector (convert it to a unit vector)
	directionVector.normalize();

	// Calculate the distance from endXYZ to IntervalXYZ
	let distanceFromEnd = subdrill;
	if (totalDistance < subdrill) {
		// This handles the case where subdrill is longer than the total line segment
		distanceFromEnd = totalDistance;
	}

	// Calculate the intervalVector by scaling the direction vector
	// by the distance from endXYZ and adding it to endXYZ
	const intervalVector = new Vector3().addVectors(end, directionVector.multiplyScalar(-distanceFromEnd));

	// Return the calculated intervalVector
	return intervalVector;
}
