App({
  globalData: {
    currentVenueId: 'std-new-gongti',
    viewMode: 'concert' // 'concert' | 'sports'
  },
  onLaunch() {
    const savedVenue = wx.getStorageSync('STADIACAD_LAST_VENUE');
    if (savedVenue) {
      this.globalData.currentVenueId = savedVenue;
    }
  }
});
