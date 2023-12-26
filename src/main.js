import './style.css'
import {renderLeftPanel} from "./leftPanel.js";
import {drawDummy} from "./drawing/drawDummy.js";

document.querySelector('#app').innerHTML = `
  <div id="header">header</div>
  <div id="left-panel">left panel</div>
  <div id="canvas">canvas</div>
  <div id="right-panel">right panel</div>
  <div id="bottom">bottom</div>
`
renderLeftPanel();
drawDummy();
