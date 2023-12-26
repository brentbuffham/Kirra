import './style.css'
import {createHole} from "./threeTrail/holeScene.js";

document.querySelector('#app').innerHTML = `
  <div id="header">header</div>
  <div id="left-panel">left panel</div>
  <div id="canvas">canvas</div>
  <div id="right-panel">right panel</div>
  <div id="bottom">bottom</div>
`

createHole();
