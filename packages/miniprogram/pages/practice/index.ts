// pages/practice/index.ts
// Practice room - core conversation page

import { IAppOption, refreshLogin } from '../../app';
import { connectContainerSocket } from '../../utils/cloud-container';

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
  code?: string;
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
    statusText: '正在进入场景...',
    turnCount: 0,
    maxTurns: 10,
    asrText: '',
    llmText: '',
    chatMessages: [] as ChatMessage[],
    activeAiMessageId: '',
    activeUserMessageId: '',
    isRecording: false,
    recordButtonText: '请稍候',
    recordDisabled: true,
    canRetryTurn: false,
    showHint: false,
    hintText: '不用追求完美。像面对真人一样，先回应，再补一句原因。',
    sessionId: '',
    coachName: 'Mia',
    coachMood: '很高兴见到你',
    coachMoodClass: 'warm',
    transcriptVisible: true,
    handsFree: false,
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
  autoSendTimer: null as TimeoutHandle | null,
  recordingStartedAt: 0,
  speechDetectedAt: 0,
  lastVoiceAt: 0,

  onLoad(options: { scenarioId?: string }) {
    const scenarioId = options.scenarioId || 'en-shopping-01';
    this.setData({
      scenarioId,
      coachName: normalizeLanguage(app.globalData.language) === 'ja' ? 'Aoi' : 'Mia',
    });
    this.connectWebSocket();
  },

  onUnload() {
    this.stopAudioPlayback();
    this.stopAutoSendTimer();
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

  async connectWebSocket() {
    const { token } = app.globalData;

    try {
      this.wsClient = await connectContainerSocket('/ws', token);
    } catch (error) {
      console.error('[Practice] Cloud container socket connect failed:', error);
      this.setPracticeState('error', { statusText: '暂时无法进入对话，请稍后再试。' });
      return;
    }

    this.wsClient.onOpen(() => {
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
      } catch (error) {
        console.error('[Practice] Parse error:', error);
      }
    });

    this.wsClient.onClose(() => {
      if (!this.hasNavigated && !this.isEndingEarly) {
        this.setPracticeState('error', { statusText: '对话连接已断开，请返回场景页后重试。' });
      }
    });

    this.wsClient.onError((error) => {
      console.error('[Practice] Cloud container socket error:', error);
      this.setPracticeState('error', { statusText: '对话连接异常，请稍后再试。' });
    });
  },

  handleServerFrame(frame: WsServerFrame) {
    switch (frame.type) {
      case 'ready':
        this.setPracticeState('idle', {
          sessionId: frame.sessionId,
          maxTurns: frame.totalTurns,
          statusText: '老师会先开场，听完直接回应就好。',
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
          this.setPracticeState('speaking', { statusText: '老师正在说，听她的语气和重音。' });
        }
        this.enqueueAudioChunk(frame);
        break;

      case 'turn_end':
        this.handleTurnEnd(frame);
        break;

      case 'error':
        if (frame.code === 'AUTH_EXPIRED') {
          this.recoverExpiredLogin();
          break;
        }
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

  async recoverExpiredLogin() {
    if (this.wsClient) {
      this.wsClient.close({});
      this.wsClient = null;
    }
    this.setPracticeState('connecting', { statusText: '登录状态已更新，正在重新进入对话...' });

    try {
      await refreshLogin();
      if (!this.hasNavigated && !this.isEndingEarly) await this.connectWebSocket();
    } catch (error) {
      console.error('[Practice] Failed to refresh expired login:', error);
      this.setPracticeState('error', { statusText: '登录状态已失效，请返回场景页后重试。' });
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
      this.setPracticeState('idle', { statusText: '轮到你了，按一下直接说。' });
      this.maybeContinueHandsFree();
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
      recordButtonText: isRecording ? '正在听你说' : this.getRecordButtonText(state),
      recordDisabled: !isRecording && state !== 'idle',
    });
  },

  getStatusText(state: PracticeState) {
    const statusTextMap: Record<PracticeState, string> = {
      connecting: '正在进入场景...',
      idle: '轮到你了，按一下直接说。',
      recording: '正在听你说，停顿后会自动发送。',
      processing: '老师听到了，正在回应...',
      speaking: '老师正在说，听她的语气和重音。',
      error: '对话中断了，请返回后重新开始。',
    };
    return statusTextMap[state];
  },

  getRecordButtonText(state: PracticeState) {
    if (state === 'connecting') return '请稍候';
    if (state === 'processing') return '老师在回应';
    if (state === 'speaking') return '先听老师说';
    if (state === 'error') return '重新进入';
    return '按一下，直接说';
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
      avatar: this.data.coachName.slice(0, 1),
      text,
    });
    this.setData({
      llmText: text,
      coachMood: this.getCoachMood(text).label,
      coachMoodClass: this.getCoachMood(text).mood,
    });
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
      statusText: frame.sessionComplete ? '聊得不错，正在整理反馈。' : '轮到你了，按一下直接说。',
    });
    if (frame.sessionComplete) {
      this.endPractice();
    } else {
      this.maybeContinueHandsFree();
    }
  },

  // --- User actions ---

  onTapRecord() {
    if (this.data.isRecording) {
      this.stopRecording();
      return;
    }

    if (this.data.state !== 'idle') return;
    this.setData({ handsFree: true });
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
    this.stopAutoSendTimer();
    this.setPracticeState('recording', {
      asrText: '',
      llmText: '',
      canRetryTurn: false,
      activeUserMessageId,
      activeAiMessageId: '',
    });

    const recorderManager = this.getRecorderManager();
    this.recordingStartedAt = Date.now();
    this.speechDetectedAt = 0;
    this.lastVoiceAt = this.recordingStartedAt;
    this.attachRecorderFrameHandler();

    recorderManager.start({
      duration: 15000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'PCM',
      frameSize: 3, // ~100ms per frame at 16kHz
    });

    this.autoSendTimer = setTimeout(() => {
      if (this.data.isRecording) this.stopRecording();
    }, 12000);
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
                ? '麦克风已开启，按一下就可以直接说。'
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

    this.stopAutoSendTimer();
    this.detachRecorderFrameHandler();
    this.setPracticeState('processing', { statusText: '老师听到了，正在回应...' });

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

      const now = Date.now();
      const rms = this.calculatePcmRms(res.frameBuffer);
      if (rms > 0.018) {
        this.speechDetectedAt ||= now;
        this.lastVoiceAt = now;
      }

      const base64 = wx.arrayBufferToBase64(res.frameBuffer);
      this.sendFrame({
        type: 'audio_chunk',
        data: base64,
        seq: now,
      });

      if (this.speechDetectedAt && now - this.lastVoiceAt > 1200 && this.data.isRecording) {
        this.stopRecording();
      }
    };

    recorderManager.onFrameRecorded(this.recorderFrameHandler);
  },

  calculatePcmRms(buffer: ArrayBuffer) {
    if (buffer.byteLength < 2) return 0;
    const view = new DataView(buffer);
    const sampleCount = Math.floor(buffer.byteLength / 2);
    let sumSquares = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = view.getInt16(index * 2, true) / 32768;
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / sampleCount);
  },

  detachRecorderFrameHandler() {
    this.recorderFrameEnabled = false;
    if (!this.recorderManager || !this.recorderFrameHandler) return;

    if (typeof this.recorderManager.offFrameRecorded === 'function') {
      this.recorderManager.offFrameRecorded(this.recorderFrameHandler);
      this.recorderFrameHandler = null;
    }
  },

  stopAutoSendTimer() {
    if (this.autoSendTimer) {
      clearTimeout(this.autoSendTimer);
      this.autoSendTimer = null;
    }
  },

  maybeContinueHandsFree() {
    if (!this.data.handsFree || this.data.state !== 'idle') return;
    setTimeout(() => {
      if (this.data.handsFree && this.data.state === 'idle') this.startRecording();
    }, 450);
  },

  getCoachMood(text: string) {
    const normalized = text.toLowerCase();
    if (/great|excellent|perfect|wonderful|いいですね|すばらしい|ありがとう/.test(normalized)) {
      return {
        mood: 'delighted',
        label: normalizeLanguage(app.globalData.language) === 'ja' ? 'いいですね！' : 'That was lovely',
      };
    }
    if (/\?|why|what|how|どんな|なぜ|ですか/.test(normalized)) {
      return {
        mood: 'curious',
        label: normalizeLanguage(app.globalData.language) === 'ja' ? 'もっと聞かせて' : "I'm curious",
      };
    }
    return {
      mood: 'encouraging',
      label: normalizeLanguage(app.globalData.language) === 'ja' ? 'その調子です' : "You're doing well",
    };
  },

  onTapTranscript() {
    this.setData({ transcriptVisible: !this.data.transcriptVisible });
  },

  noop() {},

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
