import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/client.js', () => ({
  prisma: {
    user: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../../../review/src/index.js', () => ({
  createReviewWorker: () => ({
    processReviewSafely: vi.fn(),
  }),
}));

describe('setLanguageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns AUTH_EXPIRED instead of a 500 when the user row disappeared', async () => {
    const { prisma } = await import('../db/client.js');
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 });

    const { setLanguageHandler } = await import('../api/handlers.js');
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await setLanguageHandler(
      { body: { language: 'en' }, user: { userId: 'stale-user' } } as never,
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_EXPIRED' }));
  });

  test.each(['en', 'ja'] as const)('updates %s without requiring a local-instance-only row', async (language) => {
    const { prisma } = await import('../db/client.js');
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 });

    const { setLanguageHandler } = await import('../api/handlers.js');
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await setLanguageHandler(
      { body: { language }, user: { userId: 'shared-user' } } as never,
      reply as never,
    );

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'shared-user' },
      data: { language },
    });
    expect(reply.send).toHaveBeenCalledWith({ success: true });
  });
});
