/**
 * STADIACAD 2D Interactive Seat Map Renderer
 * Uses WeChat Mini Program <canvas type="2d"> API
 * Clean, enlarged, finger-friendly layout without cluttered labels
 */

const {
  DEG2RAD,
  rotateXZ,
  evalTierPoint,
  getInfieldCornerTransitionAngles,
  getRowInwardNormal,
  computeRunningTrackSpec,
  getStageTransform,
  computeVomitoryAngularBounds,
  generateConcertInfieldBlocks
} = require('./schema-geometry');

const TIER_COLORS = [
  { base: '#1E3A8A', stroke: '#60A5FA', label: '#DBEAFE' }, // 1F Lower Bowl
  { base: '#065F46', stroke: '#34D399', label: '#D1FAE5' }, // 2F Club / Tier 2
  { base: '#78350F', stroke: '#FBBF24', label: '#FEF3C7' }, // 3F VIP / Tier 3
  { base: '#4C1D95', stroke: '#A78BFA', label: '#EDE9FE' }  // 4F Upper Bowl
];

class Renderer2D {
  constructor(canvas, ctx, width, height, dpr) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.dpr = dpr || 2;

    this.venue = null;
    this.viewMode = 'concert'; // 'concert' | 'sports'
    this.activeTierFilter = 'all'; // 'all' | 1 | 2 | 3 | 4
    this.selectedSectorId = null;
    this.selectedModuleId = null;
    this.selectedFloorBlockId = null;

    // Pan & Zoom state
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.baseMeterToPx = 1.0;

    // Cached hit-test polygons
    this.hitPolygons = [];
    this.floorPolygons = [];
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.computeBaseScale();
    this.render();
  }

  setVenue(venue, viewMode) {
    this.venue = venue;
    if (viewMode) this.viewMode = viewMode;
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.computeBaseScale();
    this.buildGeometryCache();
    this.render();
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode;
    this.render();
  }

  setTierFilter(level) {
    this.activeTierFilter = level;
    this.render();
  }

  setSelection(sectorId, moduleId, floorBlockId) {
    this.selectedSectorId = sectorId || null;
    this.selectedModuleId = moduleId || null;
    this.selectedFloorBlockId = floorBlockId || null;
    this.render();
  }

  resetTransform() {
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.render();
  }

  computeBaseScale() {
    if (!this.venue) return;
    const summary = this.venue.engineeringSummary || {};
    const footW = summary.outermostFootprintWidthM || 220;
    const footL = summary.outermostFootprintLengthM || 260;

    // 2D view is rotated 90° clockwise: venue length spans horizontally, width spans vertically
    const sx = (this.width * 0.94) / footL;
    const sy = (this.height * 0.94) / footW;
    this.baseMeterToPx = Math.max(0.4, Math.min(sx, sy));
  }

  buildGeometryCache() {
    this.hitPolygons = [];
    this.floorPolygons = [];
    if (!this.venue) return;

    const cornerAngles = getInfieldCornerTransitionAngles(this.venue);
    const tiers = this.venue.standTiers || [];
    tiers.forEach((tier, tierIndex) => {
      const sectors = tier.sectors || [];
      sectors.forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void') return;

        const startDeg = sec.startAngleDeg;
        const endDeg = sec.endAngleDeg;
        const sDeg = startDeg;
        const eDeg = endDeg;
        if (eDeg <= sDeg) return;

        // Build smooth angle samples (<= 1.5° step on arcs) including exact infield corner-transition angles
        const steps = Math.max(6, Math.ceil((eDeg - sDeg) / 1.5));
        const rawSampleDegs = [];
        for (let i = 0; i <= steps; i++) {
          rawSampleDegs.push(sDeg + (eDeg - sDeg) * (i / steps));
        }
        cornerAngles.forEach((ca) => {
          if (ca > sDeg + 0.08 && ca < eDeg - 0.08) {
            rawSampleDegs.push(ca);
          }
          if (ca + 360 > sDeg + 0.08 && ca + 360 < eDeg - 0.08) {
            rawSampleDegs.push(ca + 360);
          }
        });
        rawSampleDegs.sort((a, b) => a - b);

        const sampleDegs = [];
        rawSampleDegs.forEach((d) => {
          if (sampleDegs.length === 0 || d - sampleDegs[sampleDegs.length - 1] > 0.05) {
            sampleDegs.push(d);
          }
        });

        const innerPts = [];
        const outerPts = [];
        sampleDegs.forEach((deg) => {
          const pt = evalTierPoint(this.venue, tierIndex, deg, 0, sec.customRadialDepth);
          innerPts.push({ x: pt.inX, y: pt.inZ });
          outerPts.push({ x: pt.outX, y: pt.outZ });
        });

        const polygon = [...innerPts, ...outerPts.reverse()];
        const midDeg = (sDeg + eDeg) / 2;
        const midPt = evalTierPoint(this.venue, tierIndex, midDeg, 0.5, sec.customRadialDepth);
        const midDepth = Math.hypot(midPt.outX - midPt.inX, midPt.outZ - midPt.inZ);

        let vomitoryRect = null;
        if (sec.vomitory && sec.vomitory.position !== 'none' && sec.vomitory.enabled !== false) {
          const totalRows = sec.rows || tier.defaultRows || 22;
          const vomInfo = computeVomitoryAngularBounds(
            this.venue,
            tierIndex,
            sDeg,
            eDeg,
            sec.vomitory,
            totalRows,
            sec.customRadialDepth
          );
          const vomPt = evalTierPoint(this.venue, tierIndex, vomInfo.vomCenterDeg, vomInfo.vomRowFrac, sec.customRadialDepth);
          const nrm = getRowInwardNormal(this.venue, tierIndex, vomInfo.vomCenterDeg, vomInfo.vomRowFrac, sec.customRadialDepth);
          const rowSpanCount = vomInfo.vomEndRow >= vomInfo.vomStartRow
            ? (vomInfo.vomEndRow - vomInfo.vomStartRow + 1)
            : 1;
          vomitoryRect = {
            x: vomPt.x,
            y: vomPt.z,
            angleRad: Math.atan2(nrm.x, -nrm.z),
            w: vomInfo.actualWidthM,
            h: vomInfo.isFrontConnected && vomInfo.vomEndRow < 1
              ? 1.8
              : Math.max(2.0, (rowSpanCount / Math.max(1, totalRows)) * midDepth),
            isFrontConnected: vomInfo.isFrontConnected
          };
        }

        this.hitPolygons.push({
          type: 'sector',
          id: sec.id,
          sector: sec,
          tierIndex,
          tierLevel: tier.level,
          tierName: tier.name,
          polygon,
          center: {
            x: midPt.x,
            y: midPt.z
          },
          vomitory: vomitoryRect
        });
      });
    });

    // Infield modules (schema-defined field seats)
    const modules = this.venue.infieldModules || [];
    modules.forEach((mod) => {
      const rotRad = (mod.rotationDeg || 0) * DEG2RAD;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      const hw = (mod.width || 20) / 2;
      const hd = (mod.depth || 5) / 2;
      const localCorners = [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: hd },
        { x: -hw, y: hd }
      ];
      const polygon = localCorners.map(p => ({
        x: (mod.x || 0) + p.x * cosR - p.y * sinR,
        y: (mod.y || 0) + p.x * sinR + p.y * cosR
      }));

      this.hitPolygons.push({
        type: 'module',
        id: mod.id,
        module: mod,
        tierLevel: 0,
        polygon,
        center: { x: mod.x || 0, y: mod.y || 0 }
      });
    });

    // Concert Infield Floor Seating Blocks (properly rotated to stageConfig.orientationDeg)
    const floorBlocks = generateConcertInfieldBlocks(this.venue);
    floorBlocks.forEach((blk) => {
      const hw = blk.width / 2;
      const hd = blk.depth / 2;
      const localCorners = [
        { x: -hw, z: -hd },
        { x: hw, z: -hd },
        { x: hw, z: hd },
        { x: -hw, z: hd }
      ];
      const polygon = localCorners.map((pt) => {
        const rp = rotateXZ(pt.x, pt.z, blk.rotDeg || 0);
        return { x: blk.x + rp.x, y: blk.z + rp.z };
      });
      this.floorPolygons.push({
        type: 'floor',
        id: blk.id,
        floorBlock: blk,
        tierLevel: 0,
        polygon,
        center: { x: blk.x, y: blk.z }
      });
    });
  }

  hitTest(screenX, screenY) {
    const cx = this.width / 2 + this.offsetX;
    const cy = this.height / 2 + this.offsetY;
    const s = this.baseMeterToPx * this.scale;

    // Invert 90° clockwise rotation: (rx = -wz, ry = wx) => (wx = ry, wz = -rx)
    const rx = (screenX - cx) / s;
    const ry = (screenY - cy) / s;
    const mx = ry;
    const my = -rx;

    // 1. Check Concert Infield Floor Blocks first when in concert mode
    if (this.viewMode === 'concert') {
      for (let i = this.floorPolygons.length - 1; i >= 0; i--) {
        const blkItem = this.floorPolygons[i];
        if (this.pointInPolygon(mx, my, blkItem.polygon)) {
          const blk = blkItem.floorBlock;
          const totalRows = blk.rows || 10;
          const localPt = rotateXZ(mx - blk.x, my - blk.z, -(blk.rotDeg || 0));
          const relY = (localPt.z + blk.depth / 2) / Math.max(1, blk.depth);
          const ratio = blk.localFacingZ === 1 ? (1 - relY) : relY;
          const estimatedRow = Math.max(1, Math.min(totalRows, Math.round(ratio * totalRows)));
          return { ...blkItem, estimatedRow };
        }
      }
    }

    // 2. Check Stand Sectors & (in sports mode) Infield Modules
    for (let i = this.hitPolygons.length - 1; i >= 0; i--) {
      const item = this.hitPolygons[i];
      if (item.type === 'module' && this.viewMode !== 'sports') {
        continue;
      }
      if (this.activeTierFilter !== 'all' && item.tierLevel !== this.activeTierFilter && item.tierLevel !== 0) {
        continue;
      }
      if (this.pointInPolygon(mx, my, item.polygon)) {
        let rowRatio = 0.5;
        if (item.type === 'sector') {
          const angleDeg = (Math.atan2(mx, -my) * 180 / Math.PI + 360) % 360;
          const pt = evalTierPoint(this.venue, item.tierIndex, angleDeg, 0, item.sector.customRadialDepth);
          const vx = pt.outX - pt.inX;
          const vz = pt.outZ - pt.inZ;
          const vLenSq = Math.max(1, vx * vx + vz * vz);
          const proj = ((mx - pt.inX) * vx + (my - pt.inZ) * vz) / vLenSq;
          rowRatio = Math.max(0.05, Math.min(0.95, proj));
        }
        const totalRows = item.type === 'sector' ? (item.sector.rows || 22) : (item.module.rows || 4);
        const estimatedRow = Math.max(1, Math.min(totalRows, Math.round(rowRatio * totalRows)));

        return {
          ...item,
          estimatedRow
        };
      }
    }
    return null;
  }

  pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  render() {
    if (!this.ctx || !this.venue) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.fillStyle = '#070A12';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2 + this.offsetX;
    const cy = h / 2 + this.offsetY;
    const s = this.baseMeterToPx * this.scale;

    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate(Math.PI / 2);

    // 1. Subtle Polar Reference Ring
    this.drawGrid(ctx, s);

    // 2. Infield & Pitch / Track / Court
    this.drawInfield(ctx, s);

    // 3. Concert Floor Seating & Stage (or Sports only)
    if (this.viewMode === 'concert') {
      this.drawFloorBlocks2D(ctx, s);
      this.drawStage2D(ctx, s);
    }

    // 4. Stand Tiers & Sectors
    this.drawSectors(ctx, s);

    // 5. Sightline Vector from Selected Sector to Stage/Pitch
    this.drawSightlineRay(ctx, s);

    ctx.restore();

    // 6. Minimal North Compass
    this.drawOverlayHUD(ctx);
  }

  drawGrid(ctx, s) {
    const grid = this.venue.gridSystem || {};
    if (!grid.enabled) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1 / s;
    const maxR = 190;
    if (grid.showPolarGrid) {
      for (let r = 50; r <= maxR; r += 50) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawInfield(ctx, s) {
    const infield = this.venue.infield;
    if (!infield) return;

    ctx.save();
    this.traceRoundedRect(ctx, 0, 0, infield.width, infield.length, infield.cornerRadius);
    if (infield.surfaceType === 'synthetic-track') {
      ctx.fillStyle = '#064E3B';
    } else if (infield.surfaceType === 'hardwood-court') {
      ctx.fillStyle = '#1E293B';
    } else {
      ctx.fillStyle = '#064E3B';
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2 / s;
    ctx.stroke();

    if (infield.sportPreset === 'track-field' || infield.surfaceType === 'synthetic-track') {
      const spec = computeRunningTrackSpec(infield);

      // Outer brick-red synthetic running track belt
      this.traceRoundedRect(
        ctx,
        0,
        0,
        spec.outerTrackWidth,
        spec.outerTrackLength,
        spec.outerTrackCornerRadius
      );
      ctx.fillStyle = '#9A3412';
      ctx.fill();

      // Inner green field apron surrounding pitch + D-zones
      this.traceRoundedRect(
        ctx,
        0,
        0,
        spec.innerApronWidth,
        spec.innerApronLength,
        spec.innerApronCornerRadius
      );
      ctx.fillStyle = '#065F46';
      ctx.fill();

      // Exact schema-computed lane lines (lanes + 1 boundaries spaced by laneWidth)
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 0.65 / s;
      for (let lane = 0; lane <= spec.lanes; lane++) {
        const shrink = lane * spec.laneWidth;
        this.traceRoundedRect(
          ctx,
          0,
          0,
          spec.outerTrackWidth - shrink * 2,
          spec.outerTrackLength - shrink * 2,
          Math.max(2, spec.outerTrackCornerRadius - shrink)
        );
        ctx.stroke();
      }
    }

    const pw = infield.pitchWidth || 68;
    const pl = infield.pitchLength || 105;

    ctx.save();
    ctx.rotate((infield.pitchOrientationDeg || 0) * DEG2RAD);
    if (infield.surfaceType === 'hardwood-court') {
      ctx.fillStyle = '#B45309';
      ctx.fillRect(-pw / 2, -pl / 2, pw, pl);
      ctx.strokeStyle = 'rgba(253, 230, 138, 0.75)';
      ctx.lineWidth = 0.9 / s;
      ctx.strokeRect(-pw / 2, -pl / 2, pw, pl);
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-pw / 2, 0);
      ctx.lineTo(pw / 2, 0);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#047857';
      ctx.fillRect(-pw / 2, -pl / 2, pw, pl);
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 0.9 / s;
      ctx.strokeRect(-pw / 2, -pl / 2, pw, pl);
      ctx.beginPath();
      ctx.moveTo(-pw / 2, 0);
      ctx.lineTo(pw / 2, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 9.15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(-20.15, -pl / 2, 40.3, 16.5);
      ctx.strokeRect(-20.15, pl / 2 - 16.5, 40.3, 16.5);
    }
    ctx.restore();
    ctx.restore();
  }

  drawFloorBlocks2D(ctx, s) {
    this.floorPolygons.forEach((item) => {
      const isSelected = item.id === this.selectedFloorBlockId;
      const blk = item.floorBlock;
      ctx.save();
      ctx.translate(blk.x, blk.z);
      ctx.rotate((blk.rotDeg || 0) * DEG2RAD);

      ctx.fillStyle = isSelected ? '#F43F5E' : (blk.color || '#3B82F6');
      ctx.globalAlpha = isSelected ? 0.95 : 0.72;
      ctx.fillRect(-blk.width / 2, -blk.depth / 2, blk.width, blk.depth);

      ctx.strokeStyle = isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = (isSelected ? 1.8 : 0.7) / s;
      ctx.strokeRect(-blk.width / 2, -blk.depth / 2, blk.width, blk.depth);

      // Subtle row lines inside floor block
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 0.4 / s;
      const rows = Math.min(14, blk.rows || 8);
      for (let r = 1; r < rows; r++) {
        const ry = -blk.depth / 2 + (r / rows) * blk.depth;
        ctx.beginPath();
        ctx.moveTo(-blk.width / 2 + 0.5, ry);
        ctx.lineTo(blk.width / 2 - 0.5, ry);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  drawStage2D(ctx, s) {
    const infield = this.venue.infield;
    const stage = infield && infield.stageConfig;
    if (!stage) return;

    const st = getStageTransform(this.venue);
    ctx.save();
    ctx.rotate((st.rotFromSouthDeg || 0) * DEG2RAD);

    const sw = stage.width || 30;
    const sd = stage.depth || 20;

    if (stage.type === 'center-stage') {
      ctx.translate(st.stageLocalX || 0, st.stageLocalZ || 0);
      ctx.fillStyle = 'rgba(236, 72, 153, 0.25)';
      ctx.fillRect(-sw / 2 - 1.5, -sd / 2 - 1.5, sw + 3, sd + 3);
      ctx.fillStyle = '#DB2777';
      ctx.strokeStyle = '#F9A8D4';
      ctx.lineWidth = 1.2 / s;
      ctx.fillRect(-sw / 2, -sd / 2, sw, sd);
      ctx.strokeRect(-sw / 2, -sd / 2, sw, sd);

      const cw = stage.catwalkWidth || 3.2;
      const clZ = st.catwalkLength || Math.min(stage.catwalkLength || 10, Math.max(3, st.alongHalf - sd / 2 + 1));
      const clX = st.catwalkLengthX || Math.min(stage.catwalkLength || 10, Math.max(2, st.crossHalf - sw / 2 + 1));
      ctx.fillStyle = '#F43F5E';
      ctx.fillRect(-cw / 2, -sd / 2 - clZ, cw, clZ);
      ctx.fillRect(-cw / 2, sd / 2, cw, clZ);
      if (clX > 1) {
        ctx.fillRect(-sw / 2 - clX, -cw / 2, clX, cw);
        ctx.fillRect(sw / 2, -cw / 2, clX, cw);
      }
    } else {
      ctx.translate(st.stageLocalX || 0, st.stageLocalZ);

      ctx.fillStyle = '#BE185D';
      ctx.strokeStyle = '#F9A8D4';
      ctx.lineWidth = 1.2 / s;
      ctx.fillRect(-sw / 2, -sd / 2, sw, sd);
      ctx.strokeRect(-sw / 2, -sd / 2, sw, sd);

      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(-sw * 0.55, -sd / 2 - 2.2, sw * 1.1, 2.2);

      const cw = stage.catwalkWidth || 3.5;
      const cl = st.catwalkLength;
      ctx.fillStyle = '#E11D48';
      ctx.fillRect(-cw / 2, sd / 2, cw, cl);
      ctx.strokeRect(-cw / 2, sd / 2, cw, cl);

      const bStageD = Math.min(5.2, cl * 0.35);
      const bStageW = cw * 2.2;
      ctx.fillRect(-bStageW / 2, sd / 2 + cl - bStageD, bStageW, bStageD);
      ctx.strokeRect(-bStageW / 2, sd / 2 + cl - bStageD, bStageW, bStageD);

      if (stage.fohEnabled) {
        const fohRelY = st.fohLocalZ - st.stageLocalZ;
        const fw = stage.fohWidth || 8;
        const fd = stage.fohDepth || 5;
        ctx.fillStyle = '#0284C7';
        ctx.strokeStyle = '#7DD3FC';
        ctx.fillRect(-fw / 2, fohRelY - fd / 2, fw, fd);
        ctx.strokeRect(-fw / 2, fohRelY - fd / 2, fw, fd);
      }
    }
    ctx.restore();
  }

  drawSectors(ctx, s) {
    const showVomitories = this.venue.gridSystem && this.venue.gridSystem.showVomitories;

    // Draw non-selected items first, then selected item on top so touching borders never clip selection stroke
    const ordered = [];
    const selectedItems = [];
    this.hitPolygons.forEach((item) => {
      if (item.type === 'module' && this.viewMode !== 'sports') {
        return;
      }
      const isSelected = (item.type === 'sector' && item.id === this.selectedSectorId) ||
                         (item.type === 'module' && item.id === this.selectedModuleId);
      if (isSelected) selectedItems.push(item);
      else ordered.push(item);
    });
    const drawList = ordered.concat(selectedItems);

    drawList.forEach((item) => {
      const isDimmed = this.activeTierFilter !== 'all' && item.tierLevel !== this.activeTierFilter && item.tierLevel !== 0;
      const isSelected = (item.type === 'sector' && item.id === this.selectedSectorId) ||
                         (item.type === 'module' && item.id === this.selectedModuleId);

      ctx.save();
      ctx.beginPath();
      item.polygon.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();

      if (item.type === 'module') {
        ctx.fillStyle = isSelected ? '#F43F5E' : (item.module.color || '#10B981');
        ctx.globalAlpha = isDimmed ? 0.18 : (isSelected ? 0.95 : 0.78);
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#FFFFFF' : '#A7F3D0';
        ctx.lineWidth = (isSelected ? 2.0 : 0.9) / s;
        ctx.stroke();
      } else {
        const palette = TIER_COLORS[(item.tierLevel - 1) % TIER_COLORS.length];
        const isVip = item.sector.fillType === 'vip-box';

        if (isSelected) {
          ctx.fillStyle = '#F43F5E';
        } else if (isVip) {
          ctx.fillStyle = '#B45309';
        } else {
          ctx.fillStyle = palette.base;
        }

        ctx.globalAlpha = isDimmed ? 0.15 : (isSelected ? 0.95 : 0.88);
        ctx.fill();

        ctx.strokeStyle = isSelected ? '#FFFFFF' : (isVip ? '#FBBF24' : palette.stroke);
        ctx.lineWidth = (isSelected ? 2.2 : 0.8) / s;
        ctx.stroke();

        // Vomitory portal indicator (highlight open front-connected exits in emerald/teal)
        if (showVomitories && item.vomitory && !isDimmed) {
          ctx.save();
          ctx.translate(item.vomitory.x, item.vomitory.y);
          ctx.rotate(item.vomitory.angleRad);
          ctx.fillStyle = item.vomitory.isFrontConnected ? 'rgba(16, 185, 129, 0.85)' : 'rgba(15, 23, 42, 0.88)';
          ctx.fillRect(-item.vomitory.w / 2, -item.vomitory.h / 2, item.vomitory.w, item.vomitory.h);
          ctx.restore();
        }

        // Only draw concise label for the selected sector or when zoomed in >= 1.55x (counter-rotated to remain upright)
        if (!isDimmed && (isSelected || this.scale >= 1.55)) {
          const shortLabel = item.sector.name.replace(/.*\((.+)\)/, '$1').slice(0, 6);
          ctx.save();
          ctx.translate(item.center.x, item.center.y);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = '#FFFFFF';
          const pxSize = Math.max(9, Math.min(13, 11)) / s;
          ctx.font = `bold ${pxSize.toFixed(2)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(shortLabel, 0, 0);
          ctx.restore();
        }
      }
      ctx.restore();
    });
  }

  drawSightlineRay(ctx, s) {
    const selected =
      this.floorPolygons.find(it => it.id === this.selectedFloorBlockId) ||
      this.hitPolygons.find(
        it => (it.type === 'sector' && it.id === this.selectedSectorId) ||
              (it.type === 'module' && it.id === this.selectedModuleId)
      );
    if (!selected) return;

    let targetX = 0;
    let targetY = 0;
    const infield = this.venue.infield;
    const stage = infield && infield.stageConfig;
    if (this.viewMode === 'concert' && stage) {
      const st = getStageTransform(this.venue);
      targetX = st.centerX;
      targetY = st.centerZ;
    }

    ctx.save();
    const angle = Math.atan2(targetY - selected.center.y, targetX - selected.center.x);
    const dist = Math.hypot(targetX - selected.center.x, targetY - selected.center.y);
    const spread = 0.2;

    ctx.fillStyle = 'rgba(244, 63, 94, 0.16)';
    ctx.beginPath();
    ctx.moveTo(selected.center.x, selected.center.y);
    ctx.lineTo(
      selected.center.x + Math.cos(angle - spread) * dist,
      selected.center.y + Math.sin(angle - spread) * dist
    );
    ctx.lineTo(
      selected.center.x + Math.cos(angle + spread) * dist,
      selected.center.y + Math.sin(angle + spread) * dist
    );
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#FB7185';
    ctx.lineWidth = 1.6 / s;
    ctx.setLineDash([3.5 / s, 2.5 / s]);
    ctx.beginPath();
    ctx.moveTo(selected.center.x, selected.center.y);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = '#F43F5E';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8 / s;
    ctx.beginPath();
    ctx.arc(selected.center.x, selected.center.y, 3.8 / s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawOverlayHUD(ctx) {
    ctx.save();
    const x = 22;
    const y = 24;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Rotated 90° clockwise: North points Right
    ctx.fillStyle = '#F43F5E';
    ctx.beginPath();
    ctx.moveTo(x + 9, y);
    ctx.lineTo(x + 1, y - 3.5);
    ctx.lineTo(x + 1, y + 3.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', x - 4, y + 0.5);
    ctx.restore();
  }

  traceRoundedRect(ctx, cx, cy, width, length, radius) {
    const r = Math.min(radius || 0, width / 2, length / 2);
    const x = cx - width / 2;
    const y = cy - length / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + length - r);
    ctx.arcTo(x + width, y + length, x + width - r, y + length, r);
    ctx.lineTo(x + r, y + length);
    ctx.arcTo(x, y + length, x, y + length - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

module.exports = {
  Renderer2D
};
