import { test, expect, describe, vi } from 'vitest';
import Fastify from 'fastify';
import apiRoutes from '../api/routes.js';
import { prisma } from '../db/client.js';

describe('Health Endpoint', () => {
  test('GET /api/v1/health returns 200 with status ok', async () => {
    const fastify = Fastify();
    await fastify.register(apiRoutes, { prefix: '/api/v1' });

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.mock).toBe('boolean');
    expect(['mock', 'wechat']).toContain(body.auth.mode);
    expect(typeof body.auth.wechatConfigured).toBe('boolean');
    expect(body.providers).toMatchObject({ deepseek: false, gemini: false, volcVoice: false });
  });

  test('GET /api/v1/ready verifies database connectivity', async () => {
    const querySpy = vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ result: 1 }]);
    const fastify = Fastify();
    await fastify.register(apiRoutes, { prefix: '/api/v1' });

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      database: 'connected',
    });

    expect(querySpy).toHaveBeenCalledOnce();
    querySpy.mockRestore();
    await fastify.close();
  });

  test('GET /api/v1/ready returns 503 when the database is unavailable', async () => {
    const querySpy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('database unavailable'));
    const fastify = Fastify({ logger: false });
    await fastify.register(apiRoutes, { prefix: '/api/v1' });

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'not_ready',
      database: 'unavailable',
    });

    expect(querySpy).toHaveBeenCalledOnce();
    querySpy.mockRestore();
    await fastify.close();
  });

});
