import type { WebSocket } from 'ws';
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

const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);

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
}

const activeSessions = new Map<WebSocket, ActiveSession>();

export const websocketHandler = (connection: WebSocket, request: any) => {
  // Extract token from query params
  const url = new URL(request.url, 'http://localhost');
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

  connection.on('message', async (raw) => {
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
      activeSessions.delete(connection);
    }
  });

  connection.on('error', (err) => {
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
      handleAbort(ws);
      break;
  }
}

async function handleHello(ws: WebSocket, userId: string, frame: WsClientFrame & { type: 'hello' }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const language = (user?.language || 'en') as Language;
  const level = (user?.level || 4) as ProficiencyLevel;

  // Create a new session in DB
  const dbSession = await prisma.session.create({
    data: {
      userId,
      scenarioId: frame.scenarioId,
      language,
      level,
      totalTurns: 10,
    },
  });

  const session: ActiveSession = {
    sessionId: dbSession.id,
    userId,
    scenarioId: frame.scenarioId,
    language,
    level,
    currentTurn: 0,
    totalTurns: 10,
    turnState: 'idle',
    conversationHistory: [],
    audioChunks: [],
  };

  activeSessions.set(ws, session);

  sendFrame(ws, {
    type: 'ready',
    sessionId: dbSession.id,
    totalTurns: 10,
  });

  // AI opens the conversation (turn 0 is AI's opening)
  await generateAiTurn(ws, session, true);
}

function handleAudioChunk(ws: WebSocket, frame: WsClientFrame & { type: 'audio_chunk' }) {
  const session = activeSessions.get(ws);
  if (!session) return;

  session.turnState = 'recording';
  session.audioChunks.push(frame.data);

  // In a real implementation, stream to ASR here
  // For mock, just accumulate
}

async function handleAudioEnd(ws: WebSocket, frame: WsClientFrame & { type: 'audio_end' }) {
  const session = activeSessions.get(ws);
  if (!session) return;

  session.turnState = 'processing_asr';
  session.currentTurn = frame.turnIndex;

  // Mock ASR
  const mockTexts = [
    "I would like a cup of coffee please.",
    "Yes, I'll have it with milk, no sugar.",
    "Do you have any pastries available?",
    "How much does that cost?",
    "I'll pay with my card, please.",
    "Could you recommend something for lunch?",
    "That sounds great, I'll try it.",
    "Is there WiFi available here?",
    "Thank you very much for your help.",
    "Have a wonderful day!",
  ];

  const userText = config.mock
    ? mockTexts[Math.min(frame.turnIndex - 1, mockTexts.length - 1)]
    : 'ASR result placeholder'; // Real ASR would go here

  // Emit partial then final
  sendFrame(ws, { type: 'asr_partial', text: userText.substring(0, 10) + '...' });

  await new Promise((r) => setTimeout(r, config.mock ? 300 : 0));

  sendFrame(ws, { type: 'asr_final', text: userText, turnIndex: frame.turnIndex });

  // Save user turn to DB
  await prisma.turn.create({
    data: {
      sessionId: session.sessionId,
      turnIndex: frame.turnIndex,
      userText,
    },
  });

  session.conversationHistory.push({ role: 'user', content: userText });
  session.audioChunks = [];

  // Generate AI response
  await generateAiTurn(ws, session, false);
}

async function generateAiTurn(ws: WebSocket, session: ActiveSession, isOpening: boolean) {
  session.turnState = 'thinking';

  const scenario = SEED_SCENARIOS.find((s) => s.id === session.scenarioId);

  if (isOpening && scenario) {
    // AI opening line
    const openingText = scenario.openingLine;
    session.conversationHistory.push({ role: 'assistant', content: openingText });

    // Stream as LLM deltas (mock sentence-by-sentence)
    const words = openingText.split(' ');
    let accumulated = '';
    for (let i = 0; i < words.length; i++) {
      accumulated += (i > 0 ? ' ' : '') + words[i];
      sendFrame(ws, { type: 'llm_delta', text: words[i] + ' ', accumulated });
      await new Promise((r) => setTimeout(r, config.mock ? 30 : 0));
    }

    // Mock TTS chunks
    await emitMockTtsChunks(ws, openingText);

    return;
  }

  // Generate AI response via LLM (mock for now)
  const mockResponses = [
    "Great choice! Would you like that hot or iced?",
    "Sure thing! Milk, no sugar - coming right up.",
    "We have fresh croissants, muffins, and cinnamon rolls today.",
    "That'll be four dollars and fifty cents.",
    "Of course! Just tap your card here whenever you're ready.",
    "Our chicken avocado sandwich is really popular today!",
    "Excellent! I'll have that ready for you in just a moment.",
    "Yes! The password is on the receipt. It's CoffeeLovers2026.",
    "You're very welcome! Enjoy your meal.",
    "Thank you! You too, have a great day!",
  ];

  const turnIdx = session.currentTurn;
  const aiText = config.mock
    ? mockResponses[Math.min(turnIdx - 1, mockResponses.length - 1)]
    : 'LLM response placeholder';

  // Stream LLM deltas
  const words = aiText.split(' ');
  let accumulated = '';
  for (let i = 0; i < words.length; i++) {
    accumulated += (i > 0 ? ' ' : '') + words[i];
    sendFrame(ws, { type: 'llm_delta', text: words[i] + ' ', accumulated });
    await new Promise((r) => setTimeout(r, config.mock ? 40 : 0));
  }

  session.conversationHistory.push({ role: 'assistant', content: aiText });
  session.turnState = 'speaking';

  // Mock TTS
  await emitMockTtsChunks(ws, aiText);

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
  const sessionComplete = turnIdx >= session.totalTurns;
  sendFrame(ws, {
    type: 'turn_end',
    turnIndex: turnIdx,
    totalTurns: session.totalTurns,
    sessionComplete,
  });

  if (sessionComplete) {
    await prisma.session.update({
      where: { id: session.sessionId },
      data: { status: 'completed' },
    });
    // Trigger review generation (fire and forget)
    // reviewWorker.enqueueReview(session.sessionId);
  }

  session.turnState = 'idle';
}

async function emitMockTtsChunks(ws: WebSocket, text: string) {
  // Simulate 3 TTS audio chunks
  const chunkCount = 3;
  for (let i = 0; i < chunkCount; i++) {
    // Generate a fake base64-encoded audio chunk (256 bytes of silence)
    const fakeAudio = Buffer.alloc(256).toString('base64');
    sendFrame(ws, {
      type: 'tts_chunk',
      data: fakeAudio,
      seq: i,
      isLast: i === chunkCount - 1,
    });
    await new Promise((r) => setTimeout(r, 100));
  }
}

function handleAbort(ws: WebSocket) {
  const session = activeSessions.get(ws);
  if (session) {
    prisma.session.update({
      where: { id: session.sessionId },
      data: { status: 'abandoned' },
    }).catch(console.error);
    activeSessions.delete(ws);
  }
  ws.close(1000, 'Session aborted');
}

function sendFrame(ws: WebSocket, frame: WsServerFrame) {
  if (ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(frame));
  }
}
