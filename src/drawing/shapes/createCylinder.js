//createCylinder.js
import { MeshBasicMaterial, MeshPhongMaterial, CylinderGeometry, Mesh } from "three";
import { Vector3 } from "three";

export function createCylinder(scene, color, materialType, startVector, endVector, diameter, radialSegments) {
	diameter = diameter || 500;
	diameter = diameter / 1000;
	let material;
	if (materialType === "basic") {
		material = new MeshBasicMaterial({ color });
	} else if (materialType === "phong") {
		material = new MeshPhongMaterial({
			color: color, // red (can also use a CSS color string here)
			flatShading: true
		});
	}

	const height = startVector.distanceTo(endVector);
	const direction = endVector.clone().sub(startVector).normalize();
	const position = startVector.clone().add(endVector).multiplyScalar(0.5);

	const geometry = new CylinderGeometry(diameter / 2, diameter / 2, height, radialSegments);
	const cylinder = new Mesh(geometry, material);

	//add a rotation matrix with the fulcrum at the startVector and the endVector being the base of the cylinder
	cylinder.position.copy(position);
	cylinder.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);

	scene.add(cylinder);
}
