// src/shaders/analytics/BlastAnalyticsShader.js
import * as THREE from "three";
import { BaseAnalyticsShader } from "../core/BaseAnalyticsShader.js";
import { ShaderUniformManager } from "../core/ShaderUniformManager.js";
import { ColourRampFactory } from "../core/ColourRampFactory.js";
import { ShaderFlattenHelper } from "../core/ShaderFlattenHelper.js";
import { PPVModel } from "./models/PPVModel.js";
import { HeelanOriginalModel } from "./models/HeelanOriginalModel.js";
import { ScaledHeelanModel } from "./models/ScaledHeelanModel.js";
import { NonLinearDamageModel } from "./models/NonLinearDamageModel.js";
import { SDoBModel } from "./models/SDoBModel.js";
import { SEEModel } from "./models/SEEModel.js";
import { PressureModel } from "./models/PressureModel.js";
import { PowderFactorModel } from "./models/PowderFactorModel.js";
import { JointedRockDamageModel } from "./models/JointedRockDamageModel.js";
import { PPVDeckModel } from "./models/PPVDeckModel.js";

// Shared vertex shader
var VERT_SOURCE = `
    precision highp float;
    varying vec3 vWorldPos;
    uniform vec3 uWorldOffset;  // originX, originY, 0

    void main() {
        // Reconstruct world position from local mesh coords
        vWorldPos = position.xyz + uWorldOffset;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

/**
 * BlastAnalyticsShader is the main orchestrator for GPU-based blast analytics.
 *
 * It manages a registry of analytics models (PPV, Heelan, Damage) and provides
 * reactive updates when holes move or charges change.
 *
 * Usage:
 *   var analytics = new BlastAnalyticsShader(threeRenderer);
 *   analytics.setModel("ppv", { K: 1140, B: 1.6 });
 *   analytics.update(allBlastHoles);
 *   var mesh = analytics.buildPlane(bounds, elevation);
 *   scene.add(mesh);
 */
export class BlastAnalyticsShader extends BaseAnalyticsShader {
    constructor(sceneManager, options) {
        super(sceneManager, options);

        // Registry of available models
        this.models = {};
        this._registerModel(new PPVModel());
        this._registerModel(new HeelanOriginalModel());
        this._registerModel(new ScaledHeelanModel());
        this._registerModel(new NonLinearDamageModel());
        // this._registerModel(new SDoBModel());     // Hidden from UI — code retained
        // this._registerModel(new SEEModel());      // Hidden from UI — code retained
        this._registerModel(new PressureModel());
        this._registerModel(new PowderFactorModel());
        this._registerModel(new JointedRockDamageModel());
        this._registerModel(new PPVDeckModel());

        // Active model
        this.activeModel = null;
        this.modelParams = {};

        // Uniform manager
        this.uniformManager = new ShaderUniformManager(512);

        // Flatten helper
        this.flattenHelper = null;  // created lazily

        // Cached state
        this._lastHoleHash = null;
        this._worldOffset = new THREE.Vector3(0, 0, 0);
    }

    // --- Model Registry ---

    /**
     * Register a model in the registry.
     * @param {Object} model - Model instance (PPVModel, HeelanOriginalModel, etc.)
     * @private
     */
    _registerModel(model) {
        this.models[model.name] = model;
    }

    /**
     * Get list of available models.
     * @returns {Array} - Array of { name, displayName, unit }
     */
    getAvailableModels() {
        var list = [];
        for (var key in this.models) {
            var m = this.models[key];
            list.push({ name: m.name, displayName: m.displayName, unit: m.unit });
        }
        return list;
    }

    // --- Model Management ---

    /**
     * Switch to a different analytics model.
     * Rebuilds the shader material with the new fragment source.
     *
     * @param {string} modelName - Model name (e.g., "ppv", "scaled_heelan")
     * @param {Object} params - Model-specific parameters
     */
    setModel(modelName, params) {
        var model = this.models[modelName];
        if (!model) {
            console.warn("BlastAnalyticsShader: unknown model '" + modelName + "'");
            return;
        }

        this.activeModel = model;
        this.modelParams = params || {};

        // Set colour ramp defaults
        this.colourRampName = model.defaultColourRamp;
        this.minValue = model.defaultMin;
        this.maxValue = model.defaultMax;

        // Rebuild material
        this._rebuildMaterial();
        this._markDirty();
    }

    /**
     * Update model parameters (e.g. site constants K, B).
     *
     * @param {Object} params - Parameters to update
     */
    setParams(params) {
        this.modelParams = Object.assign(this.modelParams, params);
        if (this.material && this.activeModel) {
            var modelUniforms = this.activeModel.getUniforms(this.modelParams);
            for (var key in modelUniforms) {
                if (this.material.uniforms[key]) {
                    this.material.uniforms[key].value = modelUniforms[key].value;
                }
            }
            this.material.uniformsNeedUpdate = true;
        }
    }

    // --- Data Updates ---

    /**
     * Update with new hole data. Call after holes move, charges change, etc.
     *
     * @param {Array} allBlastHoles - Array of blast hole objects
     * @param {Object} options - { useToeLocation: bool }
     */
    update(allBlastHoles, options) {
        if (!this.activeModel || !allBlastHoles || allBlastHoles.length === 0) return;

        // Pack hole data into texture
        this.uniformManager.packHoles(allBlastHoles, options);

        // Update uniforms
        if (this.material) {
            this.material.uniforms.uHoleData.value = this.uniformManager.texture;
            this.material.uniforms.uHoleCount.value = this.uniformManager.holeCount;
            this.material.uniforms.uHoleDataWidth.value = this.uniformManager.textureWidth;
            this.material.uniformsNeedUpdate = true;
        }

        this.dirty = true;
    }

    /**
     * Fast path: update a single hole during drag.
     *
     * @param {number} index - Hole index in array
     * @param {Object} hole - Updated hole object
     * @param {Object} options - { useToeLocation: bool }
     */
    updateSingleHole(index, hole, options) {
        this.uniformManager.updateHole(index, hole, options);
        if (this.material) {
            this.material.uniforms.uHoleData.value = this.uniformManager.texture;
            this.material.uniformsNeedUpdate = true;
        }
    }

    // --- Mesh Building ---

    /**
     * Build the mesh on a given geometry (typically a triangulated surface
     * or a simple plane covering the blast area).
     *
     * @param {THREE.BufferGeometry} geometry - Geometry to apply shader to
     * @param {Object} worldOffset - { x, y, z } world offset for coordinate transform
     * @returns {THREE.Mesh}
     */
    buildOnGeometry(geometry, worldOffset) {
        if (this.mesh) {
            if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
            this.mesh.geometry.dispose();
        }

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.userData = { type: "blastAnalytics", model: this.activeModel.name };

        if (worldOffset) {
            this._worldOffset.set(worldOffset.x || 0, worldOffset.y || 0, worldOffset.z || 0);
            this.material.uniforms.uWorldOffset.value.copy(this._worldOffset);
        }

        return this.mesh;
    }

    /**
     * Build a flat plane covering the blast extent.
     * This is the simplest option — a rectangle at collar elevation.
     *
     * @param {Object} bounds - { minX, minY, maxX, maxY }
     * @param {number} elevation - Z elevation for plane
     * @param {number} padding - Padding around bounds (metres)
     * @returns {THREE.Mesh}
     */
    buildPlane(bounds, elevation, padding) {
        padding = padding || 50;  // metres
        var minX = bounds.minX - padding;
        var maxX = bounds.maxX + padding;
        var minY = bounds.minY - padding;
        var maxY = bounds.maxY + padding;

        var width = maxX - minX;
        var height = maxY - minY;
        var centerX = (minX + maxX) / 2;
        var centerY = (minY + maxY) / 2;

        var segments = Math.min(Math.ceil(Math.max(width, height) / 2), 256);

        // Create plane geometry centered at origin
        // Vertices will be at (-width/2, -height/2, 0) to (width/2, height/2, 0)
        var geom = new THREE.PlaneGeometry(width, height, segments, segments);

        // Get Three.js local origin offset
        var threeLocalOriginX = window.threeLocalOriginX || 0;
        var threeLocalOriginY = window.threeLocalOriginY || 0;

        // Build mesh with worldOffset for shader calculations
        // worldOffset maps geometry center (0,0) to world center (centerX, centerY)
        var mesh = this.buildOnGeometry(geom, {
            x: centerX,
            y: centerY,
            z: elevation || 0
        });

        // Position mesh in Three.js scene space
        // Scene origin corresponds to world (threeLocalOriginX, threeLocalOriginY, 0)
        // We want mesh center at world (centerX, centerY, elevation)
        // So in scene space: (centerX - threeLocalOriginX, centerY - threeLocalOriginY, elevation)
        var centerLocalX = centerX - threeLocalOriginX;
        var centerLocalY = centerY - threeLocalOriginY;
        mesh.position.set(centerLocalX, centerLocalY, elevation || 0);

        return mesh;
    }

    // --- 2D Flattening ---

    /**
     * Flatten to 2D canvas for overlay in the 2D view.
     *
     * @param {THREE.WebGLRenderer} renderer - Three.js renderer
     * @param {Object} bounds - { minX, minY, maxX, maxY }
     * @param {number} pixelsPerMetre - Resolution (default 1.0)
     * @returns {{ canvas, bounds, width, height, pixelsPerMetre }}
     */
    flatten(renderer, bounds, pixelsPerMetre) {
        if (!this.flattenHelper) {
            this.flattenHelper = new ShaderFlattenHelper(renderer);
        }
        return this.flattenHelper.flatten(this.mesh, bounds, pixelsPerMetre || 1.0);
    }

    // --- Internal ---

    /**
     * Rebuild the shader material with current model and parameters.
     * @private
     */
    _rebuildMaterial() {
        if (this.material) this.material.dispose();
        if (this.colourRampTexture) this.colourRampTexture.dispose();

        this.colourRampTexture = ColourRampFactory.create(this.colourRampName);

        var baseUniforms = {
            uHoleData: { value: this.uniformManager.texture },
            uHoleCount: { value: this.uniformManager.holeCount },
            uHoleDataWidth: { value: this.uniformManager.textureWidth },
            uColourRamp: { value: this.colourRampTexture },
            uMinValue: { value: this.minValue },
            uMaxValue: { value: this.maxValue },
            uOpacity: { value: this.transparency },
            uWorldOffset: { value: this._worldOffset.clone() }
        };

        var modelUniforms = this.activeModel.getUniforms(this.modelParams);

        // Merge
        var allUniforms = {};
        for (var k in baseUniforms) allUniforms[k] = baseUniforms[k];
        for (var k in modelUniforms) allUniforms[k] = modelUniforms[k];

        this.material = new THREE.ShaderMaterial({
            vertexShader: VERT_SOURCE,
            fragmentShader: this.activeModel.getFragmentSource(this.modelParams),
            uniforms: allUniforms,
            transparent: true,
            depthWrite: true,
            side: THREE.DoubleSide
        });
    }

    /**
     * Dispose of all resources.
     */
    dispose() {
        if (this.uniformManager) this.uniformManager.dispose();
        if (this.flattenHelper) this.flattenHelper.dispose();
        if (this.colourRampTexture) this.colourRampTexture.dispose();
        if (this.material) this.material.dispose();
        if (this.mesh) {
            if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
            if (this.mesh.geometry) this.mesh.geometry.dispose();
        }
        this.mesh = null;
        this.material = null;
    }
}
