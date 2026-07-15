// pages/practice/index.ts
// Practice room - core conversation page

import { IAppOption } from '../../app';

type Language = 'en' | 'ja';

interface WsClientHello {
  type: 'hello';
  sessionId: string;
  scenarioId: string;
  language: Language;
}

interface WsClientAudioChunk {
  type: 'audio_chunk';
  data: string;
  seq: number;
}

interface WsClientAudioEnd {
  type: 'audio_end';
  turnIndex: number;
}

interface WsClientAbort {
  type: 'abort';
  reason: 'user_exit' | 'error';
  requestReview?: boolean;
}

type WsClientFrame = WsClientHello | WsClientAudioChunk | WsClientAudioEnd | WsClientAbort;

interface WsServerReady {
  type: 'ready';
  sessionId: string;
  totalTurns: number;
}

interface WsServerTextFrame {
  type: 'asr_partial' | 'asr_final';
  text: string;
}

interface WsServerLlmDelta {
  type: 'llm_delta';
  text: string;
  accumulated?: string;
}

interface WsServerError {
  type: 'error';
  message?: string;
  retryable?: boolean;
}

interface WsServerHeartbeatAck {
  type: 'heartbeat_ack';
}

interface WsServerTurnEnd {
  type: 'turn_end';
  turnIndex: number;
  sessionComplete: boolean;
}

type WsServerFrame = WsServerReady
  | WsServerTextFrame
  | WsServerLlmDelta
  | TtsAudioChunk
  | WsServerTurnEnd
  | WsServerError
  | WsServerHeartbeatAck;

const app = getApp<IAppOption>();

type PracticeState = 'connecting' | 'idle' | 'recording' | 'processing' | 'speaking' | 'error';

interface ChatMessage {
  id: string;
  role: 'ai' | 'user';
  roleClass: 'ai-message' | 'user-message';
  avatar: string;
  text: string;
}

interface TtsAudioChunk {
  type: 'tts_chunk';
  data: string;
  seq: number;
  isLast: boolean;
}

type RecorderManagerWithOffFrameRecorded = WechatMiniprogram.RecorderManager & {
  offFrameRecorded?: (listener: WechatMiniprogram.OnFrameRecordedCallback) => void;
};

type TimeoutHandle = ReturnType<typeof setTimeout>;

function getRecorderAuthSetting(authSetting: WechatMiniprogram.AuthSetting) {
  return authSetting['scope.record'];
}

function normalizeLanguage(language: string): Language {
  return language === 'ja' ? 'ja' : 'en';
}

Page({
  data: {
    scenarioId: '',
    state: 'connecting' as PracticeState,
    statusText: '正在连接 AI 教练...',
    turnCount: 0,
    maxTurns: 10,
    asrText: '',
    llmText: '',
    chatMessages: [] as ChatMessage[],
    activeAiMessageId: '',
    activeUserMessageId: '',
    isRecording: false,
    recordButtonText: '连接中...',
    recordDisabled: true,
    canRetryTurn: false,
    showHint: false,
    hintText: '不用追求完美，尽量用目标语言回答。说短一点、自然一点就好。',
    sessionId: '',
  },

  wsClient: null as WechatMiniprogram.SocketTask | null,
  recorderManager: null as RecorderManagerWithOffFrameRecorded | null,
  recorderFrameHandler: null as WechatMiniprogram.OnFrameRecordedCallback | null,
  recorderErrorHandler: null as WechatMiniprogram.UDPSocketOnErrorCallback | null,
  recorderStopHandler: null as (() => void) | null,
  recorderFrameEnabled: false,
  hasNavigated: false,
  isEndingEarly: false,
  earlyEndFallbackTimer: null as TimeoutHandle | null,
  pendingTurnEndFrame: null as WsServerTurnEnd | null,
  currentTtsChunks: [] as string[],
  audioFileIndex: 0,
  audioContext: null as WechatMiniprogram.InnerAudioContext | null,
  isPlayingAudio: false,

  onLoad(options: { scenarioId?: string }) {
    const scenarioId = options.scenarioId || 'en-shopping-01';
    this.setData({ scenarioId });
    this.connectWebSocket();
  },

  onUnload() {
    this.stopAudioPlayback();
    if (this.wsClient) {
      this.wsClient.close({});
      this.wsClient = null;
    }
    this.detachRecorderFrameHandler();
    if (this.earlyEndFallbackTimer) {
      clearTimeout(this.earlyEndFallbackTimer);
      this.earlyEndFallbackTimer = null;
    }
  },

  connectWebSocket() {
    const { wsUrl, token } = app.globalData;
    const url = `${wsUrl}?token=${token}`;

    this.wsClient = wx.connectSocket({
      url,
      success: () => console.log('[Practice] WS connecting...'),
    });

    this.wsClient.onOpen(() => {
      console.log('[Practice] WS connected');
      // Send hello frame
      this.sendFrame({
        type: 'hello',
        sessionId: '',
        scenarioId: this.data.scenarioId,
        language: normalizeLanguage(app.globalData.language),
      });
    });

    this.wsClient.onMessage((res) => {
      try {
        const frame = JSON.parse(typeof res.data === 'string' ? res.data : '') as WsServerFrame;
        this.handleServerFrame(frame);
      } catch (e) {
        console.error('[Practice] Parse error:', e);
      }
    });

    this.wsClient.onClose(() => {
      console.log('[Practice] WS closed');
      if (!this.hasNavigated && !this.isEndingEarly) {
        this.setPracticeState('error', { statusText: '连接已断开，请返回场景页后重试。' });
      }
    });

    this.wsClient.onError((err) => {
      console.error('[Practice] WS error:', err);
      wx.showToast({ title: '连接异常', icon: 'none' });
      this.setPracticeState('error', { statusText: '连接异常，请返回场景页后重试。' });
    });
  },

  handleServerFrame(frame: WsServerFrame) {
    switch (frame.type) {
      case 'ready':
        this.setPracticeState('idle', {
          sessionId: frame.sessionId,
          maxTurns: frame.totalTurns,
          statusText: '先听教练开场，然后点击“开始说话”回答。',
        });
        break;

      case 'asr_partial':
        this.updateUserMessage(frame.text);
        break;

      case 'asr_final':
        this.updateUserMessage(frame.text);
        this.setPracticeState('processing', {
          activeAiMessageId: '',
          llmText: '',
          canRetryTurn: false,
          statusText: '教练正在思考你的回答...',
        });
        break;

      case 'llm_delta':
        this.updateAiMessage(frame.accumulated || (this.data.llmText + frame.text));
        break;

      case 'tts_chunk':
        if (this.data.state !== 'speaking') {
          this.setPracticeState('speaking', { statusText: '教练正在说话，请认真听。' });
        }
        this.enqueueAudioChunk(frame);
        break;

      case 'turn_end':
        this.handleTurnEnd(frame);
        break;

      case 'error':
        wx.showToast({ title: frame.message || '出错了', icon: 'none' });
        if (frame.retryable) {
          this.setPracticeState('idle', {
            activeAiMessageId: '',
            canRetryTurn: true,
            statusText: frame.message || '这一轮没有成功，可以再试一次。',
          });
        } else {
          this.setPracticeState('error', {
            statusText: frame.message || '本次练习无法继续，请返回后重试。',
          });
        }
        break;

      case 'heartbeat_ack':
        break;
    }
  },

  enqueueAudioChunk(frame: TtsAudioChunk) {
    if (!frame.data) {
      if (frame.isLast) {
        if (this.currentTtsChunks.length > 0) {
          this.playBufferedAudioChunks();
        } else {
          this.finishAudioPlayback();
        }
      }
      return;
    }

    this.currentTtsChunks.push(frame.data);
    this.isPlayingAudio = true;

    if (frame.isLast) {
      this.playBufferedAudioChunks();
    }
  },

  getAudioContext() {
    if (!this.audioContext) {
      const audioContext = wx.createInnerAudioContext();
      audioContext.autoplay = false;
      audioContext.onEnded(() => this.finishAudioPlayback());
      audioContext.onError((err) => {
        console.error('[Practice] Audio playback error:', err);
        this.finishAudioPlayback();
      });
      this.audioContext = audioContext;
    }
    return this.audioContext;
  },

  playBufferedAudioChunks() {
    const chunks = this.currentTtsChunks;
    this.currentTtsChunks = [];

    if (chunks.length === 0) {
      this.finishAudioPlayback();
      return;
    }

    this.isPlayingAudio = true;

    try {
      const filePath = `${wx.env.USER_DATA_PATH}/rsc-tts-${Date.now()}-${this.audioFileIndex}.mp3`;
      this.audioFileIndex += 1;
      const audioData = this.mergeBase64AudioChunks(chunks);

      wx.getFileSystemManager().writeFile({
        filePath,
        data: audioData,
        success: () => {
          const audioContext = this.getAudioContext();
          audioContext.src = filePath;
          audioContext.play();
        },
        fail: (error) => {
          console.error('[Practice] Failed to write audio chunk:', error);
          this.finishAudioPlayback();
        },
      });
    } catch (error) {
      console.error('[Practice] Failed to play audio chunk:', error);
      this.finishAudioPlayback();
    }
  },

  mergeBase64AudioChunks(chunks: string[]) {
    const arrays = chunks.map((chunk) => new Uint8Array(wx.base64ToArrayBuffer(chunk)));
    const totalLength = arrays.reduce((sum, array) => sum + array.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;

    arrays.forEach((array) => {
      merged.set(array, offset);
      offset += array.byteLength;
    });

    return merged.buffer;
  },

  finishAudioPlayback() {
    this.isPlayingAudio = false;
    if (this.pendingTurnEndFrame) {
      const pending = this.pendingTurnEndFrame;
      this.pendingTurnEndFrame = null;
      this.applyTurnEnd(pending);
      return;
    }

    if (this.data.state === 'speaking') {
      this.setPracticeState('idle', { statusText: '轮到你了，准备好后点击“开始说话”。' });
    }
  },

  stopAudioPlayback() {
    this.currentTtsChunks = [];
    this.pendingTurnEndFrame = null;
    this.isPlayingAudio = false;
    if (this.audioContext) {
      this.audioContext.stop();
      this.audioContext.destroy();
      this.audioContext = null;
    }
  },

  sendFrame(frame: WsClientFrame) {
    if (!this.wsClient) return;
    this.wsClient.send({ data: JSON.stringify(frame) });
  },

  setPracticeState(state: PracticeState, extraData: Record<string, unknown> = {}) {
    const isRecording = state === 'recording';
    const statusText = typeof extraData.statusText === 'string'
      ? extraData.statusText
      : this.getStatusText(state);

    this.setData({
      ...extraData,
      state,
      isRecording,
      statusText,
      recordButtonText: isRecording ? '说完了' : this.getRecordButtonText(state),
      recordDisabled: !isRecording && state !== 'idle',
    });
  },

  getStatusText(state: PracticeState) {
    const statusTextMap: Record<PracticeState, string> = {
      connecting: '正在连接 AI 教练...',
      idle: '准备好后点击“开始说话”。',
      recording: '正在录音，说完后点击“说完了”。',
      processing: '正在识别并分析你的回答...',
      speaking: '教练正在说话，请认真听。',
      error: '连接异常，请返回场景页后重试。',
    };
    return statusTextMap[state];
  },

  getRecordButtonText(state: PracticeState) {
    if (state === 'connecting') return '连接中...';
    if (state === 'processing') return '处理中...';
    if (state === 'speaking') return '聆听中...';
    if (state === 'error') return '暂不可用';
    return '开始说话';
  },

  upsertMessage(message: ChatMessage) {
    const chatMessages = [...this.data.chatMessages];
    const index = chatMessages.findIndex((item) => item.id === message.id);

    if (index >= 0) {
      chatMessages[index] = message;
    } else {
      chatMessages.push(message);
    }

    this.setData({ chatMessages });
  },

  updateAiMessage(text: string) {
    const id = this.data.activeAiMessageId || `ai-${Date.now()}`;
    if (!this.data.activeAiMessageId) {
      this.setData({ activeAiMessageId: id });
    }

    this.upsertMessage({
      id,
      role: 'ai',
      roleClass: 'ai-message',
      avatar: '教练',
      text,
    });
    this.setData({ llmText: text });
  },

  updateUserMessage(text: string) {
    const id = this.data.activeUserMessageId || `user-${this.data.turnCount + 1}-${Date.now()}`;
    if (!this.data.activeUserMessageId) {
      this.setData({ activeUserMessageId: id });
    }

    this.upsertMessage({
      id,
      role: 'user',
      roleClass: 'user-message',
      avatar: '我',
      text,
    });
    this.setData({ asrText: text });
  },

  handleTurnEnd(frame: WsServerTurnEnd) {
    if (this.isPlayingAudio || this.currentTtsChunks.length > 0 || this.data.state === 'speaking') {
      this.pendingTurnEndFrame = frame;
      this.setData({
        turnCount: frame.turnIndex,
        statusText: frame.sessionComplete ? '教练正在完成本次练习...' : '教练正在说话，请认真听。',
        recordDisabled: true,
      });
      return;
    }

    this.applyTurnEnd(frame);
  },

  applyTurnEnd(frame: WsServerTurnEnd) {
    this.setPracticeState('idle', {
      turnCount: frame.turnIndex,
      asrText: '',
      llmText: '',
      activeAiMessageId: '',
      activeUserMessageId: '',
      canRetryTurn: false,
      statusText: frame.sessionComplete ? '练习完成，正在生成复盘。' : '轮到你了，准备好后点击“开始说话”。',
    });
    if (frame.sessionComplete) {
      this.endPractice();
    }
  },

  // --- User actions ---

  onTapRecord() {
    if (this.data.isRecording) {
      this.stopRecording();
      return;
    }

    if (this.data.state !== 'idle') return;
    this.startRecording();
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
    if (!this.wsClient) {
      this.setPracticeState('error', { statusText: '连接不可用，请返回场景页后重试。' });
      return;
    }

    this.ensureRecordPermission((granted) => {
      if (!granted) return;
      this.doStartRecording();
    });
  },

  doStartRecording() {
    const activeUserMessageId = `user-${this.data.turnCount + 1}-${Date.now()}`;
    this.setPracticeState('recording', {
      asrText: '',
      llmText: '',
      canRetryTurn: false,
      activeUserMessageId,
      activeAiMessageId: '',
    });

    const recorderManager = this.getRecorderManager();
    this.attachRecorderFrameHandler();

    recorderManager.start({
      duration: 60000, // max 60s
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'PCM',
      frameSize: 3, // ~100ms per frame at 16kHz
    });
  },

  ensureRecordPermission(done: (granted: boolean) => void) {
    wx.getSetting({
      success: (setting) => {
        const recordSetting = getRecorderAuthSetting(setting.authSetting || {});

        if (recordSetting === true) {
          done(true);
          return;
        }

        if (recordSetting === false) {
          this.promptOpenRecordSetting(done);
          return;
        }

        wx.authorize({
          scope: 'scope.record',
          success: () => done(true),
          fail: () => this.promptOpenRecordSetting(done),
        });
      },
      fail: () => {
        // If settings cannot be read, attempt to start recording and let the
        // recorder surface the platform error.
        done(true);
      },
    });
  },

  promptOpenRecordSetting(done: (granted: boolean) => void) {
    wx.showModal({
      title: '需要麦克风权限',
      content: '口语对练需要使用麦克风录音。请在权限设置中开启麦克风后继续。',
      confirmText: '去开启',
      cancelText: '稍后再说',
      success: (modalResult) => {
        if (!modalResult.confirm) {
          this.setPracticeState('idle', { statusText: '开启麦克风权限后，就可以继续练习。' });
          done(false);
          return;
        }

        wx.openSetting({
          success: (openResult) => {
            const granted = getRecorderAuthSetting(openResult.authSetting || {}) === true;
            this.setPracticeState('idle', {
              statusText: granted
                ? '麦克风已开启，准备好后点击“开始说话”。'
                : '仍未开启麦克风权限，暂时无法录音。',
            });
            done(granted);
          },
          fail: () => {
            this.setPracticeState('idle', { statusText: '无法打开权限设置，请稍后重试。' });
            done(false);
          },
        });
      },
      fail: () => done(false),
    });
  },

  stopRecording() {
    const recorderManager = this.getRecorderManager();
    recorderManager.stop();
    this.finishRecordingTurn();
  },

  finishRecordingTurn() {
    if (!this.data.isRecording) return;

    this.detachRecorderFrameHandler();
    this.setPracticeState('processing');

    const turnIndex = this.data.turnCount + 1;
    this.sendFrame({
      type: 'audio_end',
      turnIndex,
    });
  },

  getRecorderManager() {
    if (!this.recorderManager) {
      this.recorderManager = wx.getRecorderManager();

      this.recorderErrorHandler = (err) => {
        console.error('[Practice] Recorder error:', err);
        this.detachRecorderFrameHandler();
        this.setPracticeState('idle', {
          statusText: '录音失败，请确认麦克风权限已开启后再试。',
        });
        wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' });
      };

      this.recorderStopHandler = () => {
        if (this.data.isRecording) {
          this.finishRecordingTurn();
        }
      };

      this.recorderManager.onError(this.recorderErrorHandler);
      this.recorderManager.onStop(this.recorderStopHandler);
    }
    return this.recorderManager;
  },

  attachRecorderFrameHandler() {
    const recorderManager = this.getRecorderManager();
    this.recorderFrameEnabled = true;

    if (this.recorderFrameHandler) return;

    this.recorderFrameHandler = (res) => {
      if (!this.recorderFrameEnabled || !this.data.isRecording) return;

      const base64 = wx.arrayBufferToBase64(res.frameBuffer);
      this.sendFrame({
        type: 'audio_chunk',
        data: base64,
        seq: Date.now(),
      });
    };

    recorderManager.onFrameRecorded(this.recorderFrameHandler);
  },

  detachRecorderFrameHandler() {
    this.recorderFrameEnabled = false;
    if (!this.recorderManager || !this.recorderFrameHandler) return;

    if (typeof this.recorderManager.offFrameRecorded === 'function') {
      this.recorderManager.offFrameRecorded(this.recorderFrameHandler);
      this.recorderFrameHandler = null;
    }
  },

  onTapHint() {
    this.setData({ showHint: !this.data.showHint });
  },

  onTapRetryTurn() {
    if (this.data.state !== 'idle') return;
    this.setData({ canRetryTurn: false });
    this.startRecording();
  },

  endPractice() {
    if (this.hasNavigated) return;
    this.hasNavigated = true;

    const { sessionId, scenarioId } = this.data;
    const query = sessionId ? `sessionId=${sessionId}&scenarioId=${scenarioId}` : `scenarioId=${scenarioId}`;
    wx.navigateTo({
      url: `/pages/review/index?${query}`,
      fail: () => {
        this.hasNavigated = false;
        wx.showToast({ title: '无法打开复盘页，请重试', icon: 'none' });
      },
    });
  },

  onTapEndEarly() {
    wx.showModal({
      title: '提前结束',
      content: '确定要提前结束练习吗？已完成的轮次会生成一份局部复盘。',
      success: (res) => {
        if (res.confirm) {
          const requestReview = this.data.turnCount > 0;
          this.isEndingEarly = true;
          this.sendFrame({ type: 'abort', reason: 'user_exit', requestReview });

          if (requestReview) {
            this.setPracticeState('processing', { statusText: '正在生成局部复盘...' });
            this.earlyEndFallbackTimer = setTimeout(() => this.endPractice(), 1500);
          } else {
            this.endPractice();
          }
        }
      },
    });
  },
});
