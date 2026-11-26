/**
 * Lights-Off Scene - Concert Stadium Blackout Environment
 *
 * Turns off all stadium house lights, floodlights, cove strips, and perimeter LEDs,
 * leaving only the concert stage lighting illuminated against a deep dark arena.
 */

const { BaseScene } = require('./base-scene');

class LightsOffScene extends BaseScene {
  constructor() {
    super('lights-off', '关灯场景');
  }

  computeDimensions(venueBounds) {
    const r = Math.max(360, (venueBounds ? venueBounds.maxRadius * 2.2 : 360));
    return {
      radius: r,
      width: r * 2,
      depth: r * 2
    };
  }

  buildMeshes(builders, venueBounds) {
    const solid = builders.solid;
    if (!solid) return;

    const dims = this.computeDimensions(venueBounds);
    const plazaR = dims.radius;

    // Deep dark ground plaza so stadium sits in a blackout environment
    solid.addQuad(
      { x: -plazaR, y: -0.60, z: -plazaR },
      { x: -plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: -plazaR },
      [0.02, 0.024, 0.038, 1.0],
      { x: 0, y: 1, z: 0 }
    );
  }

  getClearColor() {
    return [0.012, 0.016, 0.028, 1.0]; // #030407 deep blackout sky
  }
}

module.exports = {
  LightsOffScene
};
