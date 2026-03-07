# Template MapView Rendering + GroupTable Function

## Date: 2026-03-07

## Goals
1. Fix `fx:mapView(r)` — proper offscreen raster render (not canvas screenshot)
2. Add `fx:mapView(v)` — vector rendering directly into jsPDF
3. Add `groupTable()` and `groupAvg/Min/Max` formula functions

## Plan

### 1. mapView(r) — Raster Render
- Temporarily use global `printCanvas`/`printCtx` from PrintSystem
- Resize to match cell aspect ratio at 300 DPI
- Call `drawDataForPrinting()` to render holes, surfaces, images, KADs
- Capture `toDataURL()`, embed in PDF at cell bounds
- Restore `printCanvas`
- Files: `TemplateDialog.js`

### 2. mapView(v) — Vector Render
- Extract vector drawing functions from `PrintVectorPDF.js` into reusable module
- New file: `src/print/PrintVectorDrawing.js`
  - `drawVectorHoles(doc, holes, worldToPDF, clipRect, displayOptions)`
  - `drawVectorConnectors(doc, holes, worldToPDF, clipRect)`
  - `drawVectorKAD(doc, kadMap, worldToPDF, clipRect)`
  - `drawVectorSurfaces(doc, surfaces, worldToPDF, clipRect)` (optional)
- Wire into template render callback
- Files: `PrintVectorDrawing.js` (new), `TemplateDialog.js`, `PrintVectorPDF.js` (refactor to use shared functions)

### 3. groupTable() Function
- `groupTable(groupField[i], formatString, sep)` — multi-field per-group formatting
- Format tokens: `{key}`, `{count}`, `{sum:field}`, `{avg:field}`, `{min:field}`, `{max:field}`, `{median:field}`
- Also add: `groupAvg()`, `groupMin()`, `groupMax()` simple functions
- File: `TemplateFormulaEvaluator.js`

### 4. Update TemplateVariables.js
- Add new functions to `getAvailableVariables()` documentation list

## Order of Work
1. groupTable + groupAvg/Min/Max (self-contained, quick)
2. mapView(r) raster fix
3. mapView(v) vector rendering
