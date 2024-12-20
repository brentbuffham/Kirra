import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, MeshPhongMaterial, Mesh, Vector3, DoubleSide, LineSegments, LineBasicMaterial, EdgesGeometry } from "three";
import Delaunator from "delaunator";
import cdt2d from "cdt2d";

/**
 * Filters unique points from an array of Vector3 points based on a threshold distance.
 * @param {Array} points - Array of THREE.Vector3 points.
 * @param {Number} threshold - Minimum distance to consider points as unique.
 * @returns {Array} uniquePoints - Array of filtered unique points.
 */
function filterUniquePoints(points, threshold = 0.001) {
    const uniquePoints = [];
    points.forEach((p) => {
        if (!uniquePoints.some((q) => p.distanceTo(q) < threshold)) {
            uniquePoints.push(p);
        }
    });
    return uniquePoints;
}

/**
 * Perform Delaunay triangulation on a set of points and filter triangles based on maximum edge length.
 * @param {Array} points - Array of points with x, y, and z coordinates.
 * @param {Number} maxEdgeLength - Maximum allowable edge length for triangles.
 * @returns {Array} resultTriangles - Array of triangles with vertices [x, y, z].
 */
function delaunayTriangles(points, maxEdgeLength) {
    let uniquePoints = filterUniquePoints(points);

    try {
        let resultTriangles = [];
        const getX = (point) => parseFloat(point.x);
        const getY = (point) => parseFloat(point.y);

        const delaunay = Delaunator.from(uniquePoints, getX, getY);

        function distanceSquared(p1, p2) {
            const dx = p1[0] - p2[0];
            const dy = p1[1] - p2[1];
            return dx * dx + dy * dy;
        }

        function isDegenerate(triangle) {
            const [a, b, c] = triangle;
            const ab = distanceSquared(a, b);
            const bc = distanceSquared(b, c);
            const ca = distanceSquared(c, a);
            return ab < Number.EPSILON || bc < Number.EPSILON || ca < Number.EPSILON;
        }

        for (let i = 0; i < delaunay.triangles.length; i += 3) {
            const p1Index = delaunay.triangles[i];
            const p2Index = delaunay.triangles[i + 1];
            const p3Index = delaunay.triangles[i + 2];

            const p1 = uniquePoints[p1Index];
            const p2 = uniquePoints[p2Index];
            const p3 = uniquePoints[p3Index];

            const edge1Squared = distanceSquared([getX(p1), getY(p1)], [getX(p2), getY(p2)]);
            const edge2Squared = distanceSquared([getX(p2), getY(p2)], [getX(p3), getY(p3)]);
            const edge3Squared = distanceSquared([getX(p3), getY(p3)], [getX(p1), getY(p1)]);

            if (edge1Squared <= maxEdgeLength ** 2 && edge2Squared <= maxEdgeLength ** 2 && edge3Squared <= maxEdgeLength ** 2) {
                const triangle = [
                    [getX(p1), getY(p1), p1.z],
                    [getX(p2), getY(p2), p2.z],
                    [getX(p3), getY(p3), p3.z],
                ];

                if (!isDegenerate(triangle)) {
                    resultTriangles.push(triangle);
                }
            }
        }

        console.log("Delaunay Triangles:", resultTriangles);
        return resultTriangles;
    } catch (err) {
        console.log(err);
    }
}

/**
 * Check for overlapping triangles by counting shared edges.
 * @param {Array} triangles - Array of triangles.
 * @returns {Boolean} - True if overlapping triangles are detected, otherwise false.
 */
function checkOverlappingTriangles(triangles) {
    const edges = {};

    function addEdge(v1, v2) {
        const key = v1 < v2 ? v1 + "," + v2 : v2 + "," + v1;
        if (edges[key]) {
            edges[key]++;
        } else {
            edges[key] = 1;
        }
    }

    for (const triangle of triangles) {
        addEdge(triangle[0].join(","), triangle[1].join(","));
        addEdge(triangle[1].join(","), triangle[2].join(","));
        addEdge(triangle[2].join(","), triangle[0].join(","));
    }

    const overlappingTriangles = [];
    for (const edge in edges) {
        if (edges[edge] > 2) {
            overlappingTriangles.push(edge);
        }
    }

    console.log("Overlapping Edges:", overlappingTriangles);
    return overlappingTriangles.length > 0;
}

/**
 * Calculate the centroid of a set of points.
 * @param {Array} points - Array of Vector3 points.
 * @returns {Vector3} - The centroid of the points.
 */
function calculateCentroid(points) {
    const centroid = new Vector3();
    for (const point of points) {
        centroid.add(point);
    }
    centroid.divideScalar(points.length);
    return centroid;
}

/**
 * Create a mesh from point cloud using Delaunay triangulation.
 * @param {Array} pointVertices - Array of points with x, y, and z coordinates.
 * @param {Number} maxEdgeLength - Maximum allowable edge length for triangles.
 * @returns {Mesh} - The created mesh.
 */
export function createDelaunayMeshFromPointCloud(pointVertices, maxEdgeLength, defaultColour) {
    const triangles = delaunayTriangles(pointVertices, maxEdgeLength);
    console.log(triangles);

    if (checkOverlappingTriangles(triangles)) {
        console.warn("Overlapping triangles detected.");
    }

    const vertices = [];
    const indices = [];
    for (let i = 0; i < triangles.length; i++) {
        const triangle = triangles[i];
        for (let j = 0; j < 3; j++) {
            const vertex = triangle[j];
            vertices.push(vertex[0], vertex[1], vertex[2]);
            indices.push(i * 3 + j);
        }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new MeshPhongMaterial({ color: defaultColour, side: DoubleSide, wireframe: false });
    const mesh = new Mesh(geometry, material);

    //const wireframe = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: 0x000000, linewidth: 1 }));
    //mesh.add(wireframe);

    const centroid = calculateCentroid(pointVertices.map((p) => new Vector3(p.x, p.y, p.z)));
    const timeDateNow = Date.now();
    const tempPointCloudName = "Cloud" + timeDateNow;
    mesh.userData = {
        name: "tempPointCloudName",
        isTXTMesh: true,
        vertices: pointVertices.length,
        triangles: triangles.length,
        meshCenter: centroid,
        originalMaterial: material,
    };

    console.log("pointCloudMesh", mesh.userData);
    return mesh;
}

/**
 * Flip the normals of a given mesh.
 * @param {Mesh} mesh - The mesh to flip normals.
 */
function flipNormals(mesh) {
    if (!(mesh instanceof Mesh)) {
        console.error("The provided object is not a Mesh.");
        return;
    }

    const geometry = mesh.geometry;

    if (!(geometry instanceof BufferGeometry)) {
        console.error("The mesh's geometry is not a BufferGeometry.");
        return;
    }

    const index = geometry.getIndex();
    if (index) {
        const array = index.array;
        for (let i = 0; i < array.length; i += 3) {
            const tmp = array[i + 1];
            array[i + 1] = array[i + 2];
            array[i + 2] = tmp;
        }
        index.needsUpdate = true;
    } else {
        console.error("The geometry does not have an index array.");
    }

    const normal = geometry.getAttribute("normal");
    if (normal) {
        const array = normal.array;
        for (let i = 0; i < array.length; i++) {
            array[i] = -array[i];
        }
        normal.needsUpdate = true;
    } else {
        console.error("The geometry does not have a normal attribute.");
    }

    console.log("Normals have been flipped.");
}

/**
 * Create a mesh from point cloud using Delaunay triangulation.
 * @param {Array} pointVertices - Array of points with x, y, and z coordinates.
 * @returns {Mesh} - The created mesh.
 */
export function createMeshFromPointCloud(pointVertices) {
    if (!pointVertices || pointVertices.length < 3) {
        console.error("Insufficient point vertices. At least three points are required for triangulation.");
        return null;
    }

    pointVertices = pointVertices.map((p) => new Vector3(p.x, p.y, p.z));
    const coordinates = pointVertices.flatMap((p) => [p.x, p.y]);

    console.log("2D Coordinates: ", coordinates);

    const uniqueCoordinates = new Set();
    for (let i = 0; i < coordinates.length; i += 2) {
        const point = `${coordinates[i]},${coordinates[i + 1]}`;
        if (uniqueCoordinates.has(point)) {
            console.warn(`Duplicate point found: ${point}`);
        } else {
            uniqueCoordinates.add(point);
        }
    }

    const delaunay = Delaunator.from(coordinates);
    console.log("Delaunay Object: ", delaunay);
    console.log("Delaunay Triangles: ", delaunay.triangles);
    console.log("Delaunator Hull: ", delaunay.hull);
    console.log("Delaunator Hull Tri: ", delaunay.hullTri);
    console.log("Delaunator Hull Prev: ", delaunay.hullPrev);
    console.log("Delaunator Hull Next: ", delaunay.hullNext);
    console.log("Delaunator Halfedges: ", delaunay.halfedges);
    console.log("Delaunator Triangles: ", delaunay.triangles);
    console.log("Delaunator Hull Hash: ", delaunay.hullHash);
    let meshIndex = [];
    for (let i = 0; i < delaunay.triangles.length; i++) {
        meshIndex.push(delaunay.triangles[i]);
        console.log("Mesh Index: ", meshIndex);
    }

    const geometry = new BufferGeometry().setFromPoints(pointVertices);
    geometry.setIndex(meshIndex);
    const vertices = pointVertices.flatMap((p) => [p.x, p.y, p.z]);
    geometry.computeVertexNormals();

    const material = new MeshPhongMaterial({ color: 0x00ff00, wireframe: false });
    const mesh = new Mesh(geometry, material);

    const meshCenter = new Vector3();
    geometry.computeBoundingBox();
    geometry.boundingBox.getCenter(meshCenter);
    mesh.position.copy(meshCenter);

    mesh.userData = {
        name: "pointCloudMesh",
        isPointCloudMesh: true,
        vertices: vertices.length / 3,
        triangles: meshIndex.length / 3,
        meshCenter: meshCenter,
    };

    console.log("pointCloudMesh", mesh.userData);

    return mesh;
}

/**
 * Create a triangulated mesh from grouped point clouds.
 * @param {Array} pointVertices - Array of THREE.Vector3 points.
 * @param {Number} defaultColour - Color of the mesh material.
 * @returns {Mesh} - The triangulated mesh.
 */
export function createMeshFromVertices(pointVertices, defaultColour = 0xffaa00) {
    // Step 1: Group points by Z value (layered contours)
    const groupedPoints = groupPointsByZ(pointVertices);
    const vertices = [];
    const indices = [];
    let vertexIndex = 0;

    // Step 2: Triangulate each layer and merge
    groupedPoints.forEach((points, z) => {
        if (points.length < 3) return; // Skip invalid layers

        // Perform Delaunay triangulation for this layer
        const triangles = delaunayTrianglesV2(points);

        // Add vertices and indices
        const vertexMap = new Map();
        points.forEach((p, i) => {
            vertices.push(p.x, p.y, p.z);
            vertexMap.set(i, vertexIndex++);
        });

        triangles.forEach(([a, b, c]) => {
            indices.push(vertexMap.get(points.indexOf(a)), vertexMap.get(points.indexOf(b)), vertexMap.get(points.indexOf(c)));
        });
    });

    // Step 3: Create geometry and mesh
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new MeshPhongMaterial({ color: defaultColour, side: DoubleSide, flatShading: true });
    const mesh = new Mesh(geometry, material);

    console.log("Triangulated Mesh:", mesh);
    return mesh;
}
