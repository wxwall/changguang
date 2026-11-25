const { loadAllStadiumProjects } = require('../../services/venue-service');

Page({
  data: {
    allVenues: [],
    filteredVenues: [],
    keyword: '',
    currentId: '',
    loading: true
  },

  onLoad(options) {
    this.setData({
      currentId: (options && options.currentId) || ''
    });
    this.fetchAllVenues();
  },

  async fetchAllVenues() {
    this.setData({ loading: true });
    try {
      const list = await loadAllStadiumProjects();
      const normalizedList = (list || []).map((v) => ({
        id: v.id,
        _id: v._id,
        name: v.name || v.shortLabel || '未命名场馆',
        shortLabel: v.shortLabel || v.name || '场馆',
        capLabel: v.capLabel || '',
        code: v.code || '',
        tierCount: Array.isArray(v.standTiers) ? v.standTiers.length : 0
      }));
      this.setData({
        allVenues: normalizedList,
        filteredVenues: normalizedList,
        loading: false
      });
    } catch (err) {
      console.error('加载全部场馆列表失败:', err);
      wx.showToast({
        title: '加载场馆列表失败',
        icon: 'none'
      });
      this.setData({ loading: false });
    }
  },

  onSearchInput(e) {
    const keyword = (e.detail.value || '').trim();
    this.filterList(keyword);
  },

  onClearSearch() {
    this.filterList('');
  },

  filterList(keyword) {
    const kw = keyword.toLowerCase();
    const filtered = !kw
      ? this.data.allVenues
      : this.data.allVenues.filter((v) =>
          (v.name && v.name.toLowerCase().includes(kw)) ||
          (v.shortLabel && v.shortLabel.toLowerCase().includes(kw)) ||
          (v.code && v.code.toLowerCase().includes(kw)) ||
          (v.capLabel && v.capLabel.toLowerCase().includes(kw))
        );
    this.setData({
      keyword,
      filteredVenues: filtered
    });
  },

  onPickVenue(e) {
    const { id, docId, name } = e.currentTarget.dataset;
    const payload = { id, docId, name };

    const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (eventChannel && typeof eventChannel.emit === 'function') {
      eventChannel.emit('selectVenue', payload);
    } else {
      const pages = getCurrentPages();
      const prev = pages[pages.length - 2];
      if (prev && typeof prev.loadAndSwitchVenue === 'function') {
        prev.loadAndSwitchVenue(id, docId, name);
      }
    }
    wx.navigateBack();
  }
});
