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
                                        <label for="filePreviewTable">File Contents Preview</label>
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
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8px;
        }
        th, td {
            padding: 1px;
            text-align: center;
            border: 1px solid #ddd;
        }
        th {
            background-color: #f2f2f2;
            font-size: 10px;
        }
        .ignored-column {
            color: gray;
            font-style: italic;
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

        handleFileSubmit(csvData, selectedColumns); // Call handleFileSubmit with csvData and selectedColumns
        csvModal.hide();
        document.body.removeChild(modalContainer);
    });

    document.getElementById("headerRows").addEventListener("input", () => updatePreview(csvData));

    // Call updatePreview to generate the initial table content
    updatePreview(csvData);
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
        { id: "diameter", label: "Diameter", placeholder: "Col #", type: "number", unit: true },
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
        { id: "delayColour", label: "Delay Colour", placeholder: "Col #", type: "number" },
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
    const columnOrder = JSON.parse(localStorage.getItem("columnOrder") || "{}");
    if (csvData) {
        let tableContent = '<table class="table table-striped"><thead><tr>';
        const keys = Object.keys(csvData[0]);

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
            delayColour: "Delay Colour",
        };

        // Generate table header
        tableContent += keys
            .map((key, index) => {
                const fieldName = Object.keys(columnOrder).find((col) => columnOrder[col] == index + 1);
                if (fieldName) {
                    return `<th>${columnLabels[fieldName]}</th>`;
                } else {
                    return `<th class="ignored-column">ignored</th>`;
                }
            })
            .join("");
        tableContent += "</tr></thead><tbody>";

        // Generate table rows
        const rows = headerRows === 0 ? csvData : csvData.slice(headerRows - 1);
        tableContent += rows
            .map((row) => {
                const values = Object.values(row);
                return "<tr>" + values.map((value) => `<td>${value}</td>`).join("") + "</tr>";
            })
            .join("");

        tableContent += "</tbody></table>";

        console.log("Table content generated: ", tableContent);

        // Set the table content to the div
        document.getElementById("filePreviewTable").innerHTML = tableContent;
    }
};
