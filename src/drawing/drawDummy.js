//drawDummy.js
import {BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Vector3, WebGLRenderer} from "three";

export function drawDummy(scene, x, y, z) {
    const radius = 10;
    //create a blue LineBasicMaterial
    const material = new LineBasicMaterial({color: 0xffffff});

    const dummyXYZ = new Vector3(x, y, z);
    const topLeftLoc = new Vector3(x - radius, y + radius, z);
    const bottomRightLoc = new Vector3(x + radius, y - radius, z);
    const topRightLoc = new Vector3(x + radius, y + radius, z);
    const bottomLeftLoc = new Vector3(x - radius, y - radius, z);

    const geometry1 = new BufferGeometry().setFromPoints(topLeftLoc, dummyXYZ, bottomRightLoc);
    const geometry2 = new BufferGeometry().setFromPoints(bottomLeftLoc, dummyXYZ, topRightLoc);

    const line1 = new Line(geometry1, material);
    const line2 = new Line(geometry2, material);

    scene.add(line1);
    scene.add(line2);
}
