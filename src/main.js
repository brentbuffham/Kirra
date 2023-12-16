import './style.css'
import { setupCounter } from './counter.js'

document.querySelector('#app').innerHTML = `
  <div>
   Here is my app 
  </div>
`

setupCounter(document.querySelector('#counter'))
