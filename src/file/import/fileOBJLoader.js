import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { DoubleSide, Color, Vector3, Box3, MeshLambertMaterial, ShaderMaterial, AdditiveBlending } from "three";
import { params } from "../../drawing/createScene.js";

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

		//X-RAY SHADER MATERIAL
		//http://free-tutorials.org/shader-x-ray-effect-with-three-js/
		/*var materials = {
			default_material: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
			default_material2: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
			wireframeMaterial: new THREE.MeshPhongMaterial({
				side: THREE.DoubleSide,
				wireframe: true,
				shininess: 100,
				specular: 0x000,
				emissive: 0x000,
				flatShading: false,
				depthWrite: true,
				depthTest: true
			}),
			wireframeMaterial2: new THREE.LineBasicMaterial({ wireframe: true, color: 0xffffff }),
			wireframeAndModel: new THREE.LineBasicMaterial({ color: 0xffffff }),
			phongMaterial: new THREE.MeshPhongMaterial({
				color: 0x555555,
				specular: 0xffffff,
				shininess: 10,
				flatShading: false,
				side: THREE.DoubleSide,
				skinning: true
			}),
			xrayMaterial: new THREE.ShaderMaterial({
				uniforms: {
					p: { type: "f", value: 3 },
					glowColor: { type: "c", value: new THREE.Color(0x84ccff) }
				},
				vertexShader: document.getElementById("vertexShader").textContent,
				fragmentShader: document.getElementById("fragmentShader").textContent,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending,
				transparent: true,
				depthWrite: false
			})
		};
		*/

		// Reposition vertices to center the object at the world center
		object.traverse(function (child) {
			if (child.isMesh) {
				const position = child.geometry.attributes.position;
				for (let i = 0; i < position.count; i++) {
					position.setXYZ(i, position.getX(i) - offsetX, position.getY(i) - offsetY, position.getZ(i) - offsetZ);
				}
				position.needsUpdate = true;
				child.material = default_material; // Find out which material works...
				child.material.wireframe = true; // Set wireframe mode
				child.material.needsUpdate = true;
				child.geometry.computeBoundingBox();
				child.geometry.computeBoundingSphere();
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

	reader.onerror = function (error) {
		console.log("Error reading the OBJ file:", error);
	};

	reader.readAsText(file);
}
