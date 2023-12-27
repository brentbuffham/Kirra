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
                    startZLocation,
                });
                minX = Math.min(minX, startXLocation);
                minY = Math.min(minY, startYLocation);
            }
        }
    }

    return points;
}

export function getCentroid(data) {
    if (typeof data !== "string") {
        console.error("Data is not a string:", data);
        return {x: 0, y: 0, z: 0}; // Provide default values or handle the error appropriately
    }

    const lines = data.split("\n");

    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;

    const points = lines.map(line => {
        const values = line.split(",");
        return {
            pointId: values[0],
            startXLocation: parseFloat(values[1]),
            startYLocation: parseFloat(values[2]),
            startZLocation: parseFloat(values[3])
        };
    });

    for (let i = 0; i < points.length; i++) {
        sumX += points[i].startXLocation;
        sumY += points[i].startYLocation;
        sumZ += points[i].startZLocation;
    }

    const centroidX = sumX / points.length;
    const centroidY = sumY / points.length;
    const centroidZ = sumZ / points.length;

    return {x: centroidX, y: centroidY, z: centroidZ};
}
