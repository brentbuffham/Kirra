import { params } from "../drawing/createScene.js";
import { gui } from "../drawing/debugGui.js";
import { controllersMap } from "../drawing/debugGui.js";

function updateGuiControllers() {
	if (controllersMap.worldXCenter) controllersMap.worldXCenter.updateDisplay();
	if (controllersMap.worldYCenter) controllersMap.worldYCenter.updateDisplay();
	if (controllersMap.worldZCenter) controllersMap.worldZCenter.updateDisplay();
	if (controllersMap.cameraDistance) controllersMap.cameraDistance.updateDisplay();

	//Add the updated params to a local storage called WorldOriginSettings
	localStorage.setItem("WorldOriginSettings", JSON.stringify(params));
}

export { updateGuiControllers };

export const bindListenerToWorldOriginSettingsButton = () => {
	console.log("World Origin Settings Button Clicked");
	document.getElementById("settings-world").addEventListener("click", function () {
		const modal = document.createElement("div");
		modal.className = "modal fade"; // Ensure the modal fades in/out
		modal.id = "world-origin-settings-modal";
		modal.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">World Origin Settings</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <form>
                            <div class="mb-3">
                                <label for="world-x" class="form-label">World X Center</label>
                                <input type="number" class="form-control" id="world-x" placeholder="Enter the world x center value" value="${params.worldXCenter}">
                            </div>
                            <div class="mb-3">
                                <label for="world-y" class="form-label">World Y Center</label>
                                <input type="number" class="form-control" id="world-y" placeholder="Enter the world y center value" value="${params.worldYCenter}">
                            </div>
							<!-- Hidden Z center input
                            <div class="mb-3">
                                <label for="world-z" class="form-label">World Z Center</label>
                                <input type="number" class="form-control" id="world-z" placeholder="Enter the world z center value" value="${params.worldZCenter}">
                            </div>
                            <div class="mb-3">
                                <label for="information">Z level data is not shifted, this only adjust the look-at-elevation.</label>
                            </div>
							--> 
                            <div class="mb-3">
                                <label for="camera-distance" class="form-label">Camera Distance</label>
                                <input type="number" class="form-control" id="camera-distance" placeholder="Enter the camera distance value" value="${params.cameraDistance}">
                        </form>
                    </div>
					
                    <div class="modal-footer">
						<button type="button" class="btn btn-danger" id="clear-world-origin-settings">Clear</button>
						<div class="col mx-3">
                			<!-- Horizontal spacer -->
            			</div>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="apply-world-origin-settings">Apply</button>
                        <button type="button" class="btn btn-success" id="save-world-origin-settings">Save</button>
                    </div>
                </div>
            </div>
        `;
		document.body.appendChild(modal);

		// Ensure the bootstrap object is available
		const modalElement = new window.bootstrap.Modal(modal);
		modalElement.show();

		document.getElementById("clear-world-origin-settings").addEventListener("click", function () {
			//Warn user of display issues if cleared while there is existing data
			alert("Warning: Clearing the world origin settings\nwill reset the display origin and may cause display issues!");

			params.worldXCenter = 0;
			params.worldYCenter = 0;
			params.worldZCenter = 0;

			document.getElementById("world-x").value = 0;
			document.getElementById("world-y").value = 0;
			//document.getElementById("world-z").value = 0;

			//alert("Values have been cleared successfully."); // Changed from confirm to alert for a non-blocking user notification
			console.log("World Origin Settings Cleared: (x)", params.worldXCenter, " (y)", params.worldYCenter, " (z)", params.worldZCenter);
			updateGuiControllers();
		});
		document.getElementById("apply-world-origin-settings").addEventListener("click", function () {
			const x = document.getElementById("world-x").value;
			const y = document.getElementById("world-y").value;
			//const z = document.getElementById("world-z").value;
			const d = document.getElementById("camera-distance").value;

			const parsedX = parseFloat(x);
			const parsedY = parseFloat(y);
			//const parsedZ = parseFloat(z);
			const parsedD = parseFloat(d);

			if (isNaN(parsedX) || isNaN(parsedY) || isNaN(parsedZ) || isNaN(parsedD)) {
				alert("Invalid input. Please enter valid numbers.");
			} else {
				params.worldXCenter = parsedX;
				params.worldYCenter = parsedY;
				//params.worldZCenter = parsedZ;
				params.cameraDistance = parsedD;
				//alert("Values have been set successfully."); // Changed from confirm to alert for a non-blocking user notification
				console.log("World Origin Settings Applied: (x)", params.worldXCenter, " (y)", params.worldYCenter, " (z)", params.worldZCenter, " (camera distance)", params.cameraDistance);
				updateGuiControllers();
			}
		});
		document.getElementById("save-world-origin-settings").addEventListener("click", function () {
			const x = document.getElementById("world-x").value;
			const y = document.getElementById("world-y").value;
			//const z = document.getElementById("world-z").value;
			const d = document.getElementById("camera-distance").value;

			const parsedX = parseFloat(x);
			const parsedY = parseFloat(y);
			//const parsedZ = parseFloat(z);
			const parsedD = parseFloat(d);

			if (isNaN(parsedX) || isNaN(parsedY) || isNaN(parsedZ) || isNaN(parsedD)) {
				alert("Invalid input. Please enter valid numbers.");
			} else {
				params.worldXCenter = parsedX;
				params.worldYCenter = parsedY;
				//params.worldZCenter = parsedZ;
				params.cameraDistance = parsedD;
				//alert("Values have been set successfully."); // Changed from confirm to alert for a non-blocking user notification
				console.log("World Origin Settings Saved: (x)", params.worldXCenter, " (y)", params.worldYCenter, " (z)", params.worldZCenter, " (camera distance)", params.cameraDistance);
				updateGuiControllers();
				//close the modal
				modalElement.hide();
				//modalElement is nonresponsive after closing, so remove it from the DOM
				modal.remove();
			}
		});
	});
};
