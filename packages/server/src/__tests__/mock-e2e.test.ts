import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WsClientFrame, WsServerFrame } from '../../../contracts/src/ws.js';

process.env.MOCK = '1';
process.env.MOCK_AUTH = '1';
process.env.MOCK_VOICE = '1';
process.env.MOCK_LLM = '1';
process.env.MOCK_REVIEW = '1';
process.env.JWT_SECRET = 'test-secret';

const dbDir = mkdtempSync(join(tmpdir(), 'echoia-server-e2e-'));
process.env.DATABASE_URL = `file:${join(dbDir, 'test.db')}`;

const { buildServer } = await import('../app.js');
const { websocketHandler } = await import('../ws/handler.js');
const { prisma } = await import('../db/client.js');

const LANGUAGE = 'en';
const SCENARIO_ID = 'en-shopping-01';

class TestSocket extends EventEmitter {
  readyState = 1;
  sentFrames: WsServerFrame[] = [];
  closeCode?: number;
  closeReason?: string;

  send(data: string) {
    const frame = JSON.parse(data) as WsServerFrame;
    this.sentFrames.push(frame);
    this.emit('serverFrame', frame);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close');
  }

  clientSend(frame: WsClientFrame) {
    this.emit('message', Buffer.from(JSON.stringify(frame)));
  }
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function waitForFrame(socket: TestSocket, predicate: (frame: WsServerFrame) => boolean, timeoutMs = 2000) {
  const existing = socket.sentFrames.find(predicate);
  if (existing) return existing;

  return new Promise<WsServerFrame>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for frame. Seen: ${socket.sentFrames.map((frame) => frame.type).join(', ')}`));
    }, timeoutMs);

    const onFrame = (frame: WsServerFrame) => {
      if (frame.type === 'error') {
        cleanup();
        reject(new Error(`Server error ${frame.code}: ${frame.message}`));
        return;
      }

      if (predicate(frame)) {
        cleanup();
        resolve(frame);
      }
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off('serverFrame', onFrame);
    }

    socket.on('serverFrame', onFrame);
  });
}

async function waitForClose(socket: TestSocket, timeoutMs = 2000) {
  if (socket.readyState === 3) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for socket close'));
    }, timeoutMs);

    const onClose = () => {
      cleanup();
      resolve();
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off('close', onClose);
    }

    socket.on('close', onClose);
  });
}

async function waitForFrameIncludingError(socket: TestSocket, predicate: (frame: WsServerFrame) => boolean, timeoutMs = 2000) {
  const existing = socket.sentFrames.find(predicate);
  if (existing) return existing;

  return new Promise<WsServerFrame>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for frame. Seen: ${socket.sentFrames.map((frame) => frame.type).join(', ')}`));
    }, timeoutMs);

    const onFrame = (frame: WsServerFrame) => {
      if (predicate(frame)) {
        cleanup();
        resolve(frame);
      }
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off('serverFrame', onFrame);
    }

    socket.on('serverFrame', onFrame);
  });
}

async function request(app: FastifyInstance, method: 'GET' | 'POST', url: string, token?: string, payload?: unknown) {
  const response = await app.inject({
    method,
    url,
    headers: token ? authHeaders(token) : undefined,
    payload: payload as string | object | Buffer | undefined,
  });

  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json();
}

function expectReadyFrame(frame: WsServerFrame): asserts frame is Extract<WsServerFrame, { type: 'ready' }> {
  expect(frame.type).toBe('ready');
}

function expectTurnEndFrame(frame: WsServerFrame): asserts frame is Extract<WsServerFrame, { type: 'turn_end' }> {
  expect(frame.type).toBe('turn_end');
}

async function createTestSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      open_id TEXT NOT NULL UNIQUE,
      union_id TEXT,
      language TEXT,
      level INTEGER,
      nickname TEXT,
      avatar_url TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      language TEXT NOT NULL,
      level INTEGER NOT NULL,
      total_turns INTEGER NOT NULL DEFAULT 10,
      turns_completed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'in_progress',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      user_text TEXT,
      ai_text TEXT,
      user_audio_url TEXT,
      ai_audio_url TEXT,
      duration_ms INTEGER,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS turns_session_id_turn_index_key ON turns(session_id, turn_index)');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      pronunciation INTEGER,
      grammar INTEGER,
      vocabulary INTEGER,
      fluency INTEGER,
      interaction INTEGER,
      overall_comment TEXT,
      highlights TEXT,
      suggestions TEXT,
      corrections TEXT,
      raw_response TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS placement_results (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      level INTEGER NOT NULL,
      pronunciation INTEGER NOT NULL DEFAULT 0,
      grammar INTEGER NOT NULL DEFAULT 0,
      vocabulary INTEGER NOT NULL DEFAULT 0,
      fluency INTEGER NOT NULL DEFAULT 0,
      interaction INTEGER NOT NULL DEFAULT 0,
      raw_data TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
}

async function loginAndSelectLanguage(app: FastifyInstance, code: string, language = LANGUAGE) {
  const login = await request(app, 'POST', '/api/v1/auth/login', undefined, { code });
  expect(login.token).toBeTruthy();

  await request(app, 'POST', '/api/v1/user/language', login.token, { language });
  return login as { token: string; userId: string };
}

async function runPracticeSession(token: string, options: { turns?: number; abortAfter?: number; requestReviewOnAbort?: boolean } = {}) {
  const socket = new TestSocket();
  websocketHandler(socket as any, { url: `/ws?token=${encodeURIComponent(token)}` });
  socket.clientSend({ type: 'hello', sessionId: '', scenarioId: SCENARIO_ID, language: LANGUAGE });

  const ready = await waitForFrame(socket, (frame) => frame.type === 'ready');
  expectReadyFrame(ready);
  await waitForFrame(socket, (frame) => frame.type === 'tts_chunk' && frame.isLast);

  const turns = options.abortAfter || options.turns || ready.totalTurns;
  for (let turnIndex = 1; turnIndex <= turns; turnIndex += 1) {
    socket.clientSend({ type: 'audio_chunk', data: Buffer.alloc(320).toString('base64'), seq: turnIndex });
    socket.clientSend({ type: 'audio_end', turnIndex });

    await waitForFrame(socket, (frame) => frame.type === 'asr_final' && frame.turnIndex === turnIndex);
    const turnEnd = await waitForFrame(socket, (frame) => frame.type === 'turn_end' && frame.turnIndex === turnIndex, 4000);

    if (options.abortAfter && turnIndex === options.abortAfter) {
      socket.clientSend({ type: 'abort', reason: 'user_exit', requestReview: !!options.requestReviewOnAbort });

      if (options.requestReviewOnAbort) {
        const abortEnd = await waitForFrame(socket, (frame) => frame.type === 'turn_end' && frame.reviewRequested === true, 4000);
        expectTurnEndFrame(abortEnd);
        expect(abortEnd.sessionComplete).toBe(true);
      }

      await waitForClose(socket);

      return { sessionId: ready.sessionId, socket };
    }

    expectTurnEndFrame(turnEnd);
    expect(turnEnd.sessionComplete).toBe(turnIndex >= ready.totalTurns);
    if (turnEnd.sessionComplete) break;
  }

  socket.close(1000, 'test complete');

  return { sessionId: ready.sessionId, socket };
}

describe('mock end-to-end practice flow without listening on a port', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await createTestSchema();
    app = await buildServer({ logger: false });
    await app.ready();
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    rmSync(dbDir, { recursive: true, force: true });
  });

  test('completes a full practice session and exposes review/history', async () => {
    const health = await request(app, 'GET', '/api/v1/health');
    expect(health.status).toBe('ok');
    expect(health.mocks).toMatchObject({ auth: true, voice: true, llm: true, review: true });

    const login = await loginAndSelectLanguage(app, 'mock-e2e-full');
    const scenarios = await request(app, 'GET', '/api/v1/scenarios', login.token);
    expect(scenarios.scenarios.some((scenario: { id: string }) => scenario.id === SCENARIO_ID)).toBe(true);

    const session = await runPracticeSession(login.token);

    const review = await request(app, 'GET', `/api/v1/reviews/${session.sessionId}`, login.token);
    expect(review.review.status).toBe('completed');
    expect(review.review.dimensions.pronunciation).toBeGreaterThan(0);

    const sessions = await request(app, 'GET', '/api/v1/sessions', login.token);
    const saved = sessions.sessions.find((item: { id: string }) => item.id === session.sessionId);
    const readyFrame = session.socket.sentFrames.find((frame) => frame.type === 'ready');
    expect(saved).toMatchObject({ language: LANGUAGE, turnsCompleted: readyFrame?.totalTurns, status: 'completed', hasReview: true });
  }, 30000);

  test('can request a partial review after an abandoned session', async () => {
    const login = await loginAndSelectLanguage(app, 'mock-e2e-partial');
    const session = await runPracticeSession(login.token, { abortAfter: 3, requestReviewOnAbort: false });

    const before = await request(app, 'GET', '/api/v1/sessions', login.token);
    const abandoned = before.sessions.find((item: { id: string }) => item.id === session.sessionId);
    expect(abandoned).toMatchObject({ turnsCompleted: 3, status: 'abandoned', hasReview: false });

    const accepted = await request(app, 'POST', `/api/v1/reviews/${session.sessionId}/request`, login.token, {});
    expect(accepted.accepted).toBe(true);
    expect(accepted.status).toBe('completed');

    const review = await request(app, 'GET', `/api/v1/reviews/${session.sessionId}`, login.token);
    expect(review.review.status).toBe('completed');
    expect(review.review.overallComment).toContain('partial review');
  }, 30000);

  test('can end early and generate review through websocket abort', async () => {
    const login = await loginAndSelectLanguage(app, 'mock-e2e-early-end');
    const session = await runPracticeSession(login.token, { abortAfter: 2, requestReviewOnAbort: true });

    const review = await request(app, 'GET', `/api/v1/reviews/${session.sessionId}`, login.token);
    expect(review.review.status).toBe('completed');

    const sessions = await request(app, 'GET', '/api/v1/sessions', login.token);
    const saved = sessions.sessions.find((item: { id: string }) => item.id === session.sessionId);
    expect(saved).toMatchObject({ status: 'completed', hasReview: true });
  }, 30000);

  test('blocks Chinese ASR text from being submitted in Japanese practice', async () => {
    const login = await loginAndSelectLanguage(app, 'mock-e2e-ja-mismatch', 'ja');
    const socket = new TestSocket();
    websocketHandler(socket as any, { url: `/ws?token=${encodeURIComponent(login.token)}` });
    socket.clientSend({ type: 'hello', sessionId: '', scenarioId: 'ja-shopping-01', language: 'ja' });

    const ready = await waitForFrame(socket, (frame) => frame.type === 'ready');
    expectReadyFrame(ready);
    await waitForFrame(socket, (frame) => frame.type === 'tts_chunk' && frame.isLast);

    const encoded = Buffer.from('TEXT:我要一杯热咖啡\n').toString('base64');
    socket.clientSend({ type: 'audio_chunk', data: encoded, seq: 1 });
    socket.clientSend({ type: 'audio_end', turnIndex: 1 });

    const mismatch = await waitForFrameIncludingError(socket, (frame) => frame.type === 'error' && frame.code === 'ASR_LANGUAGE_MISMATCH');
    expect(mismatch).toMatchObject({ retryable: true });

    const turnEnd = await waitForFrame(socket, (frame) => frame.type === 'turn_end' && frame.turnIndex === 0);
    expectTurnEndFrame(turnEnd);
    expect(turnEnd.sessionComplete).toBe(false);
    expect(socket.sentFrames.some((frame) => frame.type === 'asr_final' && frame.text === '我要一杯热咖啡')).toBe(false);

    const turns = await prisma.turn.findMany({ where: { sessionId: ready.sessionId } });
    expect(turns).toHaveLength(0);

    socket.close(1000, 'test complete');
  }, 30000);

  test('blocks English ASR text from being submitted in Japanese practice', async () => {
    const login = await loginAndSelectLanguage(app, 'mock-e2e-ja-english-mismatch', 'ja');
    const socket = new TestSocket();
    websocketHandler(socket as any, { url: `/ws?token=${encodeURIComponent(login.token)}` });
    socket.clientSend({ type: 'hello', sessionId: '', scenarioId: 'ja-shopping-01', language: 'ja' });

    const ready = await waitForFrame(socket, (frame) => frame.type === 'ready');
    expectReadyFrame(ready);
    await waitForFrame(socket, (frame) => frame.type === 'tts_chunk' && frame.isLast);

    const englishText = 'I would like a hot coffee please';
    const encoded = Buffer.from(`TEXT:${englishText}\n`).toString('base64');
    socket.clientSend({ type: 'audio_chunk', data: encoded, seq: 1 });
    socket.clientSend({ type: 'audio_end', turnIndex: 1 });

    const mismatch = await waitForFrameIncludingError(socket, (frame) => frame.type === 'error' && frame.code === 'ASR_LANGUAGE_MISMATCH');
    expect(mismatch).toMatchObject({ retryable: true });

    const turnEnd = await waitForFrame(socket, (frame) => frame.type === 'turn_end' && frame.turnIndex === 0);
    expectTurnEndFrame(turnEnd);
    expect(turnEnd.sessionComplete).toBe(false);
    expect(socket.sentFrames.some((frame) => frame.type === 'asr_final' && frame.text === englishText)).toBe(false);

    const turns = await prisma.turn.findMany({ where: { sessionId: ready.sessionId } });
    expect(turns).toHaveLength(0);

    socket.close(1000, 'test complete');
  }, 30000);
});
