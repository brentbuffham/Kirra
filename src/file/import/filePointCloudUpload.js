// filePointCloudUpload.js
import { showCustomPTNModal } from "../../views/modals/pointCloudModal.js";
import Papa from "papaparse";
import { getCentroid, getPointCloudCentroid } from "../../helpers/getCentroid.js";
import { camera, controls, scene, objectCenter } from "../../drawing/createScene.js";
import { params } from "../../drawing/createScene.js";
import { updateGuiControllers } from "../../settings/worldOriginSetting.js";
import { parsePointCloud } from "./filePointCloudLoader.js";
import { Vector3, Color } from "three";
import { BufferGeometry, PointsMaterial, Points, Float32BufferAttribute } from "three";
import { BoxGeometry, MeshBasicMaterial, Mesh } from "three";
import { createMeshFromPointCloud, createDelaunayMeshFromPointCloud } from "../../entities/shapes/createMeshFromPoints.js";
import { hexToRgb } from "../../helpers/colorToOther.js";
import { counter } from "../../main.js";

export let cloudPoints = [];

export const handleFileUploadNoEvent = (data) => {
	const results = Papa.parse(data, {
		header: false,
		skipEmptyLines: true,
		dynamicTyping: false,
		complete: function (results) {
			const columns = results.meta.fields;
			const csvData = results.data;

			const pointCloudOrder = JSON.parse(localStorage.getItem("pointCloudOrder") || "{}");

			const headerRows = parseInt(pointCloudOrder.headerRows) || 0;

			let previewContent;
			if (headerRows === 0) {
				previewContent = [Object.keys(csvData[0]).join(","), ...csvData.map((row) => Object.values(row).join(","))].join("\n");
			} else {
				previewContent = csvData
					.slice(headerRows)
					.map((row) => Object.values(row).join(","))
					.join("\n");
			}

			showCustomPTNModal(columns, previewContent, csvData);
		}
	});
};

let centroid = new Vector3(0, 0, 0);

export const handleFileSubmit = (data, pointCloudOrder, defaultColour, maxEdgeLength) => {
	cloudPoints = [];
	try {
		counter.cloudPointFileCount++;
		const cloudPointName = "point-cloud" + counter.cloudPointFileCount;
		const newPoints = parsePointCloud(data, pointCloudOrder, cloudPointName);
		cloudPoints.push(...newPoints);
		console.log("cloudPoints: ", cloudPoints);

		let x, y, z;

		if (params.worldXCenter === 0 && params.worldYCenter === 0) {
			centroid = getPointCloudCentroid(cloudPoints);
			x = centroid.x;
			y = centroid.y;
			z = centroid.z;
			params.worldXCenter = x;
			params.worldYCenter = y;
			updateGuiControllers();
		} else {
			x = params.worldXCenter || 0;
			y = params.worldYCenter || 0;
			z = 0;
		}

		const timeDateNow = Date.now();

		const pointGeometry = new BufferGeometry();
		const vertices = [];
		const colours = [];
		const colour = hexToRgb(defaultColour);
		const defaultAlphaValue = 1;
		console.log("default colour: ", colour.r, ":", colour.g, ":", colour.b);
		//let pointMaterial = new PointsMaterial({ size: 1, vertexColors: true });
		let normalizeColor = (color) => (color > 1 ? color / 255 : color);
		for (const point of cloudPoints) {
			const tempPoint = {
				pointID: point.pointID,
				pointX: parseFloat(point.pointX - x),
				pointY: parseFloat(point.pointY - y),
				pointZ: parseFloat(point.pointZ - z),
				pointR: isNaN(normalizeColor(parseFloat(point.pointR))) ? colour.r : normalizeColor(parseFloat(point.pointR)),
				pointG: isNaN(normalizeColor(parseFloat(point.pointG))) ? colour.g : normalizeColor(parseFloat(point.pointG)),
				pointB: isNaN(normalizeColor(parseFloat(point.pointB))) ? colour.b : normalizeColor(parseFloat(point.pointB)),
				pointA: isNaN(parseFloat(point.pointA), 1)
			};

			vertices.push(tempPoint.pointX, tempPoint.pointY, tempPoint.pointZ);

			if (tempPoint.pointR !== null && tempPoint.pointG !== null && tempPoint.pointB !== null) {
				colours.push(tempPoint.pointR, tempPoint.pointG, tempPoint.pointB);
				//console.log("R:", tempPoint.pointR, "G:", tempPoint.pointG, "B:", tempPoint.pointB);
			} else {
				colours.push(1, 1, 1); // Default to white if no color is provided
			}
		}
		console.log("vertices count: ", vertices.length / 3);
		console.log("vertices: ", vertices);

		if (document.getElementById("createMesh").checked) {
			const cloudVertices = [];
			for (let i = 0; i < vertices.length; i += 3) {
				cloudVertices.push({
					x: vertices[i],
					y: vertices[i + 1],
					z: vertices[i + 2]
				});
			}

			//Max EdgeLength in meters
			maxEdgeLength = maxEdgeLength || 15;
			const pointCloudMesh = createDelaunayMeshFromPointCloud(cloudVertices, maxEdgeLength, defaultColour);
			pointCloudMesh.userData = {
				name: cloudPointName,
				points: cloudPoints,
				isTXTMesh: true,
				creationTime: timeDateNow
			};

			scene.add(pointCloudMesh);
		} else {
			const pointGeometry = new BufferGeometry();
			pointGeometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
			pointGeometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
			const pointMaterial = new PointsMaterial({ size: 2, vertexColors: true });
			const pointCloud = new Points(pointGeometry, pointMaterial);
			pointCloud.name = cloudPointName;
			pointCloud.userData = {
				name: cloudPointName,
				points: cloudPoints,
				isTXTMesh: false,
				creationTime: timeDateNow
			};
			scene.add(pointCloud);
		}
		camera.position.set(0, 0, parseFloat(params.cameraDistance));
		centroid = getPointCloudCentroid(cloudPoints);
		objectCenter.position.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		controls.target.set(centroid.x - params.worldXCenter, centroid.y - params.worldYCenter, centroid.z);
		camera.lookAt(objectCenter.position);
		camera.updateProjectionMatrix();
		controls.update();
	} catch (err) {
		console.error("Error in handleFileSubmit: ", err);
	}
};
