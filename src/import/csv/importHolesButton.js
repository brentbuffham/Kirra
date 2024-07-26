import { handleFileUploadNoEvent } from "../../file/import/fileK3DUpload.js";
import { params } from "../../drawing/createScene.js";
import Papa from "papaparse";
import "bootstrap/dist/css/bootstrap.min.css";
import { Modal } from "bootstrap";
import { parseHoles } from "../../file/import/fileCSVLoader.js";

let globalCSVData = null; // to store parsed CSV data globally

// Function to create and show the custom modal
const showCustomModal = (columns, previewContent) => {
	const modalHtml = `
    <div class="modal fade" id="csvModal" tabindex="-1" aria-labelledby="csvModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header custom-modal-header">
                    <h5 class="modal-title" id="csvModalLabel">Text File Import</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form id="csvForm">
                        <div class="row">
                            <div class="col-md-6">
                                ${generateFormGroups(columns, "left")}
                            </div>
                            <div class="col-md-6">
                                ${generateFormGroups(columns, "right")}
                            </div>
                        </div>
                        <div class="row mt-3">
                            <div class="col-12">
                                <div class="form-group">
                                    <label for="filePreview">File Contents Preview</label>
                                    <textarea class="form-control" id="filePreview" rows="10" readonly>${previewContent}</textarea>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-danger" id="clear-settings">Clear</button>
                    <div class="col mx-3">
                        <!-- Horizontal spacer -->
                    </div>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-primary" id="set-order">Set Order</button>
                    <button type="button" class="btn btn-success" id="submit">Submit</button>
                </div>
            </div>
        </div>
    </div>`;

	// Adding custom CSS for the modal header background color
	const style = document.createElement("style");
	style.innerHTML = `
		.custom-modal-header {
        	background-color: #cccccc;
		}

		`;

	document.head.appendChild(style);

	const modalContainer = document.createElement("div");
	modalContainer.innerHTML = modalHtml;
	document.body.appendChild(modalContainer);

	const csvModal = new Modal(document.getElementById("csvModal"));
	csvModal.show();

	// Load column order from localStorage if available
	const savedOrder = JSON.parse(localStorage.getItem("columnOrder"));
	if (savedOrder) {
		for (const [key, value] of Object.entries(savedOrder)) {
			const input = document.getElementById(key);
			if (input) {
				input.value = value;
			}
		}
	}

	document.getElementById("clear-settings").addEventListener("click", function () {
		const inputs = document.querySelectorAll("#csvForm input[type='number']");
		inputs.forEach((input) => {
			input.value = "";
		});
		updatePreview();
	});

	document.getElementById("set-order").addEventListener("click", function () {
		const formData = new FormData(document.getElementById("csvForm"));
		const columnOrder = {};
		formData.forEach((value, key) => {
			if (value) {
				columnOrder[key] = value;
			}
		});
		localStorage.setItem("columnOrder", JSON.stringify(columnOrder));
		alert("Column order has been set.");
	});

	document.getElementById("submit").addEventListener("click", function () {
		const formData = new FormData(document.getElementById("csvForm"));
		const data = {};
		formData.forEach((value, key) => {
			if (value) {
				data[key] = value;
			}
		});
		console.log(data);
		// Extract and pass selected columns to the parseHoles function
		const selectedColumns = {};
		for (const [key, value] of Object.entries(data)) {
			selectedColumns[key] = parseInt(value, 10);
		}
		parseHoles(globalCSVData, selectedColumns);
		csvModal.hide();
		document.body.removeChild(modalContainer);
	});

	// Add event listener for headerRows after modal is shown
	document.getElementById("headerRows").addEventListener("input", updatePreview);
};

// Function to generate form groups for the modal
// Function to generate form groups for the modal
const generateFormGroups = (columns, section) => {
	const fieldsLeft = [
		{ id: "headerRows", label: "Rows to Ignore", type: "number", placeholder: "# rows" },
		{ id: "blastName", label: "Blast Name", placeholder: "Col #", type: "number" },
		{ id: "holeName", label: "Hole Name", type: "number", placeholder: "Col #", required: true },
		{ id: "startX", label: "Start X (Easting)", type: "number", placeholder: "Col #", required: true },
		{ id: "startY", label: "Start Y (Northing)", type: "number", placeholder: "Col #", required: true },
		{ id: "startZ", label: "Start Z (Elevation)", type: "number", placeholder: "Col #", required: true },
		{ id: "endX", label: "End X (Easting)", placeholder: "Col #", type: "number" },
		{ id: "endY", label: "End Y (Northing)", placeholder: "Col #", type: "number" },
		{ id: "endZ", label: "End Z (Elevation)", placeholder: "Col #", type: "number" },
		{ id: "diameter", label: "Diameter", placeholder: "Col #", type: "number", unit: true }
	];

	const fieldsRight = [
		{ id: "subdrill", label: "Subdrill", placeholder: "Col #", type: "number" },
		{ id: "shapeType", label: "Shape Type", placeholder: "Col #", type: "number" },
		{ id: "holeColour", label: "Hole Colour", placeholder: "Col #", type: "number" },
		{ id: "length", label: "Length", placeholder: "Col #", type: "number" },
		{ id: "bearing", label: "Bearing", placeholder: "Col #", type: "number" },
		{ id: "azimuth", label: "Azimuth", placeholder: "Col #", type: "number" },
		{ id: "burden", label: "Burden", placeholder: "Col #", type: "number" },
		{ id: "spacing", label: "Spacing", placeholder: "Col #", type: "number" },
		{ id: "fromHole", label: "From Hole", placeholder: "Col #", type: "number" },
		{ id: "delay", label: "Delay", placeholder: "Col #", type: "number" },
		{ id: "delayColour", label: "Delay Colour", placeholder: "Col #", type: "number" }
	];

	const fields = section === "left" ? fieldsLeft : fieldsRight;

	return fields
		.map((field) => {
			if (field.id === "holeName" || field.id === "startX" || field.id === "startY" || field.id === "startZ") {
				return `
                <div class="row mb-1">
                    <label for="${field.id}" class="col-md-6 col-form-label">${field.label}</label>
                    <div class="col-sm-6">
                        <div class="input-group">
                            <input type="number" class="form-control" id="${field.id}" name="${field.id}" placeholder="${field.placeholder}" ${field.required ? "required" : ""}>
                            <div class="input-group-append">
                                <span class="input-group-text text-danger">required</span>
                            </div>
                        </div>
                    </div>
                </div>`;
			} else if (field.unit) {
				return `
                <div class="row mb-1">
                    <label for="${field.id}" class="col-md-6 col-form-label">${field.label}</label>
                    <div class="col-sm-6">
                        <input type="number" class="form-control" id="${field.id}" name="${field.id}" placeholder="${field.placeholder}" ${field.required ? "required" : ""}>
                        <div>
                            <input type="radio" id="${field.id}_mm" name="${field.id}_unit" value="mm" checked>
                            <label for="${field.id}_mm">mm</label>
                            <input type="radio" id="${field.id}_m" name="${field.id}_unit" value="m">
                            <label for="${field.id}_m">m</label>
                        </div>
                    </div>
                </div>`;
			} else {
				return `
                <div class="row mb-1">
                    <label for="${field.id}" class="col-md-6 col-form-label">${field.label}</label>
                    <div class="col-sm-6">
                        <input type="${field.type}" class="form-control" id="${field.id}" name="${field.id}" placeholder="${field.placeholder}" ${field.required ? "required" : ""}>
                    </div>
                </div>`;
			}
		})
		.join("");
};

// Function to update the preview based on the headerRows input
const updatePreview = () => {
	const headerRows = parseInt(document.getElementById("headerRows").value, 10) || 0;
	if (globalCSVData) {
		let previewContent;
		if (headerRows === 0) {
			// Show the full content including headers
			previewContent = [Object.keys(globalCSVData[0]).join(","), ...globalCSVData.map((row) => Object.values(row).join(","))].join("\n");
		} else {
			// Remove the specified number of rows from the top, including the header row
			previewContent = globalCSVData
				.slice(headerRows - 1)
				.map((row) => Object.values(row).join(","))
				.join("\n");
		}
		document.getElementById("filePreview").value = previewContent;
	}
};

/**
 * Binds a listener to the import CSV button.
 */
export const bindListenerToImportCSVButton = () => {
	document.getElementById("import-holes").addEventListener("click", function () {
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".csv";
		fileInput.style.display = "none";

		fileInput.onchange = (e) => {
			if (e.target.files && e.target.files[0]) {
				const file = e.target.files[0];
				Papa.parse(file, {
					header: true,
					skipEmptyLines: true,
					complete: function (results) {
						const columns = results.meta.fields;
						globalCSVData = results.data;
						// Retrieve and parse the columnOrder from local storage
						const columnOrder = JSON.parse(localStorage.getItem("columnOrder") || "{}");
						// Get the headerRows value from columnOrder or default to 0
						const headerRows = parseInt(columnOrder.headerRows) || parseInt(document.getElementById("headerRows") ? document.getElementById("headerRows").value : 0, 10) || 0;
						console.log("Header Rows:", headerRows);
						let previewContent;
						//need to check the headerRows value as it is not being set correctly
						if (headerRows === 0) {
							// Show the full content including headers
							previewContent = [Object.keys(results.data[0]).join(","), ...results.data.map((row) => Object.values(row).join(","))].join("\n");
							//previewContent = updatePreview();
						} else {
							// Remove the specified number of rows from the top, including the header row
							previewContent = results.data
								.slice(headerRows - 1)
								.map((row) => Object.values(row).join(","))
								.join("\n");
							//previewContent = updatePreview();
						}
						showCustomModal(columns, previewContent);
					}
				});
			}
		};

		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
		if (params.debugComments) {
			console.log("Load File button clicked");
		}
	});
};
