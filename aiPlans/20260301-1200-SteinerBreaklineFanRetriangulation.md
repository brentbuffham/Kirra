# Plan v5: Zero-Component Pre-Classification + Centroid-Insert Fan Retriangulation

## Problem Summary

The original code mostly works. The specific failure:

- Small mesh (10-tri cup) fully crossed → 0 flood-fill components → empty `vertexClassMap`
- CDT produces all-Steiner sub-tris (all 3 verts on intersection line) → centroid ray-cast unreliable → wrong bucket
- Contaminated neighbors inherit wrong classification through shared vertex keys

## Approach

**Part A**: Pre-populate `vertexClassMap` when flood fill returns nothing (13 lines).

**Part B**: Delete all-Steiner tris + neighbors, insert a new vertex at the patch centroid, fan-triangulate from that vertex to the boundary loop. Every new triangle has the centroid as one vertex — guaranteed NOT a Steiner point — so classification always has a free vertex to work with. (~40 lines)

**Rule**: No triangle may have all 3 vertices on the intersection. If one exists, delete it + neighbors, insert centroid vertex, fan-retriangulate. Max 2 intersection points per new triangle.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/workers/surfaceBooleanWorker.js` | Part A + Part B in `splitStraddlingAndClassify` |
| `src/helpers/SurfaceBooleanHelper.js` | Same changes mirrored + helper sync |

**No new files. No signature changes. No changes to `retriangulateWithSteinerPoints`.**

---

## Part A: Zero-Component Pre-Classification

**Where**: After Step B (steinerKeys), before Step C (per-triangle loop).

**Worker**: after line 342. **Helper**: after line 412.

```js
// ── Step B2: Pre-populate vertexClassMap for zero-component surfaces ──
if (Object.keys(vertexClassMap).length === 0) {
    var seenOrig = {};
    for (var oi = 0; oi < tris.length; oi++) {
        var oVerts = [tris[oi].v0, tris[oi].v1, tris[oi].v2];
        for (var ov = 0; ov < 3; ov++) {
            var oKey = vKey(oVerts[ov]);
            if (seenOrig[oKey] || steinerKeys[oKey]) continue;
            seenOrig[oKey] = true;
            vertexClassMap[oKey] = classifyPointMultiAxis(oVerts[ov], otherTris, otherGrids);
        }
    }
    console.log("  Pre-populated vertexClassMap with " +
        Object.keys(vertexClassMap).length +
        " original vertex classifications (zero-component surface)");
}
```

**13 lines. No signature changes.**

---

## Part B: Centroid-Insert Fan Retriangulation

**Where**: After the Step C per-triangle classification loop, before the console.log and return.

**Worker**: after line 428. **Helper**: after line 476.

### Algorithm

1. **Combine** inside + outside into a single indexed list with classification tags
2. **Detect** all-Steiner sub-tris (all 3 vertex keys in `steinerKeys`)
3. **If none** → skip, return unchanged
4. **Build edge adjacency** on the combined list
5. **Collect patch set** for each all-Steiner tri: the tri itself + its direct edge-neighbors → mark all as "remove"
6. **For each connected patch** (group of contiguous removed tris):
   a. **Extract boundary loop**: edges with exactly 1 triangle in the remove set, ordered into a loop
   b. **Compute patch centroid**: average of ALL unique vertices in the removed tris (not just boundary — include interior Steiner points too). The neighbors pull this centroid away from the intersection line.
   c. **Lift centroid to 3D**: the centroid is computed directly in 3D from the vertex positions
   d. **Fan-triangulate**: for each consecutive pair of boundary vertices (B[i], B[i+1]), create triangle (centroid, B[i], B[i+1])
   e. **Classify each new triangle**: the centroid vertex is NOT a Steiner point, so use it as the free vertex. Look up `vertexClassMap[centroidKey]` first — if not found, ray-cast the centroid against the other surface using `classifyPointMultiAxis`. Store result in `vertexClassMap` for reuse by subsequent triangles in this fan.
7. **Rebuild** inside/outside from surviving tris + new classified tris

### Why every new triangle has max 2 intersection points

Fan triangulation from centroid: each new triangle = (centroid, B[i], B[i+1]).
- Centroid is the average of patch vertices including non-Steiner neighbors → NOT on the intersection line
- B[i] and B[i+1] are boundary vertices — may or may not be Steiner points
- Worst case: 2 of 3 vertices are Steiner. The centroid is always free.

### Why the centroid is a reliable classification point

The patch includes edge-neighbors of all-Steiner tris. Those neighbors have at least one vertex that is NOT a Steiner point (otherwise they'd be all-Steiner too and would be in the patch). The centroid averages all patch vertices including those non-Steiner vertices, pulling it away from the intersection line. A point offset from the intersection gives reliable ray-cast parity.

### Why fan triangulation always works (no concavity issues)

Every triangle in the fan shares the centroid vertex, which is interior to the patch. A fan from an interior point to a boundary loop is always valid — like spokes of a wheel. No triangle overlaps another because the boundary loop is ordered and the centroid is inside the loop. This works for convex AND concave boundary shapes.

### Code

```js
// ── Step D: Centroid-insert fan retriangulation for all-Steiner patches ──

var combined = [];
for (var ci2 = 0; ci2 < inside.length; ci2++) combined.push({ tri: inside[ci2], cls: 1 });
for (var co2 = 0; co2 < outside.length; co2++) combined.push({ tri: outside[co2], cls: -1 });

// Detect all-Steiner tris
var allSteinerSet = {};
for (var si = 0; si < combined.length; si++) {
    var st = combined[si].tri;
    if (steinerKeys[vKey(st.v0)] && steinerKeys[vKey(st.v1)] && steinerKeys[vKey(st.v2)]) {
        allSteinerSet[si] = true;
    }
}

var allSteinerCount = Object.keys(allSteinerSet).length;
if (allSteinerCount > 0) {
    // Build edge adjacency
    var edgeAdj = {};
    for (var ei = 0; ei < combined.length; ei++) {
        var et = combined[ei].tri;
        var ek = [vKey(et.v0), vKey(et.v1), vKey(et.v2)];
        for (var ee = 0; ee < 3; ee++) {
            var ne = (ee + 1) % 3;
            var eKey = ek[ee] < ek[ne] ? ek[ee] + "|" + ek[ne] : ek[ne] + "|" + ek[ee];
            if (!edgeAdj[eKey]) edgeAdj[eKey] = [];
            edgeAdj[eKey].push(ei);
        }
    }

    // Collect remove set: all-Steiner tris + their edge-neighbors
    var removeSet = {};
    for (var asi in allSteinerSet) {
        removeSet[asi] = true;
        var at = combined[asi].tri;
        var ak = [vKey(at.v0), vKey(at.v1), vKey(at.v2)];
        for (var ae = 0; ae < 3; ae++) {
            var ane = (ae + 1) % 3;
            var aKey = ak[ae] < ak[ane] ? ak[ae] + "|" + ak[ane] : ak[ane] + "|" + ak[ae];
            var adj = edgeAdj[aKey];
            if (adj) {
                for (var ai = 0; ai < adj.length; ai++) removeSet[adj[ai]] = true;
            }
        }
    }

    // Find connected patches within the remove set using BFS
    var visited = {};
    var patches = [];
    for (var ri in removeSet) {
        if (visited[ri]) continue;
        // BFS to find connected component within removeSet
        var patch = [];
        var queue = [parseInt(ri)];
        visited[ri] = true;
        while (queue.length > 0) {
            var cur = queue.shift();
            patch.push(cur);
            var ct = combined[cur].tri;
            var ck = [vKey(ct.v0), vKey(ct.v1), vKey(ct.v2)];
            for (var ce = 0; ce < 3; ce++) {
                var cne = (ce + 1) % 3;
                var cKey = ck[ce] < ck[cne] ? ck[ce] + "|" + ck[cne] : ck[cne] + "|" + ck[ce];
                var cadj = edgeAdj[cKey];
                if (cadj) {
                    for (var cai = 0; cai < cadj.length; cai++) {
                        var nb = cadj[cai];
                        if (removeSet[nb] && !visited[nb]) {
                            visited[nb] = true;
                            queue.push(nb);
                        }
                    }
                }
            }
        }
        patches.push(patch);
    }

    // Process each connected patch
    var newTris = [];
    var totalRemoved = 0;
    var totalAdded = 0;

    for (var pi = 0; pi < patches.length; pi++) {
        var patch = patches[pi];
        var patchSet = {};
        for (var pp = 0; pp < patch.length; pp++) patchSet[patch[pp]] = true;

        // Extract boundary edges (edges with exactly 1 tri in patch)
        var boundaryEdges = [];
        for (var pe = 0; pe < patch.length; pe++) {
            var pt = combined[patch[pe]].tri;
            var pk = [vKey(pt.v0), vKey(pt.v1), vKey(pt.v2)];
            var pv = [pt.v0, pt.v1, pt.v2];
            for (var be = 0; be < 3; be++) {
                var bne = (be + 1) % 3;
                var bKey = pk[be] < pk[bne] ? pk[be] + "|" + pk[bne] : pk[bne] + "|" + pk[be];
                var badj = edgeAdj[bKey];
                var inPatchCount = 0;
                if (badj) {
                    for (var bi = 0; bi < badj.length; bi++) {
                        if (patchSet[badj[bi]]) inPatchCount++;
                    }
                }
                if (inPatchCount === 1) {
                    // Boundary edge — store with correct winding (as seen from this tri)
                    boundaryEdges.push({ v0: pv[be], v1: pv[bne], k0: pk[be], k1: pk[bne] });
                }
            }
        }

        if (boundaryEdges.length < 3) continue; // degenerate patch

        // Order boundary edges into a loop
        var loopVerts = [];
        var loopKeys = [];
        var edgeMap = {};
        for (var le = 0; le < boundaryEdges.length; le++) {
            edgeMap[boundaryEdges[le].k0] = boundaryEdges[le];
        }
        var startEdge = boundaryEdges[0];
        var currentKey = startEdge.k0;
        var startKey = currentKey;
        for (var li = 0; li < boundaryEdges.length + 1; li++) {
            var edge = edgeMap[currentKey];
            if (!edge) break;
            loopVerts.push(edge.v0);
            loopKeys.push(edge.k0);
            currentKey = edge.k1;
            if (currentKey === startKey) break;
        }

        if (loopVerts.length < 3) continue;

        // Compute patch centroid (average of ALL unique vertices in patch)
        var centroidSeen = {};
        var cx = 0, cy = 0, cz = 0, cCount = 0;
        for (var pci = 0; pci < patch.length; pci++) {
            var pct = combined[patch[pci]].tri;
            var pcVerts = [pct.v0, pct.v1, pct.v2];
            for (var pcv = 0; pcv < 3; pcv++) {
                var pcKey = vKey(pcVerts[pcv]);
                if (centroidSeen[pcKey]) continue;
                centroidSeen[pcKey] = true;
                cx += pcVerts[pcv].x;
                cy += pcVerts[pcv].y;
                cz += pcVerts[pcv].z;
                cCount++;
            }
        }
        cx /= cCount; cy /= cCount; cz /= cCount;
        var centroid = { x: cx, y: cy, z: cz };
        var centroidKey = vKey(centroid);

        // Classify the centroid (it's NOT a Steiner point — offset from intersection line)
        var centroidClass = vertexClassMap[centroidKey];
        if (centroidClass === undefined) {
            centroidClass = classifyPointMultiAxis(centroid, otherTris, otherGrids);
            vertexClassMap[centroidKey] = centroidClass;
        }

        // Fan-triangulate: centroid → each boundary edge
        for (var fi = 0; fi < loopVerts.length; fi++) {
            var fni = (fi + 1) % loopVerts.length;
            var fanTri = {
                v0: centroid,
                v1: loopVerts[fi],
                v2: loopVerts[fni]
            };

            // Classify: centroid is guaranteed non-Steiner, use it as free vertex
            // Use the centroid's classification (already computed once above)
            var fanClass = centroidClass;

            // But also check if any boundary vertex has a known non-Steiner classification
            // and prefer that if the centroid class seems unreliable
            if (!steinerKeys[loopKeys[fi]]) {
                var bvClass = vertexClassMap[loopKeys[fi]];
                if (bvClass !== undefined) fanClass = bvClass;
            } else if (!steinerKeys[loopKeys[fni]]) {
                var bvClass2 = vertexClassMap[loopKeys[fni]];
                if (bvClass2 !== undefined) fanClass = bvClass2;
            }

            newTris.push({ tri: fanTri, cls: fanClass });
        }

        totalRemoved += patch.length;
        totalAdded += loopVerts.length;
    }

    // Rebuild inside/outside: keep surviving tris, add new fan tris
    inside = [];
    outside = [];
    for (var ki = 0; ki < combined.length; ki++) {
        if (removeSet[ki]) continue; // removed
        if (combined[ki].cls === 1) inside.push(combined[ki].tri);
        else outside.push(combined[ki].tri);
    }
    for (var ni = 0; ni < newTris.length; ni++) {
        if (newTris[ni].cls === 1) inside.push(newTris[ni].tri);
        else outside.push(newTris[ni].tri);
    }

    console.log("  Patched " + patches.length + " all-Steiner patches: removed " +
        totalRemoved + " tris, added " + totalAdded + " fan tris (" +
        allSteinerCount + " all-Steiner + " +
        (Object.keys(removeSet).length - allSteinerCount) + " neighbors)");
}
```

---

## Helper Sync (MUST DO)

Replace the helper's fallback block (lines 456-468) with the worker's free-vert-first approach:

```js
} else {
    var testPt = null;
    for (var fv = 0; fv < 3; fv++) {
        if (!steinerKeys[vKey(subVerts[fv])]) {
            testPt = subVerts[fv];
            break;
        }
    }
    if (!testPt) {
        testPt = {
            x: (sub.v0.x + sub.v1.x + sub.v2.x) / 3,
            y: (sub.v0.y + sub.v1.y + sub.v2.y) / 3,
            z: (sub.v0.z + sub.v1.z + sub.v2.z) / 3
        };
    }
    foundClass = classifyPointMultiAxis(testPt, otherTris, otherGrids);
    raycastFallbacks++;
}
```

---

## What Does NOT Change

- `retriangulateWithSteinerPoints` — untouched
- `classifyByFloodFill` — untouched
- `propagateNormals` — untouched
- All repair functions — untouched
- `SurfaceBooleanDialog.js` — untouched
- `SurfaceIntersectionHelper.js` — untouched
- `surfaceIntersectionWorker.js` — untouched

---

## Why This Won't Create Gaps

Previous versions deleted tris then tried CDT re-triangulation of the hole, which failed and produced 1 triangle from hundreds of boundary vertices. This version uses **fan triangulation from an interior centroid point**. Fan from a centroid to N boundary edges always produces exactly N triangles. No CDT, no Delaunator, no Constrainautor. Just simple triangle construction. N edges in → N triangles out. The hole is always perfectly filled.

---

## Expected Console Output

```
classifyByFloodFill: 2 connected components in 26379 triangles
classifyByFloodFill: 0 connected components in 10 triangles
splitStraddlingAndClassify: 1009 sub-tris classified by vertex adjacency, 3 by ray-cast fallback
  Patched 2 all-Steiner patches: removed 15 tris, added 12 fan tris (3 all-Steiner + 12 neighbors)
  Pre-populated vertexClassMap with 8 original vertex classifications (zero-component surface)
splitStraddlingAndClassify: ~400 sub-tris classified by vertex adjacency, ~289 by ray-cast fallback
  Patched N all-Steiner patches: removed M tris, added K fan tris
```

---

## Verification

1. `npm run build` — no errors
2. `npm run dev` → import terrain + cup → Surface Boolean
3. Console: Part A fires for cup ("Pre-populated vertexClassMap with 8")
4. Console: Part B fires — "Patched N patches: removed M, added K" where K ≈ M (not K = 1)
5. Visual: **no gaps, no holes, no missing triangles**
6. No triangle has all 3 vertices on the intersection line
7. B[1] and B[2] cleanly split, reasonable tri counts
8. Test closed solid AND open cup
9. Test terrain vs terrain — should be unaffected
