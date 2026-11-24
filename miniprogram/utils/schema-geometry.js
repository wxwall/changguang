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
/**
 * Computes the maximum radial distance from (0,0) to the parallel-offset infield contour at offset d.
 * For rounded-rect infields, the corner diagonal is slightly farther from (0,0) than the straight end center,
 * so using this exact maximum guarantees a concentric-circle outer rim never inverts inside the inner edge.
 */
function computeMaxInfieldOffsetRadius(infield, offsetD) {
  const L = (infield && infield.length) || 105;
  const W = (infield && infield.width) || 68;
  const shape = (infield && infield.shape) || 'rounded-rect';
  const majorHalf = Math.max(L, W) / 2;
  const minorHalf = Math.min(L, W) / 2;
  const d = offsetD || 0;

  if (shape === 'ellipse') {
    return majorHalf + d;
  }
  const cR = Math.min((infield && infield.cornerRadius) || 15, minorHalf);
  const hx = Math.max(0, minorHalf - cR);
  const hz = Math.max(0, majorHalf - cR);
  return Math.hypot(hx, hz) + cR + d;
}

/**
 * Returns true if a stand tier uses concentric-circle morphing with a non-zero morph factor.
 * Such tiers keep constant physical rowPitch and constant slopeDeg around 360°, so as the outer
 * edge morphs toward a concentric circle, radial depth and row count naturally sweep from low at
 * the short ends to tall along the two long sides.
 */
function isConcentricMorphTier(tier) {
  return Boolean(tier && tier.morphMode === 'concentric-circle' && (tier.concentricMorph || 0) > 1e-4);
}

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
    if (isConcentricMorphTier(t)) {
      prevOuterMorph = Math.max(0, Math.min(1, t.concentricMorph || 0));
    } else {
      prevOuterMorph = 0;
    }
  }

  const tier = tiers[tierIndex] || tiers[0] || {};
  const dIn = cumulativeOffset + (tier.innerOffset || 0);
  const horizontalDepth = customRadialDepth !== undefined && customRadialDepth !== null
    ? Number(customRadialDepth)
    : (tier.radialDepth !== undefined && tier.radialDepth !== null ? Number(tier.radialDepth) : 20);
  const dOut = dIn + horizontalDepth;

  const innerMorph = prevOuterMorph;
  const outerMorph = isConcentricMorphTier(tier)
    ? Math.max(0, Math.min(1, tier.concentricMorph || 0))
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
    // Exact STADIACAD concentric-circle outer radius: expands 1:1 with radialDepth (dOut = dIn + horizontalDepth)
    const circOutR = majorHalfRadius + dOut;
    const circOutX = (rectOutX / rLenOut) * circOutR;
    const circOutZ = (rectOutZ / rLenOut) * circOutR;
    outX = rectOutX * (1 - outerMorph) + circOutX * outerMorph;
    outZ = rectOutZ * (1 - outerMorph) + circOutZ * outerMorph;

    // Defensive non-inversion guard for sharp corners with very small radialDepth
    const minGuard = Math.max(1.2, Math.min(horizontalDepth * 0.5, (tier.defaultRowPitch || 0.85) * 2));
    const projOut = (outX - inX) * p0.nx + (outZ - inZ) * p0.nz;
    if (projOut < minGuard) {
      const push = minGuard - projOut;
      outX += p0.nx * push;
      outZ += p0.nz * push;
    }
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
 * Returns the exact continuous row count at angleDeg for a tier.
 * - For standard infield-shape / VIP / solid-wall tiers: returns the fixed schema row count.
 * - For concentric-circle morphed tiers: returns depth(angleDeg) / rowPitch, reflecting the
 *   true constant-tread, constant-slope 3D sweeping bowl geometry.
 */
function getTierRowsAtAngleFloat(venue, tierIndex, tier, sec, angleDeg) {
  const fillType = (sec && sec.fillType) || (tier && tier.defaultFillType) || 'standard-seats';
  if (fillType === 'vip-box') return 1;
  const fallbackRows = (sec && sec.rows) || (tier && tier.defaultRows) || 22;
  if (!isConcentricMorphTier(tier) || fillType === 'solid-wall') {
    return fallbackRows;
  }
  const rowPitch = Math.max(0.4, (sec && sec.rowPitch) || (tier && tier.defaultRowPitch) || 0.85);
  const pt = evalTierPoint(venue, tierIndex, angleDeg, 0, sec && sec.customRadialDepth);
  const depthM = Math.hypot(pt.outX - pt.inX, pt.outZ - pt.inZ);
  return Math.max(2, depthM / rowPitch);
}

/**
 * Returns the integer seatable row count at angleDeg for a tier (requires >= 0.65 * rowPitch
 * tread depth on the topmost row so seats never overhang the circular outer rim).
 */
function getTierRowsAtAngle(venue, tierIndex, tier, sec, angleDeg) {
  const fillType = (sec && sec.fillType) || (tier && tier.defaultFillType) || 'standard-seats';
  if (fillType === 'vip-box') return 1;
  const fallbackRows = (sec && sec.rows) || (tier && tier.defaultRows) || 22;
  if (!isConcentricMorphTier(tier) || fillType === 'solid-wall') {
    return fallbackRows;
  }
  const floatRows = getTierRowsAtAngleFloat(venue, tierIndex, tier, sec, angleDeg);
  return Math.max(2, Math.floor(floatRows + 0.35));
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
    const rawCat = (stage.catwalkLength !== undefined && stage.catwalkLength !== null)
      ? Math.max(0, Number(stage.catwalkLength))
      : 10;
    const maxCat = Math.max(0, alongHalf - sd / 2 - 1.5);
    const maxCatX = Math.max(0, crossHalf - sw / 2 - 1.5);
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
      catwalkLength: Math.min(rawCat, maxCat),
      catwalkLengthX: Math.min(rawCat, maxCatX),
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

  const rawEndCat = (stage.catwalkLength !== undefined && stage.catwalkLength !== null)
    ? Math.max(0, Number(stage.catwalkLength))
    : 18;
  const maxCatwalk = Math.max(0, alongHalf - stageFrontLocalZ - 2.0);
  const catwalkLength = Math.min(rawEndCat, maxCatwalk);

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
  const sw = stage.width || 30;
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

  // Strictly use schema-defined infieldModules whenever present (supports center-stage 4-sided & end-stage layouts)
  const schemaModules = Array.isArray(venue.infieldModules) ? venue.infieldModules : [];
  if (schemaModules.length > 0) {
    schemaModules.forEach((mod, idx) => {
      const bx = Number(mod.x) || 0;
      const bz = Number(mod.z !== undefined ? mod.z : mod.y) || 0;
      const bw = Math.max(1, Number(mod.width) || 20);
      const bd = Math.max(1, Number(mod.depth) || 10);
      const rotDeg = Number(mod.rotationDeg) || 0;
      const rowPitch = Math.max(0.45, Number(mod.rowPitch) || 0.88);
      const rows = Math.max(1, Number(mod.rows) || Math.floor(bd / rowPitch));
      const seatSpacing = Math.max(0.4, Number(mod.seatSpacing) || 0.52);
      const baseElevation = Number(mod.baseElevation) || 0;
      const slopeDeg = Number(mod.slopeDeg) || 0;

      // Determine exact stage-facing direction along the block's local Z axis
      const uZ = rotateXZ(0, 1, rotDeg);
      const toStageX = st.centerX - bx;
      const toStageZ = st.centerZ - bz;
      const dot = toStageX * uZ.x + toStageZ * uZ.z;
      const localFacingZ = dot >= 0 ? 1 : -1;
      const facingX = uZ.x * localFacingZ;
      const facingZ = uZ.z * localFacingZ;

      blocks.push({
        id: mod.id || ('infield-mod-' + idx),
        name: mod.name || ('内场区 ' + (idx + 1)),
        x: bx,
        z: bz,
        width: bw,
        depth: bd,
        rows,
        rowPitch,
        seatSpacing,
        baseElevation,
        slopeDeg,
        aisleWidth: Number(mod.aisleWidth) || 1.6,
        rotDeg,
        localFacingZ,
        facingX,
        facingZ,
        color: mod.color || '#10B981',
        fromSchema: true
      });
    });
    fitBlocksToInfield();
    return blocks;
  }

  if (stage.type === 'center-stage') {
    const hasCatwalk = (st.catwalkLength || 0) > 0.5;
    if (!hasCatwalk) {
      // Four-sided cross layout facing each side of the center stage
      const gap = 3.5;
      const depthAlong = Math.max(0, halfL - sd / 2 - gap - 2.0);
      const depthCross = Math.max(0, usableHalfW - sw / 2 - gap - 2.0);
      const stX = st.stageLocalX || 0;
      const stZ = st.stageLocalZ || 0;

      if (depthAlong > 3.5) {
        const rowsA = Math.max(3, Math.floor(depthAlong / 0.88));
        const bwA = Math.min(sw + 6, usableHalfW * 1.4);
        const czOff = sd / 2 + gap + depthAlong / 2;
        [
          { id: 'floor-front', name: '四面台·正面观众席 A区', lx: 0, lz: czOff, rotOff: 0, lfZ: -1, col: '#10B981' },
          { id: 'floor-back', name: '四面台·背面观众席 B区', lx: 0, lz: -czOff, rotOff: 0, lfZ: 1, col: '#06B6D4' }
        ].forEach((sp) => {
          const wp = rotateXZ(stX + sp.lx, stZ + sp.lz, st.rotFromSouthDeg);
          const fv = rotateXZ(0, sp.lfZ, st.rotFromSouthDeg);
          blocks.push({
            id: sp.id, name: sp.name, x: wp.x, z: wp.z, width: bwA, depth: depthAlong,
            rows: rowsA, rowPitch: 0.88, seatSpacing: 0.52,
            rotDeg: st.rotFromSouthDeg + sp.rotOff, localFacingZ: sp.lfZ,
            facingX: fv.x, facingZ: fv.z, color: sp.col
          });
        });
      }
      if (depthCross > 3.5) {
        const rowsC = Math.max(3, Math.floor(depthCross / 0.88));
        const bwC = Math.min(sd + 4, halfL * 1.2);
        const cxOff = sw / 2 + gap + depthCross / 2;
        [
          { id: 'floor-left', name: '四面台·左侧观众席 C区', lx: cxOff, lz: 0, rotOff: 90, lfZ: 1, col: '#10B981' },
          { id: 'floor-right', name: '四面台·右侧观众席 D区', lx: -cxOff, lz: 0, rotOff: 270, lfZ: 1, col: '#06B6D4' }
        ].forEach((sp) => {
          const wp = rotateXZ(stX + sp.lx, stZ + sp.lz, st.rotFromSouthDeg);
          const uZ = rotateXZ(0, 1, st.rotFromSouthDeg + sp.rotOff);
          const dot = (st.centerX - wp.x) * uZ.x + (st.centerZ - wp.z) * uZ.z;
          const lfZ = dot >= 0 ? 1 : -1;
          blocks.push({
            id: sp.id, name: sp.name, x: wp.x, z: wp.z, width: bwC, depth: depthCross,
            rows: rowsC, rowPitch: 0.88, seatSpacing: 0.52,
            rotDeg: st.rotFromSouthDeg + sp.rotOff, localFacingZ: lfZ,
            facingX: uZ.x * lfZ, facingZ: uZ.z * lfZ, color: sp.col
          });
        });
      }
      fitBlocksToInfield();
      return blocks;
    }

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
 * 3D 马鞍形态设定已移除（避免与看台 morphMode / concentricMorph 同心圆融合度参数冲突）。
 * 保留兼容导出函数，恒返回禁用状态 / 原始排数。
 */
function getTierSaddleConfig() {
  return { enabled: false, amplitude: 0, invert: false, minRows: undefined };
}

function getTierSaddleDrop() {
  return 0;
}

function getSaddleOffset() {
  return 0;
}

function getEffectiveTierRows(tier, maxRows) {
  return maxRows;
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
    const rowPitch = blk.rowPitch || 0.88;
    const slopeDeg = blk.slopeDeg || 0;
    const baseElev = blk.baseElevation || 0;
    const floorElev = baseElev + (rowIdx - 1) * Math.sin(slopeDeg * DEG2RAD) * rowPitch;
    const eyeY = floorElev + (sightCfg.spectatorEyeHeight || 1.15);

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
      tierName: slopeDeg > 0 ? '内场阶梯坐席区' : '内场平地坐席区',
      fillType: 'infield-floor',
      slopeDeg,
      rowPitch,
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
  const tierIsConcentric = !isVipBox && isConcentricMorphTier(tier);
  const totalRows = isVipBox ? 1 : getTierRowsAtAngle(venue, tierIndex, tier, sector, midAngleDeg);
  const row = isVipBox ? 1 : Math.min(Math.max(1, (selection && selection.row) || 1), totalRows);

  let rowFrac = totalRows > 1 ? (row - 0.5) / totalRows : 0.5;
  if (isVipBox) {
    const vipEdge = evalTierPoint(venue, tierIndex, midAngleDeg, 0, sector.customRadialDepth);
    const vipDepth = Math.hypot(vipEdge.outX - vipEdge.inX, vipEdge.outZ - vipEdge.inZ);
    rowFrac = Math.max(0.08, Math.min(0.28, 0.9 / Math.max(1.5, vipDepth)));
  } else if (tierIsConcentric) {
    const midEdge = evalTierPoint(venue, tierIndex, midAngleDeg, 0, sector.customRadialDepth);
    const midDepth = Math.hypot(midEdge.outX - midEdge.inX, midEdge.outZ - midEdge.inZ);
    rowFrac = Math.max(0.02, Math.min(0.98, ((row - 0.5) * rowPitch) / Math.max(0.5, midDepth)));
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
  computeMaxInfieldOffsetRadius,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat,
  getTierRowsAtAngle,
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
