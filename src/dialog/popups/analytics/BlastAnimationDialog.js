// src/dialog/popups/analytics/BlastAnimationDialog.js
import { FloatingDialog } from "../../FloatingDialog.js";

// ────────────────────────────────────────────────────────
// Module-scoped state
// ────────────────────────────────────────────────────────
var blastAnimationDialog = null;
var blastAnimationLoopEnabled = false;
var blastAnimCurrentTime = 0;
var blastAnimMaxTime = 0;

/**
 * Step 1) Show the Blast Animation transport-bar dialog.
 * Reads timing data from window.allBlastHoles via window.calculateTimes().
 * Controls playback via window.drawData(), window.playSpeed, window.animationFrameId, etc.
 */
export function showBlastAnimationDialog() {
	// Step 1) Close existing dialog if open
	if (blastAnimationDialog) {
		blastAnimationDialog.closeSilently();
		blastAnimationDialog = null;
	}

	// Step 2) Calculate timing
	var holeTimes = window.calculateTimes(window.allBlastHoles);
	blastAnimMaxTime = 0;
	if (holeTimes && holeTimes.length > 0) {
		var times = holeTimes.map(function (t) { return t[1]; }).filter(function (t) { return !isNaN(t) && isFinite(t); });
		blastAnimMaxTime = times.length > 0 ? Math.max.apply(null, times) : 0;
	}

	// Step 3) Detect dark mode
	var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;

	// Step 4) Build transport bar content
	var container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "8px";
	container.style.padding = "4px";

	// Transport row
	var transportRow = document.createElement("div");
	transportRow.style.display = "flex";
	transportRow.style.alignItems = "center";
	transportRow.style.gap = "4px";
	transportRow.style.justifyContent = "center";

	// Step 5) Icon-button factory (matches SurfaceBooleanDialog target-picker style)
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

	// Step 6) Rewind
	var rewindBtn = makeTransportBtn("icons/player-track-prev.png", "Rewind to start", function () {
		stopBlastAnimation();
		blastAnimCurrentTime = 0;
		window.timingWindowHolesSelected = [];
		window.drawData(window.allBlastHoles, window.timingWindowHolesSelected);
		updateTimeLabel();
	});
	transportRow.appendChild(rewindBtn);

	// Step 7) Step Back -1ms
	var stepBackBtn = makeTransportBtn("icons/player-skip-back.png", "Step -1ms", function () {
		stopBlastAnimation();
		blastAnimCurrentTime = Math.max(0, blastAnimCurrentTime - 1);
		window.timingWindowHolesSelected = window.allBlastHoles.filter(function (h) { return h.holeTime <= blastAnimCurrentTime; });
		window.drawData(window.allBlastHoles, window.timingWindowHolesSelected);
		updateTimeLabel();
	});
	transportRow.appendChild(stepBackBtn);

	// Step 8) Play/Pause toggle
	var playPauseBtn = makeTransportBtn("icons/player-play.png", "Play", function () {
		if (window.isPlaying) {
			stopBlastAnimation();
			playPauseBtn.querySelector("img").src = "icons/player-play.png";
			playPauseBtn.title = "Play";
		} else {
			startBlastAnimation(playPauseBtn);
			playPauseBtn.querySelector("img").src = "icons/player-pause.png";
			playPauseBtn.title = "Pause";
		}
	});
	transportRow.appendChild(playPauseBtn);

	// Step 9) Stop
	var stopBtn = makeTransportBtn("icons/player-stop.png", "Stop", function () {
		stopBlastAnimation();
		blastAnimCurrentTime = 0;
		window.timingWindowHolesSelected = [];
		window.drawData(window.allBlastHoles, window.timingWindowHolesSelected);
		playPauseBtn.querySelector("img").src = "icons/player-play.png";
		playPauseBtn.title = "Play";
		updateTimeLabel();
	});
	transportRow.appendChild(stopBtn);

	// Step 10) Step Forward +1ms
	var stepFwdBtn = makeTransportBtn("icons/player-skip-forward.png", "Step +1ms", function () {
		stopBlastAnimation();
		blastAnimCurrentTime = Math.min(blastAnimMaxTime, blastAnimCurrentTime + 1);
		window.timingWindowHolesSelected = window.allBlastHoles.filter(function (h) { return h.holeTime <= blastAnimCurrentTime; });
		window.drawData(window.allBlastHoles, window.timingWindowHolesSelected);
		updateTimeLabel();
	});
	transportRow.appendChild(stepFwdBtn);

	// Step 11) Forward to end
	var fwdEndBtn = makeTransportBtn("icons/player-track-next.png", "Forward to end", function () {
		stopBlastAnimation();
		blastAnimCurrentTime = blastAnimMaxTime;
		window.timingWindowHolesSelected = window.allBlastHoles.filter(function (h) { return h.holeTime <= blastAnimCurrentTime; });
		window.drawData(window.allBlastHoles, window.timingWindowHolesSelected);
		updateTimeLabel();
	});
	transportRow.appendChild(fwdEndBtn);

	// Step 12) Loop toggle
	var loopBtn = makeTransportBtn("icons/repeat.png", "Loop", function () {
		blastAnimationLoopEnabled = !blastAnimationLoopEnabled;
		if (blastAnimationLoopEnabled) {
			loopBtn.style.border = "1px solid rgba(0,200,0,0.6)";
			loopBtn.style.background = "rgba(0,200,0,0.15)";
		} else {
			loopBtn.style.border = dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.2)";
			loopBtn.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
		}
	});
	if (blastAnimationLoopEnabled) {
		loopBtn.style.border = "1px solid rgba(0,200,0,0.6)";
		loopBtn.style.background = "rgba(0,200,0,0.15)";
	}
	transportRow.appendChild(loopBtn);

	container.appendChild(transportRow);

	// Step 13) Speed row
	var speedRow = document.createElement("div");
	speedRow.style.display = "flex";
	speedRow.style.alignItems = "center";
	speedRow.style.gap = "6px";
	speedRow.style.padding = "0 4px";

	var speedLabel = document.createElement("span");
	speedLabel.style.fontSize = "11px";
	speedLabel.style.color = dark ? "#ccc" : "#333";
	speedLabel.style.minWidth = "60px";
	speedLabel.textContent = window.playSpeed.toFixed(3) + "x";

	var speedSlider = document.createElement("input");
	speedSlider.type = "range";
	speedSlider.min = "0";
	speedSlider.max = "100";
	speedSlider.value = "50";
	speedSlider.step = "1";
	speedSlider.style.flex = "1";
	speedSlider.title = "Play Speed";
	speedSlider.addEventListener("input", function () {
		window.playSpeed = window.playSpeedLogScale(parseFloat(speedSlider.value));
		speedLabel.textContent = window.playSpeed.toFixed(3) + "x";
	});

	speedRow.appendChild(speedSlider);
	speedRow.appendChild(speedLabel);
	container.appendChild(speedRow);

	// Step 14) Time label
	var timeLabel = document.createElement("div");
	timeLabel.style.fontSize = "11px";
	timeLabel.style.color = dark ? "#aaa" : "#555";
	timeLabel.style.textAlign = "center";
	timeLabel.textContent = "Time: " + blastAnimCurrentTime.toFixed(1) + " / " + blastAnimMaxTime.toFixed(1) + " ms";
	container.appendChild(timeLabel);

	function updateTimeLabel() {
		timeLabel.textContent = "Time: " + blastAnimCurrentTime.toFixed(1) + " / " + blastAnimMaxTime.toFixed(1) + " ms";
	}

	// Step 15) Animation loop
	function startBlastAnimation(playBtn) {
		window.isPlaying = true;
		var lastFrameTime = performance.now();
		var lastRenderTime = 0;
		var targetFPS = 60;
		var frameInterval = 1000 / targetFPS;

		function animLoop() {
			if (!window.isPlaying) return;
			var now = performance.now();
			var realTimeElapsed = now - lastFrameTime;
			var blastTimeToAdvance = realTimeElapsed * window.playSpeed;
			blastAnimCurrentTime += blastTimeToAdvance;
			lastFrameTime = now;

			var bufferTime = 500 * Math.max(window.playSpeed, 0.1);
			if (blastAnimCurrentTime <= blastAnimMaxTime + bufferTime) {
				var timeSinceRender = now - lastRenderTime;
				if (timeSinceRender >= frameInterval) {
					window.timingWindowHolesSelected = window.allBlastHoles.filter(function (h) { return h.holeTime <= blastAnimCurrentTime; });
					window.drawData(window.allBlastHoles, window.timingWindowHolesSelected);
					updateTimeLabel();
					lastRenderTime = now - (timeSinceRender % frameInterval);
				}
				window.animationFrameId = requestAnimationFrame(animLoop);
			} else {
				window.timingWindowHolesSelected = window.allBlastHoles.filter(function (h) { return h.holeTime <= blastAnimCurrentTime; });
				window.drawData(window.allBlastHoles, window.timingWindowHolesSelected);
				updateTimeLabel();
				if (blastAnimationLoopEnabled) {
					blastAnimCurrentTime = 0;
					lastFrameTime = performance.now();
					window.animationFrameId = requestAnimationFrame(animLoop);
				} else {
					window.isPlaying = false;
					playBtn.querySelector("img").src = "icons/player-play.png";
					playBtn.title = "Play";
				}
			}
		}
		window.animationFrameId = requestAnimationFrame(animLoop);
	}

	// Step 16) Stop animation helper
	function stopBlastAnimation() {
		window.isPlaying = false;
		if (window.animationInterval) {
			clearInterval(window.animationInterval);
			window.animationInterval = null;
		}
		if (window.animationFrameId) {
			cancelAnimationFrame(window.animationFrameId);
			window.animationFrameId = null;
		}
	}

	// Step 17) Create the dialog
	blastAnimationDialog = new FloatingDialog({
		title: "Blast Animation",
		content: container,
		layoutType: "compact",
		width: 420,
		height: 130,
		passthroughKeys: true,
		showConfirm: false,
		showCancel: false,
		onCancel: function () {
			stopBlastAnimation();
			window.timingWindowHolesSelected = [];
			blastAnimationDialog = null;
		}
	});
	blastAnimationDialog.show();
}

// Step 18) Wire button on DOMContentLoaded
document.addEventListener("DOMContentLoaded", function () {
	var blastAnimBtn = document.getElementById("blastAnimationBtn");
	if (blastAnimBtn) {
		blastAnimBtn.addEventListener("click", showBlastAnimationDialog);
	}
});

// Step 19) Expose globally
window.showBlastAnimationDialog = showBlastAnimationDialog;
