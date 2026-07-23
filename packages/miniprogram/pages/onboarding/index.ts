import { globalData, refreshLogin } from '../../app';
import { ApiRequestError, setUserLanguage } from '../../utils/api';

type Language = 'en' | 'ja';

function toFriendlyError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.code === 'AUTH_EXPIRED') return '登录状态刚刚失效，已经重新连接，请再试一次。';
    if (error.code === 'NETWORK_ERROR') return '连接服务时出现波动，请检查网络后重试。';
    return '暂时无法进入场景，请再试一次。';
  }
  return '暂时无法进入场景，请再试一次。';
}

Page({
  data: {
    isLoading: false,
    loadingLanguage: '' as Language | '',
    errorText: '',
  },

  async onChooseLanguage(event: WechatMiniprogram.CustomEvent) {
    if (this.data.isLoading) return;
    const language: Language = event.currentTarget.dataset.language === 'ja' ? 'ja' : 'en';
    this.setData({ isLoading: true, loadingLanguage: language, errorText: '' });

    try {
      await this.saveLanguage(language);
      globalData.language = language;
      globalData.level = 'beginner';
      wx.setStorageSync('language', language);
      wx.setStorageSync('level', 'beginner');
      wx.reLaunch({ url: '/pages/hub/index' });
    } catch (error) {
      console.error('[Onboarding] Failed to save language:', error);
      this.setData({
        isLoading: false,
        loadingLanguage: '',
        errorText: toFriendlyError(error),
      });
    }
  },

  async saveLanguage(language: Language) {
    try {
      await setUserLanguage(language);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.statusCode !== 401) throw error;
      await refreshLogin();
      await setUserLanguage(language);
    }
  },
});
