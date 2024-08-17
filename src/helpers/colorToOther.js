import { Color } from "three";

export function interpolateColor(color1, color2, factor) {
	const c1 = new Color(color1);
	const c2 = new Color(color2);
	const result = c1.lerp(c2, factor);
	return {
		r: result.r,
		g: result.g,
		b: result.b
	};
}

export function hexToRgb(hex) {
	const color = new Color(hex);
	return {
		r: color.r,
		g: color.g,
		b: color.b
	};
}

export function hexToRgbA(hex, alpha) {
	const color = new Color(hex);
	return {
		r: color.r,
		g: color.g,
		b: color.b,
		a: alpha
	};
}

export function rgbToHex(r, g, b) {
	return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function rgbToHexA(r, g, b, a) {
	return (
		"#" +
		((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1) +
		Math.round(a * 255)
			.toString(16)
			.slice(1)
	);
}

export function rgbToHsl(r, g, b) {
	const color = new Color({ r, g, b });
	return color.hsl().object();
}

export function rgbToHsv(r, g, b) {
	const color = new Color({ r, g, b });
	return color.hsv().object();
}

export function hslToRgb(h, s, l) {
	const color = new Color({ h, s, l });
	return color.rgb().object();
}

export function hsvToRgb(h, s, v) {
	const color = new Color({ h, s, v });
	return color.rgb().object();
}
