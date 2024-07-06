import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { DoubleSide, Color, Vector3, Box3 } from "three";
import { params } from "../../drawing/createScene.js";

export function handleOBJNoEvent(file, canvas) {
    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.onload = function(event) {
        const contents = event.target.result;
        const objLoader = new OBJLoader();

        const object = objLoader.parse(contents);

        // Compute the bounding box of the object
        const boundingBox = new Box3().setFromObject(object);
        const center = boundingBox.getCenter(new Vector3());

        // Determine the offsets based on world center parameters
        const offsetX = params.worldXCenter !== 0 ? params.worldXCenter : center.x;
        const offsetY = params.worldYCenter !== 0 ? params.worldYCenter : center.y;
        const offsetZ = params.worldZCenter !== 0 ? params.worldZCenter : center.z;

        // Reposition vertices to center the object at the world center
        object.traverse(function(child) {
            if (child.isMesh) {
                const position = child.geometry.attributes.position;
                for (let i = 0; i < position.count; i++) {
                    position.setXYZ(
                        i,
                        position.getX(i) - offsetX,
                        position.getY(i) - offsetY,
                        position.getZ(i) - offsetZ
                    );
                }
                position.needsUpdate = true;
                child.geometry.computeBoundingBox();
                child.geometry.computeBoundingSphere();
            }
        });

        // Set material to a bright color and DoubleSide for visibility
        object.traverse(function(child) {
            if (child.isMesh) {
                child.material.side = DoubleSide;
                child.material.color = new Color(0xAAAAAA); 
                child.material.needsUpdate = true;
                // Print the X, Y, and Z of each Vertex
                console.log(child.geometry.attributes.position);
            }
        });

        // Force position to 0, 0, 0
        object.position.set(0, 0, 0);

        // Rotate object to Z up
        //object.rotation.set(Math.PI / 2, 0, 0);

        object.scale.set(1, 1, 1);

        canvas.scene.add(object);
        object.name = file.name;

        console.log("Object position after load:", object.position);
        console.log("Object rotation after load:", object.rotation);
        console.log("Object scale after load:", object.scale);

        // Adjust the camera to ensure the object is visible
        const size = boundingBox.getSize(new Vector3());

        if (params.debugComments) {
            console.log("Loaded OBJ position:", object.position);
            console.log("Loaded OBJ rotation:", object.rotation);
            console.log("Loaded OBJ scale:", object.scale);
        }
    };

    reader.onerror = function(error) {
        console.log("Error reading the OBJ file:", error);
    };

    reader.readAsText(file);
}
