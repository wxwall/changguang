const { getAllVenues, getVenueById } = require('../../data/venues');
const { calculateSeatSightline } = require('../../utils/schema-geometry');
const { Renderer2D } = require('../../utils/renderer-2d');
const { Renderer3D } = require('../../utils/renderer-3d');

Page({
  data: {
    venues: [],
    currentVenue: null,
    layoutMode: 'split', // '2d' | 'split' | '3d'
    viewMode: 'concert', // 'concert' | 'sports'
    activeTierFilter: 'all',
    cameraMode: 'bird', // 'bird' | 'seat'
    zoomLevel: 1.0,
    zoomOptions: [
      { label: '0.5x 超广角', value: 0.5 },
      { label: '1x 人眼实景', value: 1.0 },
      { label: '2x 望远看台', value: 2.0 },
      { label: '5x 舞台特写', value: 5.0 }
    ],
    sightline: {
      sectorName: '1F-A',
      tierLevel: 1,
      row: 15,
      maxRows: 50,
      seatNo: 16,
      distanceM: 68.5,
      elevationM: 6.2,
      verticalAngleDeg: -4.2,
      cValueMm: 112,
      cValueStatus: '极佳 (FIFA特级视野)',
      slopeDeg: 15,
      rowPitch: 0.84,
      guardrailMaterial: '超白钢化夹胶玻璃栏板'
    },
    showSchemaModal: false,
    customSchemaText: '',
    schemaError: ''
  },

  onLoad() {
    const rawVenues = getAllVenues();
    const formattedVenues = rawVenues.map(v => ({
      ...v,
      shortLabel: v.name.split(' ')[0],
      capLabel: `${v.code} · ${(v.engineeringSummary.totalCapacity / 1000).toFixed(1)}k座`
    }));

    const initialVenue = formattedVenues[0];
    this.activeSelection = {
      tierIndex: 0,
      sector: initialVenue.standTiers[0].sectors[0],
      row: 18,
      seatNo: 16,
      isModule: false
    };

    const sightline = calculateSeatSightline(initialVenue, this.activeSelection, 'concert');

    this.setData({
      venues: formattedVenues,
      currentVenue: initialVenue,
      sightline
    });
  },

  onReady() {
    this.initCanvases();
  },

  onUnload() {
    if (this._rafId && this.canvas3d) {
      this.canvas3d.cancelAnimationFrame(this._rafId);
    }
  },

  initCanvases() {
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 2;

    // 1. Initialize 2D Seatmap Canvas
    wx.createSelectorQuery()
      .in(this)
      .select('#seatmap2d')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const width = res[0].width || 375;
        const height = res[0].height || 260;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        this.renderer2d = new Renderer2D(canvas, ctx, width, height, dpr);
        this.renderer2d.setVenue(this.data.currentVenue, this.data.viewMode);
        this.renderer2d.setSelection(this.activeSelection.sector.id, null);
      });

    // 2. Initialize 3D WebGL Stadium Canvas
    wx.createSelectorQuery()
      .in(this)
      .select('#stadium3d')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const width = res[0].width || 375;
        const height = res[0].height || 280;
        canvas.width = width * dpr;
        canvas.height = height * dpr;

        const gl = canvas.getContext('webgl', { antialias: true, depth: true });
        if (!gl) return;

        this.canvas3d = canvas;
        this.renderer3d = new Renderer3D(canvas, gl, width * dpr, height * dpr);
        this.renderer3d.setVenue(this.data.currentVenue, this.data.viewMode);
        this.renderer3d.setSelection(this.activeSelection.sector.id, null);

        // Start 60fps WebGL render loop
        const loop = () => {
          if (this.renderer3d) {
            this.renderer3d.renderFrame();
          }
          this._rafId = canvas.requestAnimationFrame(loop);
        };
        this._rafId = canvas.requestAnimationFrame(loop);
      });
  },

  refreshCanvasSizes() {
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 2;

    setTimeout(() => {
      if (this.data.layoutMode !== '3d' && this.renderer2d) {
        wx.createSelectorQuery()
          .in(this)
          .select('#seatmap2d')
          .fields({ size: true })
          .exec((res) => {
            if (res && res[0] && res[0].width > 0 && res[0].height > 0) {
              this.renderer2d.canvas.width = res[0].width * dpr;
              this.renderer2d.canvas.height = res[0].height * dpr;
              this.renderer2d.ctx.scale(dpr, dpr);
              this.renderer2d.resize(res[0].width, res[0].height);
            }
          });
      }
      if (this.data.layoutMode !== '2d' && this.renderer3d) {
        wx.createSelectorQuery()
          .in(this)
          .select('#stadium3d')
          .fields({ size: true })
          .exec((res) => {
            if (res && res[0] && res[0].width > 0 && res[0].height > 0) {
              this.renderer3d.canvas.width = res[0].width * dpr;
              this.renderer3d.canvas.height = res[0].height * dpr;
              this.renderer3d.resize(res[0].width * dpr, res[0].height * dpr);
            }
          });
      }
    }, 60);
  },

  // 切换场馆 Schema
  onSelectVenue(e) {
    const venueId = e.currentTarget.dataset.id;
    const venue = this.data.venues.find(v => v.id === venueId) || getVenueById(venueId);
    if (!venue) return;

    wx.setStorageSync('STADIACAD_LAST_VENUE', venue.id);

    const firstTier = venue.standTiers[0];
    const firstSector = firstTier.sectors.find(s => !s.isDeleted && s.fillType !== 'empty-void') || firstTier.sectors[0];

    this.activeSelection = {
      tierIndex: 0,
      sector: firstSector,
      row: Math.ceil((firstSector.rows || 22) * 0.4),
      seatNo: 16,
      isModule: false
    };

    const sightline = calculateSeatSightline(venue, this.activeSelection, this.data.viewMode);

    this.setData({
      currentVenue: venue,
      activeTierFilter: 'all',
      cameraMode: 'bird',
      zoomLevel: 1.0,
      sightline
    });

    if (this.renderer2d) {
      this.renderer2d.setVenue(venue, this.data.viewMode);
      this.renderer2d.setSelection(firstSector.id, null);
    }
    if (this.renderer3d) {
      this.renderer3d.setVenue(venue, this.data.viewMode);
      this.renderer3d.setSelection(firstSector.id, null);
      this.renderer3d.setBirdEyeView();
    }
  },

  // 切换 2D / 2D+3D分屏 / 3D全屏
  onSwitchLayout(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ layoutMode: mode }, () => {
      this.refreshCanvasSizes();
    });
  },

  // 切换 演唱会舞美 / 体育赛场
  onToggleViewMode() {
    const nextMode = this.data.viewMode === 'concert' ? 'sports' : 'concert';
    const sightline = calculateSeatSightline(this.data.currentVenue, this.activeSelection, nextMode);

    this.setData({
      viewMode: nextMode,
      sightline
    });

    if (this.renderer2d) {
      this.renderer2d.setViewMode(nextMode);
    }
    if (this.renderer3d) {
      this.renderer3d.setViewMode(nextMode);
      if (this.data.cameraMode === 'seat') {
        this.renderer3d.flyToSeat(sightline);
      }
    }
  },

  // 2D 看台楼层过滤
  onFilterTier(e) {
    const rawLevel = e.currentTarget.dataset.level;
    const level = rawLevel === 'all' ? 'all' : Number(rawLevel);
    this.setData({ activeTierFilter: level });
    if (this.renderer2d) {
      this.renderer2d.setTierFilter(level);
    }
  },

  onReset2D() {
    if (this.renderer2d) {
      this.renderer2d.resetTransform();
    }
  },

  // 2D Canvas 触摸交互（支持点击选区、单指拖拽平移、双指捏合缩放）
  onTouchStart2D(e) {
    if (!e.touches || e.touches.length === 0) return;
    this._t2dMoved = false;
    if (e.touches.length === 1) {
      this._t2dStart = { x: e.touches[0].x, y: e.touches[0].y };
      this._t2dLast = { x: e.touches[0].x, y: e.touches[0].y };
    } else if (e.touches.length >= 2) {
      const dx = e.touches[0].x - e.touches[1].x;
      const dy = e.touches[0].y - e.touches[1].y;
      this._t2dPinchDist = Math.hypot(dx, dy);
    }
  },

  onTouchMove2D(e) {
    if (!this.renderer2d || !e.touches) return;
    if (e.touches.length === 1 && this._t2dLast) {
      const dx = e.touches[0].x - this._t2dLast.x;
      const dy = e.touches[0].y - this._t2dLast.y;
      if (Math.hypot(e.touches[0].x - this._t2dStart.x, e.touches[0].y - this._t2dStart.y) > 6) {
        this._t2dMoved = true;
      }
      this.renderer2d.offsetX += dx;
      this.renderer2d.offsetY += dy;
      this._t2dLast = { x: e.touches[0].x, y: e.touches[0].y };
      this.renderer2d.render();
    } else if (e.touches.length >= 2) {
      this._t2dMoved = true;
      const dx = e.touches[0].x - e.touches[1].x;
      const dy = e.touches[0].y - e.touches[1].y;
      const dist = Math.hypot(dx, dy);
      if (this._t2dPinchDist > 10) {
        const factor = dist / this._t2dPinchDist;
        this.renderer2d.scale = Math.max(0.65, Math.min(4.5, this.renderer2d.scale * factor));
        this.renderer2d.render();
      }
      this._t2dPinchDist = dist;
    }
  },

  onTouchEnd2D(e) {
    if (this._t2dMoved || !this._t2dStart || !this.renderer2d) return;

    const hit = this.renderer2d.hitTest(this._t2dStart.x, this._t2dStart.y);
    if (!hit) return;

    if (hit.type === 'module') {
      this.activeSelection = {
        isModule: true,
        module: hit.module,
        row: hit.estimatedRow || 2,
        seatNo: 12
      };
      this.renderer2d.setSelection(null, hit.module.id);
      if (this.renderer3d) this.renderer3d.setSelection(null, hit.module.id);
    } else {
      this.activeSelection = {
        isModule: false,
        tierIndex: hit.tierIndex,
        sector: hit.sector,
        row: hit.estimatedRow || 15,
        seatNo: 18
      };
      this.renderer2d.setSelection(hit.sector.id, null);
      if (this.renderer3d) this.renderer3d.setSelection(hit.sector.id, null);
    }

    const sightline = calculateSeatSightline(
      this.data.currentVenue,
      this.activeSelection,
      this.data.viewMode
    );

    this.setData({
      sightline,
      cameraMode: 'seat'
    });

    // Fly 3D camera from Bird's-Eye View directly into selected seat looking at stage/pitch!
    if (this.renderer3d) {
      this.renderer3d.flyToSeat(sightline);
    }
  },

  // 3D WebGL 触摸旋转/环绕与双指变焦
  onTouchStart3D(e) {
    if (!e.touches || e.touches.length === 0) return;
    if (e.touches.length === 1) {
      this._t3dLast = { x: e.touches[0].x, y: e.touches[0].y };
    } else if (e.touches.length >= 2) {
      const dx = e.touches[0].x - e.touches[1].x;
      const dy = e.touches[0].y - e.touches[1].y;
      this._t3dPinchDist = Math.hypot(dx, dy);
    }
  },

  onTouchMove3D(e) {
    if (!this.renderer3d || !e.touches) return;
    if (e.touches.length === 1 && this._t3dLast) {
      const dx = e.touches[0].x - this._t3dLast.x;
      const dy = e.touches[0].y - this._t3dLast.y;
      this.renderer3d.handleTouchDrag(dx, dy);
      this._t3dLast = { x: e.touches[0].x, y: e.touches[0].y };
    } else if (e.touches.length >= 2) {
      const dx = e.touches[0].x - e.touches[1].x;
      const dy = e.touches[0].y - e.touches[1].y;
      const dist = Math.hypot(dx, dy);
      if (this._t3dPinchDist > 10) {
        this.renderer3d.handlePinchZoom(dist / this._t3dPinchDist);
        this.setData({ zoomLevel: Number(this.renderer3d.zoomLevel.toFixed(1)) });
      }
      this._t3dPinchDist = dist;
    }
  },

  onTouchEnd3D() {
    this._t3dLast = null;
  },

  // 返回 3D 鸟瞰视角
  onReturnBirdEye() {
    this.setData({
      cameraMode: 'bird',
      zoomLevel: 1.0
    });
    if (this.renderer3d) {
      this.renderer3d.setBirdEyeView();
    }
  },

  // 3D 舞台实景光学缩放切换 (0.5x, 1x, 2x, 5x)
  onSelectZoom(e) {
    const zoom = Number(e.currentTarget.dataset.zoom);
    this.setData({ zoomLevel: zoom });
    if (this.renderer3d) {
      this.renderer3d.setZoom(zoom);
    }
  },

  // 排数滑块实时微调，动态更新 3D 摄像机高度与距离
  onRowChanging(e) {
    this.updateRowSightline(Number(e.detail.value));
  },

  onRowChange(e) {
    this.updateRowSightline(Number(e.detail.value));
  },

  updateRowSightline(rowNumber) {
    if (!this.activeSelection) return;
    this.activeSelection.row = rowNumber;
    const sightline = calculateSeatSightline(
      this.data.currentVenue,
      this.activeSelection,
      this.data.viewMode
    );
    this.setData({
      sightline,
      cameraMode: 'seat'
    });
    if (this.renderer3d) {
      this.renderer3d.flyToSeat(sightline);
    }
  },

  // 自定义 Schema 导入弹窗
  onOpenSchemaModal() {
    this.setData({
      showSchemaModal: true,
      schemaError: '',
      customSchemaText: ''
    });
  },

  onCloseSchemaModal() {
    this.setData({ showSchemaModal: false });
  },

  onSchemaInput(e) {
    this.setData({ customSchemaText: e.detail.value, schemaError: '' });
  },

  onApplyCustomSchema() {
    const raw = (this.data.customSchemaText || '').trim();
    if (!raw) {
      this.setData({ schemaError: '请粘贴有效的 STADIACAD Schema JSON 内容' });
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.infield || !Array.isArray(parsed.standTiers)) {
        this.setData({ schemaError: 'Schema 缺少核心字段 (infield 或 standTiers)' });
        return;
      }
      const newVenue = {
        ...parsed,
        id: parsed.id || `custom-${Date.now()}`,
        shortLabel: (parsed.name || '自定义场馆').split(' ')[0],
        capLabel: `${parsed.code || 'CUSTOM'} · ${(((parsed.engineeringSummary && parsed.engineeringSummary.totalCapacity) || 50000) / 1000).toFixed(1)}k座`
      };

      const updatedVenues = [...this.data.venues, newVenue];
      const firstSector = newVenue.standTiers[0].sectors[0];
      this.activeSelection = {
        tierIndex: 0,
        sector: firstSector,
        row: 12,
        seatNo: 10,
        isModule: false
      };

      const sightline = calculateSeatSightline(newVenue, this.activeSelection, this.data.viewMode);

      this.setData({
        venues: updatedVenues,
        currentVenue: newVenue,
        sightline,
        showSchemaModal: false,
        cameraMode: 'bird'
      });

      if (this.renderer2d) {
        this.renderer2d.setVenue(newVenue, this.data.viewMode);
        this.renderer2d.setSelection(firstSector.id, null);
      }
      if (this.renderer3d) {
        this.renderer3d.setVenue(newVenue, this.data.viewMode);
        this.renderer3d.setSelection(firstSector.id, null);
        this.renderer3d.setBirdEyeView();
      }
    } catch (err) {
      this.setData({ schemaError: 'JSON 语法解析失败，请检查格式是否完整' });
    }
  }
});
