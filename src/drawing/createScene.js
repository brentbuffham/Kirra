//createScene.js
//consistently import THREE
import * as THREE from "three";
import {
    AmbientLight,
    ArrowHelper,
    DirectionalLight,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer
} from "three";
import {ArcballControls} from "three/addons/controls/ArcballControls.js";
import {debugGui, gui} from "./debugGui.js";
import {setArcBallControls} from "./setArcBallControls.js";
import {bindingKeys} from "./sceneKeybinds.js";
import {createViewHelper} from "./viewHelper.js";
import {onWindowResize} from "./ResizeScene.js";
import {sceneConfig} from "./sceneConfig.js";


export let camera, scene, controls;
export const params = {
    cameraPerspective: false,
    upDirection: "Z",
    rotationAngle: 0,
    holeDisplay: "mesh-cross",
    holeText: "ID",
    debugComments: true
    // holeColour: "white",
    // holeSubdrillColour: "red"
};

export let renderer, clock;
export let transformControls;

function createLighting() {
    //create ambient light
    const ambientLight = new AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    //create directional light
    const directionalLight = new DirectionalLight(0xffffff, 2);
    directionalLight.position.set(0, 500, 500);
    scene.add(directionalLight);
}

function setCamera(aspect) {
    const {frustumSize} = sceneConfig ;
    const cameraPerspective = new PerspectiveCamera()
    cameraPerspective.fov = 56.5;
    cameraPerspective.aspect = window.innerWidth / window.innerHeight;
    cameraPerspective.near = 0.01;
    cameraPerspective.far = 500;

    const cameraOrthographic = new OrthographicCamera();
    cameraOrthographic.left = -frustumSize * aspect / 2;
    cameraOrthographic.right = frustumSize * aspect / 2;
    cameraOrthographic.top = frustumSize / 2;
    cameraOrthographic.bottom = -frustumSize / 2;
    cameraOrthographic.near = 0.01;
    cameraOrthographic.far = 500;

    camera = params.cameraPerspective ? cameraPerspective : cameraOrthographic;
    return {cameraPerspective, cameraOrthographic};
}

export function createScene(points) {
    console.log("createScene(points)", points);
    scene = new Scene();
    const canvas = document.querySelector("#canvas");
    let aspect = canvas.offsetWidth / canvas.offsetHeight;
    // clock
    clock = new THREE.Clock();
    //create Gizmos for the ArcballControls
    const objectCenter = new Object3D();
    if (points === null || points.length === 0) {
        objectCenter.position.set(0, 0, 0);
    }
    //gizmos.add(new AxesHelper(10));
    objectCenter.add(new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0, 0), 10, 0xff0000, 5, 2));
    objectCenter.add(new ArrowHelper(new Vector3(0, 1, 0), new Vector3(0, 0, 0), 10, 0x00ff00, 5, 2));
    objectCenter.add(new ArrowHelper(new Vector3(0, 0, 1), new Vector3(0, 0, 0), 10, 0x0000ff, 5, 2));

    objectCenter.name = "objectCenter";
    scene.add(objectCenter);

    //Set up the Cameras
    let {cameraOrthographic, cameraPerspective} = setCamera(aspect);

    //Set up the Renderer
    renderer = new WebGLRenderer({antialias: true}); // Add the antialias parameter here
    renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false;
    document.querySelector("#canvas").appendChild(renderer.domElement);

    // const transformControls = new TransformControls(camera, renderer.domElement);
    // Initialize camera with one of the cameras
    controls = new ArcballControls(camera, renderer.domElement, scene);
    controls.setGizmosVisible(true);
    createLighting(scene);

    const position = new Vector3(0, 0, 0 + 200);
    camera.position.copy(position);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 1, 0);
    controls.target.set(0, 0, 0);
    //set the controls to the stored position and target
    camera.position.copy(position);
    controls.target.copy(objectCenter.position);

    let viewHelper = createViewHelper();

    setArcBallControls(controls, viewHelper);

    bindingKeys(objectCenter, controls, viewHelper);

    debugGui(cameraPerspective, cameraOrthographic, controls, viewHelper, camera);

    ///////////////////////
    //Only functions prior to upload of the csv file at this stage.
    if (points !== null || points.length > 0) {
        const holeFolder = gui.addFolder("Hole Options");
        holeFolder.close();
        // const holeOptions = ["mesh-cross", "mesh-circle", "mesh-diamond", "mesh-square", "mesh-cylinder", "line-cross", "line-circle", "line-diamond", "line-square"];
        // holeFolder.add(params, "holeDisplay", holeOptions).name("Hole Display Type").onChange(function() {
        // 	//nothing yet
        // });
        const holeTextOptions = ["Off", "ID", "Length"];
        holeFolder.add(params, "holeText", holeTextOptions).name("Hole Text").onChange(function () {
            //nothing yet
        });
    }

    animate();

    function animate() {
        requestAnimationFrame(animate);
        renderer.clear();
        const delta = clock.getDelta();

        if (viewHelper.animating) viewHelper.update(delta);

        renderer.render(scene, camera);
        viewHelper.render(renderer);
    }

    return {scene, camera};
}



onWindowResize();
