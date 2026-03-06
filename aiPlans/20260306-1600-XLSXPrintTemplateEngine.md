# XLSX Print Template Engine

**Date**: 2026-03-06
**Backlog Item**: #19 (Print Template Engine - Custom Print Templates)
**Approach**: User designs templates in Excel/Google Sheets, Kirra evaluates `fx:` formulas against blast data
**Status**: Phase 1 COMPLETE - Core engine, formula evaluator, dialog, reference XLSX generator built

## Concept

1. User creates an `.xlsx` file in Excel/Sheets with merged cells, borders, fonts, colors
2. Cells containing `fx:` prefixed formulas are evaluated against blast pattern data
3. Output: populated XLSX or rendered PDF matching the template layout

### Example Formula
```
fx:"Drill: " & round(sum(holeLength[i]),1) & " (m)"
```
Result: `Drill: 1927.3 (m)`

## Architecture

### New Files
```
src/print/template/
  TemplateEngine.js          - Core: load XLSX, evaluate cells, output
  TemplateFormulaEvaluator.js - Extended formula parser with aggregation + strings
  TemplateDialog.js          - UI for selecting/managing templates
  TemplateVariables.js       - Variable context builder (blast data -> formula vars)
```

### Dependencies
- **SheetJS (xlsx)** - Read/write XLSX with merged cells, styles, formatting
  - `npm install xlsx` (~1.5MB, MIT license, works in browser)
  - Reads cell values, merges, styles, column widths, row heights
  - Can write back populated XLSX

## Template Formula Language

Extends the existing `fx:` prefix from `FormulaEvaluator.js` with:

### String Operations
| Syntax | Description | Example |
|--------|-------------|---------|
| `"text"` | String literal | `"Drill: "` |
| `&` | String concatenation | `"Total: " & sum(holeLength[i])` |

### Aggregation Functions (iterate over visible holes)
| Function | Description | Example |
|----------|-------------|---------|
| `sum(field[i])` | Sum across all visible holes | `sum(holeLength[i])` |
| `count(field[i])` | Count non-null values | `count(holeID[i])` |
| `avg(field[i])` | Average | `avg(holeDiameter[i])` |
| `min(field[i])` | Minimum | `min(startZLocation[i])` |
| `max(field[i])` | Maximum | `max(startZLocation[i])` |
| `countif(field[i], condition)` | Conditional count | `countif(holeType[i], "Production")` |
| `sumif(field[i], condField[i], cond)` | Conditional sum | `sumif(holeLength[i], holeType[i], "Production")` |

### Formatting Functions
| Function | Description | Example |
|----------|-------------|---------|
| `round(value, decimals)` | Round to N decimals | `round(sum(holeLength[i]), 1)` |
| `fixed(value, decimals)` | Fixed decimal string | `fixed(avg(holeDiameter[i]), 0)` |
| `upper(text)` | Uppercase | `upper("hello")` |
| `lower(text)` | Lowercase | `lower(entityName)` |

### Scalar Variables (single values, no `[i]`)
| Variable | Source |
|----------|--------|
| `entityName` | First visible entity name |
| `blastName` | User-entered blast name |
| `date` | Current date |
| `designer` | User-entered designer name |
| `holeCount` | Total visible holes |
| `paperSize` | Selected paper size |

### Hole Field Variables (use `[i]` for iteration)
All blast hole properties from the data model:
- `holeLength[i]`, `holeDiameter[i]`, `holeAngle[i]`, `holeBearing[i]`
- `startXLocation[i]`, `startYLocation[i]`, `startZLocation[i]`
- `endXLocation[i]`, `endYLocation[i]`, `endZLocation[i]`
- `benchHeight[i]`, `subdrillAmount[i]`, `subdrillLength[i]`
- `burden[i]`, `spacing[i]`
- `holeType[i]`, `entityName[i]`, `holeID[i]`
- `measuredMass[i]`, `measuredLength[i]`
- `timingDelayMilliseconds[i]`, `holeTime[i]`
- `holeLengthCalculated[i]`

### Charging Variables (from window.loadedCharging)
- `totalMass[i]` - Total explosive mass per hole
- `deckCount[i]` - Number of decks per hole
- `powderFactor` - Total mass / volume (scalar, auto-calculated)

### Conditional / Ternary
```
fx:sum(holeLength[i]) > 1000 ? "Over 1km" : "Under 1km"
```

## Implementation Steps

### Phase 1: Core Engine
1. Install SheetJS: `npm install xlsx`
2. Create `TemplateFormulaEvaluator.js`:
   - Parse `fx:` formulas with string concat (`&`) support
   - Implement aggregation: `sum()`, `count()`, `avg()`, `min()`, `max()`
   - `[i]` notation triggers iteration over `window.allBlastHoles` (visible only)
   - `round()`, `fixed()` formatting
   - Returns string (not just number like existing evaluator)
3. Create `TemplateVariables.js`:
   - Builds variable context from blast data, charging, user input
   - Provides field accessor: `getFieldArray("holeLength")` returns [val1, val2, ...]
4. Create `TemplateEngine.js`:
   - `loadTemplate(file)` - Parse XLSX, extract cells + merges + styles
   - `evaluateTemplate(workbook, context)` - Walk cells, evaluate `fx:` formulas
   - `exportAsXLSX(workbook)` - Write populated XLSX
   - `exportAsPDF(workbook, jsPDF)` - Render cells to PDF using jsPDF

### Phase 2: UI
5. Create `TemplateDialog.js` (extends FloatingDialog):
   - Template file picker (import .xlsx)
   - Preview of evaluated template
   - Output format selector: XLSX or PDF
   - Template library (save/load from IndexedDB)

### Phase 3: Integration
6. Add to File menu: "Print from Template..."
7. Store templates in IndexedDB `templates` object store
8. Ship default templates (plan view stats, drill summary, loading report)

## XLSX Cell Evaluation Flow

```
1. Read XLSX workbook (SheetJS)
2. For each sheet:
   a. For each cell:
      - If cell value starts with "fx:" → evaluate with TemplateFormulaEvaluator
      - Otherwise → keep original value
   b. Preserve: merged regions, column widths, row heights, fonts, borders, fills
3. Output populated workbook
```

## PDF Rendering from XLSX

For PDF output, map XLSX layout to jsPDF:
- Column widths / row heights → PDF coordinates (mm)
- Merged cells → span coordinates
- Cell borders → jsPDF lines
- Font/size/bold/color → jsPDF text styles
- Text alignment → jsPDF text positioning
- Background fills → jsPDF rectangles

## Example Template (what user creates in Excel)

| A | B | C | D |
|---|---|---|---|
| **BLAST DRILL REPORT** (merged A1:D1) ||||
| Entity: | fx:entityName | Date: | fx:date |
| Holes: | fx:count(holeID[i]) | Avg Depth: | fx:round(avg(holeLength[i]),1) & "m" |
| Total Drill: | fx:round(sum(holeLength[i]),1) & "m" | Total Mass: | fx:round(sum(measuredMass[i]),1) & "kg" |
| Burden: | fx:round(avg(burden[i]),2) & "m" | Spacing: | fx:round(avg(spacing[i]),2) & "m" |
| Volume: | (from stats) | Powder Factor: | fx:round(powderFactor,2) & " kg/m3" |

## Risk Assessment
- **Low risk**: SheetJS is mature, well-tested library
- **Medium complexity**: Formula parser needs careful implementation
- **No impact on existing**: New module, no changes to existing FormulaEvaluator
- **Incremental**: Can ship Phase 1 (XLSX output only) before PDF rendering
