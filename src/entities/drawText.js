//drawText.js
import { Mesh, MeshPhongMaterial, Box3 } from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

export function drawText(scene, color, font, vector, value, entityType) {
	value = value || "None";

	const textGeometry = new TextGeometry(value, {
		font: font,
		size: 1,
		depth: 0.05, // Set height to 0 for flat text
		curveSegments: 12,
		bevelEnabled: false,
		bevelSegments: 2,
		bevelSize: 0,
		bevelThickness: 0
	});

	// Compute the bounding box of the text geometry
	textGeometry.computeBoundingBox();
	const boundingBox = textGeometry.boundingBox;
	const textWidth = boundingBox.max.x - boundingBox.min.x;
	const textHeight = boundingBox.max.y - boundingBox.min.y;

	// Create a material for the text
	const material = new MeshPhongMaterial({ color });

	// Create a mesh using the text geometry and material
	const textMesh = new Mesh(textGeometry, material);

	// Set the position of the text mesh
	textMesh.position.set(parseFloat(vector.x), parseFloat(vector.y), parseFloat(vector.z));
	textMesh.name = value + "- text";
	textMesh.userData = {
		entityType: entityType,
		vector: vector,
		value: value,
		textWidth: textWidth,
		textHeight: textHeight,
		font: font,
		colour: color
	};
	// Add the text mesh to the scene
	scene.add(textMesh);

	// Return the width and height of the text
	//return { textWidth, textHeight };
}
