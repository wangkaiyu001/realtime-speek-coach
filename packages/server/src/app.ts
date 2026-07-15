import './env.js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { buildConfigFromEnv, type AppConfig } from '../../contracts/src/config.js';
import apiRoutes from './api/routes.js';
import { websocketHandler } from './ws/handler.js';

export interface BuildServerOptions {
  config?: AppConfig;
  logger?: boolean;
  corsOrigin?: string | string[];
}

function buildCorsOrigin(env: Record<string, string | undefined>, override?: string | string[]) {
  if (override) return override;

  const allowedOrigins = (env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return allowedOrigins.length === 0 || allowedOrigins.includes('*') ? '*' : allowedOrigins;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config || buildConfigFromEnv(process.env as Record<string, string | undefined>);
  const fastify = Fastify({
    logger: options.logger ?? true,
  });

  await fastify.register(fastifyCors, {
    origin: buildCorsOrigin(process.env as Record<string, string | undefined>, options.corsOrigin),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
  await fastify.register(fastifyWebsocket);

  await fastify.register(apiRoutes, { prefix: '/api/v1' });

  await fastify.register(async (wsScope) => {
    wsScope.get('/ws', {
      websocket: true,
    }, websocketHandler);
  });

  fastify.decorate('appConfig', config);

  return fastify;
}
