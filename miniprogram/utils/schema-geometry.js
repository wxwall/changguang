/**
 * STADIACAD 2.0.0 Geometry, Infield Floor & Sightline Parametric Engine
 * Pure WeChat Mini Program JS module (Zero DOM/Web dependencies)
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Rotates local (lx, lz) around origin by deg clockwise in top-down XZ plane
 * (matching 0°=North (0,-1), 90°=East (+1,0), 180°=South (0,+1), 270°=West (-1,0)).
 */
function rotateXZ(lx, lz, deg) {
  if (!deg || Math.abs(deg) < 1e-6) return { x: lx, z: lz };
  const rad = deg * DEG2RAD;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: lx * c - lz * s,
    z: lx * s + lz * c
  };
}

/**
 * Evaluates a point on a rounded-rectangle perimeter AND its true outward unit normal
 * at angleDeg (polar ray from center).
 * Angle convention:
 *   0 deg = North (0, -1 in 3D/2D)
 *  90 deg = East  (+1, 0)
 * 180 deg = South (0, +1)
 * 270 deg = West  (-1, 0)
 */
function evalInfieldPerimeterAndNormal(angleDeg, length, width, cornerRadius) {
  const rad = angleDeg * DEG2RAD;
  const dx = Math.sin(rad);
  const dz = -Math.cos(rad);

  const halfW = width / 2;
  const halfL = length / 2;
  const r = Math.min(cornerRadius || 0, halfW, halfL);
  const innerW = Math.max(0, halfW - r);
  const innerL = Math.max(0, halfL - r);

  const adx = Math.abs(dx);
  const adz = Math.abs(dz);

  // East / West straight edges: outward normal is strictly (+1, 0) or (-1, 0)
  if (adx > 1e-6) {
    const tWallX = halfW / adx;
    const zAtWall = tWallX * adz;
    if (zAtWall <= innerL + 1e-5) {
      const signX = dx >= 0 ? 1 : -1;
      return {
        x: signX * halfW,
        z: dz * tWallX,
        nx: signX,
        nz: 0,
        dist: tWallX
      };
    }
  }

  // North / South straight edges: outward normal is strictly (0, -1) or (0, +1)
  if (adz > 1e-6) {
    const tWallZ = halfL / adz;
    const xAtWall = tWallZ * adx;
    if (xAtWall <= innerW + 1e-5) {
      const signZ = dz >= 0 ? 1 : -1;
      return {
        x: dx * tWallZ,
        z: signZ * halfL,
        nx: 0,
        nz: signZ,
        dist: tWallZ
      };
    }
  }

  // Rounded corner arc: outward normal is radial from corner arc center
  const b = -(adx * innerW + adz * innerL);
  const c = innerW * innerW + innerL * innerL - r * r;
  const disc = Math.max(0, b * b - c);
  const t = -b + Math.sqrt(disc);
  const px = dx * t;
  const pz = dz * t;
  const cx = (dx >= 0 ? 1 : -1) * innerW;
  const cz = (dz >= 0 ? 1 : -1) * innerL;
  let nx = px - cx;
  let nz = pz - cz;
  const nLen = Math.hypot(nx, nz);
  if (nLen > 1e-6) {
    nx /= nLen;
    nz /= nLen;
  } else {
    const pLen = Math.hypot(px, pz) || 1;
    nx = px / pLen;
    nz = pz / pLen;
  }

  return { x: px, z: pz, nx, nz, dist: t };
}

/**
 * Evaluates the radial distance from (0,0) to a rounded-rectangle perimeter at angleDeg.
 */
function getRayRoundedRectDistance(angleDeg, length, width, cornerRadius) {
  return evalInfieldPerimeterAndNormal(angleDeg, length, width, cornerRadius).dist;
}

/**
 * Returns the 8 exact polar angles (sorted 0..360) where the infield rounded-rectangle
 * perimeter transitions between straight edges and corner arcs.
 * Injecting these angles into polygon/row polylines keeps straight walls completely flat
 * and seamless at corners.
 */
function getInfieldCornerTransitionAngles(venue) {
  const infield = venue && venue.infield;
  if (!infield) return [];
  const halfW = (infield.width || 60) / 2;
  const halfL = (infield.length || 100) / 2;
  const r = Math.min(infield.cornerRadius || 0, halfW, halfL);
  const innerW = Math.max(0, halfW - r);
  const innerL = Math.max(0, halfL - r);

  const raw = [];
  if (innerW > 1e-4 && halfL > 1e-4) {
    const aNE = Math.atan2(innerW, halfL) * RAD2DEG;
    raw.push(aNE, 180 - aNE, 180 + aNE, 360 - aNE);
  }
  if (halfW > 1e-4 && innerL > 1e-4) {
    const aEN = Math.atan2(halfW, innerL) * RAD2DEG;
    raw.push(aEN, 180 - aEN, 180 + aEN, 360 - aEN);
  }
  if (r <= 1e-4 && halfW > 1e-4 && halfL > 1e-4) {
    const aDiag = Math.atan2(halfW, halfL) * RAD2DEG;
    raw.push(aDiag, 180 - aDiag, 180 + aDiag, 360 - aDiag);
  }

  // Deduplicate and sort
  const unique = [];
  raw.sort((a, b) => a - b).forEach((ang) => {
    const norm = ((ang % 360) + 360) % 360;
    if (unique.length === 0 || Math.abs(norm - unique[unique.length - 1]) > 0.05) {
      unique.push(norm);
    }
  });
  return unique;
}

/**
 * Computes the exact 2D/3D plan coordinate (x, z) and perpendicular cut normal (nx, nz)
 * on a tier at (angleDeg, rowFrac in [0, 1]).
 *
 * Uses true parallel offsets from the infield perimeter along the infield's outward normal N:
 * - Sector cut lines (fixed angleDeg, rowFrac 0 -> 1) project 90° perpendicular to the infield edge.
 * - Tier inner/outer edges and row steps are strictly equidistant parallel offsets everywhere.
 * - Concentric-circle morph tiers (e.g. Bird's Nest 3F) anchor innerMorph to prevOuterMorph
 *   while transitioning outerMorph cleanly toward the concentric circle footprint.
 */
function evalTierPoint(venue, tierIndex, angleDeg, rowFrac, customRadialDepth) {
  const infield = venue.infield;
  const tiers = venue.standTiers;
  const p0 = evalInfieldPerimeterAndNormal(
    angleDeg,
    infield.length,
    infield.width,
    infield.cornerRadius
  );

  const majorHalfRadius = Math.max(infield.length, infield.width) / 2;

  let cumulativeOffset = 0;
  let prevOuterMorph = 0;
  for (let i = 0; i < tierIndex; i++) {
    const t = tiers[i];
    cumulativeOffset += (t.innerOffset || 0) + (t.radialDepth || 20);
    if (t.morphMode === 'concentric-circle') {
      prevOuterMorph = t.concentricMorph || 0;
    } else {
      prevOuterMorph = 0;
    }
  }

  const tier = tiers[tierIndex];
  const dIn = cumulativeOffset + (tier.innerOffset || 0);
  const horizontalDepth = customRadialDepth || tier.radialDepth || 20;
  const dOut = dIn + horizontalDepth;

  const innerMorph = prevOuterMorph;
  const outerMorph = tier.morphMode === 'concentric-circle'
    ? (tier.concentricMorph || 0)
    : 0;

  // Parallel offset along infield outward normal (90° perpendicular to infield edge)
  const rectInX = p0.x + dIn * p0.nx;
  const rectInZ = p0.z + dIn * p0.nz;
  const rectOutX = p0.x + dOut * p0.nx;
  const rectOutZ = p0.z + dOut * p0.nz;

  let inX = rectInX;
  let inZ = rectInZ;
  if (innerMorph > 1e-6) {
    const rLenIn = Math.hypot(rectInX, rectInZ) || 1;
    const circInR = majorHalfRadius + dIn;
    const circInX = (rectInX / rLenIn) * circInR;
    const circInZ = (rectInZ / rLenIn) * circInR;
    inX = rectInX * (1 - innerMorph) + circInX * innerMorph;
    inZ = rectInZ * (1 - innerMorph) + circInZ * innerMorph;
  }

  let outX = rectOutX;
  let outZ = rectOutZ;
  if (outerMorph > 1e-6) {
    const rLenOut = Math.hypot(rectOutX, rectOutZ) || 1;
    const circOutR = majorHalfRadius + dOut;
    const circOutX = (rectOutX / rLenOut) * circOutR;
    const circOutZ = (rectOutZ / rLenOut) * circOutR;
    outX = rectOutX * (1 - outerMorph) + circOutX * outerMorph;
    outZ = rectOutZ * (1 - outerMorph) + circOutZ * outerMorph;
  }

  const f = rowFrac === undefined ? 0 : rowFrac;
  return {
    x: inX + (outX - inX) * f,
    z: inZ + (outZ - inZ) * f,
    inX,
    inZ,
    outX,
    outZ,
    nx: p0.nx,
    nz: p0.nz,
    dIn,
    dOut
  };
}

/**
 * Computes radial distance bounds from (0,0) consistent with evalTierPoint.
 */
function computeTierRadialBounds(venue, tierIndex, angleDeg, customRadialDepth) {
  const pt = evalTierPoint(venue, tierIndex, angleDeg, 0, customRadialDepth);
  const innerRadius = Math.hypot(pt.inX, pt.inZ);
  const outerRadius = Math.hypot(pt.outX, pt.outZ);
  return {
    innerRadius,
    outerRadius,
    horizontalDepth: Math.hypot(pt.outX - pt.inX, pt.outZ - pt.inZ)
  };
}

/**
 * Computes the true inward normal (fx, fz) perpendicular to the row curve
 * at (angleDeg, rowFrac), ensuring seats never have a skew angle against
 * straight or curved stand steps.
 */
function getRowInwardNormal(venue, tierIndex, angleDeg, rowFrac, customRadialDepth) {
  const delta = 0.5;
  const p1 = evalTierPoint(venue, tierIndex, angleDeg - delta, rowFrac, customRadialDepth);
  const p2 = evalTierPoint(venue, tierIndex, angleDeg + delta, rowFrac, customRadialDepth);

  const tx = p2.x - p1.x;
  const tz = p2.z - p1.z;
  const nx = -tz;
  const nz = tx;
  const len = Math.hypot(nx, nz) || 1;
  return { x: nx / len, z: nz / len };
}

/**
 * Converts polar (angleDeg, radius, elevation) to 3D world coordinates (x, y, z)
 * where Y is up, X is East (+), Z is South (+) / North (-).
 */
function polarToWorld3D(angleDeg, radius, elevation) {
  const rad = angleDeg * DEG2RAD;
  return {
    x: Math.sin(rad) * radius,
    y: elevation || 0,
    z: -Math.cos(rad) * radius
  };
}

/**
 * Computes strict parameter-driven Olympic running track dimensions from venue.infield:
 * - infield.length, infield.width, infield.cornerRadius
 * - infield.pitchLength, infield.pitchWidth, infield.safetyMargin
 * - Optional infield.trackLanes, infield.trackLaneWidth
 */
function computeRunningTrackSpec(infield) {
  const length = (infield && infield.length) || 188;
  const width = (infield && infield.width) || 118;
  const cornerRadius = Math.min((infield && infield.cornerRadius) || 38, width / 2, length / 2);
  const pitchLength = (infield && infield.pitchLength) || 105;
  const pitchWidth = (infield && infield.pitchWidth) || 68;
  const safetyMargin = (infield && infield.safetyMargin !== undefined && infield.safetyMargin !== null)
    ? Number(infield.safetyMargin)
    : 12;

  const sideClearance = Math.max(0, (width - pitchWidth) / 2);
  const endClearance = Math.max(0, (length - pitchLength) / 2);
  const minClearance = Math.min(sideClearance, endClearance);

  const laneWidth = (infield && infield.trackLaneWidth) ? Number(infield.trackLaneWidth) : 1.22;
  const maxUsableBand = Math.max(laneWidth * 2, minClearance - 2.0);
  const safetyLimitedBand = Math.max(laneWidth * 4, minClearance - safetyMargin);
  const targetBand = Math.min(maxUsableBand, safetyLimitedBand);

  const lanes = (infield && infield.trackLanes)
    ? Math.max(1, Math.min(12, Math.round(Number(infield.trackLanes))))
    : Math.max(4, Math.min(10, Math.floor(targetBand / laneWidth)));

  const trackBandWidth = Number((lanes * laneWidth).toFixed(3));
  const remainingSlack = Math.max(0, minClearance - trackBandWidth);
  const outerInset = (infield && infield.trackOuterMargin !== undefined)
    ? Math.max(0, Number(infield.trackOuterMargin))
    : Number(Math.min(2.2, remainingSlack * 0.14).toFixed(3));

  const outerTrackWidth = Math.max(pitchWidth + trackBandWidth * 2 + 1, width - outerInset * 2);
  const outerTrackLength = Math.max(pitchLength + trackBandWidth * 2 + 1, length - outerInset * 2);
  const outerTrackCornerRadius = Math.max(4, cornerRadius - outerInset);

  const innerApronWidth = Math.max(pitchWidth + 1.0, outerTrackWidth - trackBandWidth * 2);
  const innerApronLength = Math.max(pitchLength + 1.0, outerTrackLength - trackBandWidth * 2);
  const innerApronCornerRadius = Math.max(2, outerTrackCornerRadius - trackBandWidth);

  return {
    lanes,
    laneWidth,
    trackBandWidth,
    outerInset,
    outerTrackWidth,
    outerTrackLength,
    outerTrackCornerRadius,
    innerApronWidth,
    innerApronLength,
    innerApronCornerRadius
  };
}

/**
 * Computes the exact stage orientation, center, facing unit vector, FOH position,
 * and longitudinal/transverse infield bounds derived strictly from stageConfig.orientationDeg.
 * Convention: stageConfig.orientationDeg is the direction the stage FACES
 * (0°=North, 90°=East, 180°=South, 270°=West).
 */
function getStageTransform(venue) {
  const infield = (venue && venue.infield) || {};
  const stage = infield.stageConfig || {};
  const oriDeg = (stage.orientationDeg !== undefined && stage.orientationDeg !== null)
    ? Number(stage.orientationDeg)
    : 180;
  const rotFromSouthDeg = oriDeg - 180;

  const oriRad = oriDeg * DEG2RAD;
  const facingX = Math.sin(oriRad);
  const facingZ = -Math.cos(oriRad);

  const alongHalf = Math.max(
    12,
    evalInfieldPerimeterAndNormal(oriDeg, infield.length || 100, infield.width || 60, infield.cornerRadius || 10).dist - 4
  );
  const crossHalf = Math.max(
    10,
    evalInfieldPerimeterAndNormal(oriDeg + 90, infield.length || 100, infield.width || 60, infield.cornerRadius || 10).dist - 4
  );

  const sw = stage.width || 30;
  const sd = stage.depth || 20;
  const sh = stage.height || 2.0;

  if (stage.type === 'center-stage') {
    return {
      type: 'center-stage',
      orientationDeg: oriDeg,
      rotFromSouthDeg,
      facingX,
      facingZ,
      alongHalf,
      crossHalf,
      stageLocalZ: 0,
      centerX: 0,
      centerZ: 0,
      targetY: sh + 1.6,
      catwalkLength: stage.catwalkLength || 10,
      fohLocalZ: 0
    };
  }

  // Fit stage deck inside longitudinal axis
  const alongPitchHalf = (Math.abs(Math.sin(oriRad)) > Math.abs(Math.cos(oriRad)))
    ? (infield.pitchWidth || infield.width || 68)
    : (infield.pitchLength || infield.length || 100);
  const stageOffset = Math.max(
    sd / 2 + 2,
    Math.min(alongPitchHalf * 0.36, alongHalf - sd / 2 - 1.5)
  );
  const stageLocalZ = -stageOffset;
  const stageFrontLocalZ = stageLocalZ + sd / 2;

  const maxCatwalk = Math.max(4, alongHalf - stageFrontLocalZ - 4);
  const catwalkLength = Math.min(stage.catwalkLength || 18, maxCatwalk);

  const fohD = stage.fohDepth || 5;
  const maxFohDist = Math.max(catwalkLength + 6, alongHalf - stageFrontLocalZ - fohD / 2 - 2);
  const fohDist = Math.min(stage.fohDistance || 38, maxFohDist);
  const fohLocalZ = stageFrontLocalZ + fohDist;

  const centerWorld = rotateXZ(0, stageLocalZ, rotFromSouthDeg);
  return {
    type: stage.type || 'end-stage',
    orientationDeg: oriDeg,
    rotFromSouthDeg,
    facingX,
    facingZ,
    alongHalf,
    crossHalf,
    stageLocalZ,
    stageFrontLocalZ,
    centerX: centerWorld.x,
    centerZ: centerWorld.z,
    targetY: sh + 2.2,
    catwalkLength,
    fohLocalZ
  };
}

/**
 * Strictly computes the vomitory angular bounds [vomStartDeg, vomEndDeg] so that
 * the physical Euclidean opening width along the stand matches vom.width (in meters),
 * honoring vom.position, vom.angularOffsetPct, vom.startRow, and vom.rowSpan.
 */
function computeVomitoryAngularBounds(venue, tierIndex, sDeg, eDeg, vom, totalRows, customRadialDepth) {
  const angularSpan = eDeg - sDeg;
  const tier = (venue.standTiers && venue.standTiers[tierIndex]) || {};
  const radialAisleWidth = tier.radialAisleWidth || 1.6;
  const rawStartRow = (vom.startRow !== undefined && vom.startRow !== null) ? Number(vom.startRow) : 5;
  const rawRowSpan = (vom.rowSpan !== undefined && vom.rowSpan !== null) ? Number(vom.rowSpan) : 5;
  const isFrontConnected = rawStartRow <= 1;

  let vomStartRow;
  let vomEndRow;
  if (rawStartRow === 0 && rawRowSpan === 0) {
    vomStartRow = 1;
    vomEndRow = 0;
  } else {
    vomStartRow = Math.max(1, rawStartRow);
    vomEndRow = Math.min(totalRows, vomStartRow + Math.max(1, rawRowSpan) - 1);
  }

  const vomRowFrac = isFrontConnected
    ? (vomEndRow < 1 ? 0.08 : Math.min(0.45, Math.max(0.06, ((vomEndRow - 0.5) * 0.5) / Math.max(1, totalRows))))
    : Math.min(0.92, Math.max(0.08, ((vomStartRow + vomEndRow) * 0.5 - 0.5) / Math.max(1, totalRows)));

  let centerRatio = 0.5;
  if (vom.position === 'left') centerRatio = 0.28;
  else if (vom.position === 'right') centerRatio = 0.72;
  const offsetRatio = ((vom.angularOffsetPct || 0) / 100) * 0.5;
  centerRatio = Math.max(0.2, Math.min(0.8, centerRatio + offsetRatio));
  const vomCenterDeg = sDeg + angularSpan * centerRatio;

  const targetWidth = Math.max(0.8, Number(vom.width) || 3.2);

  // Measure local arc speed at vomCenterDeg and refine halfDeg so chord === targetWidth
  const eps = 0.25;
  const pMinus = evalTierPoint(venue, tierIndex, vomCenterDeg - eps, vomRowFrac, customRadialDepth);
  const pPlus = evalTierPoint(venue, tierIndex, vomCenterDeg + eps, vomRowFrac, customRadialDepth);
  let metersPerDeg = Math.hypot(pPlus.x - pMinus.x, pPlus.z - pMinus.z) / (2 * eps);
  if (metersPerDeg < 0.05) metersPerDeg = 0.5;

  let halfDeg = (targetWidth * 0.5) / metersPerDeg;
  for (let iter = 0; iter < 4; iter++) {
    const pL = evalTierPoint(venue, tierIndex, vomCenterDeg - halfDeg, vomRowFrac, customRadialDepth);
    const pR = evalTierPoint(venue, tierIndex, vomCenterDeg + halfDeg, vomRowFrac, customRadialDepth);
    const chord = Math.hypot(pR.x - pL.x, pR.z - pL.z);
    if (chord > 0.05) {
      halfDeg = halfDeg * (targetWidth / chord);
    }
  }

  // Clamp only to keep clear of side stair aisles
  const aisleMarginDeg = ((radialAisleWidth * 0.55) + 0.15) / metersPerDeg;
  const maxHalfLeft = Math.max(0.1, (vomCenterDeg - sDeg) - aisleMarginDeg);
  const maxHalfRight = Math.max(0.1, (eDeg - vomCenterDeg) - aisleMarginDeg);
  const clampedHalf = Math.max(0.1, Math.min(halfDeg, maxHalfLeft, maxHalfRight));

  const vomStartDeg = vomCenterDeg - clampedHalf;
  const vomEndDeg = vomCenterDeg + clampedHalf;
  const pFinalL = evalTierPoint(venue, tierIndex, vomStartDeg, vomRowFrac, customRadialDepth);
  const pFinalR = evalTierPoint(venue, tierIndex, vomEndDeg, vomRowFrac, customRadialDepth);

  return {
    vomStartDeg,
    vomEndDeg,
    vomCenterDeg,
    vomStartRow,
    vomEndRow,
    isFrontConnected,
    vomRowFrac,
    targetWidth,
    actualWidthM: Math.hypot(pFinalR.x - pFinalL.x, pFinalR.z - pFinalL.z)
  };
}

/**
 * Generates Concert Infield Floor Seating Blocks derived strictly from
 * venue.infield and venue.infield.stageConfig (including stageConfig.orientationDeg).
 */
function generateConcertInfieldBlocks(venue) {
  const infield = venue.infield;
  const stage = infield && infield.stageConfig;
  if (!infield || !stage) return [];

  const st = getStageTransform(venue);
  const blocks = [];
  const halfL = st.alongHalf;
  const usableHalfW = Math.max(10, st.crossHalf);
  const sd = stage.depth || 20;

  if (stage.type === 'center-stage') {
    const cw = stage.catwalkWidth || 3.2;
    const zStart = sd / 2 + 2.5;
    const zEnd = halfL - 1.5;
    const depthZ = zEnd - zStart;

    if (depthZ > 3) {
      const rows = Math.max(3, Math.floor(depthZ / 0.9));
      const bw = Math.max(5.5, usableHalfW - cw / 2 - 2.5);
      const bxOffset = cw / 2 + 2.0 + bw / 2;
      const bzCenter = zStart + depthZ / 2;

      const specs = [
        { id: 'floor-nw', name: '内场北西VIP区', lx: -bxOffset, lz: -bzCenter, localFacingZ: 1 },
        { id: 'floor-ne', name: '内场北东VIP区', lx: bxOffset, lz: -bzCenter, localFacingZ: 1 },
        { id: 'floor-sw', name: '内场南西VIP区', lx: -bxOffset, lz: bzCenter, localFacingZ: -1 },
        { id: 'floor-se', name: '内场南东VIP区', lx: bxOffset, lz: bzCenter, localFacingZ: -1 }
      ];
      specs.forEach((sp) => {
        const wp = rotateXZ(sp.lx, sp.lz, st.rotFromSouthDeg);
        const fv = rotateXZ(0, sp.localFacingZ, st.rotFromSouthDeg);
        blocks.push({
          id: sp.id,
          name: sp.name,
          x: wp.x,
          z: wp.z,
          width: bw,
          depth: depthZ,
          rows,
          rowPitch: 0.9,
          seatSpacing: 0.52,
          rotDeg: st.rotFromSouthDeg,
          localFacingZ: sp.localFacingZ,
          facingX: fv.x,
          facingZ: fv.z,
          color: '#0EA5E9'
        });
      });
    }
    return blocks;
  }

  // End-stage or Festival-stage aligned strictly to st.orientationDeg
  const stageFrontZ = st.stageFrontLocalZ;
  const cl = st.catwalkLength;
  const cw = stage.catwalkWidth || 3.2;
  const catEndZ = stageFrontZ + cl;
  const fohZ = stage.fohEnabled ? st.fohLocalZ : (halfL + 100);
  const fohD = stage.fohDepth || 5;

  const alongPitchCrossW = (Math.abs(st.facingX) > Math.abs(st.facingZ))
    ? (infield.pitchLength || infield.length || 90)
    : (infield.pitchWidth || infield.width || 60);
  const sideSpanW = Math.min(usableHalfW - 1.5, Math.max(16, alongPitchCrossW * 0.44));

  const pushOrientedBlock = (id, name, lx, lz, bw, bd, rows, color) => {
    const wp = rotateXZ(lx, lz, st.rotFromSouthDeg);
    const fv = rotateXZ(0, -1, st.rotFromSouthDeg); // In stage-local space, seats face -Z (toward stage!)
    blocks.push({
      id,
      name,
      x: wp.x,
      z: wp.z,
      width: bw,
      depth: bd,
      rows,
      rowPitch: 0.88,
      seatSpacing: 0.5,
      rotDeg: st.rotFromSouthDeg,
      localFacingZ: -1,
      facingX: fv.x,
      facingZ: fv.z,
      color
    });
  };

  // Front VIP Pit flanking catwalk (A1, A2)
  const frontDepth = Math.max(0, Math.min(catEndZ, halfL - 2.5) - (stageFrontZ + 1.8));
  if (frontDepth > 3.5) {
    const bw = Math.max(6, sideSpanW - cw / 2 - 1.2);
    const bx = cw / 2 + 1.2 + bw / 2;
    const bz = stageFrontZ + 1.8 + frontDepth / 2;
    const rows = Math.max(4, Math.floor(frontDepth / 0.88));
    pushOrientedBlock('floor-a1', '内场前区 A1 (近T台)', -bx, bz, bw, frontDepth, rows, '#EC4899');
    pushOrientedBlock('floor-a2', '内场前区 A2 (近T台)', bx, bz, bw, frontDepth, rows, '#EC4899');
  }

  // Mid Floor flanking or ahead of FOH (B1, B2)
  const midStartZ = Math.max(stageFrontZ + 2.2, catEndZ + 2.0);
  const midEndZ = stage.fohEnabled ? Math.min(fohZ - fohD / 2 - 1.8, halfL - 2.5) : (halfL - 2.5);
  const midDepth = midEndZ - midStartZ;
  if (midDepth > 3.5) {
    const bw = Math.max(6, sideSpanW - 1.0);
    const bx = 1.0 + bw / 2;
    const bz = midStartZ + midDepth / 2;
    const rows = Math.max(4, Math.floor(midDepth / 0.88));
    pushOrientedBlock('floor-b1', '内场中区 B1', -bx, bz, bw, midDepth, rows, '#3B82F6');
    pushOrientedBlock('floor-b2', '内场中区 B2', bx, bz, bw, midDepth, rows, '#3B82F6');
  }

  // Rear Floor behind FOH (C1, C2)
  if (stage.fohEnabled) {
    const rearStartZ = fohZ + fohD / 2 + 1.8;
    const rearEndZ = halfL - 2.0;
    const rearDepth = rearEndZ - rearStartZ;
    if (rearDepth > 3.5) {
      const bw = Math.max(6, sideSpanW - 1.0);
      const bx = 1.0 + bw / 2;
      const bz = rearStartZ + rearDepth / 2;
      const rows = Math.max(4, Math.floor(rearDepth / 0.88));
      pushOrientedBlock('floor-c1', '内场后区 C1', -bx, bz, bw, rearDepth, rows, '#6366F1');
      pushOrientedBlock('floor-c2', '内场后区 C2', bx, bz, bw, rearDepth, rows, '#6366F1');
    }
  }

  return blocks;
}

/**
 * Finds the default East (90 deg) Tier 1 (1F) sector and selects Row 1.
 */
function findDefaultEastFirstRowSelection(venue) {
  const tierIndex = 0;
  const tier = (venue.standTiers && venue.standTiers[tierIndex]) || { sectors: [] };
  const activeSectors = (tier.sectors || []).filter(s => !s.isDeleted && s.fillType !== 'empty-void');

  let bestSector = activeSectors[0];
  let bestDist = 999;

  activeSectors.forEach((sec) => {
    // Check if 90 deg is inside [startAngleDeg, endAngleDeg]
    if (sec.startAngleDeg <= 90 && sec.endAngleDeg >= 90) {
      const mid = (sec.startAngleDeg + sec.endAngleDeg) / 2;
      const dist = Math.abs(mid - 90);
      if (dist < bestDist) {
        bestDist = dist;
        bestSector = sec;
      }
    } else {
      const mid = (sec.startAngleDeg + sec.endAngleDeg) / 2;
      const dist = Math.abs(mid - 90);
      if (dist < bestDist) {
        bestDist = dist;
        bestSector = sec;
      }
    }
  });

  return {
    tierIndex,
    sector: bestSector,
    row: 1,
    seatNo: 1,
    isModule: false,
    isFloorBlock: false
  };
}

/**
 * Computes exact 3D camera eye position, lookAt target, distance, and C-Value
 * for any selected stand sector, infield module, or concert floor block.
 */
function calculateSeatSightline(venue, selection, viewMode) {
  const infield = venue.infield;
  const stage = infield.stageConfig || {};
  const sightCfg = venue.sightlineConfig || {
    focalPointOffsetFromPitchEdge: 2,
    spectatorEyeHeight: 1.15,
    targetCValueMm: 90
  };

  let targetX = 0;
  let targetY = 1.5;
  let targetZ = 0;

  if (viewMode === 'concert' && stage) {
    const st = getStageTransform(venue);
    targetX = st.centerX;
    targetY = st.targetY;
    targetZ = st.centerZ;
  } else {
    targetX = 0;
    targetY = 0.8;
    targetZ = 0;
  }

  // Concert Infield Floor Block selection
  if (selection && selection.isFloorBlock && selection.floorBlock) {
    const blk = selection.floorBlock;
    const totalRows = blk.rows || 10;
    const rowIdx = Math.min(Math.max(1, selection.row || 1), totalRows);
    const localZ = -blk.depth / 2 + (rowIdx - 0.5) * (blk.depth / totalRows);
    const dirSign = (blk.localFacingZ === 1) ? -1 : 1;
    const offset = rotateXZ(0, dirSign * localZ, blk.rotDeg || 0);
    const eyeX = blk.x + offset.x;
    const eyeZ = blk.z + offset.z;
    const eyeY = sightCfg.spectatorEyeHeight || 1.15;

    const dx = targetX - eyeX;
    const dy = targetY - eyeY;
    const dz = targetZ - eyeZ;
    const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return {
      eye: { x: eyeX, y: eyeY, z: eyeZ },
      target: { x: targetX, y: targetY, z: targetZ },
      distanceM: Number(dist3D.toFixed(1)),
      elevationM: Number(eyeY.toFixed(1)),
      verticalAngleDeg: Number((Math.atan2(dy, Math.hypot(dx, dz)) * RAD2DEG).toFixed(1)),
      cValueMm: 95,
      cValueStatus: '内场近距离直视视野',
      row: rowIdx,
      maxRows: totalRows,
      seatNo: selection.seatNo || 8,
      sectorId: blk.id,
      sectorName: blk.name,
      tierLevel: 0,
      tierName: '内场平地坐席区',
      fillType: 'infield-floor',
      slopeDeg: 0,
      rowPitch: blk.rowPitch || 0.88,
      guardrailMaterial: '内场防爆铁马围栏'
    };
  }

  // Infield Module selection (e.g. Gongti sideline bench/seats)
  if (selection && selection.isModule && selection.module) {
    const mod = selection.module;
    const rowIdx = Math.min(Math.max(1, selection.row || 1), mod.rows || 4);
    const eyeY = (mod.baseElevation || 0) + (rowIdx - 1) * Math.sin((mod.slopeDeg || 0) * DEG2RAD) * (mod.rowPitch || 0.9) + (sightCfg.spectatorEyeHeight || 1.15);
    const eyeX = mod.x || 0;
    const eyeZ = mod.y || 0;
    const dx = targetX - eyeX;
    const dy = targetY - eyeY;
    const dz = targetZ - eyeZ;
    const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return {
      eye: { x: eyeX, y: eyeY, z: eyeZ },
      target: { x: targetX, y: targetY, z: targetZ },
      distanceM: Number(dist3D.toFixed(1)),
      elevationM: Number(eyeY.toFixed(1)),
      verticalAngleDeg: Number((Math.atan2(dy, Math.hypot(dx, dz)) * RAD2DEG).toFixed(1)),
      cValueMm: 125,
      cValueStatus: '优 (场边零距离视野)',
      row: rowIdx,
      maxRows: mod.rows || 4,
      seatNo: selection.seatNo || 12,
      sectorId: mod.id,
      sectorName: mod.name,
      tierLevel: 0,
      tierName: '内场专属坐席模块',
      fillType: 'infield-module',
      slopeDeg: mod.slopeDeg || 0,
      rowPitch: mod.rowPitch || 0.95,
      guardrailMaterial: '场边防撞护板'
    };
  }

  // Stand Tier Sector selection
  const tierIndex = selection ? (selection.tierIndex || 0) : 0;
  const tier = venue.standTiers[tierIndex] || venue.standTiers[0];
  const sector = (selection && selection.sector) || tier.sectors.find(s => !s.isDeleted && s.fillType !== 'empty-void') || tier.sectors[0];

  const isVipBox = (sector.fillType || tier.defaultFillType) === 'vip-box';
  const totalRows = sector.rows || tier.defaultRows || 22;
  const row = Math.min(Math.max(1, (selection && selection.row) || 1), totalRows);
  const rowPitch = sector.rowPitch || tier.defaultRowPitch || 0.85;
  const slopeDeg = isVipBox ? 0 : (sector.slopeDeg || tier.defaultSlopeDeg || 20);
  const riserHeight = isVipBox ? 0 : (sector.riserHeight || Number((rowPitch * Math.tan(slopeDeg * DEG2RAD)).toFixed(3)));

  const midAngleDeg = ((sector.startAngleDeg + sector.endAngleDeg) / 2) % 360;
  const rowFrac = totalRows > 1 ? (row - 0.5) / totalRows : 0.5;
  const seatPt = evalTierPoint(venue, tierIndex, midAngleDeg, rowFrac, sector.customRadialDepth);
  const seatElevation = (tier.baseElevation || 1.0) + (row - 1) * riserHeight;
  const eyeElevation = seatElevation + (sightCfg.spectatorEyeHeight || 1.15);

  const eyePos = { x: seatPt.x, y: eyeElevation, z: seatPt.z };
  const seatRadius = Math.hypot(seatPt.x, seatPt.z);
  const seatRayDeg = ((Math.atan2(seatPt.x, -seatPt.z) * RAD2DEG) + 360) % 360;

  const focalRadius = getRayRoundedRectDistance(seatRayDeg, infield.pitchLength || 68, infield.pitchWidth || 45, 4) - (sightCfg.focalPointOffsetFromPitchEdge || 2);
  const D = Math.max(8, seatRadius - Math.max(0, focalRadius));
  const R = Math.max(0.5, eyeElevation);
  const N = isVipBox ? 0.12 : riserHeight;
  const T = rowPitch;
  const cValueMeters = (D * (N + R)) / (D + T) - R;
  const cValueMm = Math.round(Math.max(15, Math.min(260, cValueMeters * 1000)));

  let cValueStatus = '极佳 (FIFA特级视野)';
  if (cValueMm < 60) {
    cValueStatus = '紧凑 (前排轻微遮挡)';
  } else if (cValueMm < (sightCfg.targetCValueMm || 90)) {
    cValueStatus = '良好 (标准合规视野)';
  }

  const dx = targetX - eyePos.x;
  const dy = targetY - eyePos.y;
  const dz = targetZ - eyePos.z;
  const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const horizDist = Math.hypot(dx, dz);
  const vertAngleDeg = Math.atan2(dy, horizDist) * RAD2DEG;

  const guardrailMatMap = {
    'tempered-glass': '超白钢化夹胶玻璃栏板',
    'steel-balustrade': '高强金属防坠护栏',
    'concrete-parapet': '清水混凝土结构胸墙'
  };
  const guardMat = (sector.guardrail && sector.guardrail.material) || (tier.defaultGuardrail && tier.defaultGuardrail.material) || 'tempered-glass';

  return {
    eye: eyePos,
    target: { x: targetX, y: targetY, z: targetZ },
    distanceM: Number(dist3D.toFixed(1)),
    elevationM: Number(eyeElevation.toFixed(1)),
    verticalAngleDeg: Number(vertAngleDeg.toFixed(1)),
    cValueMm,
    cValueStatus,
    row,
    maxRows: totalRows,
    seatNo: (selection && selection.seatNo) || 1,
    sectorId: sector.id,
    sectorName: sector.name,
    tierIndex,
    tierLevel: tier.level,
    tierName: tier.name,
    fillType: sector.fillType || tier.defaultFillType,
    vipBoxRooms: sector.vipBoxRooms || 0,
    slopeDeg,
    rowPitch,
    riserHeight,
    guardrailMaterial: tier.level === 1 ? '通透金属防坠栏杆' : (guardrailMatMap[guardMat] || guardMat),
    angleDeg: Number(midAngleDeg.toFixed(1))
  };
}

module.exports = {
  DEG2RAD,
  RAD2DEG,
  rotateXZ,
  evalInfieldPerimeterAndNormal,
  getInfieldCornerTransitionAngles,
  evalTierPoint,
  getRayRoundedRectDistance,
  computeTierRadialBounds,
  getRowInwardNormal,
  polarToWorld3D,
  computeRunningTrackSpec,
  getStageTransform,
  computeVomitoryAngularBounds,
  generateConcertInfieldBlocks,
  findDefaultEastFirstRowSelection,
  calculateSeatSightline
};
