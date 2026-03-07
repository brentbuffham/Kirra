# Plan: Unified Print Dialog (Template Dialog = THE Print System)
**Date**: 2026-03-08
**Status**: Phase 2 Complete

## Goal
Move all printing into the Template Dialog. The side nav only has one print button
that opens the dialog. "Kirra Inbuilt" becomes a preset template option alongside
user-saved XLSX templates.

## Current State
- Side nav has: Print Preview toggle, Paper Size dropdown, Orientation dropdown,
  print buttons (inbuilt raster, inbuilt vector, template)
- Two separate print pipelines: inbuilt (`printCanvasHiRes`) and template (`captureMapViewRaster`)
- Inbuilt handles 2D+3D, clipping, Voronoi, layout manager, footer content
- Template handles XLSX cell formulas, mapView raster, PDF rendering from cells

## Target State
- Side nav: ONE "Print PDF / XLSX" button (opens template dialog)
- Template dialog "Saved Template" dropdown: `[Kirra Inbuilt, Template1, Template2, --Import--]`
- Paper Size and Orientation controls INSIDE the dialog
- Print Preview forced ON when dialog opens
- Dialog controls the paper size/orientation (syncs with Kirra boundary)
- Raster capture leverages the inbuilt pipeline (2D+3D, clipping, Voronoi)

## Phase 1 - Make template raster work properly (DONE)
1. Template dialog syncs paper size/orientation to Kirra controls (DONE)
2. captureMapViewRaster supports 3D mode (DONE)
3. captureMapViewRaster uses Kirra print boundary (DONE)
4. Paper Size + Orientation in dialog update Kirra boundary on change (DONE)

## Phase 2 - Add "Kirra Inbuilt" as template option (DONE)
1. Add "Kirra Inbuilt" as first option in Saved Template dropdown (DONE)
2. When selected, use `printCanvasHiRes` pipeline (raster) or `generateTrueVectorPDF` (vector) (DONE)
3. Output Format: [PDF Raster, PDF Vector, XLSX] — XLSX disabled for Kirra Inbuilt (DONE)
4. Toggle hides template-specific UI (sheet selector, file import) for Kirra Inbuilt (DONE)
5. Paper size/orientation "From Sheet" option hidden for Kirra Inbuilt (DONE)
6. Print preview forced ON when dialog opens, restored on close (DONE)
7. Kirra Inbuilt syncs paper size/orientation to Kirra controls on change (DONE)

## Phase 3 - Single print button in side nav (PENDING)
1. Replace Print Files section in side nav with single button
2. Button opens template dialog
3. Remove Paper Size/Orientation/Print Preview toggle from side nav
4. Move those controls into the dialog
5. NOTE: User said "eventually getting rid of the side naves and doing a ui rebuild"
   so this phase can wait until that UI rebuild

## Files Modified
- `src/print/template/TemplateDialog.js` - Added Kirra Inbuilt mode, vector/raster output,
  print preview toggle, paper size sync, UI toggling
- `src/print/PrintSystem.js` - setPaperSizeAndOrientation (from Phase 1)
- `aiPlans/20260308-0100-TemplateRasterPipeline.md` - This plan file
