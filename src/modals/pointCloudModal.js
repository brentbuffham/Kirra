// pointCloudModal.js
import { Modal } from "bootstrap";
import { parsePointCloud } from "../file/import/filePointCloudLoader.js";
import { handleFileSubmit } from "../file/import/filePointCloudUpload.js"; // Import the handleFileSubmit function
import { hexToRgb } from "../drawing/helpers/colorToOther.js";

export const showCustomPTNModal = (columns, previewContent, csvData) => {
	console.log("Showing custom modal...");
	const modalHtml = `
        <div class="modal fade" id="csvModal" tabindex="-1" aria-labelledby="csvModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header custom-modal-header">
                        <h5 class="modal-title" id="csvModalLabel">XYZ Point Cloud Import (.xyz .csv .txt auto-delimeter)</h5>
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
                                    <div class="row mb-1">
                                        <label for="maxEdgeLength" class="col-sm-5 col-form-label">Max Edge Length (m)</label>
                                        <div class="col-sm-6">
                                            <input type="number" class="form-control" id="maxEdgeLength" name="maxEdgeLength" value="10" min="0">
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-12">
                                    <div class="form-group">
                                        <label for="filePreviewTable">File Contents Preview (Set Order to refresh column view)</label>
                                        <div id="filePreviewTable" style="max-height: 300px; overflow-y: auto;"></div>
                                    </div>
                                    <div class="form-group">
                                        <input type="checkbox" id="createMesh" name="createMesh">
                                        <label for="createMesh">Create Mesh</label>
                                    </div>
                                    <div class="form-group d-flex align-items-center">
                                        <label for="pointColor">Mesh/Point Colour</label>
                                        <input type="color" class="form-control form-control-color mx-2" id="pointColor" value="#ffAA00" title="Choose your colour">
                                        <div id="colorPalette" class="d-flex flex-wrap">
                                            <!-- Palette colors will be added here dynamically -->
                                        </div>
                                    </div>
                                </div>                   
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-danger" id="clear-settings">Clear</button>
                        <div class="col mx-3"></div>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="set-order">Set Order</button>
                        <button type="button" class="btn btn-success" id="submit">Submit</button>
                    </div>
                </div>
            </div>
        </div>`;

	const style = document.createElement("style");
	style.innerHTML = `
        .custom-modal-header {
            background-color: #cccccc;
			font-size: 12px;
			height: 2.5em;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9px;
        }
        th, td {
            padding: 1px;
            text-align: center;
            border: 1px solid #ddd;
        }
        th {
            background-color: #f2f2f2;
            font-size: 11px;
        }
        .ignored-column {
            color: red;
            font-style: italic;
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
		#colorPalette .color-swatch {
			width: 24px;
			height: 24px;
			margin: 2px;
			border: 1px solid #ddd;
			cursor: pointer;
		}
    `;
	document.head.appendChild(style);

	const modalContainer = document.createElement("div");
	modalContainer.innerHTML = modalHtml;
	document.body.appendChild(modalContainer);

	const pointCloudModal = new Modal(document.getElementById("csvModal"));
	pointCloudModal.show();

	// Save the settings to local storage
	const savedOrder = JSON.parse(localStorage.getItem("pointCloudOrder"));
	if (savedOrder) {
		for (const [key, value] of Object.entries(savedOrder)) {
			const input = document.getElementById(key);
			if (input) {
				input.value = value;
			}
		}
	}

	// Retrieve the createMesh and maxEdgeLength state from local storage and set the input states
	const createMeshState = JSON.parse(localStorage.getItem("createMeshState"));
	if (createMeshState !== null) {
		document.getElementById("createMesh").checked = createMeshState;
	}

	const savedMaxEdgeLength = localStorage.getItem("maxEdgeLength");
	if (savedMaxEdgeLength !== null) {
		document.getElementById("maxEdgeLength").value = savedMaxEdgeLength;
	}

	// Event listener to save the createMesh state to local storage when it changes
	document.getElementById("createMesh").addEventListener("change", function () {
		localStorage.setItem("createMeshState", JSON.stringify(this.checked));
	});

	// Event listener to save the maxEdgeLength to local storage when it changes
	document.getElementById("maxEdgeLength").addEventListener("input", function () {
		localStorage.setItem("maxEdgeLength", this.value);
	});

	// Clear the settings and clear the local store
	document.getElementById("clear-settings").addEventListener("click", function () {
		console.log("Clear settings clicked");
		const inputs = document.querySelectorAll("#csvForm input[type='number']");
		inputs.forEach((input) => {
			input.value = "";
		});
		localStorage.removeItem("pointCloudOrder");
		localStorage.removeItem("createMeshState");
		localStorage.removeItem("maxEdgeLength");
		document.getElementById("createMesh").checked = false;
		document.getElementById("maxEdgeLength").value = 10;
		updatePreview(csvData);
	});

	// Set and store the import layout
	document.getElementById("set-order").addEventListener("click", function () {
		console.log("Set order clicked");
		const formData = new FormData(document.getElementById("csvForm"));
		const pointCloudOrder = {};
		formData.forEach((value, key) => {
			if (value) {
				pointCloudOrder[key] = value;
			}
		});
		localStorage.setItem("pointCloudOrder", JSON.stringify(pointCloudOrder));
		console.log("Set pointColumnOrder is: ", pointCloudOrder);
		alert("Column order has been set.");
		updatePreview(csvData); // Update preview when order is set
	});

	// Submit the form and process the points
	document.getElementById("submit").addEventListener("click", function () {
		console.log("Submit clicked");
		const formData = new FormData(document.getElementById("csvForm"));
		const data = {};
		formData.forEach((value, key) => {
			if (value) {
				data[key] = value;
			}
		});
		console.log(data);

		const selectedColumns = {};
		for (const [key, value] of Object.entries(data)) {
			selectedColumns[key] = value;
		}

		// Check if the required columns are selected and alert the user if not
		if (!selectedColumns.pointX || !selectedColumns.pointY || !selectedColumns.pointZ) {
			alert("Please ensure that Point X, Point Y, and Point Z columns are selected.");
			console.error("Please ensure that Point X, Point Y, and Point Z columns are selected.");
			return;
		}

		// Check if the value occurs more than once in the selected columns object and if so, alert the user
		let values = Object.values(selectedColumns);
		let headerRows = selectedColumns.headerRows;
		let duplicates = values.filter((item, index) => item !== headerRows && item !== "maxEdgeLength" && values.indexOf(item) !== index);
		if (duplicates.length > 0) {
			console.log("Duplicates: ", duplicates);
			alert("Some columns are represented more than once.\nDisplay may not be as intended.\nPreferably a column is selected only once.\n");
			return;
		}

		// Get the selected color and convert it to RGB
		const hexColor = document.getElementById("pointColor").value;
		const defaultColor = hexToRgb(hexColor);
		const defaultRedValue = defaultColor.r;
		const defaultGreenValue = defaultColor.g;
		const defaultBlueValue = defaultColor.b;

		// Get the max edge length
		const maxEdgeLength = parseFloat(document.getElementById("maxEdgeLength").value);

		console.log("Red:", defaultRedValue);
		console.log("Green:", defaultGreenValue);
		console.log("Blue:", defaultBlueValue);
		console.log("Max Edge Length:", maxEdgeLength);

		if (selectedColumns.pointX && selectedColumns.pointY && selectedColumns.pointZ) {
			handleFileSubmit(csvData, selectedColumns, hexColor, maxEdgeLength); // Pass the RGB color object and maxEdgeLength to handleFileSubmit
			pointCloudModal.hide();
			document.body.removeChild(modalContainer);
		}
	});

	document.getElementById("headerRows").addEventListener("input", () => updatePreview(csvData));

	// Call updatePreview to generate the initial table content
	updatePreview(csvData);

	// Initialize the color palette
	const paletteColors = ["#990000", "#FF0000", "#FFAA00", "#CCCC00", "#FFF000", "#00ff00", "#00bb00", "#00bbff", "#0055FF", "#aa00ff", "#F1F1F1", "#E3E3E3", "#C6C6C6", "#7F7F7F", "#555555", "#393939", "#1C1C1C", "#00FFFF", "#006699", "#FF00FF"];

	const colorPalette = document.getElementById("colorPalette");
	paletteColors.forEach((color) => {
		const colorSwatch = document.createElement("div");
		colorSwatch.className = "color-swatch";
		colorSwatch.style.backgroundColor = color;
		colorSwatch.addEventListener("click", () => {
			document.getElementById("pointColor").value = color;
		});
		colorPalette.appendChild(colorSwatch);
	});
};

const generateFormGroups = (columns, section) => {
	const fieldsLeft = [
		{ id: "headerRows", label: "Rows to Ignore", type: "number", placeholder: "# rows", required: true, unused: false },
		{ id: "pointID", label: "Point ID (col#)", type: "number", placeholder: "Col #", required: true, unused: false },
		{ id: "pointX", label: "Point X (col#)", type: "number", placeholder: "Col #", required: true, unused: false },
		{ id: "pointY", label: "Point Y (col#)", type: "number", placeholder: "Col #", required: true, unused: false },
		{ id: "pointZ", label: "Point Z (col#)", type: "number", placeholder: "Col #", required: true, unused: false }
	];

	const fieldsRight = [
		{ id: "pointR", label: "Point Red (col#)", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "pointG", label: "Point Green (col#)", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "pointB", label: "Point Blue (col#)", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "pointA", label: "Point Alpha (col#)", placeholder: "Col #", type: "number", required: false, unused: false }
	];

	const fields = section === "left" ? fieldsLeft : fieldsRight;

	return fields
		.map((field) => {
			if (field.required) {
				return `
                <div class="row mb-1">
                    <label for="${field.id}" class="col-sm-5 col-form-label">${field.label}</label>
                    <div class="col-sm-6">
                        <div class="input-group">
                            <input type="number" class="form-control" id="${field.id}" name="${field.id}" placeholder="${field.placeholder}" required>
                            <div class="input-group-append">
                                <span class="input-group-text text-danger">needed</span>
                            </div>
                        </div>
                    </div>
                </div>`;
			} else if (field.unused) {
				return `
                <div class="row mb-1">
                    <label for="${field.id}" class="col-sm-5 col-form-label">${field.label}</label>
                    <div class="col-sm-6">
                        <div class="input-group">
                            <input type="number" class="form-control" id="${field.id}" name="${field.id}" placeholder="${field.placeholder}" unused>
                            <div class="input-group-append">
                                <span class="input-group-text text-warning">unused</span>
                            </div>
                        </div>
                    </div>
                </div>`;
			} else if (field.unit) {
				return `
                <div class="row mb-1">
                    <label for="${field.id}" class="col-sm-5 col-form-label">${field.label}</label>
                    <div class="col-sm-6">
                        <input type="number" class="form-control" id="${field.id}" name="${field.id}" placeholder="${field.placeholder}">
                        <div>
                            <input type="radio" id="${field.id}_mm" name="diameter_unit" value="mm">
                            <label for="${field.id}_mm">mm</label>
                            <input type="radio" id="${field.id}_m" name="diameter_unit" value="m">
                            <label for="${field.id}_m">m</label>
                        </div>
                    </div>
                </div>`;
			} else {
				return `
                <div class="row mb-1">
                    <label for="${field.id}" class="col-sm-5 col-form-label">${field.label}</label>
                    <div class="col-sm-6">
                        <input type="${field.type}" class="form-control" id="${field.id}" name="${field.id}" placeholder="${field.placeholder}">
                    </div>
                </div>`;
			}
		})
		.join("");
};

/**
 * Updates the preview table with CSV data, excluding specified header rows and correctly mapping columns based on user-defined order.
 *
 * @param {Array} csvData - The CSV data to be displayed in the preview table.
 */
const updatePreview = (csvData) => {
	// Get the number of header rows to ignore from the input element, defaulting to 0 if not specified.
	const headerRows = parseInt(document.getElementById("headerRows").value, 10) || 0;

	// Get the user-defined column order from local storage and parse it as JSON.
	const pointCloudOrder = JSON.parse(localStorage.getItem("pointCloudOrder") || "{}");

	// Exclude the headerRows from the column order as it is only for row removal.
	delete pointCloudOrder.headerRows;

	// Proceed only if there is data in csvData.
	if (csvData.length > 0) {
		let tableContent = '<table class="table table-striped"><thead><tr>';

		// Mapping of column ids to labels
		const columnLabels = {
			pointID: "Point ID",
			pointX: "Point X",
			pointY: "Point Y",
			pointZ: "Point Z",
			pointR: "Point Red",
			pointG: "Point Green",
			pointB: "Point Blue",
			pointA: "Point Alpha"
		};

		// Generate table header based on column order, marking unused columns as "ignored".
		const totalColumns = Object.keys(csvData[0]).length; // Total number of columns in the CSV data.
		for (let i = 0; i < totalColumns; i++) {
			// Find the field name that corresponds to the current column index.
			const fieldName = Object.keys(pointCloudOrder).find((col) => pointCloudOrder[col] == (i + 1).toString());
			if (fieldName) {
				// Add the corresponding label for the field name.
				tableContent += `<th>${columnLabels[fieldName]}</th>`;
			} else {
				// Mark unused columns as "ignored".
				tableContent += `<th class="ignored-column">ignored</th>`;
			}
		}
		tableContent += "</tr></thead><tbody>";

		// Generate table rows, correctly ignoring the specified number of rows.
		const rows = csvData.slice(headerRows);
		tableContent += rows
			.map((row) => {
				return (
					"<tr>" +
					Object.keys(row)
						.map((key, index) => {
							// Find the field name that corresponds to the current column index.
							const fieldName = Object.keys(pointCloudOrder).find((col) => pointCloudOrder[col] == (index + 1).toString());
							if (fieldName) {
								return `<td>${row[key]}</td>`;
							} else {
								// Keep the data but mark as ignored in the header.
								return `<td>${row[key]}</td>`;
							}
						})
						.join("") +
					"</tr>"
				);
			})
			.join("");

		tableContent += "</tbody></table>";

		console.log("Table content generated: ", tableContent);

		// Set the table content to the div.
		document.getElementById("filePreviewTable").innerHTML = tableContent;
	}
};
