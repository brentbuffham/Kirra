import { scene } from "./createScene";

const whiteBackground = 0xffffff;
const blackBackground = 0x000000;
const greyBackground = 0x808080;

export const sceneConfig = {
    frustumSize: 1000,
    lightIntensity: 0.6,
    ambientIntensity: 0.1,
    directionalLightPosition: {
        x: 800,
        y: 500,
        z: 2000,
    },
    sceneBackground: blackBackground,
};
