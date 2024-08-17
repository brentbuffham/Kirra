import { clearLocalStorageModal } from "../../views/modals/clearLocalStorageModal";

/**
 * Binds a listener to the import CSV button.
 */
export const bindListenerToClearMemoryButton = () => {
	document.getElementById("clear-local-storage").addEventListener("click", function () {
		clearLocalStorageModal();
	});
};
