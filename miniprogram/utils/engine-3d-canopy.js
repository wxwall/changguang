/**
 * 3D Stadium Canopy Rim Builder Mixin
 */
const {
  DEG2RAD,
  evalInfieldPerimeterAndNormal,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat
} = require('./schema-geometry');
const { parseHexRgb } = require('./seat-colors');

class CanopyMixinHolder {
  buildStadiumCanopyRim(solid, alpha, screens) {
    const roof = this.venue && this.venue.roof;
    if (roof && roof.enabled === false) return;

    const summary = this.venue.engineeringSummary || {};
    const maxElev = (summary.maxBowlElevationM || 30) + 3.5;
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const lastTier = tiers[lastTierIdx];
    const isMorphedLast = isConcentricMorphTier(lastTier);

    const parseFiniteNum = (v) => {
      if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };

    // Parse roof deletion schema: segmentCount + deletedSegments + openAngleRanges
    const rawSegCount = parseFiniteNum(roof && roof.segmentCount);
    const segmentCount = (Number.isFinite(rawSegCount) && rawSegCount > 0)
      ? Math.max(1, Math.round(rawSegCount))
      : 32;
    const deletedSegmentSet = new Set();
    if (roof && Array.isArray(roof.deletedSegments)) {
      roof.deletedSegments.forEach((rawIdx) => {
        const idx = parseFiniteNum(rawIdx);
        if (Number.isFinite(idx)) {
          const normIdx = ((Math.round(idx) % segmentCount) + segmentCount) % segmentCount;
          deletedSegmentSet.add(normIdx);
        }
      });
    }

    const openRanges = [];
    if (roof && Array.isArray(roof.openAngleRanges)) {
      roof.openAngleRanges.forEach((entry) => {
        let s = NaN;
        let e = NaN;
        if (Array.isArray(entry) && entry.length >= 2) {
          s = parseFiniteNum(entry[0]);
          e = parseFiniteNum(entry[1]);
        } else if (entry && typeof entry === 'object') {
          s = parseFiniteNum(entry.startDeg !== undefined ? entry.startDeg : (entry.start !== undefined ? entry.start : entry.from));
          e = parseFiniteNum(entry.endDeg !== undefined ? entry.endDeg : (entry.end !== undefined ? entry.end : entry.to));
        }
        if (!Number.isFinite(s) || !Number.isFinite(e)) return;
        const span = e - s;
        if (Math.abs(span) < 1e-4) return;
        if (Math.abs(span) >= 360 - 1e-4) {
          openRanges.push([0, 360]);
          return;
        }
        const ns = ((s % 360) + 360) % 360;
        const ne = ((e % 360) + 360) % 360;
        if (ns < ne) {
          openRanges.push([ns, ne]);
        } else {
          openRanges.push([ns, 360]);
          openRanges.push([0, ne]);
        }
      });
    }

    const isAngleDeleted = (deg) => {
      const d = ((deg % 360) + 360) % 360;
      if (deletedSegmentSet.size > 0) {
        const segIdx = Math.floor((d / 360) * segmentCount) % segmentCount;
        if (deletedSegmentSet.has(segIdx)) return true;
      }
      for (let r = 0; r < openRanges.length; r++) {
        if (d >= openRanges[r][0] && d < openRanges[r][1]) return true;
      }
      return false;
    };

    const baseRingAngles = this.buildFullRingAngles(180);
    const extraCutAngles = [];
    deletedSegmentSet.forEach((segIdx) => {
      extraCutAngles.push((segIdx / segmentCount) * 360);
      extraCutAngles.push(((segIdx + 1) / segmentCount) * 360);
    });
    openRanges.forEach(([s, e]) => {
      extraCutAngles.push(s, e);
    });
    let ringAngles = baseRingAngles;
    if (extraCutAngles.length > 0) {
      const merged = baseRingAngles.concat(extraCutAngles)
        .filter(a => Number.isFinite(a) && a >= 0 && a <= 360)
        .sort((a, b) => a - b);
      ringAngles = [];
      merged.forEach((a) => {
        if (ringAngles.length === 0 || a - ringAngles[ringAngles.length - 1] > 1e-4) {
          ringAngles.push(a);
        }
      });
      if (ringAngles[ringAngles.length - 1] < 359.9999) ringAngles.push(360);
    }

    const overrides = this.tierColorOverrides || {};
    const roofHex = overrides.roof || (roof && roof.color) || '#1E293B';
    const roofRgb = parseHexRgb(roofHex) || { r: 30, g: 41, b: 59 };
    const rr = roofRgb.r / 255;
    const rg = roofRgb.g / 255;
    const rb = roofRgb.b / 255;

    const isTranslucent = Boolean(roof && roof.translucent && alpha);
    const roofOpacity = (roof && roof.opacity !== undefined)
      ? Math.max(0.15, Math.min(1.0, Number(roof.opacity)))
      : 1.0;
    const memAlpha = isTranslucent ? roofOpacity : 1.0;
    const memBuilder = isTranslucent ? alpha : solid;

    const topCol = [rr, rg, rb, memAlpha];
    const soffitCol = [rr * 0.72, rg * 0.72, rb * 0.72, memAlpha];
    const fasciaCol = [Math.min(1.0, rr * 1.25), Math.min(1.0, rg * 1.25), Math.min(1.0, rb * 1.25), 1.0];

    const floodRgb = parseHexRgb((roof && roof.floodlightColor) || '#ffffff') || { r: 255, g: 255, b: 255 };
    const lightStripCol = [
      Math.max(0.5, floodRgb.r / 255),
      Math.max(0.5, floodRgb.g / 255),
      Math.max(0.5, floodRgb.b / 255),
      1.0
    ];

    const clearance = (roof && roof.clearanceHeightM !== undefined) ? Number(roof.clearanceHeightM) : 3.5;
    const thickness = (roof && roof.trussDepthM !== undefined)
      ? Math.max(0.4, Number(roof.trussDepthM))
      : 1.6;
    const outerOverhang = (roof && roof.outerOverhangM !== undefined) ? Number(roof.outerOverhangM) : 5;
    const hasCoveragePct = Boolean(roof && roof.innerCoveragePct !== undefined);
    const innerCoveragePct = hasCoveragePct ? Math.max(5, Math.min(100, Number(roof.innerCoveragePct))) : null;
    const slopeAngleDeg = (roof && roof.slopeAngleDeg !== undefined) ? Number(roof.slopeAngleDeg) : 3;
    const slopeTan = Math.tan(slopeAngleDeg * DEG2RAD);

    const trussRibCount = (roof && roof.trussRibCount) ? Math.max(4, Math.round(Number(roof.trussRibCount))) : 32;
    const trussRgb = parseHexRgb((roof && roof.trussColor) || '#94a3b8') || { r: 148, g: 163, b: 184 };
    const trussCol = [trussRgb.r / 255, trussRgb.g / 255, trussRgb.b / 255, 1.0];
    const supportColumns = Boolean(roof && roof.supportColumns);
    const showFloodlights = roof ? (roof.showFloodlights !== false) : true;
    const showSuspendedRingScreen = Boolean(roof && roof.showSuspendedRingScreen);

    const infield = this.venue.infield || { length: 105, width: 68, cornerRadius: 15, shape: 'rounded-rect' };
    const infLen = infield.length || 105;
    const infWid = infield.width || 68;
    const infRad = infield.cornerRadius || 15;
    const infShape = infield.shape || 'rounded-rect';

    const lastRows = lastTier.defaultRows || 22;
    const lastPitch = lastTier.defaultRowPitch || 0.85;
    const lastSlope = lastTier.defaultSlopeDeg || 24;
    const lastRiserH = lastTier.defaultRiserHeight || (lastPitch * Math.tan(lastSlope * DEG2RAD));
    const flatTopBowl = (lastTier.baseElevation || 14) + Math.max(0, lastRows - 1) * lastRiserH;

    const evalRoofCrossSection = (deg) => {
      const pt = evalTierPoint(this.venue, lastTierIdx, deg, 1);
      const rLen = Math.hypot(pt.outX, pt.outZ) || 1;
      const nx = isMorphedLast ? (pt.outX / rLen) : pt.nx;
      const nz = isMorphedLast ? (pt.outZ / rLen) : pt.nz;

      let xIn;
      let zIn;
      if (hasCoveragePct) {
        const infPt = evalInfieldPerimeterAndNormal(deg, infLen, infWid, infRad, infShape);
        const pct = innerCoveragePct / 100;
        xIn = pt.outX + (infPt.x - pt.outX) * pct;
        zIn = pt.outZ + (infPt.z - pt.outZ) * pct;
      } else if (isMorphedLast) {
        // Irregular/morphed stands (e.g. Bird's Nest) close directly with the infield's shape & size
        const infPt = evalInfieldPerimeterAndNormal(deg, infLen, infWid, infRad, infShape);
        xIn = infPt.x;
        zIn = infPt.z;
      } else {
        xIn = pt.outX - nx * 14;
        zIn = pt.outZ - nz * 14;
      }

      const inReach = Math.hypot(pt.outX - xIn, pt.outZ - zIn);
      const xOut = pt.outX + nx * outerOverhang;
      const zOut = pt.outZ + nz * outerOverhang;
      const rise = hasCoveragePct ? (inReach + outerOverhang) * slopeTan : 0.8;

      let yBot;
      if (isMorphedLast) {
        const rFloat = getTierRowsAtAngleFloat(this.venue, lastTierIdx, lastTier, null, deg);
        yBot = (lastTier.baseElevation || 14) + Math.max(0, rFloat - 1) * lastRiserH + clearance;
      } else {
        yBot = roof ? (flatTopBowl + clearance) : Math.max(maxElev, flatTopBowl + 3.5);
      }

      return {
        pt, nx, nz, xIn, zIn, xOut, zOut, yBot, yTop: yBot + thickness, rise
      };
    };

    let innerSoffitSum = 0;
    let innerSoffitCount = 0;
    let minInnerR = Infinity;

    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];
      if (deg2 - deg1 < 1e-5) continue;
      if (isAngleDeleted((deg1 + deg2) * 0.5)) {
        continue;
      }

      const c1 = evalRoofCrossSection(deg1);
      const c2 = evalRoofCrossSection(deg2);
      innerSoffitSum += (c1.yBot + c1.rise);
      innerSoffitCount++;
      const rIn1 = Math.hypot(c1.xIn, c1.zIn);
      if (rIn1 < minInnerR) minInnerR = rIn1;

      // Top canopy surface
      memBuilder.addQuad(
        { x: c1.xIn, y: c1.yTop + c1.rise, z: c1.zIn },
        { x: c1.xOut, y: c1.yTop, z: c1.zOut },
        { x: c2.xOut, y: c2.yTop, z: c2.zOut },
        { x: c2.xIn, y: c2.yTop + c2.rise, z: c2.zIn },
        topCol,
        { x: 0, y: 1, z: 0 }
      );

      // Bottom soffit surface
      memBuilder.addQuad(
        { x: c1.xOut, y: c1.yBot, z: c1.zOut },
        { x: c1.xIn, y: c1.yBot + c1.rise, z: c1.zIn },
        { x: c2.xIn, y: c2.yBot + c2.rise, z: c2.zIn },
        { x: c2.xOut, y: c2.yBot, z: c2.zOut },
        soffitCol,
        { x: 0, y: -1, z: 0 }
      );

      // Inner tension-ring fascia
      solid.addQuad(
        { x: c1.xIn, y: c1.yBot + c1.rise, z: c1.zIn },
        { x: c1.xIn, y: c1.yTop + c1.rise, z: c1.zIn },
        { x: c2.xIn, y: c2.yTop + c2.rise, z: c2.zIn },
        { x: c2.xIn, y: c2.yBot + c2.rise, z: c2.zIn },
        fasciaCol
      );

      // Outer eaves fascia
      solid.addQuad(
        { x: c1.xOut, y: c1.yBot, z: c1.zOut },
        { x: c2.xOut, y: c2.yBot, z: c2.zOut },
        { x: c2.xOut, y: c2.yTop, z: c2.zOut },
        { x: c1.xOut, y: c1.yTop, z: c1.zOut },
        fasciaCol
      );

      // Radial end-cap at start of kept wing if previous angle is deleted
      if (isAngleDeleted(deg1 - 5e-5)) {
        solid.addQuad(
          { x: c1.xOut, y: c1.yBot, z: c1.zOut },
          { x: c1.xIn, y: c1.yBot + c1.rise, z: c1.zIn },
          { x: c1.xIn, y: c1.yTop + c1.rise, z: c1.zIn },
          { x: c1.xOut, y: c1.yTop, z: c1.zOut },
          fasciaCol
        );
      }

      // Radial end-cap at end of kept wing if next angle is deleted
      if (isAngleDeleted(deg2 + 5e-5)) {
        solid.addQuad(
          { x: c2.xIn, y: c2.yBot + c2.rise, z: c2.zIn },
          { x: c2.xOut, y: c2.yBot, z: c2.zOut },
          { x: c2.xOut, y: c2.yTop, z: c2.zOut },
          { x: c2.xIn, y: c2.yTop + c2.rise, z: c2.zIn },
          fasciaCol
        );
      }

      if (showFloodlights && i % 4 === 0) {
        const mx = (c1.xIn + c2.xIn) / 2;
        const mz = (c1.zIn + c2.zIn) / 2;
        const my = (c1.yBot + c1.rise + c2.yBot + c2.rise) / 2 - 0.35;
        const rotL = Math.atan2(-(c2.zIn - c1.zIn), c2.xIn - c1.xIn);
        const isOff = this.isLightsOffScene && this.isLightsOffScene();
        const target = (!isOff && screens) ? screens : solid;
        const col = isOff ? [0.06, 0.07, 0.09, 1.0] : lightStripCol;
        target.addBox(mx, my, mz, 2.4, 0.65, 0.75, col, rotL);
      }
    }

    // Center-hung suspended ring giant screen (sized to infield & hung below inner soffit)
    if (showSuspendedRingScreen && innerSoffitCount > 0) {
      const isOff = this.isLightsOffScene && this.isLightsOffScene();
      const screenTarget = (!isOff && screens) ? screens : solid;
      const avgInnerSoffitY = innerSoffitSum / innerSoffitCount;
      const rawRingR = Math.max(4.5, Math.min(14.0, Math.min(infLen, infWid) * 0.16));
      const maxSafeR = Number.isFinite(minInnerR) ? Math.max(2.5, minInnerR * 0.65) : rawRingR;
      const ringR = Math.min(rawRingR, maxSafeR);
      const ringInnerR = Math.max(1.5, ringR - 0.45);
      const ringH = Math.max(2.2, Math.min(5.5, ringR * 0.52));
      const ringTopY = Math.max(ringH + 6.0, avgInnerSoffitY - 1.5);
      const ringBotY = ringTopY - ringH;
      const frameCol = [0.08, 0.10, 0.15, 1.0];
      const screenCol = isOff ? [0.03, 0.04, 0.06, 1.0] : [0.12, 0.55, 0.95, 1.0];
      const segs = 32;

      for (let s = 0; s < segs; s++) {
        const a1 = (s / segs) * Math.PI * 2;
        const a2 = ((s + 1) / segs) * Math.PI * 2;
        const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
        const cos2 = Math.cos(a2), sin2 = Math.sin(a2);

        const ox1 = cos1 * ringR, oz1 = sin1 * ringR;
        const ox2 = cos2 * ringR, oz2 = sin2 * ringR;
        const ix1 = cos1 * ringInnerR, iz1 = sin1 * ringInnerR;
        const ix2 = cos2 * ringInnerR, iz2 = sin2 * ringInnerR;

        // Outer self-luminous ring screen face
        screenTarget.addQuad(
          { x: ox1, y: ringBotY, z: oz1 },
          { x: ox1, y: ringTopY, z: oz1 },
          { x: ox2, y: ringTopY, z: oz2 },
          { x: ox2, y: ringBotY, z: oz2 },
          screenCol
        );
        // Inner dark structural backing
        solid.addQuad(
          { x: ix2, y: ringBotY, z: iz2 },
          { x: ix2, y: ringTopY, z: iz2 },
          { x: ix1, y: ringTopY, z: iz1 },
          { x: ix1, y: ringBotY, z: iz1 },
          frameCol
        );
        // Top & bottom dark trim caps
        solid.addQuad(
          { x: ix1, y: ringTopY, z: iz1 },
          { x: ox1, y: ringTopY, z: oz1 },
          { x: ox2, y: ringTopY, z: oz2 },
          { x: ix2, y: ringTopY, z: iz2 },
          frameCol,
          { x: 0, y: 1, z: 0 }
        );
        solid.addQuad(
          { x: ox1, y: ringBotY, z: oz1 },
          { x: ix1, y: ringBotY, z: iz1 },
          { x: ix2, y: ringBotY, z: iz2 },
          { x: ox2, y: ringBotY, z: oz2 },
          frameCol,
          { x: 0, y: -1, z: 0 }
        );
      }
    }

    // Perimeter support columns
    if (supportColumns) {
      for (let k = 0; k < trussRibCount; k++) {
        const deg = (k / trussRibCount) * 360;
        if (isAngleDeleted(deg - 5e-5) && isAngleDeleted(deg + 5e-5)) continue;
        const c = evalRoofCrossSection(deg);

        const colX = c.pt.outX + c.nx * Math.max(0.8, Math.min(outerOverhang * 0.6, 2.2));
        const colZ = c.pt.outZ + c.nz * Math.max(0.8, Math.min(outerOverhang * 0.6, 2.2));
        const colTopY = c.yBot + 0.15;
        const colBotY = -0.60;
        const colH = Math.max(1, colTopY - colBotY);
        solid.addBox(colX, colBotY + colH * 0.5, colZ, 0.75, colH, 0.75, trussCol, 0);
      }
    }
  }
}
const CanopyMixin = {};
Object.getOwnPropertyNames(CanopyMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') CanopyMixin[k] = CanopyMixinHolder.prototype[k];
});
module.exports = { CanopyMixin };

