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

- **KAD Entity Validation & Sorting** — The previous entity type auto-sorting code (converting invalid types like 2-pt poly→line, 1-pt line→point) didn't stick. Revisit with a stricter approach: (2026-02-25)
  - **Prevent saving invalid entities** — lines must have ≥2 points, polys must have ≥3 points
  - Show **user warnings** when attempting to save incomplete entities rather than silently converting
  - Review and fix the existing sorting/validation logic

## Decided / Ready to Implement

_(move items here when ready to proceed)_

## Completed

_(move items here when done)_
