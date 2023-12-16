import './style.css'
import {createHole} from "./hole/holeScene.js";

document.querySelector('#app').innerHTML = `
  <div>
   Here is my app 
  </div>
`

createHole();
