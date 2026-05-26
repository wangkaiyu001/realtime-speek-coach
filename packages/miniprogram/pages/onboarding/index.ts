// pages/onboarding/index.ts
// Onboarding page for language selection

import { globalData } from '../../app';
import { setUserLanguage } from '../../utils/api';

Page({
  data: {
    selectedLanguage: 'en',
    isLoading: false,
  },

  onLoad() {
    // Check if language is already set
    const language = wx.getStorageSync('language');
    if (language) {
      this.setData({ selectedLanguage: language });
    }
  },

  onLanguageChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ selectedLanguage: e.currentTarget.dataset.language });
  },

  async onConfirm() {
    const { selectedLanguage } = this.data;
    this.setData({ isLoading: true });

    try {
      await setUserLanguage(selectedLanguage);
      globalData.language = selectedLanguage;
      wx.setStorageSync('language', selectedLanguage);

      // Mock placement test
      wx.showModal({
        title: 'Placement Test',
        content: 'This is a mock placement test. Press OK to continue.',
        showCancel: false,
        success: () => {
          // Set default level
          globalData.level = 'beginner';
          wx.setStorageSync('level', 'beginner');
          wx.navigateTo({ url: '/pages/hub/index' });
        },
      });
    } catch (error) {
      wx.showToast({
        title: 'Failed to set language',
        icon: 'none',
        duration: 2000,
      });
      console.error('Error setting language:', error);
    } finally {
      this.setData({ isLoading: false });
    }
  },
});