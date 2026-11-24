/**
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

class RaycastMixinHolder {
  pickAt(nx, ny) {
    if (!this.venue) return null;
    const eye = this.camEye;
    const target = this.camTarget;

    let fx = target.x - eye.x;
    let fy = target.y - eye.y;
    let fz = target.z - eye.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;

    // 相机右向量 right = forward × up(0,1,0)
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // 相机上向量 up' = back × right
    const ux = -fy * rz;
    const uy = fx * rz - fz * rx;
    const uz = fy * rx;

    const fovDeg = Math.max(12, Math.min(90, this.baseFovDeg / Math.pow(this.zoomLevel || 1, 0.85)));
    const aspect = (this.width || 375) / Math.max(1, this.height || 400);
    const tanHalf = Math.tan((fovDeg * DEG2RAD) / 2);
    const ndcX = nx * 2 - 1;
    const ndcY = 1 - ny * 2;

    let dx = fx + rx * (ndcX * aspect * tanHalf) + ux * (ndcY * tanHalf);
    let dy = fy + uy * (ndcY * tanHalf);
    let dz = fz + rz * (ndcX * aspect * tanHalf) + uz * (ndcY * tanHalf);
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    const tiers = this.venue.standTiers || [];
    const tierMetas = tiers.map((tier, ti) => {
      const isConc = isConcentricMorphTier(tier);
      const rowPitch = Math.max(0.4, tier.defaultRowPitch || 0.85);
      const slope = tier.defaultSlopeDeg || 20;
      const base = tier.baseElevation || 1.0;
      const riserH = tier.defaultRiserHeight || (rowPitch * Math.tan(slope * DEG2RAD));
      const maxRows = isConc
        ? Math.max(
          tier.defaultRows || 22,
          getTierRowsAtAngle(this.venue, ti, tier, null, 0),
          getTierRowsAtAngle(this.venue, ti, tier, null, 90)
        )
        : (tier.defaultRows || 22);
      return { base, top: base + Math.max(0, maxRows - 1) * riserH };
    });
    const maxPickY = Math.max(85, ...tierMetas.map(m => m.top + 8));
    let prevT = 0;
    let prevDelta = null;
    const startT = (this.cameraMode === 'seat') ? 2.5 : 3;
    for (let t = startT; t < 900; t += 0.5) {
      const px = eye.x + dx * t;
      const py = eye.y + dy * t;
      const pz = eye.z + dz * t;
      if (py < -2) break;
      if (py > maxPickY) { prevDelta = null; prevT = t; continue; }

      const info = this.tierAtPoint(px, py, pz, tiers, tierMetas);
      if (!info) { prevDelta = null; prevT = t; continue; }

      // 还在座席面上方：继续前进
      if (info.delta > 0) { prevDelta = info.delta; prevT = t; continue; }

      // 上一采样点在上方、当前在下方：二分找真正的穿越点
      if (prevDelta !== null) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const mi = this.tierAtPoint(eye.x + dx * mid, eye.y + dy * mid, eye.z + dz * mid, tiers, tierMetas);
          if (mi && mi.delta > 0) lo = mid;
          else hi = mid;
        }
        return this.resolveTierHit(info.tierIndex, eye.x + dx * hi, eye.z + dz * hi) || this.toTierHit(info);
      }

      // 从侧面进入且仍在座席面附近
      if (info.delta > -2.5) {
        return this.resolveTierHit(info.tierIndex, px, pz) || this.toTierHit(info);
      }
      prevDelta = null;
      prevT = t;
    }

    // 未命中看台时回落到地面：内场座位区块 / 内场模块
    if (dy < -1e-4) {
      const tGround = -eye.y / dy;
      const gx = eye.x + dx * tGround;
      const gz = eye.z + dz * tGround;
      const floorHit = this.hitInfieldPoint(gx, gz);
      if (floorHit) return floorHit;
    }
    return null;
  }

  /**
   * 参数角反解：给定平面点，迭代求它在该层看台带上的参数角与径向比例。
   * 返回 dist 为点到该看台带的水平垂距，用于判断是否真的落在这一层。
   */
  solveTierProjection(tierIndex, px, pz, customRadialDepth) {
    let theta = ((Math.atan2(px, -pz) * RAD2DEG) + 360) % 360;
    let frac = 0.5;
    let dist = Infinity;

    for (let iter = 0; iter < 5; iter++) {
      const inPt = evalTierPoint(this.venue, tierIndex, theta, 0, customRadialDepth);
      const outPt = evalTierPoint(this.venue, tierIndex, theta, 1, customRadialDepth);
      const vx = outPt.outX - inPt.inX;
      const vz = outPt.outZ - inPt.inZ;
      const lenSq = Math.max(1e-6, vx * vx + vz * vz);
      frac = Math.max(0, Math.min(1, ((px - inPt.inX) * vx + (pz - inPt.inZ) * vz) / lenSq));

      const cx = inPt.inX + vx * frac;
      const cz = inPt.inZ + vz * frac;
      const ex = px - cx;
      const ez = pz - cz;
      dist = Math.hypot(ex, ez);
      if (dist < 0.05) break;

      const d = 0.5;
      const a = evalTierPoint(this.venue, tierIndex, (theta - d + 360) % 360, frac, customRadialDepth);
      const b = evalTierPoint(this.venue, tierIndex, (theta + d) % 360, frac, customRadialDepth);
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz);
      if (tl < 1e-6) break;
      tx /= tl;
      tz /= tl;
      theta = (theta + (ex * tx + ez * tz) / Math.max(0.05, tl / (2 * d)) + 360) % 360;
    }
    return { theta, frac, dist };
  }

  // 分区可用 customRadialDepth 覆盖层深，先按初值反解，再用命中分区的层深复算一次
  projectOnTier(tierIndex, px, pz) {
    const tier = (this.venue.standTiers || [])[tierIndex];
    if (!tier) return null;
    const polar = ((Math.atan2(px, -pz) * RAD2DEG) + 360) % 360;
    let sector = this.sectorAtAngle(tier, polar);
    let depth = sector ? sector.customRadialDepth : undefined;

    let proj = this.solveTierProjection(tierIndex, px, pz, depth);
    const resolved = this.sectorAtAngle(tier, proj.theta);
    if (resolved && resolved.customRadialDepth !== depth) {
      sector = resolved;
      depth = resolved.customRadialDepth;
      proj = this.solveTierProjection(tierIndex, px, pz, depth);
    }
    return {
      theta: proj.theta,
      frac: proj.frac,
      dist: proj.dist,
      sector: this.sectorAtAngle(tier, proj.theta) || sector,
      customRadialDepth: depth
    };
  }

  tierAtPoint(px, py, pz, tiers, tierMetas) {
    for (let ti = 0; ti < tiers.length; ti++) {
      const meta = tierMetas[ti];
      if (py < meta.base - 2 || py > meta.top + 3) continue;

      const proj = this.projectOnTier(ti, px, pz);
      if (!proj || proj.dist > 2.5) continue;

      const tier = tiers[ti];
      const sector = proj.sector;
      if (!sector) continue;

      const isVip = (sector.fillType || tier.defaultFillType) === 'vip-box';
      const isConc = !isVip && isConcentricMorphTier(tier);
      const rowPitch = Math.max(0.4, sector.rowPitch || tier.defaultRowPitch || 0.85);
      const slopeDeg = isVip ? 0 : (sector.slopeDeg || tier.defaultSlopeDeg || 20);
      const riserH = isVip ? 0 : (sector.riserHeight || rowPitch * Math.tan(slopeDeg * DEG2RAD));
      const totalRows = isVip ? 1 : getTierRowsAtAngle(this.venue, ti, tier, sector, proj.theta);

      let rawRow;
      if (isVip) {
        rawRow = 1;
      } else if (isConc) {
        const edgePt = evalTierPoint(this.venue, ti, proj.theta, 0, proj.customRadialDepth);
        const depthM = Math.max(0.5, Math.hypot(edgePt.outX - edgePt.inX, edgePt.outZ - edgePt.inZ));
        rawRow = Math.max(1, Math.round((proj.frac * depthM) / rowPitch + 0.5));
      } else {
        rawRow = Math.max(1, Math.round(proj.frac * totalRows + 0.5));
      }
      if (rawRow > totalRows + 1) continue;
      const row = Math.min(totalRows, rawRow);
      const treadY = (tier.baseElevation || 1.0) + (row - 1) * riserH;
      return {
        tierIndex: ti,
        sector,
        tierLevel: tier.level,
        estimatedRow: row,
        delta: py - (treadY + 0.3)
      };
    }
    return null;
  }

  toTierHit(info) {
    const fill = info.sector.fillType || (this.venue.standTiers[info.tierIndex] || {}).defaultFillType;
    if (fill === 'solid-wall') return null;
    return {
      type: 'sector',
      tierIndex: info.tierIndex,
      sector: info.sector,
      tierLevel: info.tierLevel,
      estimatedRow: info.estimatedRow
    };
  }

  /**
   * 由命中点的平面坐标反解所在看台分区。
   * 看台分区角度是"参数角"（沿内场周界偏移），与命中点的极角不同，
   * 这里对当前层做迭代投影，求出参数角与排数比例。
   */
  resolveTierHit(tierIndex, px, pz) {
    const tier = (this.venue.standTiers || [])[tierIndex];
    if (!tier) return null;

    const proj = this.projectOnTier(tierIndex, px, pz);
    if (!proj) return null;
    const sector = proj.sector;
    if (!sector) return null;
    const fill = sector.fillType || tier.defaultFillType;
    if (fill === 'solid-wall') return null;

    const isVip = fill === 'vip-box';
    const isConc = !isVip && isConcentricMorphTier(tier);
    const totalRows = isVip ? 1 : getTierRowsAtAngle(this.venue, tierIndex, tier, sector, proj.theta);
    let estimatedRow = 1;
    if (!isVip) {
      if (isConc) {
        const rowPitch = Math.max(0.4, sector.rowPitch || tier.defaultRowPitch || 0.85);
        const edgePt = evalTierPoint(this.venue, tierIndex, proj.theta, 0, proj.customRadialDepth);
        const depthM = Math.max(0.5, Math.hypot(edgePt.outX - edgePt.inX, edgePt.outZ - edgePt.inZ));
        estimatedRow = Math.max(1, Math.min(totalRows, Math.round((proj.frac * depthM) / rowPitch + 0.5)));
      } else {
        estimatedRow = Math.max(1, Math.min(totalRows, Math.round(proj.frac * totalRows)));
      }
    }
    return {
      type: 'sector',
      tierIndex,
      sector,
      tierLevel: tier.level,
      estimatedRow
    };
  }

  sectorAtAngle(tier, angleDeg) {
    const sectors = tier.sectors || [];
    for (let i = 0; i < sectors.length; i++) {
      const sec = sectors[i];
      if (sec.isDeleted || sec.fillType === 'empty-void') continue;
      const a0 = sec.startAngleDeg;
      const a1 = sec.endAngleDeg;
      if (a1 < a0) {
        if (angleDeg >= a0 || angleDeg <= a1) return sec;
      } else if (angleDeg >= a0 && angleDeg <= a1) {
        return sec;
      }
    }
    return null;
  }

  hitInfieldPoint(gx, gz) {
    if (this.viewMode === 'concert') {
      const blocks = generateConcertInfieldBlocks(this.venue);
      for (let i = 0; i < blocks.length; i++) {
        const blk = blocks[i];
        const lp = rotateXZ(gx - blk.x, gz - blk.z, -(blk.rotDeg || 0));
        if (Math.abs(lp.x) <= blk.width / 2 && Math.abs(lp.z) <= blk.depth / 2) {
          const rel = (lp.z + blk.depth / 2) / Math.max(1, blk.depth);
          const ratio = blk.localFacingZ === 1 ? 1 - rel : rel;
          const rows = blk.rows || 10;
          return { type: 'floor', floorBlock: blk, estimatedRow: Math.max(1, Math.min(rows, Math.round(ratio * rows))) };
        }
      }
      return null;
    }

    const modules = (this.venue.infieldModules || []).filter(m => !m.autoGeneratedForStage);
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const lp = rotateXZ(gx - (mod.x || 0), gz - (mod.y || 0), -(mod.rotationDeg || 0));
      const hw = (mod.width || 20) / 2;
      const hd = (mod.depth || 5) / 2;
      if (Math.abs(lp.x) <= hw && Math.abs(lp.z) <= hd) {
        const rel = (lp.z + hd) / Math.max(1, hd * 2);
        const rows = mod.rows || 4;
        return { type: 'module', module: mod, estimatedRow: Math.max(1, Math.min(rows, Math.round(rel * rows))) };
      }
    }
    return null;
  }

}
const RaycastMixin = {};
Object.getOwnPropertyNames(RaycastMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') RaycastMixin[k] = RaycastMixinHolder.prototype[k];
});
module.exports = { RaycastMixin };

