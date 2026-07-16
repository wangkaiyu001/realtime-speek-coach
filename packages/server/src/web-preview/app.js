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
  activeAiBubble: null,
  currentAiText: '',
  heartbeatTimer: 0,
  openingWatchdog: 0,
  reconnectAttempts: 0,
  recognition: null,
  speechSupported: false,
  isListening: false,
  recognitionFinal: '',
  recognitionInterim: '',
  voiceMode: 'browser',
  coachSpeaking: false,
  pendingUserTurn: false,
  handsFree: false,
  lastCoachText: '',
  lastCoachAudio: null,
  audioChunks: [],
  audioMimeType: 'audio/mpeg',
  audioSampleRate: 24000,
  mediaStream: null,
  audioContext: null,
  audioSource: null,
  audioProcessor: null,
  recordingSeq: 0,
  recordingStartedAt: 0,
  speechStartedAt: 0,
  lastVoiceAt: 0,
  silenceTimer: 0,
  renderedUserTurns: new Set(),
};

const els = Object.fromEntries([
  'serverDot', 'serverStatus', 'serverMeta', 'languageStep', 'scenarioStep', 'practiceStep',
  'reviewStep', 'historyStep', 'scenarioGrid', 'scenarioHint', 'practiceTitle', 'practiceDesc',
  'turnProgress', 'chat', 'voiceAnswer', 'voiceTitle', 'voiceHint', 'replayCoachVoice',
  'answerInput', 'sendAnswer', 'quickAnswer', 'endEarly', 'practiceStatus', 'reviewSubtitle',
  'reviewContent', 'restart', 'backToScenarios', 'historyList', 'changeLanguage', 'leaveLesson',
  'toggleTranscript', 'coachPortrait', 'coachName', 'coachMood', 'voiceWaves', 'conversationState',
  'liveDot', 'talkLabel', 'textFallback',
].map((id) => [id, document.querySelector(`#${id}`)]));

const samples = {
  en: ['I would like a medium latte, please.', 'Yes, a higher floor would be great.', 'I think we need one more round of testing.'],
  ja: ['ホットコーヒーを一つお願いします。', '歩いて何分ぐらいですか。', '三年間、Webアプリの開発を担当しました。'],
};

function setConnection(kind, title, detail) {
  els.serverDot.className = `dot ${kind || ''}`.trim();
  els.serverStatus.textContent = title;
  els.serverMeta.textContent = detail;
}

function setConversationState(label, mode = '') {
  els.conversationState.textContent = label;
  els.liveDot.className = `live-dot ${mode}`.trim();
}

function setCoachMood(mood, label) {
  els.coachPortrait.dataset.mood = mood;
  els.coachMood.textContent = label;
}

function show(element) { element?.classList.remove('hidden'); }
function hide(element) { element?.classList.add('hidden'); }

function setUserTurnReady(ready) {
  const available = ready && state.speechSupported && !state.coachSpeaking;
  els.voiceAnswer.disabled = !available;
  els.answerInput.disabled = !ready;
  els.sendAnswer.disabled = !ready;
  els.quickAnswer.disabled = !ready;
  els.endEarly.disabled = !state.sessionId;

  if (available) {
    els.talkLabel.textContent = '按一下，直接说';
    els.voiceTitle.textContent = '轮到你了';
    els.voiceHint.textContent = state.handsFree ? '连续对话已开启，老师说完会自动听你回答。' : '按一下开始；说完停顿后自动发送，之后会自动接力。';
    setConversationState('正在等你回应', 'listening');
  } else if (ready && !state.speechSupported) {
    els.talkLabel.textContent = '麦克风不可用';
    els.voiceTitle.textContent = '可以用文字继续';
    els.voiceHint.textContent = '展开下方的文字回答，不会影响练习。';
    els.textFallback.open = true;
  }
}

function setPracticeStatus(text) { els.practiceStatus.textContent = text; }

function updateProgress() {
  els.turnProgress.textContent = state.currentTurn === 0
    ? '开场'
    : `第 ${state.currentTurn} / ${state.totalTurns} 轮`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const { retryAuth = true, ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('连接有点不稳定，请稍后再试。'); }
  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && retryAuth && path !== '/auth/login') {
      clearAuth();
      await ensureLogin();
      return api(path, { ...fetchOptions, retryAuth: false });
    }
    throw new Error(data.error || data.message || '暂时无法完成，请稍后再试。');
  }
  return data;
}

function clearAuth() {
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
  setupSpeechInput();
  try {
    const health = await api('/health');
    state.voiceMode = !health.mocks?.voice && health.providers?.volcVoice ? 'backend' : 'browser';
    setConnection('ok', '教室已准备好', '可以开始练习');
    await ensureLogin();
    await loadHistory().catch(() => {});
  } catch (error) {
    clearAuth();
    setConnection('err', '暂时无法进入教室', error.message || '请稍后刷新');
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const language = event.target.closest?.('[data-language]')?.dataset.language;
    const scenarioId = event.target.closest?.('[data-scenario-id]')?.dataset.scenarioId;
    if (language) selectLanguage(language).catch(showError);
    if (scenarioId) startPractice(scenarioId);
  });
  els.voiceAnswer.addEventListener('click', toggleListening);
  els.replayCoachVoice.addEventListener('click', replayCoach);
  els.sendAnswer.addEventListener('click', sendTextAnswer);
  els.answerInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendTextAnswer();
    }
  });
  els.quickAnswer.addEventListener('click', () => {
    const list = samples[state.language] || samples.en;
    els.answerInput.value = list[state.currentTurn % list.length];
    els.answerInput.focus();
  });
  els.endEarly.addEventListener('click', endEarly);
  els.leaveLesson.addEventListener('click', returnToScenarios);
  els.changeLanguage.addEventListener('click', () => {
    hide(els.scenarioStep); hide(els.historyStep); show(els.languageStep);
  });
  els.toggleTranscript.addEventListener('click', () => {
    const hidden = els.chat.classList.toggle('transcript-hidden');
    els.toggleTranscript.textContent = hidden ? '显示字幕' : '隐藏字幕';
    els.toggleTranscript.setAttribute('aria-expanded', String(!hidden));
  });
  els.restart.addEventListener('click', () => location.reload());
  els.backToScenarios.addEventListener('click', returnToScenarios);
}

function setupSpeechInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.speechSupported = Boolean(SpeechRecognition);
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    state.isListening = true;
    state.recognitionFinal = '';
    state.recognitionInterim = '';
    els.voiceAnswer.classList.add('recording');
    els.talkLabel.textContent = '正在听你说';
    els.voiceTitle.textContent = '大胆说，不用完美';
    els.voiceHint.textContent = '说完自然停顿即可，也可以再按一下结束。';
    setPracticeStatus('正在听...');
    setConversationState('正在听你说', 'listening');
  };
  recognition.onresult = (event) => {
    let finalText = state.recognitionFinal;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    state.recognitionFinal = finalText.trim();
    state.recognitionInterim = interim.trim();
    const preview = state.recognitionFinal || state.recognitionInterim;
    if (preview) setPracticeStatus(`“${preview}”`);
  };
  recognition.onerror = (event) => {
    state.recognitionFinal = '';
    state.recognitionInterim = '';
    if (event.error === 'not-allowed') {
      state.speechSupported = false;
      els.textFallback.open = true;
      setPracticeStatus('需要麦克风权限。你也可以先用文字回答。');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      setPracticeStatus('刚才没听清，再说一次就好。');
    }
  };
  recognition.onend = () => {
    state.isListening = false;
    els.voiceAnswer.classList.remove('recording');
    const text = (state.recognitionFinal || state.recognitionInterim).trim();
    state.recognitionFinal = '';
    state.recognitionInterim = '';
    if (text) submitAnswer(text);
    else {
      state.pendingUserTurn = true;
      setUserTurnReady(true);
      setPracticeStatus('没关系，再说一次。');
    }
  };
  state.recognition = recognition;
}

function unlockSpeech() {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance('');
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

async function selectLanguage(language) {
  unlockSpeech();
  state.language = language;
  localStorage.setItem('echoia_preview_language', language);
  if (state.recognition) state.recognition.lang = language === 'ja' ? 'ja-JP' : 'en-US';
  els.coachName.textContent = language === 'ja' ? 'Aoi' : 'Mia';
  await ensureLogin();
  await api('/user/language', { method: 'POST', body: JSON.stringify({ language }) });
  hide(els.languageStep);
  show(els.scenarioStep);
  show(els.historyStep);
  await loadScenarios();
}

async function loadScenarios() {
  els.scenarioGrid.innerHTML = '<p class="status-text">正在准备适合你的场景...</p>';
  const data = await api('/scenarios');
  state.scenarios = data.scenarios || [];
  els.scenarioHint.textContent = state.language === 'ja'
    ? '选择一个场景，Aoi 会先和你打招呼。'
    : '选择一个场景，Mia 会先和你打招呼。';
  els.scenarioGrid.innerHTML = state.scenarios.map((scenario) => `
    <button class="scenario-card" data-scenario-id="${escapeHtml(scenario.id)}">
      <span class="eyebrow">${escapeHtml(categoryName(scenario.category))}</span>
      <strong>${escapeHtml(scenario.titleCn || scenario.title)}</strong>
      <span>${escapeHtml(scenario.descriptionCn || scenario.description)}</span>
      <div class="badges"><span class="badge">约 ${Math.max(3, scenario.maxTurns || 6)} 分钟</span><span class="badge">难度 ${escapeHtml(scenario.difficulty)}</span></div>
    </button>
  `).join('');
}

function categoryName(category) {
  return ({ shopping: '生活', travel: '旅行', business: '职场', meeting: '会议', project: '项目', news: '新闻', ielts_mock: '雅思', jsst_mock: 'JSST', daily: '日常', food: '餐饮' })[category] || '对话';
}

function startPractice(scenarioId, options = {}) {
  const scenario = state.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) return showError(new Error('这个场景暂时进不去，请换一个试试。'));
  closeSocket();
  state.selectedScenario = scenario;
  state.sessionId = '';
  state.currentTurn = 0;
  state.totalTurns = scenario.maxTurns || 6;
  state.activeAiBubble = null;
  state.currentAiText = '';
  state.pendingUserTurn = false;
  state.lastCoachText = '';
  state.lastCoachAudio = null;
  state.audioChunks = [];
  state.renderedUserTurns = new Set();
  if (!options.reconnect) state.reconnectAttempts = 0;

  els.chat.innerHTML = '';
  els.answerInput.value = '';
  els.practiceTitle.textContent = scenario.titleCn || scenario.title;
  els.practiceDesc.textContent = scenario.descriptionCn || scenario.description;
  els.replayCoachVoice.disabled = true;
  updateProgress();
  setCoachMood('warm', state.language === 'ja' ? 'ゆっくり話しましょう' : 'Let’s take it easy');
  hide(els.scenarioStep); hide(els.reviewStep); hide(els.historyStep); show(els.practiceStep);
  setUserTurnReady(false);
  els.voiceTitle.textContent = '先听老师说';
  els.voiceHint.textContent = '老师会先进入角色，听完直接回应就好。';
  setPracticeStatus(options.reconnect ? '正在回到刚才的对话...' : '老师马上就来...');
  setConversationState('正在进入场景');

  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', sessionId: '', scenarioId: scenario.id, language: state.language }));
    state.heartbeatTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
    }, 15000);
  });
  ws.addEventListener('message', (event) => {
    try { handleWsMessage(JSON.parse(event.data)); }
    catch { showError(new Error('对话刚刚走神了，请重新进入场景。')); }
  });
  ws.addEventListener('close', () => {
    if (state.ws !== ws) return;
    state.ws = null;
    window.clearInterval(state.heartbeatTimer);
    clearOpeningWatchdog();
    if (state.selectedScenario && state.reconnectAttempts < 1) {
      state.reconnectAttempts += 1;
      window.setTimeout(() => startPractice(state.selectedScenario.id, { reconnect: true }), 700);
    } else {
      setPracticeStatus('连接中断了，返回场景后可以重新开始。');
      setConversationState('连接已中断');
      setUserTurnReady(false);
    }
  });
  ws.addEventListener('error', () => showError(new Error('暂时连不上老师，请稍后再试。')));
}

function handleWsMessage(frame) {
  if (frame.type === 'ready') {
    state.sessionId = frame.sessionId;
    state.totalTurns = frame.totalTurns;
    updateProgress();
    startOpeningWatchdog();
    setConversationState('老师正在开场', 'speaking');
    return;
  }
  if (frame.type === 'llm_delta') {
    clearOpeningWatchdog();
    renderAiText(frame.accumulated || frame.text || '');
    return;
  }
  if (frame.type === 'asr_partial') {
    setPracticeStatus('正在听懂你的话...');
    return;
  }
  if (frame.type === 'asr_final') {
    if (frame.text) renderUserTurn(frame.turnIndex, frame.text);
    return;
  }
  if (frame.type === 'tts_chunk') {
    handleTtsChunk(frame);
    return;
  }
  if (frame.type === 'turn_end') {
    clearOpeningWatchdog();
    state.currentTurn = frame.turnIndex;
    updateProgress();
    if (frame.sessionComplete) {
      state.pendingUserTurn = false;
      setUserTurnReady(false);
      setConversationState('本次对话完成');
      setPracticeStatus('聊得不错，正在整理你的反馈...');
      closeSocket({ keepSession: true });
      window.setTimeout(fetchReview, 500);
    } else {
      state.pendingUserTurn = true;
      if (!state.coachSpeaking) setUserTurnReady(true);
    }
    loadHistory().catch(() => {});
    return;
  }
  if (frame.type === 'error') {
    addMessage('system', friendlyError(frame.code));
    state.pendingUserTurn = true;
    setUserTurnReady(true);
  }
}

function renderAiText(text) {
  const visible = text.replace(/\s*\[SESSION_COMPLETE\]\s*$/i, '');
  state.currentAiText = visible;
  if (!state.activeAiBubble) state.activeAiBubble = addMessage('ai', '');
  state.activeAiBubble.textContent = visible;
  scrollChat();
}

function handleTtsChunk(frame) {
  if (frame.data) state.audioChunks.push(frame.data);
  if (!frame.isLast) return;
  const text = state.currentAiText.trim();
  const chunks = [...state.audioChunks];
  state.audioChunks = [];
  state.lastCoachText = text;
  state.activeAiBubble = null;
  state.currentAiText = '';
  updateCoachEmotion(text);

  if (chunks.length > 0) {
    state.lastCoachAudio = { chunks, mimeType: frame.mimeType || 'audio/mpeg', sampleRate: frame.sampleRate || 24000 };
    playBackendAudio(state.lastCoachAudio).then(onCoachSpeechEnd).catch(() => speakWithBrowser(text).then(onCoachSpeechEnd));
  } else {
    state.lastCoachAudio = null;
    speakWithBrowser(text).then(onCoachSpeechEnd);
  }
}

function onCoachSpeechStart() {
  state.coachSpeaking = true;
  els.coachPortrait.classList.add('speaking');
  els.replayCoachVoice.disabled = true;
  setUserTurnReady(false);
  setConversationState('老师正在说', 'speaking');
  setPracticeStatus('听完后，直接回应她。');
}

function onCoachSpeechEnd() {
  state.coachSpeaking = false;
  els.coachPortrait.classList.remove('speaking');
  els.replayCoachVoice.disabled = !state.lastCoachText;
  if (!state.pendingUserTurn) return;

  setUserTurnReady(true);
  if (state.handsFree && state.speechSupported) {
    window.setTimeout(() => {
      if (state.pendingUserTurn && !state.coachSpeaking && !state.isListening) {
        startListening().catch(() => {
          state.handsFree = false;
          setUserTurnReady(true);
        });
      }
    }, 420);
  }
}

function updateCoachEmotion(text) {
  const lower = text.toLowerCase();
  if (/great|excellent|perfect|wonderful|いいですね|すばらしい|ありがとう/.test(lower)) {
    setCoachMood('delighted', state.language === 'ja' ? 'いいですね！' : 'That was lovely');
  } else if (/\?|why|what|how|どんな|なぜ|ですか/.test(lower)) {
    setCoachMood('curious', state.language === 'ja' ? 'もっと聞かせて' : 'I’m curious');
  } else {
    setCoachMood('encouraging', state.language === 'ja' ? 'その調子です' : 'You’re doing well');
  }
}

function chooseBrowserVoice(language) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const prefix = language === 'ja' ? 'ja' : 'en';
  const preferred = language === 'ja'
    ? ['Kyoko', 'O-Ren', 'Nanami', 'Google 日本語']
    : ['Samantha', 'Ava', 'Serena', 'Google US English', 'Microsoft Aria'];
  return preferred.map((name) => voices.find((voice) => voice.name.includes(name)))
    .find(Boolean) || voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
}

function speechStyle(text) {
  const positive = /great|excellent|perfect|wonderful|nice|good|いいですね|すばらしい|ありがとう/i.test(text);
  const question = /\?|ですか|ますか/.test(text);
  return { rate: state.language === 'ja' ? .92 : positive ? .98 : .93, pitch: positive ? 1.12 : question ? 1.07 : 1.02 };
}

function speakWithBrowser(text) {
  if (!text || !window.speechSynthesis) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = state.language === 'ja' ? 'ja-JP' : 'en-US';
    utterance.voice = chooseBrowserVoice(state.language) || null;
    const style = speechStyle(text);
    utterance.rate = style.rate;
    utterance.pitch = style.pitch;
    utterance.volume = 1;
    utterance.onstart = onCoachSpeechStart;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

async function replayCoach() {
  if (!state.lastCoachText || state.coachSpeaking) return;
  if (state.lastCoachAudio) await playBackendAudio(state.lastCoachAudio).catch(() => speakWithBrowser(state.lastCoachText));
  else await speakWithBrowser(state.lastCoachText);
  onCoachSpeechEnd();
}

async function playBackendAudio(audioData) {
  const bytes = base64ChunksToBytes(audioData.chunks);
  if (!bytes.byteLength) throw new Error('No audio');
  const body = audioData.mimeType === 'audio/pcm' ? pcm16ToWav(bytes, audioData.sampleRate) : bytes;
  const blob = new Blob([body], { type: audioData.mimeType === 'audio/pcm' ? 'audio/wav' : audioData.mimeType });
  const url = URL.createObjectURL(blob);
  onCoachSpeechStart();
  try {
    const audio = new Audio(url);
    await audio.play();
    await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; });
  } finally { URL.revokeObjectURL(url); }
}

async function toggleListening() {
  if (els.voiceAnswer.disabled && !state.isListening) return;
  if (state.isListening) {
    if (state.voiceMode === 'backend') stopBackendRecording(true);
    else state.recognition?.stop();
    return;
  }

  state.handsFree = true;
  await startListening();
}

async function startListening() {
  if (state.voiceMode === 'backend') {
    await startBackendRecording();
    return;
  }
  if (!state.recognition) {
    state.handsFree = false;
    els.textFallback.open = true;
    return;
  }
  try {
    state.recognition.start();
  } catch {
    setPracticeStatus('稍等一下，再按一次就好。');
  }
}

async function startBackendRecording() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    state.audioContext = new AudioContextClass();
    await state.audioContext.resume();
    state.audioSource = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.audioProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);
    state.recordingSeq = 0;
    state.recordingStartedAt = Date.now();
    state.speechStartedAt = 0;
    state.lastVoiceAt = Date.now();
    state.isListening = true;
    els.voiceAnswer.classList.add('recording');
    els.talkLabel.textContent = '正在听你说';
    setConversationState('正在听你说', 'listening');

    state.audioProcessor.onaudioprocess = (event) => {
      if (!state.isListening || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const rms = Math.sqrt(input.reduce((sum, value) => sum + value * value, 0) / Math.max(input.length, 1));
      const now = Date.now();
      if (rms > .018) { state.speechStartedAt ||= now; state.lastVoiceAt = now; }
      const pcm = encodePcm16(resampleTo16k(input, state.audioContext.sampleRate));
      if (pcm.byteLength) state.ws.send(JSON.stringify({ type: 'audio_chunk', data: arrayBufferToBase64(pcm), seq: state.recordingSeq++ }));
      if ((state.speechStartedAt && now - state.lastVoiceAt > 1200) || now - state.recordingStartedAt > 15000) stopBackendRecording(true);
    };
    state.audioSource.connect(state.audioProcessor);
    state.audioProcessor.connect(state.audioContext.destination);
  } catch {
    state.speechSupported = false;
    els.textFallback.open = true;
    setPracticeStatus('需要麦克风权限。你也可以先用文字回答。');
    await cleanupRecording();
  }
}

function stopBackendRecording(submit) {
  if (!state.isListening) return;
  state.isListening = false;
  els.voiceAnswer.classList.remove('recording');
  const ws = state.ws;
  cleanupRecording().finally(() => {
    if (submit && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'audio_end', turnIndex: state.currentTurn + 1 }));
  });
  setUserTurnReady(false);
  setConversationState('正在理解你的回答');
  setPracticeStatus('老师听到了，正在回应...');
}

async function cleanupRecording() {
  window.clearTimeout(state.silenceTimer);
  if (state.audioProcessor) { state.audioProcessor.disconnect(); state.audioProcessor.onaudioprocess = null; state.audioProcessor = null; }
  if (state.audioSource) { state.audioSource.disconnect(); state.audioSource = null; }
  if (state.mediaStream) { state.mediaStream.getTracks().forEach((track) => track.stop()); state.mediaStream = null; }
  if (state.audioContext) { const context = state.audioContext; state.audioContext = null; if (context.state !== 'closed') await context.close(); }
}

function sendTextAnswer() {
  const answer = els.answerInput.value.trim();
  if (!answer) return;
  els.answerInput.value = '';
  submitAnswer(answer);
}

function submitAnswer(answer) {
  if (!answer || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const turnIndex = state.currentTurn + 1;
  state.renderedUserTurns.add(turnIndex);
  addMessage('user', answer);
  setUserTurnReady(false);
  setConversationState('老师正在思考');
  setPracticeStatus('她听到了，正在回应...');
  const encoded = btoa(unescape(encodeURIComponent(`TEXT:${answer}\n`)));
  state.ws.send(JSON.stringify({ type: 'audio_chunk', data: encoded, seq: Date.now() }));
  state.ws.send(JSON.stringify({ type: 'audio_end', turnIndex: state.currentTurn + 1 }));
}

function addMessage(role, text) {
  const labels = { ai: state.language === 'ja' ? 'A' : 'M', user: '你', system: '' };
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.innerHTML = `<div class="avatar">${labels[role]}</div><div class="bubble"></div>`;
  const bubble = message.querySelector('.bubble');
  bubble.textContent = text;
  els.chat.appendChild(message);
  scrollChat();
  return bubble;
}

function renderUserTurn(turnIndex, text) {
  if (!text || state.renderedUserTurns.has(turnIndex)) return;
  state.renderedUserTurns.add(turnIndex);
  addMessage('user', text);
}

function scrollChat() { els.chat.scrollTop = els.chat.scrollHeight; }

function startOpeningWatchdog() {
  clearOpeningWatchdog();
  state.openingWatchdog = window.setTimeout(() => {
    addMessage('system', '老师刚刚没接上，再进入一次场景就好。');
    setPracticeStatus('开场有点慢，请返回后重试。');
  }, OPENING_TIMEOUT_MS);
}
function clearOpeningWatchdog() { if (state.openingWatchdog) window.clearTimeout(state.openingWatchdog); state.openingWatchdog = 0; }

function friendlyError(code) {
  if (code === 'ASR_UNAVAILABLE') return '刚才没听清，再说一次就好。';
  return '对话停了一下，你可以再说一次。';
}
function showError(error) { setConnection('err', '刚刚出了点小状况', error.message || '请稍后再试'); }

function endEarly() {
  if (state.isListening) {
    if (state.voiceMode === 'backend') stopBackendRecording(false);
    else state.recognition?.abort();
  }
  setUserTurnReady(false);
  setPracticeStatus('正在整理这次练习...');
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'abort', reason: 'user_exit', requestReview: state.currentTurn > 0 }));
  } else if (state.sessionId) fetchReview();
}

async function fetchReview() {
  if (!state.sessionId) return;
  hide(els.practiceStep); show(els.reviewStep);
  els.reviewSubtitle.textContent = '老师正在整理反馈...';
  els.reviewContent.innerHTML = '<p class="status-text">稍等片刻，你刚才说的每一句都在这里。</p>';
  try {
    await api(`/reviews/${state.sessionId}/request`, { method: 'POST', body: '{}' });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const data = await api(`/reviews/${state.sessionId}`);
      if (data.review.status === 'completed') { renderReview(data.review); await loadHistory(); return; }
      if (data.review.status === 'failed') throw new Error('这次反馈没有生成成功。');
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
    throw new Error('反馈还在路上，稍后可以从最近练习里再打开。');
  } catch (error) {
    els.reviewSubtitle.textContent = '反馈暂时没有生成';
    els.reviewContent.innerHTML = `<p class="status-text">${escapeHtml(error.message || '稍后再试一次。')}</p>`;
  }
}

function renderReview(review) {
  const labels = { pronunciation: '发音', grammar: '语法', vocabulary: '词汇', fluency: '流利度', interaction: '互动' };
  const dimensions = review.dimensions || {};
  const values = Object.values(dimensions).map(Number);
  const average = Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1));
  els.reviewSubtitle.textContent = '这是你本次最值得带走的反馈。';
  els.reviewContent.innerHTML = `
    <div class="score-card"><div>本次表现</div><div class="score">${average}</div><p>${escapeHtml(review.overallComment || '你完成了一次真实对话。')}</p></div>
    <div class="dimension-grid">${Object.entries(labels).map(([key, label]) => `<div class="dimension"><strong>${label} ${Number(dimensions[key] || 0)}</strong><div class="bar"><span style="width:${Math.min(100, Math.max(0, Number(dimensions[key] || 0)))}%"></span></div></div>`).join('')}</div>
    ${renderList('你做得好的地方', review.highlights)}${renderList('下一次这样练', review.suggestions)}${renderCorrections(review.corrections)}
  `;
}
function renderList(title, items) { return `<div class="list-card"><h3>${title}</h3><ul>${(Array.isArray(items) ? items : []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`; }
function renderCorrections(items) {
  const corrections = Array.isArray(items) ? items : [];
  if (!corrections.length) return '';
  return `<div class="list-card"><h3>更自然的说法</h3>${corrections.map((item) => `<div class="correction"><strong>你说：${escapeHtml(item.userSaid || '')}</strong><p>可以说：${escapeHtml(item.nativeSay || '')}</p><p>${escapeHtml(item.correctionReason || '')}</p></div>`).join('')}</div>`;
}

async function loadHistory() {
  if (!state.token) return;
  try {
    const data = await api('/sessions');
    const sessions = data.sessions || [];
    if (!sessions.length) { els.historyList.innerHTML = '<p class="status-text">你的第一次练习会出现在这里。</p>'; return; }
    els.historyList.innerHTML = sessions.slice(0, 6).map((session) => `<div class="history-item"><div><strong>${escapeHtml(session.scenarioTitle)}</strong><p>${escapeHtml(session.turnsCompleted)} 轮 · ${statusName(session)}</p></div><button data-review-session="${escapeHtml(session.id)}" ${session.turnsCompleted > 0 ? '' : 'disabled'}>看反馈</button></div>`).join('');
    els.historyList.querySelectorAll('[data-review-session]').forEach((button) => button.addEventListener('click', () => { state.sessionId = button.dataset.reviewSession; fetchReview(); }));
  } catch { els.historyList.innerHTML = ''; }
}
function statusName(session) { if (session.reviewStatus === 'completed') return '已有反馈'; if (session.status === 'completed') return '已完成'; return '已结束'; }

function returnToScenarios() {
  closeSocket();
  hide(els.practiceStep); hide(els.reviewStep); hide(els.languageStep);
  show(els.scenarioStep); show(els.historyStep);
}

function closeSocket(options = {}) {
  window.clearInterval(state.heartbeatTimer);
  clearOpeningWatchdog();
  window.speechSynthesis?.cancel();
  if (state.isListening) {
    state.isListening = false;
    state.recognition?.abort();
  }
  cleanupRecording().catch(() => {});
  const ws = state.ws;
  state.ws = null;
  if (ws) ws.close(1000, 'lesson closed');
  state.coachSpeaking = false;
  state.pendingUserTurn = false;
  state.handsFree = false;
  if (!options.keepSession) state.sessionId = '';
}

function resampleTo16k(input, sourceRate) {
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const index = i * ratio; const left = Math.floor(index); const right = Math.min(left + 1, input.length - 1);
    output[i] = input[left] + (input[right] - input[left]) * (index - left);
  }
  return output;
}
function encodePcm16(input) { const buffer = new ArrayBuffer(input.length * 2); const view = new DataView(buffer); input.forEach((value, i) => { const sample = Math.max(-1, Math.min(1, value)); view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); }); return buffer; }
function arrayBufferToBase64(buffer) { const bytes = new Uint8Array(buffer); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }
function base64ChunksToBytes(chunks) { const arrays = chunks.map((chunk) => Uint8Array.from(atob(chunk), (char) => char.charCodeAt(0))); const total = arrays.reduce((sum, item) => sum + item.length, 0); const merged = new Uint8Array(total); let offset = 0; arrays.forEach((item) => { merged.set(item, offset); offset += item.length; }); return merged; }
function pcm16ToWav(bytes, sampleRate) { const output = new Uint8Array(44 + bytes.length); const view = new DataView(output.buffer); [['RIFF',0],['WAVE',8],['fmt ',12],['data',36]].forEach(([text, offset]) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))); view.setUint32(4, 36 + bytes.length, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, bytes.length, true); output.set(bytes, 44); return output; }

boot();
