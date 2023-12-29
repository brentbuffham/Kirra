import { LineBasicMaterial, BufferGeometry, Float32BufferAttribute, Line, Vector3, Matrix4 } from "three";

export function createSquare(scene, color, vector, diameter) {
	const material = new LineBasicMaterial({ color });
	const holeDiameterM = diameter / 1000;
	const radius = holeDiameterM / 2;
	const segments = 4; // Increase this for a smoother circle
	const squareGeometry = new BufferGeometry();
	const positions = [];
	const rotationMatrix = new Matrix4();
	rotationMatrix.makeRotationZ(Math.PI / 4); // Rotate by 45 degrees

	for (let i = 0; i <= segments; i++) {
		const theta = i / segments * Math.PI * 2;
		const x = radius * Math.cos(theta);
		const y = radius * Math.sin(theta);

		// Apply rotation to each vertex
		const rotatedVertex = new Vector3(x, y, vector.z).applyMatrix4(rotationMatrix);
		positions.push(rotatedVertex.x + vector.x, rotatedVertex.y + vector.y, rotatedVertex.z);
	}
	squareGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

	const square = new Line(squareGeometry, material);
	scene.add(square);
}
