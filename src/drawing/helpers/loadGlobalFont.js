//loadGlobalFont.js
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TTFLoader } from "three/examples/jsm/loaders/TTFLoader.js";

// Preload the font
export let globalFont;

export function preloadFont() {
	const fontLoader = new TTFLoader();
	fontLoader.load("public/assets/fonts/Roboto/Roboto-Regular.ttf", function(font) {
		globalFont = new Font(font);
	});
}
