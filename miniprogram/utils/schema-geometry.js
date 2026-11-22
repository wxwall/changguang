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
 * Evaluates a point on the infield perimeter AND its true outward unit normal
 * at angleDeg (polar ray from center). Supports rounded-rect and ellipse infields.
 * Angle convention:
 *   0 deg = North (0, -1 in 3D/2D)
 *  90 deg = East  (+1, 0)
 * 180 deg = South (0, +1)
 * 270 deg = West  (-1, 0)
 */
function evalInfieldPerimeterAndNormal(angleDeg, length, width, cornerRadius, shape) {
  const rad = angleDeg * DEG2RAD;
  const dx = Math.sin(rad);
  const dz = -Math.cos(rad);

  if (shape === 'ellipse') {
    // length is the north-south axis, width the east-west axis
    const a = Math.max(1e-3, length / 2);
    const b = Math.max(1e-3, width / 2);
    const t = 1 / Math.sqrt((dx * dx) / (b * b) + (dz * dz) / (a * a));
    const x = dx * t;
    const z = dz * t;
    let nx = x / (b * b);
    let nz = z / (a * a);
    const nLen = Math.hypot(nx, nz) || 1;
    nx /= nLen;
    nz /= nLen;
    return { x, z, nx, nz, dist: t };
  }

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
 * Evaluates the radial distance from (0,0) to the infield perimeter at angleDeg.
 */
function getRayRoundedRectDistance(angleDeg, length, width, cornerRadius, shape) {
  return evalInfieldPerimeterAndNormal(angleDeg, length, width, cornerRadius, shape).dist;
}

/**
 * Returns the polar angles (sorted 0..360) where the rounded-rectangle perimeter
 * transitions between straight edges and corner arcs. Ellipse perimeters are
 * curved everywhere, so they return no transition angles.
 * Injecting these angles into polygon/row polylines keeps straight walls completely flat
 * and seamless at corners.
 */
function getInfieldCornerTransitionAngles(venue) {
  const infield = venue && venue.infield;
  if (!infield) return [];
  if (infield.shape === 'ellipse') return [];
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
  const v = venue || {};
  const infield = v.infield || { length: 105, width: 68, cornerRadius: 15, shape: 'rounded-rect' };
  const tiers = Array.isArray(v.standTiers) ? v.standTiers : [];
  const p0 = evalInfieldPerimeterAndNormal(
    angleDeg,
    infield.length || 105,
    infield.width || 68,
    infield.cornerRadius || 15,
    infield.shape || 'rounded-rect'
  );

  const majorHalfRadius = Math.max(infield.length || 105, infield.width || 68) / 2;

  let cumulativeOffset = 0;
  let prevOuterMorph = 0;
  for (let i = 0; i < tierIndex; i++) {
    const t = tiers[i] || {};
    cumulativeOffset += (t.innerOffset || 0) + (t.radialDepth || 20);
    if (t.morphMode === 'concentric-circle') {
      prevOuterMorph = t.concentricMorph || 0;
    } else {
      prevOuterMorph = 0;
    }
  }

  const tier = tiers[tierIndex] || tiers[0] || {};
  const dIn = cumulativeOffset + (tier.innerOffset || 0);

  const saddleCfg = getTierSaddleConfig(tier, v);
  const isSaddle = saddleCfg.enabled;
  let horizontalDepth = customRadialDepth || tier.radialDepth || 20;
  if (isSaddle && !customRadialDepth) {
    const rowPitch = tier.defaultRowPitch || 0.85;
    const slopeDeg = tier.defaultSlopeDeg || 28;
    const riserH = tier.defaultRiserHeight || (rowPitch * Math.tan(slopeDeg * DEG2RAD));
    const maxRows = tier.defaultRows || 38;
    const effRows = getEffectiveTierRows(tier, maxRows, angleDeg, riserH, v);
    horizontalDepth = effRows * rowPitch;
  }
  const dOut = dIn + horizontalDepth;

  const innerMorph = prevOuterMorph;
  const outerMorph = (!isSaddle && tier.morphMode === 'concentric-circle')
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
  if (isSaddle) {
    // For 3D saddle stand: horizontal depth extends outward along the normal by exactly (effRows * rowPitch)
    // guaranteeing 100% uniform step tread width and identical slope all around the bowl
    let ux = p0.nx, uz = p0.nz;
    if (innerMorph > 1e-6) {
      const rLenIn = Math.hypot(inX, inZ) || 1;
      ux = inX / rLenIn;
      uz = inZ / rLenIn;
    }
    outX = inX + horizontalDepth * ux;
    outZ = inZ + horizontalDepth * uz;
  } else if (outerMorph > 1e-6) {
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
  const pitchLength = (infield && infield.pitchLength) || 105;
  const pitchWidth = (infield && infield.pitchWidth) || 68;

  // Compute running track OUTWARD along the pitch perimeter (NOT inward from outer infield wall)
  const laneWidth = (infield && infield.trackLaneWidth) ? Number(infield.trackLaneWidth) : 1.22;
  const innerSideGap = (infield && infield.trackInnerMargin !== undefined && infield.trackInnerMargin !== null)
    ? Math.max(0.5, Number(infield.trackInnerMargin))
    : Number(Math.min(2.5, Math.max(1.0, (width - pitchWidth) * 0.05)).toFixed(3));

  const innerApronWidth = Number((pitchWidth + innerSideGap * 2).toFixed(3));
  const innerApronCornerRadius = Number(Math.max(4, innerApronWidth / 2).toFixed(3));

  const maxTrackBandW = Math.max(laneWidth * 2, (width - innerApronWidth) / 2 - 2.0);
  const maxTrackBandL = Math.max(laneWidth * 2, (length - (pitchLength + innerSideGap * 2)) / 2 - 2.0);
  const maxTrackBand = Math.min(maxTrackBandW, maxTrackBandL);

  const lanes = (infield && infield.trackLanes)
    ? Math.max(1, Math.min(12, Math.round(Number(infield.trackLanes))))
    : Math.max(4, Math.min(9, Math.floor(maxTrackBand / laneWidth)));

  const trackBandWidth = Number(Math.min(maxTrackBand + 1.0, lanes * laneWidth).toFixed(3));

  const desiredInnerLen = Math.max(pitchLength + innerSideGap * 2, pitchLength + innerApronCornerRadius * 1.44);
  const maxInnerLen = Math.max(pitchLength + innerSideGap * 2, length - trackBandWidth * 2 - 3.0);
  const innerApronLength = Number(Math.min(desiredInnerLen, maxInnerLen).toFixed(3));

  const outerTrackWidth = Number((innerApronWidth + trackBandWidth * 2).toFixed(3));
  const outerTrackLength = Number((innerApronLength + trackBandWidth * 2).toFixed(3));
  const outerTrackCornerRadius = Number(Math.min(outerTrackWidth / 2, innerApronCornerRadius + trackBandWidth).toFixed(3));

  return {
    lanes,
    laneWidth,
    trackBandWidth,
    innerSideGap,
    outerTrackWidth,
    outerTrackLength,
    outerTrackCornerRadius,
    innerApronWidth,
    innerApronLength,
    innerApronCornerRadius
  };
}

/**
 * Converts a STADIACAD-exported venue into the renderer's world frame.
 * The export stores plan coordinates as X=infield long axis, Y=short axis,
 * while the engine uses X=short axis, Z=long axis.
 * Apply exactly once per venue at load time: worldX = y, worldZ = -x, rotationDeg += 90.
 */
function normalizeVenueCoordinates(venue) {
  if (!venue) return venue;

  const infield = venue.infield;
  const srcStage = infield && infield.stageConfig;
  let nextInfield = infield;

  if (srcStage && (srcStage.x !== undefined || srcStage.y !== undefined || srcStage.z !== undefined)) {
    const dx = Number(srcStage.x) || 0;
    const dy = Number(srcStage.y !== undefined ? srcStage.y : srcStage.z) || 0;
    const nextStage = Object.assign({}, srcStage, { x: dy, z: -dx });
    delete nextStage.y;
    nextInfield = Object.assign({}, infield, { stageConfig: nextStage });
  }

  const nextModules = (venue.infieldModules || []).map((mod) => {
    const next = Object.assign({}, mod);
    if (mod.x !== undefined || mod.y !== undefined) {
      next.x = Number(mod.y) || 0;
      next.y = -(Number(mod.x) || 0);
    }
    if (mod.rotationDeg !== undefined) {
      next.rotationDeg = ((Number(mod.rotationDeg) || 0) + 90) % 360;
    }
    return next;
  });

  return Object.assign({}, venue, {
    infield: nextInfield,
    infieldModules: nextModules
  });
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

  const lenM = infield.length || 100;
  const widM = infield.width || 60;
  const radM = infield.cornerRadius || 10;

  const frontPerimeter = evalInfieldPerimeterAndNormal(oriDeg, lenM, widM, radM, infield.shape).dist;
  const backPerimeter = evalInfieldPerimeterAndNormal(oriDeg + 180, lenM, widM, radM, infield.shape).dist;
  const alongHalf = Math.max(12, frontPerimeter - 3.0);
  const crossHalf = Math.max(
    10,
    evalInfieldPerimeterAndNormal(oriDeg + 90, lenM, widM, radM, infield.shape).dist - 3.0
  );

  const sw = stage.width || 30;
  const sd = stage.depth || 20;
  const sh = stage.height || 2.0;

  if (stage.type === 'center-stage') {
    let cx = 0;
    let cz = 0;
    if (stage.x !== undefined && (stage.y !== undefined || stage.z !== undefined)) {
      cx = Number(stage.x) || 0;
      cz = Number(stage.z !== undefined ? stage.z : stage.y) || 0;
    }
    const localCenter = rotateXZ(cx, cz, -rotFromSouthDeg);
    const maxCat = Math.max(2, alongHalf - sd / 2 - 1.5);
    const maxCatX = Math.max(2, crossHalf - sw / 2 - 1.5);
    return {
      type: 'center-stage',
      orientationDeg: oriDeg,
      rotFromSouthDeg,
      facingX,
      facingZ,
      alongHalf,
      crossHalf,
      stageLocalZ: localCenter.z,
      stageLocalX: localCenter.x,
      centerX: cx,
      centerZ: cz,
      targetY: sh + 1.6,
      catwalkLength: Math.min(stage.catwalkLength || 10, maxCat),
      catwalkLengthX: Math.min(stage.catwalkLength || 10, maxCatX),
      fohLocalZ: localCenter.z + Math.min(stage.fohDistance || 18, Math.max(4, alongHalf - 3))
    };
  }

  // Compute exact longitudinal center along stage axis strictly from schema stageConfig
  let stageLocalZ = 0;
  let stageLocalX = 0;

  if (stage.x !== undefined && (stage.y !== undefined || stage.z !== undefined)) {
    const wx = Number(stage.x) || 0;
    const wz = Number(stage.z !== undefined ? stage.z : stage.y) || 0;
    const lp = rotateXZ(wx, wz, -rotFromSouthDeg);
    stageLocalX = lp.x;
    stageLocalZ = lp.z;
  } else if (stage.distanceFromCenter !== undefined && stage.distanceFromCenter !== null) {
    stageLocalZ = -Number(stage.distanceFromCenter);
  } else if (stage.offsetM !== undefined && stage.offsetM !== null) {
    stageLocalZ = -Number(stage.offsetM);
  } else {
    // End-Stage / Festival-Stage: place back of stage cleanly at back infield boundary
    // (accounting for corner curvature across half stage width so rear corners stay inside infield)
    const backClearance = (stage.backClearance !== undefined && stage.backClearance !== null)
      ? Number(stage.backClearance)
      : 3.5;
    let safeBackEdge = backPerimeter - backClearance;
    const cornerPullback = Math.max(0, radM - Math.sqrt(Math.max(0, radM * radM - Math.pow(Math.max(0, sw * 0.45 - Math.max(0, crossHalf - radM)), 2))));
    safeBackEdge = Math.max(sd / 2 + 2, safeBackEdge - cornerPullback * 0.5);
    stageLocalZ = -(safeBackEdge - sd / 2);
  }

  const stageFrontLocalZ = stageLocalZ + sd / 2;

  const maxCatwalk = Math.max(4, alongHalf - stageFrontLocalZ - 2.0);
  const catwalkLength = Math.min(stage.catwalkLength || 18, maxCatwalk);

  const fohD = stage.fohDepth || 5;
  const maxFohDist = Math.max(catwalkLength + 4, alongHalf - stageFrontLocalZ - fohD / 2 - 1.5);
  const fohDist = Math.min(stage.fohDistance || 38, maxFohDist);
  const fohLocalZ = stageFrontLocalZ + fohDist;

  const centerWorld = rotateXZ(stageLocalX, stageLocalZ, rotFromSouthDeg);
  return {
    type: stage.type || 'end-stage',
    orientationDeg: oriDeg,
    rotFromSouthDeg,
    facingX,
    facingZ,
    alongHalf,
    crossHalf,
    stageLocalX,
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

  // 收缩区块进深，直到四角落在内场周界内（椭圆内场尤其需要）
  const fitBlocksToInfield = () => {
    const a = (infield.length || 100) / 2;
    const b = (infield.width || 60) / 2;
    const isInside = (x, z) => {
      if (infield.shape === 'ellipse') {
        return (x * x) / (b * b) + (z * z) / (a * a) <= 1.0001;
      }
      const radius = Math.hypot(x, z);
      const ang = ((Math.atan2(x, -z) * RAD2DEG) + 360) % 360;
      const boundary = getRayRoundedRectDistance(ang, infield.length, infield.width, infield.cornerRadius, infield.shape);
      return radius <= boundary + 0.01;
    };
    blocks.forEach((blk) => {
      for (let iter = 0; iter < 24; iter++) {
        const hw = blk.width / 2;
        const hd = blk.depth / 2;
        const allInside = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].every(([lx, lz]) => {
          const rp = rotateXZ(lx, lz, blk.rotDeg || 0);
          return isInside(blk.x + rp.x, blk.z + rp.z);
        });
        if (allInside) break;
        blk.depth *= 0.94;
        blk.rows = Math.max(3, Math.floor(blk.depth / 0.88));
        if (blk.depth < 4) break;
      }
    });
  };

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
        const wp = rotateXZ((st.stageLocalX || 0) + sp.lx, (st.stageLocalZ || 0) + sp.lz, st.rotFromSouthDeg);
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
    fitBlocksToInfield();
    return blocks;
  }

  // End-stage or Festival-stage aligned strictly to st.orientationDeg
  const stageX = st.stageLocalX || 0;
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
    const wp = rotateXZ(stageX + lx, lz, st.rotFromSouthDeg);
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

  fitBlocksToInfield();
  return blocks;
}

/**
 * Finds the default East (90 deg) Tier 1 (1F) sector and selects Row 1.
 */
function findDefaultEastFirstRowSelection(venue) {
  const tierIndex = 0;
  const tier = (venue.standTiers && venue.standTiers[tierIndex]) || { sectors: [] };
  const activeSectors = (tier.sectors || []).filter(
    s => !s.isDeleted && s.fillType !== 'empty-void' && s.fillType !== 'solid-wall'
  );

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
 * 解析看台楼层的马鞍形态 3D 标高起伏配置
 * 参数：
 * - saddleEnabled: 是否启用马鞍形态标高起伏 (boolean)
 * - saddleAmplitude: 马鞍起伏落差波幅，米 (number)
 * - saddleInvert: 起伏波形方向：false=两侧长边高 / true=两端球门高 (boolean)
 */
function getTierSaddleConfig(tier, venue) {
  if (!tier || typeof tier !== 'object') {
    return { enabled: false, amplitude: 0, invert: false };
  }

  // 1. saddleAmplitude (波幅落差，米)
  const ampRaw = tier.saddleAmplitude !== undefined ? tier.saddleAmplitude :
                 tier['马鞍起伏落差波幅'] !== undefined ? tier['马鞍起伏落差波幅'] :
                 tier['马鞍波幅落差'] !== undefined ? tier['马鞍波幅落差'] :
                 tier['马鞍落差'] !== undefined ? tier['马鞍落差'] :
                 tier['波幅落差'] !== undefined ? tier['波幅落差'] :
                 tier.saddleWaveAmplitude !== undefined ? tier.saddleWaveAmplitude :
                 tier.saddleDrop !== undefined ? tier.saddleDrop :
                 tier.saddleWaveDrop !== undefined ? tier.saddleWaveDrop :
                 tier.saddleElevationDrop !== undefined ? tier.saddleElevationDrop :
                 tier.saddleHeightDrop !== undefined ? tier.saddleHeightDrop :
                 tier.saddleAmplitudeDrop !== undefined ? tier.saddleAmplitudeDrop :
                 tier.saddleDelta !== undefined ? tier.saddleDelta : undefined;

  let amplitude = 0;
  if (ampRaw !== undefined && ampRaw !== null) {
    const num = Number(ampRaw);
    if (!isNaN(num)) amplitude = Math.max(0, num);
  }

  // 2. saddleEnabled (是否启用)
  const enabledRaw = tier.saddleEnabled !== undefined ? tier.saddleEnabled :
                     tier['是否启用马鞍形态标高起伏'] !== undefined ? tier['是否启用马鞍形态标高起伏'] :
                     tier['启用马鞍'] !== undefined ? tier['启用马鞍'] :
                     tier['马鞍启用'] !== undefined ? tier['马鞍启用'] : undefined;

  let enabled = false;
  if (enabledRaw !== undefined && enabledRaw !== null) {
    enabled = Boolean(enabledRaw && enabledRaw !== 'false' && enabledRaw !== '0');
  } else if (amplitude > 0) {
    // 若显式配置了波幅且大于0，默认启用
    enabled = true;
  }

  // 3. saddleInvert (波形方向：false=两侧长边高 / true=两端球门高)
  const invertRaw = tier.saddleInvert !== undefined ? tier.saddleInvert :
                    tier['起伏波形方向'] !== undefined ? tier['起伏波形方向'] :
                    tier['波形反转'] !== undefined ? tier['波形反转'] :
                    tier['两端球门高'] !== undefined ? tier['两端球门高'] : undefined;

  let invert = false;
  if (invertRaw !== undefined && invertRaw !== null) {
    if (typeof invertRaw === 'string') {
      const s = invertRaw.trim().toLowerCase();
      invert = s === 'true' || s === '1' || s === 'goals' || s === 'ends' || s.includes('球门');
    } else {
      invert = Boolean(invertRaw);
    }
  }

  // 4. 大型体育场（含鸟巢 3F）马鞍形看台深落差规范：
  //    两侧长边保持满排高耸轮廓，两端球门大幅顺滑跌落至 3 排（落差约为整层总升高的 94%，~20m 跨度）
  const isBirdNest = venue && (
    venue.code === 'BJ-NST-2008-01' ||
    String(venue.id || '').indexOf('bird-nest') >= 0 ||
    String(venue.name || '').indexOf('鸟巢') >= 0
  );
  if (isBirdNest && tier.level === 3 && !enabled && enabledRaw === undefined) {
    enabled = true;
  }

  const maxRows = tier.defaultRows || 38;
  const rowPitch = tier.defaultRowPitch || 0.85;
  const slopeDeg = tier.defaultSlopeDeg || 34;
  const riserH = tier.defaultRiserHeight || (rowPitch * Math.tan(slopeDeg * DEG2RAD));
  const tierFullRise = Math.max(0, (maxRows - 1) * riserH);
  const infieldMaxDim = venue && venue.infield
    ? Math.max(venue.infield.length || 0, venue.infield.width || 0)
    : 0;
  const isLargeStadium = isBirdNest || infieldMaxDim >= 150 || maxRows >= 28;

  if (enabled && isLargeStadium && tierFullRise > 8) {
    // 若配置落差偏小（例如旧版 8.5m / 13.8m），自动放大至大球场深马鞍落差（约整层总升高的 94%）
    const targetDeepAmp = Number((tierFullRise * 0.94).toFixed(2));
    if (amplitude < targetDeepAmp) {
      amplitude = targetDeepAmp;
    }
  }

  const rawMinRows = tier.saddleMinRows !== undefined ? Number(tier.saddleMinRows) :
                     tier.minRows !== undefined ? Number(tier.minRows) : undefined;
  let minRows = rawMinRows;
  if (enabled && isLargeStadium) {
    // 大球场波谷最低排数压低至 3 排（若历史数据写入了 >= 8 的旧保守值如 14 排，也统一收至 3 排以呈现大落差）
    if (minRows === undefined || !Number.isFinite(minRows) || minRows >= 8) {
      minRows = 3;
    }
  }

  return {
    enabled: enabled && amplitude > 0,
    amplitude: enabled ? amplitude : 0,
    invert,
    minRows
  };
}

/**
 * 获取看台楼层的马鞍波幅落差 (米)
 */
function getTierSaddleDrop(tier, venue) {
  const cfg = getTierSaddleConfig(tier, venue);
  return cfg.enabled ? cfg.amplitude : 0;
}

/**
 * 计算指定极角下的马鞍标高增量 (米)
 * - 当 saddleInvert = false (默认)：两侧长边高 (90°/270°)，两端球门低 (0°/180°)
 *   增量 = sin²(θ) * amplitude
 * - 当 saddleInvert = true：两端球门高 (0°/180°)，两侧长边低 (90°/270°)
 *   增量 = cos²(θ) * amplitude
 */
function getSaddleOffset(tier, angleDeg, venue) {
  const cfg = getTierSaddleConfig(tier, venue);
  if (!cfg.enabled || cfg.amplitude < 1e-4) return 0;
  const rad = (angleDeg || 0) * DEG2RAD;
  if (cfg.invert) {
    const c = Math.cos(rad);
    return c * c * cfg.amplitude;
  } else {
    const s = Math.sin(rad);
    return s * s * cfg.amplitude;
  }
}

/**
 * 计算看台在指定角度下的实际有效排数（向低处扣减排数）
 * 最高处保持 maxRows，波谷扣减 dropRows = round((amplitude - saddleOffset) / riserH)
 */
function getEffectiveTierRows(tier, maxRows, angleDeg, riserH, venue) {
  const cfg = getTierSaddleConfig(tier, venue);
  if (!cfg.enabled || cfg.amplitude < 1e-4 || !riserH || riserH <= 0.01) {
    return maxRows;
  }
  const sad = getSaddleOffset(tier, angleDeg, venue);
  const dropH = Math.max(0, cfg.amplitude - sad);
  const dropRows = Math.round(dropH / riserH);
  const minLimit = cfg.minRows !== undefined ? cfg.minRows : 4;
  return Math.max(minLimit, maxRows - dropRows);
}

/**
 * Computes exact 3D camera eye position, lookAt target, distance, and C-Value
 * for any selected stand sector, infield module, or concert floor block.
 */
function calculateSeatSightline(venue, selection, viewMode) {
  const v = venue || {};
  const infield = v.infield || {};
  const stage = infield.stageConfig || {};
  const sightCfg = v.sightlineConfig || {
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
  const standTiers = (venue && Array.isArray(venue.standTiers)) ? venue.standTiers : [];
  const tier = standTiers[tierIndex] || standTiers[0] || { sectors: [] };
  const sectors = (tier && Array.isArray(tier.sectors)) ? tier.sectors : [];
  const sector = (selection && selection.sector) || sectors.find(
    s => !s.isDeleted && s.fillType !== 'empty-void' && s.fillType !== 'solid-wall'
  ) || sectors[0] || { startAngleDeg: 0, endAngleDeg: 18, rows: 20, name: '1F-A' };

  const isVipBox = (sector.fillType || tier.defaultFillType) === 'vip-box';
  const rowPitch = sector.rowPitch || tier.defaultRowPitch || 0.85;
  const slopeDeg = isVipBox ? 0 : (sector.slopeDeg || tier.defaultSlopeDeg || 20);
  const riserHeight = isVipBox ? 0 : (sector.riserHeight || Number((rowPitch * Math.tan(slopeDeg * DEG2RAD)).toFixed(3)));

  const midAngleDeg = ((sector.startAngleDeg + sector.endAngleDeg) / 2) % 360;
  const rawMaxRows = isVipBox ? 1 : (sector.rows || tier.defaultRows || 22);
  const totalRows = isVipBox ? 1 : getEffectiveTierRows(tier, rawMaxRows, midAngleDeg, riserHeight, venue);
  const row = isVipBox ? 1 : Math.min(Math.max(1, (selection && selection.row) || 1), totalRows);

  let rowFrac = totalRows > 1 ? (row - 0.5) / totalRows : 0.5;
  if (isVipBox) {
    const vipEdge = evalTierPoint(venue, tierIndex, midAngleDeg, 0, sector.customRadialDepth);
    const vipDepth = Math.hypot(vipEdge.outX - vipEdge.inX, vipEdge.outZ - vipEdge.inZ);
    rowFrac = Math.max(0.08, Math.min(0.28, 0.9 / Math.max(1.5, vipDepth)));
  }
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
  normalizeVenueCoordinates,
  getStageTransform,
  computeVomitoryAngularBounds,
  generateConcertInfieldBlocks,
  findDefaultEastFirstRowSelection,
  calculateSeatSightline,
  getTierSaddleConfig,
  getTierSaddleDrop,
  getSaddleOffset,
  getEffectiveTierRows
};
