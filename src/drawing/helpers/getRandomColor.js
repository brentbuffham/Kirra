export function getRandomColor() {
	const letters = "0123456789ABCDEF";
	let color = "#";
	for (let i = 0; i < 6; i++) {
		color += letters[Math.floor(Math.random() * 16)];
	}

	// Convert hex to RGB
	const hex = color.substring(1); // Remove the '#' character
	const bigint = parseInt(hex, 16);
	const r = (bigint >> 16) & 255;
	const g = (bigint >> 8) & 255;
	const b = bigint & 255;

	// Adjust brightness (make it 20% whiter)
	const adjustedR = Math.min(255, r + 0.2 * (255 - r));
	const adjustedG = Math.min(255, g + 0.2 * (255 - g));
	const adjustedB = Math.min(255, b + 0.2 * (255 - b));

	// Convert back to hex
	const adjustedColor = "#" + Math.round(adjustedR).toString(16).padStart(2, "0") + Math.round(adjustedG).toString(16).padStart(2, "0") + Math.round(adjustedB).toString(16).padStart(2, "0");

	return adjustedColor;
}
