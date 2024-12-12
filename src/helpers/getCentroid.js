// getCentroid.js
import { Mesh, Group } from "three";
import { params } from "../drawing/createScene.js";

export function getCentroid(points) {
	let sumX = 0,
		sumY = 0,
		sumZ = 0;

	points.forEach((point) => {
		sumX += point.startXLocation;
		sumY += point.startYLocation;
		sumZ += point.startZLocation;
	});

	const centroid = {
		x: parseFloat((sumX / points.length).toFixed(3)),
		y: parseFloat((sumY / points.length).toFixed(3)),
		z: parseFloat((sumZ / points.length).toFixed(3))
	};

	console.log("Centroid in getCentroid: ", centroid);
	return centroid;
}

export function getDXFCentroid(entities) {
	// differnatiate thedifferent types of entities
	let points = [];
	let lines = [];
	let polylines = [];
	let lwpolylines = [];
	let circles = [];
	let ellipses = [];
	let arcs = [];
	let splines = [];
	let meshes = [];
	let text = [];
	let mtext = [];
	let dimensions = [];
	let blocks = [];
	let insert = [];
	let hatch = [];

	entities.forEach((entity) => {
		switch (entity.type) {
			case "POINT":
				points.push(entity);
				break;
			case "LINE":
				lines.push(entity);
				break;
			case "POLYLINE":
				polylines.push(entity);
				break;
			case "LWPOLYLINE":
				lwpolylines.push(entity);
				break;
			case "CIRCLE":
				circles.push(entity);
				break;
			case "ELLIPSE":
				ellipses.push(entity);
				break;
			case "ARC":
				arcs.push(entity);
				break;
			case "SPLINE":
				splines.push(entity);
				break;
			case "MESH":
				meshes.push(entity);
				break;
			case "TEXT":
				text.push(entity);
				break;
			case "MTEXT":
				mtext.push(entity);
				break;
			case "DIMENSION":
				dimensions.push(entity);
				break;
			case "INSERT":
				insert.push(entity);
				break;
			case "HATCH":
				hatch.push(entity);
				break;
			default:
				break;
		}
	});
}

export function getOBJCentroid(object) {
	// Check if the object is a Mesh and has geometry
	if (object instanceof Mesh && object.geometry) {
		object.geometry.computeBoundingBox();
		const boundingBox = object.geometry.boundingBox;
		const x = (boundingBox.min.x + boundingBox.max.x) / 2;
		const y = (boundingBox.min.y + boundingBox.max.y) / 2;
		const z = (boundingBox.min.z + boundingBox.max.z) / 2;
		return {
			x: parseFloat(x.toFixed(3)),
			y: parseFloat(y.toFixed(3)),
			z: parseFloat(z.toFixed(3))
		};
	} else if (object instanceof Group) {
		// If the object is a Group, calculate the centroid from all child meshes
		let totalX = 0,
			totalY = 0,
			totalZ = 0,
			count = 0;
		object.traverse((child) => {
			if (child instanceof Mesh && child.geometry) {
				child.geometry.computeBoundingBox();
				const boundingBox = child.geometry.boundingBox;
				totalX += (boundingBox.min.x + boundingBox.max.x) / 2;
				totalY += (boundingBox.min.y + boundingBox.max.y) / 2;
				totalZ += (boundingBox.min.z + boundingBox.max.z) / 2;
				count++;
			}
		});
		if (count === 0) return { x: 0, y: 0, z: 0 }; // Handle the case where there are no valid meshes
		return {
			x: parseFloat((totalX / count).toFixed(3)),
			y: parseFloat((totalY / count).toFixed(3)),
			z: parseFloat((totalZ / count).toFixed(3))
		};
	}
	// Default return if the object is neither a Mesh nor a Group
	return { x: 0, y: 0, z: 0 };
}

export function getPointCloudCentroid(points) {
	let sumX = 0,
		sumY = 0,
		sumZ = 0;

	points.forEach((point) => {
		sumX += point.pointX;
		sumY += point.pointY;
		sumZ += point.pointZ;
	});

	const centroid = {
		x: parseFloat((sumX / points.length).toFixed(3)),
		y: parseFloat((sumY / points.length).toFixed(3)),
		z: parseFloat((sumZ / points.length).toFixed(3))
	};

	console.log("Centroid in getPointCloudCentroid: ", centroid);
	return centroid;
}
