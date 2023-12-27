import {getCentroid, parseCSV} from "./csvParser.js";
import {drawDummy} from "../../drawing/drawDummy.js";
import {BufferGeometry, Line, LineBasicMaterial, Vector3} from "three";

export function renderFileUpload(containerId, canvas) {

    const container = document.querySelector(containerId);
    const fileUpload = `
    <div id="file-upload">
         <input type="file" id="file-input" />
         <label for="file-input">Choose a file</label>
    </div>
`;

    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = fileUpload;
    container.appendChild(tempContainer);

    document.getElementById("file-input").addEventListener("change", (e) => handleFileUpload(e, canvas));
    // document.getElementById("file-input").addEventListener("change", function (e) {
    // 	handleFileUpload(e, scene)
    // });

}

function handleFileUpload(event, canvas) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    const reader = new FileReader();

    let points = [];

    reader.onload = function (event) {
        const data = event.target.result;

        if (!file.name.toLowerCase().endsWith(".csv")) {
            return;
        }

        points = parseCSV(data);
        for (const point of points.slice(0, 10)) {
            console.log(point);
            drawDummy(canvas.scene, point.startXLocation, point.startYLocation, point.startZLocation);
        }
        const {x, y, z} = getCentroid(points);
        const point = points[0];
        canvas.camera.position.set(point.startXLocation, point.startYLocation, point.startZLocation+30);
        canvas.camera.lookAt(point.startXLocation, point.startYLocation, point.startZLocation);
        // canvas.camera.updateMatrixWorld();
    };

    reader.readAsText(file);
}
