// Example: Adding event listeners to the first button
import {handleFileUploadNoEvent} from "../../file/import/fileUpload.js";
import {params} from "../../drawing/createScene.js";

export const bindListenerToImportCsvButton = () => {
    document.getElementById("btn-import-csv").addEventListener("click", function () {
        // Interaction with Three.js scene
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".csv";
        fileInput.style.display = "none"; // Hide the file input

        fileInput.onchange = e => {
            if (e.target.files && e.target.files[0]) {
                handleFileUploadNoEvent(e.target.files[0]);
            }
        };

        document.body.appendChild(fileInput); // Add file input to the document
        fileInput.click(); // Trigger the file input
        document.body.removeChild(fileInput); // Remove the file input after use
        if (params.debugComments) {
            console.log("Load File button clicked");
        }

    });
}
