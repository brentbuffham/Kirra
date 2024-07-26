//Modify this to be specific for a k3D file format in future

export function parseCSV(data) {
	const lines = data.split("\n");
	let minX = Infinity;
	let minY = Infinity;

	let points = [];

	for (let i = 0; i < lines.length; i++) {
		const values = lines[i].split(",");
		/*
		if (values.length === 4) {
			//files with id, x, y, z
			const pointID = values[0];
			const startXLocation = parseFloat(values[1]); //start of the blast hole X value
			const startYLocation = parseFloat(values[2]); //start of the blast hole Y value
			const startZLocation = parseFloat(values[3]); //start of the blast hole Z value
			if (!isNaN(startXLocation) && !isNaN(startYLocation) && !isNaN(startZLocation)) {
				// check if they are valid numbers
				points.push({
					pointID,
					startXLocation,
					startYLocation,
					startZLocation
				});
				minX = Math.min(minX, startXLocation);
				minY = Math.min(minY, startYLocation);
			}
		}
		if (values.length === 7) {
			//files with id, x, y, z, x, y, z
			const pointID = values[0];
			const startXLocation = parseFloat(values[1]); //start of the blast hole X value
			const startYLocation = parseFloat(values[2]); //start of the blast hole Y value
			const startZLocation = parseFloat(values[3]); //start of the blast hole Z value
			const endXLocation = parseFloat(values[4]); //end of the blast hole X value
			const endYLocation = parseFloat(values[5]); //end of the blast hole Y value
			const endZLocation = parseFloat(values[6]); //end of the blast hole Z value
			if (!isNaN(startXLocation) && !isNaN(startYLocation) && !isNaN(startZLocation) && !isNaN(endXLocation) && !isNaN(endYLocation) && !isNaN(endZLocation)) {
				// check if they are valid numbers
				points.push({
					pointID,
					startXLocation,
					startYLocation,
					startZLocation,
					endXLocation,
					endYLocation,
					endZLocation
				});
				minX = Math.min(minX, startXLocation);
				minY = Math.min(minY, startYLocation);
			}
		}
		if (values.length === 10) {
			//files with
			//id, startXLocation, startYLocation, startZLocation, endXLocation, endYLocation, endZLocation, diameter, subdrill, shapeType
			//shapeType: "mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "outline-circle", "filled-circle","line-diamond", "line-square", "line-triangle"
			const pointID = values[0];
			const startXLocation = parseFloat(values[1]); //start of the blast hole X value
			const startYLocation = parseFloat(values[2]); //start of the blast hole Y value
			const startZLocation = parseFloat(values[3]); //start of the blast hole Z value
			const endXLocation = parseFloat(values[4]); //end of the blast hole X value
			const endYLocation = parseFloat(values[5]); //end of the blast hole Y value
			const endZLocation = parseFloat(values[6]); //end of the blast hole Z value
			const diameter = parseFloat(values[7]); //diameter of the blast hole
			const subdrill = parseFloat(values[8]); //subdrill of the blast hole
			const shapeType = values[9].trim().toLowerCase(); //shape type of the blast hole
			if (!isNaN(startXLocation) && !isNaN(startYLocation) && !isNaN(startZLocation) && !isNaN(endXLocation) && !isNaN(endYLocation) && !isNaN(endZLocation)) {
				// check if they are valid numbers
				points.push({
					pointID,
					startXLocation,
					startYLocation,
					startZLocation,
					endXLocation,
					endYLocation,
					endZLocation,
					diameter,
					subdrill,
					shapeType
				});
				minX = Math.min(minX, startXLocation);
				minY = Math.min(minY, startYLocation);
			}
		}
		*/
		if (values.length === 12) {
			//files with
			//id, startXLocation, startYLocation, startZLocation, endXLocation, endYLocation, endZLocation, diameter, subdrill, shapeType
			//shapeType: "mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "outline-circle", "filled-circle","line-diamond", "line-square", "line-triangle"
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
	//Add the Holes to the Loacal storage
	localStorage.setItem("Holes", JSON.stringify(points));

	return points;
}
