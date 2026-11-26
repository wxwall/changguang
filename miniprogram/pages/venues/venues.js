const { loadStadiumProjectList } = require('../../services/venue-service');

function buildCityGroups(venues) {
  const map = new Map();
  for (const v of (venues || [])) {
    const city = (v && v.city) ? String(v.city).trim() : '其他';
    if (!map.has(city)) {
      map.set(city, []);
    }
    map.get(city).push(v);
  }

  const groups = [];
  let otherGroup = null;
  for (const [city, list] of map.entries()) {
    const group = {
      city,
      count: list.length,
      venues: list
    };
    if (city === '其他') {
      otherGroup = group;
    } else {
      groups.push(group);
    }
  }
  if (otherGroup) {
    groups.push(otherGroup);
  }
  return groups;
}

Page({
  data: {
    allVenues: [],
    cityGroups: [],
    activeCity: '',
    currentCityVenues: [],
    rightScrollTop: 0,
    totalFilteredCount: 0,
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
      const list = await loadStadiumProjectList();
      const normalizedList = (list || []).map((v) => ({
        id: v.id,
        _id: v._id,
        name: v.name || v.shortLabel || '未命名场馆',
        shortLabel: v.shortLabel || v.name || '场馆',
        capLabel: v.capLabel || '',
        code: v.code || '',
        city: v.city || '其他',
        tierCount: typeof v.tierCount === 'number'
          ? v.tierCount
          : (Array.isArray(v.standTiers) ? v.standTiers.length : 0)
      }));

      const cityGroups = buildCityGroups(normalizedList);
      const currentId = this.data.currentId;
      const currentVenue = currentId
        ? normalizedList.find(v => v.id === currentId || v._id === currentId)
        : null;
      const initialCity = (currentVenue && currentVenue.city)
        || (cityGroups[0] ? cityGroups[0].city : '');
      const initialGroup = cityGroups.find(g => g.city === initialCity) || cityGroups[0];

      this.setData({
        allVenues: normalizedList,
        cityGroups,
        activeCity: initialGroup ? initialGroup.city : '',
        currentCityVenues: initialGroup ? initialGroup.venues : [],
        totalFilteredCount: normalizedList.length,
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
          (v.city && v.city.toLowerCase().includes(kw)) ||
          (v.capLabel && v.capLabel.toLowerCase().includes(kw))
        );

    const cityGroups = buildCityGroups(filtered);
    const keepActive = cityGroups.find(g => g.city === this.data.activeCity);
    const targetGroup = keepActive || cityGroups[0] || null;

    this.setData({
      keyword,
      cityGroups,
      activeCity: targetGroup ? targetGroup.city : '',
      currentCityVenues: targetGroup ? targetGroup.venues : [],
      rightScrollTop: this.data.rightScrollTop === 0 ? 0.01 : 0,
      totalFilteredCount: filtered.length
    });
  },

  onSelectCity(e) {
    const city = e.currentTarget.dataset.city;
    if (!city || city === this.data.activeCity) return;
    const group = (this.data.cityGroups || []).find(g => g.city === city);
    this.setData({
      activeCity: city,
      currentCityVenues: group ? group.venues : [],
      rightScrollTop: this.data.rightScrollTop === 0 ? 0.01 : 0
    });
  },

  onPickVenue(e) {
    const { id, docId, name } = e.currentTarget.dataset;
    if (!id && !docId) return;
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
