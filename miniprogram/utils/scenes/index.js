/**
 * External 3D Scenes Module
 *
 * Provides modular, swappable exterior 3D environments:
 * - Floating Island Scene: Suspended rock platform, meadow, flowers, strata cliff, clouds, fairy dust
 * - Default Scene: Classic ground plaza
 * - SceneManager: Swappable scene coordinator
 * - BoundsCalculator: Decoupled venue bounds calculation
 */

const { BaseScene } = require('./base-scene');
const { computeVenueBounds } = require('./bounds-calculator');
const { FloatingIslandScene } = require('./floating-island-scene');
const { DefaultScene } = require('./default-scene');
const { SceneManager } = require('./scene-manager');

let defaultManagerInstance = null;

function getSceneManager() {
  if (!defaultManagerInstance) {
    defaultManagerInstance = new SceneManager('floating-island');
  }
  return defaultManagerInstance;
}

module.exports = {
  BaseScene,
  computeVenueBounds,
  FloatingIslandScene,
  DefaultScene,
  SceneManager,
  getSceneManager
};
