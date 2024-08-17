//Modal using Boostrap to clear the localStorage
//It should ask the user if they realy want to clear the local storage and if they do, it should clear it

import { Modal } from "bootstrap";
import { params } from "../../drawing/createScene";

export function clearLocalStorageModal() {
	const modalHtml = `<!-- Modal -->
    <div class="modal fade" id="clearLocalStorageModal" tabindex="-1" aria-labelledby="clearLocalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="custom-modal-header">
            <h5 class="modal-title" id="clearLocalLabel">Clear Local Storage</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            Clear the Kirra3D local storage in the browser? Doing this will clear all settings and data. 
          </div>
          <div class="modal-footer">
            <button type="button" id="cancel" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" id="clear" class="btn btn-danger">Clear Memory</button>
          </div>
        </div>
      </div>
    </div>`;

	const style = document.createElement("style");
	style.innerHTML = `
    .custom-modal-header {
        background-color: #cccccc;
        font-size: 10px;
        height: 3em;
    }
    .modal-body label {
        font-size: 12px; /* Adjust the font size of the labels */
        height: 1.5em; /* Adjust the height of the labels */
    }
    .modal-body .form-control {
        font-size: 12px; /* Adjust the font size of the input fields */
        height: 2em; /* Adjust the height of the input fields */
        padding: .25rem .5rem; /* Adjust the padding of the input fields */
    }
    .text-danger {
        font-size: 12px; /* Adjust the font size of the text-danger span */
        height: 2em; /* Adjust the height of the labels */
        align-items: center;
    }	
    .text-warning {
        font-size: 12px; /* Adjust the font size of the text-warning span */
        height: 2em; /* Adjust the height of the labels */
        align-items: center;
    }
`;

	document.head.appendChild(style);

	const modalContainer = document.createElement("div");
	modalContainer.innerHTML = modalHtml;
	document.body.appendChild(modalContainer);

	const clearLocalStorageModal = new Modal(document.getElementById("clearLocalStorageModal"));
	clearLocalStorageModal.show();

	// Clear the settings and clear the local store
	document.getElementById("clear").addEventListener("click", function () {
		localStorage.clear();
		params.worldXCenter = 0;
		params.worldYCenter = 0;
		params.worldZCenter = 0;
		localStorage.setItem("WorldOriginSettings", JSON.stringify(params));
		//localStorage.setItem("pointCloudOrder", JSON.stringify([]));
		alert("Local storage has been cleared.");

		clearLocalStorageModal.hide();
	});
}
