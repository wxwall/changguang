const { loadAllStadiumProjects, loadStadiumProjectById } = require('../../services/venue-service');
const {
  calculateSeatSightline,
  findDefaultEastFirstRowSelection
} = require('../../utils/schema-geometry');
const { Renderer2D } = require('../../utils/renderer-2d');
const { Renderer3D } = require('../../utils/renderer-3d');
const {
  SEAT_COLOR_SWATCHES,
  SEAT_THEME_PRESETS,
  getSwatchesForTarget,
  getDefaultHexForTarget
} = require('../../utils/seat-colors');

const SEAT_COLORS_STORAGE_KEY = 'STADIACAD_SEAT_COLORS';
const SCENE_ORDER = ['floating-island', 'default', 'lights-off'];

function toViewVenue(venue) {
  if (!venue) return null;
  return {
    id: venue.id,
    _id: venue._id,
    standTiers: Array.isArray(venue.standTiers)
      ? venue.standTiers.map(t => ({ id: t.id, level: t.level }))
      : []
  };
}

Page({
  data: {
    venues: [],
    homeVenues: [],
    currentVenue: null,
    loadingVenues: true,
    isVenueSwitching: false,
    switchingFade: false,
    switchingVenueName: '',
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
    showColorPicker: false,
    seatColorSwatches: SEAT_COLOR_SWATCHES,
    seatThemePresets: SEAT_THEME_PRESETS,
    colorTargets: [],
    activeColorTarget: '1',
    activeTargetHex: '#2B5EB8',
    activeThemePreset: 'default',
    activeSceneId: 'floating-island'
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
      const colorState = this.buildColorPickerState(initialVenue);

      this._venues = venues;
      this._currentVenue = initialVenue;
      const homeVenues = venues.slice(0, 5).map(v => ({
        id: v.id,
        _id: v._id,
        shortLabel: v.shortLabel,
        capLabel: v.capLabel
      }));

      this.setData({
        homeVenues,
        currentVenue: toViewVenue(initialVenue),
        sightline,
        cameraMode: 'bird',
        loadingVenues: false,
        ...colorState
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

  getCurrentVenue() {
    return this._currentVenue || this.data.currentVenue;
  },

  applyVenueToRenderers(venue, sightline, cameraMode = 'bird') {
    if (!venue) return;
    const overrides = this.getSavedVenueColors(venue.id);
    if (this.renderer2d) {
      this.renderer2d.tierColorOverrides = Object.assign({}, overrides);
      this.renderer2d.setVenue(venue, this.data.viewMode);
      this.renderer2d.setTierFilter(this.data.activeTierFilter || 'all');
    }
    if (this.renderer3d) {
      this.renderer3d.tierColorOverrides = Object.assign({}, overrides);
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

  onShow() {
    if (this.renderer3d) {
      this.renderer3d.requestRender();
    }
  },

  onHide() {
    this.stopRenderLoop();
  },

  onUnload() {
    this.clearAutoFlyTimer();
    this.stopRenderLoop();
  },

  startRenderLoop() {
    if (this._rafId || !this.canvas3d || !this.renderer3d) return;
    const canvas = this.canvas3d;
    const loop = (now) => {
      this._rafId = null;
      const r3d = this.renderer3d;
      if (!r3d) return;

      const ts = typeof now === 'number' ? now : Date.now();
      const camMoving = r3d.isCameraAnimating ? r3d.isCameraAnimating() : true;
      const hasDyn = r3d.hasDynamicAnimation ? r3d.hasDynamicAnimation() : false;
      const needsDraw = r3d.needsRender ? r3d.needsRender() : true;

      if (!needsDraw && !camMoving && !hasDyn) {
        return;
      }

      // 静止状态下仅跑外部动态场景动画时，节流至 ~30fps 以大幅降低真机发热
      if (!needsDraw && !camMoving && hasDyn && this._lastDynRenderTs && (ts - this._lastDynRenderTs) < 32) {
        this._rafId = canvas.requestAnimationFrame(loop);
        return;
      }

      r3d.renderFrame();
      this._lastDynRenderTs = ts;

      const stillMoving = r3d.isCameraAnimating ? r3d.isCameraAnimating() : false;
      const stillNeeds = r3d.needsRender ? r3d.needsRender() : false;
      if (stillNeeds || stillMoving || hasDyn) {
        this._rafId = canvas.requestAnimationFrame(loop);
      }
    };
    this._rafId = canvas.requestAnimationFrame(loop);
  },

  stopRenderLoop() {
    if (this._rafId && this.canvas3d) {
      this.canvas3d.cancelAnimationFrame(this._rafId);
    }
    this._rafId = null;
  },

  clearAutoFlyTimer() {
    if (this._autoFlyTimer) {
      clearTimeout(this._autoFlyTimer);
      this._autoFlyTimer = null;
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
        const activeVenue2d = this.getCurrentVenue();
        if (activeVenue2d) {
          this.renderer2d.tierColorOverrides = Object.assign({}, this.getSavedVenueColors(activeVenue2d.id));
          this.renderer2d.setVenue(activeVenue2d, this.data.viewMode);
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
        const dpr3d = Math.min(dpr, 2);
        canvas.width = width * dpr3d;
        canvas.height = height * dpr3d;

        const gl = canvas.getContext('webgl', { antialias: true, depth: true });
        if (!gl) return;

        this.canvas3d = canvas;
        this._canvas3dCss = { w: width, h: height };
        this.renderer3d = new Renderer3D(canvas, gl, width * dpr3d, height * dpr3d);
        this.renderer3d.onNeedRender = () => this.startRenderLoop();
        const activeVenue3d = this.getCurrentVenue();
        if (activeVenue3d) {
          this.renderer3d.tierColorOverrides = Object.assign({}, this.getSavedVenueColors(activeVenue3d.id));
          this.renderer3d.setVenue(activeVenue3d, this.data.viewMode, this.getSelectionIds());
          this.applySelectionToRenderers();
          if (this.data.cameraMode === 'seat' && this.data.sightline) {
            this.renderer3d.flyToSeat(this.data.sightline);
          } else {
            this.renderer3d.setBirdEyeView();
          }
        }

        this.startRenderLoop();
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
              const dpr3d = Math.min(dpr, 2);
              this._canvas3dCss = { w: res[0].width, h: res[0].height };
              this.renderer3d.canvas.width = res[0].width * dpr3d;
              this.renderer3d.canvas.height = res[0].height * dpr3d;
              this.renderer3d.resize(res[0].width * dpr3d, res[0].height * dpr3d);
            }
          });
      }
    }, 80);
  },

  // 打开全部场馆列表页面
  onOpenAllVenues() {
    const cur = this.getCurrentVenue();
    const currentId = cur ? (cur.id || cur._id || '') : '';
    wx.navigateTo({
      url: `/pages/venues/venues?currentId=${encodeURIComponent(currentId)}`,
      events: {
        selectVenue: (picked) => {
          if (picked && (picked.id || picked.docId)) {
            this.loadAndSwitchVenue(picked.id, picked.docId, picked.name);
          }
        }
      }
    });
  },

  // 切换场馆 Schema（优先使用已加载的本地内存缓存，未命中时从服务器加载）
  onSelectVenue(e) {
    const venueId = e.currentTarget.dataset.id;
    const docId = e.currentTarget.dataset.docId;
    const cur = this.getCurrentVenue();
    if (cur && (cur.id === venueId || cur._id === venueId)) return;
    const list = this._venues || this.data.venues || [];
    const cached = list.find(v => v.id === venueId || v._id === venueId);
    const displayName = (cached && (cached.shortLabel || cached.name)) || '场馆';
    this.loadAndSwitchVenue(venueId, docId || (cached && cached._id), displayName);
  },

  async loadAndSwitchVenue(venueId, docId, displayName) {
    this.clearAutoFlyTimer();
    const cur = this.getCurrentVenue();
    if (cur && (cur.id === venueId || cur._id === venueId)) {
      if (this.data.isVenueSwitching) {
        this._switchSeq = (this._switchSeq || 0) + 1;
        this.setData({ isVenueSwitching: false, switchingFade: false });
      }
      return;
    }

    const switchSeq = (this._switchSeq || 0) + 1;
    this._switchSeq = switchSeq;

    // 触发奶白色平滑过渡加载动画
    this.setData({
      isVenueSwitching: true,
      switchingFade: false,
      switchingVenueName: displayName || '场馆'
    });

    try {
      const list = this._venues || this.data.venues || [];
      let venue = list.find(
        v => (v.id === venueId || v._id === venueId || (docId && v._id === docId)) &&
             Array.isArray(v.standTiers) && v.standTiers.length > 0
      );
      if (!venue) {
        venue = await loadStadiumProjectById(venueId, docId);
        if (switchSeq !== this._switchSeq) return;
        if (venue) {
          if (!Array.isArray(this._venues)) this._venues = [];
          const existingIdx = this._venues.findIndex(v => v.id === venue.id || v._id === venue._id);
          if (existingIdx >= 0) {
            this._venues[existingIdx] = venue;
          } else {
            this._venues.push(venue);
          }
        }
      }
      if (!venue) {
        wx.showToast({ title: '加载场馆 Schema 失败', icon: 'none' });
        this.setData({ isVenueSwitching: false, switchingFade: false });
        return;
      }

      // 让出 1 帧使过渡动画浮层先完成绘制，避免同步建网阻塞首帧渲染
      await new Promise(resolve => setTimeout(resolve, 16));
      if (switchSeq !== this._switchSeq) return;

      wx.setStorageSync('STADIACAD_LAST_VENUE', venue.id);

      this._currentVenue = venue;
      this.activeSelection = findDefaultEastFirstRowSelection(venue);
      const sightline = calculateSeatSightline(venue, this.activeSelection, this.data.viewMode);
      const colorState = this.buildColorPickerState(venue);

      this.setData({
        currentVenue: toViewVenue(venue),
        activeTierFilter: 'all',
        cameraMode: 'bird',
        zoomLevel: 1.0,
        sightline,
        switchingVenueName: venue.shortLabel || venue.name || displayName,
        ...colorState
      });

      this.applyVenueToRenderers(venue, sightline, 'bird');

      this.clearAutoFlyTimer();
      this._autoFlyTimer = setTimeout(() => {
        this._autoFlyTimer = null;
        if (switchSeq !== this._switchSeq) return;
        if (this.data.cameraMode !== 'seat') {
          this.onFlyToSelectedSeat();
        }
      }, 2000);
    } catch (err) {
      console.error('加载场馆 Schema 异常:', err);
      if (switchSeq === this._switchSeq) {
        wx.showToast({ title: '加载场馆 Schema 失败', icon: 'none' });
      }
    } finally {
      if (switchSeq === this._switchSeq) {
        // 切换完成后平滑淡出过渡动画
        this.setData({ switchingFade: true });
        setTimeout(() => {
          if (switchSeq === this._switchSeq) {
            this.setData({ isVenueSwitching: false, switchingFade: false });
          }
        }, 320);
      }
    }
  },

  // === 场馆固定楼层座椅配色选择器逻辑 ===
  getAllSavedColorsMap() {
    try {
      const saved = wx.getStorageSync(SEAT_COLORS_STORAGE_KEY);
      return (saved && typeof saved === 'object') ? saved : {};
    } catch (e) {
      return {};
    }
  },

  getSavedVenueColors(venueId) {
    if (!venueId) return {};
    const all = this.getAllSavedColorsMap();
    const map = all[venueId];
    return (map && typeof map === 'object') ? Object.assign({}, map) : {};
  },

  saveVenueColors(venueId, overrides) {
    if (!venueId) return;
    try {
      const all = this.getAllSavedColorsMap();
      if (!overrides || Object.keys(overrides).length === 0) {
        delete all[venueId];
      } else {
        all[venueId] = Object.assign({}, overrides);
      }
      wx.setStorageSync(SEAT_COLORS_STORAGE_KEY, all);
    } catch (e) {
      console.warn('保存座椅配色失败:', e);
    }
  },

  buildColorPickerState(venue, preferredTarget, overridesIn, presetIdIn) {
    if (!venue) {
      return { colorTargets: [], activeColorTarget: '1', activeTargetHex: '#2B5EB8', activeThemePreset: 'default' };
    }
    const overrides = overridesIn !== undefined ? overridesIn : this.getSavedVenueColors(venue.id);
    const tiers = venue.standTiers || [];
    const targets = tiers.map((tier) => {
      const key = String(tier.level);
      const activeSecs = (tier.sectors || []).filter(s => !s.isDeleted && s.fillType !== 'empty-void');
      const vipCount = activeSecs.filter(s => (s.fillType || tier.defaultFillType) === 'vip-box').length;
      const isVipTier = activeSecs.length > 0 && vipCount >= activeSecs.length * 0.5;
      const hex = overrides[key] || (isVipTier && overrides.vip) || tier.seatColor || getDefaultHexForTarget(key, isVipTier);
      return {
        key,
        label: isVipTier ? `${tier.level}F VIP` : `${tier.level}F 看台`,
        isVipTier,
        hex
      };
    });

    targets.push({
      key: 'floor',
      label: '内场座席',
      isVipTier: false,
      hex: overrides.floor || (venue.infield && venue.infield.defaultSeatColor) || getDefaultHexForTarget('floor', false)
    });
    targets.push({
      key: 'sky',
      label: '天空',
      isVipTier: false,
      hex: overrides.sky || getDefaultHexForTarget('sky', false)
    });
    targets.push({
      key: 'roof',
      label: '屋顶',
      isVipTier: false,
      hex: overrides.roof || (venue.roof && venue.roof.color) || getDefaultHexForTarget('roof', false)
    });
    targets.push({
      key: 'wall',
      label: '外墙',
      isVipTier: false,
      hex: overrides.wall || (venue.facade && venue.facade.wallColor) || getDefaultHexForTarget('wall', false)
    });
    targets.push({
      key: 'ground',
      label: '地面',
      isVipTier: false,
      hex: overrides.ground || getDefaultHexForTarget('ground', false)
    });

    const activeKey = (preferredTarget && targets.some(t => t.key === preferredTarget))
      ? preferredTarget
      : (targets[0] ? targets[0].key : '1');
    const activeItem = targets.find(t => t.key === activeKey) || targets[0];
    const presetId = presetIdIn !== undefined
      ? presetIdIn
      : (Object.keys(overrides).length === 0 ? 'default' : 'custom');

    return {
      colorTargets: targets,
      activeColorTarget: activeKey,
      activeTargetHex: activeItem ? activeItem.hex : '#2B5EB8',
      seatColorSwatches: getSwatchesForTarget(activeKey),
      activeThemePreset: presetId
    };
  },

  applySeatColorsLive(overrides, presetId) {
    const venue = this.getCurrentVenue();
    if (!venue) return;
    this.saveVenueColors(venue.id, overrides);
    const colorState = this.buildColorPickerState(venue, this.data.activeColorTarget, overrides, presetId);
    this.setData(colorState);
    if (this.renderer2d) {
      this.renderer2d.setTierColorOverrides(overrides);
    }
    if (this.renderer3d) {
      this.renderer3d.setTierColorOverrides(overrides);
    }
  },

  onToggleColorPicker() {
    this.setData({
      showColorPicker: !this.data.showColorPicker
    }, () => {
      this.refreshCanvasSizes();
    });
  },

  onSelectColorTarget(e) {
    const key = e.currentTarget.dataset.key;
    const target = (this.data.colorTargets || []).find(t => t.key === key);
    if (!target) return;
    this.setData({
      activeColorTarget: key,
      activeTargetHex: target.hex,
      seatColorSwatches: getSwatchesForTarget(key)
    });
  },

  onPickSeatColor(e) {
    const hex = e.currentTarget.dataset.hex;
    const venue = this.getCurrentVenue();
    if (!hex || !venue) return;
    const overrides = this.getSavedVenueColors(venue.id);
    overrides[this.data.activeColorTarget] = hex;
    this.applySeatColorsLive(overrides, 'custom');
  },

  onApplyColorPreset(e) {
    const presetId = e.currentTarget.dataset.id;
    const preset = SEAT_THEME_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    this.applySeatColorsLive(Object.assign({}, preset.colors), preset.id);
  },

  onResetSeatColors() {
    this.applySeatColorsLive({}, 'default');
  },

  // 切换场外场景（白天悬浮仙境 / 黑夜经典地台 / 关灯场景）
  onToggleScene() {
    if (!this.renderer3d) return;
    const cur = this.renderer3d.getSceneId();
    const idx = SCENE_ORDER.indexOf(cur);
    const next = SCENE_ORDER[(idx >= 0 ? idx + 1 : 0) % SCENE_ORDER.length];
    const ok = this.renderer3d.setScene(next);
    if (ok) {
      this.setData({ activeSceneId: next });
    }
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
    const venue = this.getCurrentVenue();
    if (
      (nextMode === 'sports' && this.activeSelection && this.activeSelection.isFloorBlock) ||
      (nextMode === 'concert' && this.activeSelection && this.activeSelection.isModule)
    ) {
      this.activeSelection = findDefaultEastFirstRowSelection(venue);
      this.applySelectionToRenderers();
    }

    const sightline = calculateSeatSightline(venue, this.activeSelection, nextMode);

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

  // 2D Canvas 触摸交互（仅支持点击选区与双指缩放，禁止单指滑动平移）
  onTouchStart2D(e) {
    if (!e.touches || e.touches.length === 0) return;
    this._t2dMoved = false;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const x = t.x !== undefined ? t.x : t.clientX;
      const y = t.y !== undefined ? t.y : t.clientY;
      this._t2dStart = { x, y };
    } else if (e.touches.length >= 2) {
      this._t2dMoved = true;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const x0 = t0.x !== undefined ? t0.x : t0.clientX;
      const y0 = t0.y !== undefined ? t0.y : t0.clientY;
      const x1 = t1.x !== undefined ? t1.x : t1.clientX;
      const y1 = t1.y !== undefined ? t1.y : t1.clientY;
      this._t2dPinchDist = Math.hypot(x0 - x1, y0 - y1);
    }
  },

  onTouchMove2D(e) {
    if (!this.renderer2d || !e.touches) return;
    if (e.touches.length === 1 && this._t2dStart) {
      const t = e.touches[0];
      const x = t.x !== undefined ? t.x : t.clientX;
      const y = t.y !== undefined ? t.y : t.clientY;
      const distFromStart = Math.hypot(x - this._t2dStart.x, y - this._t2dStart.y);
      if (distFromStart > 7) {
        this._t2dMoved = true;
      }
    } else if (e.touches.length >= 2) {
      this._t2dMoved = true;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const x0 = t0.x !== undefined ? t0.x : t0.clientX;
      const y0 = t0.y !== undefined ? t0.y : t0.clientY;
      const x1 = t1.x !== undefined ? t1.x : t1.clientX;
      const y1 = t1.y !== undefined ? t1.y : t1.clientY;
      const dist = Math.hypot(x0 - x1, y0 - y1);
      if (this._t2dPinchDist > 10) {
        const factor = dist / this._t2dPinchDist;
        this.renderer2d.scale = Math.max(0.65, Math.min(4.5, this.renderer2d.scale * factor));
        this.renderer2d.render();
      }
      this._t2dPinchDist = dist;
    }
  },

  onTouchEnd2D(e) {
    if (!e || !e.touches || e.touches.length === 0) {
      this._t2dPinchDist = 0;
    }
    if (this._t2dMoved || !this._t2dStart || !this.renderer2d) {
      this._t2dStart = null;
      return;
    }

    const start = this._t2dStart;
    this._t2dStart = null;

    const hit = this.renderer2d.hitTest(start.x, start.y);
    if (hit) this.selectFromHit(hit);
  },

  // 2D / 3D 点选后统一的选中与进入座席视角逻辑，实现 3D 与 2D 双向全景联动
  selectFromHit(hit) {
    this.clearAutoFlyTimer();
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

    // 确保与 2D 页面联动：若当前 2D 过滤了单层且与选区楼层不同，则自动恢复为全部，避免 2D 看不到高亮选区
    let nextTierFilter = this.data.activeTierFilter;
    if (hit.type === 'sector' && hit.tierLevel && nextTierFilter !== 'all' && nextTierFilter !== hit.tierLevel) {
      nextTierFilter = 'all';
      if (this.renderer2d) {
        this.renderer2d.setTierFilter('all');
      }
    }

    this.applySelectionToRenderers();

    const sightline = calculateSeatSightline(
      this.getCurrentVenue(),
      this.activeSelection,
      this.data.viewMode
    );

    this.setData({
      sightline,
      activeTierFilter: nextTierFilter,
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
      const t = e.touches[0];
      const x = t.x !== undefined ? t.x : t.clientX;
      const y = t.y !== undefined ? t.y : t.clientY;
      this._t3dLast = { x, y };
      this._t3dStart = { x, y };
      this._t3dMoved = false;
    } else if (e.touches.length >= 2) {
      this._t3dMoved = true;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const x0 = t0.x !== undefined ? t0.x : t0.clientX;
      const y0 = t0.y !== undefined ? t0.y : t0.clientY;
      const x1 = t1.x !== undefined ? t1.x : t1.clientX;
      const y1 = t1.y !== undefined ? t1.y : t1.clientY;
      this._t3dPinchDist = Math.hypot(x0 - x1, y0 - y1);
    }
  },

  onTouchMove3D(e) {
    if (!this.renderer3d || !e.touches || e.touches.length === 0) return;
    if (e.touches.length === 1 && this._t3dLast) {
      const t = e.touches[0];
      const x = t.x !== undefined ? t.x : t.clientX;
      const y = t.y !== undefined ? t.y : t.clientY;
      const dx = x - this._t3dLast.x;
      const dy = y - this._t3dLast.y;
      if (this._t3dStart && Math.hypot(x - this._t3dStart.x, y - this._t3dStart.y) > 12) {
        this._t3dMoved = true;
      }
      this.renderer3d.handleTouchDrag(dx, dy);
      this._t3dLast = { x, y };
    } else if (e.touches.length >= 2) {
      this._t3dMoved = true;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const x0 = t0.x !== undefined ? t0.x : t0.clientX;
      const y0 = t0.y !== undefined ? t0.y : t0.clientY;
      const x1 = t1.x !== undefined ? t1.x : t1.clientX;
      const y1 = t1.y !== undefined ? t1.y : t1.clientY;
      const dist = Math.hypot(x0 - x1, y0 - y1);
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

    if (moved || !start || !this.renderer3d) return;
    const dpr = this._dpr || wx.getSystemInfoSync().pixelRatio || 2;
    const css = this._canvas3dCss || {
      w: this.renderer3d.width ? this.renderer3d.width / dpr : 375,
      h: this.renderer3d.height ? this.renderer3d.height / dpr : 260
    };
    const { w, h } = css;
    if (!w || !h) return;

    const hit = this.renderer3d.pickAt(start.x / w, start.y / h);
    if (hit) this.selectFromHit(hit);
  },

  // 返回 3D 鸟瞰视角
  onReturnBirdEye() {
    this.clearAutoFlyTimer();
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
    this.clearAutoFlyTimer();
    const sightline = calculateSeatSightline(
      this.getCurrentVenue(),
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
    this.clearAutoFlyTimer();
    this.activeSelection.row = rowNumber;
    const sightline = calculateSeatSightline(
      this.getCurrentVenue(),
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
  }
});
