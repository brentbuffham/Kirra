//drawDummy.js
import {createLine} from "./createLine.js";

export function drawDummy(scene, x, y, z) {
    const size = 0.5;

    const points = {
        topLeft: {x: x - size, y: y + size, z},
        topRight: {x: x + size, y: y + size, z},
        bottomLeft: {x: x - size, y: y - size, z},
        bottomRight: {x: x + size, y: y - size, z}
    };

    createLine(scene, points.topLeft, points.bottomRight);
    createLine(scene, points.bottomLeft, points.topRight, 'blue');
}

