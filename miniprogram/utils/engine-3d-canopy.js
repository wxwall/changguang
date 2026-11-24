/**
 * 3D Stadium Canopy Rim Builder Mixin
 */
const {
  DEG2RAD,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat
} = require('./schema-geometry');
const { parseHexRgb } = require('./seat-colors');

class CanopyMixinHolder {
  buildStadiumCanopyRim(solid) {
    const summary = this.venue.engineeringSummary || {};
    const maxElev = (summary.maxBowlElevationM || 30) + 3.5;
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const lastTier = tiers[lastTierIdx];
    const isMorphedLast = isConcentricMorphTier(lastTier);
    const isBirdNest = this.venue.code === 'BJ-NST-2008-01' ||
      String(this.venue.id || '').indexOf('bird-nest') >= 0;
    const ringAngles = this.buildFullRingAngles(180);

    const overrides = this.tierColorOverrides || {};
    const roofRgb = parseHexRgb(overrides.roof || '#1E293B') || { r: 30, g: 41, b: 59 };
    const rr = roofRgb.r / 255;
    const rg = roofRgb.g / 255;
    const rb = roofRgb.b / 255;
    const topCol = [rr, rg, rb, 1.0];
    const soffitCol = [rr * 0.72, rg * 0.72, rb * 0.72, 1.0];
    const fasciaCol = [Math.min(1.0, rr * 1.25), Math.min(1.0, rg * 1.25), Math.min(1.0, rb * 1.25), 1.0];
    const lightStripCol = [0.85, 0.92, 1.0, 1.0];
    const thickness = 1.6; // Real 3D thickness prevents ANY Z-fighting!

    const lastRows = lastTier.defaultRows || 22;
    const lastPitch = lastTier.defaultRowPitch || 0.85;
    const lastSlope = lastTier.defaultSlopeDeg || 24;
    const lastRiserH = lastTier.defaultRiserHeight || (lastPitch * Math.tan(lastSlope * DEG2RAD));
    const flatTopBowl = (lastTier.baseElevation || 14) + Math.max(0, lastRows - 1) * lastRiserH;

    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];
      if (isBirdNest && (deg1 < 12 || deg1 > 348)) {
        continue;
      }

      const pt1 = evalTierPoint(this.venue, lastTierIdx, deg1, 1);
      const pt2 = evalTierPoint(this.venue, lastTierIdx, deg2, 1);

      const rLen1 = Math.hypot(pt1.outX, pt1.outZ) || 1;
      const rLen2 = Math.hypot(pt2.outX, pt2.outZ) || 1;
      const nx1 = isMorphedLast ? (pt1.outX / rLen1) : pt1.nx;
      const nz1 = isMorphedLast ? (pt1.outZ / rLen1) : pt1.nz;
      const nx2 = isMorphedLast ? (pt2.outX / rLen2) : pt2.nx;
      const nz2 = isMorphedLast ? (pt2.outZ / rLen2) : pt2.nz;

      const xIn1 = pt1.outX - nx1 * 14, zIn1 = pt1.outZ - nz1 * 14;
      const xOut1 = pt1.outX + nx1 * 5, zOut1 = pt1.outZ + nz1 * 5;
      const xIn2 = pt2.outX - nx2 * 14, zIn2 = pt2.outZ - nz2 * 14;
      const xOut2 = pt2.outX + nx2 * 5, zOut2 = pt2.outZ + nz2 * 5;

      let yBot1;
      let yBot2;
      if (isMorphedLast) {
        const r1 = getTierRowsAtAngleFloat(this.venue, lastTierIdx, lastTier, null, deg1);
        const r2 = getTierRowsAtAngleFloat(this.venue, lastTierIdx, lastTier, null, deg2);
        yBot1 = (lastTier.baseElevation || 14) + Math.max(0, r1 - 1) * lastRiserH + 3.6;
        yBot2 = (lastTier.baseElevation || 14) + Math.max(0, r2 - 1) * lastRiserH + 3.6;
      } else {
        yBot1 = Math.max(maxElev, flatTopBowl + 3.5);
        yBot2 = yBot1;
      }
      const yTop1 = yBot1 + thickness;
      const yTop2 = yBot2 + thickness;

      // Top canopy surface
      solid.addQuad(
        { x: xIn1, y: yTop1 + 0.8, z: zIn1 },
        { x: xOut1, y: yTop1, z: zOut1 },
        { x: xOut2, y: yTop2, z: zOut2 },
        { x: xIn2, y: yTop2 + 0.8, z: zIn2 },
        topCol,
        { x: 0, y: 1, z: 0 }
      );

      // Bottom soffit surface (separated by 1.6m!)
      solid.addQuad(
        { x: xOut1, y: yBot1, z: zOut1 },
        { x: xIn1, y: yBot1 + 0.8, z: zIn1 },
        { x: xIn2, y: yBot2 + 0.8, z: zIn2 },
        { x: xOut2, y: yBot2, z: zOut2 },
        soffitCol,
        { x: 0, y: -1, z: 0 }
      );

      // Inner tension-ring fascia + steady stadium floodlight blocks (every 4th segment)
      solid.addQuad(
        { x: xIn1, y: yBot1 + 0.8, z: zIn1 },
        { x: xIn1, y: yTop1 + 0.8, z: zIn1 },
        { x: xIn2, y: yTop2 + 0.8, z: zIn2 },
        { x: xIn2, y: yBot2 + 0.8, z: zIn2 },
        fasciaCol
      );

      if (i % 4 === 0) {
        const mx = (xIn1 + xIn2) / 2;
        const mz = (zIn1 + zIn2) / 2;
        const rotL = Math.atan2(-(zIn2 - zIn1), xIn2 - xIn1);
        solid.addBox(mx, (yBot1 + yBot2) / 2 + 0.5, mz, 2.4, 0.7, 0.8, lightStripCol, rotL);
      }
    }
  }
}
const CanopyMixin = {};
Object.getOwnPropertyNames(CanopyMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') CanopyMixin[k] = CanopyMixinHolder.prototype[k];
});
module.exports = { CanopyMixin };

