import { drawHole } from "./hole/drawHole.js";
import { createScene } from "./createScene.js";

export function drawDummy() {
	const { scene, camera, renderer } = createScene();
	drawHole(scene);
}
