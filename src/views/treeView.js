function addTreeNode(parentElement, object, camera) {
	const nodeElement = document.createElement("div");
	nodeElement.className = "tree-node";
	nodeElement.textContent = object.name || object.type; // Display object name or type
	nodeElement.dataset.objectId = object.id;

	// Add expand/collapse toggle functionality
	if (object.children && object.children.length > 0) {
		const toggleButton = document.createElement("span");
		toggleButton.textContent = "►"; // Right arrow indicates collapsed
		toggleButton.style.cursor = "pointer";
		toggleButton.style.marginRight = "5px";

		nodeElement.prepend(toggleButton); // Add the toggle button at the start

		// Click event to toggle the visibility of children
		toggleButton.addEventListener("click", () => {
			const childrenContainer = nodeElement.nextElementSibling;
			if (childrenContainer.style.display === "none") {
				childrenContainer.style.display = "block";
				toggleButton.textContent = "▼"; // Expanded
			} else {
				childrenContainer.style.display = "none";
				toggleButton.textContent = "►"; // Collapsed
			}
		});
	}

	// Add event listener for selecting the object in the scene
	nodeElement.addEventListener("click", () => {
		selectObjectInScene(object, nodeElement, camera);
	});

	parentElement.appendChild(nodeElement);

	// Recursively add children (if the object is a group)
	if (object.children && object.children.length > 0) {
		const childrenContainer = document.createElement("div");
		childrenContainer.className = "tree-children";
		childrenContainer.style.display = "none"; // Initially collapsed
		parentElement.appendChild(childrenContainer);

		object.children.forEach((child) => addTreeNode(childrenContainer, child, camera));
	}
}

// Function to populate the panel with the scene objects
export function populatePanelWithSceneObjects(scene, camera) {
	const panel = document.getElementById("objectPanel");
	panel.innerHTML = ""; // Clear existing content

	scene.children.forEach((object) => addTreeNode(panel, object, camera));
}

// Keep track of the previously selected object or group
let previouslySelectedObject = null;
let opacityStore = [];
let emissionStore = [];

function selectObjectInScene(object, nodeElement, camera) {
	// Function to restore emissive and opacity for a mesh or group
	function restoreMaterialState(object) {
		if (object.isMesh && object.material) {
			// Restore the original emissive and opacity values
			const storedEmissive = emissionStore.pop();
			object.material.emissive.setHex(storedEmissive !== null ? storedEmissive : 0x000000);
			object.material.opacity = opacityStore.pop();
		} else if (object.isGroup || object.isObject3D) {
			// Recursively restore material state for all children
			object.children.forEach((child) => restoreMaterialState(child));
		}
	}

	// Function to apply emissive and set opacity to 1 for a mesh or group
	function applyMaterialState(object) {
		if (object.isMesh && object.material) {
			// Store the original emissive and opacity values
			emissionStore.push(object.material.emissive.getHex());
			opacityStore.push(object.material.opacity);

			// Apply the new emissive color and set opacity to 1
			object.material.emissive.setHex(0x00ff00); // Highlight color
			object.material.opacity = 1;
		} else if (object.isGroup || object.isObject3D) {
			// Recursively apply material state for all children
			object.children.forEach((child) => applyMaterialState(child));
		}
	}

	// Deselect the previous object if there was one
	if (previouslySelectedObject) {
		restoreMaterialState(previouslySelectedObject);
	}

	// Clear previous DOM selection
	const previousSelectedNode = document.querySelector(".tree-node.selected");
	if (previousSelectedNode) {
		previousSelectedNode.classList.remove("selected");
	}

	// Select the new DOM node
	nodeElement.classList.add("selected");

	// Apply the material changes to the selected object
	applyMaterialState(object);

	// Update the previously selected object reference
	previouslySelectedObject = object;

	console.log("Stored Emissive:", emissionStore);
	console.log("Stored Opacity:", opacityStore);

	// Optionally, focus the camera on the selected object
	// camera.lookAt(object.position);  // Adjust as needed
}
