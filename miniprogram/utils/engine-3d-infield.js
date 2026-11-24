/**
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
const { hexToSeat3D, parseHexRgb } = require('./seat-colors');

class InfieldMixinHolder {

  buildGroundAndShell(solid) {
    const overrides = this.tierColorOverrides || {};
    // Large architectural plaza apron at y = -0.60 so camera never sees an empty void
    const plazaR = 360;
    const groundRgb = parseHexRgb(overrides.ground || '#0F172A') || { r: 15, g: 23, b: 42 };
    const plazaCol = [groundRgb.r / 255, groundRgb.g / 255, groundRgb.b / 255, 1.0];
    solid.addQuad(
      { x: -plazaR, y: -0.60, z: -plazaR },
      { x: -plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: -plazaR },
      plazaCol,
      { x: 0, y: 1, z: 0 }
    );

    // Solid exterior facade shell connecting outer tier down to ground plaza
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const lastTier = tiers[lastTierIdx];
    const lastSlope = lastTier.defaultSlopeDeg || 24;
    const lastRows = lastTier.defaultRows || 22;
    const lastPitch = lastTier.defaultRowPitch || 0.85;
    const isMorphedLast = isConcentricMorphTier(lastTier);

    const ringAngles = this.buildFullRingAngles(180);
    const wallRgb = parseHexRgb(overrides.wall || '#CBD5E1') || { r: 203, g: 213, b: 225 };
    const shellCol = [wallRgb.r / 255, wallRgb.g / 255, wallRgb.b / 255, 1.0];

    const lastRiserH = lastTier.defaultRiserHeight || (lastPitch * Math.tan(lastSlope * DEG2RAD));
    const flatTopWallY = (lastTier.baseElevation || 14) + Math.max(0, lastRows - 1) * lastRiserH + 1.2;

    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];

      const pt1 = evalTierPoint(this.venue, lastTierIdx, deg1, 1);
      const pt2 = evalTierPoint(this.venue, lastTierIdx, deg2, 1);

      let topWallY1 = flatTopWallY;
      let topWallY2 = flatTopWallY;
      if (isMorphedLast) {
        const r1 = getTierRowsAtAngleFloat(this.venue, lastTierIdx, lastTier, null, deg1);
        const r2 = getTierRowsAtAngleFloat(this.venue, lastTierIdx, lastTier, null, deg2);
        topWallY1 = (lastTier.baseElevation || 14) + Math.max(0, r1 - 1) * lastRiserH + 1.2;
        topWallY2 = (lastTier.baseElevation || 14) + Math.max(0, r2 - 1) * lastRiserH + 1.2;
      }

      const pad = 1.5;
      const rLen1 = Math.hypot(pt1.x, pt1.z) || 1;
      const rLen2 = Math.hypot(pt2.x, pt2.z) || 1;
      const x1 = pt1.x + (isMorphedLast ? (pt1.x / rLen1) * pad : pt1.nx * pad);
      const z1 = pt1.z + (isMorphedLast ? (pt1.z / rLen1) * pad : pt1.nz * pad);
      const x2 = pt2.x + (isMorphedLast ? (pt2.x / rLen2) * pad : pt2.nx * pad);
      const z2 = pt2.z + (isMorphedLast ? (pt2.z / rLen2) * pad : pt2.nz * pad);

      const p1_b = { x: x1, y: -0.60, z: z1 };
      const p2_b = { x: x2, y: -0.60, z: z2 };
      const p2_t = { x: x2, y: topWallY2, z: z2 };
      const p1_t = { x: x1, y: topWallY1, z: z1 };

      solid.addQuad(p1_b, p1_t, p2_t, p2_b, shellCol);
    }
  }

  buildInfieldMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;

    const ringAngles = this.buildFullRingAngles(144);
    const isTrack = infield.sportPreset === 'track-field' || infield.surfaceType === 'synthetic-track';
    let baseColor = [0.05, 0.25, 0.19, 1.0];
    if (infield.surfaceType === 'hardwood-court') {
      baseColor = [0.12, 0.16, 0.24, 1.0];
    } else if (isTrack) {
      baseColor = [0.05, 0.27, 0.20, 1.0];
    }

    // Outer infield base surface at y = 0.00 (cleanly separated from plaza at -0.60)
    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];
      const r1 = getRayRoundedRectDistance(deg1, infield.length, infield.width, infield.cornerRadius, infield.shape);
      const r2 = getRayRoundedRectDistance(deg2, infield.length, infield.width, infield.cornerRadius, infield.shape);

      const p1 = { x: Math.sin(deg1 * DEG2RAD) * r1, y: 0.0, z: -Math.cos(deg1 * DEG2RAD) * r1 };
      const p2 = { x: Math.sin(deg2 * DEG2RAD) * r2, y: 0.0, z: -Math.cos(deg2 * DEG2RAD) * r2 };
      solid.addTriangle({ x: 0, y: 0.0, z: 0 }, p1, p2, baseColor, { x: 0, y: 1, z: 0 });
    }

    // Strict parameter-computed running track belt + green inner apron + lane markings
    if (isTrack) {
      const spec = computeRunningTrackSpec(infield);
      const trackBrickCol = [0.58, 0.19, 0.10, 1.0];
      const innerApronCol = [0.04, 0.34, 0.23, 1.0];
      const laneCol = [0.92, 0.94, 0.98, 1.0];

      for (let i = 0; i < ringAngles.length - 1; i++) {
        const deg1 = ringAngles[i];
        const deg2 = ringAngles[i + 1];
        const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
        const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);

        const rOut1 = getRayRoundedRectDistance(deg1, spec.outerTrackLength, spec.outerTrackWidth, spec.outerTrackCornerRadius);
        const rOut2 = getRayRoundedRectDistance(deg2, spec.outerTrackLength, spec.outerTrackWidth, spec.outerTrackCornerRadius);
        const rIn1 = getRayRoundedRectDistance(deg1, spec.innerApronLength, spec.innerApronWidth, spec.innerApronCornerRadius);
        const rIn2 = getRayRoundedRectDistance(deg2, spec.innerApronLength, spec.innerApronWidth, spec.innerApronCornerRadius);

        // Track surface ring quad at y = 0.018
        solid.addQuad(
          { x: sin1 * rIn1, y: 0.018, z: cos1 * rIn1 },
          { x: sin1 * rOut1, y: 0.018, z: cos1 * rOut1 },
          { x: sin2 * rOut2, y: 0.018, z: cos2 * rOut2 },
          { x: sin2 * rIn2, y: 0.018, z: cos2 * rIn2 },
          trackBrickCol,
          { x: 0, y: 1, z: 0 }
        );

        // Inner green D-zone & apron surface at y = 0.036
        solid.addTriangle(
          { x: 0, y: 0.036, z: 0 },
          { x: sin1 * rIn1, y: 0.036, z: cos1 * rIn1 },
          { x: sin2 * rIn2, y: 0.036, z: cos2 * rIn2 },
          innerApronCol,
          { x: 0, y: 1, z: 0 }
        );
      }

      // Exact schema-computed lane lines (lanes + 1 boundaries spaced by laneWidth)
      for (let lane = 0; lane <= spec.lanes; lane++) {
        const shrink = lane * spec.laneWidth;
        const lenL = spec.outerTrackLength - shrink * 2;
        const widL = spec.outerTrackWidth - shrink * 2;
        const radL = Math.max(2, spec.outerTrackCornerRadius - shrink);
        const halfLineW = (lane === 0 || lane === spec.lanes) ? 0.10 : 0.07;

        for (let i = 0; i < ringAngles.length - 1; i++) {
          const deg1 = ringAngles[i];
          const deg2 = ringAngles[i + 1];
          const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
          const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);
          const r1 = getRayRoundedRectDistance(deg1, lenL, widL, radL);
          const r2 = getRayRoundedRectDistance(deg2, lenL, widL, radL);
          solid.addQuad(
            { x: sin1 * (r1 - halfLineW), y: 0.055, z: cos1 * (r1 - halfLineW) },
            { x: sin1 * (r1 + halfLineW), y: 0.055, z: cos1 * (r1 + halfLineW) },
            { x: sin2 * (r2 + halfLineW), y: 0.055, z: cos2 * (r2 + halfLineW) },
            { x: sin2 * (r2 - halfLineW), y: 0.055, z: cos2 * (r2 - halfLineW) },
            laneCol,
            { x: 0, y: 1, z: 0 }
          );
        }
      }
    }

    const pw = infield.pitchWidth || 68;
    const pl = infield.pitchLength || 105;
    const hw = pw / 2;
    const hl = pl / 2;
    const pitchOri = infield.pitchOrientationDeg || 0;
    const addPitchQuad = (lx1, lz1, lx2, lz2, lx3, lz3, lx4, lz4, y, col) => {
      const p1 = rotateXZ(lx1, lz1, pitchOri);
      const p2 = rotateXZ(lx2, lz2, pitchOri);
      const p3 = rotateXZ(lx3, lz3, pitchOri);
      const p4 = rotateXZ(lx4, lz4, pitchOri);
      solid.addQuad(
        { x: p1.x, y, z: p1.z },
        { x: p2.x, y, z: p2.z },
        { x: p3.x, y, z: p3.z },
        { x: p4.x, y, z: p4.z },
        col,
        { x: 0, y: 1, z: 0 }
      );
    };

    if (infield.surfaceType === 'hardwood-court') {
      // Hardwood basketball court at y = 0.08
      addPitchQuad(-hw, -hl, -hw, hl, hw, hl, hw, -hl, 0.08, [0.78, 0.46, 0.17, 1.0]);
      // Key paint at y = 0.12
      addPitchQuad(-2.45, -hl, -2.45, -hl + 5.8, 2.45, -hl + 5.8, 2.45, -hl, 0.12, [0.14, 0.38, 0.84, 1.0]);
      addPitchQuad(-2.45, hl - 5.8, -2.45, hl, 2.45, hl, 2.45, hl - 5.8, 0.12, [0.14, 0.38, 0.84, 1.0]);
    } else {
      // Mowed grass stripes at y = 0.08
      const stripes = 12;
      const stripeLen = pl / stripes;
      for (let i = 0; i < stripes; i++) {
        const z1 = -hl + i * stripeLen;
        const z2 = z1 + stripeLen;
        const col = i % 2 === 0 ? [0.05, 0.45, 0.31, 1.0] : [0.07, 0.53, 0.36, 1.0];
        addPitchQuad(-hw, z1, -hw, z2, hw, z2, hw, z1, 0.08, col);
      }

      // Crisp white pitch lines at y = 0.14
      const lw = 0.35;
      const lineCol = [0.92, 0.96, 1.0, 1.0];
      addPitchQuad(-hw, -lw / 2, -hw, lw / 2, hw, lw / 2, hw, -lw / 2, 0.14, lineCol);
      addPitchQuad(-hw, -hl, -hw, -hl + lw, hw, -hl + lw, hw, -hl, 0.14, lineCol);
      addPitchQuad(-hw, hl - lw, -hw, hl, hw, hl, hw, hl - lw, 0.14, lineCol);
      addPitchQuad(-hw, -hl, -hw + lw, -hl, -hw + lw, hl, -hw, hl, 0.14, lineCol);
      addPitchQuad(hw - lw, -hl, hw, -hl, hw, hl, hw - lw, hl, 0.14, lineCol);
    }
  }

  buildInfieldModulesMesh(solid) {
    // Only render permanent non-stage sideline modules in Sports mode (concert stage modules render via buildConcertInfieldSeatsMesh)
    const modules = (this.venue.infieldModules || []).filter(m => !m.autoGeneratedForStage);
    modules.forEach((mod) => {
      const seatPanCol = [0.10, 0.78, 0.56, 1.0];
      const seatBackCol = [0.04, 0.52, 0.36, 1.0];
      const railCol = [0.84, 0.88, 0.94, 1.0];

      const rotDeg = Number(mod.rotationDeg) || 0;
      const rotYRad = -rotDeg * DEG2RAD;
      const cx = Number(mod.x) || 0;
      const cz = Number(mod.y) || 0;
      const w = Number(mod.width) || 24;
      const d = Number(mod.depth) || 5;
      const baseElev = Number(mod.baseElevation) || 0;

      // Platform deck
      solid.addBox(cx, baseElev + 0.15, cz, w, 0.3, d, [0.20, 0.25, 0.34, 1.0], rotYRad);

      // Populate rows of 3D seats inside the module facing inward toward pitch center (0, 0)
      const rows = Math.max(1, Number(mod.rows) || 4);
      const seatSpacing = Math.max(0.4, Number(mod.seatSpacing) || 0.6);
      const aisleW = Number(mod.aisleWidth) || 1.4;
      const usableW = Math.max(2, w - aisleW);
      const stride = (usableW / seatSpacing) * rows > 450 ? 2 : 1;
      const seatsPerRow = Math.max(2, Math.floor(usableW / (seatSpacing * stride)));

      const uZ = rotateXZ(0, 1, rotDeg);
      const dotCenter = (-cx) * uZ.x + (-cz) * uZ.z;
      const localFacingZ = dotCenter >= 0 ? 1 : -1;
      const fx = uZ.x * localFacingZ;
      const fz = uZ.z * localFacingZ;
      const dirSign = localFacingZ === 1 ? -1 : 1;

      for (let r = 0; r < rows; r++) {
        const localZ = dirSign * (-d / 2 + (r + 0.5) * (d / rows));
        const rowY = baseElev + 0.3 + r * Math.sin((mod.slopeDeg || 0) * DEG2RAD) * (mod.rowPitch || 0.95);
        for (let s = 0; s < seatsPerRow; s++) {
          const localX = -usableW / 2 + (s + 0.5) * (usableW / seatsPerRow);
          const wp = rotateXZ(localX, localZ, rotDeg);
          solid.addSeat3D(cx + wp.x, rowY, cz + wp.z, seatSpacing * stride * 0.9, 0.48, fx, fz, seatPanCol, seatBackCol);
        }
      }

      // Front & rear perimeter safety rails
      const frontP = rotateXZ(0, -d / 2, rotDeg);
      const backP = rotateXZ(0, d / 2, rotDeg);
      solid.addBox(cx + frontP.x, baseElev + 0.95, cz + frontP.z, w, 0.08, 0.08, railCol, rotYRad);
      solid.addBox(cx + backP.x, baseElev + 0.95, cz + backP.z, w, 0.08, 0.08, railCol, rotYRad);
    });
  }

  buildConcertInfieldSeatsMesh(solid) {
    const blocks = generateConcertInfieldBlocks(this.venue);
    blocks.forEach((blk) => {
      // Matte fabric seat (supports user color picker 'floor' override or schema block color) & subtle dark-slate floor mat
      const floorOverride = this.tierColorOverrides && this.tierColorOverrides.floor
        ? hexToSeat3D(this.tierColorOverrides.floor)
        : null;
      const schemaPair = (!floorOverride && blk.fromSchema && blk.color) ? hexToSeat3D(blk.color) : null;
      const panCol = floorOverride ? floorOverride.pan : (schemaPair ? schemaPair.pan : [0.18, 0.42, 0.76, 1.0]);
      const backCol = floorOverride ? floorOverride.back : (schemaPair ? schemaPair.back : [0.14, 0.34, 0.64, 1.0]);
      const railCol = [0.58, 0.64, 0.72, 1.0];
      const rotDeg = blk.rotDeg || 0;
      const rotYRad = -rotDeg * DEG2RAD;
      const hw = blk.width / 2;
      const hd = blk.depth / 2;
      const baseElev = Number(blk.baseElevation) || 0;
      const slopeDeg = Number(blk.slopeDeg) || 0;
      const rowPitch = Number(blk.rowPitch) || 0.88;
      const rows = Math.max(1, blk.rows || 8);
      const dirSign = blk.localFacingZ === 1 ? -1 : 1;
      const backTopElev = baseElev + Math.max(0, rows - 1) * Math.sin(slopeDeg * DEG2RAD) * rowPitch;

      const matPt = (lx, lz, y) => {
        const rp = rotateXZ(lx, lz, rotDeg);
        return { x: blk.x + rp.x, y, z: blk.z + rp.z };
      };

      // Subtle rotated floor mat / riser platform base
      const frontLocalZ = dirSign * (-hd);
      const backLocalZ = dirSign * hd;
      const yFront = baseElev + 0.14;
      const yBack = backTopElev + 0.14;
      solid.addQuad(
        matPt(-hw, frontLocalZ, yFront),
        matPt(-hw, backLocalZ, yBack),
        matPt(hw, backLocalZ, yBack),
        matPt(hw, frontLocalZ, yFront),
        [0.08, 0.11, 0.17, 1.0],
        { x: 0, y: 1, z: 0 }
      );
      if (yBack > 0.3) {
        // Side and rear riser skirts for sloped concert floor blocks
        solid.addQuad(
          matPt(-hw, backLocalZ, 0.14),
          matPt(hw, backLocalZ, 0.14),
          matPt(hw, backLocalZ, yBack),
          matPt(-hw, backLocalZ, yBack),
          [0.14, 0.17, 0.23, 1.0]
        );
      }

      // Populate individual 3D seats row by row facing the stage (Row 1 nearest stage)
      const seatSpacing = Math.max(0.4, blk.seatSpacing || 0.52);
      const estTotalSeats = (blk.width / seatSpacing) * rows;
      const stride = estTotalSeats > 1800 ? 3 : (estTotalSeats > 450 ? 2 : 1);
      const rowStep = rows > 40 ? 2 : 1;
      const seatCount = Math.max(4, Math.floor((blk.width - 0.6) / (seatSpacing * stride)));

      for (let r = 0; r < rows; r += rowStep) {
        const localZ = dirSign * (-hd + (r + 0.5) * (blk.depth / rows));
        const seatY = baseElev + 0.14 + r * Math.sin(slopeDeg * DEG2RAD) * rowPitch;
        for (let s = 0; s < seatCount; s++) {
          const localX = -(blk.width - 0.6) / 2 + (s + 0.5) * ((blk.width - 0.6) / seatCount);
          const wp = rotateXZ(localX, localZ, rotDeg);
          solid.addSeat3D(
            blk.x + wp.x,
            seatY,
            blk.z + wp.z,
            seatSpacing * stride * 0.94,
            0.50,
            blk.facingX || 0,
            blk.facingZ !== undefined ? blk.facingZ : -1,
            panCol,
            backCol
          );
        }
      }

      // Clean perimeter open safety rails
      const frontP = rotateXZ(0, frontLocalZ, rotDeg);
      const backP = rotateXZ(0, backLocalZ, rotDeg);
      solid.addBox(blk.x + frontP.x, yFront + 0.72, blk.z + frontP.z, blk.width, 0.08, 0.10, railCol, rotYRad);
      solid.addBox(blk.x + backP.x, yBack + 0.72, blk.z + backP.z, blk.width, 0.08, 0.10, railCol, rotYRad);
    });
  }

  buildSportsEquipmentMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;
    const hl = (infield.pitchLength || 105) / 2;
    const whiteCol = [0.95, 0.97, 1.0, 1.0];
    const pitchOri = infield.pitchOrientationDeg || 0;
    const rotRad = -pitchOri * DEG2RAD;

    const addEqBox = (lx, cy, lz, w, h, d, col) => {
      const wp = rotateXZ(lx, lz, pitchOri);
      solid.addBox(wp.x, cy, wp.z, w, h, d, col, rotRad);
    };

    if (infield.surfaceType === 'hardwood-court') {
      // Basketball stanchions & backboards
      addEqBox(0, 1.8, -hl - 0.8, 0.4, 3.6, 0.4, [0.15, 0.20, 0.30, 1.0]);
      addEqBox(0, 3.3, -hl + 0.4, 1.8, 1.05, 0.1, whiteCol);
      addEqBox(0, 1.8, hl + 0.8, 0.4, 3.6, 0.4, [0.15, 0.20, 0.30, 1.0]);
      addEqBox(0, 3.3, hl - 0.4, 1.8, 1.05, 0.1, whiteCol);
    } else {
      // Football goals
      addEqBox(0, 1.22, -hl, 7.32, 2.44, 0.3, whiteCol);
      addEqBox(0, 1.22, hl, 7.32, 2.44, 0.3, whiteCol);
    }
  }

}
const InfieldMixin = {};
Object.getOwnPropertyNames(InfieldMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') InfieldMixin[k] = InfieldMixinHolder.prototype[k];
});
module.exports = { InfieldMixin };

