import "./style.css";
import { createScene } from "./drawing/createScene.js";
import { renderFileUpload, createLilGuiFileUpload } from "./file/import/fileUpload.js";

// document.querySelector("#app").innerHTML = `
//   <div id="header">header</div>
//   <div id="left-panel">left panel</div>
//   <div id="canvas">canvas</div>
//   <div id="right-panel">right panel</div>
//   <div id="bottom">bottom</div>
// `;

document.querySelector("#app").innerHTML = `
<div id="header">
  <div id="kirraLogo">
    <img src="src/assets/svg/kirralogo.svg" alt="Kirra Logo" />
  </div>  
</div>
<div id="canvas"></div>
  `;

let points = []; // Define and initialize the 'points' array

const canvas = createScene(points);
//renderFileUpload("#left-panel", canvas);
createLilGuiFileUpload(canvas);
