//drawText.js
import { Mesh, MeshBasicMaterial } from "three";
import { TTFLoader } from "three/addons/loaders/TTFLoader";
import { Font } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

// Create a font loader
export function drawText(scene, color, vector, value) {
	// Create a TTF loader
	const loader = new TTFLoader();

	// Load the desired font
	let textGeometry; // Declare textGeometry outside the callback

	value = value || "None";

	loader.load("src/assets/fonts/Roboto/Roboto-Regular.ttf", function(font) {
		font = new Font(font);
		// console.log(font);
		// console.log("Value: ", value);
		// console.log("Vector: ", vector);
		// Create a text geometry;
		textGeometry = new TextGeometry(value, {
			font: font,
			size: 1.5,
			height: 0.05, // Set height to 0 for flat text
			curveSegments: 12,
			bevelEnabled: false,
			bevelSegments: 2,
			bevelSize: 0,
			bevelThickness: 0
		});

		// Create a material for the text
		const material = new MeshBasicMaterial({ color });

		// Create a mesh using the text geometry and material
		const textMesh = new Mesh(textGeometry, material);

		// Set the position of the text mesh
		textMesh.position.set(parseFloat(vector.x), parseFloat(vector.y), parseFloat(vector.z));

		// Add the text mesh to the scene
		scene.add(textMesh);
	});
}
