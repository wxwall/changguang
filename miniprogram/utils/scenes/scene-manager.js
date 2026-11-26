/**
 * Scene Manager for External 3D Environments
 *
 * Coordinates modular, swappable exterior environments for 3D stadium scenes.
 * Independent from internal venue geometry algorithms.
 */

const { computeVenueBounds } = require('./bounds-calculator');
const { FloatingIslandScene } = require('./floating-island-scene');
const { DefaultScene } = require('./default-scene');
const { LightsOffScene } = require('./lights-off-scene');

class SceneManager {
  constructor(initialSceneId) {
    this.scenes = new Map();
    this.currentSceneId = null;
    this.currentVenue = null;
    this.venueBounds = null;

    // Register built-in scenes
    this.registerScene(new FloatingIslandScene());
    this.registerScene(new DefaultScene());
    this.registerScene(new LightsOffScene());

    // Set default active scene
    this.setCurrentScene(initialSceneId || 'floating-island');
  }

  /**
   * Registers a scene implementation
   * @param {BaseScene} scene
   */
  registerScene(scene) {
    if (!scene || !scene.id) return;
    this.scenes.set(scene.id, scene);
  }

  /**
   * Switches the active scene
   * @param {string} sceneId
   * @returns {boolean} Whether switch was successful
   */
  setCurrentScene(sceneId) {
    if (!this.scenes.has(sceneId)) {
      console.warn(`[SceneManager] Scene '${sceneId}' not found. Available:`, Array.from(this.scenes.keys()));
      return false;
    }
    this.currentSceneId = sceneId;
    return true;
  }

  /**
   * Returns current active scene instance
   * @returns {BaseScene|null}
   */
  getCurrentScene() {
    return this.scenes.get(this.currentSceneId) || null;
  }

  getCurrentSceneId() {
    return this.currentSceneId;
  }

  hasActiveScene() {
    return Boolean(this.getCurrentScene());
  }

  getAvailableScenes() {
    const list = [];
    for (const [id, scene] of this.scenes.entries()) {
      list.push({ id, name: scene.name });
    }
    return list;
  }

  /**
   * Updates venue reference and computes bounding bounds.
   * @param {Object} venue
   * @param {Object} [customBounds]
   */
  setVenue(venue, customBounds) {
    this.currentVenue = venue;
    this.venueBounds = customBounds || computeVenueBounds(venue);
  }

  /**
   * Returns current venue bounds
   */
  getVenueBounds() {
    if (!this.venueBounds && this.currentVenue) {
      this.venueBounds = computeVenueBounds(this.currentVenue);
    }
    return this.venueBounds;
  }

  /**
   * Builds meshes for the current scene
   * @param {Object} builders - { solid, screens, alpha, beams }
   * @param {Object} [options]
   */
  buildMeshes(builders, options) {
    const scene = this.getCurrentScene();
    if (!scene) return;
    const bounds = this.getVenueBounds();
    scene.buildMeshes(builders, bounds, options);
  }

  hasDynamicAnimation() {
    const scene = this.getCurrentScene();
    return Boolean(scene && typeof scene.hasDynamicAnimation === 'function' && scene.hasDynamicAnimation());
  }

  /**
   * Updates frame animations
   * @param {number} elapsedSec
   * @param {number} [deltaSec]
   * @param {WebGLRenderingContext} [gl]
   * @param {Object} [buffers]
   */
  update(elapsedSec, deltaSec, gl, buffers) {
    const scene = this.getCurrentScene();
    if (scene && typeof scene.update === 'function') {
      scene.update(elapsedSec, deltaSec || 0.016, gl, buffers);
    }
  }

  /**
   * Returns scene clear color
   * @returns {Array<number>|null}
   */
  getClearColor() {
    const scene = this.getCurrentScene();
    return scene ? scene.getClearColor() : null;
  }

  /**
   * Returns camera recommendations
   */
  getCameraConfig() {
    const scene = this.getCurrentScene();
    return scene ? scene.getCameraConfig(this.getVenueBounds()) : null;
  }

  dispose() {
    for (const scene of this.scenes.values()) {
      if (typeof scene.dispose === 'function') {
        scene.dispose();
      }
    }
    this.scenes.clear();
  }
}

module.exports = {
  SceneManager,
  computeVenueBounds
};
