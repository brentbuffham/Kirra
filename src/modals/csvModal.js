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
        }
    `;
	document.head.appendChild(style);

	const modalContainer = document.createElement("div");
	modalContainer.innerHTML = modalHtml;
	document.body.appendChild(modalContainer);

	const csvModal = new Modal(document.getElementById("csvModal"));
	csvModal.show();

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
		console.log("Clear settings clicked");
		const inputs = document.querySelectorAll("#csvForm input[type='number']");
		inputs.forEach((input) => {
			input.value = "";
		});
		updatePreview(csvData);
	});

	document.getElementById("set-order").addEventListener("click", function () {
		console.log("Set order clicked");
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

		handleFileSubmit(csvData, selectedColumns); // Call handleFileSubmit with csvData and selectedColumns
		csvModal.hide();
		document.body.removeChild(modalContainer);
	});

	document.getElementById("headerRows").addEventListener("input", () => updatePreview(csvData));
};

const generateFormGroups = (columns, section) => {
	const fieldsLeft = [
		{ id: "headerRows", label: "Rows to Ignore", type: "number", placeholder: "# rows" },
		{ id: "blastName", label: "Blast Name", placeholder: "Col #", type: "number" },
		{ id: "pointID", label: "Hole Name", type: "number", placeholder: "Col #", required: true },
		{ id: "startXLocation", label: "Start X (Easting)", type: "number", placeholder: "Col #", required: true },
		{ id: "startYLocation", label: "Start Y (Northing)", type: "number", placeholder: "Col #", required: true },
		{ id: "startZLocation", label: "Start Z (Elevation)", type: "number", placeholder: "Col #", required: true },
		{ id: "endXLocation", label: "End X (Easting)", placeholder: "Col #", type: "number" },
		{ id: "endYLocation", label: "End Y (Northing)", placeholder: "Col #", type: "number" },
		{ id: "endZLocation", label: "End Z (Elevation)", placeholder: "Col #", type: "number" },
		{ id: "diameter", label: "Diameter", placeholder: "Col #", type: "number", unit: true }
	];

	const fieldsRight = [
		{ id: "subdrill", label: "Subdrill", placeholder: "Col #", type: "number" },
		{ id: "shapeType", label: "Shape Type", placeholder: "Col #", type: "number" },
		{ id: "holeColour", label: "Hole Colour", placeholder: "Col #", type: "number" },
		{ id: "holeLength", label: "Length", placeholder: "Col #", type: "number" },
		{ id: "holeBearing", label: "Bearing", placeholder: "Col #", type: "number" },
		{ id: "holeAzimuth", label: "Azimuth", placeholder: "Col #", type: "number" },
		{ id: "holeBurden", label: "Burden", placeholder: "Col #", type: "number" },
		{ id: "holeSpacing", label: "Spacing", placeholder: "Col #", type: "number" },
		{ id: "fromHole", label: "From Hole", placeholder: "Col #", type: "number" },
		{ id: "delay", label: "Delay", placeholder: "Col #", type: "number" },
		{ id: "delayColour", label: "Delay Colour", placeholder: "Col #", type: "number" }
	];

	const fields = section === "left" ? fieldsLeft : fieldsRight;

	return fields
		.map((field) => {
			if (["holeName", "startXLocation", "startYLocation", "startZLocation"].includes(field.id)) {
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

const updatePreview = (csvData) => {
	const headerRows = parseInt(document.getElementById("headerRows").value, 10) || 0;
	if (csvData) {
		let previewContent;
		if (headerRows === 0) {
			previewContent = [Object.keys(csvData[0]).join(","), ...csvData.map((row) => Object.values(row).join(","))].join("\n");
		} else {
			previewContent = csvData
				.slice(headerRows - 1)
				.map((row) => Object.values(row).join(","))
				.join("\n");
		}
		document.getElementById("filePreview").value = previewContent;
	}
};
