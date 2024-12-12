import { openDatabase, writeData, readData } from "../indexDB/dbReadWrite.js";
import { v4 as uuidv4 } from "uuid";

export function parseCSV(data, k3DStoreName) {
	const lines = data.split("\n");
	let minX = Infinity;
	let minY = Infinity;

	let points = [];

	for (let i = 0; i < lines.length; i++) {
		const values = lines[i].split(",");

		if (values.length === 12) {
			//files with
			//id, startXLocation, startYLocation, startZLocation, endXLocation, endYLocation, endZLocation, diameter, subdrill, shapeType
			//shapeType: "mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "outline-circle", "filled-circle","line-diamond", "line-square", "line-triangle"
			const uuid = uuidv4();
			const blastName = values[0];
			const pointID = values[1];
			const startXLocation = parseFloat(values[2]); //start of the blast hole X value
			const startYLocation = parseFloat(values[3]); //start of the blast hole Y value
			const startZLocation = parseFloat(values[4]); //start of the blast hole Z value
			const endXLocation = parseFloat(values[5]); //end of the blast hole X value
			const endYLocation = parseFloat(values[6]); //end of the blast hole Y value
			const endZLocation = parseFloat(values[7]); //end of the blast hole Z value
			const diameter = parseFloat(values[8]); //diameter of the blast hole
			const subdrill = parseFloat(values[9]); //subdrill of the blast hole
			const shapeType = values[10].trim().toLowerCase(); //shape type of the blast hole
			const holeColour = values[11].trim().toLowerCase(); //colour of the blast hole
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
		}
	}

	// Write the points to the database
	(async () => {
		try {
			const db = await openDatabase();
			console.log("Database opened successfully. Attempting to write data...");

			await writeData(db, k3DStoreName, points);
			console.log("Data written successfully to " + k3DStoreName);

			// Attempt to read back the data
			const readBackData = await readData(db, k3DStoreName);
			console.log("Data read back from the database:", readBackData);
		} catch (error) {
			console.error("Failed to write or read data from the database:", error);
		}
	})();

	//Add the Holes to the Local storage
	//localStorage.setItem(k3DStoreName, JSON.stringify(points));

	return points;
}
