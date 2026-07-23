import '../env.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { buildConfigFromEnv } from '../../../contracts/src/config.js';
import { SEED_SCENARIOS } from '../../../contracts/src/scenarios.js';
import type { Language } from '../../../contracts/src/ws.js';
import { signJwt } from './auth.js';
import { prisma } from '../db/client.js';
import { createReviewWorker } from '../../../review/src/index.js';

const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);
const reviewWorker = createReviewWorker(config, prisma);
const REVIEW_SYNC_WAIT_MS = 18000;

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeApiKey(value: string): string {
  if (
    !value
    || value.startsWith('your_')
    || value.endsWith('_here')
    || value.startsWith('replace-')
    || value.startsWith('change-me')
    || value === 'wxTESTAPPID'
  ) return '';
  return value;
}

function maskConfigured(value: string): boolean {
  return !!normalizeApiKey(value);
}

interface WeChatSessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

async function exchangeWeChatCodeForSession(code: string): Promise<WeChatSessionResponse> {
  const appId = normalizeApiKey(config.wx.appId);
  const appSecret = normalizeApiKey(config.wx.appSecret);

  if (!appId || !appSecret) {
    throw new Error('WX_APP_ID and WX_APP_SECRET are required when MOCK_AUTH=0');
  }

  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: code,
    grant_type: 'authorization_code',
  });
  const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`;

  const wxRes = await fetch(wxUrl);
  if (!wxRes.ok) {
    throw new Error(`WeChat jscode2session failed with HTTP ${wxRes.status}`);
  }

  const wxData = (await wxRes.json()) as WeChatSessionResponse;
  if (wxData.errcode) {
    throw new Error(`WeChat jscode2session failed: ${wxData.errcode} ${wxData.errmsg || ''}`.trim());
  }
  if (!wxData.openid) {
    throw new Error('WeChat jscode2session response missing openid');
  }

  return wxData;
}

function toScore(value: number | null): number {
  return typeof value === 'number' ? value : 0;
}

async function runReviewWithBoundedWait(sessionId: string) {
  await Promise.race([
    reviewWorker.processReviewSafely(sessionId),
    new Promise<void>((resolve) => setTimeout(resolve, REVIEW_SYNC_WAIT_MS)),
  ]);
}

// Login handler
export async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const { code } = request.body as { code?: string };
  const loginCode = typeof code === 'string' && code.trim() ? code.trim() : '';

  if (config.mocks.auth) {
    const mockCode = loginCode || 'dev-user-001';
    const mockOpenId = 'mock-openid-' + mockCode.substring(0, 32);
    const user = await prisma.user.upsert({
      where: { openId: mockOpenId },
      update: {},
      create: { openId: mockOpenId },
    });
    const token = signJwt({ userId: user.id });
    return reply.send({
      token,
      userId: user.id,
      isNewUser: !user.language,
      language: user.language as Language | undefined,
      level: user.level,
    });
  }

  if (!loginCode) {
    return reply.status(400).send({ error: 'WeChat login code is required' });
  }

  try {
    const wxSession = await exchangeWeChatCodeForSession(loginCode);
    const user = await prisma.user.upsert({
      where: { openId: wxSession.openid! },
      update: {
        ...(wxSession.unionid ? { unionId: wxSession.unionid } : {}),
      },
      create: {
        openId: wxSession.openid!,
        unionId: wxSession.unionid,
      },
    });
    const token = signJwt({ userId: user.id });
    return reply.send({
      token,
      userId: user.id,
      isNewUser: !user.language,
      language: user.language as Language | undefined,
      level: user.level,
    });
  } catch (error) {
    request.log.error({ err: error }, 'WeChat login failed');
    return reply.status(502).send({
      error: error instanceof Error ? error.message : 'WeChat login failed',
    });
  }
}

// Set language handler
export async function setLanguageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { language } = request.body as { language: Language };
  const { userId } = request.user;

  if (language !== 'en' && language !== 'ja') {
    return reply.status(400).send({ error: 'Unsupported language' });
  }

  const updated = await prisma.user.updateMany({
    where: { id: userId },
    data: { language },
  });

  if (updated.count !== 1) {
    return reply.status(401).send({
      error: 'Login state is no longer available. Please sign in again.',
      code: 'AUTH_EXPIRED',
    });
  }

  return reply.send({ success: true });
}

// Get scenarios handler
export async function getScenariosHandler(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.user;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userLanguage = (user?.language || 'en') as Language;

  const filtered = SEED_SCENARIOS.filter((s) => s.language === userLanguage);
  return reply.send({ scenarios: filtered });
}

// Get sessions handler
export async function getSessionsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.user;

  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { review: { select: { id: true, status: true } } },
  });

  const result = sessions.map((s) => ({
    id: s.id,
    scenarioId: s.scenarioId,
    scenarioTitle: SEED_SCENARIOS.find((sc) => sc.id === s.scenarioId)?.titleCn
      || SEED_SCENARIOS.find((sc) => sc.id === s.scenarioId)?.title
      || '未知场景',
    language: s.language as Language,
    turnsCompleted: s.turnsCompleted,
    totalTurns: s.totalTurns,
    status: s.status,
    hasReview: !!s.review && s.review.status === 'completed',
    reviewStatus: s.review?.status,
    createdAt: s.createdAt.toISOString(),
  }));

  return reply.send({ sessions: result });
}

// Request review generation for a completed or partially completed session.
export async function requestReviewHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = request.params as { sessionId: string };
  const { userId } = request.user;

  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
    include: { turns: true, review: true },
  });

  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  const completedTurns = session.turns.filter((turn) => !!turn.userText).length;
  if (completedTurns <= 0) {
    return reply.status(400).send({ error: 'At least one completed turn is required before generating a review' });
  }

  if (session.review?.status === 'completed' || session.review?.status === 'processing') {
    return reply.send({
      accepted: true,
      sessionId,
      status: session.review.status,
    });
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: 'completed',
      turnsCompleted: Math.max(session.turnsCompleted, completedTurns),
    },
  });

  if (config.mocks.review) {
    await createMockReviewFromSession(sessionId, session.language as Language, completedTurns);
  } else {
    await runReviewWithBoundedWait(sessionId);
  }

  const review = await prisma.review.findUnique({ where: { sessionId } });

  return reply.send({
    accepted: true,
    sessionId,
    status: review?.status || 'processing',
  });
}

// Get review handler
export async function getReviewHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = request.params as { sessionId: string };
  const { userId } = request.user;

  // Verify session belongs to user
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  const review = await prisma.review.findUnique({
    where: { sessionId },
  });

  if (!review) {
    return reply.send({
      review: {
        id: '',
        sessionId,
        status: session.status === 'completed' ? 'pending' : 'failed',
        dimensions: {
          pronunciation: 0,
          grammar: 0,
          vocabulary: 0,
          fluency: 0,
          interaction: 0,
        },
        overallComment: session.status === 'completed'
          ? 'Review is being generated.'
          : 'Full review is available after completing all turns.',
        highlights: [],
        suggestions: [],
        corrections: [],
        createdAt: session.createdAt.toISOString(),
      },
    });
  }

  return reply.send({
    review: {
      id: review.id,
      sessionId: review.sessionId,
      status: review.status,
      dimensions: {
        pronunciation: toScore(review.pronunciation),
        grammar: toScore(review.grammar),
        vocabulary: toScore(review.vocabulary),
        fluency: toScore(review.fluency),
        interaction: toScore(review.interaction),
      },
      overallComment: review.overallComment || '',
      highlights: parseJsonArray(review.highlights),
      suggestions: parseJsonArray(review.suggestions),
      corrections: parseJsonArray(review.corrections),
      createdAt: review.createdAt.toISOString(),
      completedAt: review.completedAt?.toISOString(),
    },
  });
}

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

function getApiMockReview(language: Language, completedTurns: number): MockReviewData {
  const partialPrefix = completedTurns < 10
    ? `This is a partial review based on ${completedTurns} completed turn${completedTurns === 1 ? '' : 's'}. `
    : '';

  if (language === 'ja') {
    return {
      pronunciation: 80,
      grammar: 76,
      vocabulary: 82,
      fluency: 78,
      interaction: 86,
      overallComment: `${partialPrefix}Your Japanese responses were natural and easy to follow. Next, focus on particles and polite form consistency.`,
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
    overallComment: `${partialPrefix}You kept the conversation moving naturally and used useful everyday expressions. Next, focus on small grammar details and adding short reasons to your answers.`,
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

async function createMockReviewFromSession(sessionId: string, language: Language, completedTurns: number) {
  const review = getApiMockReview(language, completedTurns);

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

// Readiness check handler. Unlike the liveness endpoint, this verifies that
// the process can reach its durable state dependency before receiving traffic.
export async function readinessHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return reply.send({
      status: 'ready',
      database: 'connected',
    });
  } catch (error) {
    request.log.error({ err: error }, 'Readiness database check failed');
    return reply.status(503).send({
      status: 'not_ready',
      database: 'unavailable',
    });
  }
}

// Health check handler
export async function healthHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
    mock: config.mock,
    mocks: config.mocks,
    providers: {
      deepseek: maskConfigured(config.deepseek.apiKey),
      gemini: maskConfigured(config.gemini.apiKey),
      volcVoice: maskConfigured(config.volcVoice.apiKey) && maskConfigured(config.volcVoice.appKey),
    },
    auth: {
      mode: config.mocks.auth ? 'mock' : 'wechat',
      wechatConfigured: maskConfigured(config.wx.appId) && maskConfigured(config.wx.appSecret),
    },
  });
}
