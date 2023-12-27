import "./style.css";
import { createScene } from "./drawing/createScene.js";
import { renderFileUpload } from "./file/import/fileUpload.js";
import {drawHole} from "./drawing/hole/drawHole.js";
import {drawDummy} from "./drawing/drawDummy.js";

document.querySelector("#app").innerHTML = `
  <div id="header">header</div>
  <div id="left-panel">left panel</div>
  <div id="canvas">canvas</div>
  <div id="right-panel">right panel</div>
  <div id="bottom">bottom</div>
`;

const canvas = createScene();
renderFileUpload("#left-panel", canvas);
