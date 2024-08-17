import { BufferGeometry, Mesh, CircleGeometry, MeshBasicMaterial, DoubleSide, Float32BufferAttribute, Color, Vector2, Vector3, Matrix4 } from "three";
import { MeshLineMaterial, MeshLine } from "../../helpers/MeshLineModified.js";

export function createAnyShape(color, vector, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, segments, isFilled) {
	const holeDiameterM = diameter / 1000;
	const radius = holeDiameterM / 2;
	segments = segments; // anyShape has 4 sides
	const rotationMatrix = new Matrix4();
	rotationMatrix.makeRotationZ(Math.PI / (segments * 2));
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
		const anyShapeMesh = new Mesh(geometry, material);

		//apply rotation matrix to the anyShape torus rotated 45 degrees z axis
		anyShapeMesh.applyMatrix4(rotationMatrix);

		anyShapeMesh.position.set(vector.x, vector.y, vector.z);

		anyShapeMesh.name = "filled-anyShape";

		return anyShapeMesh;
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

		const anyShapeGeometry = new BufferGeometry();
		const positions = [];

		for (let i = 0; i <= segments; i++) {
			const theta = (i / segments) * Math.PI * 2;
			const x = radius * Math.cos(theta);
			const y = radius * Math.sin(theta);

			// Apply rotation to each vertex
			const rotatedVertex = new Vector3(x, y, vector.z).applyMatrix4(rotationMatrix);
			positions.push(rotatedVertex.x + vector.x, rotatedVertex.y + vector.y, rotatedVertex.z);
		}
		anyShapeGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

		const anyShape = new MeshLine();
		anyShape.setGeometry(anyShapeGeometry);
		const anyShapeMesh2 = new Mesh(anyShape.geometry, material);

		anyShapeMesh2.name = "outline-anyShape";

		return anyShapeMesh2;
	}
}
