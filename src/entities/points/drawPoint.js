import { BufferAttribute, BufferGeometry, Vector3, Color } from "three";
import { PointsMaterial, Points } from "three";

export function drawPoint(scene, point) {
	geometry.setAttribute("position", new BufferAttribute(vertices, 3));

	const pointColour = new Color(`rgb(${point.pointR},${point.pointG},${point.pointB})`);
	const pointXYZ = new Vector3(point.pointX, point.pointY, point.pointZ);
	const pointAlpha = point.pointA;

	// Create the material
	const material = new PointsMaterial({ color: pointColour, size: 0.1, opacity: pointAlpha, transparent: true });

	// Create the points
	cloudPoints = new Points(geometry, material);

	cloudPoints.name = "cloudPoints";
	cloudPoints.userData = {
		entityType: "point",
		pointID: pointID,
		pointX: pointX,
		pointY: pointY,
		pointZ: pointZ,
		pointR: pointR,
		pointG: pointG,
		pointB: pointB,
		pointA: pointA
	};

	// Add to the scene
	scene.add(points);
}
