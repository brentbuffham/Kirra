import { LineBasicMaterial, BufferGeometry, Float32BufferAttribute, Line } from "three";

export function createCircle(scene, color, vector, diameter) {
	const material = new LineBasicMaterial({ color });
	const holeDiameterM = diameter / 1000;
	const radius = holeDiameterM / 2;
	const segments = 32; // Increase this for a smoother circle
	const circleGeometry = new BufferGeometry();
	const positions = [];

	for (let i = 0; i <= segments; i++) {
		const theta = i / segments * Math.PI * 2;
		const x = radius * Math.cos(theta);
		const y = radius * Math.sin(theta);

		positions.push(x + vector.x, y + vector.y, vector.z);
	}
	circleGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

	const circle = new Line(circleGeometry, material);
	scene.add(circle);
}
