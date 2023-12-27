import {getCentroid, parseCSV} from "./csvParser.js";
import {drawDummy} from "../../drawing/drawDummy.js";
import {BufferGeometry, Line, LineBasicMaterial, Vector3} from "three";
import * as THREE from "three";

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
        for (const point of points) {
            drawDummy(canvas.scene, point.startXLocation, point.startYLocation, point.startZLocation);
        }
        const {x, y, z} = getCentroid(points);
        const point = points[0];
        canvas.camera.position.set(point.startXLocation, point.startYLocation, point.startZLocation+30);
        canvas.camera.lookAt(point.startXLocation, point.startYLocation, point.startZLocation);

        // canvas.camera.position.set(x, y, z + 50);
        // canvas.camera.lookAt(new Vector3(x, y, z));
        canvas.camera.up.set(0, 0, 1); // Z-axis
        canvas.camera.updateMatrixWorld();
    };

    reader.readAsText(file);
}

// const test = () => {
//     import * as THREE from 'three';
//     import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
//
//
// // Your existing scene creation code
//     const scene = new THREE.Scene();
//     const renderer = new THREE.WebGLRenderer();
//     const canvas = document.querySelector("#canvas");
//     renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
//     document.querySelector("#canvas").appendChild(renderer.domElement);
//
//
//     const frustumSize = 50;
//     const aspect = window.innerWidth / window.innerHeight;
//     const camera = new THREE.OrthographicCamera(
//         frustumSize * aspect / -2,
//         frustumSize * aspect / 2,
//         frustumSize / 2,
//         frustumSize / -2,
//         0.001,
//         1000
//     );
//
//
// // Set your desired vertical axis (e.g., Z-axis)
//     const verticalAxis = new THREE.Vector3(0, 0, 1);
//     camera.up.copy(verticalAxis);
//
//
//     const controls = new OrbitControls(camera, renderer.domElement);
//     controls.enableDamping = true;
//     controls.dampingFactor = 0.25;
//     controls.screenSpacePanning = false;
//
//
// // Your other scene setup code...
//
//
// // Animation loop
//     function animate() {
//         requestAnimationFrame(animate);
//         controls.update(); // Make sure to update controls in the animation loop
//         renderer.render(scene, camera);
//     }
//
//
//     animate();
// }
