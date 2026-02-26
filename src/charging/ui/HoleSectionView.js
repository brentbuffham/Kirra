/**
 * @fileoverview HoleSectionView - Canvas 2D cross-section renderer for hole charging
 *
 * Draws a vertical cross-section showing decks, primers, and depth labels.
 * Visual design based on BlastholeChargingExample.png:
 *   - Coupled decks fill hole diameter
 *   - Decoupled decks drawn narrower (showing air gap to hole wall)
 *   - Spacer decks shown as distinct blocks with length limits
 *   - Primers shown with booster (red) and detonator (blue) markers
 *   - Short decks get side popout labels with connector lines
 *   - Depth labels on right side, deck attributes beside narrow decks
 *
 * Supports click-to-select decks and drag-to-resize deck boundaries.
 * Responds to light/dark mode via window.darkModeEnabled.
 */

import { DECK_TYPES, DECK_COLORS, NON_EXPLOSIVE_TYPES, BULK_EXPLOSIVE_TYPES, DECOUPLED_CONTENT_CATEGORIES } from "../ChargingConstants.js";

/**
 * Get the fill color for a deck based on its type and product
 * @param {Object} deck - Deck object
 * @returns {string} Hex color
 */
function getDeckColor(deck) {
    if (!deck) return "#CCCCCC";

    // Use product color if available
    if (deck.product && deck.product.colorHex) {
        return deck.product.colorHex;
    }

    switch (deck.deckType) {
        case DECK_TYPES.INERT:
            if (deck.product) {
                var pName = (deck.product.name || "").toLowerCase();
                var pType = deck.product.productType || "";
                if (pType === NON_EXPLOSIVE_TYPES.WATER || pName.indexOf("water") !== -1) return DECK_COLORS.INERT_WATER;
                if (pType === NON_EXPLOSIVE_TYPES.STEMMING || pName.indexOf("stemm") !== -1) return DECK_COLORS.INERT_STEMMING;
                if (pType === NON_EXPLOSIVE_TYPES.STEM_GEL || pName.indexOf("gel") !== -1) return DECK_COLORS.INERT_STEM_GEL;
                if (pType === NON_EXPLOSIVE_TYPES.DRILL_CUTTINGS || pName.indexOf("drill") !== -1) return DECK_COLORS.INERT_DRILL_CUTTINGS;
            }
            return DECK_COLORS.INERT_AIR;

        case DECK_TYPES.COUPLED:
            if (deck.product) {
                var bType = deck.product.productType || "";
                if (bType === BULK_EXPLOSIVE_TYPES.ANFO || (deck.product.name || "").toUpperCase().indexOf("ANFO") !== -1) return DECK_COLORS.COUPLED_ANFO;
                if (bType === BULK_EXPLOSIVE_TYPES.EMULSION) return DECK_COLORS.COUPLED_EMULSION;
            }
            return DECK_COLORS.COUPLED;

        case DECK_TYPES.DECOUPLED:
            return DECK_COLORS.DECOUPLED;

        case DECK_TYPES.SPACER:
            return DECK_COLORS.SPACER;

        default:
            return "#CCCCCC";
    }
}

/**
 * Get contrasting text color for a background
 * @param {string} hexColor - Background hex color
 * @returns {string} "#000000" or "#FFFFFF"
 */
function getContrastColor(hexColor) {
    var hex = hexColor.replace("#", "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

/**
 * Get current theme colors based on dark/light mode
 */
function getThemeColors() {
    var dark = typeof window.darkModeEnabled !== "undefined" ? window.darkModeEnabled : false;
    return {
        background: dark ? "#2a2a2a" : "#f5f5f5",
        holeWall: dark ? "#888888" : "#555555",
        holeWallFill: dark ? "#3a3a3a" : "#e8e8e8",
        text: dark ? "#dddddd" : "#333333",
        textSecondary: dark ? "#999999" : "#777777",
        depthLabel: dark ? "#bbbbbb" : "#444444",
        selectionOutline: "#00AAFF",
        boundaryHandle: dark ? "#aaaaaa" : "#666666",
        collarToeLabel: dark ? "#cccccc" : "#333333",
        gridLine: dark ? "#444444" : "#cccccc",
        popoutLine: dark ? "#888888" : "#999999",
        popoutBg: dark ? "rgba(40,40,40,0.85)" : "rgba(255,255,255,0.85)",
        popoutBorder: dark ? "#555555" : "#bbbbbb"
    };
}

/**
 * Get the unit length (in metres) for a DECOUPLED deck's product, or null if unknown.
 * Used for staccato snapping: deck length must be a multiple of this value.
 * @param {Object} deck - Deck with product info
 * @returns {number|null} Unit length in metres
 */
function getDecoupledUnitLength(deck) {
    if (!deck || deck.deckType !== DECK_TYPES.DECOUPLED) return null;
    if (!deck.product) return null;

    var lengthMm = null;
    if (deck.product.lengthMm) {
        lengthMm = deck.product.lengthMm;
    } else if (window.loadedProducts) {
        if (deck.product.productID) {
            window.loadedProducts.forEach(function (p) {
                if (p.productID === deck.product.productID && p.lengthMm) lengthMm = p.lengthMm;
            });
        }
        if (!lengthMm && deck.product.name) {
            window.loadedProducts.forEach(function (p) {
                if (p.name === deck.product.name && p.lengthMm) lengthMm = p.lengthMm;
            });
        }
    }
    if (lengthMm) return lengthMm / 1000;
    return null;
}

/**
 * Get the max length (in metres) for a spacer product, or null if unconstrained
 * @param {Object} deck - Deck with product info
 * @returns {number|null} Max deck length in metres
 */
function getSpacerMaxLength(deck) {
    if (!deck || deck.deckType !== DECK_TYPES.SPACER) return null;
    if (!deck.product) return null;

    // Check for lengthMm stored on the product snapshot or in contains
    var lengthMm = null;

    // Look up the full product from loadedProducts for lengthMm
    if (window.loadedProducts && deck.product.productID) {
        window.loadedProducts.forEach(function (p) {
            if (p.productID === deck.product.productID && p.lengthMm) {
                lengthMm = p.lengthMm;
            }
        });
    }
    // Also check product name fallback
    if (!lengthMm && window.loadedProducts && deck.product.name) {
        window.loadedProducts.forEach(function (p) {
            if (p.name === deck.product.name && p.lengthMm) {
                lengthMm = p.lengthMm;
            }
        });
    }

    if (lengthMm) return lengthMm / 1000; // convert mm to m
    return null;
}

export class HoleSectionView {
    /**
     * @param {Object} options
     * @param {HTMLCanvasElement} options.canvas - Canvas element to draw on
     * @param {number} [options.padding] - Padding around the drawing area
     * @param {number} [options.holeDiameterMm] - Hole diameter in mm (for mass calc)
     * @param {Function} [options.onDeckSelect] - Callback when a deck is clicked: fn(deck, index)
     * @param {Function} [options.onDeckResize] - Callback when a deck boundary is dragged: fn(deckIndex, newTopDepth, newBaseDepth)
     * @param {Function} [options.onPrimerSelect] - Callback when a primer is clicked: fn(primer, index)
     * @param {number} [options.fontSizeOffset] - Pixel offset added to all base font sizes (default 0)
     */
    constructor(options) {
        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext("2d");
        this.padding = options.padding || 30;
        this.holeDiameterMm = options.holeDiameterMm || 115;
        this.onDeckSelect = options.onDeckSelect || null;
        this.onDeckResize = options.onDeckResize || null;
        this.onPrimerSelect = options.onPrimerSelect || null;
        this.onContentSelect = options.onContentSelect || null;
        this._fontSizeOffset = options.fontSizeOffset || 0;

        this.holeCharging = null;
        this.selectedDeckIndex = -1;
        this.selectedPrimerIndex = -1;
        this._selectedContentIndex = -1;
        this._selectedContentDeckIndex = -1;

        // Drag state
        this._dragging = false;
        this._dragBoundaryIndex = -1;
        this._dragStartY = 0;

        // Layout cache
        this._holeRect = { x: 0, y: 0, w: 0, h: 0 };
        this._depthScale = 1;
        this._minDepth = 0;
        this._maxDepth = 10;
        this._fontScale = 2;
        this._dpr = window.devicePixelRatio || 1;

        // Zoom state
        this._zoomLevel = 1.0;
        this._containerH = 0; // unzoomed container CSS height

        // Decoupled inset ratio (fraction of hole width to inset on each side)
        this._decoupledInset = 0.2;

        // ResizeObserver for sharp rendering
        this._resizeObserver = null;
        this._setupScrollWrapper();
        this._setupZoomControls();
        this._setupResizeObserver();

        this._bindEvents();
    }

    /**
     * Wrap the canvas in a scrollable container and add zoom button overlay.
     * Structure: parent > _scrollWrapper > canvas
     *            parent > _zoomOverlay (absolute positioned)
     */
    _setupScrollWrapper() {
        var parent = this.canvas.parentElement;
        if (!parent) return;

        // Create scrollable wrapper
        this._scrollWrapper = document.createElement("div");
        this._scrollWrapper.style.cssText = "flex:1;overflow-y:auto;overflow-x:hidden;position:relative;min-height:0;";

        // Move canvas into wrapper
        parent.insertBefore(this._scrollWrapper, this.canvas);
        this._scrollWrapper.appendChild(this.canvas);

        // Canvas now fills the wrapper width, height set by zoom
        this.canvas.style.cssText = "width:100%;display:block;";
    }

    /**
     * Create zoom in/out buttons overlaid on the scroll wrapper
     */
    _setupZoomControls() {
        var self = this;
        if (!this._scrollWrapper) return;
        var parent = this._scrollWrapper.parentElement;
        if (!parent) return;

        // Ensure parent is positioned for absolute children
        var parentPos = window.getComputedStyle(parent).position;
        if (parentPos === "static") parent.style.position = "relative";

        var overlay = document.createElement("div");
        overlay.style.cssText = "position:absolute;top:40px;right:10px;display:flex;flex-direction:column;gap:2px;z-index:10;";

        var zoomIn = document.createElement("img");
        zoomIn.src = "icons/zoom-in.png";
        zoomIn.title = "Zoom In";
        zoomIn.style.cssText = "width:24px;height:24px;cursor:pointer;opacity:0.7;background:rgba(255,255,255,0.7);border-radius:4px;padding:2px;";
        zoomIn.addEventListener("mouseenter", function () { zoomIn.style.opacity = "1"; });
        zoomIn.addEventListener("mouseleave", function () { zoomIn.style.opacity = "0.7"; });
        zoomIn.addEventListener("click", function (e) { e.stopPropagation(); self.zoomIn(); });

        var zoomOut = document.createElement("img");
        zoomOut.src = "icons/zoom-out.png";
        zoomOut.title = "Zoom Out";
        zoomOut.style.cssText = "width:24px;height:24px;cursor:pointer;opacity:0.7;background:rgba(255,255,255,0.7);border-radius:4px;padding:2px;";
        zoomOut.addEventListener("mouseenter", function () { zoomOut.style.opacity = "1"; });
        zoomOut.addEventListener("mouseleave", function () { zoomOut.style.opacity = "0.7"; });
        zoomOut.addEventListener("click", function (e) { e.stopPropagation(); self.zoomOut(); });

        overlay.appendChild(zoomIn);
        overlay.appendChild(zoomOut);
        parent.appendChild(overlay);
        this._zoomOverlay = overlay;
    }

    /** Zoom in — increase diagram height */
    zoomIn() {
        this._zoomLevel = Math.min(this._zoomLevel + 0.5, 6.0);
        this._applyZoom();
    }

    /** Zoom out — decrease diagram height */
    zoomOut() {
        this._zoomLevel = Math.max(this._zoomLevel - 0.5, 1.0);
        this._applyZoom();
    }

    /** Apply current zoom: resize canvas and redraw */
    _applyZoom() {
        if (!this._scrollWrapper || !this._containerH) return;
        var zoomedH = this._containerH * this._zoomLevel;
        this.canvas.style.height = zoomedH + "px";
        this._syncCanvasSize(this._scrollWrapper.clientWidth, zoomedH);
    }

    /**
     * Setup ResizeObserver to keep canvas sharp on container resize
     */
    _setupResizeObserver() {
        var self = this;
        var target = this._scrollWrapper || (this.canvas && this.canvas.parentElement);
        if (!target) return;
        if (typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(function (entries) {
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    var rect = entry.contentRect;
                    if (rect.width > 0 && rect.height > 0) {
                        // Store unzoomed container height
                        self._containerH = rect.height;
                        var zoomedH = rect.height * self._zoomLevel;
                        self.canvas.style.height = zoomedH + "px";
                        self._syncCanvasSize(rect.width, zoomedH);
                    }
                }
            });
            requestAnimationFrame(function () {
                if (target) {
                    self._resizeObserver.observe(target);
                }
            });
        }
    }

    /**
     * Sync canvas pixel buffer to CSS display size for sharp rendering
     */
    _syncCanvasSize(cssW, cssH) {
        this._dpr = window.devicePixelRatio || 1;
        var pixelW = Math.round(cssW * this._dpr);
        var pixelH = Math.round(cssH * this._dpr);

        if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
            this.canvas.width = pixelW;
            this.canvas.height = pixelH;
            this.draw();
        }
    }

    /**
     * Set the HoleCharging data and redraw
     * @param {Object} holeCharging - HoleCharging instance
     */
    setData(holeCharging) {
        this.holeCharging = holeCharging;
        this.selectedDeckIndex = -1;
        this.selectedPrimerIndex = -1;
        this._selectedContentIndex = -1;
        this._selectedContentDeckIndex = -1;
        this.draw();
    }

    /**
     * Build a CSS font string scaled by _fontScale but NOT by zoom level.
     * Font sizes remain constant regardless of zoom.
     */
    _scaledFont(basePx, weight) {
        var sz = Math.round((basePx + this._fontSizeOffset) * this._fontScale);
        return (weight ? weight + " " : "") + sz + "px sans-serif";
    }

    /**
     * Main draw method - renders the full section view
     */
    draw() {
        var ctx = this.ctx;
        var w = this.canvas.width;
        var h = this.canvas.height;
        var dpr = this._dpr;
        var theme = getThemeColors();

        // Scale context for DPI
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Work in CSS pixels
        var cssW = w / dpr;
        var cssH = h / dpr;

        // Clear with theme background
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, cssW, cssH);

        if (!this.holeCharging || this.holeCharging.decks.length === 0) {
            ctx.fillStyle = theme.textSecondary;
            ctx.font = this._scaledFont(13);
            ctx.textAlign = "center";
            ctx.fillText("No charging data - drag products from palette", cssW / 2, cssH / 2);
            return;
        }

        // Font scale: at 350px, scale=1.0; smaller canvases get proportionally larger text
        this._fontScale = Math.max(0.8, Math.min(1.5, cssW / 350));

        var hc = this.holeCharging;
        var pad = this.padding;

        // Calculate depth range
        this._minDepth = 0;
        this._maxDepth = Math.abs(hc.holeLength) || 10;
        for (var i = 0; i < hc.decks.length; i++) {
            var d = hc.decks[i];
            if (d.topDepth < this._minDepth) this._minDepth = d.topDepth;
            if (d.baseDepth > this._maxDepth) this._maxDepth = d.baseDepth;
        }

        var depthRange = this._maxDepth - this._minDepth;
        if (depthRange <= 0) depthRange = 1;

        // Layout: narrower hole column (40% of width), side labels on left & right
        var rightLabelWidth = 50;
        var leftLabelWidth = 90;
        var collarLabelH = 22;
        var toeLabelH = 18;

        var holeX = pad + leftLabelWidth;
        var holeY = pad + collarLabelH;
        var holeW = cssW - pad * 2 - rightLabelWidth - leftLabelWidth;
        var holeH = cssH - pad * 2 - collarLabelH - toeLabelH;

        // Clamp hole width: narrow enough for side labels but readable
        holeW = Math.max(holeW, 50);
        holeW = Math.min(holeW, 180);
        holeH = Math.max(holeH, 80);

        // Re-center hole column if we clamped it
        holeX = pad + leftLabelWidth;

        this._holeRect = { x: holeX, y: holeY, w: holeW, h: holeH };
        this._depthScale = holeH / depthRange;

        // Draw hole wall background
        ctx.fillStyle = theme.holeWallFill;
        ctx.fillRect(holeX, holeY, holeW, holeH);

        // Draw decks
        for (var di = 0; di < hc.decks.length; di++) {
            this._drawDeck(hc.decks[di], di, theme, cssW);
        }

        // Draw hole wall outline (on top of decks)
        ctx.strokeStyle = theme.holeWall;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(holeX, holeY, holeW, holeH);

        // Draw deck boundaries (draggable handles)
        this._drawBoundaries(hc.decks, theme);

        // Draw primers
        for (var pi = 0; pi < hc.primers.length; pi++) {
            this._drawPrimer(hc.primers[pi], pi, theme, cssW);
        }

        // Draw collar label
        ctx.fillStyle = theme.collarToeLabel;
        ctx.font = this._scaledFont(11, "bold");
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("COLLAR  (0.0m)", holeX + holeW / 2, holeY - 4);

        // Draw toe label
        ctx.textBaseline = "top";
        ctx.fillText("TOE  (" + this._maxDepth.toFixed(1) + "m)", holeX + holeW / 2, holeY + holeH + 4);

        // Draw depth scale tick marks
        this._drawDepthScale(theme);
    }

    /**
     * Convert depth to canvas Y coordinate (CSS pixels)
     */
    depthToY(depth) {
        return this._holeRect.y + (depth - this._minDepth) * this._depthScale;
    }

    /**
     * Convert canvas Y coordinate (CSS pixels) to depth
     */
    yToDepth(y) {
        return this._minDepth + (y - this._holeRect.y) / this._depthScale;
    }

    /**
     * Draw a single deck with visual treatment based on type
     */
    _drawDeck(deck, index, theme, cssW) {
        var ctx = this.ctx;
        var hr = this._holeRect;

        var y1 = this.depthToY(deck.topDepth);
        var y2 = this.depthToY(deck.baseDepth);
        var deckH = y2 - y1;

        if (deckH < 1) deckH = 1;

        var fillColor = getDeckColor(deck);

        // Determine draw rect based on deck type
        var drawX = hr.x;
        var drawW = hr.w;

        if (deck.deckType === DECK_TYPES.DECOUPLED) {
            // Decoupled: draw narrower, showing surrounding inert material
            var inset = hr.w * this._decoupledInset;
            drawX = hr.x + inset;
            drawW = hr.w - inset * 2;

            // Find adjacent INERT deck color for background (air, water, etc.)
            var inertBgColor = DECK_COLORS.INERT_AIR;
            if (this.holeCharging && this.holeCharging.decks) {
                var decks = this.holeCharging.decks;
                // Check deck above and below for INERT material
                if (index > 0 && decks[index - 1].deckType === DECK_TYPES.INERT) {
                    inertBgColor = getDeckColor(decks[index - 1]);
                } else if (index < decks.length - 1 && decks[index + 1].deckType === DECK_TYPES.INERT) {
                    inertBgColor = getDeckColor(decks[index + 1]);
                }
            }

            // Draw inert material background at full hole width
            ctx.fillStyle = inertBgColor;
            ctx.fillRect(hr.x, y1, hr.w, deckH);
        }

        if (deck.deckType === DECK_TYPES.SPACER) {
            // Spacer: draw with subtle horizontal stripe pattern
            ctx.fillStyle = fillColor;
            ctx.fillRect(drawX, y1, drawW, deckH);
            ctx.strokeStyle = "rgba(0,0,0,0.15)";
            ctx.lineWidth = 1;
            var stripeGap = 4;
            for (var sy = y1 + stripeGap; sy < y2; sy += stripeGap) {
                ctx.beginPath();
                ctx.moveTo(drawX, sy);
                ctx.lineTo(drawX + drawW, sy);
                ctx.stroke();
            }
        } else {
            // Fill deck rectangle
            ctx.fillStyle = fillColor;
            ctx.fillRect(drawX, y1, drawW, deckH);
        }

        // Draw embedded content items (Physical packages inside INERT decks)
        if (deck.contains && deck.contains.length > 0) {
            for (var ci = 0; ci < deck.contains.length; ci++) {
                var content = deck.contains[ci];
                if (content.contentCategory !== DECOUPLED_CONTENT_CATEGORIES.PHYSICAL) continue;
                if (!content.length || !content.diameter) continue;

                var cTop = this.depthToY(content.lengthFromCollar);
                var cBase = this.depthToY(content.lengthFromCollar + content.length);
                var cH = cBase - cTop;
                if (cH < 1) cH = 1;

                // Calculate inset based on content diameter vs hole diameter
                var diaRatio = content.diameter / (this.holeDiameterMm / 1000);
                var contentW = hr.w * Math.min(diaRatio, 0.9);
                var contentX = hr.x + (hr.w - contentW) / 2;

                // Look up product color
                var contentColor = "#FF6600";
                if (content.productID && window.loadedProducts) {
                    var cProd = window.loadedProducts.get(content.productID);
                    if (cProd && cProd.colorHex) contentColor = cProd.colorHex;
                }

                // Fill content rectangle
                ctx.fillStyle = contentColor;
                ctx.globalAlpha = 0.85;
                ctx.fillRect(contentX, cTop, contentW, cH);
                ctx.globalAlpha = 1.0;

                // Border
                ctx.strokeStyle = "rgba(0,0,0,0.5)";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(contentX, cTop, contentW, cH);

                // Label if tall enough
                if (cH > 16) {
                    ctx.fillStyle = getContrastColor(contentColor);
                    ctx.font = this._scaledFont(8);
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    var cLabel = content.productName || "PKG";
                    if (cLabel.length > 12) cLabel = cLabel.substring(0, 10) + "..";
                    ctx.fillText(cLabel, contentX + contentW / 2, cTop + cH / 2);
                }

                // Selection highlight for embedded content
                if (index === this._selectedContentDeckIndex && ci === this._selectedContentIndex) {
                    ctx.strokeStyle = theme.selectionOutline;
                    ctx.lineWidth = 2.5;
                    ctx.strokeRect(contentX + 1, cTop + 1, contentW - 2, cH - 2);
                }
            }
        }

        // Selection highlight
        if (index === this.selectedDeckIndex) {
            ctx.strokeStyle = theme.selectionOutline;
            ctx.lineWidth = 3;
            ctx.strokeRect(drawX + 1, y1 + 1, drawW - 2, deckH - 2);
        }

        // Deck border
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(drawX, y1, drawW, deckH);

        // Scaling flag badge: "F" for fixed-length, "M" for fixed-mass, "VR" for variable
        if (deck.isFixedLength || deck.isFixedMass || deck.isVariable) {
            var badgeLabel = deck.isFixedLength ? "F" : deck.isFixedMass ? "M" : "VR";
            var badgeW = deck.isVariable ? 18 : 14;
            var badgeH = 12;
            var badgeX = drawX + drawW - badgeW - 2;
            var badgeY = y1 + 2;
            ctx.fillStyle = deck.isFixedLength ? "#2266CC" : deck.isFixedMass ? "#CC6622" : "#22AA44";
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
            ctx.fillStyle = "#FFFFFF";
            ctx.font = this._scaledFont(7, "bold");
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(badgeLabel, badgeX + badgeW / 2, badgeY + badgeH / 2);
        }

        // Calculate mass for this deck
        var mass = deck.calculateMass ? deck.calculateMass(this.holeDiameterMm) : 0;
        var density = deck.effectiveDensity || (deck.product ? deck.product.density || 0 : 0);
        var deckLen = deck.length;

        // Decide label placement: inside (tall decks) or side popout (short decks)
        var isShort = deckH < 28;
        var textColor = getContrastColor(fillColor);
        var centerX = drawX + drawW / 2;
        var centerY = y1 + deckH / 2;

        // Build deck index label: TYPE[n] where n is 1-based position
        var deckIndexLabel = deck.deckType + "[" + (index + 1) + "]";

        if (!isShort) {
            // Draw text inside the deck
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            if (deckH > 50) {
                // Full detail: type[idx], name, density/length/mass
                ctx.font = this._scaledFont(10, "bold");
                ctx.fillStyle = textColor;
                ctx.fillText(deckIndexLabel, centerX, centerY - 16);

                ctx.font = this._scaledFont(10);
                var productName = deck.product ? deck.product.name : "Empty";
                ctx.fillText(productName, centerX, centerY - 2);

                ctx.font = this._scaledFont(9);
                ctx.fillText(density.toFixed(2) + " g/cc  " + deckLen.toFixed(1) + "m  " + mass.toFixed(1) + "kg", centerX, centerY + 12);
            } else if (deckH > 35) {
                // Name + density/length/mass
                ctx.font = this._scaledFont(10, "bold");
                ctx.fillStyle = textColor;
                var label = deck.product ? deck.product.name : deckIndexLabel;
                ctx.fillText(label, centerX, centerY - 6);

                ctx.font = this._scaledFont(9);
                ctx.fillText(density.toFixed(2) + "g/cc  " + deckLen.toFixed(1) + "m  " + mass.toFixed(1) + "kg", centerX, centerY + 8);
            } else {
                // Just name with index
                ctx.font = this._scaledFont(9, "bold");
                ctx.fillStyle = textColor;
                ctx.fillText(deck.product ? deck.product.name : deckIndexLabel, centerX, centerY);
            }
        }

        // Side popout label for short decks OR all decks get right-side depth
        if (isShort) {
            this._drawSidePopout(deck, index, y1, y2, deckH, theme, cssW, density, deckLen, mass);
        }

        // Depth labels on right side
        var labelX = hr.x + hr.w + 5;
        ctx.fillStyle = theme.depthLabel;
        ctx.font = this._scaledFont(9);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(deck.topDepth.toFixed(1) + "m", labelX, y1);
        if (index === this.holeCharging.decks.length - 1 || deckH > 16) {
            ctx.fillText(deck.baseDepth.toFixed(1) + "m", labelX, y2);
        }
    }

    /**
     * Draw a side popout label for short decks (spacers, short charges)
     */
    _drawSidePopout(deck, index, y1, y2, deckH, theme, cssW, density, deckLen, mass) {
        var ctx = this.ctx;
        var hr = this._holeRect;
        var centerY = y1 + deckH / 2;

        // Popout on the left side
        var popX = hr.x - 8;
        var popW = hr.x - this.padding - 12;
        if (popW < 40) return; // Not enough space

        // Connector line from deck to popout
        ctx.strokeStyle = theme.popoutLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hr.x, centerY);
        ctx.lineTo(popX - popW, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Popout text with deck index
        var deckIdxLabel = deck.deckType + "[" + (index + 1) + "]";
        var productName = deck.product ? deck.product.name : deckIdxLabel;
        var infoStr = productName;

        ctx.fillStyle = theme.text;
        ctx.font = this._scaledFont(9);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        // Line 1: name
        ctx.fillText(infoStr, popX - 2, centerY - 7);
        // Line 2: density, length, mass
        ctx.font = this._scaledFont(8);
        ctx.fillStyle = theme.textSecondary;
        ctx.fillText(density.toFixed(2) + "g/cc " + deckLen.toFixed(2) + "m " + mass.toFixed(1) + "kg", popX - 2, centerY + 5);
    }

    /**
     * Draw depth scale ticks on the right side
     */
    _drawDepthScale(theme) {
        var ctx = this.ctx;
        var hr = this._holeRect;
        var depthRange = this._maxDepth - this._minDepth;

        var rawInterval = depthRange / 8;
        var interval;
        if (rawInterval <= 0.5) interval = 0.5;
        else if (rawInterval <= 1) interval = 1;
        else if (rawInterval <= 2) interval = 2;
        else if (rawInterval <= 5) interval = 5;
        else interval = 10;

        ctx.strokeStyle = theme.gridLine;
        ctx.lineWidth = 0.5;

        var startTick = Math.ceil(this._minDepth / interval) * interval;
        for (var depth = startTick; depth < this._maxDepth; depth += interval) {
            var y = this.depthToY(depth);
            ctx.beginPath();
            ctx.moveTo(hr.x + hr.w, y);
            ctx.lineTo(hr.x + hr.w + 3, y);
            ctx.stroke();
        }
    }

    /**
     * Draw draggable boundary handles between decks
     */
    _drawBoundaries(decks, theme) {
        var ctx = this.ctx;
        var hr = this._holeRect;

        for (var i = 0; i < decks.length - 1; i++) {
            var y = this.depthToY(decks[i].baseDepth);
            var isActive = this._dragBoundaryIndex === i;

            ctx.strokeStyle = isActive ? theme.selectionOutline : "rgba(0,0,0,0.4)";
            ctx.lineWidth = isActive ? 2 : 1;
            ctx.setLineDash(isActive ? [] : [3, 3]);
            ctx.beginPath();
            ctx.moveTo(hr.x, y);
            ctx.lineTo(hr.x + hr.w, y);
            ctx.stroke();
            ctx.setLineDash([]);

            var handleColor = isActive ? theme.selectionOutline : theme.boundaryHandle;
            ctx.fillStyle = handleColor;
            ctx.beginPath();
            ctx.arc(hr.x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(hr.x + hr.w, y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * Draw a primer marker (booster + detonator)
     */
    _drawPrimer(primer, index, theme, cssW) {
        var ctx = this.ctx;
        var hr = this._holeRect;
        var y = this.depthToY(primer.lengthFromCollar);

        var isSelected = index === this.selectedPrimerIndex;
        var markerW = 18;
        var markerH = 10;
        var centerX = hr.x + hr.w / 2;

        // Booster rectangle (red)
        ctx.fillStyle = DECK_COLORS.BOOSTER;
        ctx.fillRect(centerX - markerW / 2, y - markerH / 2, markerW, markerH);

        // Detonator drawn inside the booster (small blue rectangle centered within)
        var detW = 6;
        var detH = 6;
        var detQty = primer.detonator && primer.detonator.quantity > 1 ? primer.detonator.quantity : 1;
        ctx.fillStyle = DECK_COLORS.DETONATOR;
        if (detQty === 1) {
            ctx.fillRect(centerX - detW / 2, y - detH / 2, detW, detH);
        } else {
            // Multiple detonators: draw side by side inside booster
            var totalDetW = detQty * detW + (detQty - 1) * 2;
            var startX = centerX - totalDetW / 2;
            for (var dq = 0; dq < detQty; dq++) {
                ctx.fillRect(startX + dq * (detW + 2), y - detH / 2, detW, detH);
            }
        }

        // Outline
        ctx.strokeStyle = isSelected ? theme.selectionOutline : "#000000";
        ctx.lineWidth = isSelected ? 2.5 : 1;
        ctx.strokeRect(centerX - markerW / 2, y - markerH / 2, markerW, markerH);

        // Label on left side with connector
        var labelParts = [];
        if (primer.booster && primer.booster.productName) {
            var boosterLabel = primer.booster.productName;
            if (primer.booster.quantity > 1) {
                boosterLabel = primer.booster.quantity + "x " + boosterLabel;
            }
            labelParts.push(boosterLabel);
        }
        if (primer.detonator && primer.detonator.productName) {
            var detLabel = primer.detonator.productName;
            if (primer.detonator.quantity > 1) {
                detLabel = primer.detonator.quantity + "x " + detLabel;
            }
            labelParts.push(detLabel);
        }
        if (labelParts.length === 0) {
            labelParts.push("Primer");
        }

        // Connector line to left
        ctx.strokeStyle = theme.popoutLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(centerX - markerW / 2, y);
        ctx.lineTo(hr.x - 8, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = theme.text;
        ctx.font = this._scaledFont(8);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        var labelStr = labelParts.join(" + ");
        if (labelStr.length > 28) labelStr = labelStr.substring(0, 25) + "...";
        ctx.fillText(labelStr, hr.x - 10, y);

        // Depth on the right side
        var rightX = hr.x + hr.w + 5;
        ctx.textAlign = "left";
        ctx.fillStyle = theme.depthLabel;
        ctx.fillText("@ " + primer.lengthFromCollar.toFixed(1) + "m", rightX, y);

        // Downhole trace line from primer to collar
        if (primer.detonator && primer.detonator.initiatorType) {
            var initType = primer.detonator.initiatorType;
            var lineColor = null;
            var lineW = 1.5;
            var dashPattern = [4, 3];
            if (initType === "DetonatingCord") {
                lineColor = DECK_COLORS.DETONATING_CORD;
                lineW = 1.5;
            } else if (initType === "ShockTube") {
                lineColor = DECK_COLORS.SHOCK_TUBE_LINE;
                lineW = 1;
                dashPattern = [3, 3];
            } else if (initType === "Electronic") {
                lineColor = DECK_COLORS.ELECTRONIC_LINE;
                lineW = 1;
                dashPattern = [2, 4];
            }
            if (lineColor) {
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = lineW;
                ctx.setLineDash(dashPattern);
                ctx.beginPath();
                ctx.moveTo(centerX + markerW / 2 + 2, y);
                ctx.lineTo(centerX + markerW / 2 + 2, hr.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }

    /**
     * Bind mouse/touch events for interaction
     */
    _bindEvents() {
        var self = this;
        var canvas = this.canvas;

        canvas.addEventListener("mousedown", function (e) {
            self._handleMouseDown(e);
        });
        canvas.addEventListener("mousemove", function (e) {
            self._handleMouseMove(e);
        });
        canvas.addEventListener("mouseup", function (e) {
            self._handleMouseUp(e);
        });
        canvas.addEventListener("mouseleave", function (e) {
            self._handleMouseUp(e);
        });
    }

    _getCanvasCoords(e) {
        var rect = this.canvas.getBoundingClientRect();
        // Return CSS pixel coords (not canvas pixel coords)
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    _handleMouseDown(e) {
        if (!this.holeCharging) return;
        var pos = this._getCanvasCoords(e);
        var hr = this._holeRect;

        // Check for boundary drag (within 6px of a boundary)
        var decks = this.holeCharging.decks;
        for (var i = 0; i < decks.length - 1; i++) {
            var boundaryY = this.depthToY(decks[i].baseDepth);
            if (Math.abs(pos.y - boundaryY) < 6 && pos.x >= hr.x - 10 && pos.x <= hr.x + hr.w + 10) {
                this._dragging = true;
                this._dragBoundaryIndex = i;
                this._dragStartY = pos.y;
                this.canvas.style.cursor = "ns-resize";
                return;
            }
        }

        // Check for primer click
        var primers = this.holeCharging.primers;
        for (var pi = 0; pi < primers.length; pi++) {
            var primerY = this.depthToY(primers[pi].lengthFromCollar);
            if (Math.abs(pos.y - primerY) < 10 && pos.x >= hr.x && pos.x <= hr.x + hr.w) {
                this.selectedPrimerIndex = pi;
                this.selectedDeckIndex = -1;
                this._selectedContentIndex = -1;
                this._selectedContentDeckIndex = -1;
                this.draw();
                if (this.onPrimerSelect) {
                    this.onPrimerSelect(primers[pi], pi);
                }
                return;
            }
        }

        // Check for embedded content click
        for (var edi = 0; edi < decks.length; edi++) {
            var eDeck = decks[edi];
            if (!eDeck.contains) continue;
            for (var eci = 0; eci < eDeck.contains.length; eci++) {
                var eContent = eDeck.contains[eci];
                if (eContent.contentCategory !== DECOUPLED_CONTENT_CATEGORIES.PHYSICAL) continue;
                if (!eContent.length || !eContent.diameter) continue;

                var ecTop = this.depthToY(eContent.lengthFromCollar);
                var ecBase = this.depthToY(eContent.lengthFromCollar + eContent.length);
                var ecDiaRatio = eContent.diameter / (this.holeDiameterMm / 1000);
                var ecW = hr.w * Math.min(ecDiaRatio, 0.9);
                var ecX = hr.x + (hr.w - ecW) / 2;

                if (pos.y >= ecTop && pos.y <= ecBase && pos.x >= ecX && pos.x <= ecX + ecW) {
                    this._selectedContentDeckIndex = edi;
                    this._selectedContentIndex = eci;
                    this.selectedDeckIndex = -1;
                    this.selectedPrimerIndex = -1;
                    this.draw();
                    if (this.onContentSelect) {
                        this.onContentSelect(eContent, edi, eci);
                    }
                    return;
                }
            }
        }

        // Check for deck click
        for (var di = 0; di < decks.length; di++) {
            var y1 = this.depthToY(decks[di].topDepth);
            var y2 = this.depthToY(decks[di].baseDepth);
            if (pos.y >= y1 && pos.y <= y2 && pos.x >= hr.x && pos.x <= hr.x + hr.w) {
                this.selectedDeckIndex = di;
                this.selectedPrimerIndex = -1;
                this._selectedContentIndex = -1;
                this._selectedContentDeckIndex = -1;
                this.draw();
                if (this.onDeckSelect) {
                    this.onDeckSelect(decks[di], di);
                }
                return;
            }
        }

        // Clicked outside - deselect
        this.selectedDeckIndex = -1;
        this.selectedPrimerIndex = -1;
        this._selectedContentIndex = -1;
        this._selectedContentDeckIndex = -1;
        this.draw();
    }

    _handleMouseMove(e) {
        if (!this.holeCharging) return;
        var pos = this._getCanvasCoords(e);

        if (this._dragging && this._dragBoundaryIndex >= 0) {
            var newDepth = this.yToDepth(pos.y);
            var decks = this.holeCharging.decks;
            var idx = this._dragBoundaryIndex;
            var upperDeck = decks[idx];
            var lowerDeck = decks[idx + 1];

            // Check if either adjacent deck is a fixed-size spacer
            var upperFixedLen = getSpacerMaxLength(upperDeck);
            var lowerFixedLen = getSpacerMaxLength(lowerDeck);

            if (upperFixedLen !== null && upperDeck.deckType === "SPACER") {
                // Upper deck is a fixed-size spacer: move it as a unit
                var delta = newDepth - upperDeck.baseDepth;
                var newTop = upperDeck.topDepth + delta;
                var newBase = upperDeck.baseDepth + delta;

                // Clamp: spacer can't go above the deck before it (or hole top)
                var minTop = idx > 0 ? decks[idx - 1].topDepth + 0.1 : 0;
                // Clamp: spacer can't push lower deck below its base (or hole bottom)
                var maxBase = lowerDeck.baseDepth - 0.1;

                if (newTop < minTop) {
                    newTop = minTop;
                    newBase = newTop + upperFixedLen;
                }
                if (newBase > maxBase) {
                    newBase = maxBase;
                    newTop = newBase - upperFixedLen;
                }

                upperDeck.topDepth = parseFloat(newTop.toFixed(2));
                upperDeck.baseDepth = parseFloat(newBase.toFixed(2));
                // Resize adjacent decks to fill gaps
                if (idx > 0) {
                    decks[idx - 1].baseDepth = parseFloat(newTop.toFixed(2));
                }
                lowerDeck.topDepth = parseFloat(newBase.toFixed(2));
            } else if (lowerFixedLen !== null && lowerDeck.deckType === "SPACER") {
                // Lower deck is a fixed-size spacer: move it as a unit
                var delta = newDepth - lowerDeck.topDepth;
                var newTop = lowerDeck.topDepth + delta;
                var newBase = lowerDeck.baseDepth + delta;

                // Clamp: spacer can't go above upper deck top
                var minTop = upperDeck.topDepth + 0.1;
                // Clamp: spacer can't go below next deck's base (or hole bottom)
                var maxBase = idx + 2 < decks.length ? decks[idx + 2].baseDepth - 0.1 : this._maxDepth;

                if (newTop < minTop) {
                    newTop = minTop;
                    newBase = newTop + lowerFixedLen;
                }
                if (newBase > maxBase) {
                    newBase = maxBase;
                    newTop = newBase - lowerFixedLen;
                }

                lowerDeck.topDepth = parseFloat(newTop.toFixed(2));
                lowerDeck.baseDepth = parseFloat(newBase.toFixed(2));
                // Resize adjacent decks to fill gaps
                upperDeck.baseDepth = parseFloat(newTop.toFixed(2));
                if (idx + 2 < decks.length) {
                    decks[idx + 2].topDepth = parseFloat(newBase.toFixed(2));
                }
            } else {
                // Standard boundary drag (no fixed-size spacer)
                var minDepth = upperDeck.topDepth + 0.1;
                var maxDepth = lowerDeck.baseDepth - 0.1;

                // Enforce spacer max length constraints for non-fixed spacers
                var upperMaxLen = getSpacerMaxLength(upperDeck);
                if (upperMaxLen !== null) {
                    var spacerMaxBase = upperDeck.topDepth + upperMaxLen;
                    maxDepth = Math.min(maxDepth, spacerMaxBase);
                }

                var lowerMaxLen = getSpacerMaxLength(lowerDeck);
                if (lowerMaxLen !== null) {
                    var spacerMinTop = lowerDeck.baseDepth - lowerMaxLen;
                    minDepth = Math.max(minDepth, spacerMinTop);
                }

                newDepth = Math.max(minDepth, Math.min(maxDepth, newDepth));

                // Staccato snap for DECOUPLED decks: length must be whole multiples of product unit
                var upperUnitLen = getDecoupledUnitLength(upperDeck);
                var lowerUnitLen = getDecoupledUnitLength(lowerDeck);
                if (upperUnitLen) {
                    // Snap upper deck length to nearest whole unit from its top
                    var rawLen = newDepth - upperDeck.topDepth;
                    var units = Math.max(1, Math.round(rawLen / upperUnitLen));
                    newDepth = upperDeck.topDepth + units * upperUnitLen;
                    newDepth = Math.max(minDepth, Math.min(maxDepth, newDepth));
                } else if (lowerUnitLen) {
                    // Snap lower deck length to nearest whole unit from its base
                    var rawLen = lowerDeck.baseDepth - newDepth;
                    var units = Math.max(1, Math.round(rawLen / lowerUnitLen));
                    newDepth = lowerDeck.baseDepth - units * lowerUnitLen;
                    newDepth = Math.max(minDepth, Math.min(maxDepth, newDepth));
                }

                upperDeck.baseDepth = parseFloat(newDepth.toFixed(3));
                lowerDeck.topDepth = parseFloat(newDepth.toFixed(3));
            }

            this.draw();
            return;
        }

        // Hover cursor for boundaries
        var hr = this._holeRect;
        var decks = this.holeCharging.decks;
        var overBoundary = false;
        for (var i = 0; i < decks.length - 1; i++) {
            var boundaryY = this.depthToY(decks[i].baseDepth);
            if (Math.abs(pos.y - boundaryY) < 6 && pos.x >= hr.x - 10 && pos.x <= hr.x + hr.w + 10) {
                overBoundary = true;
                break;
            }
        }
        this.canvas.style.cursor = overBoundary ? "ns-resize" : "default";
    }

    _handleMouseUp(e) {
        if (this._dragging && this._dragBoundaryIndex >= 0) {
            if (this.onDeckResize) {
                var idx = this._dragBoundaryIndex;
                var decks = this.holeCharging.decks;
                this.onDeckResize(idx, decks[idx].topDepth, decks[idx].baseDepth);
            }
        }
        this._dragging = false;
        this._dragBoundaryIndex = -1;
        this.canvas.style.cursor = "default";
    }

    /**
     * Resize canvas to fit container (external call)
     */
    resize(width, height) {
        // width/height here are pixel dimensions; convert to CSS for sync
        var dpr = window.devicePixelRatio || 1;
        var cssH = height / dpr;
        this._containerH = cssH;
        var zoomedH = cssH * this._zoomLevel;
        this.canvas.style.height = zoomedH + "px";
        this._syncCanvasSize(width / dpr, zoomedH);
    }

    destroy() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._zoomOverlay && this._zoomOverlay.parentElement) {
            this._zoomOverlay.parentElement.removeChild(this._zoomOverlay);
        }
        this.holeCharging = null;
    }
}
