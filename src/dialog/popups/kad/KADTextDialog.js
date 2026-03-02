// src/dialog/popups/kad/KADTextDialog.js
import { FloatingDialog } from "../../FloatingDialog.js";

// ────────────────────────────────────────────────────────
// Module-scoped state
// ────────────────────────────────────────────────────────
var kadTextDialog = null;

/**
 * Step 1) Show the KAD Text input dialog.
 * Appears when the KAD text drawing tool is activated, disappears on tool switch.
 * The text input syncs with the hidden drawingText element.
 */
export function showKADTextDialog() {
	// Step 2) Close existing dialog if open
	if (kadTextDialog) {
		kadTextDialog.closeSilently();
		kadTextDialog = null;
	}

	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	// Step 3) Build content
	var textContainer = document.createElement("div");
	textContainer.style.display = "flex";
	textContainer.style.flexDirection = "column";
	textContainer.style.gap = "6px";
	textContainer.style.padding = "4px";

	var textInput = document.createElement("input");
	textInput.type = "text";
	textInput.placeholder = "Enter text...";
	textInput.maxLength = 1000;
	textInput.style.width = "100%";
	textInput.style.fontSize = "12px";
	textInput.style.padding = "4px 6px";
	textInput.style.borderRadius = "4px";
	textInput.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid #999";
	textInput.style.background = dark ? "rgba(30,30,30,0.9)" : "#fff";
	textInput.style.color = dark ? "#eee" : "#333";
	var drawingTextEl = document.getElementById("drawingText");
	textInput.value = drawingTextEl ? drawingTextEl.value : "Text";
	textInput.addEventListener("input", function () {
		if (drawingTextEl) drawingTextEl.value = textInput.value;
	});
	textContainer.appendChild(textInput);

	var noteDiv = document.createElement("div");
	noteDiv.style.fontSize = "10px";
	noteDiv.style.color = dark ? "#888" : "#666";
	noteDiv.textContent = "Use \"=\" prefix for JS Math (e.g. =Math.PI)";
	textContainer.appendChild(noteDiv);

	// Step 4) Create the dialog
	kadTextDialog = new FloatingDialog({
		title: "KAD Text",
		content: textContainer,
		layoutType: "compact",
		width: 300,
		height: 100,
		passthroughKeys: true,
		showConfirm: false,
		showCancel: false,
		onCancel: function () {
			kadTextDialog = null;
		}
	});
	kadTextDialog.show();
}

/**
 * Step 5) Close the KAD Text dialog (called when switching tools).
 */
export function closeKADTextDialog() {
	if (kadTextDialog) {
		kadTextDialog.closeSilently();
		kadTextDialog = null;
	}
}

/**
 * Step 6) Check if the KAD Text dialog is currently open.
 */
export function isKADTextDialogOpen() {
	return kadTextDialog !== null;
}

// Step 7) Expose globally
window.showKADTextDialog = showKADTextDialog;
window.closeKADTextDialog = closeKADTextDialog;
window.isKADTextDialogOpen = isKADTextDialogOpen;
