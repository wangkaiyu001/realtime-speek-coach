// pages/review/index.ts
// Review page

import { getReview } from '../../utils/api';

interface Review {
  id: string;
  status: string;
  score: number;
  radar: { pronunciation: number; fluency: number; vocabulary: number; grammar: number; coherence: number };
  comment: string;
  highlights: string[];
  suggestions: string[];
  corrections: { user: string; native: string }[];
}

Page({
  data: {
    sessionId: '',
    review: null as Review | null,
    isLoading: true,
    isComplete: false,
  },

  onLoad(options: { sessionId: string }) {
    this.setData({ sessionId: options.sessionId });
    this.pollReview();
  }

  async pollReview() {
    try {
      const review = await getReview(this.data.sessionId);
      this.setData({ review });

      if (review.status === 'completed') {
        this.setData({ isLoading: false, isComplete: true });
      } else {
        setTimeout(() => this.pollReview(), 3000);
      }
    } catch (error) {
      wx.showToast({
        title: 'Failed to load review',
        icon: 'none',
        duration: 2000,
      });
      console.error('Error fetching review:', error);
      this.setData({ isLoading: false });
    }
  }

  onBackToHub() {
    wx.navigateTo({ url: '/pages/hub/index' });
  }

  onRetry() {
    wx.navigateTo({
      url: `/pages/practice/index?scenarioId=${this.data.review?.scenarioId}`,
    });
  }
});