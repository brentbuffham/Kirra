/**
 * @fileoverview DeckBuilderDialog - Drag-drop deck builder using FloatingDialog
 *
 * Layout:
 *   Left panel:  Product palette (draggable items from window.loadedProducts)
 *   Right panel: HoleSectionView (drop target, interactive canvas)
 *   Bottom:      Deck properties editor + action buttons
 *
 * Usage: showDeckBuilderDialog(referenceHole)
 */

import { FloatingDialog, createEnhancedFormContent, getFormData, showModalMessage, showConfirmationDialog } from "../../dialog/FloatingDialog.js";
import { HoleSectionView } from "./HoleSectionView.js";
import { HoleCharging, chargingKey } from "../HoleCharging.js";
import { Deck } from "../Deck.js";
import { Primer } from "../Primer.js";
import { DecoupledContent } from "../DecoupledContent.js";
import { DECK_TYPES, DECK_COLORS, DECK_SCALING_MODES, DECOUPLED_CONTENT_CATEGORIES, CHARGE_CONFIG_CODES } from "../ChargingConstants.js";
import { ChargeConfig } from "../ChargeConfig.js";
import { isFormula, evaluateFormula } from "../../helpers/FormulaEvaluator.js";

/**
 * Determine the deck type for a product based on its category
 */
function deckTypeForProduct(product) {
    switch (product.productCategory) {
        case "NonExplosive":
            return DECK_TYPES.INERT;
        case "BulkExplosive":
            return DECK_TYPES.COUPLED;
        case "HighExplosive":
            return DECK_TYPES.DECOUPLED;
        case "Spacer":
            return DECK_TYPES.SPACER;
        default:
            return DECK_TYPES.INERT;
    }
}

/**
 * Build a product snapshot suitable for storing on a Deck
 */
function productSnapshot(product) {
    return {
        productID: product.productID || null,
        name: product.name,
        productType: product.productType || null,
        productCategory: product.productCategory,
        density: product.density || 0,
        colorHex: product.colorHex || null,
        diameterMm: product.diameterMm || null,
        lengthMm: product.lengthMm || null,
        massGrams: product.massGrams || null
    };
}

/**
 * Returns true for detonator types whose delay is a fixed physical property
 * of the product (not user-programmable).
 */
function isFixedDelayType(initiatorType) {
    var t = (initiatorType || "").toLowerCase();
    return t === "shocktube" || t === "electric" || t === "detonatingcord" ||
        t === "surfaceconnector" || t === "surfacecord";
}

/**
 * Build indexed charge formula context from a HoleCharging's decks.
 * Mirrors SimpleRuleEngine.buildIndexedChargeVars() for local use in the dialog.
 */
function buildFormulaCtxFromDecks(workingCharging) {
    var holeLen = Math.abs(workingCharging.holeLength);
    var ctx = {
        holeLength: holeLen,
        holeDiameter: workingCharging.holeDiameterMm || 115,
        chargeLength: 0,
        chargeTop: 0,
        chargeBase: holeLen,
        stemLength: 0
    };
    var deepestBase = 0;
    var deepestTop = 0;
    var deepestLen = 0;
    var firstChargeTop = null;

    for (var i = 0; i < workingCharging.decks.length; i++) {
        var d = workingCharging.decks[i];
        var dt = d.deckType;
        var deckPos = i + 1; // 1-based deck array position — matches UI labels

        // deckBase[N]/deckTop[N]/deckLength[N] — ALL deck types
        ctx["deckBase_" + deckPos] = d.baseDepth;
        ctx["deckTop_" + deckPos] = d.topDepth;
        ctx["deckLength_" + deckPos] = d.baseDepth - d.topDepth;

        // chargeBase[N]/chargeTop[N]/chargeLength[N] — charge decks only
        if (dt === DECK_TYPES.COUPLED || dt === DECK_TYPES.DECOUPLED) {
            var cTop = d.topDepth;
            var cBase = d.baseDepth;
            var cLen = cBase - cTop;
            ctx["chargeBase_" + deckPos] = cBase;
            ctx["chargeTop_" + deckPos] = cTop;
            ctx["chargeLength_" + deckPos] = cLen;
            if (cBase >= deepestBase) {
                deepestBase = cBase;
                deepestTop = cTop;
                deepestLen = cLen;
            }
            if (firstChargeTop === null) firstChargeTop = cTop;
        }
    }
    ctx.chargeBase = deepestBase;
    ctx.chargeTop = deepestTop;
    ctx.chargeLength = deepestLen;
    ctx.stemLength = firstChargeTop !== null ? firstChargeTop : 0;
    return ctx;
}

/**
 * Build the Formula Builder panel (right side of Deck Builder).
 * Provides draggable/clickable variable and operator chips with a formula bar
 * and live preview. Returns { element, refreshIndexedVars, setActiveField }.
 */
function buildFormulaPanel(workingCharging) {
    var activeFormulaField = null;

    var panel = document.createElement("div");
    panel.className = "formula-builder-panel";

    // ---- Sticky top area: title + bar + preview/apply ----
    var topArea = document.createElement("div");
    topArea.className = "formula-top-area";
    panel.appendChild(topArea);

    var title = document.createElement("div");
    title.className = "deck-builder-palette-title";
    title.textContent = "Formula Builder";
    topArea.appendChild(title);

    // Formula bar
    var formulaBar = document.createElement("input");
    formulaBar.type = "text";
    formulaBar.className = "formula-bar";
    formulaBar.placeholder = "Type or click chips...";
    topArea.appendChild(formulaBar);

    // Preview line
    var preview = document.createElement("div");
    preview.className = "formula-preview";
    preview.textContent = "= ?";
    topArea.appendChild(preview);

    // Field indicator
    var fieldIndicator = document.createElement("div");
    fieldIndicator.className = "formula-field-indicator";
    fieldIndicator.textContent = "Click Edit then focus a formula field";
    topArea.appendChild(fieldIndicator);

    // Apply button — full width
    var applyBtn = document.createElement("button");
    applyBtn.className = "formula-apply-btn";
    applyBtn.textContent = "Apply to Field";
    applyBtn.disabled = true;
    applyBtn.addEventListener("click", function () {
        if (!activeFormulaField) return;
        var expr = formulaBar.value.trim();
        if (expr) {
            activeFormulaField.value = "fx:" + expr;
            activeFormulaField.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
    topArea.appendChild(applyBtn);

    // Allow drop on formula bar
    formulaBar.addEventListener("dragover", function (e) { e.preventDefault(); });
    formulaBar.addEventListener("drop", function (e) {
        e.preventDefault();
        var text = e.dataTransfer.getData("text/plain");
        if (!text) return;
        var pos = formulaBar.selectionStart || formulaBar.value.length;
        var val = formulaBar.value;
        formulaBar.value = val.slice(0, pos) + text + val.slice(pos);
        formulaBar.focus();
        formulaBar.selectionStart = formulaBar.selectionEnd = pos + text.length;
        updatePreview();
    });
    formulaBar.addEventListener("input", updatePreview);

    function updatePreview() {
        var expr = formulaBar.value.trim();
        if (!expr) { preview.textContent = "= ?"; preview.style.color = ""; return; }
        var fxExpr = "fx:" + expr;
        var ctx = buildFormulaCtxFromDecks(workingCharging);
        var result = evaluateFormula(fxExpr, ctx);
        if (result != null) {
            preview.textContent = "= " + result.toFixed(3) + "m";
            preview.style.color = "";
        } else {
            preview.textContent = "= error";
            preview.style.color = "#c00";
        }
    }

    // ---- Scrollable chip area ----
    var chipsArea = document.createElement("div");
    chipsArea.className = "formula-chips-area";
    panel.appendChild(chipsArea);

    // Helper: create a chip element
    function makeChip(text, extraClass) {
        var chip = document.createElement("span");
        chip.className = "formula-chip" + (extraClass ? " " + extraClass : "");
        chip.textContent = text;
        chip.draggable = true;
        chip.addEventListener("dragstart", function (e) {
            e.dataTransfer.setData("text/plain", text);
        });
        chip.addEventListener("click", function () {
            var pos = formulaBar.selectionStart || formulaBar.value.length;
            var val = formulaBar.value;
            formulaBar.value = val.slice(0, pos) + text + val.slice(pos);
            formulaBar.focus();
            formulaBar.selectionStart = formulaBar.selectionEnd = pos + text.length;
            updatePreview();
        });
        return chip;
    }

    // Helper: create a section
    function makeSection(titleText) {
        var sec = document.createElement("div");
        var t = document.createElement("div");
        t.className = "formula-section-title";
        t.textContent = titleText;
        sec.appendChild(t);
        var group = document.createElement("div");
        group.className = "formula-chip-group";
        sec.appendChild(group);
        return { container: sec, group: group };
    }

    // ---- Operators (most used, show first) ----
    var opSec = makeSection("Operators");
    var ops = ["+", "-", "*", "/", "(", ")", ">", "<", ">=", "<=", "==", "!=", "?", ":", "&&", "||"];
    for (var o = 0; o < ops.length; o++) {
        opSec.group.appendChild(makeChip(ops[o], "operator"));
    }
    chipsArea.appendChild(opSec.container);

    // ---- Hole variables ----
    var holeSec = makeSection("Hole");
    var holeVars = ["holeLength", "holeDiameter", "benchHeight", "subdrillLength"];
    for (var i = 0; i < holeVars.length; i++) {
        holeSec.group.appendChild(makeChip(holeVars[i]));
    }
    chipsArea.appendChild(holeSec.container);

    // ---- Charge variables ----
    var chargeSec = makeSection("Charge");
    var chargeVars = ["chargeBase", "chargeTop", "chargeLength", "stemLength"];
    for (var j = 0; j < chargeVars.length; j++) {
        chargeSec.group.appendChild(makeChip(chargeVars[j]));
    }
    chipsArea.appendChild(chargeSec.container);

    // ---- Indexed variables (dynamic from decks) ----
    var indexedSec = makeSection("Indexed");
    chipsArea.appendChild(indexedSec.container);

    function refreshIndexedVars() {
        var group = indexedSec.group;
        while (group.firstChild) group.removeChild(group.firstChild);
        var numDecks = workingCharging.decks.length;
        if (numDecks === 0) {
            var empty = document.createElement("span");
            empty.style.cssText = "opacity:0.5;font-size:9px;";
            empty.textContent = "No decks yet";
            group.appendChild(empty);
            return;
        }
        var indexedNames = ["deckBase", "deckTop", "chargeBase", "chargeTop"];
        for (var d = 1; d <= numDecks; d++) {
            for (var n = 0; n < indexedNames.length; n++) {
                group.appendChild(makeChip(indexedNames[n] + "[" + d + "]"));
            }
        }
    }
    refreshIndexedVars();

    // ---- Functions ----
    var funcSec = makeSection("Functions");
    var funcs = ["massLength( , )", "Math.min( , )", "Math.max( , )"];
    for (var f = 0; f < funcs.length; f++) {
        funcSec.group.appendChild(makeChip(funcs[f], "function"));
    }
    chipsArea.appendChild(funcSec.container);

    function setActiveField(inputEl) {
        activeFormulaField = inputEl;
        applyBtn.disabled = !inputEl;
        if (inputEl) {
            fieldIndicator.textContent = "\u25B6 " + (inputEl.name || "field");
            // Load current value into formula bar (strip fx: prefix if present)
            var curVal = (inputEl.value || "").trim();
            if (curVal.substring(0, 3) === "fx:") {
                formulaBar.value = curVal.substring(3);
            } else if (curVal.charAt(0) === "=") {
                formulaBar.value = curVal.substring(1);
            } else {
                formulaBar.value = "";
            }
            updatePreview();
        } else {
            fieldIndicator.textContent = "Click Edit then focus a formula field";
        }
    }

    return {
        element: panel,
        refreshIndexedVars: refreshIndexedVars,
        setActiveField: setActiveField
    };
}

/**
 * Show the Deck Builder dialog
 * @param {Object} [referenceHole] - A blast hole to use as reference for dimensions
 */
export function showDeckBuilderDialog(referenceHole) {
    // Resolve reference hole
    var refHole = referenceHole || null;
    if (!refHole && window.selectedHole) {
        refHole = window.selectedHole;
    }
    if (!refHole && window.selectedMultipleHoles && window.selectedMultipleHoles.length > 0) {
        refHole = window.selectedMultipleHoles[0];
    }
    // Virtual hole mode: if no hole is specifically selected, use virtual reference
    var isVirtualHole = !refHole;
    if (isVirtualHole) {
        refHole = {
            holeID: "VIRTUAL",
            entityName: "N/A",
            holeDiameter: 100,
            holeLengthCalculated: 10.0,
            startXLocation: 0, startYLocation: 0, startZLocation: 0,
            endXLocation: 0, endYLocation: 0, endZLocation: -10.0,
            benchHeight: 10.0, subdrillLength: 0, burden: 1, spacing: 1
        };
    }

    // Track the last applied charge config so we can re-run it per-hole.
    // Wrapped in an object so nested/external functions can mutate it.
    var configTracker = { config: null };

    // Build or clone HoleCharging for the reference hole
    var existingCharging = (!isVirtualHole && window.loadedCharging) ? window.loadedCharging.get(chargingKey(refHole)) : null;
    var workingCharging;
    if (existingCharging) {
        workingCharging = HoleCharging.fromJSON(existingCharging.toJSON());
    } else {
        workingCharging = new HoleCharging(refHole);
    }

    // ======== BUILD CONTENT ========
    var contentDiv = document.createElement("div");
    contentDiv.style.display = "flex";
    contentDiv.style.flexDirection = "column";
    contentDiv.style.height = "100%";
    contentDiv.style.gap = "0";

    // Header info bar
    var infoBar = document.createElement("div");
    infoBar.className = "deck-builder-info";

    if (isVirtualHole) {
        // Virtual hole: editable Dia and Length fields
        infoBar.innerHTML = "<span>Hole: <b>N/A</b></span>" +
            "<span>Entity: <b>N/A</b></span>" +
            '<span>Dia: <input type="number" id="virtualDiaMm" value="100" min="50" max="500" step="1" ' +
            'style="width:50px;font-size:11px;font-weight:bold;padding:1px 3px;height:18px;border:1px solid #999;">mm</span>' +
            '<span>Length: <input type="number" id="virtualLengthM" value="10.0" min="1" max="100" step="0.1" ' +
            'style="width:55px;font-size:11px;font-weight:bold;padding:1px 3px;height:18px;border:1px solid #999;">m</span>';
    } else {
        infoBar.innerHTML = "<span>Hole: <b>" + (refHole.holeID || "N/A") + "</b></span>" + "<span>Entity: <b>" + (refHole.entityName || "N/A") + "</b></span>" + "<span>Dia: <b>" + (refHole.holeDiameter || 0) + "mm</b></span>" + "<span>Length: <b>" + (refHole.holeLengthCalculated || 0).toFixed(1) + "m</b></span>";
    }
    contentDiv.appendChild(infoBar);

    // Dimension mismatch warning (only when opening with existing charging)
    if (existingCharging && typeof existingCharging.checkDimensionMismatch === "function") {
        var mismatch = existingCharging.checkDimensionMismatch(refHole);
        if (mismatch.lengthChanged || mismatch.diameterChanged) {
            var mismatchBanner = document.createElement("div");
            mismatchBanner.className = "deck-builder-mismatch";
            var mismatchText = "Dimension mismatch: ";
            if (mismatch.lengthChanged) {
                mismatchText += "Length " + mismatch.oldLength.toFixed(1) + "m \u2192 " + mismatch.newLength.toFixed(1) + "m";
            }
            if (mismatch.lengthChanged && mismatch.diameterChanged) mismatchText += ", ";
            if (mismatch.diameterChanged) {
                mismatchText += "Diameter " + mismatch.oldDiameter.toFixed(0) + "mm \u2192 " + mismatch.newDiameter.toFixed(0) + "mm";
            }
            mismatchBanner.textContent = mismatchText;
            contentDiv.appendChild(mismatchBanner);
        }
    }

    // Main area: product palette + section view
    var mainArea = document.createElement("div");
    mainArea.style.cssText = "display:flex;flex:1;overflow:hidden;min-height:0;";
    contentDiv.appendChild(mainArea);

    // -------- LEFT: Product Palette --------
    var paletteDiv = document.createElement("div");
    paletteDiv.className = "deck-builder-palette";
    mainArea.appendChild(paletteDiv);

    var paletteTitle = document.createElement("div");
    paletteTitle.className = "deck-builder-palette-title";
    paletteTitle.textContent = "Products";
    paletteDiv.appendChild(paletteTitle);

    buildProductPalette(paletteDiv);

    // -------- RIGHT: Section View --------
    var sectionDiv = document.createElement("div");
    sectionDiv.style.cssText = "flex:1;display:flex;flex-direction:column;min-width:0;";
    mainArea.appendChild(sectionDiv);

    var sectionCanvas = document.createElement("canvas");
    sectionCanvas.style.cssText = "flex:1;width:100%;";
    sectionDiv.appendChild(sectionCanvas);

    // -------- RIGHT: Formula Builder Panel --------
    var formulaPanel = buildFormulaPanel(workingCharging);
    mainArea.appendChild(formulaPanel.element);

    var sectionView = new HoleSectionView({
        canvas: sectionCanvas,
        padding: 25,
        holeDiameterMm: refHole.holeDiameter || 115,
        fontSizeOffset: -1,
        onDeckSelect: function (deck, index) {
            updateDeckPropertiesPanel(deck, index);
        },
        onDeckResize: function () {
            workingCharging.modified = new Date().toISOString();
            sectionView.draw();
            updateSummary();
            formulaPanel.refreshIndexedVars();
        },
        onPrimerSelect: function (primer, index) {
            updatePrimerInfo(primer, index);
        },
        onContentSelect: function (content, deckIndex, contentIndex) {
            updateContentInfo(content, deckIndex, contentIndex);
        }
    });
    sectionView.setData(workingCharging);

    // -------- BOTTOM: Properties + Actions --------
    var bottomArea = document.createElement("div");
    bottomArea.className = "deck-builder-bottom";
    contentDiv.appendChild(bottomArea);

    // Properties row
    var propsRow = document.createElement("div");
    propsRow.className = "deck-builder-props";
    propsRow.id = "deckBuilderPropsRow";
    propsRow.innerHTML = "<span style='opacity:0.5;'>Click a deck to edit properties</span>";
    bottomArea.appendChild(propsRow);

    // Summary row
    var summaryRow = document.createElement("div");
    summaryRow.className = "deck-builder-summary";
    summaryRow.id = "deckBuilderSummary";
    bottomArea.appendChild(summaryRow);

    // Action buttons
    var actionRow = document.createElement("div");
    actionRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
    bottomArea.appendChild(actionRow);

    function makeBtn(text, className, onClick) {
        var btn = document.createElement("button");
        btn.className = "floating-dialog-btn " + className;
        btn.textContent = text;
        btn.style.cssText = "font-size:11px;padding:4px 10px;";
        btn.addEventListener("click", onClick);
        return btn;
    }

    actionRow.appendChild(
        makeBtn("Add Primer", "option1", function () {
            addPrimerToCharging(workingCharging, sectionView, refHole);
        })
    );

    actionRow.appendChild(
        makeBtn("Edit", "option2", function () {
            editSelected(workingCharging, sectionView, refHole, function () { updateSummary(); }, formulaPanel);
        })
    );

    actionRow.appendChild(
        makeBtn("Remove", "deny", function () {
            removeSelected(workingCharging, sectionView, function () { updateSummary(); formulaPanel.refreshIndexedVars(); }, showInlineWarning, isFixedSpacer, findGapFillDeck);
        })
    );

    actionRow.appendChild(
        makeBtn("Clear", "cancel", function () {
            configTracker.config = null;
            workingCharging.clear();
            sectionView.setData(workingCharging);
            updateSummary();
            formulaPanel.refreshIndexedVars();
        })
    );

    var spacer = document.createElement("div");
    spacer.style.flex = "1";
    actionRow.appendChild(spacer);

    actionRow.appendChild(
        makeBtn("Apply Rule...", "option2", function () {
            showRuleSelector(workingCharging, sectionView, refHole, configTracker, formulaPanel);
        })
    );

    actionRow.appendChild(
        makeBtn("Save as Rule", "option1", function () {
            showSaveAsRuleDialog(workingCharging, configTracker);
        })
    );

    actionRow.appendChild(
        makeBtn("Apply to Selected", "confirm", function () {
            applyToSelectedHoles(workingCharging, refHole, configTracker);
        })
    );

    // ======== DRAG & DROP SETUP ========
    setupDragDrop(sectionCanvas, sectionView, workingCharging, refHole, configTracker, formulaPanel);

    // ======== CREATE DIALOG ========
    var dialog = new FloatingDialog({
        title: "Deck Builder",
        content: contentDiv,
        width: 800,
        height: 640,
        showConfirm: false,
        showCancel: true,
        cancelText: "Close",
        onCancel: function () {
            sectionView.destroy();
        }
    });
    dialog.show();

    // Size canvas after dialog is fully laid out (double-rAF for layout flush)
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            var rect = sectionCanvas.parentElement.getBoundingClientRect();
            sectionView.resize(Math.max(rect.width, 200) * (window.devicePixelRatio || 1), Math.max(rect.height, 200) * (window.devicePixelRatio || 1));
        });
    });

    // Virtual hole: wire up diameter and length change handlers
    if (isVirtualHole) {
        var diaInput = document.getElementById("virtualDiaMm");
        var lenInput = document.getElementById("virtualLengthM");
        var applyVirtualDimensions = function () {
            var newDia = parseFloat(diaInput.value) || 100;
            var newLen = parseFloat(lenInput.value) || 10.0;
            refHole.holeDiameter = newDia;
            refHole.holeLengthCalculated = newLen;
            refHole.endZLocation = refHole.startZLocation - newLen;
            sectionView.holeDiameterMm = newDia;
            // Re-layout decks if they exist (call BEFORE updating holeLength/dia
            // so updateDimensions can detect the change)
            if (workingCharging.decks.length > 0) {
                workingCharging.updateDimensions(refHole);
            }
            // Sync stored dimensions after rescale
            workingCharging.holeDiameterMm = newDia;
            workingCharging.holeLength = newLen;
            sectionView.setData(workingCharging);
            updateSummary();
        };
        if (diaInput) diaInput.addEventListener("change", applyVirtualDimensions);
        if (lenInput) lenInput.addEventListener("change", applyVirtualDimensions);
    }

    updateSummary();

    // ======== HELPER FUNCTIONS (closures) ========

    function updateDeckPropertiesPanel(deck, index) {
        var row = document.getElementById("deckBuilderPropsRow");
        if (!row) return;
        var qtyLabel = "";
        if (deck.deckType === DECK_TYPES.DECOUPLED && deck.packageCount > 0) {
            qtyLabel = "<span>Qty: " + deck.packageCount + "</span>";
        }
        row.innerHTML =
            "<b>Deck " +
            (index + 1) +
            ":</b> " +
            "<span>Type: " +
            deck.deckType +
            "</span>" +
            "<span>Product: " +
            (deck.product ? deck.product.name : "None") +
            "</span>" +
            "<span>Top: " +
            deck.topDepth.toFixed(1) +
            "m</span>" +
            "<span>Base: " +
            deck.baseDepth.toFixed(1) +
            "m</span>" +
            "<span>Length: " +
            deck.length.toFixed(1) +
            "m</span>" +
            qtyLabel +
            "<span>Density: " +
            (deck.effectiveDensity || 0).toFixed(3) +
            " g/cc</span>";
    }

    function updatePrimerInfo(primer, index) {
        var row = document.getElementById("deckBuilderPropsRow");
        if (!row) return;
        var detQty = primer.detonator.quantity || 1;
        var detLabel = primer.detonator.productName || "None";
        if (detQty > 1) detLabel = detQty + "x " + detLabel;
        var totalDelay = primer.totalDownholeDelayMs;
        var travelTime = totalDelay - (primer.detonator.delayMs || 0);
        var delayLabel = (primer.detonator.delayMs || 0) + "ms";
        if (travelTime > 0.01) {
            delayLabel += " + " + travelTime.toFixed(1) + "ms travel = " + totalDelay.toFixed(1) + "ms";
        }
        row.innerHTML = "<b>Primer " + (index + 1) + ":</b> " + "<span>Depth: " + (primer.lengthFromCollar || 0).toFixed(1) + "m</span>" + "<span>Det: " + detLabel + "</span>" + "<span>Booster: " + (primer.booster.productName || "None") + "</span>" + "<span>Delay: " + delayLabel + "</span>";
    }

    function updateContentInfo(content, deckIndex, contentIndex) {
        var row = document.getElementById("deckBuilderPropsRow");
        if (!row) return;
        var mass = content.calculateMass ? content.calculateMass() : 0;
        row.innerHTML =
            "<b>Embedded Content:</b> " +
            "<span>" + (content.productName || content.contentType) + "</span>" +
            "<span>Depth: " + (content.lengthFromCollar || 0).toFixed(2) + "m</span>" +
            "<span>Length: " + (content.length || 0).toFixed(3) + "m</span>" +
            "<span>Dia: " + ((content.diameter || 0) * 1000).toFixed(0) + "mm</span>" +
            "<span>Mass: " + (mass ? mass.toFixed(1) : "0") + "kg</span>";
    }

    function updateSummary() {
        var el = document.getElementById("deckBuilderSummary");
        if (!el || !workingCharging) return;
        var mass = workingCharging.getTotalExplosiveMass();
        var pf = workingCharging.calculatePowderFactor(refHole.burden || 1, refHole.spacing || 1);
        el.textContent = "Decks: " + workingCharging.decks.length + " | Primers: " + workingCharging.primers.length + " | Explosive Mass: " + mass.toFixed(1) + " kg" + " | Powder Factor: " + pf.toFixed(3) + " kg/m\u00B3";
    }

    function showInlineWarning(message) {
        var row = document.getElementById("deckBuilderPropsRow");
        if (!row) return;
        row.innerHTML = '<span style="color:#ff9800;">\u26A0 ' + message + "</span>";
        setTimeout(function () {
            row.innerHTML = "<span style='opacity:0.5;'>Click a deck to edit properties</span>";
        }, 3000);
    }

    function isFixedSpacer(deck) {
        return deck && deck.deckType === DECK_TYPES.SPACER;
    }

    /**
     * Find the nearest non-spacer deck to absorb a gap.
     * Searches above (idx-1, idx-2...) then below (idx, idx+1...).
     */
    function findGapFillDeck(decks, removedIdx, removedTop, removedBase) {
        // Search above the removed position
        for (var i = removedIdx - 1; i >= 0; i--) {
            if (!isFixedSpacer(decks[i])) {
                decks[i].baseDepth = removedBase;
                return;
            }
        }
        // Search below (indices shifted after splice, so removedIdx is now next deck)
        for (var j = removedIdx; j < decks.length; j++) {
            if (!isFixedSpacer(decks[j])) {
                decks[j].topDepth = removedTop;
                return;
            }
        }
        // All remaining are spacers - expand last deck as fallback
        if (decks.length > 0) {
            decks[decks.length - 1].baseDepth = removedBase;
        }
    }

}

/**
 * Build draggable product palette items from window.loadedProducts
 */
function buildProductPalette(container) {
    var products = window.loadedProducts || new Map();

    if (products.size === 0) {
        var empty = document.createElement("div");
        empty.style.cssText = "color:#666;font-size:11px;padding:8px;text-align:center;";
        empty.textContent = "No products loaded. Import a config first.";
        container.appendChild(empty);
        return;
    }

    // Group by category
    var categories = {};
    products.forEach(function (product) {
        var cat = product.productCategory || "Other";
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(product);
    });

    var catOrder = ["NonExplosive", "BulkExplosive", "HighExplosive", "Initiator", "Spacer"];
    var catLabels = {
        NonExplosive: "Non-Explosive",
        BulkExplosive: "Bulk Explosive",
        HighExplosive: "High Explosive",
        Initiator: "Initiators",
        Spacer: "Spacers"
    };

    for (var ci = 0; ci < catOrder.length; ci++) {
        var cat = catOrder[ci];
        var items = categories[cat];
        if (!items || items.length === 0) continue;

        var catHeader = document.createElement("div");
        catHeader.className = "deck-builder-cat-header";
        catHeader.textContent = catLabels[cat] || cat;
        container.appendChild(catHeader);

        for (var pi = 0; pi < items.length; pi++) {
            var product = items[pi];
            var item = document.createElement("div");
            item.className = "deck-palette-item";
            item.setAttribute("draggable", "true");
            item.dataset.productId = product.productID || product.name;
            item.dataset.productCategory = product.productCategory;

            // Color swatch
            var swatch = document.createElement("span");
            swatch.style.cssText = "width:12px;height:12px;border-radius:2px;flex-shrink:0;border:1px solid #555;";
            swatch.style.backgroundColor = product.colorHex || "#CCCCCC";
            item.appendChild(swatch);

            // Name
            var nameSpan = document.createElement("span");
            nameSpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
            nameSpan.textContent = product.name;
            nameSpan.title = product.name + " (" + product.productCategory + ")";
            item.appendChild(nameSpan);

            // Drag start
            (function (prod) {
                item.addEventListener("dragstart", function (e) {
                    e.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({
                            productID: prod.productID || prod.name,
                            name: prod.name,
                            productCategory: prod.productCategory,
                            productType: prod.productType,
                            density: prod.density,
                            colorHex: prod.colorHex
                        })
                    );
                    e.dataTransfer.effectAllowed = "copy";
                });
            })(product);

            container.appendChild(item);
        }
    }
}

/**
 * Setup drag-and-drop from palette to section view canvas
 */
function setupDragDrop(canvas, sectionView, workingCharging, refHole, configTracker, formulaPanel) {
    canvas.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });

    canvas.addEventListener("drop", function (e) {
        e.preventDefault();

        var dataStr = e.dataTransfer.getData("text/plain");
        if (!dataStr) return;

        var productData;
        try {
            productData = JSON.parse(dataStr);
        } catch (err) {
            return;
        }

        // Find the full product from loaded products
        var fullProduct = null;
        if (window.loadedProducts) {
            window.loadedProducts.forEach(function (p) {
                if ((p.productID && p.productID === productData.productID) || p.name === productData.name) {
                    fullProduct = p;
                }
            });
        }
        if (!fullProduct) {
            fullProduct = productData; // Use the drag data as fallback
        }

        // Manual drop invalidates any tracked rule config
        if (configTracker) configTracker.config = null;

        // Determine drop depth from Y position
        var dropDepth = sectionView.yToDepth((e.clientY - canvas.getBoundingClientRect().top) * (canvas.height / canvas.getBoundingClientRect().height));

        // Clamp to hole range
        var minD = 0;
        var maxD = Math.abs(workingCharging.holeLength);
        dropDepth = Math.max(minD, Math.min(maxD, dropDepth));

        // Determine deck type from product
        var deckType = deckTypeForProduct(fullProduct);

        // For initiator products, add as primer instead
        if (fullProduct.productCategory === "Initiator") {
            var primer = new Primer({
                holeID: workingCharging.holeID,
                lengthFromCollar: parseFloat(dropDepth.toFixed(2)),
                detonator: {
                    productID: fullProduct.productID || null,
                    productName: fullProduct.name,
                    initiatorType: fullProduct.initiatorType || fullProduct.productType || null,
                    deliveryVodMs: fullProduct.deliveryVodMs || 0,
                    delayMs: fullProduct.delayMs || 0
                },
                booster: {
                    productName: null,
                    quantity: 1
                }
            });
            var result = workingCharging.addPrimer(primer);
            if (!result.success && result.errors && result.errors.length > 0) {
                showModalMessage("Primer Error", result.errors.join("\n"), "warning");
            }
            sectionView.setData(workingCharging);
            return;
        }

        var defaultDeckLength = 2.0;
        if (fullProduct.productCategory === "HighExplosive") {
            // Default to 1 package unit length
            defaultDeckLength = fullProduct.lengthMm ? fullProduct.lengthMm / 1000 : 0.4;
        } else if (fullProduct.productCategory === "Spacer") {
            defaultDeckLength = 0.4; // Short for spacers
        }

        // Calculate interval: drop point is center of new deck
        var halfLen = defaultDeckLength / 2;
        var topD = Math.max(minD, dropDepth - halfLen);
        var baseD = Math.min(maxD, topD + defaultDeckLength);

        workingCharging.fillInterval(parseFloat(topD.toFixed(2)), parseFloat(baseD.toFixed(2)), deckType, productSnapshot(fullProduct));

        sectionView.setData(workingCharging);
        if (formulaPanel) formulaPanel.refreshIndexedVars();
    });
}

/**
 * Add a primer via a simple dialog prompt
 */
function addPrimerToCharging(workingCharging, sectionView, refHole) {
    // Gather initiator products for selection
    var initiators = [];
    var boosters = [];
    if (window.loadedProducts) {
        window.loadedProducts.forEach(function (p) {
            if (p.productCategory === "Initiator") initiators.push(p);
            if (p.productCategory === "HighExplosive") boosters.push(p);
        });
    }

    var detOptions = [{ value: "", text: "-- None --" }];
    for (var i = 0; i < initiators.length; i++) {
        detOptions.push({ value: initiators[i].name, text: initiators[i].name });
    }

    var boosterOptions = [{ value: "", text: "-- None --" }];
    for (var b = 0; b < boosters.length; b++) {
        boosterOptions.push({ value: boosters[b].name, text: boosters[b].name });
    }

    var holeLen = Math.abs(workingCharging.holeLength);
    var defaultDepth = holeLen * 0.9;

    var fields = [
        { label: "Depth from Collar (m)", name: "depthFromCollar", type: "text", value: defaultDepth.toFixed(1), placeholder: "e.g. 8.5 or fx:chargeBase[4]-0.3" },
        { label: "Detonator", name: "detonatorName", type: "select", options: detOptions, value: detOptions.length > 1 ? detOptions[1].value : "" },
        { label: "Detonator Qty", name: "detonatorQty", type: "number", value: "1", step: "1", min: "1", max: "10" },
        { label: "Delay (ms)", name: "delayMs", type: "number", value: "0", step: "1" },
        { label: "Booster", name: "boosterName", type: "select", options: boosterOptions, value: boosterOptions.length > 1 ? boosterOptions[1].value : "" },
        { label: "Booster Qty", name: "boosterQty", type: "number", value: "1", step: "1" }
    ];

    var formContent = createEnhancedFormContent(fields);

    // Wire delay field to detonator selection: fixed-delay types inherit from product
    var detSelect = formContent.querySelector('select[name="detonatorName"]');
    var delayInput = formContent.querySelector('input[name="delayMs"]');
    function syncDelayField() {
        if (!detSelect || !delayInput) return;
        var selName = detSelect.value;
        var product = null;
        if (selName && window.loadedProducts) {
            window.loadedProducts.forEach(function (p) { if (p.name === selName) product = p; });
        }
        if (product && isFixedDelayType(product.initiatorType || product.productType)) {
            delayInput.value = product.delayMs || 0;
            delayInput.readOnly = true;
            delayInput.style.backgroundColor = "#e0e0e0";
            delayInput.style.color = "#666";
        } else {
            delayInput.readOnly = false;
            delayInput.style.backgroundColor = "";
            delayInput.style.color = "";
        }
    }
    if (detSelect) detSelect.addEventListener("change", syncDelayField);
    syncDelayField(); // set initial state

    var primerDialog = new FloatingDialog({
        title: "Add Primer",
        content: formContent,
        width: 350,
        height: 320,
        showConfirm: true,
        confirmText: "Add",
        showCancel: true,
        onConfirm: function () {
            var data = getFormData(formContent);
            var depthInput = (data.depthFromCollar || "").trim();
            var depth;

            if (isFormula(depthInput)) {
                var ctx = buildFormulaCtxFromDecks(workingCharging);
                depth = evaluateFormula(depthInput, ctx);
                if (depth == null) {
                    showModalMessage("Formula Error", "Could not evaluate: " + depthInput, "warning");
                    return;
                }
            } else {
                depth = parseFloat(depthInput) || defaultDepth;
            }

            // Find product details
            var detProduct = null;
            var boosterProduct = null;
            if (data.detonatorName && window.loadedProducts) {
                window.loadedProducts.forEach(function (p) {
                    if (p.name === data.detonatorName) detProduct = p;
                });
            }
            if (data.boosterName && window.loadedProducts) {
                window.loadedProducts.forEach(function (p) {
                    if (p.name === data.boosterName) boosterProduct = p;
                });
            }

            // Fixed-delay types: inherit delayMs from product, ignore form value
            var resolvedDelay;
            var detInitType = detProduct ? detProduct.initiatorType || detProduct.productType : null;
            if (isFixedDelayType(detInitType)) {
                resolvedDelay = detProduct.delayMs || 0;
            } else {
                resolvedDelay = parseFloat(data.delayMs) || 0;
            }

            var primer = new Primer({
                holeID: workingCharging.holeID,
                lengthFromCollar: depth,
                depthFormula: isFormula(depthInput) ? depthInput : null,
                detonator: {
                    productID: detProduct ? detProduct.productID : null,
                    productName: data.detonatorName || null,
                    initiatorType: detInitType,
                    deliveryVodMs: detProduct ? detProduct.deliveryVodMs || 0 : 0,
                    delayMs: resolvedDelay,
                    quantity: Math.max(1, Math.min(10, parseInt(data.detonatorQty) || 1))
                },
                booster: {
                    productID: boosterProduct ? boosterProduct.productID : null,
                    productName: data.boosterName || null,
                    quantity: parseInt(data.boosterQty) || 1,
                    massGrams: boosterProduct ? boosterProduct.massGrams : null
                }
            });

            var result = workingCharging.addPrimer(primer);
            if (!result.success && result.errors && result.errors.length > 0) {
                showModalMessage("Primer Error", result.errors.join("\n"), "warning");
            }
            sectionView.setData(workingCharging);
        }
    });
    primerDialog.show();
}

/**
 * Edit an existing primer via dialog pre-populated with its current values.
 * Updates the primer in-place on confirm.
 */
function editPrimer(workingCharging, sectionView, refHole, formulaPanel) {
    var idx = sectionView.selectedPrimerIndex;
    if (idx < 0 || idx >= workingCharging.primers.length) {
        var row = document.getElementById("deckBuilderPropsRow");
        if (row) {
            row.innerHTML = '<span style="color:#ff9800;">\u26A0 Select a primer to edit first.</span>';
            setTimeout(function () {
                row.innerHTML = "<span style='opacity:0.5;'>Click a deck to edit properties</span>";
            }, 3000);
        }
        return;
    }

    var primer = workingCharging.primers[idx];

    // Gather initiator and booster products for selection
    var initiators = [];
    var boosters = [];
    if (window.loadedProducts) {
        window.loadedProducts.forEach(function (p) {
            if (p.productCategory === "Initiator") initiators.push(p);
            if (p.productCategory === "HighExplosive") boosters.push(p);
        });
    }

    var detOptions = [{ value: "", text: "-- None --" }];
    for (var i = 0; i < initiators.length; i++) {
        detOptions.push({ value: initiators[i].name, text: initiators[i].name });
    }

    var boosterOptions = [{ value: "", text: "-- None --" }];
    for (var b = 0; b < boosters.length; b++) {
        boosterOptions.push({ value: boosters[b].name, text: boosters[b].name });
    }

    var depthDisplayValue = primer.depthFormula ? primer.depthFormula : (primer.lengthFromCollar || 0).toFixed(1);
    var fields = [
        { label: "Depth from Collar (m)", name: "depthFromCollar", type: "text", value: depthDisplayValue, placeholder: "e.g. 8.5 or fx:chargeBase[4]-0.3" },
        { label: "Detonator", name: "detonatorName", type: "select", options: detOptions, value: primer.detonator.productName || "" },
        { label: "Detonator Qty", name: "detonatorQty", type: "number", value: String(primer.detonator.quantity || 1), step: "1", min: "1", max: "10" },
        { label: "Delay (ms)", name: "delayMs", type: "number", value: String(primer.detonator.delayMs || 0), step: "1" },
        { label: "Booster", name: "boosterName", type: "select", options: boosterOptions, value: primer.booster.productName || "" },
        { label: "Booster Qty", name: "boosterQty", type: "number", value: String(primer.booster.quantity || 1), step: "1" }
    ];

    var formContent = createEnhancedFormContent(fields);

    // Wire delay field to detonator selection: fixed-delay types inherit from product
    var detSelect = formContent.querySelector('select[name="detonatorName"]');
    var delayInput = formContent.querySelector('input[name="delayMs"]');
    function syncDelayField() {
        if (!detSelect || !delayInput) return;
        var selName = detSelect.value;
        var product = null;
        if (selName && window.loadedProducts) {
            window.loadedProducts.forEach(function (p) { if (p.name === selName) product = p; });
        }
        if (product && isFixedDelayType(product.initiatorType || product.productType)) {
            delayInput.value = product.delayMs || 0;
            delayInput.readOnly = true;
            delayInput.style.backgroundColor = "#e0e0e0";
            delayInput.style.color = "#666";
        } else {
            delayInput.readOnly = false;
            delayInput.style.backgroundColor = "";
            delayInput.style.color = "";
        }
    }
    if (detSelect) detSelect.addEventListener("change", syncDelayField);
    syncDelayField(); // set initial state from current primer's detonator

    // Wire formula field to the Formula Builder panel
    if (formulaPanel) {
        var depthField = formContent.querySelector('input[name="depthFromCollar"]');
        if (depthField) {
            depthField.addEventListener("focus", function () { formulaPanel.setActiveField(depthField); });
        }
    }

    var editDialog = new FloatingDialog({
        title: "Edit Primer " + (idx + 1),
        content: formContent,
        width: 420,
        height: 320,
        showConfirm: true,
        confirmText: "Update",
        showCancel: true,
        onConfirm: function () {
            var data = getFormData(formContent);
            var depthInput = (data.depthFromCollar || "").trim();
            var depth;

            if (isFormula(depthInput)) {
                var ctx = buildFormulaCtxFromDecks(workingCharging);
                depth = evaluateFormula(depthInput, ctx);
                if (depth == null) {
                    showModalMessage("Formula Error", "Could not evaluate: " + depthInput, "warning");
                    return;
                }
            } else {
                depth = parseFloat(depthInput);
                if (isNaN(depth)) depth = primer.lengthFromCollar;
            }

            // Clamp depth to hole range
            var holeLen = Math.abs(workingCharging.holeLength);
            depth = Math.max(0, Math.min(holeLen, depth));

            // Find product details
            var detProduct = null;
            var boosterProduct = null;
            if (data.detonatorName && window.loadedProducts) {
                window.loadedProducts.forEach(function (p) {
                    if (p.name === data.detonatorName) detProduct = p;
                });
            }
            if (data.boosterName && window.loadedProducts) {
                window.loadedProducts.forEach(function (p) {
                    if (p.name === data.boosterName) boosterProduct = p;
                });
            }

            // Fixed-delay types: inherit delayMs from product, ignore form value
            var detInitType = detProduct ? detProduct.initiatorType || detProduct.productType : null;
            var resolvedDelay;
            if (isFixedDelayType(detInitType)) {
                resolvedDelay = detProduct.delayMs || 0;
            } else {
                resolvedDelay = parseFloat(data.delayMs) || 0;
            }

            // Update primer in-place
            primer.lengthFromCollar = depth;
            primer.depthFormula = isFormula(depthInput) ? depthInput : null;
            primer.detonator.productID = detProduct ? detProduct.productID : null;
            primer.detonator.productName = data.detonatorName || null;
            primer.detonator.initiatorType = detInitType;
            primer.detonator.deliveryVodMs = detProduct ? detProduct.deliveryVodMs || 0 : 0;
            primer.detonator.delayMs = resolvedDelay;
            primer.detonator.quantity = Math.max(1, Math.min(10, parseInt(data.detonatorQty) || 1));
            primer.booster.productID = boosterProduct ? boosterProduct.productID : null;
            primer.booster.productName = data.boosterName || null;
            primer.booster.quantity = parseInt(data.boosterQty) || 1;
            primer.booster.massGrams = boosterProduct ? boosterProduct.massGrams : null;

            workingCharging.modified = new Date().toISOString();
            sectionView.setData(workingCharging);
        }
    });
    editDialog.show();
}

/**
 * Universal Edit: auto-detect whether a primer or deck is selected and open the right editor.
 */
function editSelected(workingCharging, sectionView, refHole, onUpdate, formulaPanel) {
    // Primer selection takes priority (more specific)
    if (sectionView.selectedPrimerIndex >= 0 && sectionView.selectedPrimerIndex < workingCharging.primers.length) {
        editPrimer(workingCharging, sectionView, refHole, formulaPanel);
        return;
    }
    // Embedded content selection
    if (sectionView._selectedContentDeckIndex >= 0 && sectionView._selectedContentIndex >= 0) {
        editEmbeddedContent(workingCharging, sectionView, onUpdate);
        return;
    }
    if (sectionView.selectedDeckIndex >= 0 && sectionView.selectedDeckIndex < workingCharging.decks.length) {
        editDeck(workingCharging, sectionView, refHole, onUpdate, formulaPanel);
        return;
    }
    // Nothing selected
    var row = document.getElementById("deckBuilderPropsRow");
    if (row) {
        row.innerHTML = '<span style="color:#ff9800;">\u26A0 Select a deck or primer to edit first.</span>';
        setTimeout(function () {
            row.innerHTML = "<span style='opacity:0.5;'>Click a deck to edit properties</span>";
        }, 3000);
    }
}

/**
 * Universal Remove: auto-detect whether a primer, spacer, or deck is selected and remove it.
 */
function removeSelected(workingCharging, sectionView, onUpdate, showInlineWarning, isFixedSpacer, findGapFillDeck) {
    // Check primer first
    if (sectionView.selectedPrimerIndex >= 0 && sectionView.selectedPrimerIndex < workingCharging.primers.length) {
        workingCharging.primers.splice(sectionView.selectedPrimerIndex, 1);
        sectionView.selectedPrimerIndex = -1;
        sectionView.setData(workingCharging);
        onUpdate();
        return;
    }
    // Check embedded content
    if (sectionView._selectedContentDeckIndex >= 0 && sectionView._selectedContentIndex >= 0) {
        var cDeck = workingCharging.decks[sectionView._selectedContentDeckIndex];
        if (cDeck && cDeck.contains && cDeck.contains[sectionView._selectedContentIndex]) {
            var contentID = cDeck.contains[sectionView._selectedContentIndex].contentID;
            workingCharging.removeContent(contentID);
            sectionView._selectedContentDeckIndex = -1;
            sectionView._selectedContentIndex = -1;
            sectionView.setData(workingCharging);
            onUpdate();
        }
        return;
    }
    // Check deck
    var idx = sectionView.selectedDeckIndex;
    if (idx >= 0 && idx < workingCharging.decks.length) {
        if (workingCharging.decks.length <= 1) {
            showInlineWarning("Cannot remove the last deck. Use Clear instead.");
            return;
        }
        var removed = workingCharging.decks[idx];
        var removedTop = removed.topDepth;
        var removedBase = removed.baseDepth;
        workingCharging.decks.splice(idx, 1);
        findGapFillDeck(workingCharging.decks, idx, removedTop, removedBase);
        workingCharging.sortDecks();
        sectionView.selectedDeckIndex = -1;
        sectionView.setData(workingCharging);
        onUpdate();
        return;
    }
    showInlineWarning("Select a deck or primer to remove first.");
}

/**
 * Edit an existing deck via dialog pre-populated with its current values.
 * Supports fx: formulas for topDepth and baseDepth.
 */
function editDeck(workingCharging, sectionView, refHole, onUpdate, formulaPanel) {
    var idx = sectionView.selectedDeckIndex;
    if (idx < 0 || idx >= workingCharging.decks.length) return;

    var deck = workingCharging.decks[idx];

    // Build product options filtered to categories that match this deck type
    var productOptions = [{ value: "", text: "-- None --" }];
    if (window.loadedProducts) {
        window.loadedProducts.forEach(function (p) {
            productOptions.push({ value: p.name, text: p.name + " (" + p.productCategory + ")" });
        });
    }

    // For DECOUPLED decks, compute quantity from product unit length
    var isDecoupled = deck.deckType === DECK_TYPES.DECOUPLED;
    var unitLenM = 0;
    if (isDecoupled && deck.product && deck.product.lengthMm) {
        unitLenM = deck.product.lengthMm / 1000;
    } else if (isDecoupled && deck.product && deck.product.name && window.loadedProducts) {
        window.loadedProducts.forEach(function (p) {
            if (p.name === deck.product.name && p.lengthMm) unitLenM = p.lengthMm / 1000;
        });
    }
    var currentQty = (unitLenM > 0) ? Math.round(deck.length / unitLenM) : 1;
    if (currentQty < 1) currentQty = 1;

    // Calculate current mass for the "Use Mass" feature
    var currentDensity = deck.effectiveDensity || (deck.product ? deck.product.density || 0 : 0);
    var currentMassKg = deck.calculateMass ? deck.calculateMass(workingCharging.holeDiameterMm || 115) : 0;

    var fields = [
        {
            label: "Deck Type", name: "deckType", type: "select",
            options: [
                { value: DECK_TYPES.INERT, text: "INERT" },
                { value: DECK_TYPES.COUPLED, text: "COUPLED" },
                { value: DECK_TYPES.DECOUPLED, text: "DECOUPLED" },
                { value: DECK_TYPES.SPACER, text: "SPACER" }
            ],
            value: deck.deckType
        },
        {
            label: "Product", name: "productName", type: "select",
            options: productOptions,
            value: deck.product ? deck.product.name : ""
        },
        { label: "Top Depth (m)", name: "topDepth", type: "text", value: deck.topDepthFormula || deck.topDepth.toFixed(3), placeholder: "e.g. 3.5 or fx:stemLength" }
    ];

    // DECOUPLED: show quantity instead of base depth (length = qty × product length)
    if (isDecoupled && unitLenM > 0) {
        fields.push({ label: "Quantity (units)", name: "quantity", type: "number", value: String(currentQty), step: "1", min: "1" });
    } else {
        // Show formula if present: lengthFormula → display as length expression, baseDepthFormula → display directly
        var baseDisplayValue = deck.baseDepthFormula || deck.baseDepth.toFixed(3);
        if (!deck.baseDepthFormula && deck.lengthFormula) {
            // Show length formula as informational hint in the base depth field
            baseDisplayValue = deck.lengthFormula;
        }
        fields.push({ label: "Base Depth (m)", name: "baseDepth", type: "text", value: baseDisplayValue, placeholder: "e.g. 10.0 or fx:holeLength or fill" });
    }

    // Use Mass checkbox and Mass (kg) field
    fields.push({ label: "Use Mass", name: "useMass", type: "checkbox", checked: deck.isFixedMass || false });
    fields.push({ label: "Mass (kg)", name: "massKg", type: "number", value: currentMassKg.toFixed(2), step: "0.1", min: "0" });

    // Overlap Pattern for DECOUPLED decks
    if (isDecoupled) {
        var overlapStr = "";
        if (deck.overlapPattern) {
            var parts = [];
            var op = deck.overlapPattern;
            if (op.base != null) parts.push("base=" + op.base);
            if (op["base-1"] != null) parts.push("base-1=" + op["base-1"]);
            if (op.n != null) parts.push("n=" + op.n);
            if (op.top != null) parts.push("top=" + op.top);
            overlapStr = parts.join(";");
        }
        fields.push({ label: "Overlap Pattern", name: "overlapPattern", type: "text", value: overlapStr, placeholder: "e.g. base=3;base-1=2;n=1;top=2" });
    }

    // Scaling mode selector
    var currentScalingMode = deck.isFixedLength ? DECK_SCALING_MODES.FIXED_LENGTH
        : deck.isFixedMass ? DECK_SCALING_MODES.FIXED_MASS
            : deck.isVariable ? DECK_SCALING_MODES.VARIABLE
                : DECK_SCALING_MODES.PROPORTIONAL;
    fields.push({
        label: "Scaling Mode", name: "scalingMode", type: "select",
        options: [
            { value: DECK_SCALING_MODES.PROPORTIONAL, text: "Proportional (scales with hole)" },
            { value: DECK_SCALING_MODES.FIXED_LENGTH, text: "Fixed Length (stays exact)" },
            { value: DECK_SCALING_MODES.FIXED_MASS, text: "Fixed Mass (recalcs from density)" },
            { value: DECK_SCALING_MODES.VARIABLE, text: "Variable (re-evaluates formula)" }
        ],
        value: currentScalingMode
    });

    var formContent = createEnhancedFormContent(fields);

    // Toggle Mass (kg) field visibility based on Use Mass checkbox
    var useMassCheckbox = formContent.querySelector('input[name="useMass"]');
    var massField = formContent.querySelector('input[name="massKg"]');
    var baseDepthField = formContent.querySelector('input[name="baseDepth"]') || formContent.querySelector('input[name="quantity"]');
    if (useMassCheckbox && massField) {
        // Walk up to the row container (parent of the input's container)
        var massRow = massField.parentElement;
        var baseRow = baseDepthField ? baseDepthField.parentElement : null;
        // Initial visibility
        massRow.style.display = useMassCheckbox.checked ? "grid" : "none";
        if (baseRow) baseRow.style.display = useMassCheckbox.checked ? "none" : "grid";
        useMassCheckbox.addEventListener("change", function () {
            massRow.style.display = this.checked ? "grid" : "none";
            if (baseRow) baseRow.style.display = this.checked ? "none" : "grid";
        });
    }

    // Wire formula fields to the Formula Builder panel
    if (formulaPanel) {
        var topField = formContent.querySelector('input[name="topDepth"]');
        var baseField2 = formContent.querySelector('input[name="baseDepth"]');
        if (topField) {
            topField.addEventListener("focus", function () { formulaPanel.setActiveField(topField); });
        }
        if (baseField2) {
            baseField2.addEventListener("focus", function () { formulaPanel.setActiveField(baseField2); });
        }
    }

    // Calculate dialog height based on extra fields
    var dialogHeight = 340;
    if (isDecoupled) dialogHeight += 45; // overlap pattern field
    dialogHeight += 90; // useMass + massKg fields

    var editDialog = new FloatingDialog({
        title: "Edit Deck " + (idx + 1),
        content: formContent,
        width: 450,
        height: dialogHeight,
        showConfirm: true,
        confirmText: "Update",
        showCancel: true,
        onConfirm: function () {
            var data = getFormData(formContent);
            var ctx = buildFormulaCtxFromDecks(workingCharging);
            var holeLen = Math.abs(workingCharging.holeLength);
            var holeDiamMm = workingCharging.holeDiameterMm || 115;

            // Resolve topDepth — store formula if entered
            var topInput = (data.topDepth || "").trim();
            var newTop;
            var newTopFormula = null;
            if (isFormula(topInput)) {
                newTopFormula = topInput;
                newTop = evaluateFormula(topInput, ctx);
                if (newTop == null) {
                    showModalMessage("Formula Error", "Could not evaluate top depth: " + topInput, "warning");
                    return;
                }
            } else {
                newTop = parseFloat(topInput);
                if (isNaN(newTop)) newTop = deck.topDepth;
            }

            // Check if "Use Mass" is active — derive base depth from mass
            var useMass = data.useMass === "true" || data.useMass === true;
            var newBase;
            var newBaseFormula = null;
            var newLengthFormula = null;

            if (useMass) {
                var massKg = parseFloat(data.massKg) || 0;
                newLengthFormula = "m:" + massKg;
                // Look up product density (prefer newly selected product)
                var massProductName = data.productName || "";
                var massDensity = currentDensity;
                if (massProductName && window.loadedProducts) {
                    window.loadedProducts.forEach(function (p) {
                        if (p.name === massProductName) massDensity = p.density || 0;
                    });
                }
                if (massDensity > 0 && massKg > 0) {
                    var radiusM = (holeDiamMm / 1000) / 2;
                    var area = Math.PI * radiusM * radiusM;
                    var kgPerMetre = massDensity * 1000 * area;
                    var massLen = kgPerMetre > 0 ? massKg / kgPerMetre : 1.0;
                    newBase = newTop + massLen;
                } else {
                    showModalMessage("Mass Error", "Product density must be > 0 and mass > 0 to calculate length.", "warning");
                    return;
                }
            } else if (isDecoupled && unitLenM > 0 && data.quantity != null) {
                // DECOUPLED with quantity: derive base from top + qty × unit length
                var qty = Math.max(1, parseInt(data.quantity) || 1);
                newBase = newTop + qty * unitLenM;
            } else {
                // Resolve baseDepth — store formula if entered
                var baseInput = (data.baseDepth || "").trim();
                if (baseInput === "fill") {
                    newLengthFormula = "fill";
                    // Fill = remaining space, approximate for now
                    newBase = holeLen;
                } else if (isFormula(baseInput)) {
                    newBaseFormula = baseInput;
                    newBase = evaluateFormula(baseInput, ctx);
                    if (newBase == null) {
                        showModalMessage("Formula Error", "Could not evaluate base depth: " + baseInput, "warning");
                        return;
                    }
                } else {
                    newBase = parseFloat(baseInput);
                    if (isNaN(newBase)) newBase = deck.baseDepth;
                }
            }

            // Clamp to hole range
            newTop = Math.max(0, Math.min(holeLen, newTop));
            newBase = Math.max(0, Math.min(holeLen, newBase));
            if (newBase <= newTop) {
                showModalMessage("Deck Error", "Base depth must be greater than top depth.", "warning");
                return;
            }

            // Update deck type
            deck.deckType = data.deckType || deck.deckType;

            // Update product
            var newProductName = data.productName || "";
            if (newProductName && window.loadedProducts) {
                var found = null;
                window.loadedProducts.forEach(function (p) {
                    if (p.name === newProductName) found = p;
                });
                if (found) {
                    deck.product = productSnapshot(found);
                }
            } else if (!newProductName) {
                deck.product = null;
            }

            // Update scaling mode flags
            var newScalingMode = data.scalingMode || DECK_SCALING_MODES.PROPORTIONAL;
            // If "Use Mass" is checked, auto-set Fixed Mass scaling
            if (useMass) {
                deck.isFixedLength = false;
                deck.isFixedMass = true;
                deck.isVariable = false;
                deck.isProportionalDeck = false;
            } else {
                deck.isFixedLength = (newScalingMode === DECK_SCALING_MODES.FIXED_LENGTH);
                deck.isFixedMass = (newScalingMode === DECK_SCALING_MODES.FIXED_MASS);
                deck.isVariable = (newScalingMode === DECK_SCALING_MODES.VARIABLE);
                deck.isProportionalDeck = (newScalingMode === DECK_SCALING_MODES.PROPORTIONAL);
            }

            // Update overlap pattern for DECOUPLED decks
            if (data.overlapPattern != null) {
                var opStr = (data.overlapPattern || "").trim();
                if (opStr) {
                    var parsedOp = {};
                    var opParts = opStr.split(";");
                    for (var opi = 0; opi < opParts.length; opi++) {
                        var kv = opParts[opi].split("=");
                        if (kv.length === 2) {
                            var key = kv[0].trim();
                            var val = parseInt(kv[1].trim());
                            if (!isNaN(val) && (key === "base" || key === "base-1" || key === "n" || key === "top")) {
                                parsedOp[key] = val;
                            }
                        }
                    }
                    deck.overlapPattern = Object.keys(parsedOp).length > 0 ? parsedOp : null;
                } else {
                    deck.overlapPattern = null;
                }
            }

            // Update depths and store formulas
            var oldDeckLen = deck.length; // Capture BEFORE updating depths
            deck.topDepth = parseFloat(newTop.toFixed(3));
            deck.baseDepth = parseFloat(newBase.toFixed(3));
            deck.topDepthFormula = newTopFormula;
            deck.baseDepthFormula = newBaseFormula;
            // Preserve existing lengthFormula if no new formula was derived.
            // This prevents VARIABLE deck formulas from being wiped by Edit Deck.
            if (newLengthFormula != null) {
                deck.lengthFormula = newLengthFormula;
            } else if (newBaseFormula && !newTopFormula) {
                // Base depth formula with no top formula → treat as length formula
                deck.lengthFormula = newBaseFormula;
            } else if (!newBaseFormula && !useMass) {
                // User entered plain numbers — only clear formula if depth actually changed
                var newDeckLen = deck.length;
                if (Math.abs(oldDeckLen - newDeckLen) > 0.01) {
                    deck.lengthFormula = null;
                }
                // Otherwise keep existing deck.lengthFormula (e.g. VARIABLE formula)
            }

            // Adjust the adjacent deck below to absorb the size change
            var nextIdx = workingCharging.decks.indexOf(deck) + 1;
            if (nextIdx < workingCharging.decks.length) {
                workingCharging.decks[nextIdx].topDepth = parseFloat(newBase.toFixed(3));
            }

            workingCharging.modified = new Date().toISOString();
            workingCharging.sortDecks();
            sectionView.setData(workingCharging);
            if (onUpdate) onUpdate();
            if (formulaPanel) formulaPanel.refreshIndexedVars();
        }
    });
    editDialog.show();
}

/**
 * Edit an embedded content item (DecoupledContent) via dialog.
 */
function editEmbeddedContent(workingCharging, sectionView, onUpdate) {
    var di = sectionView._selectedContentDeckIndex;
    var ci = sectionView._selectedContentIndex;
    if (di < 0 || di >= workingCharging.decks.length) return;
    var deck = workingCharging.decks[di];
    if (!deck.contains || ci < 0 || ci >= deck.contains.length) return;
    var content = deck.contains[ci];

    var fields = [
        { label: "Depth from Collar (m)", name: "depthFromCollar", type: "number", value: (content.lengthFromCollar || 0).toFixed(3), step: "0.001" },
        { label: "Length (m)", name: "length", type: "number", value: (content.length || 0).toFixed(3), step: "0.001" },
        { label: "Diameter (mm)", name: "diameterMm", type: "number", value: ((content.diameter || 0) * 1000).toFixed(0), step: "1" },
        { label: "Density (g/cc)", name: "density", type: "number", value: (content.density || 0).toFixed(3), step: "0.001" }
    ];

    var formContent = createEnhancedFormContent(fields);

    var editDialog = new FloatingDialog({
        title: "Edit Embedded Content",
        content: formContent,
        width: 350,
        height: 280,
        showConfirm: true,
        confirmText: "Update",
        showCancel: true,
        onConfirm: function () {
            var data = getFormData(formContent);
            var newDepth = parseFloat(data.depthFromCollar);
            var newLength = parseFloat(data.length);
            var newDiaMm = parseFloat(data.diameterMm);
            var newDensity = parseFloat(data.density);

            if (!isNaN(newDepth)) content.lengthFromCollar = newDepth;
            if (!isNaN(newLength) && newLength > 0) content.length = newLength;
            if (!isNaN(newDiaMm) && newDiaMm > 0) content.diameter = newDiaMm / 1000;
            if (!isNaN(newDensity) && newDensity >= 0) content.density = newDensity;

            workingCharging.modified = new Date().toISOString();
            sectionView.setData(workingCharging);
            if (onUpdate) onUpdate();
        }
    });
    editDialog.show();
}

/**
 * Show rule selection dropdown and apply selected rule
 */
function showRuleSelector(workingCharging, sectionView, refHole, configTracker, formulaPanel) {
    var configs = window.loadedChargeConfigs || new Map();
    if (configs.size === 0) {
        showModalMessage("Apply Rule", "No charge configs loaded. Import a config template first.", "warning");
        return;
    }

    var configOptions = [];
    configs.forEach(function (config, configID) {
        configOptions.push({ value: configID, text: config.configName || configID });
    });

    var fields = [
        { label: "Charge Configuration", name: "configID", type: "select", options: configOptions, value: configOptions[0].value }
    ];
    var formContent = createEnhancedFormContent(fields);

    var ruleDialog = new FloatingDialog({
        title: "Apply Rule",
        content: formContent,
        width: 350,
        height: 220,
        showConfirm: true,
        confirmText: "Apply",
        showCancel: true,
        onConfirm: function () {
            var data = getFormData(formContent);
            var config = configs.get(data.configID);
            if (!config) return;

            // Apply rule via SimpleRuleEngine
            if (typeof window.applyChargeRule === "function") {
                console.log("[ApplyRule] Applying config=" + config.configCode + " to refHole=" + refHole.holeID + " len=" + (refHole.holeLengthCalculated || 0));
                var newCharging = window.applyChargeRule(refHole, config);
                if (newCharging) {
                    workingCharging.decks = newCharging.decks;
                    workingCharging.primers = newCharging.primers;
                    workingCharging.modified = new Date().toISOString();
                    if (configTracker) configTracker.config = config;
                    // Log formula deck info for diagnostics
                    for (var di = 0; di < newCharging.decks.length; di++) {
                        var dk = newCharging.decks[di];
                        if (dk.isVariable || dk.lengthFormula) {
                            console.log("[ApplyRule] deck[" + di + "] isVariable=" + dk.isVariable + " formula='" + dk.lengthFormula + "' len=" + dk.length.toFixed(3));
                        }
                    }
                    sectionView.setData(workingCharging);
                    if (formulaPanel) formulaPanel.refreshIndexedVars();
                }
            } else {
                showModalMessage("Apply Rule", "Rule engine not loaded.", "warning");
            }
        }
    });
    ruleDialog.show();
}

/**
 * Apply working charging to all selected holes.
 * If a charge config was tracked (rule-based), re-run applyChargeRule per hole.
 * Otherwise (manual design), proportionally scale deck depths by hole length ratio.
 */
function applyToSelectedHoles(workingCharging, refHole, configTracker) {
    var targets = [];

    // Gather target holes
    if (window.selectedMultipleHoles && window.selectedMultipleHoles.length > 0) {
        targets = window.selectedMultipleHoles;
    } else if (window.selectedHole) {
        targets = [window.selectedHole];
    } else if (refHole && refHole.holeID !== "VIRTUAL") {
        targets = [refHole];
    }

    if (targets.length === 0) {
        showModalMessage("Apply Charging", "No holes selected. Select holes on the canvas before applying.", "warning");
        return;
    }

    var activeConfig = configTracker ? configTracker.config : null;
    var modeLabel = activeConfig ? "rule-based" : "proportional";

    showConfirmationDialog("Apply Charging", "Apply this charging design (" + modeLabel + ") to " + targets.length + " hole(s)?", "Apply", "Cancel", function () {
        var refLen = Math.abs(workingCharging.holeLength);

        console.log("[ApplyCharging] mode=" + modeLabel + ", targets=" + targets.length + ", refLen=" + refLen + ", activeConfig=" + (activeConfig ? activeConfig.configCode : "null"));

        for (var i = 0; i < targets.length; i++) {
            var hole = targets[i];

            var hc;

            if (activeConfig && typeof window.applyChargeRule === "function") {
                // Re-run the rule engine for each target hole individually
                try {
                    hc = window.applyChargeRule(hole, activeConfig);
                } catch (ruleErr) {
                    console.error("[ApplyCharging] applyChargeRule threw for hole " + hole.holeID + ":", ruleErr);
                    hc = null;
                }
                if (!hc) {
                    // Fallback: proportional scale if rule fails
                    console.warn("[ApplyCharging] Rule returned null for hole " + hole.holeID + ", falling back to scale");
                    hc = scaleChargingToHole(workingCharging, hole, refLen);
                }
            } else {
                // Manual design or no config tracked: scale deck depths with formula re-evaluation
                hc = scaleChargingToHole(workingCharging, hole, refLen);
            }

            // Log first deck length for diagnostic tracing
            if (hc && hc.decks && hc.decks.length > 0) {
                var firstDk = hc.decks[0];
                console.log("[ApplyCharging] hole=" + hole.holeID + " len=" + (hole.holeLengthCalculated || 0).toFixed(2) + " → deck[0]=" + firstDk.topDepth.toFixed(3) + "-" + firstDk.baseDepth.toFixed(3) + " (" + (firstDk.isVariable ? "VR" : firstDk.isFixedLength ? "FL" : "PR") + ")");
            }

            if (!window.loadedCharging) {
                window.loadedCharging = new Map();
            }
            window.loadedCharging.set(chargingKey(hole), hc);
        }

        // Recalculate massPerHole for all holes
        if (typeof window.recalcMassPerHole === "function") {
            window.recalcMassPerHole();
        }

        // Invalidate analysis caches so 3D Voronoi rebuilds with new mass data
        if (typeof window.bumpDataVersion === "function") {
            window.bumpDataVersion();
        }
        if (typeof window.invalidate3DAnalysisCaches === "function") {
            window.invalidate3DAnalysisCaches();
        }

        // Save to IndexedDB (charging data + blast hole data for per-hole overrides)
        if (typeof window.debouncedSaveCharging === "function") {
            window.debouncedSaveCharging();
        }
        if (typeof window.debouncedSaveHoles === "function") {
            window.debouncedSaveHoles();
        }

        // Redraw
        if (typeof window.drawData === "function") {
            window.drawData(window.allBlastHoles, window.selectedHole);
        }

        showModalMessage("Charging Applied", "Applied charging (" + modeLabel + ") to " + targets.length + " hole(s).", "success");
    });
}

/**
 * Scale a charging design from a reference hole to a target hole.
 * Uses a two-pass approach respecting per-deck scaling flags:
 *   - isFixedLength decks: keep their length unchanged
 *   - isFixedMass decks: recalculate length from mass at new diameter
 *   - isProportionalDeck decks: share remaining space proportionally
 *
 * @param {HoleCharging} sourceCharging - The reference charging design
 * @param {Object} targetHole - The target blast hole
 * @param {number} refLen - The reference hole length
 * @returns {HoleCharging} New HoleCharging sized for the target hole
 */
function scaleChargingToHole(sourceCharging, targetHole, refLen) {
    var chargingJSON = sourceCharging.toJSON();
    var clone = JSON.parse(JSON.stringify(chargingJSON));

    var targetLen = Math.abs(targetHole.holeLengthCalculated || 0);
    var targetDiameter = targetHole.holeDiameter || sourceCharging.holeDiameterMm;
    clone.holeID = targetHole.holeID;
    clone.entityName = targetHole.entityName;
    clone.holeDiameterMm = targetDiameter;
    clone.holeLength = targetLen;

    if (clone.decks && clone.decks.length > 0) {
        // Pass 1: classify decks and calculate fixed totals
        var fixedTotal = 0;
        var oldProportionalTotal = 0;
        var proportionalIndices = [];

        for (var d = 0; d < clone.decks.length; d++) {
            var deck = clone.decks[d];
            var deckLen = Math.abs(deck.baseDepth - deck.topDepth);

            if (deck.isFixedLength) {
                fixedTotal += deckLen;
            } else if (deck.isFixedMass) {
                // Recalculate length from mass at new diameter
                var density = deck.averageDensity || (deck.product ? deck.product.density || 0 : 0);
                if (density > 0 && sourceCharging.holeDiameterMm > 0) {
                    var oldR = (sourceCharging.holeDiameterMm / 1000) / 2;
                    var oldMass = Math.PI * oldR * oldR * deckLen * density * 1000;
                    var newR = (targetDiameter / 1000) / 2;
                    var newArea = Math.PI * newR * newR;
                    var kgPerMetre = density * 1000 * newArea;
                    if (kgPerMetre > 0) {
                        deckLen = oldMass / kgPerMetre;
                    }
                }
                fixedTotal += deckLen;
                deck._recalcLength = deckLen;
            } else if (deck.isVariable && deck.lengthFormula) {
                // Variable: re-evaluate formula with target hole context
                var formulaCtx = {
                    holeLength: targetLen,
                    holeDiameter: targetDiameter,
                    benchHeight: targetHole.benchHeight || 0,
                    subdrillLength: targetHole.subdrillLength || 0
                };
                var fLen = evaluateFormula(deck.lengthFormula, formulaCtx);
                var varLen = (fLen != null && fLen > 0) ? fLen : deckLen;
                console.log("[ScaleCharging] VR deck formula='" + deck.lengthFormula + "' holeLen=" + targetLen + " → " + varLen.toFixed(3));
                fixedTotal += varLen;
                deck._recalcLength = varLen;
            } else {
                oldProportionalTotal += deckLen;
                proportionalIndices.push(d);
            }
        }

        // Pass 2: layout sequentially from collar
        var remainingSpace = Math.max(0, targetLen - fixedTotal);
        var proportionalRatio = oldProportionalTotal > 0 ? remainingSpace / oldProportionalTotal : 1;
        var cursor = 0;

        for (var j = 0; j < clone.decks.length; j++) {
            var dk = clone.decks[j];
            var oldLen = Math.abs(dk.baseDepth - dk.topDepth);
            var newLen;

            if (dk.isFixedLength) {
                newLen = oldLen;
            } else if (dk.isFixedMass) {
                newLen = dk._recalcLength || oldLen;
                delete dk._recalcLength;
            } else if (dk.isVariable) {
                newLen = dk._recalcLength || oldLen;
                delete dk._recalcLength;
            } else {
                newLen = oldLen * proportionalRatio;
            }

            // Truncate if exceeding hole length
            if (cursor + newLen > targetLen) {
                newLen = Math.max(0, targetLen - cursor);
            }

            // Ensure minimum deck thickness
            if (newLen < 0.01 && j < clone.decks.length - 1) {
                newLen = 0.01;
            }

            dk.topDepth = cursor;
            dk.baseDepth = cursor + newLen;

            // Scale embedded content positions within the deck
            if (dk.contains && dk.contains.length > 0 && oldLen > 0) {
                var contentRatio = newLen / oldLen;
                for (var ci = 0; ci < dk.contains.length; ci++) {
                    if (dk.contains[ci].lengthFromCollar != null) {
                        var relPos = dk.contains[ci].lengthFromCollar - dk.topDepth;
                        dk.contains[ci].lengthFromCollar = cursor + relPos * contentRatio;
                    }
                }
            }

            cursor += newLen;
        }

        // Clamp last deck to hole bottom
        clone.decks[clone.decks.length - 1].baseDepth = targetLen;
    }

    // Scale primer depths proportionally
    var overallRatio = refLen > 0 ? targetLen / refLen : 1;
    if (clone.primers && clone.primers.length > 0) {
        for (var p = 0; p < clone.primers.length; p++) {
            var primer = clone.primers[p];
            primer.lengthFromCollar = Math.max(0, Math.min(targetLen - 0.1, primer.lengthFromCollar * overallRatio));
        }
    }

    return HoleCharging.fromJSON(clone);
}

/**
 * Show a dialog to save the current deck layout as a reusable ChargeConfig rule.
 * Extracts deck layout into typed deck arrays (inertDeckArray, etc.) with scaling flags.
 */
function showSaveAsRuleDialog(workingCharging, configTracker) {
    if (!workingCharging || workingCharging.decks.length === 0) {
        showModalMessage("Save as Rule", "No decks to save. Build a charging design first.", "warning");
        return;
    }

    var holeLen = Math.abs(workingCharging.holeLength);

    // Build list of charge decks with deck array position index for primer formula generation
    var chargeDecks = [];
    for (var ci = 0; ci < workingCharging.decks.length; ci++) {
        var cd = workingCharging.decks[ci];
        if (cd.deckType === DECK_TYPES.COUPLED || cd.deckType === DECK_TYPES.DECOUPLED) {
            chargeDecks.push({ index: ci + 1, topDepth: cd.topDepth, baseDepth: cd.baseDepth });
        }
    }

    // Auto-generate a config code like CUSTOM1, CUSTOM2, etc.
    var nextCode = "CUSTOM1";
    if (window.loadedChargeConfigs) {
        var maxNum = 0;
        window.loadedChargeConfigs.forEach(function (cfg) {
            var code = cfg.configCode || "";
            var match = code.match(/^CUSTOM(\d+)$/i);
            if (match) {
                var num = parseInt(match[1]);
                if (num > maxNum) maxNum = num;
            }
        });
        nextCode = "CUSTOM" + (maxNum + 1);
    }

    var fields = [
        { key: "configCode", label: "Config Code", type: "text", value: nextCode },
        { key: "configName", label: "Rule Name", type: "text", value: "Custom Rule" },
        { key: "description", label: "Description", type: "text", value: "" }
    ];

    // Add editable top/base depth formula fields per deck
    for (var di = 0; di < workingCharging.decks.length; di++) {
        var deck = workingCharging.decks[di];
        var productName = deck.product ? deck.product.name : "Empty";
        var deckLabel = "[" + (di + 1) + "] " + deck.deckType + " - " + productName;

        if (deck.deckType === DECK_TYPES.SPACER) {
            // Spacer: only top field (base derived from product length)
            var defaultTop = deck.topDepthFormula || String(parseFloat(deck.topDepth.toFixed(3)));
            fields.push({
                key: "deckTop_" + di,
                label: deckLabel + " Top",
                type: "text",
                value: defaultTop
            });
        } else {
            // Non-spacer: top and base fields
            var defaultTopVal = deck.topDepthFormula || String(parseFloat(deck.topDepth.toFixed(3)));
            var defaultBaseVal = deck.baseDepthFormula || String(parseFloat(deck.baseDepth.toFixed(3)));
            fields.push({
                key: "deckTop_" + di,
                label: deckLabel + " Top",
                type: "text",
                value: defaultTopVal
            });
            fields.push({
                key: "deckBase_" + di,
                label: deckLabel + " Base",
                type: "text",
                value: defaultBaseVal
            });
        }

        // Swap field for all deck types
        fields.push({
            key: "deckSwap_" + di,
            label: deckLabel + " Swap",
            type: "text",
            value: deck.swap || "",
            placeholder: "e.g. w{WR-ANFO}|r{Emulsion}|t{Emulsion,C>50}"
        });
    }

    // Add dynamic primer depth formula fields with smart defaults
    if (workingCharging.primers && workingCharging.primers.length > 0) {
        for (var pi = 0; pi < workingCharging.primers.length; pi++) {
            var p = workingCharging.primers[pi];
            var primerD = p.lengthFromCollar || 0;
            var defaultFormula;

            // Use existing depthFormula if available
            if (p.depthFormula) {
                defaultFormula = p.depthFormula;
            } else {
                // Find which charge deck contains this primer
                var containingDeck = null;
                for (var cdi = 0; cdi < chargeDecks.length; cdi++) {
                    if (primerD >= chargeDecks[cdi].topDepth - 0.01 && primerD <= chargeDecks[cdi].baseDepth + 0.01) {
                        containingDeck = chargeDecks[cdi];
                        break;
                    }
                }

                if (containingDeck) {
                    var offset = containingDeck.baseDepth - primerD;
                    var offsetRounded = Math.round(offset * 100) / 100;
                    if (chargeDecks.length > 1) {
                        defaultFormula = "fx:chargeBase[" + containingDeck.index + "] - " + offsetRounded;
                    } else {
                        defaultFormula = "fx:chargeBase - " + offsetRounded;
                    }
                } else {
                    var fraction = holeLen > 0 ? primerD / holeLen : 0.9;
                    var rounded = Math.round(fraction * 1000) / 1000;
                    defaultFormula = "fx:holeLength * " + rounded;
                }
            }

            fields.push({
                key: "primerDepth_" + pi,
                label: "Primer " + (pi + 1) + " Depth (" + primerD.toFixed(1) + "m)",
                type: "text",
                value: defaultFormula
            });
        }
    }

    var formContent = createEnhancedFormContent(fields);

    var primerCount = workingCharging.primers ? workingCharging.primers.length : 0;
    var deckCount = workingCharging.decks.length;
    // Two fields per non-spacer deck (top + base), one field per spacer
    var spacerCount = 0;
    for (var sc = 0; sc < workingCharging.decks.length; sc++) {
        if (workingCharging.decks[sc].deckType === DECK_TYPES.SPACER) spacerCount++;
    }
    var nonSpacerCount = deckCount - spacerCount;
    var saveDialogHeight = 220 + nonSpacerCount * 80 + spacerCount * 40 + deckCount * 40 + primerCount * 50;

    var dialog = new FloatingDialog({
        title: "Save as Rule",
        content: formContent,
        width: 420,
        height: saveDialogHeight,
        showConfirm: true,
        confirmText: "Save",
        showCancel: true,
        cancelText: "Cancel",
        onConfirm: function () {
            var data = getFormData(formContent);

            // Build typed deck arrays from current decks using editable formula fields
            var inertDeckArray = [];
            var coupledDeckArray = [];
            var decoupledDeckArray = [];
            var spacerDeckArray = [];

            for (var i = 0; i < workingCharging.decks.length; i++) {
                var deck = workingCharging.decks[i];
                var idx = i + 1;

                var entry = {
                    idx: idx,
                    type: deck.deckType,
                    product: deck.product ? deck.product.name : "Air",
                    isFixedLength: deck.isFixedLength || false,
                    isFixedMass: deck.isFixedMass || false,
                    isVariable: deck.isVariable || false,
                    isProportionalDeck: deck.isProportionalDeck !== false
                };

                if (deck.deckType === DECK_TYPES.SPACER) {
                    // Spacer: only top field
                    entry.top = (data["deckTop_" + i] || "0").trim();
                } else {
                    // Non-spacer: read top and base from form fields
                    entry.top = (data["deckTop_" + i] || "0").trim();
                    entry.base = (data["deckBase_" + i] || "fx:holeLength").trim();
                }

                // Copy overlap pattern if present
                if (deck.overlapPattern) {
                    entry.overlapPattern = deck.overlapPattern;
                }

                // Read swap field from form
                var swapVal = (data["deckSwap_" + i] || "").trim();
                if (swapVal) entry.swap = swapVal;

                switch (deck.deckType) {
                    case DECK_TYPES.INERT: inertDeckArray.push(entry); break;
                    case DECK_TYPES.COUPLED: coupledDeckArray.push(entry); break;
                    case DECK_TYPES.DECOUPLED: decoupledDeckArray.push(entry); break;
                    case DECK_TYPES.SPACER: spacerDeckArray.push(entry); break;
                }
            }

            // Build primerArray from workingCharging.primers with formula depths
            var primerArray = [];
            if (workingCharging.primers && workingCharging.primers.length > 0) {
                for (var pi = 0; pi < workingCharging.primers.length; pi++) {
                    var p = workingCharging.primers[pi];
                    var depthField = (data["primerDepth_" + pi] || "").trim();
                    var depthValue;

                    if (depthField.indexOf("fx:") === 0) {
                        depthValue = depthField;
                    } else if (depthField !== "" && !isNaN(parseFloat(depthField))) {
                        depthValue = parseFloat(depthField);
                    } else {
                        var fallbackFraction = holeLen > 0 ? p.lengthFromCollar / holeLen : 0.9;
                        depthValue = "fx:holeLength * " + (Math.round(fallbackFraction * 1000) / 1000);
                    }

                    primerArray.push({
                        depth: depthValue,
                        detonator: p.detonator ? p.detonator.productName : null,
                        booster: p.booster ? p.booster.productName : null,
                        delayMs: p.detonator ? (p.detonator.delayMs || 0) : 0
                    });
                }
            }

            var totalDecks = inertDeckArray.length + coupledDeckArray.length +
                decoupledDeckArray.length + spacerDeckArray.length;

            var configCode = (data.configCode || "").trim().toUpperCase() || nextCode;

            // Check for duplicate configCode
            var existingKey = null;
            if (window.loadedChargeConfigs) {
                window.loadedChargeConfigs.forEach(function (cfg, key) {
                    if ((cfg.configCode || "").toUpperCase() === configCode) {
                        existingKey = key;
                    }
                });
            }

            function doSave(overwriteKey) {
                var opts = {
                    configCode: configCode,
                    configName: data.configName || "Custom Rule",
                    description: data.description || "",
                    inertDeckArray: inertDeckArray,
                    coupledDeckArray: coupledDeckArray,
                    decoupledDeckArray: decoupledDeckArray,
                    spacerDeckArray: spacerDeckArray,
                    primerArray: primerArray
                };
                // If overwriting, reuse the existing configID
                if (overwriteKey) opts.configID = overwriteKey;
                var savedConfig = new ChargeConfig(opts);

                if (!window.loadedChargeConfigs) {
                    window.loadedChargeConfigs = new Map();
                }
                if (overwriteKey) {
                    window.loadedChargeConfigs.delete(overwriteKey);
                }
                window.loadedChargeConfigs.set(savedConfig.configID, savedConfig);

                if (typeof window.debouncedSaveConfigs === "function") {
                    window.debouncedSaveConfigs();
                }
                if (configTracker) {
                    configTracker.config = savedConfig;
                }
                var action = overwriteKey ? "overwritten" : "saved";
                showModalMessage("Rule Saved", '"' + savedConfig.configName + '" ' + action + " with " + totalDecks + " deck template.", "success");
            }

            if (existingKey) {
                showConfirmationDialog(
                    "Config Code Exists",
                    'A rule with code "' + configCode + '" already exists. Overwrite it, or rename your new rule?',
                    "Overwrite",
                    "Cancel",
                    function () { doSave(existingKey); },
                    null
                );
            } else {
                doSave(null);
            }
        }
    });
    dialog.show();
}

