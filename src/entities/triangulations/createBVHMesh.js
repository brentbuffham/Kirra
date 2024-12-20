import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { Mesh, MeshPhongMaterial, BufferGeometry, Float32BufferAttribute } from "three";

/**
 * Create a BVH mesh from a point cloud.
 * @param {Array} pointVertices - Array of points with x, y, and z coordinates.
 * @returns {Mesh} - The created BVH mesh.
 */
export function createBVHMeshFromPointCloud(pointVertices) {
    if (!pointVertices || pointVertices.length < 3) {
        console.error("Insufficient points to create a BVH mesh. At least three points are required.");
        return null;
    }

    // Flatten the array of points into a single array of coordinates
    const vertices = pointVertices.flatMap((p) => [p.x, p.y, p.z]);

    // Create a BufferGeometry and set the position attribute
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));

    // Add the BVH-specific methods to the geometry
    geometry.computeBoundsTree = MeshBVH.prototype.computeBoundsTree;
    geometry.disposeBoundsTree = MeshBVH.prototype.disposeBoundsTree;
    geometry.acceleratedRaycast = acceleratedRaycast;
    //geometry.computeBoundsTree(); // Compute the BVH for the geometry

    // Create a material
    const material = new MeshPhongMaterial({ color: 0x77ddaa, wireframe: false });

    // Create a mesh with the geometry and material
    const mesh = new Mesh(geometry, material);

    // Add metadata to the meshs
    mesh.userData = {
        name: "BVHMesh",
        isPointCloudMesh: true,
        vertices: pointVertices.length,
        triangles: geometry.index ? geometry.index.count / 3 : 0,
    };

    console.log("BVH Mesh created:", mesh.userData);
    return mesh;
}
