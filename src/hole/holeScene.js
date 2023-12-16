import {drawLines} from "../threeTrail/drawLines.js";
import {createScene} from "../threeTrail/createScene.js";

export function createHole() {
    const scene = createScene();
    drawLines(scene);
}
