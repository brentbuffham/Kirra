import * as THREE from "three";

export function createDXF3DFace(entity, offsetX, offsetY, entityName) {
    console.log("3DFACE entity:", entity); // Debug log

    // 3DFACE entities have vertices that define corner points
    const vertices = [];

    // Check for vertices property (what the DXF parser actually provides)
    if (entity.vertices && entity.vertices.length >= 3) {
        entity.vertices.forEach((vertex) => {
            vertices.push(vertex.x - offsetX, vertex.y - offsetY, vertex.z || 0);
        });

        // Create geometry
        const geometry = new THREE.BufferGeometry();

        // If we have 4 points, create two triangles for the quad
        if (entity.vertices.length === 4) {
            // Triangle 1: points 0, 1, 2
            // Triangle 2: points 0, 2, 3
            const indices = [0, 1, 2, 0, 2, 3];
            geometry.setIndex(indices);
        } else if (entity.vertices.length === 3) {
            // Just one triangle
            const indices = [0, 1, 2];
            geometry.setIndex(indices);
        }

        // Set vertex positions
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));

        // Compute normals for proper lighting
        geometry.computeVertexNormals();

        let color = entity.color || 0xffffff;

        // Use MeshPhongMaterial like in createDelaunayMesh for better lighting
        let material = new THREE.MeshPhongMaterial({
            color: color,
            side: THREE.DoubleSide,
            transparent: entity.alpha ? true : false,
            opacity: entity.alpha || 1.0,
            flatShading: false, // Set to true if you want flat shading like in Delaunay mesh
        });

        let face3d = new THREE.Mesh(geometry, material);
        face3d.name = entityName;
        face3d.dxfType = entity.type;

        console.log("Created 3DFACE mesh:", face3d); // Debug log
        return face3d;
    } else {
        console.warn("3DFACE entity missing vertices data:", entity);
        return null;
    }
}
