// csvModal.js
import { Modal } from "bootstrap";
import { parseCSV } from "../file/import/fileCSVLoader.js";
import { handleFileSubmit } from "../file/import/fileCSVUpload.js"; // Import the handleFileSubmit function

export const showCustomModal = (columns, previewContent, csvData) => {
	console.log("Showing custom modal...");
	const modalHtml = `
        <div class="modal fade" id="csvModal" tabindex="-1" aria-labelledby="csvModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header custom-modal-header">
                        <h5 class="modal-title" id="csvModalLabel">Text File Import (comma separated values only)</h5>
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
                                        <label for="filePreviewTable">File Contents Preview (Set Order to refresh column view)</label>
                                        <div id="filePreviewTable" style="max-height: 300px; overflow-y: auto;"></div>
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
    `;
	document.head.appendChild(style);

	const modalContainer = document.createElement("div");
	modalContainer.innerHTML = modalHtml;
	document.body.appendChild(modalContainer);

	const csvModal = new Modal(document.getElementById("csvModal"));
	csvModal.show();

	// Save the settings to local storage
	const savedOrder = JSON.parse(localStorage.getItem("columnOrder"));
	if (savedOrder) {
		for (const [key, value] of Object.entries(savedOrder)) {
			const input = document.getElementById(key);
			if (input) {
				input.value = value;
			}
		}
		if (savedOrder.diameter_unit) {
			document.querySelector(`input[name="diameter_unit"][value="${savedOrder.diameter_unit}"]`).checked = true;
		}
	}

	// Clear the settings and clear the local store
	document.getElementById("clear-settings").addEventListener("click", function () {
		console.log("Clear settings clicked");
		const inputs = document.querySelectorAll("#csvForm input[type='number']");
		inputs.forEach((input) => {
			input.value = "";
		});
		localStorage.removeItem("columnOrder");
		updatePreview(csvData);
	});

	// Set and store the import layout
	document.getElementById("set-order").addEventListener("click", function () {
		console.log("Set order clicked");
		const formData = new FormData(document.getElementById("csvForm"));
		const columnOrder = {};
		formData.forEach((value, key) => {
			if (value) {
				columnOrder[key] = value;
			}
		});
		columnOrder.diameter_unit = document.querySelector('input[name="diameter_unit"]:checked').value;
		localStorage.setItem("columnOrder", JSON.stringify(columnOrder));
		console.log(columnOrder);
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
		data.diameter_unit = document.querySelector('input[name="diameter_unit"]:checked').value;
		console.log(data);

		const selectedColumns = {};
		for (const [key, value] of Object.entries(data)) {
			selectedColumns[key] = value;
		}

		//check if the required columns are selected and alert the user if not
		if (!selectedColumns.startXLocation || !selectedColumns.startYLocation || !selectedColumns.startZLocation) {
			alert("Please ensure that Start X, Start Y, and Start Z columns are selected.");
			console.error("Please ensure that Start X, Start Y, and Start Z columns are selected.");
		}

		//check if the value occurs more than once in the selected columns object and if so, alert the user
		let values = Object.values(selectedColumns);
		let headerRows = selectedColumns.headerRows;
		let duplicates = values.filter((item, index) => item !== headerRows && values.indexOf(item) !== index);
		if (duplicates.length > 0) {
			console.log("Duplicates: ", duplicates);
			alert("Some columns are represented more than once.\nDisplay may not be as intended.\nPreferably a column is selected only once.\n");
		}
		//check if the required columns are selected and proceed if they are
		if (selectedColumns.startXLocation && selectedColumns.startYLocation && selectedColumns.startZLocation) {
			handleFileSubmit(csvData, selectedColumns); // Call handleFileSubmit with csvData and selectedColumns
			csvModal.hide();
			document.body.removeChild(modalContainer);
		}
	});

	document.getElementById("headerRows").addEventListener("input", () => updatePreview(csvData));

	// Call updatePreview to generate the initial table content
	updatePreview(csvData);
};

const generateFormGroups = (columns, section) => {
	const fieldsLeft = [
		{ id: "headerRows", label: "Rows to Ignore", type: "number", placeholder: "# rows", required: true, unused: false },
		{ id: "blastName", label: "Blast Name", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "pointID", label: "Hole Name", type: "number", placeholder: "Col #", required: true, unused: false },
		{ id: "startXLocation", label: "Start X (Easting)", type: "number", placeholder: "Col #", required: true, unused: false },
		{ id: "startYLocation", label: "Start Y (Northing)", type: "number", placeholder: "Col #", required: true, unused: false },
		{ id: "startZLocation", label: "Start Z (Elevation)", type: "number", placeholder: "Col #", required: true, unused: false },
		{ id: "endXLocation", label: "End X (Easting)", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "endYLocation", label: "End Y (Northing)", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "endZLocation", label: "End Z (Elevation)", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "diameter", label: "Diameter", placeholder: "Col #", type: "number", unit: true, required: false, unused: false }
	];

	const fieldsRight = [
		{ id: "subdrill", label: "Subdrill", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "shapeType", label: "Shape Type", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "holeColour", label: "Hole Colour", placeholder: "Col #", type: "number", required: false, unused: false },
		{ id: "holeLength", label: "Length", placeholder: "Col #", type: "number", required: false, unused: true },
		{ id: "holeBearing", label: "Bearing", placeholder: "Col #", type: "number", required: false, unused: true },
		{ id: "holeAngle", label: "Angle", placeholder: "Col #", type: "number", required: false, unused: true },
		{ id: "holeBurden", label: "Burden", placeholder: "Col #", type: "number", required: false, unused: true },
		{ id: "holeSpacing", label: "Spacing", placeholder: "Col #", type: "number", required: false, unused: true },
		{ id: "fromHole", label: "From Hole", placeholder: "Col #", type: "number", required: false, unused: true },
		{ id: "delay", label: "Delay", placeholder: "Col #", type: "number", required: false, unused: true },
		{ id: "delayColour", label: "Delay Colour", placeholder: "Col #", type: "number", required: false, unused: true }
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
	const columnOrder = JSON.parse(localStorage.getItem("columnOrder") || "{}");

	// Exclude the headerRows from the column order as it is only for row removal.
	delete columnOrder.headerRows;

	// Proceed only if there is data in csvData.
	if (csvData.length > 0) {
		let tableContent = '<table class="table table-striped"><thead><tr>';

		// Mapping of column ids to labels
		const columnLabels = {
			blastName: "Blast Name",
			pointID: "Hole Name",
			startXLocation: "Start X (Easting)",
			startYLocation: "Start Y (Northing)",
			startZLocation: "Start Z (Elevation)",
			endXLocation: "End X (Easting)",
			endYLocation: "End Y (Northing)",
			endZLocation: "End Z (Elevation)",
			diameter: `Diameter (${columnOrder.diameter_unit || "mm"})`,
			subdrill: "Subdrill",
			shapeType: "Shape Type",
			holeColour: "Hole Colour",
			holeLength: "Length",
			holeBearing: "Bearing",
			holeAzimuth: "Azimuth",
			holeBurden: "Burden",
			holeSpacing: "Spacing",
			fromHole: "From Hole",
			delay: "Delay",
			delayColour: "Delay Colour"
		};

		// Generate table header based on column order, marking unused columns as "ignored".
		const totalColumns = Object.keys(csvData[0]).length; // Total number of columns in the CSV data.
		for (let i = 0; i < totalColumns; i++) {
			// Find the field name that corresponds to the current column index.
			const fieldName = Object.keys(columnOrder).find((col) => columnOrder[col] == (i + 1).toString());
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
							const fieldName = Object.keys(columnOrder).find((col) => columnOrder[col] == (index + 1).toString());
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
