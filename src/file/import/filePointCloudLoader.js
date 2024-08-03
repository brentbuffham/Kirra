// filePointCloudLoader.js
export const parsePointCloud = (data, pointCloudOrder) => {
	if (!data) {
		console.error("Data is null or undefined");
		return [];
	}

	let minX = Infinity;
	let minY = Infinity;
	let cloudPoints = [];
	const headerRows = parseInt(pointCloudOrder.headerRows, 10) || 0;
	let pointIDCounter = -1; // Initialize pointID counter for default incremental values

	data.slice(headerRows).forEach((row) => {
		const pointID = String(row[Object.keys(row)[pointCloudOrder.pointID - 1]] || pointIDCounter--);
		const pointX = parseFloat(row[Object.keys(row)[pointCloudOrder.pointX - 1]]);
		const pointY = parseFloat(row[Object.keys(row)[pointCloudOrder.pointY - 1]]);
		const pointZ = parseFloat(row[Object.keys(row)[pointCloudOrder.pointZ - 1]]);
		const pointR = parseFloat(row[Object.keys(row)[pointCloudOrder.pointR - 1]]);
		const pointG = parseFloat(row[Object.keys(row)[pointCloudOrder.pointG - 1]]);
		const pointB = parseFloat(row[Object.keys(row)[pointCloudOrder.pointB - 1]]);
		const pointA = parseFloat(row[Object.keys(row)[pointCloudOrder.pointA - 1]]);

		if (!isNaN(pointX) && !isNaN(pointY) && !isNaN(pointZ)) {
			cloudPoints.push({
				pointID,
				pointX,
				pointY,
				pointZ,
				pointR,
				pointG,
				pointB,
				pointA
			});
			minX = Math.min(minX, pointX);
			minY = Math.min(minY, pointY);
		}
	});

	// Save the points to localStorage
	localStorage.setItem("cloudPoints", JSON.stringify(cloudPoints));

	return cloudPoints;
};
