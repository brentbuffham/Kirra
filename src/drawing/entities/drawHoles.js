//drawHoles.js
import { Vector3 } from "three";
import { drawMeshCircleHole } from "./meshEntities/drawMeshCircleHole";
import { drawMeshCrossDummy } from "./meshEntities/drawMeshCrossDummy";
import { drawMeshCrossHole } from "./meshEntities/drawMeshCrossHole";
import { drawMeshCylinderHole } from "./meshEntities/drawMeshCylinderHole";
import { drawMeshDiamondHole } from "./meshEntities/drawMeshDiamondHole";
import { drawMeshSquareHole } from "./meshEntities/drawMeshSquareHole";

import { drawLineCrossHole } from "./MeshLineEntities/drawLineCrossHole";
import { drawLineCircleHole } from "./MeshLineEntities/drawLineCircleHole";
import { drawLineDiamondHole } from "./MeshLineEntities/drawLineDiamondHole";
import { drawLineSquareHole } from "./MeshLineEntities/drawLineSquareHole";
import { drawLineTriangleHole } from "./MeshLineEntities/drawLineTriangleHole";

import { drawText } from "./drawText";
import { params } from "../createScene";
import { getRandomColor } from "../helpers/getRandomColor";

import { globalFont } from "../helpers/loadGlobalFont"; //getCentroid.js

const logit = false;

//Draw points that consist of id, sx, sy, sz, ex, ey, ez, diameter, subdrill
export function drawHoles(scene, colour, tempPoint, diameter, subdrill, shape) {
	//colour = getRandomColor();
	colour = "white";
	const name = tempPoint.pointID;
	const collarXYZ = new Vector3(tempPoint.startXLocation, tempPoint.startYLocation, tempPoint.startZLocation);
	const toeXYZ = new Vector3(tempPoint.endXLocation, tempPoint.endYLocation, tempPoint.endZLocation);
	const intervalXYZ = calculateIntervalVector(collarXYZ, toeXYZ, subdrill);
	const shapeType = shape; // || params.holeDisplay;
	const holeScale = 3;
	diameter = diameter * holeScale;
	//Hole Types: "mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "outline-circle", "filled-circle","line-diamond", "line-square"
	switch (shapeType) {
		case "mesh-cylinder": {
			const materialType = "phong";
			drawMeshCylinderHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 32);
			if (logit && params.debugComments) {
				console.log("cylinderHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "mesh-cross": {
			const materialType = "basic";
			const radialSegments = 4;
			drawMeshCrossHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, radialSegments);
			if (logit && params.debugComments) {
				console.log("crossHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "mesh-circle": {
			const materialType = "basic";
			drawMeshCircleHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 32, 2 * Math.PI);
			if (logit && params.debugComments) {
				console.log("circleHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "mesh-diamond": {
			const materialType = "basic";
			drawMeshDiamondHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 4, 2 * Math.PI, false);
			if (logit && params.debugComments) {
				console.log("diamondHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "mesh-square": {
			const materialType = "basic";
			drawMeshSquareHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 4, 2 * Math.PI, true);
			if (logit && params.debugComments) {
				console.log("squareHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}

		case "line-cross": {
			const lineWidth = 2;
			const dashArray = false;
			const dashOffset = 0;
			const dashRatio = 0;
			const opacity = 1;
			const sizeAttenuation = false;
			drawLineCrossHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation);
			if (logit && params.debugComments) {
				console.log("crossHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "outline-circle": {
			const lineWidth = 2;
			const dashArray = false;
			const dashOffset = 0;
			const dashRatio = 0;
			const opacity = 1;
			const sizeAttenuation = false;
			const isFilled = false;
			drawLineCircleHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				console.log("circleHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "filled-circle": {
			const lineWidth = 2;
			const dashArray = false;
			const dashOffset = 0;
			const dashRatio = 0;
			const opacity = 1;
			const sizeAttenuation = false;
			const isFilled = true;
			drawLineCircleHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				console.log("circleHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "line-diamond": {
			const lineWidth = 5;
			const dashArray = false;
			const dashOffset = 0;
			const dashRatio = 0;
			const opacity = 1;
			const sizeAttenuation = false;
			const isFilled = true;
			drawLineDiamondHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				console.log("diamondHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "line-square": {
			const lineWidth = 2;
			const dashArray = false;
			const dashOffset = 0;
			const dashRatio = 0;
			const opacity = 1;
			const sizeAttenuation = false;
			const isFilled = true;
			drawLineSquareHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				console.log("squareHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		case "line-triangle": {
			const lineWidth = 5;
			const dashArray = false;
			const dashOffset = 0;
			const dashRatio = 0;
			const opacity = 1;
			const sizeAttenuation = false;
			const isFilled = true;
			drawLineTriangleHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				console.log("triangleHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
		default: {
			const materialType = "basic";
			drawMeshCircleHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 100, 4, 32, 2 * Math.PI);
			if (logit && params.debugComments) {
				console.log("circleHoleID: " + name + " X: " + collarXYZ.x + " Y: " + collarXYZ.y + " Z: " + collarXYZ.z);
			}
			break;
		}
	}
	let textSize = 1;
	let textLength = name.length;
	switch (params.holeText) {
		case "Off":
		case "off": {
			break;
		}
		case "ID": {
			if (globalFont) {
				drawText(scene, colour, globalFont, { x: collarXYZ.x - textLength / 2, y: collarXYZ.y + textSize / 2, z: collarXYZ.z + 0.1 }, name);
			}
			break;
		}
		case "Length": {
			if (globalFont) {
				const lengthText = collarXYZ.distanceTo(toeXYZ).toFixed(1);
				drawText(scene, "#00aaFF", globalFont, { x: collarXYZ.x - textLength / 2, y: collarXYZ.y - textSize, z: collarXYZ.z + 0.1 }, lengthText);
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
	drawMeshCrossDummy(scene, colour, materialType, name, vector, 100, 4);
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
