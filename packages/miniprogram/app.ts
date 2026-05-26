// app.ts
// App entry file

App<IAppOption>({
  globalData: {
    token: '',
    userId: '',
    language: 'en',
    level: 'beginner',
    wsUrl: 'wss://api.realtimespeakcoach.com/ws',
    apiUrl: 'https://api.realtimespeakcoach.com/api/v1',
  },

  onLaunch() {
    // Check login state
    const token = wx.getStorageSync('token');
    const userId = wx.getStorageSync('userId');
    const language = wx.getStorageSync('language');
    const level = wx.getStorageSync('level');

    if (token && userId) {
      this.globalData.token = token;
      this.globalData.userId = userId;
      if (language) this.globalData.language = language;
      if (level) this.globalData.level = level;
      wx.switchTab({ url: '/pages/hub/index' });
    } else {
      wx.navigateTo({ url: '/pages/onboarding/index' });
    }
  },
});

interface IAppOption {
  globalData: {
    token: string;
    userId: string;
    language: string;
    level: string;
    wsUrl: string;
    apiUrl: string;
  };
  onLaunch(): void;
}