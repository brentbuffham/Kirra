//drawHoles.js
import { Vector3 } from "three";
import { drawCircleHole } from "./meshEntities/drawCircleHole";
import { drawDiamondHole } from "./meshEntities/drawDiamondHole";
import { drawSquareHole } from "./meshEntities/drawSquareHole";
import { drawCrossHole } from "./MeshLineEntities/drawCrossHole";
import { drawCrossCylinderHole } from "./meshEntities/drawCrossCylinderHole";
import { drawCrossDummy } from "./meshEntities/drawCrossDummy";
import { drawText } from "./drawText";
import { params } from "../createScene";
import { getRandomColor } from "../helpers/getRandomColor";
import { drawCylinderHole } from "./meshEntities/drawCylinderHole";
import { globalFont } from "../helpers/loadGlobalFont"; //getCentroid.js

//Draw points that consist of id, sx, sy, sz, ex, ey, ez, diameter, subdrill
export function drawHoles(scene, colour, tempPoint, diameter, subdrill) {
	colour = getRandomColor();
	//colour = "white";
	const name = tempPoint.pointID;
	const collarXYZ = new Vector3(tempPoint.startXLocation, tempPoint.startYLocation, tempPoint.startZLocation);
	const toeXYZ = new Vector3(tempPoint.endXLocation, tempPoint.endYLocation, tempPoint.endZLocation);
	const intervalXYZ = calculateIntervalVector(collarXYZ, toeXYZ, subdrill);

	switch (params.holeDisplay) {
		case "meshCircle": {
			const materialType = "basic";
			const holeScale = 3;
			const diameter = 165 * holeScale;
			drawCircleHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 32, 2 * Math.PI);
			if (params.debugComments) {
				console.log("circleHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "meshDiamond": {
			const materialType = "basic";
			drawDiamondHole(scene, colour, materialType, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 4, 2 * Math.PI);
			if (params.debugComments) {
				console.log("diamondHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "meshSquare": {
			const materialType = "basic";
			drawSquareHole(scene, colour, materialType, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 4, 2 * Math.PI);
			if (params.debugComments) {
				console.log("squareHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "meshCross": {
			const materialType = "basic";
			const diameter = 100; //this will be 100mm
			const radialSegments = 4;
			drawCrossCylinderHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, radialSegments);
			if (params.debugComments) {
				console.log("crossHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "meshCylinder": {
			const materialType = "phong";
			const holeScale = 3;
			const diameter = 165 * holeScale;
			drawCylinderHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 32);
			if (params.debugComments) {
				console.log("cylinderHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "lineCross": {
			const lineWidth = 5;
			const dashArray = false;
			const dashOffset = 0;
			const dashRatio = 0;
			const opacity = 1;
			const sizeAttenuation = false;
			const diameter = 500;
			drawCrossHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation);
			if (params.debugComments) {
				console.log("crossHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}

		default: {
			const materialType = "basic";
			const holeScale = 3;
			const diameter = 165 * holeScale;
			drawCircleHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 32, 2 * Math.PI);
			if (params.debugComments) {
				console.log("circleHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
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
				drawText(scene, colour, globalFont, { x: collarXYZ.x + 0.1, y: collarXYZ.y + 0.1, z: collarXYZ.z + 0.1 }, name);
			}
			break;
		}
		case "Length": {
			if (globalFont) {
				drawText(scene, colour, globalFont, { x: collarXYZ.x + 0.1, y: collarXYZ.y + 0.1, z: collarXYZ.z + 0.1 }, collarXYZ.distanceTo(toeXYZ).toFixed(1));
			}
			break;
		}
	}
	//colour = getRandomColor();
}
//Draw points that consist of id, x, y, z
export function drawDummys(scene, colour, point) {
	const name = point.pointID;
	const materialType = "basic";
	const vector = new Vector3(point.startXLocation, point.startYLocation, point.startZLocation);
	drawCrossDummy(scene, colour, "basic", vector, 100, 4);
	if (params.debugComments) {
		console.log("drawHoles/drawDummys/crossDummyID: " + name + " X: " + vector.x + " Y: " + vector.y + " Z: " + vector.z);
	}
	if (globalFont) {
		drawText(scene, colour, globalFont, vector, name);
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
