/**
 * Default Scene - Classic Minimal Ground Plaza
 *
 * Implements the baseline flat ground plaza apron at y = -0.60.
 */

const { BaseScene } = require('./base-scene');

class DefaultScene extends BaseScene {
  constructor() {
    super('default', '经典地台广场');
  }

  computeDimensions(venueBounds) {
    const r = Math.max(360, (venueBounds ? venueBounds.maxRadius * 2.2 : 360));
    return {
      radius: r,
      width: r * 2,
      depth: r * 2
    };
  }

  buildMeshes(builders, venueBounds, options) {
    const solid = builders.solid;
    if (!solid) return;

    const dims = this.computeDimensions(venueBounds);
    const plazaR = dims.radius;
    const overrides = (options && options.overrides) || {};

    // Standard dark ground plaza color
    let r = 0.059, g = 0.090, b = 0.165; // #0F172A
    if (overrides.ground && typeof overrides.ground === 'string' && overrides.ground.startsWith('#')) {
      const hex = overrides.ground.replace('#', '');
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16) / 255;
        g = parseInt(hex.slice(2, 4), 16) / 255;
        b = parseInt(hex.slice(4, 6), 16) / 255;
      }
    }

    solid.addQuad(
      { x: -plazaR, y: -0.60, z: -plazaR },
      { x: -plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: -plazaR },
      [r, g, b, 1.0],
      { x: 0, y: 1, z: 0 }
    );
  }

  getClearColor() {
    return [0.039, 0.059, 0.114, 1.0]; // #0A0F1D
  }
}

module.exports = {
  DefaultScene
};
