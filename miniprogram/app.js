App({
  globalData: {
    currentVenueId: 'std-new-gongti',
    viewMode: 'concert' // 'concert' | 'sports'
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云开发能力');
    } else {
      wx.cloud.init({
        traceUser: true
      });
    }

    const savedVenue = wx.getStorageSync('STADIACAD_LAST_VENUE');
    if (savedVenue) {
      this.globalData.currentVenueId = savedVenue;
    }
  }
});
