import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, MeshPhongMaterial, Mesh, Vector3, DoubleSide, LineSegments, LineBasicMaterial, EdgesGeometry } from "three";
import Delaunator from "delaunator";
import cdt2d from "cdt2d";

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
 * Create a constrained Delaunay mesh from point cloud.
 * @param {Array} points - Array of THREE.Vector3 points.
 * @param {Array} edges - Array of edges (each edge is a pair of point indices).
 * @param {Number} defaultColour - Color of the mesh material.
 * @returns {Mesh} - The created mesh.
 */
export function createConstrainedDelaunayMesh(points, edges, defaultColour) {
    // Step 1: Map points to 2D coordinates and store Z values
    const coords = [];
    const zValues = [];
    points.forEach((p) => {
        coords.push([p.x, p.y]);
        zValues.push(p.z); // Preserve Z-coordinate
    });

    // Step 2: Perform constrained Delaunay triangulation
    const triangles = cdt2d(coords, edges);

    if (triangles.length === 0) {
        console.warn("No valid triangles were created during constrained triangulation.");
        return null;
    }

    // Step 3: Build vertices and indices for 3D mesh
    const vertices = [];
    const indices = [];
    const vertexMap = new Map(); // Prevent duplicate vertices

    triangles.forEach(([a, b, c]) => {
        [a, b, c].forEach((idx) => {
            const key = `${coords[idx][0]},${coords[idx][1]},${zValues[idx]}`;
            if (!vertexMap.has(key)) {
                vertexMap.set(key, vertices.length / 3);
                vertices.push(coords[idx][0], coords[idx][1], zValues[idx]);
            }
            indices.push(vertexMap.get(key));
        });
    });

    // Step 4: Create geometry and mesh with flat shading
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    geometry.computeVertexNormals(); // Generate normals for lighting
    geometry.deleteAttribute("normal"); // Remove smoothed normals for flat shading

    const material = new MeshPhongMaterial({
        color: defaultColour,
        side: DoubleSide,
        flatShading: true, // Ensure flat shading
    });

    const mesh = new Mesh(geometry, material);

    console.log("Constrained Delaunay Mesh Generated with Flat Shading:", mesh);
    return mesh;
}

/**
 * Extract edges from polylines.
 * @param {Array} polylines - Array of polylines (each polyline is an array of points).
 * @param {Map} pointIndexMap - Map of point strings to their indices in the points array.
 * @returns {Array} edges - Array of edges (each edge is a pair of point indices).
 */
export function extractEdgesFromPolylines(polylines, pointIndexMap) {
    const edges = [];
    for (const polyline of polylines) {
        for (let i = 0; i < polyline.length - 1; i++) {
            const a = pointIndexMap.get(polyline[i].toArray().toString());
            const b = pointIndexMap.get(polyline[i + 1].toArray().toString());
            if (a !== undefined && b !== undefined) {
                edges.push([a, b]);
            }
        }
    }
    return edges;
}

/**
 * Group points by their Z value to ensure contour-like layers.
 * @param {Array} points - Array of THREE.Vector3 points.
 * @param {Number} threshold - Z threshold to group points.
 * @returns {Map} - Map of Z-values to point arrays.
 */
function groupPointsByZ(points, threshold = 0.01) {
    const grouped = new Map();

    points.forEach((point) => {
        // Find closest Z-group
        let zKey = Array.from(grouped.keys()).find((z) => Math.abs(z - point.z) < threshold);
        if (zKey === undefined) {
            zKey = point.z;
            grouped.set(zKey, []);
        }
        grouped.get(zKey).push(point);
    });

    return grouped;
}

/**
 * Perform Delaunay triangulation on a set of points.
 * @param {Array} points - Array of THREE.Vector3 points.
 * @returns {Array} triangles - Triangulated faces.
 */
function delaunayTriangles(points) {
    const coords = points.flatMap((p) => [p.x, p.y]);
    const delaunay = Delaunator.from(coords);

    const triangles = [];
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const a = points[delaunay.triangles[i]];
        const b = points[delaunay.triangles[i + 1]];
        const c = points[delaunay.triangles[i + 2]];
        triangles.push([a, b, c]);
    }

    return triangles;
}
