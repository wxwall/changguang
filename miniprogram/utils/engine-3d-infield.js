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

  buildGroundAndShell(solid, alpha) {
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
    this.buildExteriorFacadeShell(solid, alpha);
  }

  buildExteriorFacadeShell(solid, alpha) {
    const facade = this.venue && this.venue.facade;
    if (facade && facade.enabled === false) return;

    const overrides = this.tierColorOverrides || {};
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const lastTier = tiers[lastTierIdx];
    const lastSlope = lastTier.defaultSlopeDeg || 24;
    const lastRows = lastTier.defaultRows || 22;
    const lastPitch = lastTier.defaultRowPitch || 0.85;
    const isMorphedLast = isConcentricMorphTier(lastTier);

    const ringAngles = this.buildFullRingAngles(180);
    const wallHex = overrides.wall || (facade && facade.wallColor) || '#CBD5E1';
    const wallRgb = parseHexRgb(wallHex) || { r: 203, g: 213, b: 225 };
    const wr = wallRgb.r / 255;
    const wg = wallRgb.g / 255;
    const wb = wallRgb.b / 255;

    const wallOpacity = (facade && facade.opacity !== undefined)
      ? Math.max(0.15, Math.min(1.0, Number(facade.opacity)))
      : 1.0;
    const isTranslucent = wallOpacity < 0.99 && Boolean(alpha);
    const wallBuilder = isTranslucent ? alpha : solid;
    const shellCol = [wr, wg, wb, isTranslucent ? wallOpacity : 1.0];
    const trimCol = [Math.max(0, wr * 0.86), Math.max(0, wg * 0.86), Math.max(0, wb * 0.86), 1.0];
    const plinthCol = [Math.max(0, wr * 0.72), Math.max(0, wg * 0.72), Math.max(0, wb * 0.72), 1.0];

    const lastRiserH = lastTier.defaultRiserHeight || (lastPitch * Math.tan(lastSlope * DEG2RAD));
    const heightExt = (facade && facade.heightExtensionM !== undefined) ? Number(facade.heightExtensionM) : 1.2;
    const flatTopWallY = (lastTier.baseElevation || 14) + Math.max(0, lastRows - 1) * lastRiserH + heightExt;
    const pad = 1.5;

    const evalWallPoint = (deg, extraPad = 0) => {
      const pt = evalTierPoint(this.venue, lastTierIdx, deg, 1);
      const rLen = Math.hypot(pt.x, pt.z) || 1;
      const nx = isMorphedLast ? (pt.x / rLen) : pt.nx;
      const nz = isMorphedLast ? (pt.z / rLen) : pt.nz;
      const totalPad = pad + extraPad;
      const x = pt.x + nx * totalPad;
      const z = pt.z + nz * totalPad;
      let topWallY = flatTopWallY;
      if (isMorphedLast) {
        const r = getTierRowsAtAngleFloat(this.venue, lastTierIdx, lastTier, null, deg);
        topWallY = (lastTier.baseElevation || 14) + Math.max(0, r - 1) * lastRiserH + heightExt;
      }
      return { x, z, nx, nz, topWallY };
    };

    const hasClassicDetail = Boolean(facade);
    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];

      const w1 = evalWallPoint(deg1, 0);
      const w2 = evalWallPoint(deg2, 0);

      wallBuilder.addQuad(
        { x: w1.x, y: -0.60, z: w1.z },
        { x: w1.x, y: w1.topWallY, z: w1.z },
        { x: w2.x, y: w2.topWallY, z: w2.z },
        { x: w2.x, y: -0.60, z: w2.z },
        shellCol
      );

      if (hasClassicDetail) {
        // Base plinth water-table band (-0.60m to 1.00m)
        const p1 = evalWallPoint(deg1, 0.22);
        const p2 = evalWallPoint(deg2, 0.22);
        solid.addQuad(
          { x: p1.x, y: -0.60, z: p1.z },
          { x: p1.x, y: 1.0, z: p1.z },
          { x: p2.x, y: 1.0, z: p2.z },
          { x: p2.x, y: -0.60, z: p2.z },
          plinthCol
        );
        // Top cornice band
        const c1 = evalWallPoint(deg1, 0.30);
        const c2 = evalWallPoint(deg2, 0.30);
        const corBot1 = Math.max(1.2, w1.topWallY - 0.85);
        const corBot2 = Math.max(1.2, w2.topWallY - 0.85);
        solid.addQuad(
          { x: c1.x, y: corBot1, z: c1.z },
          { x: c1.x, y: w1.topWallY, z: c1.z },
          { x: c2.x, y: w2.topWallY, z: c2.z },
          { x: c2.x, y: corBot2, z: c2.z },
          trimCol
        );
        // Top cap closing cornice to wall
        solid.addQuad(
          { x: w1.x, y: w1.topWallY, z: w1.z },
          { x: c1.x, y: w1.topWallY, z: c1.z },
          { x: c2.x, y: w2.topWallY, z: c2.z },
          { x: w2.x, y: w2.topWallY, z: w2.z },
          trimCol,
          { x: 0, y: 1, z: 0 }
        );
      }
    }

    // Architectural vertical pilasters around exterior facade
    const showPilasters = facade ? (facade.showPilasters !== false) : false;
    const pilasterCount = (facade && facade.pilasterCount) ? Math.max(4, Math.round(Number(facade.pilasterCount))) : 0;
    if (showPilasters && pilasterCount > 0) {
      for (let k = 0; k < pilasterCount; k++) {
        const deg = (k / pilasterCount) * 360;
        const wp = evalWallPoint(deg, 0.32);
        const h = Math.max(2, wp.topWallY + 0.60);
        const rotY = Math.atan2(wp.nx, wp.nz);
        solid.addBox(wp.x, -0.60 + h * 0.5, wp.z, 0.95, h, 0.72, trimCol, rotY);
      }
    }
  }

  buildInfieldMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;

    const isConcert = this.viewMode === 'concert';
    const ringAngles = this.buildFullRingAngles(144);
    const isTrack = infield.sportPreset === 'track-field' || infield.surfaceType === 'synthetic-track';
    let baseColor = [0.05, 0.25, 0.19, 1.0];
    if (isConcert) {
      baseColor = [0.12, 0.16, 0.24, 1.0];
    } else if (infield.surfaceType === 'hardwood-court') {
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

    // In concert mode, omit sports pitch/court flooring, running track, and markings
    if (isConcert) {
      return;
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

    const addPitchRectOutline = (cx, cz, rw, rl, lw, y, col) => {
      const x0 = cx - rw / 2, x1 = cx + rw / 2;
      const z0 = cz - rl / 2, z1 = cz + rl / 2;
      addPitchQuad(x0, z0, x0, z0 + lw, x1, z0 + lw, x1, z0, y, col);
      addPitchQuad(x0, z1 - lw, x0, z1, x1, z1, x1, z1 - lw, y, col);
      addPitchQuad(x0, z0, x0 + lw, z0, x0 + lw, z1, x0, z1, y, col);
      addPitchQuad(x1 - lw, z0, x1, z0, x1, z1, x1 - lw, z1, y, col);
    };

    const addPitchArc = (cx, cz, radius, startAngle, endAngle, segs, lw, y, col) => {
      const rIn = Math.max(0.02, radius - lw * 0.5);
      const rOut = radius + lw * 0.5;
      for (let i = 0; i < segs; i++) {
        const a1 = startAngle + (endAngle - startAngle) * (i / segs);
        const a2 = startAngle + (endAngle - startAngle) * ((i + 1) / segs);
        const s1 = Math.sin(a1), c1 = Math.cos(a1);
        const s2 = Math.sin(a2), c2 = Math.cos(a2);
        addPitchQuad(
          cx + s1 * rIn, cz + c1 * rIn,
          cx + s1 * rOut, cz + c1 * rOut,
          cx + s2 * rOut, cz + c2 * rOut,
          cx + s2 * rIn, cz + c2 * rIn,
          y, col
        );
      }
    };

    const addPitchDisc = (cx, cz, radius, segs, y, col) => {
      for (let i = 0; i < segs; i++) {
        const a1 = (i / segs) * Math.PI * 2;
        const a2 = ((i + 1) / segs) * Math.PI * 2;
        const pc = rotateXZ(cx, cz, pitchOri);
        const p1 = rotateXZ(cx + Math.sin(a1) * radius, cz + Math.cos(a1) * radius, pitchOri);
        const p2 = rotateXZ(cx + Math.sin(a2) * radius, cz + Math.cos(a2) * radius, pitchOri);
        solid.addTriangle(
          { x: pc.x, y, z: pc.z },
          { x: p1.x, y, z: p1.z },
          { x: p2.x, y, z: p2.z },
          col,
          { x: 0, y: 1, z: 0 }
        );
      }
    };

    if (infield.surfaceType === 'hardwood-court') {
      // Deep navy-slate courtside apron surrounding the hardwood floor
      const apronPadX = 3.2;
      const apronPadZ = 3.8;
      addPitchQuad(-hw - apronPadX, -hl - apronPadZ, -hw - apronPadX, hl + apronPadZ, hw + apronPadX, hl + apronPadZ, hw + apronPadX, -hl - apronPadZ, 0.055, [0.08, 0.14, 0.26, 1.0]);

      // Alternating maple & warm-oak hardwood plank strips at y = 0.08
      const planks = 24;
      const plankW = pw / planks;
      for (let i = 0; i < planks; i++) {
        const x1 = -hw + i * plankW;
        const x2 = x1 + plankW;
        const col = i % 2 === 0 ? [0.80, 0.52, 0.22, 1.0] : [0.74, 0.46, 0.18, 1.0];
        addPitchQuad(x1, -hl, x1, hl, x2, hl, x2, -hl, 0.08, col);
      }

      // FIBA-proportioned painted keys & center court circle
      const keyW = Math.min(4.9, pw * 0.34);
      const keyD = Math.min(5.8, pl * 0.22);
      const keyCol = [0.12, 0.34, 0.78, 1.0];
      const ccR = Math.min(1.8, pw * 0.13);
      addPitchQuad(-keyW / 2, -hl, -keyW / 2, -hl + keyD, keyW / 2, -hl + keyD, keyW / 2, -hl, 0.11, keyCol);
      addPitchQuad(-keyW / 2, hl - keyD, -keyW / 2, hl, keyW / 2, hl, keyW / 2, hl - keyD, 0.11, keyCol);
      addPitchDisc(0, 0, ccR, 32, 0.11, keyCol);

      // Crisp white FIBA court markings at y = 0.14
      const lw = 0.10;
      const lineCol = [0.96, 0.97, 0.99, 1.0];
      addPitchRectOutline(0, 0, pw, pl, lw, 0.14, lineCol);
      addPitchQuad(-hw, -lw / 2, -hw, lw / 2, hw, lw / 2, hw, -lw / 2, 0.14, lineCol);
      addPitchArc(0, 0, ccR, 0, Math.PI * 2, 36, lw, 0.14, lineCol);

      // Free-throw lanes & circles
      addPitchRectOutline(0, -hl + keyD / 2, keyW, keyD, lw, 0.14, lineCol);
      addPitchRectOutline(0, hl - keyD / 2, keyW, keyD, lw, 0.14, lineCol);
      addPitchArc(0, -hl + keyD, ccR, -Math.PI / 2, Math.PI / 2, 20, lw, 0.14, lineCol);
      addPitchArc(0, hl - keyD, ccR, Math.PI / 2, Math.PI * 1.5, 20, lw, 0.14, lineCol);

      // 3-point arcs & straight corner 3-point lines (FIBA 6.75m radius, 0.90m sideline inset)
      const basketOff = Math.min(1.575, pl * 0.065);
      const cornerInset = Math.min(0.90, pw * 0.07);
      const cornerX = hw - cornerInset;
      const r3 = Math.min(6.75, hw * 0.90);
      const straightZ = Math.sqrt(Math.max(0, r3 * r3 - cornerX * cornerX));
      const arcAngle = Math.asin(Math.min(1, cornerX / Math.max(0.1, r3)));
      if (r3 > 2.5) {
        // Top basket 3-pt
        addPitchQuad(-cornerX - lw / 2, -hl, -cornerX + lw / 2, -hl, -cornerX + lw / 2, -hl + basketOff + straightZ, -cornerX - lw / 2, -hl + basketOff + straightZ, 0.14, lineCol);
        addPitchQuad(cornerX - lw / 2, -hl, cornerX + lw / 2, -hl, cornerX + lw / 2, -hl + basketOff + straightZ, cornerX - lw / 2, -hl + basketOff + straightZ, 0.14, lineCol);
        addPitchArc(0, -hl + basketOff, r3, -arcAngle, arcAngle, 32, lw, 0.14, lineCol);
        // Bottom basket 3-pt
        addPitchQuad(-cornerX - lw / 2, hl - basketOff - straightZ, -cornerX + lw / 2, hl - basketOff - straightZ, -cornerX + lw / 2, hl, -cornerX - lw / 2, hl, 0.14, lineCol);
        addPitchQuad(cornerX - lw / 2, hl - basketOff - straightZ, cornerX + lw / 2, hl - basketOff - straightZ, cornerX + lw / 2, hl, cornerX - lw / 2, hl, 0.14, lineCol);
        addPitchArc(0, hl - basketOff, r3, Math.PI - arcAngle, Math.PI + arcAngle, 32, lw, 0.14, lineCol);
      }

      // Restricted area arcs
      const rRest = Math.min(1.25, pw * 0.09);
      addPitchArc(0, -hl + basketOff, rRest, -Math.PI / 2, Math.PI / 2, 16, lw, 0.14, lineCol);
      addPitchArc(0, hl - basketOff, rRest, Math.PI / 2, Math.PI * 1.5, 16, lw, 0.14, lineCol);
    } else {
      // Rich emerald turf apron outside touchlines (y = 0.055)
      const turfPadX = 3.2;
      const turfPadZ = 4.0;
      addPitchQuad(-hw - turfPadX, -hl - turfPadZ, -hw - turfPadX, hl + turfPadZ, hw + turfPadX, hl + turfPadZ, hw + turfPadX, -hl - turfPadZ, 0.055, [0.04, 0.34, 0.23, 1.0]);

      // 18 alternating mowed grass stripes at y = 0.08
      const stripes = 18;
      const stripeLen = pl / stripes;
      for (let i = 0; i < stripes; i++) {
        const z1 = -hl + i * stripeLen;
        const z2 = z1 + stripeLen;
        const col = i % 2 === 0 ? [0.05, 0.44, 0.29, 1.0] : [0.08, 0.53, 0.35, 1.0];
        addPitchQuad(-hw, z1, -hw, z2, hw, z2, hw, z1, 0.08, col);
      }

      // Accurate FIFA football pitch markings at y = 0.14
      const lw = 0.20;
      const lineCol = [0.95, 0.97, 1.0, 1.0];
      // Outer touchlines & goal lines + halfway line
      addPitchRectOutline(0, 0, pw, pl, lw, 0.14, lineCol);
      addPitchQuad(-hw, -lw / 2, -hw, lw / 2, hw, lw / 2, hw, -lw / 2, 0.14, lineCol);

      // Center circle (r = 9.15m) & center spot
      const centerR = Math.min(9.15, hw * 0.4);
      addPitchArc(0, 0, centerR, 0, Math.PI * 2, 48, lw, 0.14, lineCol);
      addPitchDisc(0, 0, 0.38, 16, 0.142, lineCol);

      // Penalty areas (40.32m x 16.5m) & Goal areas (18.32m x 5.5m)
      const penW = Math.min(40.32, pw * 0.72);
      const penD = Math.min(16.5, pl * 0.22);
      const goalW = Math.min(18.32, pw * 0.42);
      const goalD = Math.min(5.5, pl * 0.10);
      const penSpotD = Math.min(11.0, penD * 0.67);

      // Top end (-hl)
      addPitchRectOutline(0, -hl + penD / 2, penW, penD, lw, 0.14, lineCol);
      addPitchRectOutline(0, -hl + goalD / 2, goalW, goalD, lw, 0.14, lineCol);
      addPitchDisc(0, -hl + penSpotD, 0.32, 14, 0.142, lineCol);
      // Bottom end (+hl)
      addPitchRectOutline(0, hl - penD / 2, penW, penD, lw, 0.14, lineCol);
      addPitchRectOutline(0, hl - goalD / 2, goalW, goalD, lw, 0.14, lineCol);
      addPitchDisc(0, hl - penSpotD, 0.32, 14, 0.142, lineCol);

      // Penalty arcs (r = 9.15m outside the 16.5m box)
      const penArcHalfAng = Math.acos(Math.min(1, (penD - penSpotD) / centerR));
      if (penArcHalfAng > 0.05) {
        addPitchArc(0, -hl + penSpotD, centerR, -penArcHalfAng, penArcHalfAng, 20, lw, 0.14, lineCol);
        addPitchArc(0, hl - penSpotD, centerR, Math.PI - penArcHalfAng, Math.PI + penArcHalfAng, 20, lw, 0.14, lineCol);
      }

      // 4 Corner arcs (r = 1.0m)
      const cr = 1.0;
      addPitchArc(-hw, -hl, cr, 0, Math.PI / 2, 8, lw, 0.14, lineCol);
      addPitchArc(hw, -hl, cr, -Math.PI / 2, 0, 8, lw, 0.14, lineCol);
      addPitchArc(-hw, hl, cr, Math.PI / 2, Math.PI, 8, lw, 0.14, lineCol);
      addPitchArc(hw, hl, cr, Math.PI, Math.PI * 1.5, 8, lw, 0.14, lineCol);
    }
  }

  buildInfieldModulesMesh(solid, alpha) {
    // Only render permanent non-stage sideline modules in Sports mode (concert stage modules render via buildConcertInfieldSeatsMesh)
    const modules = (this.venue.infieldModules || []).filter(m => !m.autoGeneratedForStage);
    modules.forEach((mod) => {
      const floorOverride = this.tierColorOverrides && this.tierColorOverrides.floor
        ? hexToSeat3D(this.tierColorOverrides.floor)
        : null;
      const modColorPair = (!floorOverride && mod.color) ? hexToSeat3D(mod.color) : null;
      const infieldDefaultPair = (!floorOverride && !modColorPair && this.venue.infield && this.venue.infield.defaultSeatColor)
        ? hexToSeat3D(this.venue.infield.defaultSeatColor)
        : null;
      const resolvedPair = floorOverride || modColorPair || infieldDefaultPair;
      const seatPanCol = resolvedPair ? resolvedPair.pan : [0.10, 0.78, 0.56, 1.0];
      const seatBackCol = resolvedPair ? resolvedPair.back : [0.04, 0.52, 0.36, 1.0];
      const railCol = [0.84, 0.88, 0.94, 1.0];

      const rotDeg = Number(mod.rotationDeg) || 0;
      const rotYRad = -rotDeg * DEG2RAD;
      const cx = Number(mod.x) || 0;
      const cz = Number(mod.y) || 0;
      const w = Number(mod.width) || 24;
      const d = Number(mod.depth) || 5;
      const baseElev = Number(mod.baseElevation) || 0;

      // Platform deck
      solid.addBox(cx, baseElev + 0.15, cz, w, 0.3, d, [0.24, 0.29, 0.37, 1.0], rotYRad);

      // Populate rows of 3D seats inside the module facing inward toward pitch center (0, 0)
      const rows = Math.max(1, Number(mod.rows) || 4);
      const seatSpacing = Math.max(0.4, Number(mod.seatSpacing) || 0.6);
      const aisleW = Number(mod.aisleWidth) || 1.4;
      const usableW = Math.max(2, w - aisleW);
      const stride = 1;
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
          solid.addSeat3D(cx + wp.x, rowY, cz + wp.z, seatSpacing * 0.96, 0.45, fx, fz, seatPanCol, seatBackCol);
        }
      }

      // Lowered & textured front/rear perimeter safety rails (~0.66m)
      const railOpts = {
        capColor: [0.80, 0.84, 0.90, 1.0],
        postColor: [0.24, 0.28, 0.35, 1.0],
        midColor: [0.58, 0.63, 0.70, 1.0],
        postSpacing: 3.0,
        showGlass: true
      };
      const fL = rotateXZ(-w / 2, -d / 2, rotDeg);
      const fR = rotateXZ(w / 2, -d / 2, rotDeg);
      const bL = rotateXZ(-w / 2, d / 2, rotDeg);
      const bR = rotateXZ(w / 2, d / 2, rotDeg);
      const topRowY = baseElev + 0.3 + Math.max(0, rows - 1) * Math.sin((mod.slopeDeg || 0) * DEG2RAD) * (mod.rowPitch || 0.95);
      solid.addTexturedRailingRun(
        { x: cx + fL.x, z: cz + fL.z }, baseElev + 0.3,
        { x: cx + fR.x, z: cz + fR.z }, baseElev + 0.3,
        0.66, railOpts, alpha
      );
      solid.addTexturedRailingRun(
        { x: cx + bL.x, z: cz + bL.z }, topRowY,
        { x: cx + bR.x, z: cz + bR.z }, topRowY,
        0.66, railOpts, alpha
      );
    });
  }

  buildConcertInfieldSeatsMesh(solid, alpha) {
    const blocks = generateConcertInfieldBlocks(this.venue);
    blocks.forEach((blk) => {
      // Matte fabric seat (supports user color picker 'floor' override or schema block color) & subtle dark-slate floor mat
      const floorOverride = this.tierColorOverrides && this.tierColorOverrides.floor
        ? hexToSeat3D(this.tierColorOverrides.floor)
        : null;
      const schemaPair = (!floorOverride && blk.fromSchema && blk.color) ? hexToSeat3D(blk.color) : null;
      const infieldDefaultPair = (!floorOverride && !schemaPair && this.venue.infield && this.venue.infield.defaultSeatColor)
        ? hexToSeat3D(this.venue.infield.defaultSeatColor)
        : null;
      const panCol = floorOverride ? floorOverride.pan : (schemaPair ? schemaPair.pan : (infieldDefaultPair ? infieldDefaultPair.pan : [0.18, 0.42, 0.76, 1.0]));
      const backCol = floorOverride ? floorOverride.back : (schemaPair ? schemaPair.back : (infieldDefaultPair ? infieldDefaultPair.back : [0.14, 0.34, 0.64, 1.0]));
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
        [0.22, 0.26, 0.34, 1.0],
        { x: 0, y: 1, z: 0 }
      );
      if (yBack > 0.3) {
        // Side and rear riser skirts for sloped concert floor blocks
        solid.addQuad(
          matPt(-hw, backLocalZ, 0.14),
          matPt(hw, backLocalZ, 0.14),
          matPt(hw, backLocalZ, yBack),
          matPt(-hw, backLocalZ, yBack),
          [0.22, 0.26, 0.34, 1.0]
        );
      }

      // Populate individual 3D seats row by row facing the stage (Row 1 nearest stage)
      const seatSpacing = Math.max(0.4, blk.seatSpacing || 0.52);
      const stride = 1;
      const rowStep = 1;
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
            seatSpacing * 0.98,
            0.48,
            blk.facingX || 0,
            blk.facingZ !== undefined ? blk.facingZ : -1,
            panCol,
            backCol
          );
        }
      }

      // Lowered & textured perimeter open safety rails (~0.64m)
      const railOpts = {
        capColor: [0.76, 0.80, 0.86, 1.0],
        postColor: [0.24, 0.28, 0.35, 1.0],
        midColor: [0.54, 0.60, 0.68, 1.0],
        postSpacing: 3.2
      };
      const fL = matPt(-hw, frontLocalZ, yFront);
      const fR = matPt(hw, frontLocalZ, yFront);
      const bL = matPt(-hw, backLocalZ, yBack);
      const bR = matPt(hw, backLocalZ, yBack);
      solid.addTexturedRailingRun({ x: fL.x, z: fL.z }, yFront, { x: fR.x, z: fR.z }, yFront, 0.64, railOpts, alpha);
      solid.addTexturedRailingRun({ x: bL.x, z: bL.z }, yBack, { x: bR.x, z: bR.z }, yBack, 0.64, railOpts, alpha);
    });
  }

  buildSportsEquipmentMesh(solid, alpha, screens) {
    const infield = this.venue.infield;
    if (!infield) return;
    const pw = infield.pitchWidth || 68;
    const pl = infield.pitchLength || 105;
    const hw = pw / 2;
    const hl = pl / 2;
    const whiteCol = [0.96, 0.97, 1.0, 1.0];
    const pitchOri = infield.pitchOrientationDeg || 0;
    const rotRad = -pitchOri * DEG2RAD;

    const addEqBox = (lx, cy, lz, w, h, d, col) => {
      const wp = rotateXZ(lx, lz, pitchOri);
      solid.addBox(wp.x, cy, wp.z, w, h, d, col, rotRad);
    };
    const ptW = (lx, y, lz) => {
      const wp = rotateXZ(lx, lz, pitchOri);
      return { x: wp.x, y, z: wp.z };
    };

    if (infield.surfaceType === 'hardwood-court') {
      // Pro basketball stanchions, tempered glass backboards & orange rims
      const basketOff = Math.min(1.575, pl * 0.065);
      [-1, 1].forEach((endSign) => {
        const baseZ = endSign * (hl + 1.2);
        const boardZ = endSign * (hl - basketOff + 0.38);
        const rimZ = endSign * (hl - basketOff);
        // Padded dark-navy stanchion base & upright + overhang boom arm
        addEqBox(0, 0.65, baseZ, 0.85, 1.3, 1.2, [0.10, 0.16, 0.28, 1.0]);
        addEqBox(0, 2.2, baseZ, 0.30, 2.2, 0.30, [0.14, 0.20, 0.32, 1.0]);
        solid.addBeam3D(ptW(0, 3.25, baseZ), ptW(0, 3.35, boardZ), 0.22, 0.22, [0.14, 0.20, 0.32, 1.0]);
        // Tempered glass backboard + white frame
        if (alpha) {
          alpha.addQuad(
            ptW(-0.90, 2.90, boardZ), ptW(-0.90, 3.95, boardZ),
            ptW(0.90, 3.95, boardZ), ptW(0.90, 2.90, boardZ),
            [0.72, 0.88, 0.98, 0.35]
          );
        }
        addEqBox(0, 2.92, boardZ, 1.80, 0.06, 0.06, whiteCol);
        addEqBox(0, 3.93, boardZ, 1.80, 0.06, 0.06, whiteCol);
        addEqBox(-0.88, 3.42, boardZ, 0.06, 1.05, 0.06, whiteCol);
        addEqBox(0.88, 3.42, boardZ, 0.06, 1.05, 0.06, whiteCol);
        // Orange rim & net
        addEqBox(0, 3.05, rimZ, 0.48, 0.06, 0.48, [0.95, 0.38, 0.08, 1.0]);
      });
    } else {
      // Realistic 3D Football Goals (posts, crossbar, rear ground frame & semi-transparent net)
      const goalW = 7.32;
      const goalH = 2.44;
      const goalD = 1.80;
      const halfG = goalW / 2;
      const netCol = [0.92, 0.95, 0.98, 0.28];

      [-1, 1].forEach((endSign) => {
        const gz = endSign * hl;
        const backZ = endSign * (hl + goalD);
        // Left & right goalposts + top crossbar
        addEqBox(-halfG, goalH / 2, gz, 0.14, goalH, 0.14, whiteCol);
        addEqBox(halfG, goalH / 2, gz, 0.14, goalH, 0.14, whiteCol);
        addEqBox(0, goalH, gz, goalW + 0.14, 0.14, 0.14, whiteCol);
        // Rear ground frame & back stanchions
        addEqBox(0, 0.06, backZ, goalW, 0.08, 0.08, [0.76, 0.80, 0.86, 1.0]);
        solid.addBeam3D(ptW(-halfG, 0.06, gz), ptW(-halfG, 0.06, backZ), 0.08, 0.08, [0.76, 0.80, 0.86, 1.0]);
        solid.addBeam3D(ptW(halfG, 0.06, gz), ptW(halfG, 0.06, backZ), 0.08, 0.08, [0.76, 0.80, 0.86, 1.0]);
        solid.addBeam3D(ptW(-halfG, goalH, gz), ptW(-halfG, 0.06, backZ), 0.06, 0.06, [0.76, 0.80, 0.86, 1.0]);
        solid.addBeam3D(ptW(halfG, goalH, gz), ptW(halfG, 0.06, backZ), 0.06, 0.06, [0.76, 0.80, 0.86, 1.0]);
        // Semi-transparent goal net
        if (alpha) {
          const topBackZ = endSign * (hl + goalD * 0.45);
          alpha.addQuad(ptW(-halfG, 0.08, backZ), ptW(-halfG, goalH, topBackZ), ptW(halfG, goalH, topBackZ), ptW(halfG, 0.08, backZ), netCol);
          alpha.addQuad(ptW(-halfG, goalH, gz), ptW(-halfG, goalH, topBackZ), ptW(halfG, goalH, topBackZ), ptW(halfG, goalH, gz), netCol);
          alpha.addTriangle(ptW(-halfG, 0.08, gz), ptW(-halfG, goalH, gz), ptW(-halfG, 0.08, backZ), netCol);
          alpha.addTriangle(ptW(halfG, 0.08, gz), ptW(halfG, 0.08, backZ), ptW(halfG, goalH, gz), netCol);
        }
      });
    }

    // Perimeter LED Advertising Boards around the field in Sports mode
    this.buildSportsPerimeterBoardsMesh(solid, screens);
  }

  buildSportsPerimeterBoardsMesh(solid, screens) {
    const infield = this.venue.infield;
    if (!infield) return;
    const isCourt = infield.surfaceType === 'hardwood-court';
    const isTrack = infield.sportPreset === 'track-field' || infield.surfaceType === 'synthetic-track';
    const pw = infield.pitchWidth || 68;
    const pl = infield.pitchLength || 105;
    const hw = pw / 2;
    const hl = pl / 2;
    const pitchOri = infield.pitchOrientationDeg || 0;

    let padX = isCourt ? 2.4 : 3.6;
    let padZ = isCourt ? 3.0 : 4.6;
    if (isTrack) {
      const spec = computeRunningTrackSpec(infield);
      const maxHalfW = Math.max(hw + 1.2, spec.innerApronWidth * 0.5 - 1.2);
      const maxHalfL = Math.max(hl + 1.5, spec.innerApronLength * 0.5 - 1.5);
      padX = Math.min(padX, maxHalfW - hw);
      padZ = Math.min(padZ, maxHalfL - hl);
    }

    const bx = hw + padX;
    const bz = hl + padZ;
    const boardH = isCourt ? 0.85 : 1.05;
    const boardDepth = 0.24;
    const panelMaxW = isCourt ? 3.2 : 4.8;
    const panelGap = 0.16;
    const frameCol = [0.10, 0.12, 0.16, 1.0];
    const trimCol = [0.22, 0.26, 0.34, 1.0];

    // Sponsor-style vibrant LED ribbon color palette (alternating crisp blocks)
    const ledPalette = [
      { bg: [0.06, 0.38, 0.88, 1.0], accent: [0.20, 0.84, 1.00, 1.0] },
      { bg: [0.05, 0.56, 0.42, 1.0], accent: [0.58, 0.96, 0.35, 1.0] },
      { bg: [0.78, 0.12, 0.22, 1.0], accent: [1.00, 0.82, 0.22, 1.0] },
      { bg: [0.10, 0.18, 0.36, 1.0], accent: [0.96, 0.48, 0.14, 1.0] }
    ];

    const addBoardRun = (lx1, lz1, lx2, lz2, inNx, inNz, colorOffset) => {
      const totalLen = Math.hypot(lx2 - lx1, lz2 - lz1);
      if (totalLen < 2.0) return;
      const count = Math.max(1, Math.floor(totalLen / panelMaxW));
      const stepLen = totalLen / count;
      const dirX = (lx2 - lx1) / totalLen;
      const dirZ = (lz2 - lz1) / totalLen;
      const segAngleRad = -pitchOri * DEG2RAD - Math.atan2(dirZ, dirX);

      for (let i = 0; i < count; i++) {
        const s0 = i * stepLen + panelGap * 0.5;
        const s1 = (i + 1) * stepLen - panelGap * 0.5;
        const pW = s1 - s0;
        if (pW < 0.4) continue;
        const midS = (s0 + s1) * 0.5;
        const lcx = lx1 + dirX * midS;
        const lcz = lz1 + dirZ * midS;
        const wCenter = rotateXZ(lcx, lcz, pitchOri);

        // Dark structural LED cabinet housing
        solid.addBox(wCenter.x, boardH * 0.5 + 0.06, wCenter.z, pW, boardH, boardDepth, frameCol, segAngleRad);
        // Subtle rear support foot
        const footPos = rotateXZ(lcx - inNx * 0.22, lcz - inNz * 0.22, pitchOri);
        solid.addBox(footPos.x, 0.18, footPos.z, 0.18, 0.28, 0.32, trimCol, segAngleRad);

        // Luminous inward-facing LED display face
        const faceOff = boardDepth * 0.5 + 0.015;
        const pA = rotateXZ(lx1 + dirX * (s0 + 0.06) + inNx * faceOff, lz1 + dirZ * (s0 + 0.06) + inNz * faceOff, pitchOri);
        const pB = rotateXZ(lx1 + dirX * (s1 - 0.06) + inNx * faceOff, lz1 + dirZ * (s1 - 0.06) + inNz * faceOff, pitchOri);
        const pal = ledPalette[(i + colorOffset) % ledPalette.length];
        const isOff = this.isLightsOffScene && this.isLightsOffScene();
        const target = (!isOff && screens) ? screens : solid;
        const offCol = [0.04, 0.05, 0.07, 1.0];

        const botY = 0.14;
        const midY = botY + (boardH - 0.16) * 0.72;
        const topY = boardH - 0.02;
        // Main LED body
        target.addQuad(
          { x: pA.x, y: botY, z: pA.z },
          { x: pA.x, y: midY, z: pA.z },
          { x: pB.x, y: midY, z: pB.z },
          { x: pB.x, y: botY, z: pB.z },
          isOff ? offCol : pal.bg
        );
        // Bright top sponsor accent ticker strip
        target.addQuad(
          { x: pA.x, y: midY, z: pA.z },
          { x: pA.x, y: topY, z: pA.z },
          { x: pB.x, y: topY, z: pB.z },
          { x: pB.x, y: midY, z: pB.z },
          isOff ? offCol : pal.accent
        );
      }
    };

    const cornerGap = isCourt ? 1.0 : 1.8;
    // Left & right touchline/sideline LED board runs
    addBoardRun(-bx, -bz + cornerGap, -bx, bz - cornerGap, 1, 0, 0);
    addBoardRun(bx, bz - cornerGap, bx, -bz + cornerGap, -1, 0, 2);
    // Top & bottom goal-line/baseline LED board runs
    addBoardRun(-bx + cornerGap, -bz, bx - cornerGap, -bz, 0, 1, 1);
    addBoardRun(bx - cornerGap, bz, -bx + cornerGap, bz, 0, -1, 3);
  }

}
const InfieldMixin = {};
Object.getOwnPropertyNames(InfieldMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') InfieldMixin[k] = InfieldMixinHolder.prototype[k];
});
module.exports = { InfieldMixin };

