# Kirra Backlog / Ideas

Ideas and potential tasks to discuss or implement later.

## Contents (ordered: quick wins → high effort/risk)

1. ~~KAD Entity Validation & Sorting~~ — **COMPLETED** (2026-02-26)
2. Charging System UI Improvements — _low risk, small UI tweaks_
3. ~~Surface Contour Line Generation~~ — **COMPLETED** (2026-02-26)
4. Offset and Radii Undo/Redo Deletion — _low risk, extends existing undo system_
5. Charging Tools — Temperature Recording from Hole Conditions — _low risk, extends existing code_
6. Charging — Hole Conditions / Swap Editor — _low risk, new dialog_
7. Charging — Formula Builder UI — _medium risk, new UI component_
8. ~~KAD Modification Tools~~ — **COMPLETED** (2026-03-03)
8b. KAD Extend/Trim Segment to Segment ("T-Junction") Tool — _low risk, new tool_
8c. CSG Solid Boolean — Normals Alignment Warning — _quick win, UI-only_
9. TreeView Revamp — _low-medium risk, medium effort_
10. Undo/Redo for Surface Deletion — _medium risk, large data + persistence concerns_
11. Surface Boolean Fails on Dual Open Mesh (Tea Cup–Saucer) — _medium risk, complex algorithm debugging_
12. Improve 3D Draw Calls & Interaction Response — _medium risk, medium-high effort_
13. Electronic Timing Tools — _medium risk, new feature area_
14. Performance & Large Dataset Scalability — _medium-high risk, high effort_
15. Update trimesh-boolean library with Kirra insights — _medium risk, library enhancement + demo_
16. UI/UX Overhaul — Align with Kirra Scheduler — _highest risk, highest effort_

## Under Consideration

- **Update trimesh-boolean library with Kirra insights** — Feed back all the mesh repair, normals, and diagnostics knowledge gained from building the Surface Boolean tool into the `trimesh-boolean` npm library. Make it a standalone, full-featured mesh toolkit. Key additions: (updated 2026-03-03)
  - **Mesh repair**: stitch by proximity, force-close indexed mesh (with max distance limit), weld vertices, remove degenerate/sliver triangles, clean non-manifold crossings, remove overlapping/internal walls
  - **Normals**: detect direction (Z+, Z-, Out, In, Chaos), align Z-up, flip normals, classify per-region
  - **Diagnostics/warnings**: closed vs open mesh detection, boundary edge count, hole finding, normal consistency report, topology badges
  - **Boolean pipeline**: split-and-classify with Steiner point re-triangulation, per-component split groups, seam closure modes (raw, stitch, close by stitching)
  - **Build a Three.js demo app** — interactive demo using Three.js to visualise boolean operations, mesh repair steps, normals colouring, hole detection, and diagnostics overlays
  - Source insights from: `SurfaceBooleanHelper.js`, `MeshRepairHelper.js`, `SurfaceIntersectionHelper.js`, `SurfaceNormalHelper.js`, `SurfaceHighlightHelper.js`

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

- ~~**KAD Modification Tools**~~ — **COMPLETED** (2026-03-03). All sub-items implemented:
  - ~~**Split line/poly at point**~~ — ✅ `SplitKADLinesHelper.js` + `KADSplitLinesDialog.js`
  - ~~**Join lines**~~ — ✅ `JoinKADLinesHelper.js` + `KADJoinLinesDialog.js`
  - ~~**Insert point**~~ — ✅ Via KAD context menu (right-click segment → Insert Point)
  - ~~**Extend segment to intersecting line**~~ — _Moved to item 8b (T-Junction Tool)_

- **CSG Solid Boolean — Normals Alignment Warning** — Add a warning/info message in the Solid CSG Boolean dialog reminding the user to align normals outward on both closed solids before running the operation. Misaligned or inconsistent normals produce unreliable CSG results. Could be a persistent info banner at the top of the dialog, or a pre-flight check that inspects the normal direction badges and warns if either solid is not "Out" or "Z+". (2026-03-03)

- **KAD Extend/Trim Segment to Segment ("T-Junction") Tool** — A tool for extending or shortening a line/poly endpoint to meet another segment, creating a clean "T" junction. Workflow: (2026-03-03)
  1. Select a line or poly entity and pick an **endpoint** on a segment to extend/trim
  2. Select a **target segment** on the same line or a different line/poly
  3. The selected endpoint is moved along its segment direction until it meets (intersects) the target segment
  - Handles both **extend** (lengthen to reach target) and **trim** (shorten back to target)
  - Should show a live preview of the projected intersection point before confirming
  - Works with line and poly entity types
  - Uses the existing Select Pointer + KAD pick pattern for interactive segment/endpoint selection

- **Charging System UI Improvements** — Enhance the deck/charging interface for better usability: (2026-02-25)
  - **Right-click context menu on deck** — Right-click a deck to edit it, link to deck-base above, or link to deck-top below
  - **Text field expansion priority** — The edit deck/primer dialog text fields should prioritise expandability so users can write long formulas (e.g., resizable/multi-line inputs instead of fixed-width single-line fields). Currently formula fields like `fx:chargeBase[4] - 0.3` are cramped in small fixed-width inputs

- **Charging — Hole Conditions / Swap Editor** — Add a dialog for setting hole conditions and swap rules on blast holes. The swap engine already supports condition codes (`w` wet, `d` damp, `r` reactive, `t` temperature) and the hole data model has `holeConditions`, `measuredTemperature`, `measuredTemperatureUnit` fields — but there is no UI to set them. (2026-02-26)
  - Checkbox list for condition codes (wet, damp, reactive)
  - Temperature input with C/F unit selector
  - Accessible from hole right-click context menu or Deck Builder dialog
  - Critical for testing and applying product swap rules

- **Charging — Formula Builder UI** — Add a drag-and-drop formula builder for deck/primer depth formulas. Instead of manually typing `fx:chargeBase[4] - 0.3`, provide a visual builder with: (2026-02-26)
  - **Draggable variable chips**: `holeLength`, `stemLength`, `chargeBase[n]`, `deckTop[n]`, `deckBase[n]`, `benchHeight`, `subdrill`, etc.
  - **Draggable operator chips**: `+`, `-`, `*`, `/`, `?`, `:`, `>`, `<`, `>=`, `<=`, `(`, `)`
  - **Drop zone / formula bar** where chips are assembled left-to-right into a formula string
  - **Live preview** showing the resolved numeric value for the current hole
  - Clicking a chip in the formula bar selects it for editing or deletion
  - Formula string output feeds directly into existing `fx:` formula engine

- **Charging Tools — Temperature Recording from Hole Conditions** — Extend the charging tools to record temperature data, sourcing from the existing "Hole Conditions" code. Allow temperature to be captured per hole/deck and stored alongside charge data for reporting and product selection. (2026-02-25)

- **Electronic Timing Tools** — Tools for setting downhole timing on blast holes using timing contours. Use points, lines, or polygons as input sources. Multiple methods for creating and applying timing: (2026-02-25)
  - **Points to timing contour** — Use point entities (with Z as timing value) to build a timing contour
  - **Line to timing contour** — Draw a line entity and convert it to a timing contour
  - **Polyline/polygon to timing contour** — Draw a polyline or polygon entity and convert it to a timing contour
  - **Triangulated timing surface** — Use two or more points, lines, or polys at an elevation, build a triangulation between them, then use the resulting surface as a timing contour. Assign downhole times to blast holes by interpolating timing values from the triangulated surface at each hole's XY location

- **Improve 3D Draw Calls & Interaction Response** — 3D performance is very poor with multiple surfaces loaded (4 FPS at 728K triangles, 21 surfaces, 32 draw calls, ~550ms avg frame time). Investigate and fix: (2026-02-25)
  - **Frustum culling** — skip rendering surfaces/objects outside the camera view
  - **Geometry merging** — merge static surfaces into fewer draw calls where possible
  - **LOD / decimation** — reduce triangle count for distant surfaces
  - **Throttle raycasting** — interaction (mouse move, hover) may be triggering expensive raycasts every frame
  - **KAD line batching** — 20,932 lines across 2 KADs may benefit from merging into fewer BufferGeometry objects
  - **Render-on-demand** — only re-render when camera moves or data changes, not every frame

- **Surface Boolean Fails on Dual Open Mesh (Tea Cup–Saucer Scenario)** — Surface boolean operations fail when both input meshes are open (e.g., a tea cup intersected with a saucer — two open shells). Works perfectly on open mesh vs closed solid, and closed solid vs closed solid. Investigate edge cases in the boolean pipeline for dual-open-mesh inputs. (2026-02-25)

- ~~**KAD Entity Validation & Sorting**~~ — **COMPLETED** (2026-02-26). See Completed section below.

## Decided / Ready to Implement

_(move items here when ready to proceed)_

## Completed

- **KAD Entity Validation & Sorting** — Implemented 2026-02-26. Files: `src/helpers/KADValidationHelper.js`, modified `src/kirra.js` (endKadTools, debouncedSaveKAD, loadKADFromDB), `src/dialog/contextMenu/ContextMenuManager.js`. Interactive Convert/Discard dialog on invalid entities (Escape, right-click, entity finish). Silent batch validation on save/load chokepoints.

- **Surface Contour Line Generation** — Implemented 2026-02-26. Files: `src/helpers/ContourHelper.js`, `src/dialog/popups/surface/ContourDialog.js`. Plane-triangle intersection slicing with elevation-based entity naming (`RL{elev}-{seq}-{uid}`), line/poly toggle, settings persistence.

- **KAD Modification Tools** — Implemented by 2026-03-03. Split: `src/helpers/SplitKADLinesHelper.js` + `src/dialog/popups/kad/KADSplitLinesDialog.js`. Join: `src/helpers/JoinKADLinesHelper.js` + `src/dialog/popups/kad/KADJoinLinesDialog.js`. Insert Point: via KAD right-click context menu (`src/dialog/contextMenu/KADContextMenu.js`). "Extend segment" sub-item moved to backlog item 8b (T-Junction Tool).
