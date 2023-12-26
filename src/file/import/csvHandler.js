import { updateScene } from "../../drawing/createScene";

export function parseCSV(data) {
	const lines = data.split("\n");
	let minX = Infinity;
	let minY = Infinity;
	const points = [];

	for (let i = 0; i < lines.length; i++) {
		const values = lines[i].split(",");
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
	}
	console.log("Points: ", points);

	return points;
}
