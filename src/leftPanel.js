import {renderFileUpload} from "./file/import/fileUpload.js";

export const renderLeftPanel = () => {
    // create multiple sections, each section represents a feature
    // you will have an Id for each section, pass the id to the child element
    renderCreatingHolesSection();

    // render other sections

    renderFileUpload('#left-panel');
}

export const renderCreatingHolesSection = () => {
    const container = document.querySelector('#left-panel');
    const content = `
    <div id="render-creating-holes-section">
    </div>
`;

    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = content;
    container.appendChild(tempContainer);
}
