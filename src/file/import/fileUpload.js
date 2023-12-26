import {parseCSV} from "./csvHandler.js";

export const renderFileUpload = (containerId) => {
    const container = document.querySelector(containerId); // or '#left-panel' if it's an id
    const fileUpload = `
    <div id="file-upload">
         <input type="file" id="file-input" />
         <label for="file-input">Choose a file</label>
    </div>
`;

    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = fileUpload;
    container.appendChild(tempContainer);

    document.getElementById("file-input").addEventListener("change", handleFileUpload);
}
const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    const reader = new FileReader();

    reader.onload = function (event) {
        const data = event.target.result;

        if (!file.name.toLowerCase().endsWith(".csv")) {
            return;
        }


        const points = parseCSV(data, "blastNameValue");
    };

    reader.readAsText(file);

    // if (values.length === 4) {
    //     // Skip empty lines and lines with fewer than 14 values
    //     if (values.length < 4) {
    //         continue;
    //     }
    //     //files with id, x, y, z
    //     // check if it has the correct number of values
    //     const entityName = blastNameValue;
    //     const holeID = values[0];
    //     const startXLocation = parseFloat(values[1]); //start of the blast hole X value
    //     const startYLocation = parseFloat(values[2]); //start of the blast hole Y value
    //     const startZLocation = parseFloat(values[3]); //start of the blast hole Z value
    //     const endXLocation = parseFloat(values[1]); //end of the blast hole X value
    //     const endYLocation = parseFloat(values[2]); //end of the blast hole Y value
    //     const endZLocation = parseFloat(values[3]); //end of the blast hole Z value
    //     const holeDiameter = 0;
    //     const holeType = "Undefined";
    //     const holeLengthCalculated = 0;
    //     const holeAngle = 0;
    //     const holeBearing = 0;
    //     const fromHoleID = `${blastNameValue}:::${values[0]}`;
    //     const timingDelayMilliseconds = 0;
    //     const colourHexDecimal = "red";
    //     if (!isNaN(startXLocation) && !isNaN(startYLocation) && !isNaN(startZLocation)) {
    //         // check if they are valid numbers
    //         points.push({
    //             entityName,
    //             entityType,
    //             holeID,
    //             startXLocation,
    //             startYLocation,
    //             startZLocation,
    //             endXLocation,
    //             endYLocation,
    //             endZLocation,
    //             holeDiameter,
    //             holeType,
    //             fromHoleID,
    //             timingDelayMilliseconds,
    //             colourHexDecimal,
    //             holeLengthCalculated,
    //             holeAngle,
    //             holeBearing
    //         });
    //         minX = Math.min(minX, startXLocation);
    //         minY = Math.min(minY, startYLocation);
    //     }
    //     //} else if (localStorage.getItem("kirraDataPoints") !== null) {
    //     //return points;
    // }
};

function getCentroid(data) {
    const lines = data.split("\n");
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;

    // Assuming 'points' should be filled with parsed values from 'lines'
    const points = lines.map(line => {
        const values = line.split(",");
        return {
            pointId: values[0],
            startXLocation: parseFloat(values[1]),
            startYLocation: parseFloat(values[2]),
            startZLocation: parseFloat(values[3])
        }
    });

    for (let i = 0; i < points.length; i++) {
        sumX += points[i].startXLocation;
        sumY += points[i].startYLocation;
        sumZ += points[i].startZLocation;
    }

    const centroidX = sumX / points.length;
    const centroidY = sumY / points.length;
    const centroidZ = sumZ / points.length;
}


