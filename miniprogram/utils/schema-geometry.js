/**
 * STADIACAD 2.0.0 Geometry, Infield Floor & Sightline Parametric Engine
 * Pure WeChat Mini Program JS module (Zero DOM/Web dependencies)
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Evaluates a point on a rounded-rectangle perimeter at angleDeg.
 * Angle convention:
 *   0 deg = North (0, -1 in 3D/2D)
 *  90 deg = East  (+1, 0)
 * 180 deg = South (0, +1)
 * 270 deg = West  (-1, 0)
 */
function getRayRoundedRectDistance(angleDeg, length, width, cornerRadius) {
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

  if (adx > 1e-6) {
    const tWallX = halfW / adx;
    const zAtWall = tWallX * adz;
    if (zAtWall <= innerL + 1e-5) {
      return tWallX;
    }
  }

  if (adz > 1e-6) {
    const tWallZ = halfL / adz;
    const xAtWall = tWallZ * adx;
    if (xAtWall <= innerW + 1e-5) {
      return tWallZ;
    }
  }

  const b = -(adx * innerW + adz * innerL);
  const c = innerW * innerW + innerL * innerL - r * r;
  const disc = Math.max(0, b * b - c);
  return -b + Math.sqrt(disc);
}

/**
 * Computes the exact inner and outer radial distance of a tier at angleDeg,
 * strictly matching STADIACAD 2.0.0 engineeringSummary footprint math:
 * - Tracks prevOuterMorph across tiers so a 'concentric-circle' tier (e.g. Bird's Nest 3F)
 *   anchors its inner ring continuously to the previous tier's outer shape, while only
 *   its outer ring transitions toward the concentric circle target.
 * - 'radialDepth' and 'customRadialDepth' are horizontal plan projections.
 */
function computeTierRadialBounds(venue, tierIndex, angleDeg, customRadialDepth) {
  const infield = venue.infield;
  const tiers = venue.standTiers;

  const infieldDist = getRayRoundedRectDistance(
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
  const innerOffsetThisTier = tier.innerOffset || 0;
  const cumulativeInnerOffset = cumulativeOffset + innerOffsetThisTier;

  const innerMorph = prevOuterMorph;
  const outerMorph = tier.morphMode === 'concentric-circle'
    ? (tier.concentricMorph || 0)
    : 0;

  const baseInner = infieldDist * (1 - innerMorph) + majorHalfRadius * innerMorph;
  const baseOuter = infieldDist * (1 - outerMorph) + majorHalfRadius * outerMorph;

  const horizontalDepth = customRadialDepth || tier.radialDepth || 20;
  const innerRadius = baseInner + cumulativeInnerOffset;
  const outerRadius = baseOuter + cumulativeInnerOffset + horizontalDepth;

  return {
    innerRadius,
    outerRadius,
    horizontalDepth: outerRadius - innerRadius
  };
}

/**
 * Computes the true inward normal (fx, fz) perpendicular to the row curve
 * at (angleDeg, rowFrac), ensuring seats never have a skew angle against
 * straight or curved stand steps.
 */
function getRowInwardNormal(venue, tierIndex, angleDeg, rowFrac, customRadialDepth) {
  const delta = 0.5;
  const d1 = angleDeg - delta;
  const d2 = angleDeg + delta;
  const b1 = computeTierRadialBounds(venue, tierIndex, d1, customRadialDepth);
  const b2 = computeTierRadialBounds(venue, tierIndex, d2, customRadialDepth);
  const r1 = b1.innerRadius + (b1.outerRadius - b1.innerRadius) * rowFrac;
  const r2 = b2.innerRadius + (b2.outerRadius - b2.innerRadius) * rowFrac;

  const p1x = Math.sin(d1 * DEG2RAD) * r1;
  const p1z = -Math.cos(d1 * DEG2RAD) * r1;
  const p2x = Math.sin(d2 * DEG2RAD) * r2;
  const p2z = -Math.cos(d2 * DEG2RAD) * r2;

  const tx = p2x - p1x;
  const tz = p2z - p1z;
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
 * Generates Concert Infield Floor Seating Blocks derived strictly from
 * venue.infield and venue.infield.stageConfig (stage size, catwalk, FOH tower).
 */
function generateConcertInfieldBlocks(venue) {
  const infield = venue.infield;
  const stage = infield && infield.stageConfig;
  if (!infield || !stage) return [];

  const blocks = [];
  const halfW = (infield.width || 60) / 2 - 4;
  const halfL = (infield.length || 100) / 2 - 4;
  const sw = stage.width || 30;
  const sd = stage.depth || 20;

  // Keep clear of infieldModules if present
  const mods = venue.infieldModules || [];
  let maxModHalfX = halfW;
  mods.forEach(m => {
    if (Math.abs(m.x) > 10) {
      maxModHalfX = Math.min(maxModHalfX, Math.abs(m.x) - (m.depth || 5) / 2 - 2.5);
    }
  });
  const usableHalfW = Math.max(10, Math.min(halfW, maxModHalfX));

  if (stage.type === 'center-stage') {
    // 4-sided center stage: place North & South floor VIP blocks (and small E/W if room)
    const cw = stage.catwalkWidth || 3.2;
    const clZ = Math.min(stage.catwalkLength || 10, Math.max(4, halfL - sd / 2 - 4));
    const zStart = sd / 2 + 2.5;
    const zEnd = halfL - 1.5;
    const depthZ = zEnd - zStart;

    if (depthZ > 3) {
      const rows = Math.max(3, Math.floor(depthZ / 0.9));
      const bw = Math.max(6, usableHalfW - cw / 2 - 2.5);
      const bxOffset = cw / 2 + 2.0 + bw / 2;
      const bzCenter = zStart + depthZ / 2;

      blocks.push(
        { id: 'floor-nw', name: '内场北西VIP区', x: -bxOffset, z: -bzCenter, width: bw, depth: depthZ, rows, rowPitch: 0.9, seatSpacing: 0.52, facingZ: 1, color: '#0EA5E9' },
        { id: 'floor-ne', name: '内场北东VIP区', x: bxOffset, z: -bzCenter, width: bw, depth: depthZ, rows, rowPitch: 0.9, seatSpacing: 0.52, facingZ: 1, color: '#0EA5E9' },
        { id: 'floor-sw', name: '内场南西VIP区', x: -bxOffset, z: bzCenter, width: bw, depth: depthZ, rows, rowPitch: 0.9, seatSpacing: 0.52, facingZ: -1, color: '#0EA5E9' },
        { id: 'floor-se', name: '内场南东VIP区', x: bxOffset, z: bzCenter, width: bw, depth: depthZ, rows, rowPitch: 0.9, seatSpacing: 0.52, facingZ: -1, color: '#0EA5E9' }
      );
    }
    return blocks;
  }

  // End-stage or Festival-stage positioned at North end facing South (+Z)
  const stageZ = -Math.min((infield.pitchLength || 100) * 0.36, halfL - sd / 2 - 2);
  const stageFrontZ = stageZ + sd / 2;
  const cl = stage.catwalkLength || 18;
  const cw = stage.catwalkWidth || 3.2;
  const catEndZ = stageFrontZ + cl;
  const fohZ = stage.fohEnabled ? (stageFrontZ + (stage.fohDistance || 38)) : (halfL + 100);
  const fohW = stage.fohWidth || 8;
  const fohD = stage.fohDepth || 5;

  const sideSpanW = Math.min(usableHalfW - 2, Math.max(18, (infield.pitchWidth || 60) * 0.46));

  // Front VIP Pit flanking catwalk (A1, A2)
  const frontDepth = Math.max(0, Math.min(catEndZ, halfL - 4) - (stageFrontZ + 2.5));
  if (frontDepth > 3.5) {
    const bw = sideSpanW - cw / 2 - 2.0;
    const bx = cw / 2 + 2.0 + bw / 2;
    const bz = stageFrontZ + 2.5 + frontDepth / 2;
    const rows = Math.max(4, Math.floor(frontDepth / 0.88));
    blocks.push(
      { id: 'floor-a1', name: '内场前区 A1 (近T台)', x: -bx, z: bz, width: bw, depth: frontDepth, rows, rowPitch: 0.88, seatSpacing: 0.5, facingZ: -1, color: '#EC4899' },
      { id: 'floor-a2', name: '内场前区 A2 (近T台)', x: bx, z: bz, width: bw, depth: frontDepth, rows, rowPitch: 0.88, seatSpacing: 0.5, facingZ: -1, color: '#EC4899' }
    );
  }

  // Mid Floor flanking or ahead of FOH (B1, B2)
  const midStartZ = Math.max(stageFrontZ + 3, catEndZ + 5.5);
  const midEndZ = stage.fohEnabled ? Math.min(fohZ - fohD / 2 - 2.5, halfL - 4) : (halfL - 4);
  const midDepth = midEndZ - midStartZ;
  if (midDepth > 3.5) {
    const bw = sideSpanW - 1.5;
    const bx = 1.5 + bw / 2;
    const bz = midStartZ + midDepth / 2;
    const rows = Math.max(4, Math.floor(midDepth / 0.88));
    blocks.push(
      { id: 'floor-b1', name: '内场中区 B1', x: -bx, z: bz, width: bw, depth: midDepth, rows, rowPitch: 0.88, seatSpacing: 0.5, facingZ: -1, color: '#3B82F6' },
      { id: 'floor-b2', name: '内场中区 B2', x: bx, z: bz, width: bw, depth: midDepth, rows, rowPitch: 0.88, seatSpacing: 0.5, facingZ: -1, color: '#3B82F6' }
    );
  }

  // Rear Floor behind FOH (C1, C2)
  if (stage.fohEnabled) {
    const rearStartZ = fohZ + fohD / 2 + 2.5;
    const rearEndZ = halfL - 3;
    const rearDepth = rearEndZ - rearStartZ;
    if (rearDepth > 3.5) {
      const bw = sideSpanW - 1.5;
      const bx = 1.5 + bw / 2;
      const bz = rearStartZ + rearDepth / 2;
      const rows = Math.max(4, Math.floor(rearDepth / 0.88));
      blocks.push(
        { id: 'floor-c1', name: '内场后区 C1', x: -bx, z: bz, width: bw, depth: rearDepth, rows, rowPitch: 0.88, seatSpacing: 0.5, facingZ: -1, color: '#6366F1' },
        { id: 'floor-c2', name: '内场后区 C2', x: bx, z: bz, width: bw, depth: rearDepth, rows, rowPitch: 0.88, seatSpacing: 0.5, facingZ: -1, color: '#6366F1' }
      );
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
    if (stage.type === 'center-stage') {
      targetX = 0;
      targetY = (stage.height || 1.8) + 1.6;
      targetZ = 0;
    } else {
      const halfL = (infield.length || 100) / 2 - 4;
      const sd = stage.depth || 20;
      targetX = 0;
      targetZ = -Math.min((infield.pitchLength || 100) * 0.36, halfL - sd / 2 - 2);
      targetY = (stage.height || 2.0) + 2.2;
    }
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
    const eyeZ = blk.facingZ === 1 ? (blk.z - localZ) : (blk.z + localZ);
    const eyeX = blk.x;
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
  const bounds = computeTierRadialBounds(venue, tierIndex, midAngleDeg, sector.customRadialDepth);

  // Map row 1..totalRows evenly across [innerRadius + 0.5, outerRadius - 0.5]
  const rowFrac = totalRows > 1 ? (row - 1) / (totalRows - 1) : 0;
  const seatRadius = bounds.innerRadius + 0.5 + rowFrac * Math.max(0.5, bounds.horizontalDepth - 1.0);
  const seatElevation = (tier.baseElevation || 1.0) + (row - 1) * riserHeight;
  const eyeElevation = seatElevation + (sightCfg.spectatorEyeHeight || 1.15);

  const eyePos = polarToWorld3D(midAngleDeg, seatRadius, eyeElevation);

  const focalRadius = getRayRoundedRectDistance(midAngleDeg, infield.pitchLength || 68, infield.pitchWidth || 45, 4) - (sightCfg.focalPointOffsetFromPitchEdge || 2);
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
  getRayRoundedRectDistance,
  computeTierRadialBounds,
  getRowInwardNormal,
  polarToWorld3D,
  generateConcertInfieldBlocks,
  findDefaultEastFirstRowSelection,
  calculateSeatSightline
};
