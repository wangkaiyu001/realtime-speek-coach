import '../env.js';
import type { RawData, WebSocket } from 'ws';
import { verifyJwt } from '../api/auth.js';
import { buildConfigFromEnv } from '../../../contracts/src/config.js';
import type {
  WsClientFrame,
  WsServerFrame,
  SessionState,
  Language,
  ProficiencyLevel,
} from '../../../contracts/src/ws.js';
import { SEED_SCENARIOS } from '../../../contracts/src/scenarios.js';
import { prisma } from '../db/client.js';
import {
  buildConversationPrompt,
  getConversationPolicy,
  parseAiTurnControl,
} from '../llm/prompts.js';
import { createLlmRouter } from '../llm/router.js';
import { createReviewWorker } from '../../../review/src/index.js';
import { createAsrClient, createTtsClient } from '../../../voice/src/index.js';
import type { TtsSynthesisOptions } from '../../../voice/src/index.js';
import { asrLanguageMismatchMessage, isAcceptableAsrTextForLanguage } from './asr-language.js';

const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);
const llmRouter = createLlmRouter(config);
const reviewWorker = createReviewWorker(config, prisma);
const asrClientFactory = createAsrClient(config);
const ttsClient = createTtsClient(config);
const OPENING_TTS_TIMEOUT_MS = 8000;
const AI_TTS_TIMEOUT_MS = 10000;
const FALLBACK_SCENARIO_ID: Record<Language, string> = {
  en: 'en-shopping-01',
  ja: 'ja-shopping-01',
};

interface MockReviewData {
  pronunciation: number;
  grammar: number;
  vocabulary: number;
  fluency: number;
  interaction: number;
  overallComment: string;
  highlights: string[];
  suggestions: string[];
  corrections: Array<{
    turnIndex: number;
    userSaid: string;
    nativeSay: string;
    correctionReason: string;
    category: string;
  }>;
}

interface ServerAsrClient {
  sendAudio(chunk: Buffer): void;
  endAudio(): void;
  stop(): void;
}

interface ActiveSession {
  sessionId: string;
  userId: string;
  scenarioId: string;
  language: Language;
  level: ProficiencyLevel;
  currentTurn: number;
  totalTurns: number;
  turnState: SessionState['turnState'];
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  audioChunks: string[];
  asrClient?: ServerAsrClient;
  asrFinalText?: string;
  asrFinalPromise?: Promise<string>;
  asrFinalResolve?: (text: string) => void;
  asrError?: Error;
  asrErrorNotified?: boolean;
  asrFinalSettled?: boolean;
}

interface MockTurn {
  user: string;
  assistant: string;
}

interface WsRequestLike {
  url?: string;
}

const DEFAULT_MOCK_TURNS: Record<Language, MockTurn[]> = {
  en: [
    { user: 'I would like a cup of coffee please.', assistant: 'Great choice! Would you like that hot or iced?' },
    { user: "Yes, I'll have it with milk, no sugar.", assistant: 'Sure thing! Milk, no sugar - coming right up.' },
    { user: 'Do you have any pastries available?', assistant: 'We have fresh croissants, muffins, and cinnamon rolls today.' },
    { user: 'How much does that cost?', assistant: "That'll be four dollars and fifty cents." },
    { user: "I'll pay with my card, please.", assistant: "Of course! Just tap your card here whenever you're ready." },
    { user: 'Could you recommend something for lunch?', assistant: 'Our chicken avocado sandwich is really popular today!' },
    { user: "That sounds great, I'll try it.", assistant: "Excellent! I'll have that ready for you in just a moment." },
    { user: 'Is there WiFi available here?', assistant: "Yes! The password is on the receipt. It's CoffeeLovers2026." },
    { user: 'Thank you very much for your help.', assistant: "You're very welcome! Enjoy your meal." },
    { user: 'Have a wonderful day!', assistant: 'Thank you! You too, have a great day!' },
  ],
  ja: [
    { user: 'Koohii o hitotsu kudasai.', assistant: 'Kashikomarimashita. Hotto to aisu, dochira ni nasaimasu ka?' },
    { user: 'Hotto de onegai shimasu.', assistant: 'Hotto desu ne. Miruku ya satou wa otsuke shimasu ka?' },
    { user: 'Miruku dake onegai shimasu.', assistant: 'Kashikomarimashita. Miruku dake desu ne.' },
    { user: 'Pan wa arimasu ka?', assistant: 'Hai, meron pan to sandoicchi ga gozaimasu.' },
    { user: 'Meron pan mo kudasai.', assistant: 'Arigatou gozaimasu. Gokei de yonhyaku hachiju en desu.' },
    { user: 'Kaado de haraemasu ka?', assistant: 'Hai, kaado de odaijoubu desu. Kochira ni onegai shimasu.' },
    { user: 'Fukuro wa irimasen.', assistant: 'Kashikomarimashita. Shiin wo harimasu ne.' },
    { user: 'Reshiito o kudasai.', assistant: 'Hai, kochira ga reshiito desu.' },
    { user: 'Arigatou gozaimasu.', assistant: 'Arigatou gozaimashita.' },
    { user: 'Mata kimasu.', assistant: 'Mata okoshi kudasai mase.' },
  ],
};

const SCENARIO_MOCK_TURNS: Record<string, MockTurn[]> = {
  'en-business-01': [
    { user: 'The MVP is planned for next Monday.', assistant: 'That sounds promising. What are the biggest risks that could still affect next Monday\'s launch?' },
    { user: 'We still have several bugs to fix.', assistant: 'Understood. Which bugs are release blockers, and who is owning each one?' },
    { user: 'The frontend and backend teams are working together.', assistant: 'Good. Do you need any extra support from QA or product before the deadline?' },
    { user: 'QA support would help us a lot.', assistant: 'Makes sense. What test coverage do you want QA to prioritize first?' },
    { user: 'The payment flow and login flow are the most important.', assistant: 'Agreed. How confident are you about those two flows right now, from one to ten?' },
    { user: 'Maybe seven out of ten.', assistant: 'Thanks for being clear. What would move that confidence from seven to nine?' },
    { user: 'We need one more round of regression testing.', assistant: 'Good plan. When can you share the regression results with me?' },
    { user: 'Tomorrow afternoon.', assistant: 'Great. If anything slips tomorrow, what is your backup plan for the launch?' },
    { user: 'We can reduce scope and postpone low-priority features.', assistant: 'That is a practical fallback. Which features are safe to cut if needed?' },
    { user: 'We can postpone analytics and some settings.', assistant: 'Thanks, that gives me a clear picture. Please send me a short written update after this meeting.' },
  ],
  'en-travel-01': [
    { user: 'Yes, I have a reservation under Chen.', assistant: 'Thank you. Could I see your passport or ID for check-in?' },
    { user: 'Sure, here it is.', assistant: 'Great. You booked a king room for two nights. Would you like a room on a higher floor?' },
    { user: 'Yes, a higher floor would be nice.', assistant: 'No problem. Breakfast is from 7 to 10 AM. Do you need help with your luggage?' },
    { user: 'No, thank you.', assistant: 'All right. The WiFi password is printed on your key card holder.' },
  ],
  'en-ielts-01': [
    { user: 'I want to describe Kyoto because I visited it last year.', assistant: 'Thank you. Please continue and tell me what you did there.' },
    { user: 'I visited temples and tried local food.', assistant: 'Interesting. Why did that place leave such a strong impression on you?' },
    { user: 'It was peaceful and very different from my city.', assistant: 'Good. Now, do you think historic places are important for young people? Why?' },
  ],
  'en-daily-01': [
    { user: 'I am thinking about watching a movie.', assistant: 'Nice! What kind of movie are you in the mood for?' },
    { user: 'Maybe something funny.', assistant: 'A comedy sounds perfect. Do you want to go out or watch it at home?' },
    { user: 'At home sounds better.', assistant: 'I agree. Should we order some food too?' },
  ],
  'ja-business-01': [
    { user: '田中と申します。よろしくお願いいたします。', assistant: 'ありがとうございます。では、これまでのご経験について簡単に教えていただけますか。' },
    { user: '三年間、Webアプリの開発をしていました。', assistant: 'そうですか。その中で一番力を入れたプロジェクトは何ですか。' },
    { user: '予約システムの開発です。', assistant: 'そのプロジェクトで、どのような役割を担当しましたか。' },
  ],
  'ja-travel-01': [
    { user: '駅へ行きたいです。', assistant: '駅ですね。この道をまっすぐ行って、二つ目の信号を右に曲がってください。' },
    { user: '歩いて何分ぐらいですか。', assistant: '歩いて十分ぐらいです。バスでも行けますよ。' },
    { user: 'ありがとうございます。', assistant: 'どういたしまして。お気をつけて。' },
  ],
  'ja-jsst-01': [
    { user: '私の趣味は映画を見ることです。', assistant: 'いいですね。どんな映画をよく見ますか。' },
    { user: 'アクション映画をよく見ます。', assistant: '最近見た映画について、少し詳しく話してください。' },
    { user: '先週、新しい映画を見ました。', assistant: 'その映画のどんなところが面白かったですか。' },
  ],
  'ja-daily-01': [
    { user: 'そうですね。とても気持ちがいいです。', assistant: '本当にそうですね。今日はどこかへ出かけますか。' },
    { user: '公園へ行くつもりです。', assistant: 'いいですね。散歩にはぴったりの日ですね。' },
    { user: 'はい、楽しみです。', assistant: 'ゆっくり楽しんできてくださいね。' },
  ],
};

const activeSessions = new Map<WebSocket, ActiveSession>();

export const websocketHandler = (connection: WebSocket, request: WsRequestLike) => {
  // Extract token from query params
  const url = new URL(request.url || '/ws', 'http://localhost');
  const token = url.searchParams.get('token');

  if (!token) {
    connection.close(1008, 'Token missing');
    return;
  }

  const payload = verifyJwt(token);
  if (!payload || typeof payload !== 'object' || !('userId' in payload)) {
    connection.close(1008, 'Invalid token');
    return;
  }

  const userId = (payload as { userId: string }).userId;
  console.log(`[WS] New connection from user: ${userId}`);

  connection.on('message', async (raw: RawData) => {
    try {
      const frame: WsClientFrame = JSON.parse(raw.toString());
      await handleFrame(connection, userId, frame);
    } catch (err) {
      console.error('[WS] Error processing frame:', err);
      sendFrame(connection, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: (err as Error).message,
        retryable: true,
      });
    }
  });

  connection.on('close', () => {
    const session = activeSessions.get(connection);
    if (session) {
      console.log(`[WS] Connection closed, session: ${session.sessionId}`);
      session.asrClient?.stop();
      activeSessions.delete(connection);
      void markInterruptedSession(session);
    }
  });

  connection.on('error', (err: Error) => {
    console.error('[WS] Connection error:', err);
  });
};

async function handleFrame(ws: WebSocket, userId: string, frame: WsClientFrame) {
  switch (frame.type) {
    case 'hello':
      await handleHello(ws, userId, frame);
      break;
    case 'audio_chunk':
      handleAudioChunk(ws, frame);
      break;
    case 'audio_end':
      await handleAudioEnd(ws, frame);
      break;
    case 'heartbeat':
      sendFrame(ws, { type: 'heartbeat_ack', ts: Date.now() });
      break;
    case 'abort':
      await handleAbort(ws, frame);
      break;
  }
}

async function handleHello(ws: WebSocket, userId: string, frame: WsClientFrame & { type: 'hello' }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const language = (user?.language || 'en') as Language;
  const level = (user?.level || 4) as ProficiencyLevel;
  const requestedScenario = SEED_SCENARIOS.find((s) => s.id === frame.scenarioId && s.language === language);
  const scenarioId = requestedScenario?.id || FALLBACK_SCENARIO_ID[language];
  const scenario = requestedScenario || SEED_SCENARIOS.find((s) => s.id === scenarioId);
  const policy = scenario ? getConversationPolicy(scenario) : { minTurns: 2, maxTurns: 6, naturalEndGoal: 'The role-play reaches a natural ending.' };

  // Create a new session in DB
  const dbSession = await prisma.session.create({
    data: {
      userId,
      scenarioId,
      language,
      level,
      totalTurns: policy.maxTurns,
    },
  });

  const session: ActiveSession = {
    sessionId: dbSession.id,
    userId,
    scenarioId,
    language,
    level,
    currentTurn: 0,
    totalTurns: policy.maxTurns,
    turnState: 'idle',
    conversationHistory: [],
    audioChunks: [],
  };

  activeSessions.set(ws, session);

  sendFrame(ws, {
    type: 'ready',
    sessionId: dbSession.id,
    totalTurns: policy.maxTurns,
  });

  // AI opens the conversation (turn 0 is AI's opening)
  try {
    await generateAiTurn(ws, session, true);
  } catch (error) {
    console.error('[WS] Failed to generate opening turn:', error);
    const fallback = getOpeningFallback(session.language);
    sendTextDelta(ws, fallback);
    sendFrame(ws, { type: 'tts_chunk', data: '', seq: 0, isLast: true });
    sendFrame(ws, {
      type: 'turn_end',
      turnIndex: 0,
      totalTurns: session.totalTurns,
      sessionComplete: false,
    });
    session.conversationHistory.push({ role: 'assistant', content: fallback });
    session.turnState = 'idle';
  }
}

function handleAudioChunk(ws: WebSocket, frame: WsClientFrame & { type: 'audio_chunk' }) {
  const session = activeSessions.get(ws);
  if (!session) return;

  session.turnState = 'recording';
  session.audioChunks.push(frame.data);
}

async function handleAudioEnd(ws: WebSocket, frame: WsClientFrame & { type: 'audio_end' }) {
  const session = activeSessions.get(ws);
  if (!session) return;

  if (frame.turnIndex <= session.currentTurn && session.turnState !== 'recording') {
    sendFrame(ws, {
      type: 'error',
      code: 'DUPLICATE_TURN',
      message: 'This turn has already been submitted.',
      retryable: false,
    });
    return;
  }

  session.turnState = 'processing_asr';
  session.currentTurn = frame.turnIndex;
  const hasTextAnswer = Boolean(decodeAudioChunksAsText(session.audioChunks));

  if (!hasTextAnswer && !config.mocks.voice && !isTextHarnessEnabled() && !session.asrError && !session.asrClient) {
    try {
      const asrClient = startAsrForSession(ws, session);
      for (const chunk of session.audioChunks) {
        asrClient.sendAudio(Buffer.from(chunk, 'base64'));
      }
    } catch (error) {
      notifyAsrError(ws, session, error);
      stopAsrRuntime(session);
    }
  }

  if (!hasTextAnswer && !config.mocks.voice && !isTextHarnessEnabled() && session.asrClient) {
    try {
      session.asrClient.endAudio();
    } catch (error) {
      notifyAsrError(ws, session, error);
      stopAsrRuntime(session);
    }
  }

  let userText = '';
  try {
    userText = await resolveUserText(session, frame.turnIndex);
  } catch (error) {
    console.error('[WS] ASR failed:', error);
  }

  userText = userText.trim();

  if (!userText) {
    notifyAsrError(ws, session, session.asrError || new Error('ASR returned empty text'));
    session.turnState = 'idle';
    session.currentTurn = Math.max(frame.turnIndex - 1, 0);
    session.audioChunks = [];
    clearAsrState(session);
    return;
  }

  if (!isAcceptableAsrTextForLanguage(userText, session.language)) {
    console.warn('[WS] ASR language mismatch blocked:', {
      sessionId: session.sessionId,
      language: session.language,
      textLength: userText.length,
    });
    session.turnState = 'idle';
    session.currentTurn = Math.max(frame.turnIndex - 1, 0);
    session.audioChunks = [];
    clearAsrState(session);
    sendFrame(ws, {
      type: 'error',
      code: 'ASR_LANGUAGE_MISMATCH',
      message: asrLanguageMismatchMessage(session.language),
      retryable: true,
    });
    sendFrame(ws, {
      type: 'turn_end',
      turnIndex: session.currentTurn,
      totalTurns: session.totalTurns,
      sessionComplete: false,
    });
    return;
  }

  if (config.mocks.voice || isTextHarnessEnabled()) {
    sendFrame(ws, { type: 'asr_partial', text: '正在整理你的回答...' });
    await new Promise((r) => setTimeout(r, 300));
  }

  sendFrame(ws, { type: 'asr_final', text: userText, turnIndex: frame.turnIndex });

  // Save user turn to DB
  await prisma.turn.upsert({
    where: {
      sessionId_turnIndex: { sessionId: session.sessionId, turnIndex: frame.turnIndex },
    },
    update: {
      userText,
    },
    create: {
      sessionId: session.sessionId,
      turnIndex: frame.turnIndex,
      userText,
    },
  });

  session.conversationHistory.push({ role: 'user', content: userText });
  session.audioChunks = [];
  clearAsrState(session);

  // Generate AI response
  try {
    await generateAiTurn(ws, session, false);
  } catch (error) {
    clearAsrState(session);
    session.turnState = 'idle';
    await recoverAiTurn(ws, session, frame.turnIndex, error);
  }
}

async function recoverAiTurn(ws: WebSocket, session: ActiveSession, turnIndex: number, error: unknown) {
  console.error('[WS] AI turn failed, using fallback:', error);
  const fallback = getContextualAiFallback(session);
  const control = parseAiTurnControl(fallback, true);
  const aiText = control.text || stripCompletionMarkerTail(fallback) || getOpeningFallback(session.language);

  session.conversationHistory.push({ role: 'assistant', content: aiText });
  session.turnState = 'speaking';

  sendTextDelta(ws, aiText);
  await emitTtsChunks(ws, aiText, session.language, session.level, session.level, AI_TTS_TIMEOUT_MS);

  await prisma.turn.update({
    where: {
      sessionId_turnIndex: { sessionId: session.sessionId, turnIndex },
    },
    data: { aiText },
  });

  await prisma.session.update({
    where: { id: session.sessionId },
    data: { turnsCompleted: turnIndex },
  });

  const sessionComplete = control.shouldComplete || turnIndex >= session.totalTurns;
  if (sessionComplete) {
    await ensureReview(session, 'completed');
  }

  sendFrame(ws, {
    type: 'turn_end',
    turnIndex,
    totalTurns: session.totalTurns,
    sessionComplete,
  });

  session.turnState = 'idle';
}

async function generateAiTurn(ws: WebSocket, session: ActiveSession, isOpening: boolean) {
  session.turnState = 'thinking';

  const scenario = SEED_SCENARIOS.find((s) => s.id === session.scenarioId);

  if (isOpening && scenario) {
    // AI opening line
    const openingText = scenario.openingLine;
    session.conversationHistory.push({ role: 'assistant', content: openingText });

    sendTextDelta(ws, openingText);

    await emitTtsChunks(ws, openingText, session.language, session.level, scenario.difficulty, OPENING_TTS_TIMEOUT_MS);

    session.turnState = 'idle';
    sendFrame(ws, {
      type: 'turn_end',
      turnIndex: 0,
      totalTurns: session.totalTurns,
      sessionComplete: false,
    });

    return;
  }

  const turnIdx = session.currentTurn;
  const rawAiText = config.mocks.llm
    ? await streamMockAiTurn(ws, session, turnIdx)
    : await streamRealAiTurn(ws, session);
  const policy = scenario ? getConversationPolicy(scenario) : { minTurns: 2, maxTurns: session.totalTurns, naturalEndGoal: 'The role-play reaches a natural ending.' };
  const canCompleteNaturally = turnIdx >= policy.minTurns;
  const control = parseAiTurnControl(rawAiText, canCompleteNaturally);
  const aiText = control.text || rawAiText;

  session.conversationHistory.push({ role: 'assistant', content: aiText });
  session.turnState = 'speaking';

  await emitTtsChunks(ws, aiText, session.language, session.level, scenario?.difficulty || session.level, AI_TTS_TIMEOUT_MS);

  // Update DB
  await prisma.turn.update({
    where: {
      sessionId_turnIndex: { sessionId: session.sessionId, turnIndex: turnIdx },
    },
    data: { aiText },
  });

  await prisma.session.update({
    where: { id: session.sessionId },
    data: { turnsCompleted: turnIdx },
  });

  // Emit turn_end
  const sessionComplete = control.shouldComplete || turnIdx >= session.totalTurns;

  if (sessionComplete) {
    await ensureReview(session, 'completed');
  }

  sendFrame(ws, {
    type: 'turn_end',
    turnIndex: turnIdx,
    totalTurns: session.totalTurns,
    sessionComplete,
  });

  session.turnState = 'idle';
}

async function streamMockAiTurn(ws: WebSocket, session: ActiveSession, turnIndex: number) {
  const turn = getMockTurn(session.language, turnIndex, session.scenarioId);
  const shouldComplete = shouldCompleteMockTurn(session, turnIndex, turn.user);
  const aiText = shouldComplete ? `${turn.assistant} [SESSION_COMPLETE]` : turn.assistant;
  sendTextDelta(ws, aiText);

  return aiText;
}

function sendTextDelta(ws: WebSocket, text: string) {
  sendFrame(ws, { type: 'llm_delta', text, accumulated: text });
}

async function streamRealAiTurn(ws: WebSocket, session: ActiveSession) {
  const scenario = SEED_SCENARIOS.find((s) => s.id === session.scenarioId);

  if (!scenario) {
    throw new Error(`Scenario not found: ${session.scenarioId}`);
  }

  const messages = buildConversationPrompt(
    scenario,
    session.level,
    session.language,
    session.conversationHistory,
    getConversationPolicy(scenario),
    session.currentTurn,
  );

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let accumulated = '';

    try {
      for await (const delta of llmRouter.streamChat(messages, {
        temperature: attempt === 0 ? 0.7 : 0.45,
        maxTokens: 220,
        timeoutMs: 12000,
      })) {
        accumulated += delta;
        const visibleAccumulated = stripCompletionMarkerTail(accumulated);
        sendFrame(ws, { type: 'llm_delta', text: delta, accumulated: visibleAccumulated });
      }

      const aiText = accumulated.trim();
      if (aiText) return aiText;
      lastError = new Error('LLM returned an empty response');
    } catch (error) {
      lastError = error;
    }
  }

  console.error('[WS] LLM failed twice, using contextual fallback:', lastError);
  const fallback = getContextualAiFallback(session);
  sendTextDelta(ws, stripCompletionMarkerTail(fallback));
  return fallback;
}

function getContextualAiFallback(session: ActiveSession) {
  const latestUserText = [...session.conversationHistory].reverse().find((item) => item.role === 'user')?.content || '';
  const scenario = SEED_SCENARIOS.find((item) => item.id === session.scenarioId);
  const turnIndex = Math.max(session.currentTurn, 1);
  const policy = scenario ? getConversationPolicy(scenario) : { minTurns: 2, maxTurns: session.totalTurns };
  const canClose = turnIndex >= policy.minTurns;

  if (session.language === 'ja') {
    if (/ありがとう|以上です|大丈夫|結構です|いいです/.test(latestUserText)) {
      return 'ありがとうございます。では、今日はここまでにしましょう。お疲れさまでした。 [SESSION_COMPLETE]';
    }
    if (session.scenarioId.includes('shopping')) {
      if (/コーヒー|ラテ|カフェ|ホット|アイス|飲み物|ドリンク/.test(latestUserText)) {
        return canClose
          ? 'かしこまりました。サイズはMでよろしいですか。お支払いはこちらでお願いします。 [SESSION_COMPLETE]'
          : 'かしこまりました。ホットとアイス、どちらになさいますか。';
      }
      return canClose
        ? 'かしこまりました。袋はご利用ですか。お会計はこちらでお願いします。 [SESSION_COMPLETE]'
        : 'かしこまりました。ほかにご入用のものはございますか。';
    }
    return 'なるほど。もう少し詳しく教えていただけますか。';
  }

  if (/\b(thanks?|thank you|that's all|that is all|no thanks?|nothing else|done)\b/i.test(latestUserText)) {
    return 'Thanks, that covers everything. Let us wrap up here. [SESSION_COMPLETE]';
  }

  if (session.scenarioId.includes('shopping')) {
    if (/\b(coffee|latte|cappuccino|americano|tea|drink|hot|iced|ice|milk|sugar|size|small|medium|large)\b/i.test(latestUserText)) {
      return canClose
        ? 'Perfect, I have got that. You can pay here when you are ready. [SESSION_COMPLETE]'
        : 'Great choice. What size would you like, and would you prefer it hot or iced?';
    }
    return canClose
      ? 'Sure, that is everything I need. Please pay here when you are ready. [SESSION_COMPLETE]'
      : 'Sure. Would you like anything else with that today?';
  }

  return 'I see. Could you add one more detail so I can understand your point better?';
}

function stripCompletionMarkerTail(text: string) {
  const marker = '[SESSION_COMPLETE]';
  let output = text.replace(/\s*\[SESSION_COMPLETE\]\s*$/i, '').trimEnd();
  const upperOutput = output.toUpperCase();

  for (let length = marker.length - 1; length >= 1; length -= 1) {
    const partial = marker.slice(0, length).toUpperCase();
    if (upperOutput.endsWith(partial)) {
      output = output.slice(0, -length);
      break;
    }
  }

  return output.trimEnd();
}

function startAsrForSession(ws: WebSocket, session: ActiveSession): ServerAsrClient {
  clearAsrState(session);

  session.asrFinalPromise = new Promise<string>((resolve) => {
    session.asrFinalResolve = (text) => {
      if (session.asrFinalSettled) return;
      session.asrFinalSettled = true;
      resolve(text);
    };
  });

  const client = asrClientFactory({
    onPartial: () => {
      sendFrame(ws, { type: 'asr_partial', text: '正在识别...' });
    },
    onFinal: (text) => {
      if (session.asrFinalSettled) return;
      session.asrFinalText = text;
      session.asrFinalResolve?.(text);
    },
    onError: (error) => {
      session.asrError = error;
      session.asrFinalResolve?.('');
      notifyAsrError(ws, session, error);
      stopAsrRuntime(session);
    },
  }, {
    language: session.language,
    uid: session.userId,
  });

  session.asrClient = client;
  return client;
}

async function resolveUserText(session: ActiveSession, turnIndex: number) {
  const harnessText = decodeAudioChunksAsText(session.audioChunks);
  if (harnessText) {
    return harnessText;
  }

  if (config.mocks.voice) {
    return getMockTurn(session.language, turnIndex, session.scenarioId).user;
  }

  if (isTextHarnessEnabled()) {
    return decodeAudioChunksAsText(session.audioChunks);
  }

  if (session.asrError) return '';
  if (session.asrFinalText) return session.asrFinalText;
  if (!session.asrFinalPromise) return '';

  return Promise.race([
    session.asrFinalPromise,
    new Promise<string>((resolve) => setTimeout(() => resolve(''), 12000)),
  ]);
}

function clearAsrState(session: ActiveSession) {
  stopAsrRuntime(session);
  session.asrFinalText = undefined;
  session.asrFinalPromise = undefined;
  session.asrFinalResolve = undefined;
  session.asrError = undefined;
  session.asrErrorNotified = undefined;
  session.asrFinalSettled = undefined;
}

function stopAsrRuntime(session: ActiveSession) {
  session.asrClient?.stop();
  session.asrClient = undefined;
}

function notifyAsrError(ws: WebSocket, session: ActiveSession, error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  session.asrError = normalized;
  if (session.asrErrorNotified) return;

  session.asrErrorNotified = true;
  console.error('[WS] ASR provider error:', normalized);
  sendFrame(ws, {
    type: 'error',
    code: 'ASR_UNAVAILABLE',
    message: '语音识别暂时不可用，请再录一次；也可以先用文本继续。',
    retryable: true,
  });
}

function getMockTurn(language: Language, turnIndex: number, scenarioId?: string) {
  const turns = (scenarioId && SCENARIO_MOCK_TURNS[scenarioId]) || DEFAULT_MOCK_TURNS[language] || DEFAULT_MOCK_TURNS.en;
  return turns[Math.min(Math.max(turnIndex - 1, 0), turns.length - 1)];
}

function shouldCompleteMockTurn(session: ActiveSession, turnIndex: number, userText: string) {
  const scenario = SEED_SCENARIOS.find((s) => s.id === session.scenarioId);
  const policy = scenario ? getConversationPolicy(scenario) : { minTurns: 2, maxTurns: session.totalTurns };
  if (turnIndex >= session.totalTurns) return true;
  if (turnIndex < policy.minTurns) return false;
  return /\b(thanks?|thank you|that's all|that is all|nothing else|no thanks?|done)\b/i.test(userText)
    || /ありがとう|以上です|大丈夫|いりません|結構です/.test(userText);
}

async function createMockReview(sessionId: string, language: Language) {
  const review = getMockReview(language);

  await prisma.review.upsert({
    where: { sessionId },
    update: {
      status: 'completed',
      pronunciation: review.pronunciation,
      grammar: review.grammar,
      vocabulary: review.vocabulary,
      fluency: review.fluency,
      interaction: review.interaction,
      overallComment: review.overallComment,
      highlights: JSON.stringify(review.highlights),
      suggestions: JSON.stringify(review.suggestions),
      corrections: JSON.stringify(review.corrections),
      rawResponse: JSON.stringify(review),
      completedAt: new Date(),
    },
    create: {
      sessionId,
      status: 'completed',
      pronunciation: review.pronunciation,
      grammar: review.grammar,
      vocabulary: review.vocabulary,
      fluency: review.fluency,
      interaction: review.interaction,
      overallComment: review.overallComment,
      highlights: JSON.stringify(review.highlights),
      suggestions: JSON.stringify(review.suggestions),
      corrections: JSON.stringify(review.corrections),
      rawResponse: JSON.stringify(review),
      completedAt: new Date(),
    },
  });
}

function getMockReview(language: Language): MockReviewData {
  if (language === 'ja') {
    return {
      pronunciation: 80,
      grammar: 76,
      vocabulary: 82,
      fluency: 78,
      interaction: 86,
      overallComment: 'Your Japanese responses were natural and easy to follow. Next, focus on particles and polite form consistency.',
      highlights: [
        'You kept replying in the target language.',
        'Your answers were short and clear.',
        'You reacted naturally to follow-up questions.',
      ],
      suggestions: [
        'Practice common particles such as wa, ga, and o.',
        'Keep polite form consistent during role play.',
        'Add one short reason to make each answer more conversational.',
      ],
      corrections: [
        {
          turnIndex: 1,
          userSaid: 'Koohii kudasai.',
          nativeSay: 'Koohii o kudasai.',
          correctionReason: 'Add the particle o before the object for a more complete sentence.',
          category: 'grammar',
        },
      ],
    };
  }

  return {
    pronunciation: 82,
    grammar: 78,
    vocabulary: 84,
    fluency: 80,
    interaction: 88,
    overallComment: 'You kept the conversation moving naturally and used useful everyday expressions. Next, focus on small grammar details and adding short reasons to your answers.',
    highlights: [
      'You answered clearly in the target language.',
      'You used practical vocabulary for the scenario.',
      'You responded naturally to follow-up questions.',
    ],
    suggestions: [
      'Add one short reason after your answer to sound more natural.',
      'Watch articles such as a, an, and the.',
      'Practice smoother linking between short phrases.',
    ],
    corrections: [
      {
        turnIndex: 1,
        userSaid: 'I would like cup of coffee.',
        nativeSay: 'I would like a cup of coffee.',
        correctionReason: 'Use the article "a" before "cup".',
        category: 'grammar',
      },
    ],
  };
}

async function emitMockTtsChunks(ws: WebSocket, text: string) {
  // In mock voice mode the text stream is the source of truth. Sending fake
  // bytes as an MP3 causes the mini-program player to raise noisy playback
  // errors, so emit a single empty terminal chunk instead.
  sendFrame(ws, {
    type: 'tts_chunk',
    data: '',
    seq: 0,
    isLast: true,
  });

  await new Promise((r) => setTimeout(r, Math.min(100, Math.max(20, text.length))));
}

async function emitTtsChunks(
  ws: WebSocket,
  text: string,
  language: Language,
  level: ProficiencyLevel,
  difficulty: ProficiencyLevel,
  timeoutMs = AI_TTS_TIMEOUT_MS,
) {
  if (config.mocks.voice) {
    await emitMockTtsChunks(ws, text);
    return;
  }

  let seq = 0;
  const options = buildTtsOptions(level, difficulty);
  try {
    await withTimeout(
      ttsClient.synthesize(text, language, (chunk, isLast) => {
        sendFrame(ws, {
          type: 'tts_chunk',
          data: chunk.toString('base64'),
          seq: seq++,
          isLast,
          mimeType: getTtsMimeType(),
          sampleRate: config.volcVoice.ttsSampleRate,
        });
      }, options),
      timeoutMs,
      'TTS timeout',
    );
  } catch (error) {
    console.error('[WS] TTS failed, continuing with text-only response:', error);
    sendFrame(ws, {
      type: 'tts_chunk',
      data: '',
      seq,
      isLast: true,
      mimeType: getTtsMimeType(),
      sampleRate: config.volcVoice.ttsSampleRate,
    });
  }
}

function buildTtsOptions(level: ProficiencyLevel, difficulty: ProficiencyLevel): TtsSynthesisOptions {
  const effectiveLevel = Math.max(level, difficulty);
  if (effectiveLevel <= 3) {
    return { speedRatio: 0.82, style: 'classroom' };
  }
  if (effectiveLevel <= 6) {
    return { speedRatio: 1.0, style: 'natural' };
  }
  return { speedRatio: 1.16, style: 'native_like' };
}

function getTtsMimeType() {
  switch (config.volcVoice.ttsFormat) {
    case 'ogg_opus':
      return 'audio/ogg; codecs=opus';
    case 'wav':
      return 'audio/wav';
    case 'pcm':
      return 'audio/pcm';
    case 'mp3':
    default:
      return 'audio/mpeg';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getOpeningFallback(language: Language) {
  if (language === 'ja') {
    return 'こんにちは。聞こえていますか？準備ができたら、短く答えてください。';
  }
  return 'Hi, can you hear me? When you are ready, please answer with a short sentence.';
}

function isTextHarnessEnabled() {
  return process.env.VOICE_TEXT_HARNESS === '1' || process.env.VOICE_TEXT_HARNESS === 'true';
}

function decodeAudioChunksAsText(chunks: string[]) {
  for (const chunk of chunks) {
    let decoded = '';
    try {
      decoded = Buffer.from(chunk, 'base64').toString('utf8').trim();
    } catch {
      decoded = '';
    }

    if (!decoded.startsWith('TEXT:')) continue;
    const text = decoded.slice('TEXT:'.length).trim();
    if (text) return text;
  }

  return '';
}

async function ensureReview(session: ActiveSession, status: 'completed' | 'abandoned') {
  await prisma.session.update({
    where: { id: session.sessionId },
    data: {
      status,
      turnsCompleted: session.currentTurn,
    },
  });

  if (status !== 'completed') {
    return;
  }

  if (config.mocks.review) {
    await createMockReview(session.sessionId, session.language);
  } else {
    await reviewWorker.enqueueReview(session.sessionId);
  }
}

async function handleAbort(ws: WebSocket, frame: WsClientFrame & { type: 'abort' }) {
  const session = activeSessions.get(ws);
  if (!session) {
    ws.close(1000, 'Session aborted');
    return;
  }

  try {
    if (frame.requestReview && session.currentTurn > 0) {
      await ensureReview(session, 'completed');
      sendFrame(ws, {
        type: 'turn_end',
        turnIndex: session.currentTurn,
        totalTurns: session.totalTurns,
        sessionComplete: true,
        reviewRequested: true,
      });
    } else {
      await prisma.session.update({
        where: { id: session.sessionId },
        data: {
          status: 'abandoned',
          turnsCompleted: session.currentTurn,
        },
      });
    }
  } catch (error) {
    console.error('[WS] Failed to abort session:', error);
  } finally {
    activeSessions.delete(ws);
    ws.close(1000, 'Session aborted');
  }
}

async function markInterruptedSession(session: ActiveSession) {
  if (session.currentTurn <= 0) return;

  try {
    await prisma.session.updateMany({
      where: {
        id: session.sessionId,
        status: 'in_progress',
      },
      data: {
        status: 'abandoned',
        turnsCompleted: session.currentTurn,
      },
    });
  } catch (error) {
    console.error('[WS] Failed to persist interrupted session:', error);
  }
}

function sendFrame(ws: WebSocket, frame: WsServerFrame) {
  if (ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(frame));
  }
}

function toClientErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('API_KEY is not configured')) {
    return 'AI provider is not configured. Please set an LLM API key or enable MOCK_LLM=1.';
  }

  if (message.includes('LLM returned an empty response')) {
    return 'The coach returned an empty response. Please try this turn again.';
  }

  return 'The coach is temporarily unavailable. Please try this turn again.';
}
