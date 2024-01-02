//changeHoleMesh.js
import { drawHoles } from "../entities/drawHoles";

export function changeHoleMesh(scene, points) {
	// Find and remove the old geometry using the point ID
	scene.traverse(function(object) {
		for (const point of points) {
			scene.remove(object);
		}
	});

	for (const point of points) {
		drawHoles(scene, colour, point, diameter, subdrill);
	}

	// Update the scene
	scene.updateMatrixWorld();
}
