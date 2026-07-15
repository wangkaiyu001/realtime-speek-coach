// pages/onboarding/index.ts
// Onboarding page for language selection

import { globalData } from '../../app';
import { setUserLanguage } from '../../utils/api';

Page({
  data: {
    selectedLanguage: 'en',
    isEnglishSelected: true,
    isJapaneseSelected: false,
    isLoading: false,
  },

  onLoad() {
    // Check if language is already set
    const language = wx.getStorageSync('language');
    if (language) {
      this.updateSelectedLanguage(language);
    }
  },

  onLanguageChange(e: WechatMiniprogram.CustomEvent) {
    this.updateSelectedLanguage(e.currentTarget.dataset.language);
  },

  updateSelectedLanguage(language: string) {
    const selectedLanguage = language === 'ja' ? 'ja' : 'en';
    this.setData({
      selectedLanguage,
      isEnglishSelected: selectedLanguage === 'en',
      isJapaneseSelected: selectedLanguage === 'ja',
    });
  },

  async onConfirm() {
    const { selectedLanguage } = this.data;
    this.setData({ isLoading: true });

    try {
      await setUserLanguage(selectedLanguage);
      globalData.language = selectedLanguage;
      wx.setStorageSync('language', selectedLanguage);

      // Placement will be introduced later. For the first public experience we
      // start everyone at the entry level so they can enter practice directly.
      wx.showModal({
        title: '准备完成',
        content: '已为你设置默认入门难度。先开始一次场景对练，完整测评稍后开放。',
        showCancel: false,
        success: () => {
          // Set default level
          globalData.level = 'beginner';
          wx.setStorageSync('level', 'beginner');
          wx.reLaunch({ url: '/pages/hub/index' });
        },
      });
    } catch (error) {
      wx.showToast({
        title: '语言设置失败，请重试',
        icon: 'none',
        duration: 2000,
      });
      console.error('Error setting language:', error);
    } finally {
      this.setData({ isLoading: false });
    }
  },
});
