import earcut from "earcut";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshPhongMaterial, DoubleSide } from "three";

export function createMeshUsingEarcut(points3D, defaultColour) {
    // Flatten 2D coordinates for Earcut
    const flatCoords = [];
    points3D.forEach((p) => flatCoords.push(p.x, p.y));

    // Perform triangulation
    const indices = earcut(flatCoords);

    // Create geometry with actual 3D coordinates
    const vertices = [];
    points3D.forEach((p) => vertices.push(p.x, p.y, p.z || 0)); // Use Z if provided, otherwise default to 0

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new MeshPhongMaterial({ color: defaultColour, side: DoubleSide });
    return new Mesh(geometry, material);
}
