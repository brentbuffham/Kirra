import { BufferGeometry, Float32BufferAttribute, Color, Vector2 } from "three";
import { MeshLine, MeshLineMaterial } from "../helpers/MeshLineModified.js";

export function createCircle(color, vector, diameter, lineWidth, dashed, dashSize, gapSize, transparent, opacity, sizeAttenuation) {
	const material = new MeshLineMaterial({
		map: null,
		useMap: false,
		color: new Color(color),
		opacity: 1,
		resolution: new Vector2(window.innerWidth, window.innerHeight),
		lineWidth: lineWidth,
		dashed: dashed,
		dashSize: dashSize,
		gapSize: gapSize,
		transparent: transparent,
		opacity: opacity,
		sizeAttenuation: sizeAttenuation
	});
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

	const circle = new MeshLine();
	circle.setGeometry(circleGeometry, function(p) {
		return p;
	});
	const circleMesh = new Mesh(circle.geometry, material);

	return circleMesh;
}
