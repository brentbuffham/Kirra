# Plan: Extract Mesh Repair Pipeline + Fix Open CSG Results

## Context

THREE-CSGMesh BSP operations produce **open meshes** (Closed: No) due to floating-point precision creating duplicate vertices, non-manifold edges, and small gaps. `SolidCSGHelper.js` currently has **zero post-CSG mesh repair** — it goes straight from CSG result to surface storage.

`SurfaceBooleanHelper.js` already has a complete repair pipeline (weld, degenerate removal, stitch, cap, force-close) but all functions are **private**. The fix is to extract them into a shared module and wire them into the Solid CSG path.

Additionally: add a progress dialog during CSG+repair, detect/handle WebGL context loss gracefully, and clean up GPU resources before heavy operations.

---

## Files to Create

### 1. `src/helpers/MeshRepairHelper.js` (~750 lines)

Extract these private functions from `SurfaceBooleanHelper.js`:

| Function | Line | External Deps |
|---|---|---|
| `dist3(a, b)` | 2065 | none |
| `triangleArea3D(tri)` | 2121 | none |
| `computeBounds(points)` | 2040 | none |
| `deduplicateSeamVertices(tris, tol)` | 1171 | none |
| `weldVertices(tris, tol)` | 1497 | none |
| `weldedToSoup(weldedTriangles)` | 2079 | none |
| `removeDegenerateTriangles(tris, minArea, sliverRatio)` | 2150 | none |
| `weldBoundaryVertices(tris, tol)` | 3077 | none |
| `_pointInLoop2D(px, py, coords, n)` | 1966 | none (private) |
| `extractBoundaryLoops(tris)` | 1591 | none |
| `cleanCrossingTriangles(tris)` | 2829 | none |
| `removeOverlappingTriangles(tris, tol)` | 2939 | none |
| `stitchByProximity(tris, stitchTol)` | 2217 | none |
| `triangulateLoop(loop)` | 1825 | Delaunator, Constrainautor |
| `logBoundaryStats(tris, closeMode)` | 2098 | none |
| `capBoundaryLoops(tris)` | 1712 | none |
| `forceCloseIndexedMesh(points, triangles)` | 2476 | none |
| `capBoundaryLoopsSequential(soup, snapTol, maxPasses)` | 1743 | countOpenEdges (from SurfaceIntersectionHelper) |

All exported except `_pointInLoop2D` (stays private).

**New function — `async repairMesh(soup, config, onProgress)`**: High-level entry point:
1. `deduplicateSeamVertices` (always) → `onProgress("Deduplicating vertices...")`
2. `weldVertices` (always) → `onProgress("Welding vertices...")`
3. `removeDegenerateTriangles` (if `config.removeDegenerate`, default true) → `onProgress("Removing degenerates...")`
4. If `closeMode === "stitch"`:
   - `stitchByProximity` → `onProgress("Stitching boundaries...")`
   - `capBoundaryLoopsSequential` → `onProgress("Capping boundary loops...")`
   - post-cap cleanup (clean crossings, degenerates)
   - `forceCloseIndexedMesh` safety net → `onProgress("Force-closing gaps...")`
5. `logBoundaryStats`
6. Returns `{ points, triangles, soup }`

Each major step calls `await new Promise(r => setTimeout(r, 0))` to yield to the event loop, allowing the progress dialog to update.

Imports: `Delaunator`, `Constrainautor`, `countOpenEdges` from `SurfaceIntersectionHelper.js`.

Console log prefix: `"MeshRepairHelper: ..."` for all moved functions.

---

## Files to Modify

### 2. `src/helpers/SurfaceBooleanHelper.js` (~3238 → ~1650 lines)

1. **Add import block** from `MeshRepairHelper.js` (all 17 exported functions)
2. **Delete the 18 function bodies** that were extracted
3. **Add `contextLost` guards to `applyMerge()`** — same pattern as `solidCSG()`:
   - Pre-check at top: abort if `window.threeRenderer.contextLost`
   - Post-check before `drawData()`: skip render if context was lost (surface still saved to DB)
   - Wrap in try/catch for graceful failure
4. Keep: `trianglesToMesh`, `buildCurtainAndCap`, `generateClosingTriangles`, `pointInTri2D`

### 3. `src/helpers/SolidCSGHelper.js` (~301 → ~350 lines)

**Make `solidCSG()` async** to support progress dialog and yielding.

1. **Update imports**: add `computeBounds`, `repairMesh`, `weldedToSoup` from `MeshRepairHelper.js`
2. **Delete private `computeBounds()`** (lines 285-300) — now imported
3. **Add pre-operation guard** at top of `solidCSG()`:
   ```
   // Abort if WebGL context already lost
   if (window.threeRenderer && window.threeRenderer.contextLost) {
       console.error("SolidCSGHelper: WebGL context lost — aborting CSG");
       return null;
   }
   ```
4. **Add Step 5b — Mesh repair** (after line 165, when `config.repairMesh`):
   - Convert `triangles` to soup format
   - `await repairMesh(soup, config, onProgress)` — `onProgress` updates the progress dialog
   - Overwrite `worldPoints` and `triangles`
5. **Add post-operation guard** before `drawData()` call:
   ```
   // Check context wasn't lost during CSG
   if (window.threeRenderer && window.threeRenderer.contextLost) {
       console.warn("SolidCSGHelper: WebGL context lost during operation — surface saved but 3D render skipped");
       // Surface is already saved to DB — user can reload to see it
       return surfaceId;
   }
   ```
6. **Wrap entire operation in try/catch** — on error, close progress dialog and show error via FloatingDialog

### 4. `src/dialog/popups/surface/SolidCSGDialog.js` (~416 → ~560 lines)

**Progress dialog**: Use the existing `showProgressDialog` pattern from SurfaceBooleanDialog.

1. **Add `showProgressDialog(message)` function** — simple FloatingDialog with title "Solid CSG", centered text, no buttons (copy pattern from SurfaceBooleanDialog.js:1121-1138)

2. **Add "Repair Result" section** to dialog DOM (after warning div, before form fields):
   - Checkbox: "Repair result mesh" (auto-checked when either mesh is open)
   - Close Mode select: "Weld Only" / "Close by Stitching"
   - Snap tolerance input (default 0)
   - Stitch tolerance input (default 1.0, shown only when mode = stitch)

3. **Update `updateClosedWarning()`** to auto-enable repair checkbox when meshes are open

4. **Update `onConfirm`** handler:
   - Show progress dialog: `"Computing CSG..."`
   - Call `await solidCSG(config)` (now async)
   - Progress dialog updated by `onProgress` callback passed through config
   - On success: close progress dialog, show success toast/log
   - On failure: close progress dialog, show error dialog
   - Pass `repairMesh`, `closeMode`, `snapTolerance`, `stitchTolerance`, `onProgress` to `solidCSG()`

5. **Increase dialog height** from 470 to ~560

6. **Progress flow**:
   ```
   "Computing CSG..."  →  "Repairing mesh..."  →  "Welding vertices..."  →
   "Stitching boundaries..."  →  "Capping loops..."  →  "Complete!"
   ```
   The `onProgress` callback updates the text content of the progress dialog div.

### 5. `aiPlans/20260224-MeshRepairHelper-Extraction.md`

Save a copy of this plan.

---

## GPU Memory Protection Strategy

### What already exists (no changes needed):
- `webglcontextlost` / `webglcontextrestored` handlers in ThreeRenderer.js (lines 61-138)
- `contextLost` guard in render loop (ThreeRenderer.js:1237)
- "GPU Memory Exhausted" FloatingDialog with reload option
- `getMemoryStats()` / `logMemoryStats()` on ThreeRenderer

### What we add:
1. **Pre-operation `contextLost` check** in `solidCSG()` — abort early if GPU already dead
2. **Post-operation `contextLost` check** — skip `drawData()` if context was lost during CPU work (the surface is still saved to IndexedDB, so user can reload and see it)
3. **Try/catch wrapper** around the entire `solidCSG()` — catches any WebGL errors during result rendering
4. **Progress dialog** — keeps UI responsive and informs user during long operations

### Why NOT clear GPU cache before CSG:
- CSG computation is **pure CPU** (BSP tree math in JavaScript) — no GPU involvement
- GPU memory is only consumed when the **result mesh is rendered** via `drawData()`
- Pre-clearing the Three.js scene would destroy the user's existing 3D view unnecessarily
- The real fix for GPU exhaustion is the existing `webglcontextlost` handler + the context checks we add

### What causes the GPU exhaustion in the screenshot:
The Surface Boolean preview meshes (78K + 366K triangles as individually colored `BufferGeometry`) consume GPU memory during the Pick Regions phase. Both `solidCSG()` and `applyMerge()` get the same `contextLost` guards — the CSG tool is defensive against a previous GPU death, while the Surface Boolean tool can actually trigger it during preview mesh creation. Both paths save to IndexedDB before attempting 3D render, so the user can always reload to recover.

---

## Verification

1. **Build**: `npm run build` — no errors, no circular imports
2. **Surface Boolean still works**: Run a Surface Boolean split+merge with closeMode="stitch" — verify no missing function errors
3. **CSG with repair OFF**: Subtract two surfaces → result matches pre-change behavior
4. **CSG with repair ON (weld only)**: Subtract → verify welded, degenerates removed
5. **CSG with repair ON (stitch)**: Subtract → verify mesh closes (Statistics: "Closed: Yes")
6. **Progress dialog**: CSG operation shows progress messages that update through pipeline steps
7. **Context-lost guard**: If WebGL context is lost before running CSG, operation aborts with console error (no crash)
8. **Auto-enable**: Open CSG dialog with one open surface → repair checkbox auto-checks
9. **No duplicate `computeBounds`**: Only one definition in `src/helpers/MeshRepairHelper.js`
