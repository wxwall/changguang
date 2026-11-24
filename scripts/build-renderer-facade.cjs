const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const content = cp.execSync('git show 3bd973cf08728ab8fc6971b9709d45e9910efb5d:miniprogram/utils/renderer-3d.js').toString();
const lines = content.split('\n');

function slice(startLine, endLine) {
  return lines.slice(startLine - 1, endLine).join('\n');
}

const utilsDir = path.resolve(__dirname, '../miniprogram/utils');

const renderer3dContent = `/**
 * STADIACAD 3D WebGL Immersive Stadium & Concert Stage Engine
 * Pure Native WebGL1 implementation for WeChat Mini Program <canvas type="webgl">
 *
 * Modular Architecture:
 * - Mat4: 4x4 matrix mathematics (./engine-3d-mat4)
 * - MeshBuilder: typed geometry synthesizer (./engine-3d-mesh-builder)
 * - AngleMixin: angular discretization (./engine-3d-angle)
 * - InfieldMixin: pitch, track, modules & ground shell (./engine-3d-infield)
 * - StandMixin: tiers, VIP suites & vomitories (./engine-3d-stand)
 * - CanopyMixin: stadium canopy rim & saddle curves (./engine-3d-canopy)
 * - StageMixin: concert stage, LEDs, trusses & catwalk (./engine-3d-stage)
 * - RaycastMixin: screen-to-seat ray intersection (./engine-3d-raycaster)
 */

const {
  DEG2RAD,
  RAD2DEG,
  rotateXZ,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat,
  getTierRowsAtAngle,
  getInfieldCornerTransitionAngles,
  getRowInwardNormal,
  getRayRoundedRectDistance,
  computeRunningTrackSpec,
  getStageTransform,
  computeVomitoryAngularBounds,
  generateConcertInfieldBlocks
} = require('./schema-geometry');
const { hexToSeat3D } = require('./seat-colors');

const { Mat4 } = require('./engine-3d-mat4');
const { MeshBuilder } = require('./engine-3d-mesh-builder');
const { AngleMixin } = require('./engine-3d-angle');
const { CanopyMixin } = require('./engine-3d-canopy');
const { StageMixin } = require('./engine-3d-stage');
const { InfieldMixin } = require('./engine-3d-infield');
const { StandMixin } = require('./engine-3d-stand');
const { RaycastMixin } = require('./engine-3d-raycaster');

${slice(112, 150)}

${slice(337, 539)}

${slice(839, 891)}

${slice(2961, 3062)}

// Attach all modular mixins to Renderer3D prototype
Object.assign(
  Renderer3D.prototype,
  AngleMixin,
  CanopyMixin,
  StageMixin,
  InfieldMixin,
  StandMixin,
  RaycastMixin
);

Renderer3D.Mat4 = Mat4;
Renderer3D.MeshBuilder = MeshBuilder;

module.exports = {
  Renderer3D,
  Mat4,
  MeshBuilder
};
`;

const processedRenderer3D = renderer3dContent.replace(
  '  initGL() {\n    const gl = this.gl;\n',
  '  initGL() {\n    const gl = this.gl;\n    if (!gl) return;\n'
);

fs.writeFileSync(path.join(utilsDir, 'renderer-3d.js'), processedRenderer3D);
console.log('renderer-3d.js generated successfully! Lines:', processedRenderer3D.split('\n').length);
