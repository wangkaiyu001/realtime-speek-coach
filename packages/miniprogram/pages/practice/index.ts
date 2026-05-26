// pages/practice/index.ts
// Practice room - core conversation page

const app = getApp<IAppOption>();

Page({
  data: {
    scenarioId: '',
    state: 'idle' as 'idle' | 'recording' | 'processing' | 'speaking',
    turnCount: 0,
    maxTurns: 10,
    asrText: '',
    llmText: '',
    isRecording: false,
    showHint: false,
    hintText: '',
    sessionId: '',
  },

  wsClient: null as any,

  onLoad(options: any) {
    const scenarioId = options.scenarioId || 'en-shopping-01';
    this.setData({ scenarioId });
    this.connectWebSocket();
  },

  onUnload() {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
  },

  connectWebSocket() {
    const { wsUrl, token } = app.globalData;
    const url = `${wsUrl}?token=${token}`;

    this.wsClient = wx.connectSocket({
      url,
      success: () => console.log('[Practice] WS connecting...'),
    });

    wx.onSocketOpen(() => {
      console.log('[Practice] WS connected');
      // Send hello frame
      this.sendFrame({
        type: 'hello',
        sessionId: '',
        scenarioId: this.data.scenarioId,
        language: app.globalData.language,
      });
    });

    wx.onSocketMessage((res: any) => {
      try {
        const frame = JSON.parse(res.data as string);
        this.handleServerFrame(frame);
      } catch (e) {
        console.error('[Practice] Parse error:', e);
      }
    });

    wx.onSocketClose(() => {
      console.log('[Practice] WS closed');
    });

    wx.onSocketError((err: any) => {
      console.error('[Practice] WS error:', err);
      wx.showToast({ title: '连接异常', icon: 'none' });
    });
  },

  handleServerFrame(frame: any) {
    switch (frame.type) {
      case 'ready':
        this.setData({ sessionId: frame.sessionId, maxTurns: frame.totalTurns });
        break;

      case 'asr_partial':
        this.setData({ asrText: frame.text });
        break;

      case 'asr_final':
        this.setData({ asrText: frame.text, state: 'processing' });
        break;

      case 'llm_delta':
        this.setData({ llmText: frame.accumulated || (this.data.llmText + frame.text) });
        break;

      case 'tts_chunk':
        if (this.data.state !== 'speaking') {
          this.setData({ state: 'speaking' });
        }
        // In a real implementation, decode base64 and play via InnerAudioContext
        // For MVP mock, just show visual feedback
        break;

      case 'turn_end':
        this.setData({
          turnCount: frame.turnIndex,
          state: 'idle',
          asrText: '',
          llmText: '',
        });
        if (frame.sessionComplete) {
          this.endPractice();
        }
        break;

      case 'error':
        wx.showToast({ title: frame.message || '出错了', icon: 'none' });
        break;

      case 'heartbeat_ack':
        break;
    }
  },

  sendFrame(frame: any) {
    wx.sendSocketMessage({ data: JSON.stringify(frame) });
  },

  // --- User actions ---

  onTapRecord() {
    if (this.data.state !== 'idle') return;
    if (this.data.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  },

  onHoldStart() {
    if (this.data.state !== 'idle') return;
    this.startRecording();
  },

  onHoldEnd() {
    if (this.data.isRecording) {
      this.stopRecording();
    }
  },

  startRecording() {
    this.setData({ isRecording: true, state: 'recording', asrText: '' });

    const recorderManager = wx.getRecorderManager();
    recorderManager.onFrameRecorded((res: any) => {
      // Send audio chunk to server
      const base64 = wx.arrayBufferToBase64(res.frameBuffer);
      this.sendFrame({
        type: 'audio_chunk',
        data: base64,
        seq: Date.now(),
      });
    });

    recorderManager.start({
      duration: 60000, // max 60s
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'PCM',
      frameSize: 3, // ~100ms per frame at 16kHz
    });
  },

  stopRecording() {
    const recorderManager = wx.getRecorderManager();
    recorderManager.stop();
    this.setData({ isRecording: false, state: 'processing' });

    const turnIndex = this.data.turnCount + 1;
    this.sendFrame({
      type: 'audio_end',
      turnIndex,
    });
  },

  onTapHint() {
    this.setData({ showHint: !this.data.showHint });
  },

  endPractice() {
    wx.navigateTo({
      url: `/pages/review/index?sessionId=${this.data.sessionId}`,
    });
  },

  onTapEndEarly() {
    wx.showModal({
      title: '提前结束',
      content: '确定要提前结束练习吗？将生成已完成轮次的复盘报告。',
      success: (res) => {
        if (res.confirm) {
          this.sendFrame({ type: 'abort', reason: 'user_exit' });
          this.endPractice();
        }
      },
    });
  },
});
