/**
 * STADIACAD 2.0.0 Geometry & Sightline Parametric Engine
 * Pure WeChat Mini Program JS module (Zero DOM/Web dependencies)
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Evaluates a point on a rounded-rectangle perimeter or concentric circle at angle thetaRad.
 * Angle convention: 0 deg = North (0, +Z in 2D top-down where Y_2D is North), clockwise.
 * Wait: Let's unify 2D and 3D coordinates:
 * In our 3D world:
 *   X = East (+) / West (-) [Width axis]
 *   Y = Elevation (+) [Height axis]
 *   Z = South (+) / North (-) [Length axis: North is -Z, South is +Z, so angle 0 deg = North (0, -1), 90 deg = East (+1, 0), 180 deg = South (0, +1), 270 deg = West (-1, 0)]
 */
function getRayRoundedRectDistance(angleDeg, length, width, cornerRadius) {
  const rad = angleDeg * DEG2RAD;
  const dx = Math.sin(rad);
  const dz = -Math.cos(rad); // 0 deg -> North (dz = -1)

  const halfW = width / 2;
  const halfL = length / 2;
  const r = Math.min(cornerRadius || 0, halfW, halfL);
  const innerW = Math.max(0, halfW - r);
  const innerL = Math.max(0, halfL - r);

  const adx = Math.abs(dx);
  const adz = Math.abs(dz);

  // Ray from origin (0,0) in direction (adx, adz) intersecting rounded rectangle in first quadrant
  // Check straight vertical wall x = halfW (for z in [0, innerL])
  if (adx > 1e-6) {
    const tWallX = halfW / adx;
    const zAtWall = tWallX * adz;
    if (zAtWall <= innerL + 1e-5) {
      return tWallX;
    }
  }

  // Check straight horizontal wall z = halfL (for x in [0, innerW])
  if (adz > 1e-6) {
    const tWallZ = halfL / adz;
    const xAtWall = tWallZ * adx;
    if (xAtWall <= innerW + 1e-5) {
      return tWallZ;
    }
  }

  // Otherwise intersects the corner circle centered at (innerW, innerL) with radius r
  // |(t * adx - innerW)^2 + (t * adz - innerL)^2| = r^2
  const b = -(adx * innerW + adz * innerL);
  const c = innerW * innerW + innerL * innerL - r * r;
  const disc = Math.max(0, b * b - c);
  return -b + Math.sqrt(disc);
}

/**
 * Computes the inner and outer radial distance of a tier at a given angleDeg,
 * respecting cumulative tier offsets, morphMode ('infield-shape' vs 'concentric-circle'),
 * and concentricMorph factor.
 */
function computeTierRadialBounds(venue, tierIndex, angleDeg, customRadialDepth) {
  const infield = venue.infield;
  const tiers = venue.standTiers;

  // Base infield boundary distance at this angle
  const infieldDist = getRayRoundedRectDistance(
    angleDeg,
    infield.length,
    infield.width,
    infield.cornerRadius
  );

  // Average radius of infield for concentric morphing
  const avgInfieldRadius = (infield.length + infield.width) / 4;

  // Accumulate radial offset up to tierIndex
  let cumulativeInfieldOffset = 0;
  for (let i = 0; i <= tierIndex; i++) {
    const t = tiers[i];
    cumulativeInfieldOffset += (t.innerOffset || 0);
    if (i < tierIndex) {
      // Previous tier's depth contribution (use default radialDepth * cos(slope))
      const prevSlopeRad = (t.defaultSlopeDeg || 20) * DEG2RAD;
      // Overlap factor: upper tiers in stadiums often cantilever slightly over lower tiers,
      // or step outward. Using 0.55 of radialDepth gives realistic multi-tier stadium footprint matching outermostFootprintLengthM!
      cumulativeInfieldOffset += (t.radialDepth || 20) * Math.cos(prevSlopeRad) * 0.55;
    }
  }

  const tier = tiers[tierIndex];
  const morph = tier.morphMode === 'concentric-circle' ? 1.0 : (tier.concentricMorph || 0);

  const shapeBaseInner = infieldDist + cumulativeInfieldOffset;
  const circleBaseInner = avgInfieldRadius + cumulativeInfieldOffset;
  const innerRadius = shapeBaseInner * (1 - morph) + circleBaseInner * morph;

  const slopeRad = (tier.defaultSlopeDeg || 20) * DEG2RAD;
  const rawDepth = customRadialDepth || tier.radialDepth || 20;
  // Horizontal plan projection of radialDepth
  const horizontalDepth = rawDepth * Math.cos(slopeRad);

  return {
    innerRadius,
    outerRadius: innerRadius + horizontalDepth,
    horizontalDepth,
    rawDepth
  };
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
 * Computes exact 3D camera eye position, lookAt target, distance, and architectural C-Value
 * for any selected sector, row (1..rows), and seat ratio (0..1) or infield module.
 */
function calculateSeatSightline(venue, selection, viewMode) {
  const infield = venue.infield;
  const stage = infield.stageConfig || {};
  const sightCfg = venue.sightlineConfig || {
    focalPointOffsetFromPitchEdge: 2,
    spectatorEyeHeight: 1.15,
    targetCValueMm: 90
  };

  // Determine stage / pitch focal point in 3D
  let targetX = 0;
  let targetY = 1.5;
  let targetZ = 0;

  if (viewMode === 'concert' && stage) {
    const orientRad = (stage.orientationDeg || 0) * DEG2RAD;
    if (stage.type === 'center-stage') {
      targetX = 0;
      targetY = (stage.height || 1.8) + 1.6; // Singer eye level on center stage
      targetZ = 0;
    } else {
      // End stage or festival stage placed near one end of the pitch
      // orientationDeg: 90 -> facing East or West; 180 -> placed at North facing South
      const offsetDist = (infield.pitchLength || 100) * 0.36;
      targetX = -Math.sin(orientRad) * offsetDist;
      targetZ = Math.cos(orientRad) * offsetDist;
      targetY = (stage.height || 2.0) + 2.2;
    }
  } else {
    // Sports mode: look at center of pitch or nearest action point
    targetX = 0;
    targetY = 0.8;
    targetZ = 0;
  }

  // If selection is an infield module
  if (selection && selection.isModule && selection.module) {
    const mod = selection.module;
    const rowIdx = Math.min(Math.max(1, selection.row || 2), mod.rows || 4);
    const eyeY = (mod.baseElevation || 0) + (rowIdx - 1) * Math.sin((mod.slopeDeg || 0) * DEG2RAD) * (mod.rowPitch || 0.9) + sightCfg.spectatorEyeHeight;
    // Module x, y in schema map to X, Z in 3D
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
      verticalAngleDeg: Number((Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * RAD2DEG).toFixed(1)),
      cValueMm: 125,
      cValueStatus: '优 (全景无遮挡)',
      row: rowIdx,
      maxRows: mod.rows || 4,
      seatNo: selection.seatNo || 12,
      sectorName: mod.name,
      tierName: '内场专属坐席模块',
      fillType: 'infield-module',
      guardrailMaterial: 'none'
    };
  }

  // Stand Tier Sector selection
  const tierIndex = selection ? (selection.tierIndex || 0) : 0;
  const tier = venue.standTiers[tierIndex] || venue.standTiers[0];
  const sector = (selection && selection.sector) || tier.sectors.find(s => !s.isDeleted && s.fillType !== 'empty-void') || tier.sectors[0];

  const totalRows = sector.rows || tier.defaultRows || 25;
  const row = Math.min(Math.max(1, (selection && selection.row) || Math.ceil(totalRows * 0.45)), totalRows);
  const rowPitch = sector.rowPitch || tier.defaultRowPitch || 0.85;
  const slopeDeg = sector.slopeDeg || tier.defaultSlopeDeg || 20;
  const riserHeight = sector.riserHeight || Number((rowPitch * Math.tan(slopeDeg * DEG2RAD)).toFixed(3));

  const midAngleDeg = ((sector.startAngleDeg + sector.endAngleDeg) / 2) % 360;
  const bounds = computeTierRadialBounds(venue, tierIndex, midAngleDeg, sector.customRadialDepth);

  // Horizontal radial distance for this row
  const rowHorizontalOffset = (row - 1) * rowPitch;
  const seatRadius = bounds.innerRadius + Math.min(rowHorizontalOffset, bounds.horizontalDepth);
  const seatElevation = (tier.baseElevation || 1.0) + (row - 1) * riserHeight;
  const eyeElevation = seatElevation + (sightCfg.spectatorEyeHeight || 1.15);

  const eyePos = polarToWorld3D(midAngleDeg, seatRadius, eyeElevation);

  // Calculate architectural C-Value (sightline clearance over spectator in row-1)
  // Formula: C = D * (N + R) / (D + T) - R, where:
  //   D = horizontal distance from eye to focal point
  //   N = riserHeight
  //   T = rowPitch (tread depth)
  //   R = height of eye above focal point
  const focalRadius = getRayRoundedRectDistance(midAngleDeg, infield.pitchLength || 68, infield.pitchWidth || 45, 4) - (sightCfg.focalPointOffsetFromPitchEdge || 2);
  const D = Math.max(8, seatRadius - Math.max(0, focalRadius));
  const R = Math.max(0.5, eyeElevation);
  const N = riserHeight;
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
  const horizDist = Math.sqrt(dx * dx + dz * dz);
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
    seatNo: (selection && selection.seatNo) || 16,
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
    guardrailMaterial: guardrailMatMap[guardMat] || guardMat,
    angleDeg: Number(midAngleDeg.toFixed(1))
  };
}

module.exports = {
  DEG2RAD,
  RAD2DEG,
  getRayRoundedRectDistance,
  computeTierRadialBounds,
  polarToWorld3D,
  calculateSeatSightline
};
