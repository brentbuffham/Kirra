import { v4 as uuidv4 } from "uuid";
import { openDatabase, writeData, readData } from "../indexDB/dbReadWrite.js";

export const parseCSV = (data, columnOrder, csvFileName) => {
	if (!data) {
		console.error("Data is null or undefined");
		return [];
	}
	let minX = Infinity;
	let minY = Infinity;
	let points = [];
	const headerRows = parseInt(columnOrder.headerRows, 10) || 0;
	let pointIDCounter = -1; // Initialize pointID counter for default incremental values
	const datetimeNow = Date.now();
	data.slice(headerRows).forEach((row, index) => {
		const point = {};

		const uuid = uuidv4();
		// Map columns based on user-defined column order
		const blastName = row[Object.keys(row)[columnOrder.blastName - 1]] || `tempBlast_${datetimeNow}`;
		//console.log("blastName: ", blastName);
		const pointID = String(row[Object.keys(row)[columnOrder.pointID - 1]] || pointIDCounter--);
		//console.log("pointID: ", pointID);
		const startXLocation = parseFloat(row[Object.keys(row)[columnOrder.startXLocation - 1]]);
		//console.log("startXLocation: ", startXLocation);
		const startYLocation = parseFloat(row[Object.keys(row)[columnOrder.startYLocation - 1]]);
		//console.log("startYLocation: ", startYLocation);
		const startZLocation = parseFloat(row[Object.keys(row)[columnOrder.startZLocation - 1]]);
		//console.log("startZLocation: ", startZLocation);
		const endXLocation = parseFloat(row[Object.keys(row)[columnOrder.endXLocation - 1]]) || null;
		//console.log("endXLocation: ", endXLocation);
		const endYLocation = parseFloat(row[Object.keys(row)[columnOrder.endYLocation - 1]]) || null;
		//console.log("endYLocation: ", endYLocation);
		const endZLocation = parseFloat(row[Object.keys(row)[columnOrder.endZLocation - 1]]) || null;
		//console.log("endZLocation: ", endZLocation);
		const diameter_2 = parseFloat(row[Object.keys(row)[columnOrder.diameter - 1]] * 1000); // if diameter is in meters
		//console.log("diameter_2: ", diameter_2);
		const diameter_1 = parseFloat(row[Object.keys(row)[columnOrder.diameter - 1]]); // if diameter is in mm
		//console.log("diameter_1: ", diameter_1);
		const diameter = parseFloat(columnOrder.diameter_unit === "mm" ? diameter_1 || 0 : diameter_2 || null);
		//console.log("diameter: ", diameter);
		const subdrill = parseFloat(row[Object.keys(row)[columnOrder.subdrill - 1]] || null);
		//console.log("subdrill: ", subdrill);
		const shapeType = row[Object.keys(row)[columnOrder.shapeType - 1]]; // || (diameter === 0 || diameter === null || diameter === undefined ? "mesh-cube" : "mesh-cylinder");
		//console.log("shapeType: ", shapeType);
		const holeColour = row[Object.keys(row)[columnOrder.holeColour - 1]]; // || 0xffffff;
		//console.log("holeColour: ", holeColour);

		if (!isNaN(startXLocation) && !isNaN(startYLocation) && !isNaN(startZLocation) && !isNaN(endXLocation) && !isNaN(endYLocation) && !isNaN(endZLocation)) {
			// check if they are valid numbers
			points.push({
				uuid,
				blastName,
				pointID,
				startXLocation,
				startYLocation,
				startZLocation,
				endXLocation,
				endYLocation,
				endZLocation,
				diameter,
				subdrill,
				shapeType,
				holeColour
			});
			minX = Math.min(minX, startXLocation);
			minY = Math.min(minY, startYLocation);
		}
	});

	const csvBlastStore = "CSV_BlastStore";
	// Write the points to the database
	(async () => {
		try {
			const db = await openDatabase();
			console.log("Database opened successfully. Attempting to write data...");

			await writeData(db, csvBlastStore, points);
			console.log("Data written successfully to " + csvBlastStore);

			// Attempt to read back the data
			const readBackData = await readData(db, csvBlastStore);
			console.log("Data read back from the database:", readBackData);
		} catch (error) {
			console.error("Failed to write or read data from the database:", error);
		}
	})();

	// Save the points to localStorage
	//localStorage.setItem(csvFileName, JSON.stringify(points));

	return points;
};
