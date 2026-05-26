// pages/hub/index.ts
// Scenario hub page

import { getScenarios, Scenario } from '../../utils/api';

Page({
  data: {
    scenarios: [] as Scenario[],
    categories: [] as string[],
    isLoading: true,
  },

  onLoad() {
    this.fetchScenarios();
  },

  async fetchScenarios() {
    try {
      const scenarios = await getScenarios();
      const categories = [...new Set(scenarios.map(s => s.category))];
      this.setData({
        scenarios,
        categories,
        isLoading: false,
      });
    } catch (error) {
      wx.showToast({
        title: 'Failed to load scenarios',
        icon: 'none',
        duration: 2000,
      });
      console.error('Error fetching scenarios:', error);
      this.setData({ isLoading: false });
    }
  },

  onScenarioTap(e: WechatMiniprogram.CustomEvent) {
    const scenarioId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/practice/index?scenarioId=${scenarioId}`,
    });
  },
});
