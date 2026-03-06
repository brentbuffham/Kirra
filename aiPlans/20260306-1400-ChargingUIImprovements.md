# Charging System UI Improvements (Backlog #4)
## Date: 2026-03-06

### Two sub-tasks:

## 1. Right-click Context Menu on Deck (HoleSectionView)

**Goal:** Right-clicking a deck/primer in the section view canvas shows a context menu with quick actions.

**Changes:**
- **HoleSectionView.js**: Add `contextmenu` event listener in `_bindEvents()`. Detect which deck/primer/content was right-clicked using the same hit-detection as `_handleMouseDown()`. Fire a new callback `onContextMenu(type, item, index, screenX, screenY)`.
- **DeckBuilderDialog.js**: Wire `onContextMenu` callback. Show a small floating popup (using FloatingDialog or a simple DOM menu) with actions:
  - **Deck**: Edit, Link top to deck above, Link base to deck below
  - **Primer**: Edit, Remove
  - **Content**: Edit, Remove
- "Link top to deck above" sets `deck.topDepthFormula = "fx:deckBase[n-1]"` (the base of the deck above)
- "Link base to deck below" sets `deck.baseDepthFormula = "fx:deckTop[n+1]"` (the top of the deck below)

## 2. Formula Text Field Expansion

**Goal:** Formula input fields (`fx:...`) should be wider/expandable so long formulas are visible.

**Changes:**
- **FloatingDialog.js**: Add support for `field.type = "formula"` which creates a `<textarea>` element with 2 rows, monospace font, auto-expanding on input. Also update `getFormData()` to query `textarea` elements.
- **DeckBuilderDialog.js (editDeck)**: Change topDepth and baseDepth fields from `type: "text"` to `type: "formula"`.
- **DeckBuilderDialog.js (editPrimer)**: Change depthFromCollar field from `type: "text"` to `type: "formula"`.
