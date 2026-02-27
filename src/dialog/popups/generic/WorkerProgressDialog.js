// src/dialog/popups/generic/WorkerProgressDialog.js
//=============================================================
// WORKER PROGRESS DIALOG
//=============================================================
// Reusable progress dialog for Web Worker operations.
// Shows a FloatingDialog with a progress bar, stage label,
// and details text. Supports update, complete, fail, and cancel.

import { FloatingDialog } from "../../FloatingDialog.js";

/**
 * WorkerProgressDialog - Shows progress during Web Worker operations.
 *
 * @param {string} title - Dialog title (e.g. "Importing LAS File")
 * @param {Object} [options]
 * @param {string} [options.initialMessage] - Initial status message
 * @param {Function} [options.onCancel] - Called when user clicks Cancel
 * @param {number} [options.width] - Dialog width (default 400)
 * @param {number} [options.height] - Dialog height (default 180)
 */
export function WorkerProgressDialog(title, options) {
	options = options || {};

	this.isCancelled = false;
	this.onCancel = options.onCancel || null;

	// Build content
	this.contentDiv = document.createElement("div");
	this.contentDiv.className = "worker-progress-container";
	this.contentDiv.innerHTML =
		'<div class="worker-progress-bar" style="width: 100%; height: 18px; background: var(--input-bg, #e0e0e0); border-radius: 4px; overflow: hidden; margin-bottom: 10px;">' +
			'<div class="worker-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); transition: width 0.3s ease;"></div>' +
		'</div>' +
		'<div class="worker-progress-message" style="font-size: 13px; color: var(--text-color, #666); margin-bottom: 4px;">' +
			(options.initialMessage || "Initializing...") +
		'</div>' +
		'<div class="worker-progress-details" style="font-size: 11px; color: var(--text-secondary, #888);"></div>';

	this.progressFill = this.contentDiv.querySelector(".worker-progress-fill");
	this.messageDiv = this.contentDiv.querySelector(".worker-progress-message");
	this.detailsDiv = this.contentDiv.querySelector(".worker-progress-details");

	var self = this;
	var showCancel = typeof options.onCancel === "function";

	this.dialog = new FloatingDialog({
		title: title,
		content: this.contentDiv,
		width: options.width || 400,
		height: options.height || 180,
		showConfirm: false,
		showCancel: showCancel,
		cancelText: "Cancel",
		onCancel: function () {
			self.isCancelled = true;
			if (self.onCancel) self.onCancel();
		}
	});
}

/**
 * Show the dialog
 */
WorkerProgressDialog.prototype.show = function () {
	this.dialog.show();
};

/**
 * Close the dialog
 */
WorkerProgressDialog.prototype.close = function () {
	this.dialog.close();
};

/**
 * Update progress from a worker message.
 * @param {number} percent - 0-100
 * @param {string} message - Status message
 */
WorkerProgressDialog.prototype.update = function (percent, message) {
	if (this.isCancelled) return;
	this.progressFill.style.width = Math.min(100, Math.max(0, percent)) + "%";
	if (message) this.messageDiv.textContent = message;
};

/**
 * Set additional details text below the main message.
 * @param {string} text
 */
WorkerProgressDialog.prototype.setDetails = function (text) {
	if (this.isCancelled) return;
	this.detailsDiv.textContent = text;
};

/**
 * Mark as complete — green bar, success message, auto-close after delay.
 * @param {string} [message] - Completion message
 * @param {number} [autoCloseMs] - Auto-close delay in ms (0 = no auto-close, default 1500)
 */
WorkerProgressDialog.prototype.complete = function (message, autoCloseMs) {
	this.progressFill.style.width = "100%";
	this.progressFill.style.background = "linear-gradient(90deg, #4CAF50, #81C784)";
	this.messageDiv.textContent = message || "Complete!";

	// Change cancel button to Close
	var cancelBtn = this.dialog.element ? this.dialog.element.querySelector(".floating-dialog-btn.cancel") : null;
	if (cancelBtn) {
		cancelBtn.textContent = "Close";
	}

	var self = this;
	var delay = autoCloseMs !== undefined ? autoCloseMs : 1500;
	if (delay > 0) {
		setTimeout(function () { self.close(); }, delay);
	}
};

/**
 * Mark as failed — red bar, error message.
 * @param {string} [message] - Error message
 */
WorkerProgressDialog.prototype.fail = function (message) {
	this.progressFill.style.background = "#f44336";
	this.progressFill.style.width = "100%";
	this.messageDiv.textContent = message || "Operation failed";
	this.messageDiv.style.color = "#f44336";

	var cancelBtn = this.dialog.element ? this.dialog.element.querySelector(".floating-dialog-btn.cancel") : null;
	if (cancelBtn) {
		cancelBtn.textContent = "Close";
	}
};

/**
 * Create and show a worker progress dialog.
 * @param {string} title
 * @param {Object} [options]
 * @returns {WorkerProgressDialog}
 */
export function showWorkerProgressDialog(title, options) {
	var dialog = new WorkerProgressDialog(title, options);
	dialog.show();
	return dialog;
}
