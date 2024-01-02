export function getCentroid(points) {
	let sumX = 0,
		sumY = 0,
		sumZ = 0;

	points.forEach(point => {
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
