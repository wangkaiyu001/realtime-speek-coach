// pages/review/index.ts
// Review page

import { getReview, ReviewResult } from '../../utils/api';

const REVIEW_POLL_INTERVAL_MS = 3000;
const MAX_REVIEW_POLL_ATTEMPTS = 40;
type TimeoutHandle = ReturnType<typeof setTimeout>;

Page({
  data: {
    sessionId: '',
    scenarioId: '',
    review: null as ReviewResult | null,
    hasReview: false,
    isLoading: true,
    isComplete: false,
    errorMessage: '',
    loadingMessage: '正在读取复盘...',
    reviewPollAttempts: 0,
  },

  reviewPollTimer: null as TimeoutHandle | null,

  onLoad(options: { sessionId: string; scenarioId?: string }) {
    const sessionId = options.sessionId || '';

    this.setData({
      sessionId,
      scenarioId: options.scenarioId || '',
    });

    if (!sessionId) {
      this.setData({
        isLoading: false,
        isComplete: false,
        hasReview: false,
        errorMessage: '本次练习还没有可查看的复盘。完成至少一轮回答后，可在历史记录中生成局部复盘。',
      });
      return;
    }

    this.pollReview();
  },

  onUnload() {
    this.clearReviewPollTimer();
  },

  clearReviewPollTimer() {
    if (this.reviewPollTimer) {
      clearTimeout(this.reviewPollTimer);
      this.reviewPollTimer = null;
    }
  },

  async pollReview() {
    this.clearReviewPollTimer();

    try {
      const review = await getReview(this.data.sessionId);

      if (review.isCompleted) {
        this.setData({
          review,
          hasReview: true,
          isLoading: false,
          isComplete: true,
          errorMessage: '',
        });
        return;
      }

      if (review.isFailed) {
        this.setData({
          review,
          hasReview: false,
          isLoading: false,
          isComplete: false,
          errorMessage: review.comment || '复盘生成失败，请稍后再试，或重新完成一次练习。',
        });
        return;
      }

      const attempts = this.data.reviewPollAttempts + 1;

      if (attempts >= MAX_REVIEW_POLL_ATTEMPTS) {
        this.setData({
          review,
          hasReview: false,
          isLoading: false,
          isComplete: false,
          errorMessage: '复盘仍在生成中，你可以稍后从首页历史记录再次打开。',
          reviewPollAttempts: attempts,
        });
        return;
      }

      this.setData({
        review,
        hasReview: false,
        isLoading: true,
        isComplete: false,
        loadingMessage: '复盘生成中，通常需要几秒钟...',
        errorMessage: '',
        reviewPollAttempts: attempts,
      });
      this.reviewPollTimer = setTimeout(() => this.pollReview(), REVIEW_POLL_INTERVAL_MS);
    } catch (error) {
      console.error('Error fetching review:', error);
      this.setData({
        isLoading: false,
        isComplete: false,
        hasReview: false,
        errorMessage: '暂时无法读取复盘。请回到首页，从历史记录中重试。',
      });
    }
  },

  onBackToHub() {
    wx.reLaunch({ url: '/pages/hub/index' });
  },

  onRetry() {
    const scenarioId = this.data.scenarioId;
    wx.navigateTo({
      url: scenarioId ? `/pages/practice/index?scenarioId=${scenarioId}` : '/pages/hub/index',
    });
  },
});
