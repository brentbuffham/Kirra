//main.js
import "./style.css";
import { renderLeftPanel } from "./leftPanel.js";
import { drawDummy } from "./drawing/drawDummy.js";
import { createScene } from "./drawing/createScene.js";
import { parseCSV } from "./file/import/csvHandler.js"; // Import parseCSV function directly here
import { renderFileUpload } from "./file/import/fileUpload.js";

document.querySelector("#app").innerHTML = `
  <div id="header">header</div>
  <div id="left-panel">left panel</div>
  <div id="canvas">canvas</div>
  <div id="right-panel">right panel</div>
  <div id="bottom">bottom</div>
`;

const sceneObject = createScene();

renderFileUpload("#left-panel", sceneObject);
