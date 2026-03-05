/**
 * ScreenPickHelper.js
 *
 * Shared pick-row UI pattern for dialogs that need screen-pick selection.
 * Provides:
 *   - createPickRow(label, options, defaultValue, onPickClick) — builds [Label] [🎯] [Dropdown]
 *   - enterKADPickMode(pickRow, onPicked) — activates Select Pointer + KAD radio, polls for selection
 *   - exitKADPickMode() — cleans up pick mode
 *
 * Uses the same polling pattern as the Triangulation dialog (KADDialogs.js):
 *   1. Activate selectPointer + selectKAD radio
 *   2. Poll window.selectedKADObject every 200ms for changes
 *   3. When a new closed poly is selected, call onPicked and exit
 */

// ────────────────────────────────────────────────────────
// Module-level state
// ────────────────────────────────────────────────────────
var pickModeActive = false;
var pickPollInterval = null;
var activePickBtn = null;

function isDarkMode() {
	return typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
}

// ────────────────────────────────────────────────────────
// createPickRow — builds [Label] [Pick Button] [Dropdown]
// ────────────────────────────────────────────────────────

/**
 * Build a pick-row: label + target-arrow button + dropdown select.
 * @param {string} label — row label text
 * @param {Array<{value:string, text:string}>} options — dropdown options
 * @param {string} defaultValue — initial selected value
 * @param {Function} onPickClick — called when the pick button is clicked
 * @returns {{ row: HTMLElement, select: HTMLSelectElement, pickBtn: HTMLButtonElement }}
 */
export function createPickRow(label, options, defaultValue, onPickClick) {
	var dark = isDarkMode();
	var row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.gap = "8px";

	var labelEl = document.createElement("label");
	labelEl.textContent = label;
	labelEl.style.minWidth = "80px";
	labelEl.style.fontSize = "13px";
	labelEl.style.fontWeight = "bold";
	labelEl.style.flexShrink = "0";

	var pickBtn = document.createElement("button");
	pickBtn.type = "button";
	pickBtn.title = "Pick from canvas";
	pickBtn.style.width = "28px";
	pickBtn.style.height = "28px";
	pickBtn.style.padding = "2px";
	pickBtn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
	pickBtn.style.borderRadius = "4px";
	pickBtn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
	pickBtn.style.cursor = "pointer";
	pickBtn.style.flexShrink = "0";
	pickBtn.style.display = "flex";
	pickBtn.style.alignItems = "center";
	pickBtn.style.justifyContent = "center";

	var pickImg = document.createElement("img");
	pickImg.src = "icons/target-arrow.png";
	pickImg.style.width = "20px";
	pickImg.style.height = "20px";
	pickImg.style.filter = dark ? "invert(0.8)" : "invert(0.2)";
	pickBtn.appendChild(pickImg);

	pickBtn.addEventListener("click", onPickClick);

	var select = document.createElement("select");
	select.style.flex = "1";
	select.style.padding = "4px 6px";
	select.style.fontSize = "12px";
	select.style.borderRadius = "4px";
	select.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid #999";
	select.style.background = dark ? "rgba(30,30,30,0.9)" : "#fff";
	select.style.color = dark ? "#eee" : "#333";
	select.style.minWidth = "0";

	for (var i = 0; i < options.length; i++) {
		var opt = document.createElement("option");
		opt.value = options[i].value;
		opt.textContent = options[i].text;
		if (options[i].value === defaultValue) opt.selected = true;
		select.appendChild(opt);
	}

	row.appendChild(labelEl);
	row.appendChild(pickBtn);
	row.appendChild(select);

	return { row: row, select: select, pickBtn: pickBtn };
}

// ────────────────────────────────────────────────────────
// KAD polygon pick mode — polling pattern (same as Triangulation dialog)
// ────────────────────────────────────────────────────────

/**
 * Enter screen-pick mode for KAD closed polygons.
 *
 * Copies the proven pattern from showTriangulationPopup() in KADDialogs.js:
 *   1. Activate selectPointer tool (dispatches "change" → attaches handleSelection)
 *   2. Activate selectKAD radio (dispatches "change" → handleSelection looks for KAD)
 *   3. Highlight pick button red
 *   4. Poll window.selectedKADObject every 200ms
 *   5. When a new closed poly is detected, call onPicked(entityName) and exit
 *
 * Clicking the pick button again toggles off (same as triangulation).
 *
 * @param {{ pickBtn: HTMLButtonElement, select: HTMLSelectElement }} pickRow
 * @param {Function} onPicked — callback(entityName) when a closed polygon is picked
 */
export function enterKADPickMode(pickRow, onPicked) {
	// Toggle off if already active
	if (pickModeActive) {
		exitKADPickMode();
		return;
	}

	// Clean up any prior pick state
	exitKADPickMode();

	// Step 1) Activate select pointer tool
	var selectPointerBtn = document.getElementById("selectPointer");
	if (selectPointerBtn && !selectPointerBtn.checked) {
		selectPointerBtn.checked = true;
		selectPointerBtn.dispatchEvent(new Event("change"));
	}

	// Step 2) Activate KAD selection mode via the selectKAD radio button
	var selectKADRadio = document.getElementById("selectKAD");
	if (selectKADRadio && !selectKADRadio.checked) {
		selectKADRadio.checked = true;
		selectKADRadio.dispatchEvent(new Event("change"));
	}

	// Step 3) Highlight pick button red
	pickModeActive = true;
	activePickBtn = pickRow.pickBtn;
	pickRow.pickBtn.style.background = "rgba(255,60,60,0.4)";
	pickRow.pickBtn.style.borderColor = "#FF4444";

	// Step 4) Poll for selectedKADObject changes
	var prevSelectedName = window.selectedKADObject ? window.selectedKADObject.entityName : null;
	pickPollInterval = setInterval(function () {
		var current = window.selectedKADObject;
		if (current && current.entityType === "poly" && current.entityName && current.entityName !== prevSelectedName) {
			// A new polygon was selected — check if closed
			if (isClosedPoly(current.entityName)) {
				// Update dropdown
				pickRow.select.value = current.entityName;
				if (pickRow.select.value !== current.entityName) {
					// Not in dropdown yet — add it
					var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(current.entityName) : null;
					var ptCount = entity && entity.data ? entity.data.length : 0;
					var newOpt = document.createElement("option");
					newOpt.value = current.entityName;
					newOpt.textContent = current.entityName + " (" + ptCount + " pts)";
					pickRow.select.appendChild(newOpt);
					pickRow.select.value = current.entityName;
				}

				// Notify caller
				onPicked(current.entityName);
				console.log("ScreenPickHelper: Picked KAD polygon '" + current.entityName + "'");
			}
			exitKADPickMode();
		}
	}, 200);
}

/**
 * Exit any active KAD pick mode, stop polling, restore button styling.
 */
export function exitKADPickMode() {
	if (!pickModeActive && !pickPollInterval) return;

	pickModeActive = false;
	if (pickPollInterval) {
		clearInterval(pickPollInterval);
		pickPollInterval = null;
	}
	if (activePickBtn) {
		var dark = isDarkMode();
		activePickBtn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		activePickBtn.style.borderColor = dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
		activePickBtn = null;
	}
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/**
 * Check if an entity is a closed polygon with 3+ points.
 */
function isClosedPoly(entityName) {
	var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
	if (!entity || !entity.data || entity.data.length < 3) return false;
	// entityType "poly" is always closed; for lines, check any point's closed flag
	return entity.entityType === "poly" ||
		entity.data.some(function (pt) { return pt.closed === true; });
}
