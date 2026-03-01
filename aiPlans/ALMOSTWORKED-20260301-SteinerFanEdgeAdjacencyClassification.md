# ALMOST WORKED: Steiner Fan + Edge Adjacency Classification

## Status: 99.5% working — fails on open-top angled meshes (e.g. open cup vs terrain)

## Date: 2026-03-01

## Problem Statement

When a triangle is re-triangulated (CDT with Steiner points), some sub-triangles have ALL 3 vertices on the intersection line (all-Steiner). These cannot be classified by vertex adjacency because no vertex belongs to a non-crossed triangle.

**Works perfectly**: Closed solid vs terrain (all flood-fill components exist, classification propagates cleanly).

**Fails**: Open-top angled wall mesh vs terrain — the angled wall triangles are large, produce many all-Steiner sub-tris, and the centroid fan + edge adjacency approach misclassifies ~5 areas along the intersection line.

## Approach Taken

### Step 5 in `retriangulateWithSteinerPoints`: Per-Tri Centroid Fan

Replace each all-Steiner sub-tri with 3 fan triangles using the centroid as a new non-Steiner vertex.

```javascript
// ── Step 5: Replace all-Steiner sub-triangles with centroid fan ──
var finalResult = [];
var fanReplacements = 0;

for (var ri = 0; ri < result.length; ri++) {
    var sub = result[ri];
    var sv0Key = sub.v0.x.toFixed(PREC) + "," + sub.v0.y.toFixed(PREC) + "," + sub.v0.z.toFixed(PREC);
    var sv1Key = sub.v1.x.toFixed(PREC) + "," + sub.v1.y.toFixed(PREC) + "," + sub.v1.z.toFixed(PREC);
    var sv2Key = sub.v2.x.toFixed(PREC) + "," + sub.v2.y.toFixed(PREC) + "," + sub.v2.z.toFixed(PREC);

    var isV0Steiner = (sv0Key !== v0Key && sv0Key !== v1Key && sv0Key !== v2Key);
    var isV1Steiner = (sv1Key !== v0Key && sv1Key !== v1Key && sv1Key !== v2Key);
    var isV2Steiner = (sv2Key !== v0Key && sv2Key !== v1Key && sv2Key !== v2Key);

    if (isV0Steiner && isV1Steiner && isV2Steiner) {
        var centroid = {
            x: (sub.v0.x + sub.v1.x + sub.v2.x) / 3,
            y: (sub.v0.y + sub.v1.y + sub.v2.y) / 3,
            z: (sub.v0.z + sub.v1.z + sub.v2.z) / 3
        };
        finalResult.push({ v0: sub.v0, v1: sub.v1, v2: centroid });
        finalResult.push({ v0: sub.v1, v1: sub.v2, v2: centroid });
        finalResult.push({ v0: sub.v2, v1: sub.v0, v2: centroid });
        fanReplacements++;
    } else {
        finalResult.push(sub);
    }
}
```

### 4-Pass Classification in `splitStraddlingAndClassify`

```javascript
// === Pass 1: Classify sub-tris by vertex adjacency ===
// Find a free vertex (not Steiner) with a known classification in vertexClassMap
var subClasses = new Array(current.length);
var unclassified = 0;
for (var j = 0; j < current.length; j++) {
    var sub = current[j];
    var subVerts = [sub.v0, sub.v1, sub.v2];
    var foundClass = 0;
    for (var sv = 0; sv < 3; sv++) {
        var svKey = vKey(subVerts[sv]);
        if (steinerKeys[svKey]) continue;
        var adjClass = vertexClassMap[svKey];
        if (adjClass !== undefined) {
            foundClass = adjClass;
            break;
        }
    }
    subClasses[j] = foundClass;
    if (foundClass !== 0) adjacencyHits++;
    else unclassified++;
}

// === Pass 2: Edge adjacency for unclassified sub-tris ===
// Build segment edge key set (actual intersection edges)
var segEdgeKeys = {};
for (var si = 0; si < segments.length; si++) {
    var sk0 = vKey(segments[si].p0);
    var sk1 = vKey(segments[si].p1);
    segEdgeKeys[sk0 < sk1 ? sk0 + "|" + sk1 : sk1 + "|" + sk0] = true;
}

// Build edge-to-subtri adjacency
var subEdgeAdj = {};
for (var ej = 0; ej < current.length; ej++) {
    var et = current[ej];
    var ek = [vKey(et.v0), vKey(et.v1), vKey(et.v2)];
    for (var ee = 0; ee < 3; ee++) {
        var ene = (ee + 1) % 3;
        var edgeK = ek[ee] < ek[ene] ? ek[ee] + "|" + ek[ene] : ek[ene] + "|" + ek[ee];
        if (!subEdgeAdj[edgeK]) subEdgeAdj[edgeK] = [];
        subEdgeAdj[edgeK].push(ej);
    }
}

// Propagate across non-intersection edges iteratively
if (unclassified > 0) {
    var edgeChanged = true;
    while (edgeChanged) {
        edgeChanged = false;
        for (var uj = 0; uj < current.length; uj++) {
            if (subClasses[uj] !== 0) continue;
            var ut = current[uj];
            var uk = [vKey(ut.v0), vKey(ut.v1), vKey(ut.v2)];
            for (var ue = 0; ue < 3; ue++) {
                var une = (ue + 1) % 3;
                var uEdgeK = uk[ue] < uk[une] ? uk[ue] + "|" + uk[une] : uk[une] + "|" + uk[ue];
                if (segEdgeKeys[uEdgeK]) continue; // skip intersection edges
                var uAdj = subEdgeAdj[uEdgeK];
                if (!uAdj) continue;
                for (var ua = 0; ua < uAdj.length; ua++) {
                    if (uAdj[ua] === uj) continue;
                    if (subClasses[uAdj[ua]] !== 0) {
                        subClasses[uj] = subClasses[uAdj[ua]];
                        edgeChanged = true;
                        adjacencyHits++;
                        break;
                    }
                }
                if (subClasses[uj] !== 0) break;
            }
        }
    }
}

// === Pass 3: Ray-cast fallback for anything still unclassified ===
for (var rj = 0; rj < current.length; rj++) {
    if (subClasses[rj] === 0) {
        var rsub = current[rj];
        var rSubVerts = [rsub.v0, rsub.v1, rsub.v2];
        var testPt = null;
        for (var fv = 0; fv < 3; fv++) {
            if (!steinerKeys[vKey(rSubVerts[fv])]) {
                testPt = rSubVerts[fv];
                break;
            }
        }
        if (!testPt) {
            testPt = {
                x: (rsub.v0.x + rsub.v1.x + rsub.v2.x) / 3,
                y: (rsub.v0.y + rsub.v1.y + rsub.v2.y) / 3,
                z: (rsub.v0.z + rsub.v1.z + rsub.v2.z) / 3
            };
        }
        subClasses[rj] = classifyPointMultiAxis(testPt, otherTris, otherGrids);
        vertexClassMap[vKey(testPt)] = subClasses[rj];
        raycastFallbacks++;
    }
}

// === Pass 4: Edge-neighbor consistency check ===
// If a sub-tri disagrees with ALL its non-intersection edge neighbors,
// flip it to match neighbors.
{
    var flipped = 0;
    for (var cj = 0; cj < current.length; cj++) {
        var ct = current[cj];
        var ck = [vKey(ct.v0), vKey(ct.v1), vKey(ct.v2)];
        var neighborCount = 0;
        var agreeCount = 0;
        for (var ce = 0; ce < 3; ce++) {
            var cne = (ce + 1) % 3;
            var cEdgeK = ck[ce] < ck[cne] ? ck[ce] + "|" + ck[cne] : ck[cne] + "|" + ck[ce];
            if (segEdgeKeys[cEdgeK]) continue;
            var cAdj = subEdgeAdj[cEdgeK];
            if (!cAdj) continue;
            for (var ca = 0; ca < cAdj.length; ca++) {
                if (cAdj[ca] === cj) continue;
                neighborCount++;
                if (subClasses[cAdj[ca]] === subClasses[cj]) agreeCount++;
            }
        }
        if (neighborCount > 0 && agreeCount === 0) {
            subClasses[cj] = subClasses[cj] === 1 ? -1 : 1;
            flipped++;
        }
    }
    if (flipped > 0) consistencyFlips += flipped;
}
```

## Files Modified

- `src/workers/surfaceBooleanWorker.js` — Step 5 centroid fan + 4-pass classification
- `src/helpers/SurfaceBooleanHelper.js` — Same changes mirrored

## What Worked

- **Closed solid vs terrain**: Perfect results. 710 + 690 tri split for the solid, 2723 + 24311 for terrain. Volume calculation correct (74228 m³).
- **Vertex adjacency (Pass 1)**: Classifies ~1015-1091 sub-tris correctly
- **Edge adjacency (Pass 2)**: Propagates across non-intersection edges, catches fan tris
- **Centroid fan**: Creates classifiable sub-tris from all-Steiner tris

## What Failed

- **Open-top angled wall vs terrain**: ~5 areas along the intersection still misclassified
- **Root cause**: When the small surface (10 tris, open cup) has 0 flood-fill components, ALL its vertices are on crossed triangles. The centroid fan centroids sit very close to the other surface (terrain), causing unreliable ray-cast. Edge adjacency cannot propagate across the intersection line, so these fan tris remain dependent on ray-cast.
- **Pass 4 consistency flip**: Didn't help — the misclassified fan tris form clusters where neighbors also got wrong ray-casts, so they agree with each other.

## Console Output (Typical)

```
classifyByFloodFill: 2 connected components in 26379 triangles
classifyByFloodFill: 0 connected components in 10 triangles
retriangulateWithSteinerPoints: replaced 137 all-Steiner sub-tris with centroid fans (473 total sub-tris)
splitStraddlingAndClassify: 1091 sub-tris classified by vertex/edge adjacency, 386 by ray-cast fallback
```

The 386 ray-cast fallbacks for the 10-tri surface is where the problem lies — too many ray-casts near the intersection line.

## Approaches NOT Tried Yet

1. **Pre-subdivide the sparse surface**: If surface B has very few triangles (e.g. 10), subdivide its long edges before intersection. More triangles = more original vertices = more flood-fill anchors = less reliance on ray-cast.

2. **Zero-component pre-classification (from Plan v5)**: When flood-fill returns 0 components, ray-cast classify all ORIGINAL mesh vertices first (not sub-tri vertices). These are far from the intersection and give reliable results. Then vertex adjacency can propagate from them.

3. **Cross-parent edge adjacency**: Currently edge adjacency only works within sub-tris of the same parent triangle. Sub-tris from adjacent parent triangles share edges too — propagating across parent boundaries could reach more tris.

## Key Insight

The fundamental problem is: **an open, sparse mesh with very few triangles produces 0 flood-fill components, forcing ALL classification to ray-cast**. Closed solids don't have this problem because they always have interior triangles that flood-fill can reach. The fix likely needs to happen BEFORE splitting — either by pre-subdividing the sparse mesh or by pre-classifying its original vertices.
