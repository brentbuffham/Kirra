import * as THREE from "three";
import { BufferGeometry, Float32BufferAttribute, MeshPhongMaterial, Mesh, DoubleSide } from "three";
import Constrainautor from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import { createDelaunayMeshFromPointCloud } from "./createDelaunayMesh.js";

/**
 * Create a constrained triangulated mesh using @kninnug/constrainautor
 * Based on the working KirraChecks implementation
 * @param {Array} pointVertices - Array of points with x, y, and z coordinates
 * @param {Array} constraints - Array of constraint edges as [startIndex, endIndex] pairs
 * @param {Number} defaultColour - Color of the mesh material
 * @param {Number} tolerance - Tolerance for deduplication and constraint matching
 * @returns {Mesh} - The constrained triangulated mesh
 */
export function createConstrainautorMesh(pointVertices, constraints = [], defaultColour = 0x88ff88, tolerance = 0.001) {
    console.log("Creating Constrainautor Mesh with points:", pointVertices.length);
    console.log("Constraints:", constraints);

    if (!pointVertices || pointVertices.length < 3) {
        console.error("Insufficient point vertices. At least three points are required for triangulation.");
        return null;
    }

    try {
        // Step1) Deduplicate vertices first and create mapping
        const originalVertexCount = pointVertices.length;
        const deduplicationResult = getUniqueElementVerticesWithMapping(pointVertices, tolerance);
        const deduplicatedVertices = deduplicationResult.vertices;
        const originalToDeduplicatedMap = deduplicationResult.mapping;

        console.log("Deduplication: " + originalVertexCount + " → " + deduplicatedVertices.length + " vertices");

        if (deduplicatedVertices.length < 3) {
            throw new Error("Insufficient points after deduplication: " + deduplicatedVertices.length);
        }

        // Step2) Create coordinates array for Delaunator (flat array format)
        const coords = new Float64Array(deduplicatedVertices.length * 2);
        for (let i = 0; i < deduplicatedVertices.length; i++) {
            coords[i * 2] = deduplicatedVertices[i].x;
            coords[i * 2 + 1] = deduplicatedVertices[i].y;
        }

        console.log("Creating Delaunator with " + deduplicatedVertices.length + " points");

        // Step3) Create basic Delaunay triangulation first (like KirraChecks)
        const delaunay = new Delaunator(coords);
        console.log("Initial Delaunay: " + delaunay.triangles.length / 3 + " triangles");

        if (!delaunay.triangles || delaunay.triangles.length === 0) {
            console.error("Delaunator failed to create triangulation");
            return null;
        }

        // Step4) Create Constrainautor instance with the Delaunator result
        const constrainautor = new Constrainautor(delaunay);
        console.log("Constrainautor created successfully");

        // Step5) Process constraints using mapped indices
        let successfulConstraints = 0;
        if (constraints && constraints.length > 0) {
            console.log("Processing " + constraints.length + " constraints");

            // Step6) Remap constraints to deduplicated vertex indices
            const remappedConstraints = remapConstraintsToDeduplicatedIndices(constraints, originalToDeduplicatedMap, deduplicatedVertices, tolerance);

            console.log("Remapped " + remappedConstraints.length + "/" + constraints.length + " constraints to deduplicated indices");

            // Step7) Apply constraints one by one with error isolation
            remappedConstraints.forEach((constraint, index) => {
                try {
                    const startIdx = constraint[0];
                    const endIdx = constraint[1];

                    // Step8) Validate indices before applying constraint
                    if (startIdx >= 0 && endIdx >= 0 && startIdx < deduplicatedVertices.length && endIdx < deduplicatedVertices.length && startIdx !== endIdx) {
                        // Step9) Check edge length is reasonable
                        const start = deduplicatedVertices[startIdx];
                        const end = deduplicatedVertices[endIdx];
                        const dx = end.x - start.x;
                        const dy = end.y - start.y;
                        const length = Math.sqrt(dx * dx + dy * dy);

                        if (length > tolerance) {
                            constrainautor.constrainOne(startIdx, endIdx);
                            successfulConstraints++;
                            console.log("Added constraint " + index + ": " + startIdx + " -> " + endIdx + " (length: " + length.toFixed(3) + ")");
                        } else {
                            console.warn("Skipped short constraint " + index + ": length " + length.toFixed(6));
                        }
                    } else {
                        console.warn("Invalid constraint indices: [" + startIdx + ", " + endIdx + "]");
                    }
                } catch (constraintError) {
                    console.warn("Error adding constraint " + index + ":", constraintError.message);
                }
            });

            console.log("✅ Successfully applied " + successfulConstraints + "/" + remappedConstraints.length + " constraints");
        }

        // Step10) Get the final triangulation from the delaunay object (like KirraChecks)
        const triangles = delaunay.triangles;
        console.log("Final triangles:", triangles.length / 3);

        if (!triangles || triangles.length === 0) {
            console.warn("No triangles after constraining");
            return null;
        }

        // Step11) Validate triangles reference correct vertices
        const validatedTriangles = validateTriangleIndices(triangles, deduplicatedVertices);
        console.log("Validated triangles: " + validatedTriangles.length / 3 + " (removed " + (triangles.length - validatedTriangles.length) / 3 + " invalid)");

        if (validatedTriangles.length === 0) {
            console.error("No valid triangles after validation");
            return null;
        }

        return createMeshFromTriangles(deduplicatedVertices, validatedTriangles, defaultColour, successfulConstraints);
    } catch (error) {
        console.error("Error creating constrainautor mesh:", error);
        console.log("Falling back to simple Delaunay mesh");

        // Fallback to simple Delaunay triangulation
        try {
            return createDelaunayMeshFromPointCloud(pointVertices, 1000, defaultColour);
        } catch (fallbackError) {
            console.error("Fallback also failed:", fallbackError);
            return null;
        }
    }
}

/**
 * Deduplicate vertices with tolerance and create mapping from original to deduplicated indices
 * @param {Array} vertices - Array of vertex objects with x, y, z properties
 * @param {Number} tolerance - Distance tolerance for considering points duplicate
 * @returns {Object} - Object with vertices array and mapping array
 */
function getUniqueElementVerticesWithMapping(vertices, tolerance) {
    const unique = [];
    const mapping = new Array(vertices.length); // originalIndex -> deduplicatedIndex
    const tolerance2 = tolerance * tolerance;

    for (let i = 0; i < vertices.length; i++) {
        const vertex = vertices[i];
        let foundIndex = -1;

        // Step1) Check against existing unique vertices
        for (let j = 0; j < unique.length; j++) {
            const existing = unique[j];
            const dx = vertex.x - existing.x;
            const dy = vertex.y - existing.y;
            const distance2 = dx * dx + dy * dy;

            if (distance2 <= tolerance2) {
                foundIndex = j;
                break;
            }
        }

        // Step2) Add new unique vertex or map to existing
        if (foundIndex === -1) {
            foundIndex = unique.length;
            unique.push({
                x: vertex.x,
                y: vertex.y,
                z: vertex.z || 0,
                id: vertex.id || "vertex_" + unique.length,
                sourceType: vertex.sourceType || "unknown",
            });
        }

        mapping[i] = foundIndex;
    }

    console.log("Created mapping: " + vertices.length + " original -> " + unique.length + " deduplicated");
    return {
        vertices: unique,
        mapping: mapping,
    };
}

/**
 * Remap constraints to use deduplicated vertex indices
 * @param {Array} constraints - Original constraints with original vertex indices
 * @param {Array} originalToDeduplicatedMap - Mapping from original to deduplicated indices
 * @param {Array} deduplicatedVertices - Deduplicated vertices array
 * @param {Number} tolerance - Distance tolerance
 * @returns {Array} - Remapped constraints
 */
function remapConstraintsToDeduplicatedIndices(constraints, originalToDeduplicatedMap, deduplicatedVertices, tolerance) {
    const remappedConstraints = [];

    constraints.forEach((constraint, index) => {
        try {
            if (!Array.isArray(constraint) || constraint.length !== 2) {
                console.warn("Invalid constraint format at index " + index + ":", constraint);
                return;
            }

            let startIdx = constraint[0];
            let endIdx = constraint[1];

            // Step1) Check if indices are within original range
            if (startIdx >= 0 && startIdx < originalToDeduplicatedMap.length) {
                startIdx = originalToDeduplicatedMap[startIdx];
            } else {
                console.warn("Start index " + constraint[0] + " out of range for constraint " + index);
                return;
            }

            if (endIdx >= 0 && endIdx < originalToDeduplicatedMap.length) {
                endIdx = originalToDeduplicatedMap[endIdx];
            } else {
                console.warn("End index " + constraint[1] + " out of range for constraint " + index);
                return;
            }

            // Step2) Validate remapped indices
            if (startIdx >= 0 && endIdx >= 0 && startIdx < deduplicatedVertices.length && endIdx < deduplicatedVertices.length && startIdx !== endIdx) {
                remappedConstraints.push([startIdx, endIdx]);
            } else {
                console.warn("Invalid remapped constraint " + index + ": [" + startIdx + ", " + endIdx + "] -> skipped");
            }
        } catch (error) {
            console.warn("Error remapping constraint " + index + ":", error.message);
        }
    });

    return remappedConstraints;
}

/**
 * Validate triangle indices to ensure they reference valid vertices
 * @param {Array} triangles - Triangle indices array
 * @param {Array} vertices - Vertices array
 * @returns {Array} - Validated triangle indices array
 */
function validateTriangleIndices(triangles, vertices) {
    const validatedTriangles = [];

    for (let i = 0; i < triangles.length; i += 3) {
        const a = triangles[i];
        const b = triangles[i + 1];
        const c = triangles[i + 2];

        // Step1) Check indices are valid integers
        if (Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(c) && a >= 0 && b >= 0 && c >= 0 && a < vertices.length && b < vertices.length && c < vertices.length && a !== b && b !== c && a !== c) {
            // Step2) Check triangle has non-zero area
            const v1 = vertices[a];
            const v2 = vertices[b];
            const v3 = vertices[c];

            const area = Math.abs((v2.x - v1.x) * (v3.y - v1.y) - (v3.x - v1.x) * (v2.y - v1.y)) / 2;

            if (area > 1e-10) {
                validatedTriangles.push(a, b, c);
            } else {
                console.warn("Skipped degenerate triangle with area " + area.toFixed(12) + ": [" + a + ", " + b + ", " + c + "]");
            }
        } else {
            console.warn("Skipped invalid triangle indices: [" + a + ", " + b + ", " + c + "]");
        }
    }

    return validatedTriangles;
}

/**
 * Helper function to create a mesh from triangles with enhanced validation
 * @param {Array} pointVertices - Array of vertices
 * @param {Array} triangles - Triangle indices array
 * @param {Number} defaultColour - Material color
 * @param {Number} constraintCount - Number of constraints applied
 * @returns {Mesh|null} - THREE.js mesh or null on error
 */
function createMeshFromTriangles(pointVertices, triangles, defaultColour, constraintCount = 0) {
    try {
        // Step1) Build vertex float array (x,y,z)
        const vertices = [];
        for (let i = 0; i < pointVertices.length; i++) {
            const p = pointVertices[i];
            vertices.push(p.x, p.y, p.z || 0);
        }

        // Step2) Use triangles directly as indices (already validated)
        const indices = Array.from(triangles);

        if (indices.length === 0) {
            console.error("No valid triangles found");
            return null;
        }

        console.log("Created " + indices.length / 3 + " triangles from " + pointVertices.length + " vertices");

        // Step3) Create THREE geometry
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Step4) Create material
        const material = new MeshPhongMaterial({
            color: defaultColour,
            side: DoubleSide,
            flatShading: true,
            wireframe: false,
        });

        const mesh = new Mesh(geometry, material);

        // Step5) Calculate centroid
        const centroid = new THREE.Vector3();
        pointVertices.forEach((p) => centroid.add(new THREE.Vector3(p.x, p.y, p.z || 0)));
        centroid.divideScalar(pointVertices.length);

        // Step6) Set metadata
        const timeDateNow = Date.now();
        mesh.userData = {
            name: "ConstrainautorMesh_" + timeDateNow,
            isConstrainautorMesh: true,
            vertices: pointVertices.length,
            triangles: indices.length / 3,
            meshCenter: centroid,
            originalMaterial: material,
            constraints: constraintCount,
        };

        console.log("Constrainautor Mesh created:", mesh.userData);
        return mesh;
    } catch (error) {
        console.error("Error creating mesh from triangles:", error);
        return null;
    }
}

/**
 * Create a hybrid mesh: use Delaunay for initial triangulation, then constrainautor for constraints
 * @param {Array} pointVertices - Array of points with x, y, and z coordinates
 * @param {Array} constraints - Array of constraint edges
 * @param {Number} maxEdgeLength - Maximum edge length for initial Delaunay (not used in final result)
 * @param {Number} defaultColour - Color of the mesh material
 * @returns {Mesh} - The constrained mesh
 */
export function createHybridConstrainautorMesh(pointVertices, constraints = [], maxEdgeLength = 1000, defaultColour = 0xffaa88) {
    console.log("Creating Hybrid Constrainautor Mesh");

    try {
        const constrainedMesh = createConstrainautorMesh(pointVertices, constraints, defaultColour);

        if (constrainedMesh) {
            constrainedMesh.userData.isHybridMesh = true;
            constrainedMesh.userData.name = "HybridConstrainautorMesh_" + Date.now();
            console.log("Hybrid Constrainautor Mesh created successfully");
            return constrainedMesh;
        } else {
            console.warn("Constrainautor failed, falling back to Delaunay");
            const delaunayMesh = createDelaunayMeshFromPointCloud(pointVertices, maxEdgeLength, defaultColour);
            if (delaunayMesh) {
                delaunayMesh.userData.isHybridMesh = true;
                delaunayMesh.userData.name = "HybridDelaunayMesh_" + Date.now();
            }
            return delaunayMesh;
        }
    } catch (error) {
        console.error("Error creating hybrid constrainautor mesh:", error);
        return createDelaunayMeshFromPointCloud(pointVertices, maxEdgeLength, defaultColour);
    }
}

/**
 * Extract constraints from deduplicated vertices using spatial indexing (KirraChecks approach)
 * @param {Array} selectedObjects - Array of THREE objects (may be Groups)
 * @param {Array} deduplicatedVertices - Deduplicated array used for triangulation
 * @param {Number} tolerance - Distance tolerance to match points (in scene units)
 * @returns {Array} - Array of [startIndex, endIndex] constraint pairs
 */
export function extractConstraintEdgesFromDeduplicatedVertices(selectedObjects, deduplicatedVertices, tolerance = 0.001) {
    console.log("Extracting constraints from deduplicated vertices...");

    const constraints = [];

    if (!Array.isArray(deduplicatedVertices) || deduplicatedVertices.length === 0) {
        console.warn("extractConstraintEdgesFromDeduplicatedVertices: no deduplicatedVertices supplied or empty");
        return constraints;
    }
    if (!Array.isArray(selectedObjects) || selectedObjects.length === 0) {
        console.warn("extractConstraintEdgesFromDeduplicatedVertices: no selectedObjects supplied or empty");
        return constraints;
    }

    // Step1) Create spatial index for efficient vertex lookup
    const spatialIndex = createSpatialIndex(deduplicatedVertices, tolerance);

    // Step2) Extract constraints from each object
    selectedObjects.forEach((obj, objIndex) => {
        if (!obj) return;

        // Step3) Update world matrix for proper coordinate transformation
        obj.updateMatrixWorld(true);

        obj.traverse((child) => {
            if (!child || !child.geometry || !child.geometry.attributes || !child.geometry.attributes.position) {
                return;
            }

            const entityName = child.name || "entity_" + objIndex;
            console.log("Processing constraints for object: " + entityName);

            const positions = child.geometry.attributes.position.array;
            const entityConstraints = [];

            // Step4) Build world-space points
            const worldPoints = [];
            const tempVector = new THREE.Vector3();
            for (let i = 0; i < positions.length; i += 3) {
                tempVector.set(positions[i], positions[i + 1], positions[i + 2] || 0);
                tempVector.applyMatrix4(child.matrixWorld);
                worldPoints.push({
                    x: tempVector.x,
                    y: tempVector.y,
                    z: tempVector.z,
                });
            }

            // Step5) Create segments between consecutive points
            for (let i = 0; i < worldPoints.length - 1; i++) {
                const startPoint = worldPoints[i];
                const endPoint = worldPoints[i + 1];

                // Step6) Find corresponding deduplicated vertices
                const startIdx = findClosestVertexIndex(spatialIndex, startPoint.x, startPoint.y, tolerance);
                const endIdx = findClosestVertexIndex(spatialIndex, endPoint.x, endPoint.y, tolerance);

                if (startIdx !== null && endIdx !== null && startIdx !== endIdx) {
                    const constraint = [startIdx, endIdx];
                    entityConstraints.push(constraint);
                    constraints.push(constraint);
                } else {
                    console.warn("Could not map constraint segment " + i + " for entity " + entityName);
                    console.warn("  Start: (" + startPoint.x.toFixed(3) + ", " + startPoint.y.toFixed(3) + ") → index " + startIdx);
                    console.warn("  End: (" + endPoint.x.toFixed(3) + ", " + endPoint.y.toFixed(3) + ") → index " + endIdx);
                }
            }

            // Step7) Close polygon if it's a closed shape and points are different
            if (worldPoints.length > 2) {
                const firstPoint = worldPoints[0];
                const lastPoint = worldPoints[worldPoints.length - 1];

                const dx = firstPoint.x - lastPoint.x;
                const dy = firstPoint.y - lastPoint.y;

                // Only add closing segment if points are different
                if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
                    const firstIdx = findClosestVertexIndex(spatialIndex, firstPoint.x, firstPoint.y, tolerance);
                    const lastIdx = findClosestVertexIndex(spatialIndex, lastPoint.x, lastPoint.y, tolerance);

                    if (firstIdx !== null && lastIdx !== null && firstIdx !== lastIdx) {
                        const closingConstraint = [lastIdx, firstIdx];
                        entityConstraints.push(closingConstraint);
                        constraints.push(closingConstraint);
                    }
                }
            }

            console.log("  ✅ Added " + entityConstraints.length + " constraints for entity " + entityName);
        });
    });

    // Step8) Remove duplicate constraints (undirected uniqueness)
    const seen = new Set();
    const uniqueConstraints = [];
    for (const constraint of constraints) {
        const a = constraint[0];
        const b = constraint[1];
        const key = Math.min(a, b) + "_" + Math.max(a, b);
        if (!seen.has(key)) {
            seen.add(key);
            uniqueConstraints.push(constraint);
        }
    }

    console.log("✅ Total unique constraints extracted: " + uniqueConstraints.length);
    return uniqueConstraints;
}

/**
 * Step1) Improved constraint extraction: handle groups/children, world coords, nearest-match
 * Step2) Map polyline/line geometry into index-pair constraints referencing the deduplicated pointVertices array.
 * selectedObjects: array of THREE objects (may be Groups)
 * pointVertices: deduplicated array used for triangulation (must be same order/array used for Delaunator)
 * tolerance: distance tolerance to match points (in scene units)
 * returns: Array of [startIndex, endIndex]
 */
export function extractConstraintEdges(selectedObjects, pointVertices, tolerance = 0.001) {
    // Step3) initial checks + debug
    const constraints = [];
    if (!Array.isArray(pointVertices) || pointVertices.length === 0) {
        console.warn("extractConstraintEdges: no pointVertices supplied or empty");
        return constraints;
    }
    if (!Array.isArray(selectedObjects) || selectedObjects.length === 0) {
        console.warn("extractConstraintEdges: no selectedObjects supplied or empty");
        return constraints;
    }
    console.log("extractConstraintEdges: called selectedObjects=" + selectedObjects.length + ", pointVertices=" + pointVertices.length + ", tolerance=" + tolerance);

    // Step4) Precompute squared tolerance and helper
    const tol2 = tolerance * tolerance;
    function findClosestIndexWorld(x, y) {
        let bestIdx = -1;
        let bestDist2 = Infinity;
        for (let i = 0; i < pointVertices.length; i++) {
            const pv = pointVertices[i];
            const dx = pv.x - x;
            const dy = pv.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDist2) {
                bestDist2 = d2;
                bestIdx = i;
            }
        }
        return bestDist2 <= tol2 ? bestIdx : -1;
    }

    // Step5) Walk selected objects and their children; collect stats for debugging
    let rawCount = 0;
    let addedCount = 0;
    let failedCount = 0;
    const failures = [];

    selectedObjects.forEach(function (obj, objIdx) {
        if (!obj) return;
        obj.updateMatrixWorld(true);

        obj.traverse(function (child) {
            if (!child) return;
            const geom = child.geometry;
            if (!geom || !geom.attributes || !geom.attributes.position) return;

            const pos = geom.attributes.position.array;
            // Build world-space point list for this geometry
            const pts = [];
            const v = new THREE.Vector3();
            for (let i = 0; i < pos.length; i += 3) {
                v.set(pos[i], pos[i + 1], pos[i + 2] || 0);
                v.applyMatrix4(child.matrixWorld);
                pts.push({ x: v.x, y: v.y, z: v.z });
            }

            if (pts.length === 0) {
                // nothing to do
                return;
            }

            // Debug: report child name and number of points (once)
            console.log("extractConstraintEdges: processing child '" + (child.name || "obj_" + objIdx) + "' pts=" + pts.length);

            // Consecutive pairs -> constraint indices
            for (let i = 0; i < pts.length - 1; i++) {
                rawCount++;
                const aIdx = findClosestIndexWorld(pts[i].x, pts[i].y);
                const bIdx = findClosestIndexWorld(pts[i + 1].x, pts[i + 1].y);
                if (aIdx !== -1 && bIdx !== -1 && aIdx !== bIdx) {
                    constraints.push([aIdx, bIdx]);
                    addedCount++;
                } else {
                    failedCount++;
                    if (failures.length < 10) {
                        failures.push({
                            child: child.name || "obj_" + objIdx,
                            segment: i,
                            start: { x: pts[i].x, y: pts[i].y },
                            end: { x: pts[i + 1].x, y: pts[i + 1].y },
                            mapped: [aIdx, bIdx],
                        });
                    }
                }
            }

            // Close polygon if first != last (add closing segment)
            if (pts.length > 2) {
                const first = pts[0];
                const last = pts[pts.length - 1];
                const dx = first.x - last.x;
                const dy = first.y - last.y;
                if (dx * dx + dy * dy > tol2) {
                    rawCount++;
                    const firstIdx = findClosestIndexWorld(first.x, first.y);
                    const lastIdx = findClosestIndexWorld(last.x, last.y);
                    if (firstIdx !== -1 && lastIdx !== -1 && firstIdx !== lastIdx) {
                        constraints.push([lastIdx, firstIdx]);
                        addedCount++;
                    } else {
                        failedCount++;
                        if (failures.length < 10) {
                            failures.push({
                                child: child.name || "obj_" + objIdx,
                                segment: "closing",
                                start: { x: last.x, y: last.y },
                                end: { x: first.x, y: first.y },
                                mapped: [lastIdx, firstIdx],
                            });
                        }
                    }
                }
            }
        });
    });

    // Step6) Unique-ify constraints (undirected uniqueness)
    const seen = new Set();
    const unique = [];
    for (let i = 0; i < constraints.length; i++) {
        const a = constraints[i][0];
        const b = constraints[i][1];
        const key = Math.min(a, b) + "_" + Math.max(a, b);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push([a, b]);
        }
    }

    // Step7) Final debug log
    console.log("extractConstraintEdges: rawSegments=" + rawCount + ", added=" + addedCount + ", failed=" + failedCount + ", uniqueConstraints=" + unique.length);
    if (failures.length > 0) {
        console.log("extractConstraintEdges: first failures: " + JSON.stringify(failures));
    }

    return unique;
}
