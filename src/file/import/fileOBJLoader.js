import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { DoubleSide, Color, Vector3, Box3 } from "three";
import { MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, ShaderMaterial } from "three";
import { AdditiveBlending, WireframeGeometry, LineSegments } from "three";
import { params, scene } from "../../drawing/createScene.js";

export function handleOBJNoEvent(file, canvas) {
	if (!file) {
		return;
	}

	const reader = new FileReader();

	reader.onload = function (event) {
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

		const default_material = new MeshLambertMaterial({ color: 0x22ffaa, side: DoubleSide, blending: AdditiveBlending, depthWrite: false });
		const phong_material = new MeshPhongMaterial({ color: 0x999999, side: DoubleSide, flatShading: true }); //, transparent: true, opacity: 0.5, depthWrite: false
		const basic_material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, blending: AdditiveBlending, depthWrite: false });
		const shiny_phong_material = new MeshPhongMaterial({ color: 0x555555, specular: 0xffffff, shininess: 10, flatShading: false, side: DoubleSide });

		// Reposition vertices to center the object at the world center
		object.traverse(function (child) {
			if (child.isMesh) {
				const position = child.geometry.attributes.position;

				// Offset the positions
				for (let i = 0; i < position.count; i++) {
					position.setXYZ(i, position.getX(i) - offsetX, position.getY(i) - offsetY, position.getZ(i));
				}

				// Recompute vertex normals
				child.geometry.computeVertexNormals();

				// Mark positions as needing update
				position.needsUpdate = true;

				// Set material and wireframe mode based on params.wireframeOn
				if (params.wireframeOn) {
					child.material = default_material;
					child.material.wireframe = true; // Enable wireframe mode
					child.material.needsUpdate = true;
				} else {
					child.material = phong_material;
					child.material.needsUpdate = true;
				}

				// Recompute bounding box and sphere
				child.geometry.computeBoundingBox();
				child.geometry.computeBoundingSphere();

				// Add the child to the scene
				canvas.scene.add(child);
			}
		});

		// Force position to 0, 0, 0
		object.position.set(0, 0, 0);

		// Rotate object to Z up
		//object.rotation.set(Math.PI / 2, 0, 0);

		object.scale.set(1, 1, 1);
		// object.material.wireframe = true;
		// canvas.scene.add(object);
		// canvas.scene.remove(object);
		// object.material.wireframe = false;
		// canvas.scene.add(object);

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

	reader.onerror = function (error) {
		console.log("Error reading the OBJ file:", error);
	};

	reader.readAsText(file);
}
