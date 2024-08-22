// filePointCloudLoader.js
import { v4 as uuidv4 } from "uuid";
import { deleteData, readData, writeData, openDatabase } from "../indexDB/dbReadWrite";

export const parsePointCloud = (data, pointCloudOrder, pointCloudName) => {
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
		const uuid = uuidv4();
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
				uuid,
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

	const csvPointCloudStore = "CSV_PointCloudStore";
	// Write the cloudPoints to the database
	(async () => {
		try {
			const db = await openDatabase();
			console.log("Database opened successfully. Attempting to write data...");
			console.log("Data to write:", cloudPoints);

			await writeData(db, csvPointCloudStore, cloudPoints);
			console.log("Data written successfully to CSV_PointCloudStore");

			// Attempt to read back the data
			const readBackData = await readData(db, csvPointCloudStore);
			console.log("Data read back from the database:", readBackData);
		} catch (error) {
			console.error("Failed to write or read data from the database:", error);
		}
	})();

	return cloudPoints;
};
