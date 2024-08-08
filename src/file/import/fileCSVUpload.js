// fileCSVUpload.js
import { showCustomModal } from "../../modals/csvModal.js";
import Papa from "papaparse";
import { getCentroid } from "../../drawing/helpers/getCentroid.js";
import { camera, controls, scene, objectCenter } from "../../drawing/createScene.js";
import { drawDummys, drawHoles, drawHoleText } from "../../drawing/entities/drawHoles.js";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";
import { parseCSV } from "./fileCSVLoader.js";
import { Vector3 } from "three";
import { counter } from "../../main.js";

export let csvPoints = [];

export const handleFileUploadNoEvent = (data) => {
    const results = Papa.parse(data, {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: function (results) {
            const columns = results.meta.fields;
            const csvData = results.data;

            const columnOrder = JSON.parse(localStorage.getItem("columnOrder") || "{}");

            const headerRows = parseInt(columnOrder.headerRows) || 0;

            let previewContent;
            if (headerRows === 0) {
                previewContent = [Object.keys(csvData[0]).join(","), ...csvData.map((row) => Object.values(row).join(","))].join("\n");
            } else {
                previewContent = csvData
                    .slice(headerRows)
                    .map((row) => Object.values(row).join(","))
                    .join("\n");
            }

            showCustomModal(columns, previewContent, csvData);
        },
    });
};

let centroid = new Vector3(0, 0, 0);

export const handleFileSubmit = (data, columnOrder) => {
    try {
        const tempBlastName = "csvBlast" + counter.csvFileCount;
        const newPoints = parseCSV(data, columnOrder, tempBlastName);
        csvPoints.push(...newPoints);
        counter.csvFileCount++;

        let x, y, z;
        let diameterUnits = columnOrder.diameter_units || "mm";

        if (params.worldXCenter === 0 && params.worldYCenter === 0) {
            centroid = getCentroid(csvPoints);
            x = centroid.x;
            y = centroid.y;
            z = centroid.z;
            params.worldXCenter = x;
            params.worldYCenter = y;
            updateGuiControllers();
        } else {
            x = params.worldXCenter || 0;
            y = params.worldYCenter || 0;
            z = 0;
        }

        const timeDateNow = Date.now();

        let pointcount = 0;
        for (const point of csvPoints) {
            const tempPoint = {
                blastName: point.blastName,
                pointID: `${point.pointID}`,
                startXLocation: point.startXLocation - x,
                startYLocation: point.startYLocation - y,
                startZLocation: point.startZLocation - z,
                endXLocation: point.endXLocation !== null && point.endXLocation !== undefined ? point.endXLocation - x : null,
                endYLocation: point.endYLocation !== null && point.endYLocation !== undefined ? point.endYLocation - y : null,
                endZLocation: point.endZLocation !== null && point.endZLocation !== undefined ? point.endZLocation - z : null,
                diameter: point.diameter || null,
                subdrill: point.subdrill || null,
                shapeType: point.shapeType || null,
                holeColour: point.holeColour || null,
            };

            pointcount++;

            const hasPointID = tempPoint.pointID !== null && tempPoint.pointID !== undefined;
            const hasStart = tempPoint.startXLocation !== null && tempPoint.startYLocation !== null && tempPoint.startZLocation !== null;
            const hasEnd = tempPoint.endXLocation !== null && tempPoint.endYLocation !== null && tempPoint.endZLocation !== null;
            const hasDiameter = tempPoint.diameter !== null && tempPoint.diameter !== undefined && tempPoint.diameter > 0;
            const hasSubdrill = tempPoint.subdrill !== null && tempPoint.subdrill !== undefined;
            const hasShapeType = tempPoint.shapeType !== null && tempPoint.shapeType !== undefined;
            const hasHoleColour = tempPoint.holeColour !== null && tempPoint.holeColour !== undefined;

            if (!hasPointID || !hasStart) {
                alert("Point ID and Start XYZ location are required");
                return; // Return to the modal if essential properties are missing
            }

            if (tempPoint.blastName == null || tempPoint.blastName == undefined || tempPoint.blastName == "" || tempPoint.blastName == " ") {
                tempPoint.blastName = tempBlastName;
                point.blastName = tempBlastName; // Assign blastName to point object
            }

            if (hasPointID && hasStart && !hasEnd) {
                // Check if end XYZ location is missing
                console.log("Dummy:" + tempPoint.pointID + " All properties are present except end XYZ location");
                tempPoint.diameter = null;
                tempPoint.subdrill = null;
                tempPoint.shapeType = "mesh-dummy";
                tempPoint.holeColour = point.holeColour || 0xffffff;
                drawDummys(scene, tempPoint.holeColour, tempPoint);
                point.diameter = null; // Assign diameter to point object
                point.subdrill = null; // Assign subdrill to point object
                point.holeColour = point.holeColour || 0xffffff; // Assign colour to point object
                point.shapeType = "mesh-dummy"; // Assign shapeType to point object
            } else if (hasPointID && hasStart && hasEnd && hasDiameter && hasSubdrill && hasShapeType && hasHoleColour) {
                //console.log("Hole:" + tempPoint.pointID + " All properties are present");
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
            } else if (hasPointID && hasStart && hasEnd && hasDiameter && hasSubdrill && hasShapeType && !hasHoleColour) {
                //console.log("Hole:" + tempPoint.pointID + " All properties are present except holeColour");
                tempPoint.holeColour = 0xffffff;
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
                point.holeColour = 0xffffff; // Assign colour to point object
            } else if (hasPointID && hasStart && hasEnd && hasDiameter && hasSubdrill && !hasShapeType && hasHoleColour) {
                //console.log("Hole:" + tempPoint.pointID + " All properties are present except shapeType");
                tempPoint.shapeType = "mesh-cylinder";
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
                point.shapeType = "mesh-cylinder"; // Assign shapeType to point object
            } else if (hasPointID && hasStart && hasEnd && hasDiameter && !hasSubdrill && hasShapeType && hasHoleColour) {
                //console.log("Hole:" + tempPoint.pointID + " All properties are present except subdrill");
                tempPoint.subdrill = 0;
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
                point.subdrill = 0; // Assign subdrill to point object
            } else if (hasPointID && hasStart && hasEnd && hasDiameter && !hasSubdrill && !hasShapeType && !hasHoleColour) {
                //console.log("Hole:" + tempPoint.pointID + " All properties are present except shapeType and holeColour");
                tempPoint.subdrill = 0;
                tempPoint.holeColour = 0xffffff;
                tempPoint.shapeType = "mesh-cylinder";
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
                point.subdrill = 0; // Assign subdrill to point object
                point.holeColour = 0xffffff; // Assign colour to point object
                point.shapeType = "mesh-cylinder"; // Assign shapeType to point object
            } else if (hasPointID && hasStart && hasEnd && hasDiameter && hasSubdrill && !hasShapeType && !hasHoleColour) {
                //console.log("Hole:" + tempPoint.pointID + " All properties are present except shapeType and holeColour");
                tempPoint.holeColour = 0xffffff;
                tempPoint.shapeType = "mesh-cylinder";
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
                point.holeColour = 0xffffff; // Assign colour to point object
                point.shapeType = "mesh-cylinder"; // Assign shapeType to point object
            } else if (hasPointID && hasStart && hasEnd && hasDiameter && !hasSubdrill && !hasShapeType && hasHoleColour) {
                //console.log("Hole:" + tempPoint.pointID + " All properties are present except subdrill and shapeType");
                tempPoint.subdrill = 0;
                tempPoint.shapeType = "mesh-cylinder";
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
                point.subdrill = 0; // Assign subdrill to point object
                point.shapeType = "mesh-cylinder"; // Assign shapeType to point object
            } else if (hasPointID && hasStart && hasEnd && !hasDiameter) {
                // Check if diameter is missing
                //console.log("Hole:" + tempPoint.pointID + " All properties are present except diameter");
                tempPoint.diameter = 0;
                tempPoint.subdrill = point.subdrill || 0;
                tempPoint.holeColour = point.holeColour || 0xffffff;
                tempPoint.shapeType = "mesh-cube";
                drawHoles(scene, tempPoint.holeColour, tempPoint, tempPoint.diameter, tempPoint.subdrill, tempPoint.shapeType);
                point.diameter = 0; // Assign diameter to point object
                point.shapeType = "mesh-cube"; // Assign shapeType to point object
                point.subdrill = point.subdrill || 0; // Assign subdrill to point object
                point.holeColour = point.holeColour || 0xffffff; // Assign colour to point object
            } else {
                if (csvPoints.length == pointcount) {
                    // Check if it is the last point
                    alert("Error: Invalid properties - Check Set Order or File");
                    console.log("Error: Invalid properties");
                }
            }
        }

        if (params.debugComments) {
            console.log("fileCSVUpload/handleFileSubmit/points: ", csvPoints);
            console.log("Objects in scene: ", scene.children);
        }

        camera.position.set(0, 0, parseFloat(params.cameraDistance));
        centroid = getCentroid(csvPoints);
        objectCenter.position.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
        controls.target.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
        camera.lookAt(objectCenter.position);
        camera.updateProjectionMatrix();
        controls.update();

        if (params.debugComments) {
            console.log("fileUpload/handleFileSubmit/controls.target", controls.target);
        }
        camera.updateMatrixWorld();
    } catch (err) {
        console.error("Error in handleFileSubmit: ", err);
    }
};
