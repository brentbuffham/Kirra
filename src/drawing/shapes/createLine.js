import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from "three";

export function createLine(scene, start, end, color) {
	const material = new LineBasicMaterial({ color });
	const points = [];
	points.push(new Vector3(start.x, start.y, start.z));
	points.push(new Vector3(end.x, end.y, end.z));

	const geometry = new BufferGeometry().setFromPoints(points);
	const line = new Line(geometry, material);
	scene.add(line);
}
