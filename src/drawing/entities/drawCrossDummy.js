//drawDummy.js
import { createLine } from "../shapes/createLine.js";

export function drawCrossDummy(scene, colour, vector) {
	const size = 0.5;
	const x = vector.x;
	const y = vector.y;
	const z = vector.z;

	const points = {
		topLeft: { x: x - size, y: y + size, z },
		topRight: { x: x + size, y: y + size, z },
		bottomLeft: { x: x - size, y: y - size, z },
		bottomRight: { x: x + size, y: y - size, z }
	};

	createLine(scene, points.topLeft, points.bottomRight, colour);
	createLine(scene, points.bottomLeft, points.topRight, colour);
}
