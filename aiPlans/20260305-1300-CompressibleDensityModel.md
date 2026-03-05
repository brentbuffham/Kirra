# Compressible Emulsion Density Model Plan
Date: 2026-03-05

## Background

Gassed emulsion explosives (e.g., Orica Fortis, Dyno Nobel Titan) achieve target density by chemically generating N2 gas bubbles via a gassing agent (sodium nitrite + acidifier). Once in the blast hole, hydrostatic pressure from the column above compresses the gas bubbles at depth, creating a density gradient -- lighter at the top, denser at the bottom.

This matters because:
- Mass calculation is wrong if you use a single flat density
- At depth, density can exceed the **critical density** (dead-pressing threshold) where the emulsion desensitises and may fail to detonate
- Powder factor varies along the hole length
- Water above the explosive adds additional hydrostatic head

## Reference: Your Spreadsheet Model

From `Compression of Gasses in Volume.xlsx`, the existing model uses these parameters:

| Named Range | Cell | Description | Default |
|---|---|---|---|
| `L_DESN` (Limiting Density) | B3 | Matrix density without gas (g/cc) | 1.34 |
| `C_DENS` (Cap Density) | B4 | Density at top of column at 1 ATM (g/cc) | 1.15 |
| `MAN_ADJ` (Manual Adjustment) | B5 | Additional ATM from external pressure (e.g. water) | 0 |
| `INT_SPACE` (Interval) | B6 | Step size for iterative calculation (m) | 1 |
| `ATM` | B7 | Atmospheric pressure (ATM units) | 1 |
| `ATMS_PA` | B9 | 1 ATM in Pascals | 101325 |
| `PAS_ATM` | B10 | Pascals to ATM conversion | 1/101325 |
| `CRIT_DENS` (Critical Density) | B11 | Dead-pressing threshold (g/cc) | 1.29 |
| `DIAM` | B8 | Hole diameter (mm) | 114 |

### The Core Formulas (from your spreadsheet)

**Pressure at depth h (in ATM):**
```
P(h) = MAN_ADJ + ((C_DENS * 9.80665) * (h * 1000) + ATMS_PA) * PAS_ATM
```
Expanding: `P(h) = MAN_ADJ + (C_DENS * 9.80665 * h * 1000 + 101325) / 101325`

Simplified: `P(h) = MAN_ADJ + 1 + (C_DENS * 9.80665 * h * 1000) / 101325`

This is the hydrostatic pressure = 1 ATM + column weight, converted to ATM units.

Note: Your spreadsheet uses `C_DENS` (cap density) as the column density for pressure calculation at all depths. This is a simplification -- a fully self-consistent model would use the running average density (see iterative approach below).

**Density at depth h:**
```
rho(h) = ROUND(1 / (1/L_DESN + (1/C_DENS - 1/L_DESN) / P(h)), 2)
```

This is derived from Boyle's Law applied to the gas void fraction:
- At P=1 ATM (top): density = C_DENS (cap density)
- As P -> infinity: density -> L_DESN (limiting/matrix density, all gas compressed out)
- The `(1/C_DENS - 1/L_DESN)` term represents the specific volume contribution of the gas at 1 ATM

**Average density over column length h:**
```
E(h) = AVERAGE(rho(0), rho(1), ..., rho(h))    // running average of all density values
```

**Cumulative mass to depth h:**
```
M(h) = PI * (DIAM/2/1000)^2 * h * E(h) * 1000   // kg
```

**Mass increment per interval:**
```
dM(h) = M(h+1) - M(h)
```

**Critical density flag:**
```
isCritical(h) = rho(h) >= CRIT_DENS
```

### Data from Spreadsheet (114mm hole, cap=1.15, limiting=1.34)

| Depth(m) | Density(g/cc) | Pressure(ATM) | Avg Density | Cum Mass(kg) | Critical? |
|---|---|---|---|---|---|
| 0 | 1.15 | 1.00 | 1.15 | 0.0 | NO |
| 5 | 1.21 | 1.56 | 1.18 | 60.4 | NO |
| 10 | 1.24 | 2.11 | 1.21 | 123.0 | NO |
| 15 | 1.26 | 2.67 | 1.22 | 187.0 | NO |
| 20 | 1.27 | 3.23 | 1.23 | 251.6 | NO |
| 25 | 1.28 | 3.78 | 1.24 | 316.8 | NO |
| 26 | 1.29 | 3.89 | 1.24 | 330.0 | YES |
| 30 | 1.29 | 4.34 | 1.25 | 382.6 | YES |
| 40 | 1.30 | 5.45 | 1.26 | 514.8 | YES |

## Physics Model

### Boyle's Law for Gas Bubble Compression

A gassed emulsion is a two-phase system: liquid matrix + gas bubbles.

At the top of the column (1 ATM):
```
phi_0 = 1 - (rho_cap / rho_matrix)     // void fraction at surface
```

At depth h, bubbles compress per Boyle's Law:
```
phi(h) = phi_0 * P_atm / P(h)
rho(h) = rho_matrix * (1 - phi(h))
```

Which gives the same formula as your spreadsheet:
```
rho(h) = 1 / (1/rho_matrix + (1/rho_cap - 1/rho_matrix) / P(h))
```

### Self-Consistent Iterative Model (More Accurate)

Your spreadsheet uses cap density for the pressure calculation at all depths. A more rigorous approach iterates:

```
dh = 0.1m (or configurable interval)
P = P_atm + rho_water * g * h_water    // initial pressure (add water head if present)

For each step from top of column to bottom:
    phi = phi_0 * P_atm / P
    rho = rho_matrix * (1 - phi)
    P = P + rho * g * dh               // use LOCAL density for pressure increment
```

The difference is small for short columns (<10m) but becomes significant for deep holes (>20m) because the increasing density feeds back into the pressure calculation.

### Water Column Effect

If the blast hole has water above the explosive column:
```
P_initial = P_atm + rho_water * g * h_water
```
Where `rho_water` = 1000 kg/m3. 10m of water = ~1 additional ATM.

This is what your `MAN_ADJ` parameter handles (expressed in ATM).

### Temperature Effect

The ideal gas law `PV = nRT` means bubble volume scales with temperature:
```
V(T) = V(T_ref) * T / T_ref     // T in Kelvin
```

For practical purposes, a temperature correction factor can be applied:
```
phi_0(T) = phi_0(T_ref) * (T / T_ref)
```

This shifts the entire density profile up or down. Hotter = more gas expansion = lower cap density. Colder = less expansion = higher cap density.

## Implementation Plan

### Phase 1: Core Calculation Engine

Create `src/charging/CompressibleDensityModel.js`:

```javascript
/**
 * Compressible Density Model for Gassed Emulsion Explosives
 * Implements hydrostatic compression of gas bubbles using Boyle's Law
 */

Input parameters (on BulkExplosiveProduct or Deck):
  - limitingDensity    (g/cc) - Matrix density without gas (1.30-1.45 typical)
  - capDensity         (g/cc) - Target density at top of column (0.80-1.20 typical)
  - criticalDensity    (g/cc) - Dead-pressing threshold (1.25-1.35 typical)
  - temperatureK       (K)    - Optional, for gas law correction (default: 293K = 20C)
  - referenceTemperatureK (K) - Temperature at which capDensity was measured

Hole parameters (from Deck / HoleCharging):
  - columnLength       (m)    - Length of the explosive column
  - waterHeadM         (m)    - Water column above explosive (0 if dry)
  - holeDiameterMm     (mm)   - For mass/volume calculation

Functions:
  densityAtDepth(h)            -> density in g/cc at depth h from top of column
  pressureAtDepth(h)           -> pressure in ATM at depth h
  averageDensity(H)            -> average density over column length H
  totalMass(H, diameterMm)     -> integrated mass in kg
  densityProfile(H, interval)  -> array of {depth, density, pressure, avgDensity, mass, isCritical}
  criticalDepth()              -> depth at which critical density is first exceeded (or null)
```

### Phase 2: Integration with Deck and HoleCharging

Update `Deck.js`:
- When `isCompressible === true`, `calculateMass()` uses the density model instead of flat density
- `effectiveDensity` getter returns the column-average density from the model
- Add `densityProfile()` method that returns the full depth-density-mass profile

Update `BulkExplosiveProduct.js`:
- Add `limitingDensity`, `criticalDensity` properties
- These are product-level defaults that can be overridden per-deck

Update `HoleCharging.js`:
- `getTotalExplosiveMass()` uses integrated mass for compressible decks
- Add method to get critical density warnings

### Phase 3: UI - Deck Builder Integration

Update `DeckBuilderDialog.js`:
- When product `isCompressible === true`, show additional fields:
  - Limiting Density (g/cc)
  - Cap Density (g/cc)
  - Critical Density (g/cc)
  - Water Head (m) - additional pressure from water above
- Show a mini density profile preview (sparkline or table)
- Show warning if critical density is exceeded within the column

### Phase 4: UI - Section View Visualization

Update `HoleSectionView.js`:
- For compressible decks, render a colour gradient along the deck length showing density variation
- Show the critical density depth as a dashed line/marker
- Tooltip at any depth shows: density, pressure, cumulative mass

### Phase 5: Export Integration

- `buildChargingColumns()` already handles mass per deck -- with compressible model, the mass will be more accurate
- Add optional `designDensityProfile` column to custom CSV: `DENS{[0m]1.15|[5m]1.21|[10m]1.24|...}`
- Charging Summary CSV: add `criticalDepthM` column

## Key Design Decisions

1. **Simplified vs Self-Consistent Model**: Start with your spreadsheet's simplified approach (cap density for pressure calc). Offer self-consistent iterative as an option.

2. **Step Interval**: Default 0.1m for accuracy, configurable. Your spreadsheet uses 1m which is adequate for most practical purposes.

3. **Water Column**: Expressed in metres of water head above the explosive. Converted to additional ATM internally.

4. **Temperature**: Optional. Most sites use a single seasonal temperature. Default 20C.

5. **Where parameters live**:
   - `limitingDensity`, `criticalDensity` on `BulkExplosiveProduct` (product defaults)
   - `capDensity`, `waterHeadM` on `Deck` (per-deck overrides for specific hole conditions)
   - The model reads product defaults but allows deck-level overrides

## References

- Your spreadsheet: `src/referenceFiles/XLSX/Compression of Gasses in Volume.xlsx`
- D144 Blast Design: `src/referenceFiles/XLSX/D144 Blast Design 2025 PORTRAIT.xlsm`
- Persson, Holmberg & Lee - "Rock Blasting and Explosives Engineering" (CRC Press) - Emulsion sensitization
- ISEE Blasters' Handbook - Bulk emulsion hydrostatic density effects
- Orica Fortis Technical Bulletins - Gassed emulsion density-depth relationships
- Dyno Nobel Explosives Engineers' Guide - Emulsion density creep
- Esen, S. (2008) - "A Non-ideal Detonation Model for Evaluating the Performance of Explosives in Rock Blasting"
- Boyle's Law: P1*V1 = P2*V2 at constant temperature
