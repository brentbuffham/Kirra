//createSquareTorus.js
import { MeshBasicMaterial, MeshPhongMaterial, TorusGeometry, Mesh } from "three";
import { Matrix4 } from "three";
import { Vector3 } from "three";

export function createSquareTorus(color, materialType, vector, diameter, thickness, radialSegments, tubularSegments, arc, isSquare) {
	diameter = diameter || 500;
	diameter = diameter / 1000;

	thickness = thickness || 100;
	thickness = thickness / 1000;

	radialSegments = radialSegments || 4;
	tubularSegments = tubularSegments || 4;

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

	if (isSquare) {
		//apply rotation matrix to the square torus rotated 45 degrees z axis
		const rotationMatrix = new Matrix4();
		rotationMatrix.makeRotationZ(Math.PI / 4);
		torus.applyMatrix4(rotationMatrix);
		torus.name = "square-torus";
	} else {
		torus.name = "diamond-torus";
	}

	torus.position.copy(vector);

	return torus;
}
