import {getCount} from "./hole/getCount.js";

export function setupCounter(element) {
  let counter = 0
  const setCounter = (count) => {
    counter = getCount();
    element.innerHTML = `count is ${counter}`
  }
  element.addEventListener('click', () => setCounter(counter + 1))
  setCounter(0)
}
