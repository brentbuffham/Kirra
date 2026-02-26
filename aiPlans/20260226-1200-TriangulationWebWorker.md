# Plan: Move Triangulation to Web Worker

**Date**: 2026-02-26
**Status**: COMPLETED

## Summary
Moved all CDT (Constrained Delaunay Triangulation) computation to a Web Worker to eliminate:
- 30s time limit that caused ~45% constraint skipping on large datasets
- UI freezing during triangulation
- requestAnimationFrame batching overhead

## Files Created
1. **`src/workers/triangulationWorker.js`** — Web Worker with pure computation:
   - `getUniqueElementVertices()` — spatial hash deduplication
   - `createSpatialIndex()` + `findClosestVertexIndex()` — vertex lookup
   - `extractConstraintsFromDeduplicatedVertices()` — constraint extraction
   - `createConstrainautorTriangulation()` — CDT with NO time limits, NO batching
   - `createBasicDelaunayTriangulation()` — unconstrained Delaunay
   - Message protocol: progress, result, error

2. **`src/helpers/TriangulationService.js`** — Main-thread API:
   - `triangulate()` — constrained CDT via worker
   - `triangulateBasic()` — basic Delaunay via worker
   - `terminateWorker()` — cancel support
   - Singleton worker pattern

## Files Modified
3. **`src/kirra.js`**:
   - Added import for TriangulationService
   - Removed Constrainautor import (now only in worker)
   - Replaced `createDelaunayTriangulation()` — collects vertices on main thread, delegates to worker
   - Replaced `createConstrainedDelaunayTriangulation()` — collects vertices + KAD entity data, delegates to worker
   - Removed ~800 lines of computation code (dedup, spatial index, constraint extraction, CDT loop, fallback)
   - Added `window.terminateTriangulationWorker` export

## Key Design Decisions
- Worker uses ES module imports (`{ type: 'module' }`) — Vite handles bundling
- Constraint loop is a simple `for` loop — no time limits, no RAF batching
- Progress posted every 100 constraints via `postMessage`
- Vertex collection stays on main thread (needs `allBlastHoles`, `allKADDrawingsMap`)
- KAD entity data serialized as plain objects for worker transfer
- API surface unchanged — `window.createConstrainedDelaunayTriangulation` and `window.createDelaunayTriangulation` still work the same way
