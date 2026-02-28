/* prettier-ignore-file */
//=================================================
// PolygonSelection3D.js - 3D Polygon Selection Tool
//=================================================
// Handles polygon selection in 3D mode using screen-space overlay

import * as THREE from "three";

export class PolygonSelection3D {
    constructor(threeRenderer) {
        // Step 1) Store reference to Three.js renderer
        this.threeRenderer = threeRenderer;
        this.camera = threeRenderer.camera;

        // Step 2) Polygon points storage (screen coordinates)
        this.polyPointsX = [];
        this.polyPointsY = [];

        // Step 3) State tracking
        this.isActive = false;
        this.overlayCanvas = null;
        this.overlayContext = null;

        // Step 4) Bind event handlers
        this.handleClick = this.handleClick.bind(this);
        this.handleDoubleClick = this.handleDoubleClick.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);

        console.log("✨ PolygonSelection3D initialized");
    }

    //=================================================
    // Overlay Canvas Management
    //=================================================

    // Step 5) Create overlay canvas element
    createOverlayCanvas() {
        if (this.overlayCanvas) return; // Already created

        // Step 5a) Get Three.js canvas for positioning and dimensions
        const threeCanvas = this.threeRenderer.getCanvas();
        const canvasRect = threeCanvas.getBoundingClientRect();
        const parentRect = threeCanvas.parentElement.getBoundingClientRect();

        // Step 5b) Create new canvas element
        this.overlayCanvas = document.createElement("canvas");
        this.overlayCanvas.id = "polygon-overlay-3d";
        // Use Three.js canvas internal dimensions for pixel-perfect drawing
        this.overlayCanvas.width = threeCanvas.width;
        this.overlayCanvas.height = threeCanvas.height;

        // Step 5c) Style the canvas - position to match Three.js canvas visually
        this.overlayCanvas.style.position = "absolute";
        this.overlayCanvas.style.left = (canvasRect.left - parentRect.left) + "px";
        this.overlayCanvas.style.top = (canvasRect.top - parentRect.top) + "px";
        // CSS size matches Three.js canvas CSS size (may differ from internal pixel size)
        this.overlayCanvas.style.width = canvasRect.width + "px";
        this.overlayCanvas.style.height = canvasRect.height + "px";
        this.overlayCanvas.style.pointerEvents = "none"; // Allow clicks through to Three.js canvas
        this.overlayCanvas.style.zIndex = "3"; // Above Three.js canvas (z-index 1) and 2D canvas (z-index 2)
        this.overlayCanvas.style.display = "none"; // Hidden by default

        // Step 5d) Get 2D context
        this.overlayContext = this.overlayCanvas.getContext("2d");

        // Step 5e) Insert into DOM (after Three.js canvas)
        threeCanvas.parentElement.appendChild(this.overlayCanvas);

        console.log("📐 3D Polygon overlay canvas created - Internal:", this.overlayCanvas.width, "x", this.overlayCanvas.height, "CSS:", canvasRect.width, "x", canvasRect.height);
    }

    // Step 6) Show overlay canvas
    showOverlayCanvas() {
        if (!this.overlayCanvas) {
            this.createOverlayCanvas();
        }
        this.overlayCanvas.style.display = "block";
    }

    // Step 7) Hide overlay canvas
    hideOverlayCanvas() {
        if (this.overlayCanvas) {
            this.overlayCanvas.style.display = "none";
            this.clearOverlay();
        }
    }

    // Step 8) Clear overlay canvas
    clearOverlay() {
        if (this.overlayContext) {
            this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }
    }

    // Step 9) Update canvas size (for window resize)
    updateCanvasSize() {
        if (!this.overlayCanvas) return;

        const threeCanvas = this.threeRenderer.getCanvas();
        const canvasRect = threeCanvas.getBoundingClientRect();
        const parentRect = threeCanvas.parentElement.getBoundingClientRect();

        // Use Three.js canvas internal dimensions for pixel-perfect drawing
        this.overlayCanvas.width = threeCanvas.width;
        this.overlayCanvas.height = threeCanvas.height;
        // Position and CSS size to match Three.js canvas visually
        this.overlayCanvas.style.left = (canvasRect.left - parentRect.left) + "px";
        this.overlayCanvas.style.top = (canvasRect.top - parentRect.top) + "px";
        this.overlayCanvas.style.width = canvasRect.width + "px";
        this.overlayCanvas.style.height = canvasRect.height + "px";

        // Redraw after resize
        if (this.isActive && this.polyPointsX.length > 0) {
            this.drawPolygon();
        }
    }

    //=================================================
    // Enable/Disable Polygon Selection
    //=================================================

    // Step 10) Enable 3D polygon selection mode
    enable() {
        this.isActive = true;

        // Step 10a) Create overlay canvas if needed
        this.createOverlayCanvas();

        // Step 10b) Attach event listeners to Three.js canvas
        const threeCanvas = this.threeRenderer.getCanvas();
        threeCanvas.addEventListener("click", this.handleClick);
        threeCanvas.addEventListener("dblclick", this.handleDoubleClick);
        threeCanvas.addEventListener("mousemove", this.handleMouseMove);
        threeCanvas.addEventListener("touchstart", this.handleTouchStart);
        threeCanvas.addEventListener("touchmove", this.handleTouchMove);

        // Step 10c) Clear any existing polygon
        this.polyPointsX = [];
        this.polyPointsY = [];

        console.log("✅ 3D Polygon selection enabled");
    }

    // Step 11) Disable 3D polygon selection mode
    disable() {
        this.isActive = false;

        // Step 11a) Remove event listeners
        const threeCanvas = this.threeRenderer.getCanvas();
        threeCanvas.removeEventListener("click", this.handleClick);
        threeCanvas.removeEventListener("dblclick", this.handleDoubleClick);
        threeCanvas.removeEventListener("mousemove", this.handleMouseMove);
        threeCanvas.removeEventListener("touchstart", this.handleTouchStart);
        threeCanvas.removeEventListener("touchmove", this.handleTouchMove);

        // Step 11b) Hide and clear overlay
        this.hideOverlayCanvas();

        // Step 11c) Clear polygon points
        this.polyPointsX = [];
        this.polyPointsY = [];

        console.log("❌ 3D Polygon selection disabled");
    }

    //=================================================
    // Mouse Event Handlers
    //=================================================

    // Step 12) Handle mouse click - add polygon vertex
    handleClick(event) {
        // Step 12a) Only handle if active AND checkbox is checked
        if (!this.isActive) return;

        // Step 12a.1) Double-check the tool is actually enabled via checkbox
        const checkbox = document.getElementById("selectByPolygon");
        if (!checkbox || !checkbox.checked) {
            console.log("⚠️ Polygon tool event fired but checkbox not checked - ignoring");
            return;
        }

        // Step 12b) Prevent double-click from triggering two clicks
        if (event.detail === 2) return;

        // Step 12c) Prevent this click from propagating to other tools (raycast selection, etc)
        event.preventDefault();
        event.stopPropagation();

        // Step 12b) Get coordinates from Three.js canvas (the actual click target)
        // Use Three.js canvas rect - this is what we're actually clicking on
        const threeCanvas = this.threeRenderer.getCanvas();
        const rect = threeCanvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        // Step 12c) Convert to canvas pixel coordinates (accounting for any CSS scaling)
        const scaleX = threeCanvas.width / rect.width;
        const scaleY = threeCanvas.height / rect.height;
        const canvasX = clickX * scaleX;
        const canvasY = clickY * scaleY;

        // Step 12d) Add point to polygon
        this.polyPointsX.push(canvasX);
        this.polyPointsY.push(canvasY);

        // Step 12e) Show overlay on first click
        if (this.polyPointsX.length === 1) {
            this.showOverlayCanvas();
        }

        // Step 12f) Add preview point (will be updated on mouse move)
        if (this.polyPointsX.length === 1) {
            this.polyPointsX.push(canvasX);
            this.polyPointsY.push(canvasY);
        } else {
            // Update last point (preview point)
            this.polyPointsX[this.polyPointsX.length - 1] = canvasX;
            this.polyPointsY[this.polyPointsY.length - 1] = canvasY;
        }

        // Step 12g) Redraw polygon
        this.drawPolygon();

        console.log("📍 Added polygon vertex at:", canvasX.toFixed(1), canvasY.toFixed(1));
    }

    // Step 13) Handle double-click - complete polygon and select objects
    handleDoubleClick(event) {
        if (!this.isActive) return;

        // Check checkbox state
        const checkbox = document.getElementById("selectByPolygon");
        if (!checkbox || !checkbox.checked) {
            console.log("⚠️ Polygon tool double-click but checkbox not checked - ignoring");
            return;
        }

        if (this.polyPointsX.length < 3) {
            console.log("⚠️ Need at least 3 points to complete polygon - currently have: " + this.polyPointsX.length);
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        console.log("✅ Completing polygon selection with " + this.polyPointsX.length + " points");
        console.log("Polygon points:", this.polyPointsX, this.polyPointsY);

        // Step 13a) Remove the preview point (last point)
        this.polyPointsX.pop();
        this.polyPointsY.pop();

        console.log("After removing preview, polygon has " + this.polyPointsX.length + " vertices");

        // Step 13b) Check if vertex selection mode is enabled
        // Check if "V" (Vertices) radio is selected
        const selectVerticesRadio = document.getElementById("selectVertices");
        const vertexSelectionMode = selectVerticesRadio && selectVerticesRadio.checked;

        // Step 13c) Perform selection based on mode
        if (vertexSelectionMode) {
            console.log("🔷 Using VERTEX selection mode");
            this.projectAndSelectVertices();
        } else {
            console.log("🔶 Using ENTITY selection mode");
            this.projectAndSelectObjects();
        }

        // Step 13d) Clear polygon and hide overlay
        this.polyPointsX = [];
        this.polyPointsY = [];
        this.hideOverlayCanvas();

        console.log("✅ Polygon selection completed");
    }

    // Step 14) Handle mouse move - update preview line
    handleMouseMove(event) {
        if (!this.isActive || this.polyPointsX.length === 0) return;

        // Only prevent default if we're actually drawing (have points)
        if (this.polyPointsX.length > 0) {
            event.stopPropagation();
        }

        // Step 14a) Get coordinates from Three.js canvas
        const threeCanvas = this.threeRenderer.getCanvas();
        const rect = threeCanvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Step 14b) Convert to canvas pixel coordinates (accounting for CSS scaling)
        const scaleX = threeCanvas.width / rect.width;
        const scaleY = threeCanvas.height / rect.height;
        const canvasX = mouseX * scaleX;
        const canvasY = mouseY * scaleY;

        // Step 14c) Update preview point (last point in array)
        if (this.polyPointsX.length > 0) {
            this.polyPointsX[this.polyPointsX.length - 1] = canvasX;
            this.polyPointsY[this.polyPointsY.length - 1] = canvasY;
        }

        // Step 14d) Redraw polygon with updated preview
        this.drawPolygon();
    }

    //=================================================
    // Touch Event Handlers
    //=================================================

    // Step 15) Handle touch start
    handleTouchStart(event) {
        if (!this.isActive) return;

        // Step 15a) Check for two-finger touch (complete polygon)
        if (event.touches.length >= 2) {
            event.preventDefault();
            if (this.polyPointsX.length >= 3) {
                // Remove preview point
                this.polyPointsX.pop();
                this.polyPointsY.pop();

                // Complete selection
                this.projectAndSelectObjects();

                // Clear and hide
                this.polyPointsX = [];
                this.polyPointsY = [];
                this.hideOverlayCanvas();

                console.log("✅ Polygon completed via two-finger touch");
            }
            return;
        }

        // Step 15b) Single touch - add vertex
        event.preventDefault();
        const touch = event.touches[0];
        const threeCanvas = this.threeRenderer.getCanvas();
        const rect = threeCanvas.getBoundingClientRect();
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;

        // Convert to canvas pixel coordinates (accounting for CSS scaling)
        const scaleX = threeCanvas.width / rect.width;
        const scaleY = threeCanvas.height / rect.height;
        const canvasX = touchX * scaleX;
        const canvasY = touchY * scaleY;

        // Add point
        this.polyPointsX.push(canvasX);
        this.polyPointsY.push(canvasY);

        // Show overlay on first touch
        if (this.polyPointsX.length === 1) {
            this.showOverlayCanvas();
            // Add preview point
            this.polyPointsX.push(canvasX);
            this.polyPointsY.push(canvasY);
        } else {
            // Update preview point
            this.polyPointsX[this.polyPointsX.length - 1] = canvasX;
            this.polyPointsY[this.polyPointsY.length - 1] = canvasY;
        }

        this.drawPolygon();
    }

    // Step 16) Handle touch move - update preview
    handleTouchMove(event) {
        if (!this.isActive || this.polyPointsX.length === 0) return;

        event.preventDefault();
        const touch = event.touches[0];
        const threeCanvas = this.threeRenderer.getCanvas();
        const rect = threeCanvas.getBoundingClientRect();
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;

        // Convert to canvas pixel coordinates (accounting for CSS scaling)
        const scaleX = threeCanvas.width / rect.width;
        const scaleY = threeCanvas.height / rect.height;
        const canvasX = touchX * scaleX;
        const canvasY = touchY * scaleY;

        // Update preview point
        if (this.polyPointsX.length > 0) {
            this.polyPointsX[this.polyPointsX.length - 1] = canvasX;
            this.polyPointsY[this.polyPointsY.length - 1] = canvasY;
        }

        this.drawPolygon();
    }

    //=================================================
    // Polygon Drawing (Match 2D Visual Style)
    //=================================================

    // Step 17) Draw polygon on overlay canvas
    drawPolygon() {
        if (!this.overlayContext || this.polyPointsX.length < 2) return;

        // Step 17a) Clear canvas
        this.clearOverlay();

        const ctx = this.overlayContext;

        // Step 17b) Draw polygon lines (match 2D style)
        ctx.beginPath();
        for (let i = 0; i < this.polyPointsX.length; i++) {
            const x = this.polyPointsX[i];
            const y = this.polyPointsY[i];

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        // Step 17c) Close polygon by connecting to first point (match 2D behavior)
        if (this.polyPointsX.length >= 2) {
            ctx.lineTo(this.polyPointsX[0], this.polyPointsY[0]);
        }

        // Step 17d) Apply 2D style (rgba(200, 0, 200, 0.5) magenta with line width 1)
        ctx.strokeStyle = "rgba(200, 0, 200, 0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Step 17e) Draw vertices as circles (match 2D style)
        for (let i = 0; i < this.polyPointsX.length; i++) {
            const x = this.polyPointsX[i];
            const y = this.polyPointsY[i];

            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 0, 255, 0.6)"; // Magenta fill
            ctx.fill();
        }
    }

    //=================================================
    // 3D-to-Screen Projection and Selection
    //=================================================

    // Step 17.5) Check if a point in Three.js local space is clipped by active clipping planes
    isPointClipped(localX, localY, worldZ) {
        var clippingPlanes = this.threeRenderer.renderer
            ? this.threeRenderer.renderer.clippingPlanes
            : null;
        if (!clippingPlanes || clippingPlanes.length === 0) return false;
        for (var i = 0; i < clippingPlanes.length; i++) {
            if (clippingPlanes[i].distanceToPoint(new THREE.Vector3(localX, localY, worldZ)) < 0) {
                return true;
            }
        }
        return false;
    }

    // Step 18) Project 3D world position to screen coordinates
    projectToScreen(worldX, worldY, worldZ) {
        // Step 18a) Convert world coordinates to Three.js local coordinates
        // Three.js uses a local coordinate system (offset from origin) to avoid floating-point errors with large UTM coordinates
        const worldToThreeLocal = window.worldToThreeLocal;
        if (!worldToThreeLocal) {
            console.error("worldToThreeLocal function not found!");
            return { screenX: 0, screenY: 0 };
        }

        const localCoords = worldToThreeLocal(worldX, worldY);

        // Step 18b) Create Three.js vector in LOCAL space (not world space)
        const vector = new THREE.Vector3(localCoords.x, localCoords.y, worldZ);

        // Step 18c) Project to normalized device coordinates (-1 to +1)
        vector.project(this.camera);

        // Step 18d) Convert NDC to screen pixel coordinates
        const screenX = (vector.x * 0.5 + 0.5) * this.overlayCanvas.width;
        const screenY = (vector.y * -0.5 + 0.5) * this.overlayCanvas.height;

        return { screenX, screenY };
    }

    // Step 19) Project all objects and select those inside polygon
    projectAndSelectObjects() {
        console.log("=== 3D POLYGON SELECTION DEBUG ===");
        console.log("Polygon vertices count:", this.polyPointsX.length);
        console.log("Polygon X:", this.polyPointsX);
        console.log("Polygon Y:", this.polyPointsY);

        // Show polygon bounds for debugging
        const minX = Math.min(...this.polyPointsX);
        const maxX = Math.max(...this.polyPointsX);
        const minY = Math.min(...this.polyPointsY);
        const maxY = Math.max(...this.polyPointsY);
        console.log("Polygon bounds - X:", minX.toFixed(1), "to", maxX.toFixed(1), "Y:", minY.toFixed(1), "to", maxY.toFixed(1));
        console.log("Canvas size:", this.overlayCanvas.width, "x", this.overlayCanvas.height);

        // Step 19a) Determine what to select (holes or KAD) - use correct radio button variables
        const selectHolesRadio = window.selectHolesRadio;
        const selectKADRadio = window.selectKADRadio;

        console.log("Radio elements - Holes:", selectHolesRadio, "KAD:", selectKADRadio);

        const selectingHoles = selectHolesRadio && selectHolesRadio.checked;
        const selectingKAD = selectKADRadio && selectKADRadio.checked;

        console.log("🔍 Selection mode - Holes:", selectingHoles, "KAD:", selectingKAD);

        // Step 19b) Initialize selection arrays
        let selectedHoles = [];
        let selectedKAD = [];

        // Step 19c) Select holes if in hole selection mode
        if (selectingHoles) {
            const allBlastHoles = window.allBlastHoles || [];
            const isHoleVisible = window.isHoleVisible;

            console.log("Testing " + allBlastHoles.length + " holes for selection");
            console.log("isHoleVisible function:", isHoleVisible);

            let testedCount = 0;
            let visibleCount = 0;
            let insideCount = 0;

            allBlastHoles.forEach((hole, index) => {
                if (!hole) {
                    console.log("Hole " + index + " is null/undefined");
                    return;
                }

                testedCount++;

                // Check visibility
                const visible = !isHoleVisible || isHoleVisible(hole);
                if (!visible) {
                    if (index < 3) console.log("Hole " + index + " (" + hole.holeID + ") is not visible");
                    return;
                }
                visibleCount++;

                // Get hole 3D position
                const worldX = hole.startXLocation;
                const worldY = hole.startYLocation;
                const worldZ = hole.startZLocation || 0;

                // Skip if clipped by active clipping planes
                const localCoords0 = window.worldToThreeLocal ? window.worldToThreeLocal(worldX, worldY) : { x: worldX, y: worldY };
                if (this.isPointClipped(localCoords0.x, localCoords0.y, worldZ)) return;

                // Project to screen
                const { screenX, screenY } = this.projectToScreen(worldX, worldY, worldZ);

                if (index < 5) {
                    const localCoords = window.worldToThreeLocal ? window.worldToThreeLocal(worldX, worldY) : { x: worldX, y: worldY };
                    console.log("Hole " + index + " (" + hole.holeID + "):");
                    console.log("  World:", worldX.toFixed(2), worldY.toFixed(2), worldZ.toFixed(2));
                    console.log("  Local:", localCoords.x.toFixed(2), localCoords.y.toFixed(2));
                    console.log("  Screen:", screenX.toFixed(2), screenY.toFixed(2));
                }

                // Test against polygon (reuse existing function)
                const isInside = this.isPointInPolygon(screenX, screenY);
                if (index < 3) {
                    console.log("  Inside polygon:", isInside);
                }

                if (isInside) {
                    selectedHoles.push(hole);
                    insideCount++;
                    if (insideCount <= 5) {
                        console.log("✓ Hole " + hole.holeID + " is INSIDE polygon");
                    }
                }
            });

            console.log("Summary - Tested:", testedCount, "Visible:", visibleCount, "Inside:", insideCount);
            console.log("✅ Selected " + selectedHoles.length + " holes");

            // Show sample of selected holes for verification
            if (selectedHoles.length > 0 && selectedHoles.length <= 10) {
                console.log("Selected hole IDs:", selectedHoles.map((h) => h.holeID).join(", "));
            } else if (selectedHoles.length > 10) {
                console.log(
                    "Selected hole IDs (first 10):",
                    selectedHoles
                        .slice(0, 10)
                        .map((h) => h.holeID)
                        .join(", ")
                );
            }
        }

        // Step 19d) Select KAD objects if in KAD selection mode
        if (selectingKAD) {
            const allKADDrawingsMap = window.allKADDrawingsMap;
            const isEntityVisible = window.isEntityVisible;

            console.log("allKADDrawingsMap:", allKADDrawingsMap);
            console.log("isEntityVisible function:", isEntityVisible);

            if (!allKADDrawingsMap) {
                console.log("⚠️ allKADDrawingsMap not found");
                return;
            }

            console.log("Testing " + allKADDrawingsMap.size + " KAD entities for selection");

            let entityCount = 0;
            let visibleEntityCount = 0;
            let selectedEntityCount = 0;

            for (const [entityName, entity] of allKADDrawingsMap.entries()) {
                entityCount++;

                // Check visibility
                const visible = !isEntityVisible || isEntityVisible(entityName);
                if (!visible) {
                    if (entityCount <= 3) console.log("Entity " + entityName + " is not visible");
                    continue;
                }
                visibleEntityCount++;

                if (!entity || !entity.data) {
                    console.log("Entity " + entityName + " has no data");
                    continue;
                }

                if (entityCount <= 3) {
                    console.log("Testing entity " + entityName + " with " + entity.data.length + " points");
                }

                // Check if any point of the KAD entity is inside polygon
                let isInside = false;

                for (const point of entity.data) {
                    const worldX = point.pointXLocation;
                    const worldY = point.pointYLocation;
                    const worldZ = point.pointZLocation || 0;

                    // Skip if clipped by active clipping planes
                    const lc = window.worldToThreeLocal ? window.worldToThreeLocal(worldX, worldY) : { x: worldX, y: worldY };
                    if (this.isPointClipped(lc.x, lc.y, worldZ)) continue;

                    // Project to screen
                    const { screenX, screenY } = this.projectToScreen(worldX, worldY, worldZ);

                    if (entityCount <= 2) {
                        console.log("  Point - World:", worldX.toFixed(2), worldY.toFixed(2), "Screen:", screenX.toFixed(2), screenY.toFixed(2));
                    }

                    // Test against polygon
                    if (this.isPointInPolygon(screenX, screenY)) {
                        isInside = true;
                        if (entityCount <= 3) {
                            console.log("  ✓ Point is inside polygon");
                        }
                        break;
                    }
                }

                if (isInside) {
                    // Create KAD object in the format expected by the selection system
                    // CRITICAL: Must include entityType for highlight switch statement
                    const kadObj = {
                        entityName: entityName,
                        entity: entity,
                        entityType: entity.entityType // Required for drawKADEntityHighlight switch
                    };
                    selectedKAD.push(kadObj);
                    selectedEntityCount++;
                    if (selectedEntityCount <= 5) {
                        console.log("✓ Entity " + entityName + " (" + entity.entityType + ") is INSIDE polygon");
                    }
                }
            }

            console.log("Summary - Total:", entityCount, "Visible:", visibleEntityCount, "Selected:", selectedEntityCount);
            console.log("✅ Selected " + selectedKAD.length + " KAD objects");
        }

        // Step 19e) Update global selection state
        if (selectingHoles) {
            console.log("📝 Updating global state - selectedHoles.length:", selectedHoles.length);

            // CRITICAL: Modify the existing array, don't replace the reference
            // drawData() uses the local variable in kirra.js, not window property
            if (!window.selectedMultipleHoles) {
                window.selectedMultipleHoles = [];
            }
            window.selectedMultipleHoles.length = 0; // Clear existing array
            selectedHoles.forEach((h) => window.selectedMultipleHoles.push(h)); // Refill with new selection

            window.selectedHole = null; // Clear single selection

            // Verify the update worked
            console.log("✓ window.selectedMultipleHoles.length:", window.selectedMultipleHoles ? window.selectedMultipleHoles.length : "undefined");
            console.log("✓ window.selectedHole:", window.selectedHole);

            if (selectedHoles.length > 0) {
                // Update averages and sliders
                if (window.updateSelectionAveragesAndSliders) {
                    console.log("📊 Calling updateSelectionAveragesAndSliders...");
                    window.updateSelectionAveragesAndSliders(selectedHoles);
                } else {
                    console.log("⚠️ updateSelectionAveragesAndSliders function not found");
                }

                // Update status message
                if (window.updateStatusMessage) {
                    window.updateStatusMessage("Selected " + selectedHoles.length + " holes");
                }
            } else {
                if (window.updateStatusMessage) {
                    window.updateStatusMessage("No holes found in polygon");
                }
            }
        }

        if (selectingKAD) {
            console.log("📝 Updating KAD global state - selectedKAD.length:", selectedKAD.length);

            // PERFORMANCE FIX 2025-12-28: Warn user about large selections
            var LARGE_SELECTION_WARNING_THRESHOLD = 500;
            if (selectedKAD.length > LARGE_SELECTION_WARNING_THRESHOLD) {
                // Show warning but still proceed (selection limits are handled in draw code)
                console.log("⚠️ Large KAD selection: " + selectedKAD.length + " entities");
                if (window.updateStatusMessage) {
                    window.updateStatusMessage("Large selection: " + selectedKAD.length + " KAD entities (rendering may be limited)");
                    setTimeout(function() { window.updateStatusMessage(""); }, 3000);
                }
            }

            // CRITICAL: Modify the existing array, don't replace the reference
            if (!window.selectedMultipleKADObjects) {
                window.selectedMultipleKADObjects = [];
            }

            const beforeLength = window.selectedMultipleKADObjects.length;
            window.selectedMultipleKADObjects.length = 0; // Clear existing array
            selectedKAD.forEach((obj) => window.selectedMultipleKADObjects.push(obj)); // Refill with new selection

            console.log("✓ KAD array updated - Before:", beforeLength, "After:", window.selectedMultipleKADObjects.length);
            console.log("✓ First KAD object:", window.selectedMultipleKADObjects[0]);

            window.selectedKADObject = null; // Clear single selection

            if (selectedKAD.length > 0 && selectedKAD.length <= LARGE_SELECTION_WARNING_THRESHOLD) {
                // Update status message only if not already showing large selection warning
                if (window.updateStatusMessage) {
                    window.updateStatusMessage("Selected " + selectedKAD.length + " KAD objects");
                }
            } else if (selectedKAD.length === 0) {
                if (window.updateStatusMessage) {
                    window.updateStatusMessage("No KAD objects found in polygon");
                }
            }
        }

        // Step 19f) Trigger redraw to show selection highlights
        console.log("🎨 Triggering redraw...");
        console.log("  drawData function:", window.drawData ? "exists" : "missing");
        console.log("  renderThreeJS function:", window.renderThreeJS ? "exists" : "missing");
        console.log("  allBlastHoles:", window.allBlastHoles ? window.allBlastHoles.length + " holes" : "missing");
        console.log("  selectedHole:", window.selectedHole);
        console.log("  selectedMultipleHoles:", window.selectedMultipleHoles ? window.selectedMultipleHoles.length : "undefined");
        console.log("  selectedMultipleKADObjects:", window.selectedMultipleKADObjects ? window.selectedMultipleKADObjects.length : "undefined");

        if (window.drawData) {
            if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
            console.log("✓ drawData() called");
        } else {
            console.log("❌ drawData() function not found!");
        }

        // Also trigger 3D render
        if (window.renderThreeJS) {
            window.renderThreeJS();
            console.log("✓ renderThreeJS() called");
        } else {
            console.log("❌ renderThreeJS() function not found!");
        }

        console.log("🏁 Selection process complete - checking final state:");
        console.log("  Final selectedMultipleHoles:", window.selectedMultipleHoles ? window.selectedMultipleHoles.length : 0);
        console.log("  First 3 holes:", window.selectedMultipleHoles ? window.selectedMultipleHoles.slice(0, 3).map((h) => h.holeID) : "none");
    }

    // Step 20) Point-in-polygon test (reuse algorithm from 2D version)
    isPointInPolygon(x, y) {
        // Use ray casting algorithm
        let inside = false;
        const nvert = this.polyPointsX.length;

        for (let i = 0, j = nvert - 1; i < nvert; j = i++) {
            const xi = this.polyPointsX[i];
            const yi = this.polyPointsY[i];
            const xj = this.polyPointsX[j];
            const yj = this.polyPointsY[j];

            const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

            if (intersect) {
                inside = !inside;
            }
        }

        return inside;
    }

    //=================================================
    // Individual Vertex Selection (for point cloud cleaning)
    //=================================================

    // Step 20b) Select individual VERTICES instead of whole entities
    projectAndSelectVertices() {
        console.log("=== 3D VERTEX SELECTION MODE ===");

        // Vertices mode is valid when "V" radio is selected
        const selectVerticesRadio = window.selectVerticesRadio || document.getElementById("selectVertices");
        const selectingVertices = selectVerticesRadio && selectVerticesRadio.checked;
        if (!selectingVertices) {
            console.log("Not in Vertices selection mode");
            return;
        }

        const allKADDrawingsMap = window.allKADDrawingsMap;
        if (!allKADDrawingsMap) {
            console.log("allKADDrawingsMap not found");
            return;
        }

        // Initialize or clear vertex selection array
        if (!window.selectedMultiplePoints) {
            window.selectedMultiplePoints = [];
        }
        window.selectedMultiplePoints.length = 0;

        let totalTested = 0;
        let totalSelected = 0;

        for (const [entityName, entity] of allKADDrawingsMap.entries()) {
            // Check entity visibility
            if (window.isEntityVisible && !window.isEntityVisible(entityName)) continue;
            if (!entity || !entity.data) continue;

            // Check EACH point individually
            for (let i = 0; i < entity.data.length; i++) {
                const point = entity.data[i];
                if (point.visible === false) continue;

                totalTested++;

                const worldX = point.pointXLocation;
                const worldY = point.pointYLocation;
                const worldZ = point.pointZLocation || 0;

                // Skip if clipped by active clipping planes
                const lc = window.worldToThreeLocal ? window.worldToThreeLocal(worldX, worldY) : { x: worldX, y: worldY };
                if (this.isPointClipped(lc.x, lc.y, worldZ)) continue;

                const { screenX, screenY } = this.projectToScreen(worldX, worldY, worldZ);

                if (this.isPointInPolygon(screenX, screenY)) {
                    // Add individual vertex reference
                    window.selectedMultiplePoints.push({
                        entityName: entityName,
                        entityType: entity.entityType,
                        pointIndex: i,
                        point: point,
                        pointID: point.pointID,
                        pointXLocation: point.pointXLocation,
                        pointYLocation: point.pointYLocation,
                        pointZLocation: point.pointZLocation
                    });
                    totalSelected++;
                }
            }
        }

        console.log("Vertex selection: tested " + totalTested + ", selected " + totalSelected);

        // Update status message
        if (window.updateStatusMessage) {
            if (totalSelected > 0) {
                window.updateStatusMessage("Selected " + totalSelected + " vertices (Delete to remove)");
            } else {
                window.updateStatusMessage("No vertices found in polygon");
            }
        }

        // Trigger redraw to show vertex highlights
        if (window.drawData) {
            window.drawData(window.allBlastHoles, window.selectedHole);
        }
        if (window.renderThreeJS) {
            window.renderThreeJS();
        }
    }

    //=================================================
    // Cleanup
    //=================================================

    // Step 21) Destroy and cleanup
    destroy() {
        this.disable();

        // Remove overlay canvas from DOM
        if (this.overlayCanvas && this.overlayCanvas.parentElement) {
            this.overlayCanvas.parentElement.removeChild(this.overlayCanvas);
        }

        this.overlayCanvas = null;
        this.overlayContext = null;

        console.log("🗑️ PolygonSelection3D destroyed");
    }
}
