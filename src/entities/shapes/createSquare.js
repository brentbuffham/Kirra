import { BufferGeometry, Mesh, CircleGeometry, MeshBasicMaterial, DoubleSide, Float32BufferAttribute, Color, Vector2, Vector3, Matrix4 } from "three";
import { MeshLineMaterial, MeshLine } from "../../helpers/meshLineModified.js";

export function createSquare(color, vector, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isSquare, isFilled) {
	const holeDiameterM = diameter / 1000;
	const radius = holeDiameterM / 2;
	const segments = 4; // Square has 4 sides
	const rotationMatrix = new Matrix4();
	rotationMatrix.makeRotationZ(Math.PI / 4); // Rotate by 45 degrees
	if (isFilled) {
		// Create a filled circle
		const geometry = new CircleGeometry(radius, segments);
		// When creating the material for the filled circle:
		const material = new MeshBasicMaterial({
			color: new Color(color),
			opacity: opacity,
			transparent: opacity < 1,
			side: DoubleSide // Stops the circle from disappearing when rotating the camera
		});
		const squareMesh = new Mesh(geometry, material);
		if (isSquare) {
			//apply rotation matrix to the square torus rotated 45 degrees z axis
			squareMesh.applyMatrix4(rotationMatrix);
		}
		squareMesh.position.set(vector.x, vector.y, vector.z);

		squareMesh.name = "filled-square";

		return squareMesh;
	} else {
		// Create a circle outline
		const material = new MeshLineMaterial({
			color: new Color(color),
			opacity: opacity,
			resolution: new Vector2(window.innerWidth, window.innerHeight),
			lineWidth: lineWidth,
			dashArray: dashArray,
			dashOffset: dashOffset,
			dashRatio: dashRatio,
			sizeAttenuation: sizeAttenuation
		});

		const squareGeometry = new BufferGeometry();
		const positions = [];

		for (let i = 0; i <= segments; i++) {
			const theta = (i / segments) * Math.PI * 2;
			const x = radius * Math.cos(theta);
			const y = radius * Math.sin(theta);
			if (isSquare) {
				// Apply rotation to each vertex
				const rotatedVertex = new Vector3(x, y, vector.z).applyMatrix4(rotationMatrix);
				positions.push(rotatedVertex.x + vector.x, rotatedVertex.y + vector.y, rotatedVertex.z);
			}
		}
		squareGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

		const square = new MeshLine();
		square.setGeometry(squareGeometry);
		const squareMesh2 = new Mesh(square.geometry, material);

		squareMesh2.name = "outline-square";

		return squareMesh2;
	}
}
