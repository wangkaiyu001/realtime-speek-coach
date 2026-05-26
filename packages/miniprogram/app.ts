// app.ts
// App entry file

export interface IAppOption {
  globalData: {
    token: string;
    userId: string;
    language: string;
    level: string;
    wsUrl: string;
    apiUrl: string;
  };
}

export const globalData: IAppOption['globalData'] = {
  token: '',
  userId: '',
  language: 'en',
  level: 'beginner',
  wsUrl: 'wss://api.realtimespeakcoach.com/ws',
  apiUrl: 'https://api.realtimespeakcoach.com/api/v1',
};

App<IAppOption>({
  globalData,
  onLaunch() {
    const token = wx.getStorageSync('token');
    const userId = wx.getStorageSync('userId');
    const language = wx.getStorageSync('language');
    const level = wx.getStorageSync('level');

    if (token && userId) {
      globalData.token = token;
      globalData.userId = userId;
      if (language) globalData.language = language;
      if (level) globalData.level = level;
      wx.switchTab({ url: '/pages/hub/index' });
    } else {
      wx.navigateTo({ url: '/pages/onboarding/index' });
    }
  },
});
