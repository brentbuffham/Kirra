//createTorus.js
import { MeshBasicMaterial, MeshPhongMaterial, TorusGeometry, Mesh } from "three";

export function createTorus(color, materialType, vector, diameter, thickness, radialSegments, tubularSegments, arc) {
	diameter = diameter || 500;
	diameter = diameter / 1000;

	thickness = thickness || 100;
	thickness = thickness / 1000;

	radialSegments = radialSegments || 4;
	tubularSegments = tubularSegments || 32;

	let material;
	if (materialType === "basic") {
		material = new MeshBasicMaterial({ color });
	} else if (materialType === "phong") {
		material = new MeshPhongMaterial({
			color: color, // red (can also use a CSS color string here)
			flatShading: true
		});
	}

	const geometry = new TorusGeometry(diameter / 2, thickness / 2, radialSegments, tubularSegments, arc);
	const torus = new Mesh(geometry, material);
	torus.position.copy(vector);

	torus.name = "circle-torus";

	return torus;
}
