//drawHoles.js
import { Vector3 } from "three";
import { drawCircleHole } from "./drawCircleHole";
import { drawDiamondHole } from "./drawDiamondHole";
import { drawSquareHole } from "./drawSquareHole";
import { drawCrossHole } from "./drawCrossHole";
import { drawCrossDummy } from "./drawCrossDummy";
import { drawText } from "./drawText";
import { params } from "../createScene";
import { getRandomColor } from "../helpers/getRandomColor";
import { drawCylinderHole } from "./drawCylinderHole";

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
			drawCircleHole(scene, colour, collarVector, intervalVector, toeVector, diameter);
			console.log("circleHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			break;
		}
		case "diamond": {
			drawDiamondHole(scene, colour, collarVector, intervalVector, toeVector, diameter);
			console.log("diamondHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			break;
		}
		case "square": {
			drawSquareHole(scene, colour, collarVector, intervalVector, toeVector, diameter);
			console.log("squareHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			break;
		}
		case "cross": {
			drawCrossHole(scene, colour, collarVector, intervalVector, toeVector, diameter);
			console.log("crossHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			break;
		}
		case "cylinder": {
			drawCylinderHole(scene, colour, collarVector, intervalVector, toeVector, diameter);
			console.log("cylinderHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			break;
		}
		default: {
			drawCircleHole(scene, colour, collarVector, intervalVector, toeVector, diameter);
			console.log("circleHoleID: " + pointID + " X: " + collarVector.x + " Y: " + collarVector.y + " Z: " + collarVector.z);
			break;
		}
	}
	switch (params.holeText) {
		case "Off" || "off": {
			break;
		}
		case "ID": {
			drawText(scene, colour, { x: collarVector.x + 0.1, y: collarVector.y + 0.1, z: collarVector.z + 0.1 }, pointID);

			break;
		}
		case "Length": {
			drawText(scene, colour, { x: collarVector.x + 0.1, y: collarVector.y + 0.1, z: collarVector.z + 0.1 }, collarVector.distanceTo(toeVector).toFixed(1));
			break;
		}
	}
	//colour = getRandomColor();
}
//Draw points that consist of id, x, y, z
export function drawDummys(scene, colour, point) {
	const pointID = point.pointID;
	const vector = new Vector3(point.startXlocation, point.startYlocation, point.startZlocation);
	drawCrossDummy(scene, colour, vector);
	console.log("crossDummyID: " + pointID + " X: " + vector.x + " Y: " + vector.y + " Z: " + vector.z);
	drawText(scene, colour, vector, pointID);
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
