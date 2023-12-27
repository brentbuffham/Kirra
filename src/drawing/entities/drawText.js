import { Mesh, MeshBasicMaterial } from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader";

// Create a font loader
export function drawText(scene, color, vector, value) {
	// Create a font loader
	const loader = new FontLoader();

	// Load the desired font
	let textGeometry; // Declare textGeometry outside the callback

	value = value || "None";

	loader.load("https://threejs.org/examples/fonts/helvetiker_regular.typeface.json", function(font) {
		// Create a text geometry
		const size = 10;
		const height = 1;
		const curveSegments = 12;
		const bevelEnabled = false;
		textGeometry = new TextGeometry(value, {
			font: font,
			size: size,
			height: height,
			curveSegments: curveSegments,
			bevelEnabled: bevelEnabled,
			bevelSegments: 12,
			bevelSize: 1,
			bevelThickness: 1
		});

		// Create a material for the text
		const material = new MeshBasicMaterial({ color });

		// Create a mesh using the text geometry and material
		const textMesh = new Mesh(textGeometry, material);

		// Set the position of the text mesh
		textMesh.position.set(vector.x, vector.y, vector.z);

		// Add the text mesh to the scene
		scene.add(textMesh);
	});
}
