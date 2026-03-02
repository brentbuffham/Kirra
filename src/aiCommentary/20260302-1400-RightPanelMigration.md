# Right Side Panel Migration to Floating Panels

**Date:** 2026-03-02 14:00

## Summary

Implemented the full migration of the right-side navigation panel (`sidenavRight`) to floating dialogs and toolbar controls.

## Changes Made

### Phase 0: Icons
- Copied 8 player transport icons into `icons/` folder: player-skip-back, player-pause, player-play, player-stop, player-skip-forward, player-track-next, player-track-prev, repeat

### Phase 1: Header Data Explorer
- Replaced hamburger menu (`openNavRightBtn`) with Data Explorer icon button in header
- Removed `showTreeBtn` from Select toolbar panel
- Added hidden `showTreeBtn` checkbox so existing JS handlers still work
- New `headerDataExplorerBtn` click handler toggles the hidden checkbox

### Phase 2: Connect Distance
- Added `floatingConnectDistance` number input to the Connect toolbar panel
- Removed old `connectSlider` logarithmic range slider and related helper functions (`connectDistanceLogScale`, `updateConnectDistance`, `addConnectDistanceMarkers`)

### Phase 3: Blast Animation Dialog
- Added `blastAnimationBtn` to Surface toolbar (Blast Analytics section)
- Created `showBlastAnimationDialog()` -- FloatingDialog with icon-based transport controls
- Transport bar: Rewind, Step -1ms, Play/Pause, Stop, Step +1ms, Forward, Loop toggle
- Uses `createIconButton`-style 26x26px buttons with dark/light mode support
- Speed slider with logarithmic scaling, current time label
- Loop toggle with green border visual indicator

### Phase 4: Time Window Dialog
- Added `timeWindowBtn` to Surface toolbar (Blast Analytics section)
- Created `showTimeWindowDialog()` -- FloatingDialog with chart container, time range/offset sliders, chart mode dropdown
- Syncs with hidden original elements so existing `timeChart()` function still works

### Phase 5: KAD Text Dialog
- Modified `addKADTextTool` change handler to show/hide a FloatingDialog
- Dialog contains text input field and JS Math helper note
- Auto-closes when switching tools via `resetFloatingToolbarButtons()`
- `kadTextDialog` variable stored at module level for lifecycle management

### Phase 6: Voronoi Options Dialog
- Added `contextmenu` listener on Voronoi toggle label (`display16`)
- Added long-press (500ms) listener for mobile
- Dialog contains: Voronoi display dropdown, legend dropdown, boundary checkbox
- Changes apply immediately on change events (synced to hidden original elements)

### Phase 7: Create Radii from Holes
- Added `createRadiiFromBlastHolesBtn` to Holes toolbar panel
- FloatingDialog with Radii Steps and Radius inputs
- Confirm triggers existing `createRadiiFromBlastHoles` handler via hidden element

### Phase 8: Remove sidenavRight
- Replaced entire `sidenavRight` div with hidden container holding essential elements
- All JS-referenced elements (drawingColor, drawingText, voronoiSelect, etc.) preserved as hidden inputs
- Removed `openNavRight()` and `closeNavRight()` functions
- Removed resize handle right and resize handler
- Removed `.sidenav-Right`, `.closebtnR`, `.resize-handle-right` CSS styles
- Updated `sidenavRight` const to reference hidden container

## Files Modified
- `kirra.html` -- Structural changes (header, toolbar buttons, hidden elements)
- `src/kirra.js` -- New dialog functions, event handlers, cleanup
- `src/kirra.css` -- Removed right panel styles
- `icons/` -- 8 new player transport icons
