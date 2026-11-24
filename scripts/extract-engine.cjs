const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const content = cp.execSync('git show 3bd973cf08728ab8fc6971b9709d45e9910efb5d:miniprogram/utils/renderer-3d.js').toString();
const lines = content.split('\n');

function slice(startLine, endLine) {
  return lines.slice(startLine - 1, endLine).join('\n');
}

function makeMixin(name, code) {
  return `class ${name}Holder {
${code}
}
const ${name} = {};
Object.getOwnPropertyNames(${name}Holder.prototype).forEach(k => {
  if (k !== 'constructor') ${name}[k] = ${name}Holder.prototype[k];
});
module.exports = { ${name} };
`;
}

const utilsDir = path.resolve(__dirname, '../miniprogram/utils');

// 1. engine-3d-mat4.js
const mat4Content = `/**
 * 4x4 Matrix Mathematics for 3D Camera & WebGL
 */
${slice(35, 110)}

module.exports = { Mat4 };
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-mat4.js'), mat4Content);

// 2. engine-3d-mesh-builder.js
const meshBuilderContent = `/**
 * 3D Mesh Builder for Dynamic Geometry Generation
 */
${slice(152, 335)}

module.exports = { MeshBuilder };
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-mesh-builder.js'), meshBuilderContent);

// 3. engine-3d-angle.js
const angleContent = `/**
 * 3D Stadium Angular Discretization Mixin
 */
const { getInfieldCornerTransitionAngles, evalTierPoint } = require('./schema-geometry');

${makeMixin('AngleMixin', slice(955, 1024))}
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-angle.js'), angleContent);

// 4. engine-3d-canopy.js
const canopyContent = `/**
 * 3D Stadium Canopy Rim Builder Mixin
 */
const {
  DEG2RAD,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat
} = require('./schema-geometry');

${makeMixin('CanopyMixin', slice(2553, 2649))}
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-canopy.js'), canopyContent);

// 5. engine-3d-stage.js
const stageContent = `/**
 * Concert Stage, Screen & Truss Mesh Builder Mixin
 */
const { DEG2RAD, rotateXZ, getStageTransform } = require('./schema-geometry');

${makeMixin('StageMixin', slice(2651, 2934))}
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-stage.js'), stageContent);

// 6. engine-3d-infield.js
const infieldContent = `/**
 * Stadium Pitch, Track & Infield Seats Mesh Builder Mixin
 */
const {
  DEG2RAD,
  rotateXZ,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat,
  getRayRoundedRectDistance,
  computeRunningTrackSpec,
  generateConcertInfieldBlocks
} = require('./schema-geometry');
const { hexToSeat3D } = require('./seat-colors');

${makeMixin('InfieldMixin', `
${slice(892, 953)}

${slice(1026, 1300)}

${slice(2936, 2960)}
`)}
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-infield.js'), infieldContent);

// 7. engine-3d-stand.js
const standContent = `/**
 * Stand Tiers, VIP Suites & Vomitory Recess Mesh Builder Mixin
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
  computeVomitoryAngularBounds
} = require('./schema-geometry');
const { hexToSeat3D } = require('./seat-colors');

${makeMixin('StandMixin', `
${slice(1302, 2126)}

${slice(2134, 2551)}
`)}
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-stand.js'), standContent);

// 8. engine-3d-raycaster.js
const raycastContent = `/**
 * 3D Raycasting & Tier/Infield Screen Picking Mixin
 */
const {
  DEG2RAD,
  RAD2DEG,
  rotateXZ,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngle,
  generateConcertInfieldBlocks
} = require('./schema-geometry');

${makeMixin('RaycastMixin', slice(540, 838))}
`;
fs.writeFileSync(path.join(utilsDir, 'engine-3d-raycaster.js'), raycastContent);

console.log('All mixins extracted successfully!');
