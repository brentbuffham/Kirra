import { Vector3 } from "three";
import { extractEdgesFromPolylines } from "./createConstrainedMesh.js";

/**
 * Converts a single geometry or an array of geometries/objects into a point array.
 * @param {Array|Object} input - Single geometry, object, or an array of geometries/objects.
 * @returns {Array<Vector3>} - Array of points (Vector3).
 */
export function objectToPoints(input) {
    const points = [];

    // Ensure input is an array
    const objects = Array.isArray(input) ? input : [input];

    for (const object of objects) {
        // Traverse the object to handle nested children
        object.traverse((child) => {
            const geometry = child.geometry;

            if (geometry) {
                if (geometry.isBufferGeometry) {
                    // Handle BufferGeometry
                    const position = geometry.attributes.position;
                    if (position) {
                        for (let i = 0; i < position.count; i++) {
                            points.push(new Vector3(position.getX(i), position.getY(i), position.getZ(i)));
                        }
                    }
                } else if (geometry.isGeometry) {
                    // Handle Geometry (deprecated in newer Three.js versions)
                    for (const vertex of geometry.vertices) {
                        points.push(vertex.clone());
                    }
                }
            } else {
                console.warn("Object ", child.name || "Unnamed", " does not have valid geometry.");
            }
        });
    }

    return points;
}

/**
 * Extract points, polylines, and edges from an array of objects.
 * @param {Array|Object} objects - Single object or array of objects.
 * @returns {Object} - An object containing points, polylines, edges, and pointIndexMap.
 */
export function extractGeometryData(objects) {
    const points = [];
    const polylines = [];

    // Ensure input is an array
    const inputObjects = Array.isArray(objects) ? objects : [objects];

    // Traverse objects and extract data
    inputObjects.forEach((object) => {
        object.traverse((child) => {
            if (child.geometry?.attributes?.position) {
                const positionAttribute = child.geometry.attributes.position;

                // Extract vertices
                const childPoints = [];
                for (let i = 0; i < positionAttribute.count; i++) {
                    const vertex = new Vector3().fromBufferAttribute(positionAttribute, i);
                    points.push(vertex);
                    childPoints.push(vertex);
                }

                // Identify and store polylines
                if (child.type === "Line" || child.type === "LineSegments") {
                    polylines.push(childPoints);
                }
            } else {
                console.warn("Object ", child.name || "Unnamed", " has no valid geometry");
            }
        });
    });

    // Create a map from point to index
    const pointIndexMap = new Map();
    points.forEach((point, index) => {
        pointIndexMap.set(point.toArray().toString(), index);
    });

    // Extract edges from polylines
    const edges = extractEdgesFromPolylines(polylines, pointIndexMap);

    return {
        points,
        polylines,
        edges,
        pointIndexMap,
    };
}
