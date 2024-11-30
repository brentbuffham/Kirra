import { BufferGeometry, Float32BufferAttribute, Color, Vector2, CircleGeometry, MeshBasicMaterial, DoubleSide, Mesh } from "three";
import { MeshLine, MeshLineMaterial } from "../../helpers/meshLineModified.js";

export function createCircle(color, vector, diameter, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation, isFilled) {
	const holeDiameterM = diameter / 1000;
	const radius = holeDiameterM / 2;
	const segments = 32; // Increase this for a smoother circle

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
		const circleMesh = new Mesh(geometry, material);
		circleMesh.position.set(vector.x, vector.y, vector.z);

		circleMesh.name = "filled-circle-part";

		return circleMesh;
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
		const circleGeometry = new BufferGeometry();
		const positions = [];

		for (let i = 0; i <= segments; i++) {
			const theta = (i / segments) * Math.PI * 2;
			const x = radius * Math.cos(theta);
			const y = radius * Math.sin(theta);

			positions.push(x + vector.x, y + vector.y, vector.z);
		}
		circleGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

		const circle = new MeshLine();
		circle.setGeometry(circleGeometry);

		const circleMesh = new Mesh(circle.geometry, material);

		circleMesh.name = "outline-circle-part";

		return circleMesh;
	}
}
