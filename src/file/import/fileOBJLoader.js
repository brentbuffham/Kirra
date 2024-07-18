import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { TextureLoader, MeshPhongMaterial, DoubleSide, Vector3, Box3 } from "three";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";

export function handleOBJNoEvent(files, canvas) {
	const objFile = files.find((file) => file.name.endsWith(".obj"));
	const mtlFile = files.find((file) => file.name.endsWith(".mtl"));
	const textureFiles = files.filter((file) => file.type.startsWith("image/"));

	//Exit when no file is found
	if (!objFile) {
		console.error("OBJ file not found");
		return;
	}

	const reader = new FileReader();

	reader.onload = function (event) {
		const contents = event.target.result;
		alert("OBJ file loaded successfully.\nFile name: " + objFile.name);

		const objLoader = new OBJLoader();

		if (mtlFile) {
			const mtlReader = new FileReader();
			mtlReader.onload = function (mtlEvent) {
				const mtlContents = mtlEvent.target.result;
				const mtlLoader = new MTLLoader();
				const materials = mtlLoader.parse(mtlContents);

				console.log("Materials info keys:", Object.keys(materials.materialsInfo));
				console.log("Parsed materials:", materials.materialsInfo);

				const textureLoader = new TextureLoader();
				textureFiles.forEach((textureFile) => {
					const url = URL.createObjectURL(textureFile);
					textureLoader.load(url, (texture) => {
						console.log("Texture loaded:", texture);
						// Apply the texture to the material
						if (materials.materialsInfo["texture"]) {
							console.log("Applying texture ", textureFile.name, " to material 'texture'");

							const material = new MeshPhongMaterial({ color: 0xffffff, side: DoubleSide, map: texture });
							//adjust texture map settings to remove shiny effect
							material.shininess = 0;
							material.specular = 0xffffff;
							material.flatShading = true;

							material.needsUpdate = true;
							console.log("Material after texture application", material);
						}
					});
				});

				materials.preload();
				objLoader.setMaterials(materials);

				const object = objLoader.parse(contents);
				processLoadedObject(object, canvas);
			};
			mtlReader.readAsText(mtlFile);
		} else {
			const object = objLoader.parse(contents);
			processLoadedObject(object, canvas);
		}
	};

	reader.onerror = function (error) {
		console.error("Error reading the OBJ file:", error);
	};

	reader.readAsText(objFile);
}

function processLoadedObject(object, canvas) {
	const boundingBox = new Box3().setFromObject(object);
	const center = boundingBox.getCenter(new Vector3());

	const offsetX = params.worldXCenter !== 0 ? params.worldXCenter : center.x;
	const offsetY = params.worldYCenter !== 0 ? params.worldYCenter : center.y;

	//set the world center
	if (params.worldXCenter === 0 || params.worldYCenter === 0) {
		params.worldXCenter = center.x;
		params.worldYCenter = center.y;
		updateGuiControllers();
	}

	object.position.set(0, 0, 0);
	object.scale.set(1, 1, 1);
	object.name = object.name;

	//backup material for objects without mtl file
	const phong_material = new MeshPhongMaterial({ color: 0xffffff, side: DoubleSide, flatShading: true });

	object.traverse(function (child) {
		if (child.isMesh) {
			const position = child.geometry.attributes.position;
			for (let i = 0; i < position.count; i++) {
				//offset as the objects are in UTM and real world coordinates and float32 precision is not enough - offset to 0,0
				position.setXYZ(i, position.getX(i) - offsetX, position.getY(i) - offsetY, position.getZ(i));
			}

			child.geometry.computeVertexNormals();
			position.needsUpdate = true;

			//Got no materila or texture? - apply default material
			if (!child.material || !child.material.map) {
				child.material = phong_material;
				child.material.needsUpdate = true;
			}

			child.geometry.computeBoundingBox();
			child.geometry.computeBoundingSphere();

			canvas.scene.add(child);
		}
	});

	if (params.debugComments) {
		console.log("Loaded OBJ position:", object.position);
		console.log("Loaded OBJ rotation:", object.rotation);
		console.log("Loaded OBJ scale:", object.scale);
	}
}
