import { test, expect, describe } from 'vitest';
import Fastify from 'fastify';
import apiRoutes from '../api/routes.js';

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
  });
});
