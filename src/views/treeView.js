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

function selectObjectInScene(object, nodeElement, camera) {
	// Function to remove emissive from a mesh or group
	function removeEmissive(object) {
		if (object.isMesh && object.material) {
			object.material.emissive.set(0x000000); // Remove highlight
		} else if (object.isGroup) {
			// If it's a group, apply to all children
			object.children.forEach((child) => removeEmissive(child));
		}
	}

	// Function to apply emissive to a mesh or group
	function applyEmissive(object) {
		if (object.isMesh && object.material) {
			object.material.emissive.set(0x00ff00); // Highlight the new object
		} else if (object.isGroup) {
			// If it's a group, apply to all children
			object.children.forEach((child) => applyEmissive(child));
		}
	}

	// Deselect previous selection
	if (previouslySelectedObject) {
		removeEmissive(previouslySelectedObject);
	}

	// Update the selected DOM node
	const previousSelectedNode = document.querySelector(".tree-node.selected");
	if (previousSelectedNode) {
		previousSelectedNode.classList.remove("selected");
	}

	// Select the new DOM node
	nodeElement.classList.add("selected");

	// Highlight the new object or group
	applyEmissive(object);

	// Update the previously selected object reference
	previouslySelectedObject = object;

	// Optionally focus the camera on the selected object or group's position
	// if (object.position) {
	// 	camera.lookAt(object.position);
	// }
}
