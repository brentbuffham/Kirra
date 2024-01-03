//createLine.js
import * as THREE from "three";
import { BufferGeometry, Vector3, Vector2, Color } from "three";
import { MeshLine, MeshLineMaterial } from "three.meshline";

export function createLine(start, end, color, lineWidth, dashArray, dashOffset, dashRatio, opacity, sizeAttenuation) {
	const material = new MeshLineMaterial({
		map: null,
		useMap: false,
		color: new Color(color),
		opacity: opacity,
		resolution: new Vector2(window.innerWidth, window.innerHeight),
		lineWidth: lineWidth,
		dashArray: dashArray,
		dashOffset: dashOffset,
		dashRatio: dashRatio,
		opacity: opacity,
		sizeAttenuation: sizeAttenuation
	});
	const points = [];
	points.push(new Vector3(start.x, start.y, start.z));
	points.push(new Vector3(end.x, end.y, end.z));

	const line = new MeshLine();
	const geometry = new BufferGeometry().setFromPoints(points);
	line.setGeometry(geometry);

	const mesh = new THREE.Mesh(line, material);

	return mesh;
}
