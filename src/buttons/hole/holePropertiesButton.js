import { updateScene } from "../../main.js";
import { populatePanelWithSceneObjects } from "../../views/treeView.js";

export function bindListenerToHoleNameDisplayButton(params, camera, scene) {
	//function to toggle the hole name display
	document.querySelector("#hole-name-on-off").addEventListener("click", () => {
		params.holeNameDisplay = !params.holeNameDisplay;

		updateScene();
		if (params.holeNameDisplay) {
			document.querySelector("#info-label").textContent = "Hole Name Display On";
			// Redraw the scene with hole name display on
		} else {
			document.querySelector("#info-label").textContent = "Hole Name Display Off";
			// Redraw the scene with hole name display off
		}
		populatePanelWithSceneObjects(scene, camera);
	});
}

export function bindListenerToHoleLengthDisplayButton(params) {
	//function to toggle the hole Length display
	document.querySelector("#hole-length-on-off").addEventListener("click", () => {
		params.holeLengthDisplay = !params.holeLengthDisplay;
		updateScene();
		if (params.holeLengthDisplay) {
			document.querySelector("#info-label").textContent = "Hole Length Display On";
			// Redraw the scene with hole length display on
		} else {
			document.querySelector("#info-label").textContent = "Hole Length Display Off";
			// Redraw the scene with hole length display off
		}
		populatePanelWithSceneObjects(scene, camera);
	});
}

export function bindListenerToHoleDiameterDisplayButton(params) {
	//function to toggle the hole Diameter display
	document.querySelector("#hole-diameter-on-off").addEventListener("click", () => {
		params.holeDiameterDisplay = !params.holeDiameterDisplay;
		updateScene();
		if (params.holeDiameterDisplay) {
			document.querySelector("#info-label").textContent = "Hole Diameter Display On";
			// Redraw the scene with hole diameter display on
		} else {
			document.querySelector("#info-label").textContent = "Hole Diameter Display Off";
			// Redraw the scene with hole diameter display off
		}
		populatePanelWithSceneObjects(scene, camera);
	});
}
