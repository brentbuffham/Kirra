// src/dialog/popups/analytics/TimeInteractionDialog.js
import { FloatingDialog } from "../../FloatingDialog.js";
import { bakeLiveShaderTo2D, removeLiveFlattenedImage } from "../../../helpers/BlastAnalysisShaderHelper.js";
import { calculateDownholeTimings, getTimingRange } from "../../../helpers/DownholeTimingCalculator.js";

/**
 * TimeInteractionDialog provides real-time time-slice control for
 * blast analysis shader models that support timing (PPV, Scaled Heelan,
 * Heelan Original, Non-Linear Damage).
 *
 * The slider updates the shader's uDisplayTime uniform in real-time,
 * updating the 3D view. A debounced re-bake updates the 2D canvas view.
 * [Generate] bakes the current time-slice as a permanent surface.
 * [Cancel] removes the live shader and reverts.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.surfaceId - ID of the live analysis surface
 * @param {THREE.ShaderMaterial} config.shaderMaterial - Direct reference to live shader material
 * @param {string} config.modelName - Active model name
 * @param {Object} config.params - Model parameters
 * @param {Object} config.liveConfig - Full config for re-baking ({ model, surfaceId, blastName, planePadding, params })
 * @param {Function} config.onFreeze - Callback when [Generate] is clicked, receives { surfaceId, timeMs }
 * @param {Function} config.onClose - Callback when dialog is closed/cancelled
 */
export function showTimeInteractionDialog(config) {
	if (!config || !config.surfaceId) {
		console.error("TimeInteractionDialog: Missing surfaceId");
		return;
	}

	// Direct reference to the live shader material
	var shaderMat = config.shaderMaterial || null;

	// Calculate timing range from blast holes
	// Surface times (min fire time = earliest surface delay)
	var maxSurfaceTime = 0;
	var minSurfaceTime = Infinity;
	if (window.allBlastHoles) {
		for (var i = 0; i < window.allBlastHoles.length; i++) {
			var hole = window.allBlastHoles[i];
			var t = parseFloat(hole.holeTime || hole.timingDelayMilliseconds || 0);
			if (typeof hole.holeTime === "string") {
				var match = hole.holeTime.match(/(\d+)/);
				if (match) t = parseFloat(match[1]);
			}
			if (t > maxSurfaceTime) maxSurfaceTime = t;
			if (t < minSurfaceTime) minSurfaceTime = t;
		}
	}
	if (!isFinite(minSurfaceTime)) minSurfaceTime = 0;

	// Include downhole detonation times (surface + downhole delay per deck)
	var maxFireTime = maxSurfaceTime;
	var minFireTime = minSurfaceTime;
	if (window.allBlastHoles && window.loadedCharging) {
		var entries = calculateDownholeTimings(window.allBlastHoles, window.loadedCharging, { visibleOnly: false });
		if (entries.length > 0) {
			var range = getTimingRange(entries);
			if (range.maxMs > maxFireTime) maxFireTime = range.maxMs;
			if (range.minMs < minFireTime) minFireTime = range.minMs;
		}
	}
	if (maxFireTime <= 0) maxFireTime = 1000;

	// Max = max downhole detonation time + 500ms buffer
	var sliderMax = Math.ceil(maxFireTime + 500);
	var sliderStep = Math.max(1, Math.round(sliderMax / 500));

	// Debounce timer for 2D bake
	var bakeDebounceTimer = null;
	var BAKE_DEBOUNCE_MS = 200;

	// Detect dark mode
	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	// Playback state
	var playAnimId = null;
	var playSpeed = 1;
	var lastFrameTime = 0;
	var loopEnabled = false;

	// ── Icon-button factory (matches BlastAnimationDialog) ──
	function makeTransportBtn(iconSrc, tooltip, onClick) {
		var btn = document.createElement("button");
		btn.type = "button";
		btn.title = tooltip;
		btn.style.width = "26px";
		btn.style.height = "26px";
		btn.style.padding = "2px";
		btn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
		btn.style.borderRadius = "4px";
		btn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		btn.style.cursor = "pointer";
		btn.style.display = "flex";
		btn.style.alignItems = "center";
		btn.style.justifyContent = "center";
		btn.style.flexShrink = "0";
		var img = document.createElement("img");
		img.src = iconSrc;
		img.style.width = "18px";
		img.style.height = "18px";
		img.style.filter = dark ? "invert(0.8)" : "invert(0.2)";
		btn.appendChild(img);
		btn.addEventListener("click", onClick);
		return btn;
	}

	// ── Build dialog content ──
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px";

	// ── Transport row ──
	var transportRow = document.createElement("div");
	transportRow.style.display = "flex";
	transportRow.style.alignItems = "center";
	transportRow.style.gap = "4px";
	transportRow.style.justifyContent = "center";

	// Rewind
	var rewindBtn = makeTransportBtn("icons/player-track-prev.png", "Rewind to start", function () {
		stopPlayback();
		slider.value = "0";
		updateTimeSlice(0);
	});
	transportRow.appendChild(rewindBtn);

	// Step Back
	var stepBackBtn = makeTransportBtn("icons/player-skip-back.png", "Step -1ms", function () {
		stopPlayback();
		var cur = parseFloat(slider.value);
		var newVal = Math.max(0, cur - parseFloat(slider.step));
		slider.value = String(newVal);
		updateTimeSlice(newVal);
	});
	transportRow.appendChild(stepBackBtn);

	// Play / Pause toggle
	var playPauseBtn = makeTransportBtn("icons/player-play.png", "Play", function () {
		if (playAnimId) {
			stopPlayback();
			playPauseBtn.querySelector("img").src = "icons/player-play.png";
			playPauseBtn.title = "Play";
		} else {
			startPlayback();
			playPauseBtn.querySelector("img").src = "icons/player-pause.png";
			playPauseBtn.title = "Pause";
		}
	});
	transportRow.appendChild(playPauseBtn);

	// Stop
	var stopBtn = makeTransportBtn("icons/player-stop.png", "Stop", function () {
		stopPlayback();
		slider.value = "0";
		updateTimeSlice(0);
		playPauseBtn.querySelector("img").src = "icons/player-play.png";
		playPauseBtn.title = "Play";
	});
	transportRow.appendChild(stopBtn);

	// Step Forward
	var stepFwdBtn = makeTransportBtn("icons/player-skip-forward.png", "Step +1ms", function () {
		stopPlayback();
		var cur = parseFloat(slider.value);
		var newVal = Math.min(sliderMax, cur + parseFloat(slider.step));
		slider.value = String(newVal);
		updateTimeSlice(newVal);
	});
	transportRow.appendChild(stepFwdBtn);

	// Forward to end
	var fwdEndBtn = makeTransportBtn("icons/player-track-next.png", "Forward to end", function () {
		stopPlayback();
		slider.value = String(sliderMax);
		updateTimeSlice(sliderMax);
	});
	transportRow.appendChild(fwdEndBtn);

	// Loop toggle
	var loopBtn = makeTransportBtn("icons/repeat.png", "Loop", function () {
		loopEnabled = !loopEnabled;
		if (loopEnabled) {
			loopBtn.style.border = "1px solid rgba(0,200,0,0.6)";
			loopBtn.style.background = "rgba(0,200,0,0.15)";
		} else {
			loopBtn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
			loopBtn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		}
	});
	transportRow.appendChild(loopBtn);

	container.appendChild(transportRow);

	// ── Speed row ──
	var speedRow = document.createElement("div");
	speedRow.style.display = "flex";
	speedRow.style.alignItems = "center";
	speedRow.style.gap = "6px";
	speedRow.style.padding = "0 4px";

	var speedSlider = document.createElement("input");
	speedSlider.type = "range";
	speedSlider.min = "0";
	speedSlider.max = "100";
	speedSlider.step = "1";
	speedSlider.value = "50";
	speedSlider.style.flex = "1";
	speedSlider.title = "Play Speed";
	speedSlider.addEventListener("input", function () {
		playSpeed = window.playSpeedLogScale(parseFloat(speedSlider.value));
		speedLabel.textContent = playSpeed.toFixed(3) + "x";
	});

	var speedLabel = document.createElement("span");
	speedLabel.style.fontSize = "11px";
	speedLabel.style.color = dark ? "#ccc" : "#333";
	speedLabel.style.minWidth = "60px";
	speedLabel.textContent = "1.000x";

	speedRow.appendChild(speedSlider);
	speedRow.appendChild(speedLabel);
	container.appendChild(speedRow);

	// ── Time slider ──
	var slider = document.createElement("input");
	slider.type = "range";
	slider.min = "0";
	slider.max = String(sliderMax);
	slider.step = String(sliderStep);
	slider.value = String(sliderMax);
	slider.style.width = "100%";
	slider.style.cursor = "pointer";
	slider.style.height = "28px";
	slider.style.margin = "0";
	container.appendChild(slider);

	// ── Time display ──
	var timeDisplay = document.createElement("div");
	timeDisplay.style.textAlign = "center";
	timeDisplay.style.fontSize = "18px";
	timeDisplay.style.fontWeight = "bold";
	timeDisplay.style.color = "#4DA6FF";
	timeDisplay.style.padding = "8px";
	timeDisplay.style.background = dark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.06)";
	timeDisplay.style.borderRadius = "5px";
	timeDisplay.style.flexShrink = "0";
	timeDisplay.textContent = sliderMax.toFixed(1) + " ms";
	container.appendChild(timeDisplay);

	// Min/Max info
	var rangeInfo = document.createElement("div");
	rangeInfo.style.display = "flex";
	rangeInfo.style.justifyContent = "space-between";
	rangeInfo.style.fontSize = "11px";
	rangeInfo.style.color = "#888";
	rangeInfo.style.flexShrink = "0";
	rangeInfo.innerHTML = "<span>Min: " + minFireTime.toFixed(0) + " ms</span>"
		+ "<span>Max: " + maxFireTime.toFixed(0) + " ms (+500 buffer)</span>";
	container.appendChild(rangeInfo);

	// ── Playback functions ──
	function startPlayback() {
		if (playAnimId) return;
		lastFrameTime = performance.now();
		function animateStep(now) {
			var dt = now - lastFrameTime;
			lastFrameTime = now;
			var currentVal = parseFloat(slider.value);
			var advance = dt * playSpeed;
			var newVal = currentVal + advance;
			if (newVal >= sliderMax) {
				if (loopEnabled) {
					newVal = 0;
				} else {
					slider.value = String(sliderMax);
					updateTimeSlice(sliderMax);
					stopPlayback();
					playPauseBtn.querySelector("img").src = "icons/player-play.png";
					playPauseBtn.title = "Play";
					return;
				}
			}
			slider.value = String(Math.round(newVal / parseFloat(slider.step)) * parseFloat(slider.step));
			updateTimeSlice(parseFloat(slider.value));
			playAnimId = requestAnimationFrame(animateStep);
		}
		playAnimId = requestAnimationFrame(animateStep);
	}

	function stopPlayback() {
		if (playAnimId) {
			cancelAnimationFrame(playAnimId);
			playAnimId = null;
		}
	}

	// ── Debounced 2D bake ──
	function debouncedBake2D(timeMs) {
		if (bakeDebounceTimer) clearTimeout(bakeDebounceTimer);
		bakeDebounceTimer = setTimeout(function () {
			if (config.liveConfig) {
				var bakeParams = Object.assign({}, config.liveConfig.params, { displayTime: timeMs });
				var bakeConfig = Object.assign({}, config.liveConfig, { params: bakeParams });
				bakeLiveShaderTo2D(config.surfaceId, bakeConfig);
			}
		}, BAKE_DEBOUNCE_MS);
	}

	// ── Update time slice ──
	function updateTimeSlice(timeMs) {
		timeDisplay.textContent = timeMs.toFixed(1) + " ms";

		// Update shader uniform — immediate 3D update
		if (shaderMat && shaderMat.uniforms && shaderMat.uniforms.uDisplayTime) {
			shaderMat.uniforms.uDisplayTime.value = timeMs;
			shaderMat.uniformsNeedUpdate = true;
		}

		// Re-render 3D
		if (window.threeRenderer) {
			window.threeRenderer.needsRender = true;
		}

		// Debounced 2D bake
		debouncedBake2D(timeMs);
	}

	// Wire up slider input event
	slider.addEventListener("input", function () {
		updateTimeSlice(parseFloat(this.value));
	});

	// ── Dialog ──
	var dialog = new FloatingDialog({
		title: "Time Interaction — " + (config.modelName || "Analysis"),
		content: container,
		width: 420,
		height: 280,
		showConfirm: true,
		confirmText: "Generate",
		cancelText: "Cancel",
		onConfirm: function () {
			var timeMs = parseFloat(slider.value);
			stopPlayback();
			if (bakeDebounceTimer) clearTimeout(bakeDebounceTimer);
			removeLiveFlattenedImage(config.surfaceId);
			if (config.onFreeze) {
				config.onFreeze({
					surfaceId: config.surfaceId,
					timeMs: timeMs,
					modelName: config.modelName,
					params: config.params
				});
			}
		},
		onCancel: function () {
			stopPlayback();
			if (bakeDebounceTimer) clearTimeout(bakeDebounceTimer);
			removeLiveFlattenedImage(config.surfaceId);
			if (config.onClose) {
				config.onClose();
			}
		}
	});

	dialog.show();
}
