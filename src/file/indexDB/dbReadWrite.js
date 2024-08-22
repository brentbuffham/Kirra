// IndexedDB utility functions
const dbName = "Kirra3D_Database";
const stores = {
	pointCloud: "CSV_PointCloudStore", // For CSV Point Cloud data
	k3dBlast: "K3D_BlastStore", // For K3D Blast data
	csvBlast: "CSV_BlastStore", // For CSV Blast data
	objMesh: "OBJ_MeshStore" // For OBJ Mesh data
};

// Open or create a new database with multiple object stores
export function openDatabase() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, 1); // Version 1 remains unchanged

		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			// Create object store for CSV Point Clouds
			if (!db.objectStoreNames.contains(stores.pointCloud)) {
				db.createObjectStore(stores.pointCloud, { keyPath: "id", autoIncrement: true });
				console.log("CSV_PointCloudStore created");
			}
			// Create object store for K3D Blast data
			if (!db.objectStoreNames.contains(stores.k3dBlast)) {
				db.createObjectStore(stores.k3dBlast, { keyPath: "id", autoIncrement: true });
				console.log("K3D_BlastStore created");
			}
			// Create object store for CSV Blast data
			if (!db.objectStoreNames.contains(stores.csvBlast)) {
				db.createObjectStore(stores.csvBlast, { keyPath: "id", autoIncrement: true });
				console.log("CSV_BlastStore created");
			}
			// Create object store for OBJ Mesh data CAN'T USE UNLESS SERIALIZED
			if (!db.objectStoreNames.contains(stores.objMesh)) {
				db.createObjectStore(stores.objMesh, { keyPath: "id", autoIncrement: true });
				console.log("OBJ_MeshStore created");
			}

			// Add more stores here if needed in the future
		};

		request.onsuccess = (event) => {
			console.log("Database opened successfully");
			resolve(event.target.result);
		};

		request.onerror = (event) => {
			console.error("Database error:", event.target.error);
			reject(event.target.error);
		};
	});
}

// Write data to the specified object store
export function writeData(db, storeName, data) {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([storeName], "readwrite");
		const objectStore = transaction.objectStore(storeName);
		const request = objectStore.add(data);

		request.onsuccess = () => {
			console.log("Data written successfully to", storeName);
			resolve();
		};

		request.onerror = (event) => {
			console.error("Write failed:", event.target.error);
			reject(event.target.error);
		};
	});
}

// Read all data from the specified object store
export function readData(db, storeName) {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([storeName], "readonly");
		const objectStore = transaction.objectStore(storeName);
		const request = objectStore.getAll();

		request.onsuccess = () => {
			console.log("Data read successfully from", storeName, ":", request.result);
			resolve(request.result);
		};

		request.onerror = (event) => {
			console.error("Read failed:", event.target.error);
			reject(event.target.error);
		};
	});
}

/**
 * Deletes data from the specified database using the provided key.
 *
 * @param {IDBDatabase} db - The database to delete data from.
 * @param {any} key - The key of the data to be deleted.
 * @returns {Promise<void>} A promise that resolves when the data is deleted successfully, or rejects with an error if the deletion fails.
 */
export function deleteData(dbName, storeName, key) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName);

		request.onsuccess = (event) => {
			const db = event.target.result;
			const transaction = db.transaction([storeName], "readwrite");
			const objectStore = transaction.objectStore(storeName);
			const deleteRequest = objectStore.delete(key);

			deleteRequest.onsuccess = () => {
				console.log("Data deleted successfully from store: " + storeName);
				resolve();
			};

			deleteRequest.onerror = (event) => {
				console.error("Delete failed from store " + storeName + ": " + event.target.error);
				reject(event.target.error);
			};
		};

		request.onerror = (event) => {
			console.error("Failed to open database:", event.target.error);
			reject(event.target.error);
		};
	});
}

// Function to clear all data from a specific object store
export function clearData(dbName, storeName) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName);

		request.onsuccess = (event) => {
			const db = event.target.result;

			// Check if the object store exists in the database
			if (db.objectStoreNames.contains(storeName)) {
				const transaction = db.transaction([storeName], "readwrite");
				const objectStore = transaction.objectStore(storeName);
				const clearRequest = objectStore.clear();

				clearRequest.onsuccess = () => {
					console.log(`All data cleared from ${storeName}`);
					resolve();
				};

				clearRequest.onerror = (event) => {
					console.error("Failed to clear data from " + storeName + ": " + event.target.error);
					reject(event.target.error);
				};
			} else {
				console.log("Object store " + storeName + " does not exist, skipping.");
				resolve(); // Resolve the promise even if the store doesn't exist
			}
		};

		request.onerror = (event) => {
			console.error("Database open failed:", event.target.error);
			reject(event.target.error);
		};
	});
}

/**
 * Deletes data from the specified object store in the indexedDB based on the given selection.
 *
 * @param {IDBDatabase} db - The indexedDB database.
 * @param {any} selection - The selection used to identify the data to be deleted.
 * @returns {Promise<void>} A promise that resolves when the data is deleted successfully, or rejects with an error if the deletion fails.
 */
export function deleteDataBySelection(db, selection) {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([storeName], "readwrite");
		const objectStore = transaction.objectStore(storeName);
		const request = objectStore.delete(selection);

		request.onsuccess = () => {
			console.log("Data deleted successfully");
			resolve();
		};

		request.onerror = (event) => {
			console.error("Delete failed:", event.target.error);
			reject(event.target.error);
		};
	});
}

// Example usage
// (async () => {
// 	try {
// 		const db = await openDatabase();

// 		// Write example data
// 		await writeData(db, { name: "John Doe", age: 30 });
// 		await writeData(db, { name: "Jane Doe", age: 25 });

// 		// Read all data
// 		const data = await readData(db);
// 		console.log("Data in the database:", data);

// 		// Delete the first item
// 		if (data.length > 0) {
// 			await deleteData(db, data[0].id);
// 			console.log("After deletion, data in the database:", await readData(db));
// 		}
// 	} catch (error) {
// 		console.error("An error occurred:", error);
// 	}
// })();
