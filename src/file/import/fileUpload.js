export const renderFileUpload = (containerId) => {
    const container = document.querySelector(containerId); // or '#left-panel' if it's an id
    const fileUpload = `
    <div id="file-upload">
         <input type="file" id="file-input" />
         <label for="file-input">Choose a file</label>
    </div>
`;

    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = fileUpload;
    container.appendChild(tempContainer);
}
o
const fileUpload = () => {

}

