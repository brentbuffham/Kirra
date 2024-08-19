import * as THREE from "three";

export function createTransparentArrowHelper(direction, origin, length, hex, headLength, headWidth) {
	// Create a Phong material with emissive property
	const arrowMaterial = new THREE.MeshPhongMaterial({ color: hex, emissive: hex });

	// Create the shaft (line) using the Phong material
	const shaftGeometry = new THREE.CylinderGeometry(0.05, 0.05, length - headLength, 6);
	const shaft = new THREE.Mesh(shaftGeometry, arrowMaterial);

	// Set the position of the shaft so that it aligns with the direction
	shaft.position.copy(origin.clone().addScaledVector(direction, (length - headLength) / 2));
	shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());

	// Create the head (cone) using the Phong material
	const headGeometry = new THREE.ConeGeometry(headWidth, headLength, 6);
	const head = new THREE.Mesh(headGeometry, arrowMaterial);

	// Position the cone at the tip of the arrow
	head.position.copy(origin.clone().addScaledVector(direction, length - headLength / 2));
	head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());

	// Create a group to combine the shaft and head
	const arrowHelper = new THREE.Group();
	arrowHelper.add(shaft);
	arrowHelper.add(head);

	// Make both the shaft and the head transparent with 50% opacity
	arrowMaterial.transparent = true;
	arrowMaterial.opacity = 0.5;

	return arrowHelper;
}
