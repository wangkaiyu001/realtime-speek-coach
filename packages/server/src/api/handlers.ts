import type { FastifyRequest, FastifyReply } from 'fastify';
import { buildConfigFromEnv } from '../../../contracts/src/config.js';
import { SEED_SCENARIOS } from '../../../contracts/src/scenarios.js';
import type { Language } from '../../../contracts/src/ws.js';
import { signJwt } from './auth.js';
import { prisma } from '../db/client.js';

const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);

// Login handler
export async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const { code } = request.body as { code: string };

  if (config.mock) {
    const mockOpenId = 'mock-openid-' + code.substring(0, 8);
    // Upsert user
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

  // Real WX login (uncomment in production)
  // const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wx.appId}&secret=${config.wx.appSecret}&js_code=${code}&grant_type=authorization_code`;
  // const wxRes = await fetch(wxUrl);
  // const wxData = await wxRes.json();
  // ...
  throw new Error('Real login not yet implemented - set MOCK=1');
}

// Set language handler
export async function setLanguageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { language } = request.body as { language: Language };
  const { userId } = request.user;

  await prisma.user.update({
    where: { id: userId },
    data: { language },
  });

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
    scenarioTitle: SEED_SCENARIOS.find((sc) => sc.id === s.scenarioId)?.title || 'Unknown',
    turnsCompleted: s.turnsCompleted,
    totalTurns: s.totalTurns,
    status: s.status,
    hasReview: !!s.review && s.review.status === 'completed',
    createdAt: s.createdAt.toISOString(),
  }));

  return reply.send({ sessions: result });
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
    return reply.status(404).send({ error: 'Review not found' });
  }

  return reply.send({
    review: {
      id: review.id,
      sessionId: review.sessionId,
      status: review.status,
      dimensions: {
        pronunciation: review.pronunciation,
        grammar: review.grammar,
        vocabulary: review.vocabulary,
        fluency: review.fluency,
        interaction: review.interaction,
      },
      overallComment: review.overallComment,
      highlights: review.highlights ? JSON.parse(review.highlights) : [],
      suggestions: review.suggestions ? JSON.parse(review.suggestions) : [],
      corrections: review.corrections ? JSON.parse(review.corrections) : [],
      createdAt: review.createdAt.toISOString(),
      completedAt: review.completedAt?.toISOString(),
    },
  });
}

// Health check handler
export async function healthHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
    mock: config.mock,
  });
}
