import "./style.css";
import { createScene } from "./drawing/createScene.js";
import { renderFileUpload } from "./file/import/fileUpload.js";

document.querySelector("#app").innerHTML = `
  <div id="header">header</div>
  <div id="left-panel">left panel</div>
  <div id="canvas">canvas</div>
  <div id="right-panel">right panel</div>
  <div id="bottom">bottom</div>
`;

const scene = createScene();
renderFileUpload("#left-panel", scene);
