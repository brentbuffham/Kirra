import { Vector3, Raycaster, Plane } from "three";

export function initInfoView(renderer, camera, scene, worldOrigin) {
	const infoPanel = document.getElementById("infoPanel");

	// Create the HTML structure for the panel
	infoPanel.innerHTML = `
        <div style="font-size: 0.85em;">
            <strong>Mouse Coordinates (World):</strong><br>
            x: <span id="mouse-world-x">0.00</span> mE<br>
            y: <span id="mouse-world-y">0.00</span> mN<br>
        </div>
        <div style="font-size: 0.85em;">
            <strong>Mouse Coordinates (Scene):</strong><br>
            x: <span id="mouse-scene-x">0.00</span><br>
            y: <span id="mouse-scene-y">0.00</span><br>
        </div>
    `;

	// Cache DOM elements for performance
	const mouseWorldXElem = document.getElementById("mouse-world-x");
	const mouseWorldYElem = document.getElementById("mouse-world-y");
	const mouseSceneXElem = document.getElementById("mouse-scene-x");
	const mouseSceneYElem = document.getElementById("mouse-scene-y");

	const raycaster = new Raycaster();
	const mouse = new Vector3();
	const plane = new Plane(new Vector3(0, 0, 1), 0); // Ground plane on Z = 0
	const tempPoint = new Vector3();

	let lastUpdate = 0;

	// Add a mousemove event listener
	renderer.domElement.addEventListener("mousemove", (event) => {
		const rect = renderer.domElement.getBoundingClientRect();
		const now = performance.now();

		// Normalize mouse coordinates
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		// Update Scene Coordinates
		mouseSceneXElem.textContent = mouse.x.toFixed(2);
		mouseSceneYElem.textContent = mouse.y.toFixed(2);

		// Throttle World Coordinate Updates (every 50ms)
		if (now - lastUpdate > 50) {
			lastUpdate = now;

			// Use Raycaster with Ground Plane
			raycaster.setFromCamera(mouse, camera);
			raycaster.ray.intersectPlane(plane, tempPoint);

			if (tempPoint) {
				// Adjust by worldOrigin settings
				const worldPoint = new Vector3(tempPoint.x + worldOrigin.worldXCenter, tempPoint.y + worldOrigin.worldYCenter, tempPoint.z + worldOrigin.worldZCenter);

				// Update World Coordinates
				mouseWorldXElem.textContent = worldPoint.x.toFixed(2);
				mouseWorldYElem.textContent = worldPoint.y.toFixed(2);
			}
		}
	});
}
