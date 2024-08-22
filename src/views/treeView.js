import { BoxHelper } from "three";
import { deleteData, readData, openDatabase } from "../file/indexDB/dbReadWrite.js";

// Keep track of the selected objects
let selectedObjects = new Set();
let selectionBoxes = new Map(); // Map to store BoxHelper for each selected object
let contextMenu = null; // Variable to hold the context menu

function addTreeNode(parentElement, object, camera, scene) {
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
	nodeElement.addEventListener("click", (event) => {
		selectObjectInScene(object, nodeElement, camera, scene, event);
	});

	// Add event listener for right-click context menu
	nodeElement.addEventListener("contextmenu", (event) => {
		event.preventDefault(); // Prevent the default browser context menu
		showContextMenu(event, object, scene, camera);
	});

	parentElement.appendChild(nodeElement);

	// Recursively add children (if the object is a group)
	if (object.children && object.children.length > 0) {
		const childrenContainer = document.createElement("div");
		childrenContainer.className = "tree-children";
		childrenContainer.style.display = "none"; // Initially collapsed
		parentElement.appendChild(childrenContainer);

		object.children.forEach((child) => addTreeNode(childrenContainer, child, camera, scene));
	}
}

// Function to populate the panel with the scene objects
export function populatePanelWithSceneObjects(scene, camera) {
	const panel = document.getElementById("objectPanel");
	panel.innerHTML = ""; // Clear existing content

	scene.children.forEach((object) => addTreeNode(panel, object, camera, scene));
}

// Function to add a bounding box around the selected object
function addBoundingBox(object, scene) {
	// If the object is already selected, do nothing
	if (selectionBoxes.has(object.uuid)) return;

	const boxHelper = new BoxHelper(object, 0x00ff00); // Create a green bounding box
	boxHelper.update();
	scene.add(boxHelper);
	selectionBoxes.set(object.uuid, boxHelper);
}

// Function to remove a bounding box from the object
function removeBoundingBox(object, scene) {
	const boxHelper = selectionBoxes.get(object.uuid);
	if (boxHelper) {
		scene.remove(boxHelper);
		boxHelper.geometry.dispose(); // Clean up geometry resources
		selectionBoxes.delete(object.uuid);
	}
}

function selectObjectInScene(object, nodeElement, camera, scene, event) {
	// If shift key is pressed, allow multiple selection
	const isMultiSelect = event.shiftKey;

	// Check if the object is already selected
	const isSelected = selectedObjects.has(object);

	// Deselect if it's already selected
	if (isSelected) {
		removeBoundingBox(object, scene);
		selectedObjects.delete(object);
		nodeElement.classList.remove("selected");
		return;
	}

	if (!isMultiSelect) {
		// Clear previous selections if not multi-select
		selectedObjects.forEach((obj) => {
			removeBoundingBox(obj, scene);

			// Escape the object ID to use in a valid CSS selector
			const validSelector = `[data-object-id='${CSS.escape(obj.id)}']`;

			// Find the corresponding DOM node and remove the "selected" class
			const correspondingNode = document.querySelector(validSelector);
			if (correspondingNode) {
				correspondingNode.classList.remove("selected");
			}
		});
		selectedObjects.clear();
	}

	// Select the new object
	addBoundingBox(object, scene);
	selectedObjects.add(object);
	nodeElement.classList.add("selected");

	// Optionally, focus the camera on the selected object
	// camera.lookAt(object.position);  // Adjust as needed
}

const stores = {
	pointCloud: "CSV_PointCloudStore",
	k3dBlast: "K3D_BlastStore",
	csvBlast: "CSV_BlastStore",
	objMesh: "OBJ_MeshStore"
};

// Function to find the store containing the object by its UUID
async function findStoreForUUID(uuid) {
	const db = await openDatabase();
	console.log("Attempting to find the store containing the object: " + uuid);

	for (const storeName of Object.values(stores)) {
		try {
			const data = await readData(db, storeName);
			//console.log("Checking store: " + storeName + " Data:", data);

			// Iterate through each item in the store
			for (const array of data) {
				// Iterate through each element in the array
				for (const item of array) {
					//console.log("Full Item: ", item); // Log the current element

					// Check if `uuid` matches the target UUID
					if (item.uuid === uuid) {
						console.log("Match found in store: " + storeName);
						return storeName;
					}
				}
			}
		} catch (error) {
			// Ignore errors and continue to the next store
			console.warn("Error checking store " + storeName + ": " + error);
		}
	}

	// Return null if the object was not found in any store
	console.warn("Object not found in any store.");
	return null;
}

// Function to delete an object from both the scene and the corresponding store in the database
async function deleteObjectFromDatabase(object, scene) {
	const uuid = object.userData.uuid; // Use the stored UUID

	// Find which store the object is in by UUID
	const storeName = await findStoreForUUID(uuid);

	if (storeName) {
		try {
			// Delete the object from the store
			await deleteData("Kirra3D_Database", storeName, uuid);
			console.log("Object deleted from the database (Store: " + storeName + ").");
		} catch (error) {
			console.error("Failed to delete the object from the store (" + storeName + "): " + error);
			alert("Failed to delete the object from the database.");
		}
	} else {
		console.warn("Object not found in any store.");
	}
}

// Flag to track if the context menu is being removed
let isRemovingContextMenu = false;

// Function to show the context menu
function showContextMenu(event, object, scene, camera) {
	// Remove existing context menu if any
	if (contextMenu && !isRemovingContextMenu) {
		contextMenu.remove();
		contextMenu = null;
	}

	// Reset the flag when a new menu is created
	isRemovingContextMenu = false;

	// Create the context menu element
	contextMenu = document.createElement("div");
	contextMenu.style.position = "absolute";
	contextMenu.style.left = `${event.pageX}px`;
	contextMenu.style.top = `${event.pageY}px`;
	contextMenu.style.backgroundColor = "#333";
	contextMenu.style.color = "#fff";
	contextMenu.style.padding = "10px";
	contextMenu.style.borderRadius = "5px";
	contextMenu.style.zIndex = 1000;

	// Add "Delete Object" option to the context menu
	const deleteOption = document.createElement("div");
	deleteOption.textContent = "Delete Object";
	deleteOption.style.cursor = "pointer";
	deleteOption.addEventListener("click", async () => {
		if (contextMenu && !isRemovingContextMenu) {
			isRemovingContextMenu = true;
			await deleteObjectFromDatabase(object, scene);
			// Remove the object from the scene
			await deleteObjectFromScene(object, scene);
			contextMenu.remove(); // Remove the context menu after the action
			contextMenu = null;
			isRemovingContextMenu = false;
		}
	});
	contextMenu.appendChild(deleteOption);

	// Add "Look at Object" option to the context menu
	const lookAtOption = document.createElement("div");
	lookAtOption.textContent = "Look at Object";
	lookAtOption.style.cursor = "pointer";
	lookAtOption.addEventListener("click", () => {
		if (contextMenu && !isRemovingContextMenu) {
			isRemovingContextMenu = true;
			camera.lookAt(object.position);
			contextMenu.remove(); // Remove the context menu after the action
			contextMenu = null;
			isRemovingContextMenu = false;
		}
	});
	contextMenu.appendChild(lookAtOption);

	document.body.appendChild(contextMenu);

	// Close the menu when clicking outside
	document.addEventListener(
		"click",
		() => {
			if (contextMenu && !isRemovingContextMenu) {
				isRemovingContextMenu = true;
				contextMenu.remove();
				contextMenu = null;
				isRemovingContextMenu = false;
			}
		},
		{ once: true }
	);
}

// Function to delete an object from the scene
function deleteObjectFromScene(object, scene) {
	// Remove the object and its bounding box from the scene
	removeBoundingBox(object, scene);
	scene.remove(object);
	object.geometry?.dispose(); // Clean up geometry resources if applicable
	object.material?.dispose(); // Clean up material resources if applicable

	// Remove the object from the selected set
	selectedObjects.delete(object);

	// Optionally, remove the corresponding DOM node
	const correspondingNode = document.querySelector(`[data-object-id='${CSS.escape(object.id)}']`);
	if (correspondingNode) {
		correspondingNode.remove();
	}

	console.log("Object " + (object.name || object.type) + " deleted from the scene.");
}
