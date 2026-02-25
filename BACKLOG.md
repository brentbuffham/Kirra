# Kirra Backlog / Ideas

Ideas and potential tasks to discuss or implement later.

## Under Consideration

- **Replace local helpers with trimesh-boolean npm package** — Remove ~4,300 lines of duplicated algorithm code from `src/helpers/` (SurfaceBooleanHelper, MeshRepairHelper, SurfaceIntersectionHelper, SurfaceNormalHelper) and import from `trimesh-boolean` instead. Keeps Kirra-specific wrappers (dialogs, undo, preview). Risk: adds npm dependency. (2026-02-25)

- **UI/UX Overhaul — Align with Kirra Scheduler** — Redesign the UI to match the Kirra Scheduler aesthetic while maintaining a desktop CAD design tool feel. Key goals: (2026-02-25)
  - Remove side navs, replace with a proper **menubar** system
  - Add **dockable panels** and **toolbars** (properties, layers, tree view, etc.)
  - Improve overall UI/UX experience, reliability, and state management
  - **Separate UI from functional code** — pull all UI/presentation logic out of `kirra.js` and helpers into dedicated UI modules
  - Continue to **modularise and modernise** the codebase (reduce `kirra.js` monolith)

- **Performance & Large Dataset Scalability** — Large datasets exhaust WebGL/WebGPU resources. Investigate options to improve speed and efficiency when handling large meshes, point clouds, and blast patterns. Areas to explore: (2026-02-25)
  - **WebGPU compute shaders** — offload heavy geometry processing (intersection, triangulation) to GPU
  - **Level-of-detail (LOD)** and progressive loading for large surfaces
  - **Instanced rendering** for blast holes (thousands of cylinders)
  - **Web Workers** for off-main-thread processing (file parsing, repair, boolean ops)
  - **Hosting with GPU access** — cloud hosting options (GPU-enabled VMs, serverless GPU) for server-side processing of large datasets
  - **Desktop/hybrid deployment** (Electron, Tauri) for direct filesystem access and better resource management
  - **File System Access API** for browser-based local directory access without upload/download cycles
  - **Data streaming / tiling** — load only visible regions for very large datasets

- **TreeView Revamp** — Improve the TreeView component with better interaction and reliability. (2026-02-25)
  - **Drag and drop** reordering of entities/nodes
  - **Sorting options** — by order, date, and alphanumerical
  - Improve overall **reliability** and state consistency

- **Undo/Redo for Surface Deletion** — Surface deletion currently does NOT trigger the undo/redo system. Deleting a surface is a destructive, irreversible action with no way to recover. Implement undo/redo support so deleted surfaces can be restored. Considerations: (2026-02-25)
  - Surfaces can be large (mesh data, texture blobs) — may need a lightweight snapshot strategy rather than cloning entire surface objects
  - Must restore both in-memory state (`window.loadedSurfaces`) and IndexedDB persistence (`saveSurfaceToDB`)
  - Should also restore Three.js scene objects and TreeView nodes
  - Consider a confirmation dialog as a simpler short-term alternative

- **Offset and Radii Undo/Redo Deletion** — Offset and radii operations that create new entities currently lack undo/redo support for deletion of those results. If a user deletes an offset or radii entity, there is no way to recover it. Implement undo/redo hooks for these destructive actions. (2026-02-25)

- **KAD Modification Tools** — A set of new tools for editing KAD line/poly entities: (2026-02-25)
  - **Split line/poly at point** — Split an existing line or polygon entity into two separate entities at a selected point
  - **Join lines** — Merge two line entities into a single continuous line (snap endpoints)
  - **Insert point** — Insert a new vertex into an existing line/poly segment at a specified location
  - **Extend segment to intersecting line** — Extend the end of a line/poly segment until it intersects another line entity

- **Charging System UI Improvements** — Enhance the deck/charging interface for better usability: (2026-02-25)
  - **Right-click context menu on deck** — Right-click a deck to edit it, link to deck-base above, or link to deck-top below
  - **Text field expansion priority** — The edit deck dialog text fields should prioritise expandability so users can write long formulas (e.g., resizable/multi-line inputs instead of fixed-width single-line fields)

- **Charging Tools — Temperature Recording from Hole Conditions** — Extend the charging tools to record temperature data, sourcing from the existing "Hole Conditions" code. Allow temperature to be captured per hole/deck and stored alongside charge data for reporting and product selection. (2026-02-25)

- **Electronic Timing Tools** — Tools for setting downhole timing on blast holes using timing contours. Use points, lines, or polygons as input sources. Multiple methods for creating and applying timing: (2026-02-25)
  - **Points to timing contour** — Use point entities (with Z as timing value) to build a timing contour
  - **Line to timing contour** — Draw a line entity and convert it to a timing contour
  - **Polyline/polygon to timing contour** — Draw a polyline or polygon entity and convert it to a timing contour
  - **Triangulated timing surface** — Use two or more points, lines, or polys at an elevation, build a triangulation between them, then use the resulting surface as a timing contour. Assign downhole times to blast holes by interpolating timing values from the triangulated surface at each hole's XY location

- **Surface Contour Line Generation** — Generate contour lines from a triangulated surface by reusing the existing surface intersection tool. Approach: for each contour interval, generate an imaginary horizontal plane at that elevation in memory, then intersect it against the selected surface using the existing intersection pipeline. Output the resulting intersection lines as KAD line/poly entities for display and export. No need for marching squares — the intersection tool already handles triangle-plane math and segment extraction. (2026-02-25)

- **KAD Entity Validation & Sorting** — The previous entity type auto-sorting code (converting invalid types like 2-pt poly→line, 1-pt line→point) didn't stick. Revisit with a stricter approach: (2026-02-25)
  - **Prevent saving invalid entities** — lines must have ≥2 points, polys must have ≥3 points
  - Show **user warnings** when attempting to save incomplete entities rather than silently converting
  - Review and fix the existing sorting/validation logic

## Decided / Ready to Implement

_(move items here when ready to proceed)_

## Completed

_(move items here when done)_
