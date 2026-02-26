/**
 * ContourDialog.js
 *
 * Dialog for configuring surface contour line generation.
 * Single surface pick + contour interval settings.
 * Follows the SurfaceIntersectionDialog pattern.
 */

import * as THREE from "three";
import { FloatingDialog, createEnhancedFormContent, getFormData } from "../../FloatingDialog.js";
import { flashHighlight, clearHighlight, clearAllHighlights } from "../../../helpers/SurfaceHighlightHelper.js";
import { extractTriangles, computeBBox } from "../../../helpers/SurfaceIntersectionHelper.js";

var SETTINGS_KEY = "kirra_contour_settings";

// ────────────────────────────────────────────────────────
// Module-level state
// ────────────────────────────────────────────────────────
var pickCallback = null;
var highlightedSurfaceId = null;

function getThreeCanvas() {
    return window.threeRenderer ? window.threeRenderer.getCanvas() : null;
}

function loadSavedSettings() {
    try {
        var json = localStorage.getItem(SETTINGS_KEY);
        return json ? JSON.parse(json) : null;
    } catch (e) {
        return null;
    }
}

function saveSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn("Failed to save contour settings:", e);
    }
}

function isDarkMode() {
    return typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : true;
}

// ────────────────────────────────────────────────────────
// Screen pick mode
// ────────────────────────────────────────────────────────

function enterPickMode(pickRow, onPicked) {
    exitPickMode();

    pickRow.pickBtn.style.background = "rgba(255,60,60,0.4)";
    pickRow.pickBtn.style.borderColor = "#FF4444";

    var canvas = getThreeCanvas();
    if (!canvas) {
        console.warn("Contour Pick: No 3D canvas found");
        return;
    }

    canvas.style.cursor = "crosshair";

    pickCallback = function (e) {
        e.stopPropagation();

        var surfaceId = raycastSurface(e, canvas);
        if (surfaceId) {
            onPicked(surfaceId);
            showPickHighlight(surfaceId);
        }

        exitPickMode();
        var dk = isDarkMode();
        pickRow.pickBtn.style.background = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
        pickRow.pickBtn.style.borderColor = dk ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
    };

    canvas.addEventListener("pointerup", pickCallback, { once: true, capture: true });
}

function exitPickMode() {
    var canvas = getThreeCanvas();
    if (canvas) {
        canvas.style.cursor = "";
        if (pickCallback) {
            canvas.removeEventListener("pointerup", pickCallback, { capture: true });
        }
    }
    pickCallback = null;
    clearPickHighlight();
}

function raycastSurface(event, canvas) {
    var tr = window.threeRenderer;
    if (!tr || !tr.scene || !tr.camera || !tr.surfaceMeshMap) return null;

    var rect = canvas.getBoundingClientRect();
    var mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    var mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    var raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), tr.camera);

    var meshes = [];
    tr.surfaceMeshMap.forEach(function (mesh, surfaceId) {
        if (mesh && mesh.visible) {
            mesh.traverse(function (child) {
                if (child.isMesh) {
                    child.userData._pickSurfaceId = surfaceId;
                    meshes.push(child);
                }
            });
        }
    });

    var hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
        return hits[0].object.userData._pickSurfaceId || null;
    }
    return null;
}

function showPickHighlight(surfaceId) {
    clearPickHighlight();
    flashHighlight(surfaceId, { color: 0x00FF88, opacity: 0.25 });
    highlightedSurfaceId = surfaceId;
}

function clearPickHighlight() {
    if (highlightedSurfaceId) {
        clearHighlight(highlightedSurfaceId);
        highlightedSurfaceId = null;
    }
}

// ────────────────────────────────────────────────────────
// Pick row builder
// ────────────────────────────────────────────────────────

function createPickRow(label, options, defaultValue, onPick) {
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
    pickBtn.title = "Pick a surface from 3D view";
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

    pickBtn.addEventListener("click", onPick);

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
// Get surface Z bounds for auto-populating min/max
// ────────────────────────────────────────────────────────

function getSurfaceZBounds(surfaceId) {
    var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceId) : null;
    if (!surface) return null;

    // Try meshBounds first (cheaper)
    if (surface.meshBounds) {
        return { minZ: surface.meshBounds.minZ, maxZ: surface.meshBounds.maxZ };
    }

    // Fall back to extracting triangles
    var tris = extractTriangles(surface);
    if (tris.length === 0) return null;
    var bbox = computeBBox(tris);
    return { minZ: bbox.minZ, maxZ: bbox.maxZ };
}

// ────────────────────────────────────────────────────────
// Public: Show the Contour dialog
// ────────────────────────────────────────────────────────

/**
 * Show the Surface Contour configuration dialog.
 *
 * @param {Function} callback - Called with config object on Generate
 */
export function showContourDialog(callback) {
    // Step 1) Build surface list
    var surfaceEntries = [];
    if (window.loadedSurfaces && window.loadedSurfaces.size > 0) {
        for (var [surfId, surf] of window.loadedSurfaces) {
            var triCount = 0;
            if (surf.triangles && Array.isArray(surf.triangles)) {
                triCount = surf.triangles.length;
            }
            surfaceEntries.push({
                id: surfId,
                name: surf.name || surfId,
                triCount: triCount
            });
        }
    }

    if (surfaceEntries.length < 1) {
        var warnContent = document.createElement("div");
        warnContent.style.padding = "15px";
        warnContent.textContent = "No surfaces loaded. Import a surface (DTM, STR, OBJ) first.";
        var warnDialog = new FloatingDialog({
            title: "Surface Contours",
            content: warnContent,
            width: 400,
            height: 180,
            showConfirm: true,
            confirmText: "OK",
            showCancel: false
        });
        warnDialog.show();
        return;
    }

    // Step 2) Load saved settings
    var saved = loadSavedSettings();

    // Step 3) Build surface options
    var surfaceOptions = surfaceEntries.map(function (se) {
        return { value: se.id, text: se.name + " (" + se.triCount + " tris)" };
    });

    // Step 4) Get initial Z bounds
    var defaultSurface = (saved && saved.surfaceId) || surfaceOptions[0].value;
    var zBounds = getSurfaceZBounds(defaultSurface);
    var defaultMinZ = (saved && saved.minZ != null) ? saved.minZ : (zBounds ? Math.floor(zBounds.minZ) : 0);
    var defaultMaxZ = (saved && saved.maxZ != null) ? saved.maxZ : (zBounds ? Math.ceil(zBounds.maxZ) : 100);

    // Step 5) Build container
    var container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.padding = "4px 0";

    // Surface pick row
    var rowSurf = createPickRow("Surface", surfaceOptions, defaultSurface, function () {
        enterPickMode(rowSurf, function (surfaceId) {
            rowSurf.select.value = surfaceId;
            updateZBounds(surfaceId);
        });
    });
    container.appendChild(rowSurf.row);

    // Update Z bounds when surface selection changes
    rowSurf.select.addEventListener("change", function () {
        updateZBounds(rowSurf.select.value);
    });

    // Step 6) Build form fields
    var fields = [
        {
            label: "Contour Interval (m)",
            name: "interval",
            type: "number",
            value: saved ? (saved.interval || 5) : 5,
            min: 0.01,
            step: 1,
            tooltip: "Vertical spacing between contour lines"
        },
        {
            label: "Min Elevation (m)",
            name: "minZ",
            type: "number",
            value: defaultMinZ,
            step: 1,
            tooltip: "Lowest contour elevation"
        },
        {
            label: "Max Elevation (m)",
            name: "maxZ",
            type: "number",
            value: defaultMaxZ,
            step: 1,
            tooltip: "Highest contour elevation"
        },
        {
            label: "Vertex Spacing (m)",
            name: "vertexSpacing",
            type: "number",
            value: saved ? (saved.vertexSpacing || 0) : 0,
            min: 0,
            step: 0.5,
            tooltip: "Simplification tolerance. 0 = keep all vertices"
        },
        {
            label: "Close Polylines",
            name: "closedPolygons",
            type: "checkbox",
            value: saved ? saved.closedPolygons === true : false,
            tooltip: "Close contour polylines into polygons"
        },
        {
            label: "Color",
            name: "color",
            type: "color",
            value: saved ? (saved.color || "#FFCC00") : "#FFCC00"
        },
        {
            label: "Line Width",
            name: "lineWidth",
            type: "number",
            value: saved ? (saved.lineWidth || 2) : 2,
            min: 1,
            max: 10,
            step: 1
        },
        {
            label: "Layer Name",
            name: "layerName",
            type: "text",
            value: saved ? (saved.layerName || "CONTOUR") : "CONTOUR"
        }
    ];

    var formContent = createEnhancedFormContent(fields);
    container.appendChild(formContent);

    // Helper to update minZ/maxZ fields when surface changes
    function updateZBounds(surfaceId) {
        var bounds = getSurfaceZBounds(surfaceId);
        if (!bounds) return;
        var minInput = formContent.querySelector('[name="minZ"]');
        var maxInput = formContent.querySelector('[name="maxZ"]');
        if (minInput) minInput.value = Math.floor(bounds.minZ);
        if (maxInput) maxInput.value = Math.ceil(bounds.maxZ);
    }

    // Notes
    var notesDark = isDarkMode();
    var notesDiv = document.createElement("div");
    notesDiv.style.marginTop = "10px";
    notesDiv.style.fontSize = "10px";
    notesDiv.style.color = notesDark ? "#888" : "#666";
    notesDiv.innerHTML =
        "<strong>Surface Contours:</strong><br>" +
        "&bull; Generates contour lines at regular elevation intervals<br>" +
        "&bull; Slices the surface with horizontal planes<br>" +
        "&bull; Results are stored as KAD line entities<br>" +
        "<br><strong>Tip:</strong> Click the pick button then click a surface in the 3D view.";
    container.appendChild(notesDiv);

    // Step 7) Create dialog
    var dialog = new FloatingDialog({
        title: "Surface Contours",
        content: container,
        layoutType: "wide",
        width: 480,
        height: 560,
        showConfirm: true,
        confirmText: "Generate",
        cancelText: "Cancel",
        onConfirm: function () {
            exitPickMode();
            clearAllHighlights();

            var surfaceId = rowSurf.select.value;
            var data = getFormData(formContent);

            var interval = parseFloat(data.interval);
            if (!interval || interval <= 0) {
                var errContent = document.createElement("div");
                errContent.style.padding = "15px";
                errContent.textContent = "Contour interval must be greater than 0.";
                var errDialog = new FloatingDialog({
                    title: "Surface Contours",
                    content: errContent,
                    width: 350,
                    height: 160,
                    showConfirm: true,
                    confirmText: "OK",
                    showCancel: false
                });
                errDialog.show();
                return false;
            }

            var config = {
                surfaceId: surfaceId,
                interval: interval,
                minZ: parseFloat(data.minZ),
                maxZ: parseFloat(data.maxZ),
                vertexSpacing: parseFloat(data.vertexSpacing) || 0,
                closedPolygons: data.closedPolygons === true || data.closedPolygons === "true",
                color: data.color || "#FFCC00",
                lineWidth: parseInt(data.lineWidth) || 2,
                layerName: data.layerName || "CONTOUR"
            };

            saveSettings(config);
            callback(config);
        },
        onCancel: function () {
            exitPickMode();
            clearAllHighlights();
        }
    });

    dialog.show();
}
