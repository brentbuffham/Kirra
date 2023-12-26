import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, PerspectiveCamera, Vector3, WebGLRenderer } from "three";

export function drawHole(scene) {
	//create a blue LineBasicMaterial
	const material = new LineBasicMaterial({ color: 0xffffff });

	const holeCollarXYZ = new Vector3(0, 0, 10);
	const holeIntervalXYZ = new Vector3(0, 0, 1);
	const holeToeXYZ = new Vector3(0, 0, 0);

	const points = [];
	points.push(holeCollarXYZ);
	points.push(holeIntervalXYZ);
	points.push(holeToeXYZ);

	// Create a circle geometry
	const holeDiameterMM = 200;
	const holeDiameterM = holeDiameterMM / 1000;
	const radius = holeDiameterM / 2;
	const segments = 32; // Increase this for a smoother circle
	const circleGeometry = new BufferGeometry();
	const positions = [];

	for (let i = 0; i <= segments; i++) {
		const theta = i / segments * Math.PI * 2;
		const x = radius * Math.cos(theta);
		const y = radius * Math.sin(theta);

		positions.push(x, y, 0);
	}
	const geometry = new BufferGeometry().setFromPoints(points);
	circleGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

	const line = new Line(geometry, material);
	const circle = new Line(circleGeometry, material);

	scene.add(line);
	scene.add(circle);
}
