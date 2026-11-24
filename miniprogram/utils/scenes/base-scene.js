/**
 * Base Scene Interface for External Stadium Environments
 *
 * All external scenes derive from BaseScene and implement:
 * - computeDimensions(venueBounds)
 * - buildMeshes(builders, venueBounds, options)
 * - update(elapsedSec, deltaSec, gl)
 * - getClearColor()
 * - getCameraConfig(venueBounds)
 */

class BaseScene {
  constructor(id, name) {
    this.id = id || 'base';
    this.name = name || 'Base Scene';
    this.enabled = true;
  }

  /**
   * Computes scene dimensions and layout parameters adapted to venue bounding box.
   * @param {Object} venueBounds - { radiusX, radiusZ, maxRadius, minX, maxX, minZ, maxZ, minY, maxY }
   * @returns {Object} Scene dimensions configuration
   */
  computeDimensions(venueBounds) {
    return {
      width: (venueBounds && venueBounds.width) || 200,
      depth: (venueBounds && venueBounds.depth) || 200
    };
  }

  /**
   * Generates scene geometry into MeshBuilder groups:
   * @param {Object} builders - { solid, screens, alpha, beams }
   * @param {Object} venueBounds - Extent of current venue
   * @param {Object} [options] - Color overrides or custom styling
   */
  buildMeshes(builders, venueBounds, options) {
    // Abstract hook for subclasses
  }

  /**
   * Frame-by-frame animation update for dynamic scene elements (e.g. clouds, particles).
   * @param {number} elapsedSec - Total elapsed seconds since scene load
   * @param {number} deltaSec - Delta seconds since last frame
   * @param {WebGLRenderingContext} [gl] - Optional WebGL context for bufferSubData
   */
  update(elapsedSec, deltaSec, gl) {
    // Optional hook for subclasses
  }

  /**
   * Returns background clear color as RGB array in [0..1]
   * @returns {Array<number>} [r, g, b, a]
   */
  getClearColor() {
    return [0.04, 0.06, 0.11, 1.0]; // Default deep dark
  }

  /**
   * Returns recommended camera configuration for bird's eye view
   * @param {Object} venueBounds
   * @returns {Object|null}
   */
  getCameraConfig(venueBounds) {
    return null;
  }

  /**
   * Release scene resources if necessary
   */
  dispose() {}
}

module.exports = {
  BaseScene
};
