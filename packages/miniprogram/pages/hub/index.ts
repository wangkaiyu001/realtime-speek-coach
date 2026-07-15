// pages/hub/index.ts
// Scenario hub page

import { getScenarios, getSessions, requestReview, Scenario, SessionSummary } from '../../utils/api';

interface ScenarioGroup {
  category: string;
  categoryLabel: string;
  scenarios: Scenario[];
}

const CATEGORY_LABELS: Record<string, string> = {
  shopping: '购物与点单',
  meeting: '职场会议',
  travel: '旅行出行',
  ielts_mock: '考试模拟',
  jsst_mock: '考试模拟',
  daily: '日常闲聊',
  business: '商务职场',
};

function groupScenarios(scenarios: Scenario[]): ScenarioGroup[] {
  const groups: Record<string, Scenario[]> = {};

  scenarios.forEach((scenario) => {
    if (!groups[scenario.category]) {
      groups[scenario.category] = [];
    }
    groups[scenario.category].push(scenario);
  });

  return Object.keys(groups).map(category => ({
    category,
    categoryLabel: CATEGORY_LABELS[category] || category,
    scenarios: groups[category],
  }));
}

Page({
  data: {
    scenarioGroups: [] as ScenarioGroup[],
    recentSessions: [] as SessionSummary[],
    hasRecentSessions: false,
    isLoading: true,
    isLoadingSessions: true,
  },

  onLoad() {
    this.loadHubData();
  },

  onShow() {
    if (!this.data.isLoading) {
      this.fetchSessions();
    }
  },

  async loadHubData() {
    await Promise.all([this.fetchScenarios(), this.fetchSessions()]);
  },

  async fetchScenarios() {
    try {
      const scenarios = await getScenarios();
      this.setData({
        scenarioGroups: groupScenarios(scenarios),
        isLoading: false,
      });
    } catch (error) {
      wx.showToast({
        title: '加载场景失败',
        icon: 'none',
        duration: 2000,
      });
      console.error('Error fetching scenarios:', error);
      this.setData({ isLoading: false });
    }
  },

  async fetchSessions() {
    this.setData({ isLoadingSessions: true });
    try {
      const sessions = await getSessions();
      this.setData({
        recentSessions: sessions.slice(0, 5),
        hasRecentSessions: sessions.length > 0,
        isLoadingSessions: false,
      });
    } catch (error) {
      console.error('Error fetching sessions:', error);
      this.setData({ isLoadingSessions: false });
    }
  },

  onScenarioTap(e: WechatMiniprogram.CustomEvent) {
    const scenarioId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/practice/index?scenarioId=${scenarioId}`,
    });
  },

  async onSessionActionTap(e: WechatMiniprogram.CustomEvent) {
    const sessionId = e.currentTarget.dataset.sessionId;
    const scenarioId = e.currentTarget.dataset.scenarioId;
    const canRequestReview = e.currentTarget.dataset.canRequestReview;
    const canOpenReview = e.currentTarget.dataset.canOpenReview;

    if (!sessionId) return;

    if (canRequestReview) {
      try {
        wx.showLoading({ title: '生成复盘中' });
        await requestReview(sessionId);
        wx.hideLoading();
        wx.navigateTo({ url: `/pages/review/index?sessionId=${sessionId}&scenarioId=${scenarioId || ''}` });
      } catch (error) {
        wx.hideLoading();
        console.error('Error requesting review:', error);
        wx.showToast({ title: '复盘生成失败，请稍后重试', icon: 'none' });
      }
      return;
    }

    if (canOpenReview) {
      wx.navigateTo({ url: `/pages/review/index?sessionId=${sessionId}&scenarioId=${scenarioId || ''}` });
      return;
    }

    wx.navigateTo({ url: `/pages/practice/index?scenarioId=${scenarioId || ''}` });
  },
});
