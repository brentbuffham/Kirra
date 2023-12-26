export function parseCSV(data, blastNameValue) {
    const lines = data.split("\n");
    let minX = Infinity;
    let minY = Infinity;
    const entityType = "hole";
    const points = [];

    for (let i = 0; i < lines.length; i++) {
        const values = lines[i].split(",");
        if (values.length === 4) {
            //files with id, x, y, z
            // check if it has the correct number of values
            const entityName = blastNameValue;
            const holeID = values[0];
            const startXLocation = parseFloat(values[1]); //start of the blast hole X value
            const startYLocation = parseFloat(values[2]); //start of the blast hole Y value
            const startZLocation = parseFloat(values[3]); //start of the blast hole Z value
            const endXLocation = parseFloat(values[1]); //end of the blast hole X value
            const endYLocation = parseFloat(values[2]); //end of the blast hole Y value
            const endZLocation = parseFloat(values[3]); //end of the blast hole Z value
            const holeDiameter = 0;
            const holeType = "Undefined";
            const holeLengthCalculated = 0;
            const holeAngle = 0;
            const holeBearing = 0;
            const fromHoleID = `${blastNameValue}:::${values[0]}`;
            const timingDelayMilliseconds = 0;
            const colourHexDecimal = "red";
            if (!isNaN(startXLocation) && !isNaN(startYLocation) && !isNaN(startZLocation)) {
                // check if they are valid numbers
                points.push({
                    entityName,
                    entityType,
                    holeID,
                    startXLocation,
                    startYLocation,
                    startZLocation,
                    endXLocation,
                    endYLocation,
                    endZLocation,
                    holeDiameter,
                    holeType,
                    fromHoleID,
                    timingDelayMilliseconds,
                    colourHexDecimal,
                    holeLengthCalculated,
                    holeAngle,
                    holeBearing
                });
                minX = Math.min(minX, startXLocation);
                minY = Math.min(minY, startYLocation);
            }
        }
    }
    return points;
}
