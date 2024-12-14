//viewMain.js

// View to display the buttons and menus and panels on top of the Screen.
// This is the main view which is displayed on the screen.

export function createMainView() {
	document.querySelector("#app").innerHTML = /*html*/ `
    <div id="scene-container">
	<!-- Three.js Canvas -->
	<div id="canvas"></div> 

    <!-- Vertical Nav Buttons -->
	<nav id="vertical-nav">
	    <img src="./assets/svg/kirralogo.svg" class="white-svg" alt="Kirra Logo" />
		<button id=open-holes title="File Open">
			<img src="./assets/png/load-holes-k3d.png" alt="File Open Holes" />
		</button>
		<button id=import-holes title="File Import">
			<img src="./assets/png/load-holes-csv.png" alt="File Import Holes" />
		</button>
	  	<button id=import-obj title="File OBJ Loader">
			<img src="./assets/png/load-obj.png" alt="File Import OBJ" />
		</button>
		<button id=import-dxf title="File Import DXF">
			<img src="./assets/png/load-dxf.png" alt="File Import DXF" />
		</button>
		<button id=import-pointcloud title="File Import Point Cloud CSV">
			<img src="./assets/png/load-csv.png" alt="File Import Text Based Point Cloud" />
		</button>
		<button id=translate-object-centre title="Translate Object Centre">
			<img src="./assets/png/north-star.png" alt="Translate Object Centre" />
		</button>
		<button id=rotate-around-obj-center title="Rotate Around Object Centre">
			<img src="./assets/png/rotate-dot.png" alt="Rotate Arround Object Centre" />
		</button>
		<button id=settings-world title="Settings World Origin">
			<img src="./assets/png/world-cog.png" alt="World Origin Point" />
		</button>
		<button id=clear-local-storage title="Clear Local Storage" >
			<img src="./assets/png/browser-x.png" alt="Clear Local Storage" />
		</button>
	</nav>

    <!-- Horizontal Nav Buttons -->    
    <nav id= horizontal-nav>
		<button id="reset" title="Reset" >
			<img src="./assets/png/circle-letter-r.png" alt="Reset" />
		</button>
		<button id=swap-all-hole-visuals title="Swap Hole Visual" >
			<img src="./assets/png/replace.png" alt="Swap Hole Visual" />
		</button>
		<button id=obj-display title="OBJ Display" >
			<img src="./assets/png/hexagon-filled.png" alt="OBJ Display" />
		</button>
		<button id=hole-name-on-off title="Name On Off" >
			<img src="./assets/png/holename.png" alt="Hole Name Display" />
		</button>
		<button id=hole-length-on-off title="Length On Off" >
			<img src="./assets/png/holelength.png" alt="Hole Length Display" />
		</button>
		<button id=hole-diameter-on-off title="Diameter On Off">
			<img src="./assets/png/holediam.png" alt="Hole Diameter Display" />
		</button>
		<button id=camera-mode title="Camera Mode" >
			<img src="./assets/png/cube.png" alt="Perspective Mode" />
		</button>

		<label id="info-label" style="color: red;">Info Label</label>
	  <!-- Add more buttons as needed -->
	</nav>

     <!-- Right Panel (Initially hidden) -->
        <div id="right-panel" class="hidden">
            <button id="close-panel" title="Close Panel">&#x2715;</button>
            <br>
			<div id="objectPanel" class="panel tree-view">
				<!-- Dynamically generated content will go here -->
			</div>
        </div>

        <!-- Toggle Button (Initially visible) -->
        <button id="toggle-panel" class="panel-toggle-btn">
            <img src="./assets/png/chevrons-left.png" alt="Open" />
        </button>
    </div>
    `;

	// Toggle visibility of the right panel
	document.querySelector("#close-panel").addEventListener("click", function () {
		document.querySelector("#right-panel").classList.add("hidden");
		document.querySelector("#toggle-panel").style.display = "block"; // Show the toggle button
	});

	document.querySelector("#toggle-panel").addEventListener("click", function () {
		document.querySelector("#right-panel").classList.remove("hidden");
		document.querySelector("#toggle-panel").style.display = "none"; // Hide the toggle button
	});
}
