//createLine.js
import { BufferGeometry, Vector3, Vector2, Mesh, Color } from "three";
import { MeshLine, MeshLineMaterial } from "three.meshline/src/THREE.MeshLine";

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

	start = new Vector3(start.x, start.y, start.z);
	end = new Vector3(end.x, end.y, end.z);

	const points = [start, end];

	const line = new MeshLine();
	const geometry = new BufferGeometry().setFromPoints(points);
	console.log(geometry);
	line.setGeometry(geometry);

	const mesh = new Mesh(line, material);

	return mesh;
}
