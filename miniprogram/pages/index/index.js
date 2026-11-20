const { loadAllStadiumProjects } = require('../../services/venue-service');
const {
  calculateSeatSightline,
  findDefaultEastFirstRowSelection,
  normalizeVenueCoordinates
} = require('../../utils/schema-geometry');
const { Renderer2D } = require('../../utils/renderer-2d');
const { Renderer3D } = require('../../utils/renderer-3d');

Page({
  data: {
    venues: [],
    currentVenue: null,
    loadingVenues: true,
    is3DFullscreen: false,
    viewMode: 'concert', // 'concert' | 'sports'
    activeTierFilter: 'all',
    cameraMode: 'bird', // 'bird' | 'seat'
    zoomLevel: 1.0,
    zoomOptions: [
      { label: '0.5x', value: 0.5 },
      { label: '1x', value: 1.0 },
      { label: '2x', value: 2.0 },
      { label: '5x', value: 5.0 }
    ],
    sightline: {
      sectorName: '1F-E',
      tierLevel: 1,
      row: 1,
      maxRows: 30,
      seatNo: 16,
      distanceM: 68.5,
      elevationM: 2.2,
      verticalAngleDeg: -1.5,
      cValueMm: 112,
      cValueStatus: '极佳 (FIFA特级视野)',
      slopeDeg: 15,
      rowPitch: 0.84,
      guardrailMaterial: '超白钢化夹胶玻璃栏板'
    },
    showSchemaModal: false,
    schemaTextareaFocus: false,
    customSchemaText: '',
    schemaError: ''
  },

  onLoad() {
    this.loadVenuesData();
  },

  async loadVenuesData() {
    wx.showLoading({ title: '加载场馆数据...', mask: true });
    this.setData({ loadingVenues: true });

    try {
      const venues = await loadAllStadiumProjects();
      if (!venues || venues.length === 0) {
        wx.showToast({ title: '数据库暂无场馆数据', icon: 'none', duration: 2500 });
        this.setData({ loadingVenues: false });
        return;
      }

      const savedVenueId = wx.getStorageSync('STADIACAD_LAST_VENUE');
      let initialVenue = null;
      if (savedVenueId) {
        initialVenue = venues.find(v => v.id === savedVenueId || v._id === savedVenueId);
      }
      if (!initialVenue) {
        initialVenue = venues[0];
      }

      this.activeSelection = findDefaultEastFirstRowSelection(initialVenue);
      const sightline = calculateSeatSightline(initialVenue, this.activeSelection, this.data.viewMode);

      this.setData({
        venues,
        currentVenue: initialVenue,
        sightline,
        cameraMode: 'bird',
        loadingVenues: false
      });

      this.applyVenueToRenderers(initialVenue, sightline, 'bird');
    } catch (err) {
      console.error('从云数据库加载场馆失败:', err);
      wx.showToast({
        title: '加载失败: ' + (err.message || '网络或权限异常'),
        icon: 'none',
        duration: 3500
      });
      this.setData({ loadingVenues: false });
    } finally {
      wx.hideLoading();
    }
  },

  applyVenueToRenderers(venue, sightline, cameraMode = 'bird') {
    if (!venue) return;
    if (this.renderer2d) {
      this.renderer2d.setVenue(venue, this.data.viewMode);
    }
    if (this.renderer3d) {
      this.renderer3d.setVenue(venue, this.data.viewMode, this.getSelectionIds());
      if (cameraMode === 'seat' && sightline) {
        this.renderer3d.flyToSeat(sightline);
      } else {
        this.renderer3d.setBirdEyeView();
      }
    }
    this.applySelectionToRenderers();
  },

  onReady() {
    this.initCanvases();
  },

  onUnload() {
    if (this._rafId && this.canvas3d) {
      this.canvas3d.cancelAnimationFrame(this._rafId);
    }
  },

  noop() {},

  initCanvases() {
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 2;
    this._dpr = dpr;

    // 1. Initialize 2D Seatmap Canvas
    wx.createSelectorQuery()
      .in(this)
      .select('#seatmap2d')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const width = res[0].width || 375;
        const height = res[0].height || 280;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.renderer2d = new Renderer2D(canvas, ctx, width, height, dpr);
        if (this.data.currentVenue) {
          this.renderer2d.setVenue(this.data.currentVenue, this.data.viewMode);
          this.applySelectionToRenderers();
        }
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
        const height = res[0].height || 260;
        canvas.width = width * dpr;
        canvas.height = height * dpr;

        const gl = canvas.getContext('webgl', { antialias: true, depth: true });
        if (!gl) return;

        this.canvas3d = canvas;
        this._canvas3dCss = { w: width, h: height };
        this.renderer3d = new Renderer3D(canvas, gl, width * dpr, height * dpr);
        if (this.data.currentVenue) {
          this.renderer3d.setVenue(this.data.currentVenue, this.data.viewMode, this.getSelectionIds());
          this.applySelectionToRenderers();
          if (this.data.cameraMode === 'seat' && this.data.sightline) {
            this.renderer3d.flyToSeat(this.data.sightline);
          } else {
            this.renderer3d.setBirdEyeView();
          }
        }

        const loop = () => {
          if (this.renderer3d) {
            this.renderer3d.renderFrame();
          }
          this._rafId = canvas.requestAnimationFrame(loop);
        };
        this._rafId = canvas.requestAnimationFrame(loop);
      });
  },

  getSelectionIds() {
    const sel = this.activeSelection || {};
    return {
      sectorId: !sel.isModule && !sel.isFloorBlock && sel.sector ? sel.sector.id : null,
      moduleId: sel.isModule && sel.module ? sel.module.id : null,
      floorBlockId: sel.isFloorBlock && sel.floorBlock ? sel.floorBlock.id : null
    };
  },

  applySelectionToRenderers() {
    const { sectorId, moduleId, floorBlockId } = this.getSelectionIds();

    if (this.renderer2d) {
      this.renderer2d.setSelection(sectorId, moduleId, floorBlockId);
    }
    if (this.renderer3d) {
      this.renderer3d.setSelection(sectorId, moduleId, floorBlockId);
    }
  },

  refreshCanvasSizes() {
    const dpr = this._dpr || wx.getSystemInfoSync().pixelRatio || 2;

    setTimeout(() => {
      if (!this.data.is3DFullscreen && this.renderer2d) {
        wx.createSelectorQuery()
          .in(this)
          .select('#seatmap2d')
          .fields({ size: true })
          .exec((res) => {
            if (res && res[0] && res[0].width > 0 && res[0].height > 0) {
              this.renderer2d.canvas.width = res[0].width * dpr;
              this.renderer2d.canvas.height = res[0].height * dpr;
              this.renderer2d.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              this.renderer2d.resize(res[0].width, res[0].height);
            }
          });
      }
      if (this.renderer3d) {
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
    }, 80);
  },

  // 切换场馆 Schema（默认选中东边第1排区域）
  onSelectVenue(e) {
    const venueId = e.currentTarget.dataset.id;
    const venue = this.data.venues.find(v => v.id === venueId || v._id === venueId);
    if (!venue) return;

    wx.setStorageSync('STADIACAD_LAST_VENUE', venue.id);

    this.activeSelection = findDefaultEastFirstRowSelection(venue);
    const sightline = calculateSeatSightline(venue, this.activeSelection, this.data.viewMode);

    this.setData({
      currentVenue: venue,
      activeTierFilter: 'all',
      cameraMode: 'seat',
      zoomLevel: 1.0,
      sightline
    });

    this.applyVenueToRenderers(venue, sightline);
  },

  // 3D 全屏 / 退出全屏切换
  onToggle3DFullscreen() {
    this.setData({
      is3DFullscreen: !this.data.is3DFullscreen
    }, () => {
      this.refreshCanvasSizes();
    });
  },

  // 切换 演唱会舞美 / 标准赛场
  onToggleViewMode() {
    const nextMode = this.data.viewMode === 'concert' ? 'sports' : 'concert';
    // Switching modes clears incompatible infield-only selections back to East Row 1
    if (
      (nextMode === 'sports' && this.activeSelection && this.activeSelection.isFloorBlock) ||
      (nextMode === 'concert' && this.activeSelection && this.activeSelection.isModule)
    ) {
      this.activeSelection = findDefaultEastFirstRowSelection(this.data.currentVenue);
      this.applySelectionToRenderers();
    }

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

  // 2D Canvas 触摸交互（点击选区、单指平移、双指缩放）
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
      const distFromStart = Math.hypot(e.touches[0].x - this._t2dStart.x, e.touches[0].y - this._t2dStart.y);
      if (!this._t2dMoved && distFromStart <= 7) {
        return;
      }
      this._t2dMoved = true;
      const dx = e.touches[0].x - this._t2dLast.x;
      const dy = e.touches[0].y - this._t2dLast.y;
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

  onTouchEnd2D() {
    if (this._t2dMoved || !this._t2dStart || !this.renderer2d) {
      this._t2dStart = null;
      this._t2dLast = null;
      return;
    }

    const start = this._t2dStart;
    this._t2dStart = null;
    this._t2dLast = null;

    const hit = this.renderer2d.hitTest(start.x, start.y);
    if (hit) this.selectFromHit(hit);
  },

  // 2D / 3D 点选后统一的选中与进入座席视角逻辑
  selectFromHit(hit) {
    if (hit.type === 'floor') {
      this.activeSelection = {
        isFloorBlock: true,
        isModule: false,
        floorBlock: hit.floorBlock,
        row: hit.estimatedRow || 3,
        seatNo: 10
      };
    } else if (hit.type === 'module') {
      this.activeSelection = {
        isFloorBlock: false,
        isModule: true,
        module: hit.module,
        row: hit.estimatedRow || 2,
        seatNo: 12
      };
    } else {
      this.activeSelection = {
        isFloorBlock: false,
        isModule: false,
        tierIndex: hit.tierIndex,
        sector: hit.sector,
        row: hit.estimatedRow || 1,
        seatNo: 16
      };
    }

    this.applySelectionToRenderers();

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

  // 3D WebGL 触摸旋转/环绕与双指变焦
  onTouchStart3D(e) {
    if (!e.touches || e.touches.length === 0) return;
    if (e.touches.length === 1) {
      this._t3dLast = { x: e.touches[0].x, y: e.touches[0].y };
      this._t3dStart = { x: e.touches[0].x, y: e.touches[0].y };
      this._t3dMoved = false;
    } else if (e.touches.length >= 2) {
      this._t3dMoved = true;
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
      if (this._t3dStart && Math.hypot(e.touches[0].x - this._t3dStart.x, e.touches[0].y - this._t3dStart.y) > 7) {
        this._t3dMoved = true;
      }
      this.renderer3d.handleTouchDrag(dx, dy);
      this._t3dLast = { x: e.touches[0].x, y: e.touches[0].y };
    } else if (e.touches.length >= 2) {
      this._t3dMoved = true;
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
    const start = this._t3dStart;
    const moved = this._t3dMoved;
    this._t3dLast = null;
    this._t3dStart = null;
    this._t3dMoved = false;

    if (moved || !start || !this.renderer3d || !this._canvas3dCss) return;
    const { w, h } = this._canvas3dCss;
    if (!w || !h) return;

    const hit = this.renderer3d.pickAt(start.x / w, start.y / h);
    if (hit) this.selectFromHit(hit);
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

  // 一键飞入当前默认/所选席位
  onFlyToSelectedSeat() {
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

  // 3D 舞台实景光学缩放切换 (0.5x, 1x, 2x, 5x)
  onSelectZoom(e) {
    const zoom = Number(e.currentTarget.dataset.zoom);
    this.setData({ zoomLevel: zoom });
    if (this.renderer3d) {
      this.renderer3d.setZoom(zoom);
    }
  },

  // 排数滑块实时微调
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

  // 自定义 Schema 导入弹窗（通过 offscreen 隐藏原生 Canvas 后聚焦）
  onOpenSchemaModal() {
    this.setData({
      showSchemaModal: true,
      schemaError: '',
      customSchemaText: '',
      schemaTextareaFocus: false
    }, () => {
      setTimeout(() => {
        this.setData({ schemaTextareaFocus: true });
      }, 120);
    });
  },

  onCloseSchemaModal() {
    this.setData({
      showSchemaModal: false,
      schemaTextareaFocus: false
    }, () => {
      this.refreshCanvasSizes();
    });
  },

  onPasteClipboard() {
    wx.getClipboardData({
      success: (res) => {
        if (res && res.data) {
          this.setData({
            customSchemaText: res.data,
            schemaError: ''
          });
        } else {
          this.setData({ schemaError: '剪贴板为空，请先复制 Schema JSON' });
        }
      },
      fail: () => {
        this.setData({ schemaError: '读取剪贴板失败，请直接手动粘贴' });
      }
    });
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
      const newVenue = normalizeVenueCoordinates({
        ...parsed,
        id: parsed.id || `custom-${Date.now()}`,
        shortLabel: (parsed.name || '自定义场馆').split(' ')[0],
        capLabel: `${parsed.code || 'CUSTOM'} · ${(((parsed.engineeringSummary && parsed.engineeringSummary.totalCapacity) || 50000) / 1000).toFixed(1)}k座`
      });

      const updatedVenues = [...this.data.venues, newVenue];
      this.activeSelection = findDefaultEastFirstRowSelection(newVenue);
      const sightline = calculateSeatSightline(newVenue, this.activeSelection, this.data.viewMode);

      this.setData({
        venues: updatedVenues,
        currentVenue: newVenue,
        activeTierFilter: 'all',
        sightline,
        showSchemaModal: false,
        schemaTextareaFocus: false,
        cameraMode: 'seat',
        zoomLevel: 1.0
      }, () => {
        this.refreshCanvasSizes();
      });

      if (this.renderer2d) {
        this.renderer2d.setVenue(newVenue, this.data.viewMode);
      }
      if (this.renderer3d) {
        this.renderer3d.setVenue(newVenue, this.data.viewMode, this.getSelectionIds());
        this.renderer3d.flyToSeat(sightline);
      }
      this.applySelectionToRenderers();
    } catch (err) {
      this.setData({ schemaError: 'JSON 语法解析失败，请检查格式是否完整' });
    }
  }
});
