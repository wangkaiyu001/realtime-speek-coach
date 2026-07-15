import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/client.js', () => ({
  prisma: {
    user: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../../review/src/index.js', () => ({
  createReviewWorker: () => ({
    processReviewSafely: vi.fn(),
  }),
}));

describe('loginHandler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.MOCK;
    delete process.env.MOCK_AUTH;
    delete process.env.WX_APP_ID;
    delete process.env.WX_APP_SECRET;
  });

  test('uses WeChat jscode2session when mock auth is disabled', async () => {
    process.env.MOCK_AUTH = '0';
    process.env.WX_APP_ID = 'wx-real-app';
    process.env.WX_APP_SECRET = 'real-secret';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ openid: 'openid-123', unionid: 'union-123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { prisma } = await import('../db/client.js');
    vi.mocked(prisma.user.upsert).mockResolvedValue({
      id: 'user-123',
      openId: 'openid-123',
      unionId: 'union-123',
      language: 'en',
      level: 3,
      nickname: null,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { loginHandler } = await import('../api/handlers.js');
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await loginHandler(
      { body: { code: 'wx-code' }, log: { error: vi.fn() } } as any,
      reply as any,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('appid=wx-real-app');
    expect(fetchMock.mock.calls[0][0]).toContain('js_code=wx-code');
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { openId: 'openid-123' },
      update: { unionId: 'union-123' },
      create: { openId: 'openid-123', unionId: 'union-123' },
    });
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.any(String),
      userId: 'user-123',
      isNewUser: false,
      language: 'en',
      level: 3,
    }));
  });

  test('rejects real login without a WeChat code', async () => {
    process.env.MOCK_AUTH = '0';
    process.env.WX_APP_ID = 'wx-real-app';
    process.env.WX_APP_SECRET = 'real-secret';

    const { loginHandler } = await import('../api/handlers.js');
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await loginHandler(
      { body: {}, log: { error: vi.fn() } } as any,
      reply as any,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: 'WeChat login code is required' });
  });
});
