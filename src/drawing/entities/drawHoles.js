//drawHoles.js
import { Vector3 } from "three";
import { drawMeshCircleHole } from "./meshEntities/drawMeshCircleHole";
import { drawMeshCrossDummy } from "./meshEntities/drawMeshCrossDummy";
import { drawMeshCrossHole } from "./meshEntities/drawMeshCrossHole";
import { drawMeshCylinderHole } from "./meshEntities/drawMeshCylinderHole";
import { drawMeshDiamondHole } from "./meshEntities/drawMeshDiamondHole";
import { drawMeshSquareHole } from "./meshEntities/drawMeshSquareHole";
import { drawMeshCubeHole } from "./meshEntities/drawMeshCubeHole";
import { drawLineCrossHole } from "./MeshLineEntities/drawLineCrossHole";
import { drawLineCircleHole } from "./MeshLineEntities/drawLineCircleHole";
import { drawLineDiamondHole } from "./MeshLineEntities/drawLineDiamondHole";
import { drawLineSquareHole } from "./MeshLineEntities/drawLineSquareHole";
import { drawLineTriangleHole } from "./MeshLineEntities/drawLineTriangleHole";

import { drawText } from "./drawText";
import { params } from "../createScene";
import { getRandomColor } from "../helpers/getRandomColor";

import { globalFont } from "../helpers/loadGlobalFont"; //getCentroid.js

const logit = true;

//Draw points that consist of id, sx, sy, sz, ex, ey, ez, diameter, subdrill
export function drawHoles(scene, colour, tempPoint, diameter, subdrill, shape) {
	//colour = getRandomColor();
	colour = colour || "white";
	const name = tempPoint.pointID;
	const collarXYZ = new Vector3(tempPoint.startXLocation, tempPoint.startYLocation, tempPoint.startZLocation);
	const toeXYZ = new Vector3(tempPoint.endXLocation, tempPoint.endYLocation, tempPoint.endZLocation);
	// Calculate the interval vector only if subdrill is positive
	const intervalXYZ = subdrill > 0 ? calculateIntervalVector(collarXYZ, toeXYZ, subdrill) : toeXYZ;
	//const intervalXYZ = calculateIntervalVector(collarXYZ, toeXYZ, subdrill);
	const shapeType = tempPoint.shapeType; // || params.holeDisplay;
	const holeScale = 3;
	const drawDiam = diameter * holeScale;
	//Hole Types: "mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "mesh-cube", "line-cross", "outline-circle", "filled-circle","line-diamond", "line-square"
	switch (shapeType) {
		case "mesh-cube": {
			const materialType = "basic";
			drawMeshCubeHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, diameter, 4);
			if (logit && params.debugComments) {
				//console.log("drawHoles/mesh-cube HoleID: ", name, " : ", tempPoint);
			}
			break;
		}
		case "mesh-cylinder": {
			const materialType = "phong";
			drawMeshCylinderHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, 32);
			if (logit && params.debugComments) {
				//console.log("drawHoles/mesh-cylinder HoleID: ", name, " : ", tempPoint);
			}
			break;
		}
		case "mesh-cross": {
			const materialType = "basic";
			const radialSegments = 4;
			drawMeshCrossHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, 100, radialSegments);
			if (logit && params.debugComments) {
				//console.log("drawHoles/mesh-cross HoleID: ", name, " : ", tempPoint);
			}
			break;
		}
		case "mesh-circle": {
			const materialType = "basic";
			drawMeshCircleHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, 100, 4, 32, 2 * Math.PI);
			if (logit && params.debugComments) {
				//console.log("drawHoles/mesh-circle HoleID: ", name, " : ", tempPoint);
			}
			break;
		}
		case "mesh-diamond": {
			const materialType = "basic";
			drawMeshDiamondHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, 100, 4, 4, 2 * Math.PI, false);
			if (logit && params.debugComments) {
				//console.log("drawHoles/mesh-diamond HoleID: ", name, " : ", tempPoint);
			}
			break;
		}
		case "mesh-square": {
			const materialType = "basic";
			drawMeshSquareHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, 100, 4, 4, 2 * Math.PI, true);
			if (logit && params.debugComments) {
				//console.log("drawHoles/mesh-square HoleID: ", name, " : ", tempPoint);
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
			drawLineCrossHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation);
			if (logit && params.debugComments) {
				//console.log("drawHoles/line-cross HoleID: ", name, " : ", tempPoint);
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
			drawLineCircleHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				//console.log("drawHoles/outline-circle HoleID: ", name, " : ", tempPoint);
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
			drawLineCircleHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				//console.log("drawHoles/filled-circle HoleID: ", name, " : ", tempPoint);
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
			drawLineDiamondHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				//console.log("drawHoles/line-diamond HoleID: ", name, " : ", tempPoint);
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
			drawLineSquareHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				//console.log("drawHoles/line-square HoleID: ", name, " : ", tempPoint);
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
			drawLineTriangleHole(scene, colour, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled);
			if (logit && params.debugComments) {
				//console.log("drawHoles/line-triangle HoleID: ", name, " : ", tempPoint);
			}
			break;
		}
		default: {
			const materialType = "basic";
			drawMeshCircleHole(scene, colour, materialType, name, collarXYZ, intervalXYZ, toeXYZ, drawDiam, 100, 4, 32, 2 * Math.PI);
			if (logit && params.debugComments) {
				//console.log("drawHoles/default-circle HoleID: ", name, " : ", tempPoint);
			}
			break;
		}
	}
	drawHoleText(scene, colour, tempPoint);
}
export function drawHoleText(scene, colour, tempPoint) {
	colour = colour || "white";
	const name = tempPoint.pointID;
	const collarXYZ = new Vector3(tempPoint.startXLocation, tempPoint.startYLocation, tempPoint.startZLocation);
	const toeXYZ = tempPoint.endXLocation && tempPoint.endYLocation && tempPoint.endZLocation ? new Vector3(tempPoint.endXLocation, tempPoint.endYLocation, tempPoint.endZLocation) : null;
	// Calculate the interval vector only if subdrill is positive
	const intervalXYZ = tempPoint.endXLocation && tempPoint.endYLocation && tempPoint.endZLocation ? (tempPoint.subdrill > 0 ? calculateIntervalVector(collarXYZ, toeXYZ, tempPoint.subdrill) : toeXYZ) : null;
	//const intervalXYZ = calculateIntervalVector(collarXYZ, toeXYZ, subdrill);
	const holeScale = 3;
	const drawDiam = tempPoint.diameter * holeScale;
	let textSize = 1;
	let textLength = name.length;
	if (params.holeNameDisplay) {
		if (globalFont) {
			const textObject = drawText(scene, colour, globalFont, { x: collarXYZ.x - textLength / 2, y: collarXYZ.y + textSize / 2, z: collarXYZ.z + 0.1 }, name, "holeNameText");
			//console.log("Inside drawHoleText(ID): ", name);
		}
	}
	if (params.holeLengthDisplay && toeXYZ) {
		if (globalFont) {
			const lengthText = collarXYZ.distanceTo(toeXYZ).toFixed(1);
			const textObject = drawText(scene, "#00aaFF", globalFont, { x: collarXYZ.x - textLength / 2, y: collarXYZ.y - textSize, z: collarXYZ.z + 0.1 }, lengthText, "holeLengthText");
			//console.log("Inside drawHoleText(length): ", lengthText);
		}
	}
	if (params.holeDiameterDisplay && tempPoint.diameter) {
		if (globalFont) {
			const diameter = tempPoint.diameter;
			const textObject = drawText(scene, "#33AA22", globalFont, { x: collarXYZ.x - textLength / 2, y: collarXYZ.y - textSize, z: collarXYZ.z + 0.1 }, diameter.toFixed(0), "holeDiameterText");
			//console.log("Inside drawHoleText(diameter): ", diameter.toFixed(0));
		}
	}
	if (!params.holeNameDisplay && !params.holeLengthDisplay && !params.holeDiameterDisplay) {
		//console.log("no text will be displayed. Name:", params.holeNameDisplay, " Length:", params.holeLengthDisplay, " Diameter", params.holeDiameterDisplay);
	}
}

//Draw points that consist of id, x, y, z
export function drawDummys(scene, colour, point) {
	const name = point.pointID;
	const materialType = "basic";
	const vector = new Vector3(point.startXLocation, point.startYLocation, point.startZLocation);
	drawMeshCrossDummy(scene, colour, materialType, name, vector, 100, 4);

	if (params.debugComments) {
		//console.log("drawDummys/crossDummyID: ", name, " : ", point);
	}
	if (globalFont) {
		drawText(scene, colour, globalFont, vector, name);
	}
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
