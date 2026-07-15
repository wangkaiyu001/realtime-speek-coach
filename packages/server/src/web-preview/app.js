const API_URL = `${location.origin}/api/v1`;
const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
const OPENING_TIMEOUT_MS = 20000;

const state = {
  token: localStorage.getItem('echoia_preview_token') || '',
  userId: localStorage.getItem('echoia_preview_user_id') || '',
  language: '',
  scenarios: [],
  selectedScenario: null,
  ws: null,
  sessionId: '',
  currentTurn: 0,
  totalTurns: 10,
  isAiStreaming: false,
  activeAiBubble: null,
  heartbeatTimer: 0,
  recognition: null,
  isRecording: false,
  speechSupported: false,
  voiceMode: 'text',
  mediaStream: null,
  audioContext: null,
  audioSource: null,
  audioProcessor: null,
  recordingSeq: 0,
  activeTurnIndex: 0,
  pendingUserTurnIndex: 0,
  pendingUserBubble: null,
  renderedUserTurns: new Set(),
  ttsChunks: [],
  lastTtsChunks: [],
  lastTtsMimeType: 'audio/mpeg',
  lastTtsSampleRate: 24000,
  openingWatchdog: 0,
  reconnectAttempts: 0,
  maxReconnectAttempts: 1,
};

const els = {
  serverDot: document.querySelector('#serverDot'),
  serverStatus: document.querySelector('#serverStatus'),
  serverMeta: document.querySelector('#serverMeta'),
  languageStep: document.querySelector('#languageStep'),
  scenarioStep: document.querySelector('#scenarioStep'),
  practiceStep: document.querySelector('#practiceStep'),
  reviewStep: document.querySelector('#reviewStep'),
  historyStep: document.querySelector('#historyStep'),
  scenarioGrid: document.querySelector('#scenarioGrid'),
  scenarioHint: document.querySelector('#scenarioHint'),
  practiceTitle: document.querySelector('#practiceTitle'),
  practiceDesc: document.querySelector('#practiceDesc'),
  turnProgress: document.querySelector('#turnProgress'),
  chat: document.querySelector('#chat'),
  voiceAnswer: document.querySelector('#voiceAnswer'),
  voiceTitle: document.querySelector('#voiceTitle'),
  voiceHint: document.querySelector('#voiceHint'),
  coachVoice: document.querySelector('#coachVoice'),
  replayCoachVoice: document.querySelector('#replayCoachVoice'),
  coachVoiceHint: document.querySelector('#coachVoiceHint'),
  answerInput: document.querySelector('#answerInput'),
  sendAnswer: document.querySelector('#sendAnswer'),
  quickAnswer: document.querySelector('#quickAnswer'),
  endEarly: document.querySelector('#endEarly'),
  practiceStatus: document.querySelector('#practiceStatus'),
  reviewSubtitle: document.querySelector('#reviewSubtitle'),
  reviewContent: document.querySelector('#reviewContent'),
  restart: document.querySelector('#restart'),
  backToScenarios: document.querySelector('#backToScenarios'),
  historyList: document.querySelector('#historyList'),
};

const sampleAnswers = {
  en: [
    'I would like a medium latte, please.',
    'Hot, please. Could I have it with oat milk?',
    'That sounds good. Do you have any fresh pastries today?',
    'I will pay by card, thanks.',
  ],
  ja: [
    'ホットコーヒーを一つお願いします。',
    'ミルクだけお願いします。',
    'メロンパンもありますか。',
    'カードで払えますか。',
  ],
};

const scenarioSampleAnswers = {
  'en-business-01': [
    'The main feature is almost ready, but we still have a few integration risks.',
    'The biggest blocker is the payment callback, and we need one more round of QA.',
    'I can share an updated launch plan by tomorrow afternoon.',
  ],
  'en-travel-01': [
    'Yes, I have a reservation under Chen.',
    'Could I get a quiet room on a higher floor?',
    'What time does breakfast start tomorrow?',
  ],
  'en-ielts-01': [
    'I would like to describe Kyoto, because I visited it last year and found it very memorable.',
    'The city impressed me because it combines history, nature, and modern life.',
  ],
  'en-daily-01': [
    'I am thinking about watching a movie or trying a new restaurant.',
    'I would prefer something relaxing because this week was quite busy.',
  ],
  'ja-business-01': [
    '田中と申します。三年間、Webアプリの開発を担当してきました。',
    '前職では、予約システムの改善プロジェクトをリードしました。',
  ],
  'ja-travel-01': [
    'すみません、駅へ行きたいのですが、道を教えていただけますか。',
    '歩いて何分ぐらいかかりますか。',
  ],
  'ja-jsst-01': [
    '私の趣味は映画を見ることです。特にアクション映画が好きです。',
    '週末によく映画館へ行きます。',
  ],
  'ja-daily-01': [
    'そうですね。今日はとても気持ちがいい天気ですね。',
    '午後は公園を散歩しようと思っています。',
  ],
};

function setServerStatus(kind, title, meta) {
  els.serverDot.className = `dot ${kind || ''}`.trim();
  els.serverStatus.textContent = title;
  els.serverMeta.textContent = meta;
}

function describeVoiceMode(health) {
  const voiceMocked = Boolean(health.mocks?.voice);
  const hasVolcVoice = Boolean(health.providers?.volcVoice);
  if (!voiceMocked && hasVolcVoice) {
    return '真实语音 API 已接入';
  }
  if (!voiceMocked && !hasVolcVoice) {
    return '真实语音未配置密钥';
  }
  return health.mock ? 'Mock 体验模式已开启' : '文本/浏览器语音降级模式';
}

function applyVoiceMode(health) {
  const voiceMocked = Boolean(health.mocks?.voice);
  const hasVolcVoice = Boolean(health.providers?.volcVoice);
  state.voiceMode = !voiceMocked && hasVolcVoice ? 'backend' : 'text';

  if (state.voiceMode === 'backend') {
    state.speechSupported = Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
    els.voiceTitle.textContent = '真实语音对话';
    els.voiceHint.textContent = '会把麦克风音频发送到后端 ASR，AI 回复后再用后端 TTS 播放。';
    els.voiceAnswer.textContent = state.speechSupported ? '点击开始录音' : '当前浏览器不支持录音';
    els.voiceAnswer.classList.toggle('unsupported', !state.speechSupported);
    return;
  }

  setupSpeechInput();
}

function resetTtsBuffer() {
  state.ttsChunks = [];
}

function resetCoachVoice() {
  state.lastTtsChunks = [];
  state.lastTtsMimeType = 'audio/mpeg';
  state.lastTtsSampleRate = 24000;
  hideCoachVoiceButton();
}

function showCoachVoiceButton(label = '播放教练语音', hint = '如果浏览器没有自动播放，请点击播放。') {
  els.replayCoachVoice.textContent = label;
  els.coachVoiceHint.textContent = hint;
  show(els.coachVoice);
}

function hideCoachVoiceButton() {
  hide(els.coachVoice);
}

function show(element) {
  element.classList.remove('hidden');
}

function hide(element) {
  element.classList.add('hidden');
}

function setPracticeEnabled(enabled) {
  els.answerInput.disabled = !enabled;
  els.voiceAnswer.disabled = !enabled || !state.speechSupported;
  els.sendAnswer.disabled = !enabled;
  els.quickAnswer.disabled = !enabled;
  els.endEarly.disabled = !state.sessionId;
}

function setPracticeStatus(text) {
  els.practiceStatus.textContent = text;
}

function updateProgress() {
  els.turnProgress.textContent = `第 ${state.currentTurn} 轮 / 最多 ${state.totalTurns} 轮`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const { retryAuth = true, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers,
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 80);
      throw new Error(response.ok
        ? '服务返回内容异常，请刷新后重试。'
        : `服务暂时不可用（${response.status}）：${preview || '非 JSON 响应'}`);
    }
  }

  if (!response.ok) {
    if ((response.status === 401 || response.status === 403 || response.status >= 500) && retryAuth && path !== '/auth/login') {
      clearAuthState();
      await ensureLogin();
      return api(path, { ...fetchOptions, retryAuth: false });
    }
    throw new Error(data.error || data.message || `请求失败：${response.status}`);
  }

  return data;
}

function clearAuthState() {
  state.token = '';
  state.userId = '';
  localStorage.removeItem('echoia_preview_token');
  localStorage.removeItem('echoia_preview_user_id');
}

async function ensureLogin() {
  if (state.token) return;

  const visitorId = localStorage.getItem('echoia_preview_visitor') || crypto.randomUUID();
  localStorage.setItem('echoia_preview_visitor', visitorId);

  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ code: `web-preview-${visitorId}` }),
  });

  state.token = result.token;
  state.userId = result.userId;
  localStorage.setItem('echoia_preview_token', state.token);
  localStorage.setItem('echoia_preview_user_id', state.userId);
}

async function boot() {
  bindEvents();

  try {
    const health = await api('/health');
    applyVoiceMode(health);
    setServerStatus('ok', '服务已连接', describeVoiceMode(health));
    await ensureLogin();

    await loadHistory().catch((error) => {
      console.warn('[Preview] Failed to load history:', error);
    });
  } catch (error) {
    console.error(error);
    clearAuthState();
    setServerStatus('err', '线上服务连接失败', error.message || '请稍后刷新');
  }
}

function bindEvents() {
  els.sendAnswer.addEventListener('click', sendAnswer);
  els.answerInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      sendAnswer(event);
    }
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('#sendAnswer, [data-scenario-id], [data-language]');
    if (!target) return;

    if (target.id === 'sendAnswer') {
      sendAnswer(event);
      return;
    }

    if (target.dataset?.scenarioId) {
      event.preventDefault();
      startPractice(target.dataset.scenarioId);
      return;
    }

    if (target.dataset?.language) {
      event.preventDefault();
      target.disabled = true;
      selectLanguage(target.dataset.language).catch((error) => {
        target.disabled = false;
        setServerStatus('err', '语言切换失败', error.message || '请刷新后重试');
      });
    }
  });
  els.voiceAnswer.addEventListener('click', toggleSpeechInput);
  els.replayCoachVoice.addEventListener('click', replayCoachVoice);
  els.quickAnswer.addEventListener('click', () => {
    const samples = scenarioSampleAnswers[state.selectedScenario?.id] || sampleAnswers[state.language] || sampleAnswers.en;
    els.answerInput.value = samples[state.currentTurn % samples.length];
    els.answerInput.focus();
  });
  els.endEarly.addEventListener('click', endEarly);
  els.restart.addEventListener('click', () => location.reload());
  els.backToScenarios.addEventListener('click', () => {
    closeSocket();
    hide(els.practiceStep);
    hide(els.reviewStep);
    hide(els.languageStep);
    show(els.scenarioStep);
    show(els.historyStep);
  });
}

function setupSpeechInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  els.voiceAnswer.classList.remove('unsupported');
  state.speechSupported = Boolean(SpeechRecognition);

  if (!SpeechRecognition) {
    els.voiceAnswer.classList.add('unsupported');
    els.voiceAnswer.textContent = '当前浏览器不支持语音识别';
    els.voiceTitle.textContent = '语音输入不可用';
    els.voiceHint.textContent = '建议使用 Chrome / Edge 打开；当前先保留文本输入作为降级体验。';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = state.language === 'ja' ? 'ja-JP' : 'en-US';

  recognition.onstart = () => {
    state.isRecording = true;
    els.voiceAnswer.classList.add('recording');
    els.voiceAnswer.textContent = '正在听你说话...';
    setPracticeStatus('正在听你说话，结束后会自动填入识别结果。');
  };

  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    const text = (finalText || interimText).trim();
    if (text) {
      els.answerInput.value = text;
      setPracticeStatus(finalText ? `已识别：${finalText.trim()}` : `识别中：${interimText.trim()}`);
    }
  };

  recognition.onerror = (event) => {
    const message = event.error === 'not-allowed'
      ? '麦克风权限被拒绝，请允许浏览器使用麦克风后再试。'
      : '语音识别暂时不可用，可以重试或先用文本输入。';
    setPracticeStatus(message);
  };

  recognition.onend = () => {
    state.isRecording = false;
    els.voiceAnswer.classList.remove('recording');
    els.voiceAnswer.textContent = '点击开始说话';
    if (els.answerInput.value.trim()) {
      setPracticeStatus('识别完成，可以发送回答；也可以先手动修改。');
    }
  };

  state.recognition = recognition;
  els.voiceAnswer.textContent = '点击开始说话';
}

function updateSpeechLanguage() {
  if (state.recognition) {
    state.recognition.lang = state.language === 'ja' ? 'ja-JP' : 'en-US';
  }
}

async function toggleSpeechInput() {
  if (els.voiceAnswer.disabled) return;

  if (state.voiceMode === 'backend') {
    if (state.isRecording) {
      stopBackendRecording({ submit: true });
      return;
    }
    await startBackendRecording();
    return;
  }

  if (!state.recognition) return;

  if (state.isRecording) {
    state.recognition.stop();
    return;
  }

  els.answerInput.value = '';
  try {
    state.recognition.start();
  } catch (error) {
    setPracticeStatus('语音识别已经在启动中，请稍等一下。');
  }
}

async function startBackendRecording() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    state.audioContext = new AudioContextClass();
    await state.audioContext.resume();
    state.audioSource = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.audioProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);
    state.recordingSeq = 0;
    state.activeTurnIndex = state.currentTurn + 1;

    state.audioProcessor.onaudioprocess = (event) => {
      try {
        const ws = state.ws;
        const context = state.audioContext;
        if (!state.isRecording || !context || !ws || ws.readyState !== WebSocket.OPEN) return;

        const input = event.inputBuffer.getChannelData(0);
        const pcm = encodePcm16(resampleTo16k(input, context.sampleRate));
        if (pcm.byteLength === 0) return;

        ws.send(JSON.stringify({
          type: 'audio_chunk',
          data: arrayBufferToBase64(pcm),
          seq: state.recordingSeq++,
        }));
      } catch (error) {
        handleRecordingFailure(error);
      }
    };

    state.audioSource.connect(state.audioProcessor);
    state.audioProcessor.connect(state.audioContext.destination);
    state.isRecording = true;
    els.answerInput.value = '';
    els.voiceAnswer.classList.add('recording');
    els.voiceAnswer.textContent = '正在录音，点击结束';
    setPracticeStatus('正在录音。说完后点击按钮结束，系统会调用后端 ASR 识别。');
  } catch (error) {
    await cleanupRecording();
    const message = error?.name === 'NotAllowedError'
      ? '麦克风权限被拒绝，请允许浏览器使用麦克风后再试。'
      : '无法启动麦克风录音，请检查浏览器权限或设备。';
    setPracticeStatus(message);
  }
}

function handleRecordingFailure(error) {
  if (!state.isRecording) return;
  console.warn('Recording interrupted', error);
  state.isRecording = false;
  cleanupRecording().catch(console.error);
  els.voiceAnswer.classList.remove('recording');
  els.voiceAnswer.textContent = '点击开始录音';
  setPracticeEnabled(true);
  setPracticeStatus('录音暂时中断，请再录一次；也可以改用文本继续。');
}

function stopBackendRecording(options = { submit: false }) {
  if (!state.isRecording) return;
  state.isRecording = false;
  els.voiceAnswer.classList.remove('recording');
  els.voiceAnswer.textContent = '点击开始录音';
  setPracticeEnabled(false);
  setPracticeStatus('录音已结束，正在识别你的回答...');

  const ws = state.ws;
  const turnIndex = state.activeTurnIndex || state.currentTurn + 1;
  cleanupRecording().finally(() => {
    if (options.submit && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'audio_end', turnIndex }));
    }
  });
}

async function cleanupRecording() {
  if (state.audioProcessor) {
    state.audioProcessor.disconnect();
    state.audioProcessor.onaudioprocess = null;
    state.audioProcessor = null;
  }
  if (state.audioSource) {
    state.audioSource.disconnect();
    state.audioSource = null;
  }
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
  if (state.audioContext) {
    const context = state.audioContext;
    state.audioContext = null;
    if (context.state !== 'closed') await context.close();
  }
}

function resampleTo16k(input, sourceRate) {
  const targetRate = 16000;
  if (!input.length) return new Float32Array(0);
  if (sourceRate === targetRate) return input;

  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const index = i * ratio;
    const left = Math.floor(index);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = index - left;
    output[i] = input[left] + (input[right] - input[left]) * fraction;
  }
  return output;
}

function encodePcm16(input) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function selectLanguage(language, options = {}) {
  state.language = language;
  localStorage.setItem('echoia_preview_language', language);
  updateSpeechLanguage();
  await ensureLogin();
  await api('/user/language', {
    method: 'POST',
    body: JSON.stringify({ language }),
  });

  if (!options.silent) {
    addTransientNotice(language === 'ja' ? '已选择日语' : '已选择英语');
  }

  hide(els.languageStep);
  show(els.scenarioStep);
  show(els.historyStep);
  await loadScenarios();
}

function addTransientNotice(text) {
  setServerStatus('ok', text, '可以选择场景开始体验');
  setTimeout(() => setServerStatus('ok', '服务已连接', state.voiceMode === 'backend' ? '真实语音 API 已接入' : '可继续体验'), 1200);
}

async function loadScenarios() {
  els.scenarioGrid.innerHTML = '<p class="status-text">正在加载场景...</p>';
  const data = await api('/scenarios');
  state.scenarios = data.scenarios || [];
  els.scenarioHint.textContent = state.language === 'ja' ? '请选择一个日语场景开始。' : '请选择一个英语场景开始。';

  els.scenarioGrid.innerHTML = state.scenarios.map((scenario) => `
    <button class="scenario-card" data-scenario-id="${escapeHtml(scenario.id)}">
      <strong>${escapeHtml(scenario.titleCn || scenario.title)}</strong>
      <span>${escapeHtml(scenario.descriptionCn || scenario.description)}</span>
      <div class="badges">
        <span class="badge">${escapeHtml(scenario.language === 'ja' ? '日语' : '英语')}</span>
        <span class="badge">难度 ${escapeHtml(scenario.difficulty)}</span>
        <span class="badge">${escapeHtml(categoryName(scenario.category))}</span>
      </div>
    </button>
  `).join('');

  els.scenarioGrid.querySelectorAll('[data-scenario-id]').forEach((button) => {
    button.type = 'button';
  });
}

function categoryName(category) {
  const names = {
    shopping: '购物',
    travel: '旅行',
    business: '商务',
    meeting: '会议',
    project: '项目',
    news: '新闻',
    ielts_mock: '雅思',
    jsst_mock: 'JSST',
    daily: '日常',
    food: '餐饮',
  };
  return names[category] || category;
}

function startPractice(scenarioId, options = {}) {
  const scenario = state.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) {
    setServerStatus('err', '场景打开失败', '请刷新后重新选择场景');
    return;
  }

  closeSocket();
  if (!options.reconnect) {
    state.reconnectAttempts = 0;
  }
  state.selectedScenario = scenario;
  state.sessionId = '';
  state.currentTurn = 0;
  state.totalTurns = scenario.maxTurns || 6;
  state.activeAiBubble = null;
  state.isAiStreaming = false;
  state.pendingUserTurnIndex = 0;
  state.pendingUserBubble = null;
  state.renderedUserTurns = new Set();
  resetTtsBuffer();
  clearOpeningWatchdog();
  updateSpeechLanguage();

  els.chat.innerHTML = '';
  els.reviewContent.innerHTML = '';
  els.answerInput.value = '';
  resetCoachVoice();
  els.practiceTitle.textContent = scenario.titleCn || scenario.title;
  els.practiceDesc.textContent = scenario.descriptionCn || scenario.description;
  updateProgress();
  hide(els.scenarioStep);
  hide(els.reviewStep);
  show(els.practiceStep);
  show(els.historyStep);
  setPracticeEnabled(false);
  setPracticeStatus(options.reconnect ? '连接中断，正在自动恢复练习...' : '正在进入练习...');
  addMessage('system', options.reconnect ? '连接刚刚中断，正在自动重连 AI 教练...' : '正在连接 AI 教练，请稍候...');

  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      type: 'hello',
      sessionId: '',
      scenarioId: scenario.id,
      language: state.language,
    }));
    state.heartbeatTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
      }
    }, 15000);
  });

  ws.addEventListener('message', (event) => {
    try {
      handleWsMessage(JSON.parse(event.data));
    } catch (error) {
      addMessage('system', '练习消息解析失败，请重新选择场景再试。');
      setPracticeEnabled(false);
      setPracticeStatus(error.message || '消息解析失败');
    }
  });
  ws.addEventListener('close', () => {
    if (state.ws !== ws) return;
    window.clearInterval(state.heartbeatTimer);
    clearOpeningWatchdog();
    state.ws = null;

    if (state.selectedScenario && state.reconnectAttempts < state.maxReconnectAttempts) {
      state.reconnectAttempts += 1;
      setPracticeStatus('连接中断，正在自动恢复一次...');
      setPracticeEnabled(false);
      window.setTimeout(() => {
        if (!state.ws && state.selectedScenario) {
          startPractice(state.selectedScenario.id, { reconnect: true });
        }
      }, 600);
      return;
    }

    addMessage('system', '练习连接已断开。你可以返回场景列表后重新进入。');
    setPracticeStatus('连接已断开，请重新进入当前场景。');
    setPracticeEnabled(false);
  });
  ws.addEventListener('error', () => {
    setPracticeStatus('连接练习服务失败，请刷新后重试。');
    setPracticeEnabled(false);
  });
}

function handleWsMessage(frame) {
  if (frame.type === 'ready') {
    state.sessionId = frame.sessionId;
    state.totalTurns = frame.totalTurns;
    updateProgress();
    setPracticeStatus('AI 教练正在开场...');
    els.endEarly.disabled = true;
    startOpeningWatchdog();
    return;
  }

  if (frame.type === 'llm_delta') {
    clearOpeningWatchdog();
    renderAiDelta(frame.accumulated || frame.text || '');
    return;
  }

  if (frame.type === 'asr_partial') {
    setPracticeStatus(`识别中：${frame.text}`);
    return;
  }

  if (frame.type === 'asr_final') {
    setPracticeStatus(`已识别：${frame.text}`);
    if (state.voiceMode === 'backend' && frame.text) {
      renderUserTurn(frame.turnIndex, frame.text);
    }
    return;
  }

  if (frame.type === 'tts_chunk') {
    clearOpeningWatchdog();
    handleTtsChunk(frame);
    return;
  }

  if (frame.type === 'turn_end') {
    clearOpeningWatchdog();
    state.currentTurn = frame.turnIndex;
    updateProgress();

    if (frame.sessionComplete) {
      setPracticeEnabled(false);
      setPracticeStatus(frame.reviewRequested ? '已提前结束，正在打开复盘...' : '练习完成，正在打开复盘...');
      closeSocket({ keepSession: true });
      setTimeout(() => fetchReview(), 350);
    } else {
      setPracticeEnabled(true);
      setPracticeStatus('轮到你回答了。');
    }
    loadHistory().catch(console.error);
    return;
  }

  if (frame.type === 'error') {
    clearOpeningWatchdog();
    addMessage('system', frame.message || '出现了一个错误，请重试。');
    setPracticeEnabled(true);
    setPracticeStatus(frame.retryable ? '可以重录或改用文本继续。' : '请重新开始练习。');
  }
}

function startOpeningWatchdog() {
  clearOpeningWatchdog();
  state.openingWatchdog = window.setTimeout(() => {
    addMessage('system', 'AI 开场响应超时。你可以先用文本输入继续测试，或重新选择场景再试。');
    setPracticeEnabled(true);
    setPracticeStatus('AI 开场超时，已打开文本兜底。');
  }, OPENING_TIMEOUT_MS);
}

function clearOpeningWatchdog() {
  if (state.openingWatchdog) {
    window.clearTimeout(state.openingWatchdog);
    state.openingWatchdog = 0;
  }
}

async function handleTtsChunk(frame) {
  if (frame.data) {
    state.ttsChunks.push(frame.data);
  }

  if (!frame.isLast) return;

  const chunks = [...state.ttsChunks];
  const mimeType = frame.mimeType || 'audio/mpeg';
  const sampleRate = frame.sampleRate || 24000;

  if (state.voiceMode === 'backend' && state.ttsChunks.length > 0) {
    state.lastTtsChunks = chunks;
    state.lastTtsMimeType = mimeType;
    state.lastTtsSampleRate = sampleRate;
    showCoachVoiceButton('重播教练语音', '已生成教练语音；如果没有听到，可以点这里重播。');
    setPracticeStatus('AI 语音播放中...');
    try {
      await playTtsChunks(chunks, mimeType, sampleRate);
      showCoachVoiceButton('重播教练语音', '教练语音已播放；需要时可以点这里重播。');
    } catch (error) {
      showCoachVoiceButton('播放教练语音', '浏览器可能拦截了自动播放，点击即可播放。');
      setPracticeStatus('浏览器拦截了自动播放，请点击“播放教练语音”。');
    }
  } else if (state.voiceMode === 'backend') {
    showCoachVoiceButton('教练语音暂不可用', '这次语音生成未返回音频，但文字对话可以继续。');
  }

  resetTtsBuffer();
  if (state.activeAiBubble) {
    state.activeAiBubble = null;
    state.isAiStreaming = false;
  }
  setPracticeEnabled(true);
  setPracticeStatus(state.voiceMode === 'backend' ? '轮到你说了。' : '轮到你回答了。');
}

async function replayCoachVoice() {
  if (!state.lastTtsChunks.length) {
    setPracticeStatus('当前还没有可播放的教练语音。');
    return;
  }

  try {
    setPracticeStatus('正在播放教练语音...');
    await playTtsChunks(state.lastTtsChunks, state.lastTtsMimeType, state.lastTtsSampleRate);
    showCoachVoiceButton('重播教练语音', '播放完成；轮到你回答了。');
    setPracticeStatus('播放完成，轮到你回答了。');
  } catch (error) {
    showCoachVoiceButton('播放教练语音', '播放失败，请确认浏览器允许播放音频后再试。');
    setPracticeStatus('播放失败，请确认浏览器允许播放音频后再试。');
  }
}

async function playTtsChunks(chunks, mimeType = 'audio/mpeg', sampleRate = 24000) {
  const bytes = base64ChunksToBytes(chunks);
  if (bytes.byteLength === 0) return;

  const blob = new Blob([
    mimeType === 'audio/pcm' ? pcm16ToWav(bytes, sampleRate) : bytes,
  ], { type: mimeType === 'audio/pcm' ? 'audio/wav' : mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    await audio.play();
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function base64ChunksToBytes(chunks) {
  const arrays = chunks.map((chunk) => {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  });
  const total = arrays.reduce((sum, item) => sum + item.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((item) => {
    merged.set(item, offset);
    offset += item.byteLength;
  });
  return merged;
}

function pcm16ToWav(pcmBytes, sampleRate) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);

  const wav = new Uint8Array(44 + pcmBytes.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmBytes, 44);
  return wav;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function renderAiDelta(text) {
  if (!state.activeAiBubble) {
    resetTtsBuffer();
    state.activeAiBubble = addMessage('ai', '');
    state.isAiStreaming = true;
  }
  state.activeAiBubble.textContent = text;
  scrollChatToBottom();
}

function addMessage(role, text) {
  const labels = { ai: 'AI', user: '你', system: '提示' };
  const message = document.createElement('div');
  message.className = `message ${role === 'user' ? 'user' : ''}`;
  message.innerHTML = `
    <div class="avatar">${labels[role] || 'AI'}</div>
    <div class="bubble"></div>
  `;
  const bubble = message.querySelector('.bubble');
  bubble.textContent = text;
  els.chat.appendChild(message);
  scrollChatToBottom();
  return bubble;
}

function renderUserTurn(turnIndex, text) {
  if (!turnIndex || !text) return;

  if (state.pendingUserTurnIndex === turnIndex && state.pendingUserBubble) {
    state.pendingUserBubble.textContent = text;
    scrollChatToBottom();
    return;
  }

  if (state.renderedUserTurns.has(turnIndex)) {
    return;
  }

  state.pendingUserTurnIndex = turnIndex;
  state.pendingUserBubble = addMessage('user', text);
  state.renderedUserTurns.add(turnIndex);
}

function scrollChatToBottom() {
  els.chat.scrollTop = els.chat.scrollHeight;
}

function sendAnswer(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  if (els.sendAnswer.disabled) {
    setPracticeStatus('AI 教练还在回复，请稍等一下。');
    return;
  }

  if (state.voiceMode === 'backend') {
    if (state.isRecording) {
      stopBackendRecording({ submit: true });
      return;
    }
  }

  if (state.isRecording && state.recognition) {
    state.recognition.stop();
  }

  const answer = els.answerInput.value.trim();
  if (!answer) {
    setPracticeStatus('请先说一句或输入一句回答，再点击发送。');
    els.answerInput.focus();
    return;
  }

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    addMessage('system', '练习连接已断开，请返回场景列表后重新进入。');
    setPracticeStatus('连接已断开，无法发送。');
    setPracticeEnabled(false);
    return;
  }

  addMessage('user', answer);
  els.answerInput.value = '';
  setPracticeEnabled(false);
  setPracticeStatus('已发送，AI 教练正在回复...');

  try {
    const encoded = btoa(unescape(encodeURIComponent(`TEXT:${answer}\n`)));
    state.ws.send(JSON.stringify({ type: 'audio_chunk', data: encoded, seq: Date.now() }));
    state.ws.send(JSON.stringify({ type: 'audio_end', turnIndex: state.currentTurn + 1 }));
  } catch (error) {
    addMessage('system', '回答发送失败，请重新进入场景后再试。');
    setPracticeStatus(error.message || '发送失败');
    setPracticeEnabled(false);
  }
}

function endEarly() {
  if (state.isRecording) {
    stopBackendRecording({ submit: false });
  }
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    if (state.sessionId) fetchReview();
    return;
  }

  setPracticeEnabled(false);
  setPracticeStatus('正在提前结束并生成复盘...');
  state.ws.send(JSON.stringify({
    type: 'abort',
    reason: 'user_exit',
    requestReview: state.currentTurn > 0,
  }));
}

async function fetchReview() {
  if (!state.sessionId) return;

  show(els.reviewStep);
  els.reviewSubtitle.textContent = '正在生成复盘...';
  els.reviewContent.innerHTML = '<p class="status-text">请稍等，正在整理本次练习表现。</p>';

  try {
    try {
      await api(`/reviews/${state.sessionId}/request`, { method: 'POST', body: JSON.stringify({}) });
    } catch (error) {
      if (!isMissingSessionError(error)) {
        throw error;
      }

      const recovered = await recoverReviewSession();
      if (!recovered) throw error;
      els.reviewSubtitle.textContent = '已恢复最近一次练习，正在生成复盘...';
      await api(`/reviews/${state.sessionId}/request`, { method: 'POST', body: JSON.stringify({}) });
    }

    for (let attempt = 0; attempt < 45; attempt += 1) {
      const data = await api(`/reviews/${state.sessionId}`);
      const review = data.review;
      if (review.status === 'completed') {
        renderReview(review);
        await loadHistory();
        return;
      }
      if (review.status === 'failed') {
        throw new Error(review.overallComment || '复盘生成失败，请稍后重试。');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    els.reviewSubtitle.textContent = '复盘还在生成中';
    els.reviewContent.innerHTML = '<p class="status-text">复盘耗时较久，可以点“看复盘”继续刷新查看。</p>';
  } catch (error) {
    els.reviewSubtitle.textContent = '复盘暂时不可用';
    els.reviewContent.innerHTML = `<p class="status-text">${escapeHtml(toReviewErrorMessage(error))}</p>`;
  }
}

function isMissingSessionError(error) {
  return error instanceof Error && /session not found/i.test(error.message || '');
}

function toReviewErrorMessage(error) {
  if (isMissingSessionError(error)) {
    return '没有找到当前练习记录。请从“最近练习”里选择一条有对话的记录查看复盘。';
  }
  return error?.message || '复盘生成失败，请稍后重试。';
}

async function recoverReviewSession() {
  try {
    const data = await api('/sessions');
    const recovered = (data.sessions || []).find((session) => Number(session.turnsCompleted || 0) > 0);
    if (!recovered?.id) return false;
    state.sessionId = recovered.id;
    return true;
  } catch {
    return false;
  }
}

function renderReview(review) {
  const dimensions = review.dimensions || {};
  const scores = Object.entries({
    pronunciation: '发音',
    grammar: '语法',
    vocabulary: '词汇',
    fluency: '流利度',
    interaction: '互动',
  }).map(([key, label]) => {
    const value = Number(dimensions[key] || 0);
    return `
      <div class="dimension">
        <strong>${label} ${value}</strong>
        <div class="bar"><span style="width:${Math.max(0, Math.min(100, value))}%"></span></div>
      </div>
    `;
  }).join('');

  const average = Math.round(Object.keys(dimensions).reduce((sum, key) => sum + Number(dimensions[key] || 0), 0) / Math.max(Object.keys(dimensions).length, 1));

  els.reviewSubtitle.textContent = '本次复盘已生成。';
  els.reviewContent.innerHTML = `
    <div class="score-card">
      <div>综合表现</div>
      <div class="score">${average}</div>
      <p>${escapeHtml(review.overallComment || '本次练习完成。')}</p>
    </div>
    <div class="dimension-grid">${scores}</div>
    ${renderListCard('亮点', review.highlights)}
    ${renderListCard('建议', review.suggestions)}
    ${renderCorrections(review.corrections)}
  `;
}

function renderListCard(title, items) {
  const safeItems = Array.isArray(items) ? items : [];
  return `
    <div class="list-card">
      <h3>${title}</h3>
      <ul>${safeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
  `;
}

function renderCorrections(corrections) {
  const safeCorrections = Array.isArray(corrections) ? corrections : [];
  if (safeCorrections.length === 0) return '';

  return `
    <div class="list-card">
      <h3>表达优化</h3>
      ${safeCorrections.map((item) => `
        <div class="correction">
          <strong>第 ${escapeHtml(item.turnIndex)} 轮</strong>
          <p>你说：${escapeHtml(item.userSaid || '')}</p>
          <p>更自然：${escapeHtml(item.nativeSay || '')}</p>
          <p>${escapeHtml(item.correctionReason || '')}</p>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadHistory() {
  if (!state.token) return;

  try {
    const data = await api('/sessions');
    const sessions = data.sessions || [];
    if (sessions.length === 0) {
      els.historyList.innerHTML = '<p class="status-text">还没有练习记录。</p>';
      return;
    }

    els.historyList.innerHTML = sessions.slice(0, 6).map((session) => `
      <div class="history-item">
        <div>
          <strong>${escapeHtml(session.scenarioTitle)}</strong>
          <p>${escapeHtml(session.turnsCompleted)}/${escapeHtml(session.totalTurns)} 轮 · ${escapeHtml(statusName(session.status, session.reviewStatus))}</p>
        </div>
        <button class="secondary" data-review-session="${escapeHtml(session.id)}" ${session.turnsCompleted > 0 ? '' : 'disabled'}>看复盘</button>
      </div>
    `).join('');

    els.historyList.querySelectorAll('[data-review-session]').forEach((button) => {
      button.addEventListener('click', () => {
        state.sessionId = button.dataset.reviewSession;
        hide(els.practiceStep);
        fetchReview();
      });
    });
  } catch (error) {
    els.historyList.innerHTML = `<p class="status-text">最近练习暂不可用，不影响本次练习。</p>`;
  }
}

function statusName(status, reviewStatus) {
  if (reviewStatus === 'completed') return '已生成复盘';
  if (status === 'completed') return '已完成';
  if (status === 'abandoned') return '已结束';
  return '进行中';
}

function closeSocket(options = {}) {
  window.clearInterval(state.heartbeatTimer);
  clearOpeningWatchdog();
  if (state.isRecording) {
    stopBackendRecording({ submit: false });
  } else {
    cleanupRecording().catch(console.error);
  }
  const ws = state.ws;
  state.ws = null;
  if (ws) {
    ws.close(1000, 'preview reset');
  }
  state.activeAiBubble = null;
  state.isAiStreaming = false;

  if (!options.keepSession) {
    state.sessionId = '';
  }
}

boot();
