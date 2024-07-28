// fileCSVLoader.js
export const parseCSV = (data, columnOrder) => {
	if (!data) {
		console.error("Data is null or undefined");
		return [];
	}

	const parsedData = [];
	const headerRows = parseInt(columnOrder.headerRows) || 0;

	data.slice(headerRows - 1).forEach((row) => {
		const point = {};

		// Map columns based on user-defined column order
		point.blastName = row[Object.keys(row)[columnOrder.blastName - 1]];
		point.pointID = row[Object.keys(row)[columnOrder.pointID - 1]];
		point.startXLocation = row[Object.keys(row)[columnOrder.startXLocation - 1]];
		point.startYLocation = row[Object.keys(row)[columnOrder.startYLocation - 1]];
		point.startZLocation = row[Object.keys(row)[columnOrder.startZLocation - 1]];
		point.endXLocation = row[Object.keys(row)[columnOrder.endXLocation - 1]];
		point.endYLocation = row[Object.keys(row)[columnOrder.endYLocation - 1]];
		point.endZLocation = row[Object.keys(row)[columnOrder.endZLocation - 1]];
		point.diameter = row[Object.keys(row)[columnOrder.diameter - 1]];
		point.subdrill = row[Object.keys(row)[columnOrder.subdrill - 1]];
		point.shapeType = row[Object.keys(row)[columnOrder.shapeType - 1]];
		point.holeColour = row[Object.keys(row)[columnOrder.holeColour - 1]];

		parsedData.push(point);
	});

	return parsedData;
};
