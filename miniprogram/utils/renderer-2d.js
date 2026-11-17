/**
 * STADIACAD 2D Interactive Seat Map Renderer
 * Uses WeChat Mini Program <canvas type="2d"> API
 */

const {
  DEG2RAD,
  getRayRoundedRectDistance,
  computeTierRadialBounds
} = require('./schema-geometry');

const TIER_COLORS = [
  { base: '#1E3A8A', stroke: '#3B82F6', hover: '#2563EB', label: '#93C5FD' }, // 1F Lower Bowl
  { base: '#065F46', stroke: '#10B981', hover: '#059669', label: '#6EE7B7' }, // 2F Club / Tier 2
  { base: '#78350F', stroke: '#F59E0B', hover: '#D97706', label: '#FDE68A' }, // 3F VIP / Tier 3
  { base: '#4C1D95', stroke: '#8B5CF6', hover: '#7C3AED', label: '#DDD6FE' }  // 4F Upper Bowl
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
    this.selectedPoint = null;

    // Pan & Zoom state
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.baseMeterToPx = 1.0;

    // Cached hit-test polygons
    this.hitPolygons = [];
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

  setSelection(sectorId, moduleId) {
    this.selectedSectorId = sectorId;
    this.selectedModuleId = moduleId;
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
    const maxDim = Math.max(
      summary.outermostFootprintLengthM || 280,
      summary.outermostFootprintWidthM || 240
    );
    const minCanvasSide = Math.min(this.width, this.height);
    this.baseMeterToPx = (minCanvasSide * 0.84) / maxDim;
  }

  /**
   * Precomputes 2D meter-space polygons for all sectors and infield modules
   * so rendering and touch hit-testing are super fast (60fps).
   */
  buildGeometryCache() {
    this.hitPolygons = [];
    if (!this.venue) return;

    const tiers = this.venue.standTiers || [];
    // Build from outer tier to inner tier or inner to outer
    tiers.forEach((tier, tierIndex) => {
      const sectors = tier.sectors || [];
      sectors.forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void') return;

        const startDeg = sec.startAngleDeg;
        const endDeg = sec.endAngleDeg;
        const steps = Math.max(4, Math.ceil((endDeg - startDeg) / 4));
        const aisleGapDeg = 0.35; // visual gap between sectors
        const sDeg = startDeg + aisleGapDeg;
        const eDeg = endDeg - aisleGapDeg;
        if (eDeg <= sDeg) return;

        const innerPts = [];
        const outerPts = [];

        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const deg = sDeg + (eDeg - sDeg) * t;
          const rad = deg * DEG2RAD;
          const sinA = Math.sin(rad);
          const cosA = -Math.cos(rad); // North is up (-Y in screen space)

          const bounds = computeTierRadialBounds(this.venue, tierIndex, deg, sec.customRadialDepth);
          innerPts.push({ x: sinA * bounds.innerRadius, y: cosA * bounds.innerRadius });
          outerPts.push({ x: sinA * bounds.outerRadius, y: cosA * bounds.outerRadius });
        }

        const polygon = [...innerPts, ...outerPts.reverse()];
        const midDeg = (sDeg + eDeg) / 2;
        const midRad = midDeg * DEG2RAD;
        const midBounds = computeTierRadialBounds(this.venue, tierIndex, midDeg, sec.customRadialDepth);
        const midR = (midBounds.innerRadius + midBounds.outerRadius) / 2;

        // Vomitory position in meter space
        let vomitoryRect = null;
        if (sec.vomitory && sec.vomitory.position !== 'none' && sec.vomitory.enabled !== false) {
          const vomR = midBounds.innerRadius + (midBounds.outerRadius - midBounds.innerRadius) * 0.42;
          vomitoryRect = {
            x: Math.sin(midRad) * vomR,
            y: -Math.cos(midRad) * vomR,
            angleRad: midRad,
            w: sec.vomitory.width || 3.2,
            h: Math.min(6, (midBounds.outerRadius - midBounds.innerRadius) * 0.35)
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
            x: Math.sin(midRad) * midR,
            y: -Math.cos(midRad) * midR
          },
          vomitory: vomitoryRect
        });
      });
    });

    // Infield modules
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
        tierLevel: 1,
        polygon,
        center: { x: mod.x || 0, y: mod.y || 0 }
      });
    });
  }

  /**
   * Converts screen touch (px, py) to meter space and finds hit sector/module
   */
  hitTest(screenX, screenY) {
    const cx = this.width / 2 + this.offsetX;
    const cy = this.height / 2 + this.offsetY;
    const s = this.baseMeterToPx * this.scale;

    const mx = (screenX - cx) / s;
    const my = (screenY - cy) / s;

    // Search from top-most / specific to outer
    for (let i = this.hitPolygons.length - 1; i >= 0; i--) {
      const item = this.hitPolygons[i];
      if (this.activeTierFilter !== 'all' && item.tierLevel !== this.activeTierFilter) {
        continue;
      }
      if (this.pointInPolygon(mx, my, item.polygon)) {
        // Estimate relative row position based on radial distance
        let rowRatio = 0.5;
        if (item.type === 'sector') {
          const dist = Math.sqrt(mx * mx + my * my);
          const angleDeg = (Math.atan2(mx, -my) * 180 / Math.PI + 360) % 360;
          const bounds = computeTierRadialBounds(this.venue, item.tierIndex, angleDeg, item.sector.customRadialDepth);
          rowRatio = Math.max(0.05, Math.min(0.95, (dist - bounds.innerRadius) / Math.max(1, bounds.outerRadius - bounds.innerRadius)));
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
    // Background
    ctx.fillStyle = '#070A12';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2 + this.offsetX;
    const cy = h / 2 + this.offsetY;
    const s = this.baseMeterToPx * this.scale;

    ctx.translate(cx, cy);
    ctx.scale(s, s);

    // 1. Polar & Cartesian Engineering Grid
    this.drawGrid(ctx, s);

    // 2. Infield & Pitch / Track / Court
    this.drawInfield(ctx, s);

    // 3. Stage & FOH (if concert mode or overlay)
    if (this.viewMode === 'concert') {
      this.drawStage2D(ctx, s);
    }

    // 4. Stand Tiers & Sectors
    this.drawSectors(ctx, s);

    // 5. Sightline Vector from Selected Sector to Stage/Pitch
    this.drawSightlineRay(ctx, s);

    ctx.restore();

    // 6. Compass & Scale Bar HUD on 2D Canvas
    this.drawOverlayHUD(ctx);
  }

  drawGrid(ctx, s) {
    const grid = this.venue.gridSystem || {};
    if (!grid.enabled) return;

    const maxR = 200;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1 / s;

    // Polar rings
    if (grid.showPolarGrid) {
      for (let r = 40; r <= maxR; r += 40) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const stepDeg = grid.polarAngleStepDeg || 18;
      for (let deg = 0; deg < 360; deg += stepDeg) {
        const rad = deg * DEG2RAD;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.sin(rad) * maxR, -Math.cos(rad) * maxR);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawInfield(ctx, s) {
    const infield = this.venue.infield;
    if (!infield) return;

    ctx.save();
    // Draw rounded-rect infield perimeter
    this.traceRoundedRect(ctx, 0, 0, infield.width, infield.length, infield.cornerRadius);
    if (infield.surfaceType === 'synthetic-track') {
      ctx.fillStyle = '#7C2D12'; // Brick red Olympic running track
    } else if (infield.surfaceType === 'hardwood-court') {
      ctx.fillStyle = '#1E293B';
    } else {
      ctx.fillStyle = '#064E3B';
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2 / s;
    ctx.stroke();

    // If track-field, draw 400m oval lanes
    if (infield.sportPreset === 'track-field') {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 0.8 / s;
      for (let lane = 1; lane <= 4; lane++) {
        const shrink = lane * 2.2;
        this.traceRoundedRect(
          ctx,
          0,
          0,
          infield.width - shrink * 2,
          infield.length - shrink * 2,
          Math.max(4, infield.cornerRadius - shrink)
        );
        ctx.stroke();
      }
    }

    // Draw central pitch / court
    const pw = infield.pitchWidth || 68;
    const pl = infield.pitchLength || 105;

    if (infield.surfaceType === 'hardwood-court') {
      ctx.fillStyle = '#B45309';
      ctx.fillRect(-pw / 2, -pl / 2, pw, pl);
      ctx.strokeStyle = '#FDE68A';
      ctx.lineWidth = 1 / s;
      ctx.strokeRect(-pw / 2, -pl / 2, pw, pl);
      // Center circle
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-pw / 2, 0);
      ctx.lineTo(pw / 2, 0);
      ctx.stroke();
    } else {
      // Turf pitch with stripes
      ctx.fillStyle = '#047857';
      ctx.fillRect(-pw / 2, -pl / 2, pw, pl);
      const stripes = 10;
      const stripeH = pl / stripes;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
      for (let i = 0; i < stripes; i += 2) {
        ctx.fillRect(-pw / 2, -pl / 2 + i * stripeH, pw, stripeH);
      }

      // Pitch lines
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1 / s;
      ctx.strokeRect(-pw / 2, -pl / 2, pw, pl);
      ctx.beginPath();
      ctx.moveTo(-pw / 2, 0);
      ctx.lineTo(pw / 2, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 9.15, 0, Math.PI * 2);
      ctx.stroke();
      // Penalty boxes
      ctx.strokeRect(-20.15, -pl / 2, 40.3, 16.5);
      ctx.strokeRect(-20.15, pl / 2 - 16.5, 40.3, 16.5);
    }
    ctx.restore();
  }

  drawStage2D(ctx, s) {
    const stage = this.venue.infield && this.venue.infield.stageConfig;
    if (!stage) return;

    ctx.save();
    const sw = stage.width || 30;
    const sd = stage.depth || 20;

    if (stage.type === 'center-stage') {
      // 360 Center stage
      ctx.fillStyle = 'rgba(236, 72, 153, 0.25)';
      ctx.fillRect(-sw / 2 - 2, -sd / 2 - 2, sw + 4, sd + 4);

      ctx.fillStyle = '#DB2777';
      ctx.strokeStyle = '#F472B6';
      ctx.lineWidth = 1.5 / s;
      ctx.fillRect(-sw / 2, -sd / 2, sw, sd);
      ctx.strokeRect(-sw / 2, -sd / 2, sw, sd);

      // Catwalks in 4 directions
      const cw = stage.catwalkWidth || 3.2;
      const cl = stage.catwalkLength || 10;
      ctx.fillStyle = '#F43F5E';
      ctx.fillRect(-cw / 2, -sd / 2 - cl, cw, cl);
      ctx.fillRect(-cw / 2, sd / 2, cw, cl);
      ctx.fillRect(-sw / 2 - cl, -cw / 2, cl, cw);
      ctx.fillRect(sw / 2, -cw / 2, cl, cw);
    } else {
      // End-stage or Festival-stage positioned at North end facing South
      const stageY = -(this.venue.infield.pitchLength || 100) * 0.36;
      ctx.translate(0, stageY);

      // Glow aura
      ctx.fillStyle = 'rgba(236, 72, 153, 0.22)';
      ctx.beginPath();
      ctx.arc(0, sd / 2, sw * 0.75, 0, Math.PI);
      ctx.fill();

      // Main stage deck
      ctx.fillStyle = '#BE185D';
      ctx.strokeStyle = '#F472B6';
      ctx.lineWidth = 1.5 / s;
      ctx.fillRect(-sw / 2, -sd / 2, sw, sd);
      ctx.strokeRect(-sw / 2, -sd / 2, sw, sd);

      // LED Backdrop bar
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(-sw * 0.6, -sd / 2 - 2.5, sw * 1.2, 2.5);

      // Catwalk extending South (+Y)
      const cw = stage.catwalkWidth || 3.5;
      const cl = stage.catwalkLength || 18;
      ctx.fillStyle = '#E11D48';
      ctx.fillRect(-cw / 2, sd / 2, cw, cl);
      ctx.strokeRect(-cw / 2, sd / 2, cw, cl);

      // FOH Mix Tower
      if (stage.fohEnabled) {
        const fohDist = stage.fohDistance || 38;
        const fw = stage.fohWidth || 8;
        const fd = stage.fohDepth || 5;
        ctx.fillStyle = '#0284C7';
        ctx.strokeStyle = '#7DD3FC';
        ctx.fillRect(-fw / 2, sd / 2 + fohDist, fw, fd);
        ctx.strokeRect(-fw / 2, sd / 2 + fohDist, fw, fd);
      }
    }

    // Label STAGE
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.max(8, Math.round(11 / s))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STAGE 舞台', 0, 0);
    ctx.restore();
  }

  drawSectors(ctx, s) {
    const showVomitories = this.venue.gridSystem && this.venue.gridSystem.showVomitories;

    this.hitPolygons.forEach((item) => {
      const isDimmed = this.activeTierFilter !== 'all' && item.tierLevel !== this.activeTierFilter;
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
        ctx.fillStyle = isSelected ? '#34D399' : (item.module.color || '#10B981');
        ctx.globalAlpha = isDimmed ? 0.18 : (isSelected ? 0.95 : 0.78);
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#FFFFFF' : '#A7F3D0';
        ctx.lineWidth = (isSelected ? 2.2 : 1.0) / s;
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

        ctx.globalAlpha = isDimmed ? 0.14 : (isSelected ? 0.95 : 0.82);
        ctx.fill();

        ctx.strokeStyle = isSelected ? '#FFFFFF' : (isVip ? '#FBBF24' : palette.stroke);
        ctx.lineWidth = (isSelected ? 2.4 : 0.9) / s;
        ctx.stroke();

        // Draw Vomitory portal if enabled
        if (showVomitories && item.vomitory && !isDimmed) {
          ctx.save();
          ctx.translate(item.vomitory.x, item.vomitory.y);
          ctx.rotate(item.vomitory.angleRad);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 0.7 / s;
          ctx.fillRect(-item.vomitory.w / 2, -item.vomitory.h / 2, item.vomitory.w, item.vomitory.h);
          ctx.strokeRect(-item.vomitory.w / 2, -item.vomitory.h / 2, item.vomitory.w, item.vomitory.h);
          ctx.restore();
        }

        // Draw Sector Label if zoom/scale permits or selected
        if (!isDimmed && (this.scale >= 0.85 || isSelected || item.tierLevel === 1 || item.tierLevel === 4)) {
          const shortLabel = item.sector.name.length > 7
            ? item.sector.name.slice(0, 6) + '…'
            : item.sector.name;
          ctx.fillStyle = isSelected ? '#FFFFFF' : palette.label;
          const fontSize = Math.max(3.2, Math.min(7.5, 9.5 / Math.sqrt(this.scale))) / (this.baseMeterToPx * 0.45);
          ctx.font = `${isSelected ? 'bold ' : ''}${fontSize.toFixed(1)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(shortLabel, item.center.x, item.center.y);
        }
      }
      ctx.restore();
    });
  }

  drawSightlineRay(ctx, s) {
    const selected = this.hitPolygons.find(
      it => (it.type === 'sector' && it.id === this.selectedSectorId) ||
            (it.type === 'module' && it.id === this.selectedModuleId)
    );
    if (!selected) return;

    let targetX = 0;
    let targetY = 0;
    const stage = this.venue.infield && this.venue.infield.stageConfig;
    if (this.viewMode === 'concert' && stage && stage.type !== 'center-stage') {
      targetY = -(this.venue.infield.pitchLength || 100) * 0.36;
    }

    ctx.save();
    // Viewing cone
    const angle = Math.atan2(targetY - selected.center.y, targetX - selected.center.x);
    const dist = Math.hypot(targetX - selected.center.x, targetY - selected.center.y);
    const spread = 0.22;

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

    // Dashed sightline ray
    ctx.strokeStyle = '#FB7185';
    ctx.lineWidth = 1.8 / s;
    ctx.setLineDash([4 / s, 3 / s]);
    ctx.beginPath();
    ctx.moveTo(selected.center.x, selected.center.y);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    // Seat viewpoint pin
    ctx.setLineDash([]);
    ctx.fillStyle = '#F43F5E';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8 / s;
    ctx.beginPath();
    ctx.arc(selected.center.x, selected.center.y, 4.5 / s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawOverlayHUD(ctx) {
    ctx.save();
    // North Compass top-left
    const x = 28;
    const y = 32;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#F43F5E';
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x - 4, y + 2);
    ctx.lineTo(x + 4, y + 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', x, y + 11);
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
