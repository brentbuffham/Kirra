// File: fileOBJLoader.js
// Dependencies: OBJLoader.js, MTLLoader.js, TextureLoader.js, MeshPhongMaterial.js, DoubleSide.js, Vector3.js, Box3.js, createScene.js, worldOriginSetting.js
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { TextureLoader, MeshBasicMaterial, MeshStandardMaterial, MeshPhongMaterial, DoubleSide, Vector3, Box3, SRGBColorSpace } from "three";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";

let materials;
let object;

/**
 * Handles the OBJ file import without triggering any events.
 * @param {FileList} files - The list of files selected by the user.
 * @param {HTMLCanvasElement} canvas - The canvas element to render the object on.
 */
export function handleOBJNoEvent(files, canvas) {
    console.clear();
    const objFile = files.find((file) => file.name.endsWith(".obj"));
    const mtlFile = files.find((file) => file.name.endsWith(".mtl"));
    const textureFile = files.find((file) => file.name.endsWith(".jpg") || file.name.endsWith(".png"));

    // Exit when no file is found
    if (!objFile) {
        console.error("00) OBJ file not found");
        return;
    }
    if (objFile) {
        console.log("00) OBJ file:", objFile.name);
    }
    if (mtlFile) {
        console.log("00) MTL file:", mtlFile.name);
    }
    if (textureFile) {
        console.log("00) Texture file:", textureFile.name);
    }

    if (mtlFile) {
        console.log("01) MTL File:", mtlFile);
        const fileMTL = mtlFile;
        const mtlReader = new FileReader();
        mtlReader.onload = function (e) {
            console.log("02) MTL Event Details:", e.target.result);
            const mtlLoader = new MTLLoader();
            const mtlContents = e.target.result;
            materials = mtlLoader.parse(mtlContents);
            materials.preload();

            if (textureFile) {
                const textureLoader = new TextureLoader();
                const textureReader = new FileReader();
                textureReader.onload = function (event) {
                    console.log("03) Texture Event Details:", event.target.result);
                    const texture = textureLoader.load(event.target.result);
                    applyTextureToMaterials(texture);
                    loadOBJFile(objFile, canvas);
                };
                textureReader.readAsDataURL(textureFile);
            } else {
                loadOBJFile(objFile, canvas);
                alert("04) No texture file selected");
            }
        };
        mtlReader.readAsText(fileMTL);
    } else {
        console.error("05) MTL file not found");
        alert("06) No MTL file found");
        loadOBJFile(objFile, canvas);
    }

    console.log("07) MTL:", mtlFile);
    console.log("08) OBJ:", objFile);
}

/**
 * Applies the given texture to the materials.
 * @param {Texture} texture - The texture to apply.
 */
function applyTextureToMaterials(texture) {
    if (materials) {
        for (let material of Object.values(materials.materials)) {
            //console.log("09) Applying Texture:", texture);
            //material = new MeshStandardMaterial({ map: texture, side: DoubleSide });
            //Attempt to condition the material to show the texture better
            texture.colorSpace = SRGBColorSpace;
            texture.brighness = 1;
            texture.contrast = 0.5;
            texture.anisotropy = 16;

            //Adjust Texture properties
            material.colorSpace = SRGBColorSpace;
            // material.flatShading = false;
            material.side = DoubleSide;
            // material.luminence = 1;
            // material.blending = 1;
            // material.opacity = 1;
            material.map = texture;
            console.log("09) Applying Texture:", material.map);
            material.needsUpdate = true;
        }
    }
}

/**
 * Loads the OBJ file and processes it.
 * @param {File} objFile - The OBJ file to load.
 * @param {HTMLCanvasElement} canvas - The canvas element to render the object on.
 */
function loadOBJFile(objFile, canvas) {
    console.log("10) OBJ File:", objFile);
    const fileOBJ = objFile;
    const objReader = new FileReader();
    objReader.onload = function (e) {
        console.log("11) OBJ Event Details:", e.target.result);
        const objLoader = new OBJLoader();
        if (materials) {
            console.log("12) Materials:", materials);
            objLoader.setMaterials(materials);
        }
        const contents = e.target.result;
        object = objLoader.parse(contents);
        processLoadedObject(object, canvas, materials);
    };
    objReader.readAsText(fileOBJ);
}

/**
 * Processes the loaded object and adds it to the canvas scene.
 * @param {Object3D} object - The loaded object.
 * @param {HTMLCanvasElement} canvas - The canvas element to render the object on.
 * @param {Material} materials - The materials to apply to the object.
 */
function processLoadedObject(object, canvas, materials) {
    const boundingBox = new Box3().setFromObject(object);
    const center = boundingBox.getCenter(new Vector3());
    console.log("13) Bounding Box:", boundingBox);
    const offsetX = params.worldXCenter !== 0 ? params.worldXCenter : center.x;
    const offsetY = params.worldYCenter !== 0 ? params.worldYCenter : center.y;

    // Set the world center
    if (params.worldXCenter === 0 || params.worldYCenter === 0) {
        console.log("14) World Center:", offsetX, offsetY);
        params.worldXCenter = center.x;
        params.worldYCenter = center.y;
        updateGuiControllers();
    }

    console.log("15) Setting the Objects Center:", offsetX, offsetY);
    object.position.set(0, 0, 0);
    object.scale.set(1, 1, 1);
    object.name = object.name;

    // Backup material for objects without MTL file
    const phong_material = new MeshPhongMaterial({ color: 0xffffff, side: DoubleSide, flatShading: true });

    object.traverse(function (child) {
        if (child.isMesh) {
            const position = child.geometry.attributes.position;
            for (let i = 0; i < position.count; i++) {
                // Offset as the objects are in UTM and real world coordinates and float32 precision is not enough - offset to 0,0
                position.setXYZ(i, position.getX(i) - offsetX, position.getY(i) - offsetY, position.getZ(i));
            }

            child.geometry.computeVertexNormals();
            position.needsUpdate = true;

            // Got no material or texture? - apply default material
            if (!child.material || !child.material.map) {
                console.log("16) child.material", child.material);
                child.material = phong_material;
                child.material.needsUpdate = true;
            } else {
                console.log("17) child.material", child.material);
                child.material.flatShading = false;
                child.material.side = DoubleSide;
                child.material.needsUpdate = true;
            }

            child.geometry.computeBoundingBox();
            child.geometry.computeBoundingSphere();

            // Store the original material
            child.userData.originalMaterial = child.material;

            canvas.scene.add(child);
        }
    });
}
