# Charging Module Fixes Plan
Date: 2026-03-05

## Root Cause Analysis

### Issues 2-5: "No Charged Holes" error across all charging features
**Root Cause:** Key mismatch in `ChargingExportDialog.js` and `BlastHoleCSVWriter.js`
- The `window.loadedCharging` Map uses keys in format `entityName:::holeID` (via `chargingKey(hole)`)
- `ChargingExportDialog.js:20` uses `window.loadedCharging.has(visibleHoles[i].holeID)` - just `holeID`
- `BlastHoleCSVWriter.js:456,530,576,621` all use `chargingMap.get(hole.holeID)` - just `holeID`
- Fix: Import `chargingKey` and use it consistently

### Issue 1: Vector print missing design kg per hole/deck
**Root Cause:** `PrintRendering.js` `printHoleLabels()` (line 1617-1690) handles many display options but never checks `displayOptions.massPerHole` or `displayOptions.massPerDeck`
- Fix: Add massPerHole and massPerDeck handling using `buildMassLabels()`

### Issue 6: Custom CSV missing design mass columns
**Root Cause:** The 35-column CSV format doesn't include any charging-derived columns
- Fix: Add charging columns to the 35-column format (or as an extended format)
- Columns needed per the user spec:
  - `designExplosiveMassKg` - total explosive mass ###.###
  - `designExplosiveMassPerDeck` - `EXP{[1]0.000|[2]300.000|...|[n]###.###}`
  - `designPrimerMassKg` - total primer mass #.###
  - `designPrimerMassPerDeck` - `PMR{[1]0.000|[2]0.400|...|[n]#.###}`
  - `designDetonatorCount` - total detonator count #
  - `designDetonatorCountPerDeck` - `DET{[1]0|[2]1|...|[n]#}`
  - `designLengthPerDeck` - deck lengths

### Issue 7: Inert deck designation (stemming/air/water)
Deferred - needs design discussion. Current model has `deckType: "INERT"` with product name differentiating stemming vs air vs water.

## Implementation Steps

### Step 1: Fix charging key in ChargingExportDialog.js
- Import `chargingKey` from HoleCharging.js
- Replace `visibleHoles[i].holeID` with `chargingKey(visibleHoles[i])`

### Step 2: Fix charging key in BlastHoleCSVWriter.js
- Import `chargingKey` from HoleCharging.js
- Replace all 4 instances of `chargingMap.get(hole.holeID)` with `chargingMap.get(chargingKey(hole))`

### Step 3: Add mass labels to PrintRendering.js
- Import `buildMassLabels` from canvas2DDrawing.js
- Add `displayOptions.massPerHole` and `displayOptions.massPerDeck` handling

### Step 4: Add charging-derived fields to Custom CSV export
- Added 13 charging-derived fields to `HOLE_FIELD_MAPPING` in kirra.js (type: "derived")
- Updated `CustomBlastHoleTextWriter.js` to handle derived fields via `extractChargingField()`
- `buildChargingColumns()` computes all values from `window.loadedCharging` at export time
- Inert deck classification uses product.productType and product.name (matching HoleSectionView pattern)
- 35-column format LEFT UNTOUCHED (it's a fixed format)

### How stemLength is derived (for reference)
- `stemLength` = depth from collar to top of first explosive (COUPLED/DECOUPLED) deck
- NOT based on product name — it's the total zone above any charge
- Individual stemming/air/water lengths ARE based on product type/name (same as HoleSectionView coloring)

## Files Modified
1. `src/dialog/popups/export/ChargingExportDialog.js` - Fixed chargingKey lookup
2. `src/fileIO/TextIO/BlastHoleCSVWriter.js` - Fixed chargingKey lookup in 4 charging CSV formats
3. `src/print/PrintRendering.js` - Added massPerHole and massPerDeck to vector print
4. `src/fileIO/TextIO/CustomBlastHoleTextWriter.js` - Added charging-derived field extraction
5. `src/kirra.js` - Added 13 charging-derived fields to HOLE_FIELD_MAPPING
