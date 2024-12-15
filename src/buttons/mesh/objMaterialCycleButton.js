import * as THREE from "three";

export function bindListenerToObjMaterialCycleButton(scene, params) {
	document.querySelector("#obj-display").addEventListener("click", () => {
		params.wireframeSolidTransparentTexture = params.wireframeSolidTransparentTexture === "Texture" ? "Solid" : params.wireframeSolidTransparentTexture === "Solid" ? "Transparent" : params.wireframeSolidTransparentTexture === "Transparent" ? "Wireframe" : params.wireframeSolidTransparentTexture === "Wireframe" ? "Invisible" : "Texture";

		scene.traverse(function (child) {
			if (child.userData.isOBJMesh || child.userData.isTXTMesh || child.userData.isGeneratedMesh) {
				// Check if it is the OBJ mesh
				if (params.wireframeSolidTransparentTexture === "Texture") {
					document.querySelector("#info-label").textContent = "Texture On";
					document.querySelector("#obj-display").innerHTML = `<img src="./assets/png/cube-material.png" alt="Texture Display" />`;
					child.material = child.userData.originalMaterial || child.material;
					scene.traverse(function (object) {
						if (object instanceof THREE.DirectionalLight) {
							object.intensity = 0.6;
						}
					});
				} else if (params.wireframeSolidTransparentTexture === "Solid") {
					document.querySelector("#info-label").textContent = "Solid On";
					document.querySelector("#obj-display").innerHTML = `<img src="./assets/png/hexagon-filled.png" alt="Solid Display" />`;
					child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: false, side: THREE.DoubleSide });
					scene.traverse(function (object) {
						if (object instanceof THREE.DirectionalLight) {
							object.intensity = 0.6;
						}
					});
				} else if (params.wireframeSolidTransparentTexture === "Transparent") {
					document.querySelector("#info-label").textContent = "Transparent On";
					document.querySelector("#obj-display").innerHTML = `<img src="./assets/png/cube-transparent.png" alt="Transparent Display" />`;
					child.material = new THREE.MeshPhongMaterial({ color: child.material.color, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
				} else if (params.wireframeSolidTransparentTexture === "Wireframe") {
					document.querySelector("#info-label").textContent = "Wireframe On";
					document.querySelector("#obj-display").innerHTML = `<img src="./assets/png/cube-wireframe.png" alt="Wireframe Display" />`;
					child.material = new THREE.MeshBasicMaterial({ color: child.material.color, wireframe: true });
				} else if (params.wireframeSolidTransparentTexture === "Invisible") {
					document.querySelector("#info-label").textContent = "Invisible On";
					document.querySelector("#obj-display").innerHTML = `<img src="./assets/png/hexagon-letter-x.png" alt="Invisible Display" />`;
					child.material = new THREE.MeshBasicMaterial({ color: child.material.color, visible: false });
				}
				child.material.needsUpdate = true;
			}
		});
	});
}
