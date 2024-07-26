// fileCSVLoader.js

export function parseHoles(parsedData, selectedColumns) {
	const points = [];

	parsedData.forEach((values) => {
		const point = {};

		for (const [key, index] of Object.entries(selectedColumns)) {
			point[key] = values[index];
		}

		const pointID = point.holeName;
		const startXLocation = parseFloat(point.startX);
		const startYLocation = parseFloat(point.startY);
		const startZLocation = parseFloat(point.startZ);

		if (!isNaN(startXLocation) && !isNaN(startYLocation) && !isNaN(startZLocation)) {
			const holePoint = {
				pointID,
				startXLocation,
				startYLocation,
				startZLocation,
				endXLocation: null,
				endYLocation: null,
				endZLocation: null,
				diameter: null,
				subdrill: null,
				shapeType: null,
				holeColour: null
			};

			for (const [key, index] of Object.entries(selectedColumns)) {
				if (index >= 0 && values[index] !== undefined) {
					if (["endX", "endY", "endZ", "diameter", "subdrill"].includes(key)) {
						holePoint[key] = parseFloat(values[index]);
					} else {
						holePoint[key] = values[index]?.trim().toLowerCase();
					}
				}
			}

			points.push(holePoint);
		}
	});

	localStorage.setItem("holes", JSON.stringify(points));
	return points;
}
