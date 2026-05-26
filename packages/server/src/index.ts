import 'dotenv/config';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { buildConfigFromEnv } from '../../contracts/src/config.js';
import apiRoutes from './api/routes.js';
import { websocketHandler } from './ws/handler.js';

const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);

const prisma = new PrismaClient();

async function main() {
  const fastify = Fastify({
    logger: true
  });

  // Register plugins
  await fastify.register(fastifyCors, {
    origin: '*', // In production, restrict this to your mini-program domain
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  });
  await fastify.register(fastifyWebsocket);

  // Register API routes
  await fastify.register(apiRoutes, { prefix: '/api/v1' });

  // Register WebSocket handler
  fastify.register(async (fastify) => {
    fastify.get('/ws', {
      websocket: true
    }, websocketHandler);
  });

  try {
    await fastify.listen({
      port: config.port || 3000,
      host: '0.0.0.0'
    });
    console.log(`Server running on port ${config.port || 3000}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });