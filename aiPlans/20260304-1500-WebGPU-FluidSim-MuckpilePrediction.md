# Backlog: WebGPU Fluid Simulation for Blast Movement & Muckpile Prediction

**Date:** 2026-03-04  
**Status:** Backlog  
**Priority:** Low (Research / Future Feature)  
**Category:** Blast Analytics Enhancement

---

## Objective

Investigate and incorporate a WebGPU-based fluid simulation model into Kirra BlastAnalytics for:
- **Blast movement simulation** (rock mass displacement after detonation)
- **Muckpile prediction** (final resting shape/location of blasted material)

## Reference Project

- **WebGPU-Ocean** by matsuoka-601: https://github.com/matsuoka-601/WebGPU-Ocean
- **Live Demo:** https://webgpu-ocean.netlify.app/
- **Article:** https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/

## Key Techniques from Reference

| Technique | Description |
|-----------|-------------|
| **MLS-MPM** (Moving Least Squares Material Point Method) | Hybrid particle+grid simulation; no neighbourhood search needed; ~100k particles real-time on iGPU |
| **Screen-Space Fluid Rendering (SSFR)** | Renders smooth fluid surface in screen space without mesh generation |
| **P2G via atomicAdd** | Particle-to-Grid scatter using fixed-point integers in WebGPU compute shaders |
| **WebGPU Compute Shaders** | GPGPU for physics; far more accessible than WebGL for this workload |

## Why This Fits Kirra

1. Kirra already has a 3D WebGL/ThreeJS pipeline with blast analysis shaders.
2. Muckpile shape prediction is a natural extension of the existing blast analytics (PPV, energy, fragmentation).
3. MLS-MPM can model granular/soil-like materials (Disney used MPM for snow in Frozen), making it suitable for rock mass movement.
4. WebGPU is becoming available in modern browsers and would complement existing WebGL rendering.

## Research Tasks

- [ ] Evaluate WebGPU browser support across target user base
- [ ] Prototype MLS-MPM in a standalone test page using Kirra's coordinate system (UTM/mine grid)
- [ ] Adapt constitutive model from fluid to granular material (rock mass properties)
- [ ] Determine how blast energy/timing data feeds into particle initial velocities
- [ ] Benchmark particle counts achievable on target hardware (laptops with iGPU)
- [ ] Investigate integration path: WebGPU compute + ThreeJS rendering, or full WebGPU pipeline
- [ ] Evaluate SSFR vs Marching Cubes for muckpile visualisation (muckpile is opaque, not fluid)

## Integration Considerations

- Kirra uses ThreeJS with WebGL; WebGPU would be a separate compute pipeline feeding back into the 3D scene
- Blast hole positions, timing, and charge energy are already available in `allBlastHoles`
- Free face geometry and bench height define boundary conditions
- Output would be a predicted muckpile surface (triangulated mesh) or particle cloud

## Risks

- WebGPU not yet universally supported (Safari, older browsers)
- Rock mass is not a fluid; constitutive model needs careful selection
- Computational cost may be too high for large blast patterns on low-end hardware
- Research-heavy; significant effort before any usable feature

## Notes

- This is a **long-term backlog item** for future investigation
- Consider as a potential differentiator for Kirra in blast design software market
- Could also be applied to flyrock trajectory prediction (already has shroud generator)
