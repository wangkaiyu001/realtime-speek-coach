import type { FastifyPluginAsync } from 'fastify';
import { loginHandler, setLanguageHandler, getScenariosHandler, getSessionsHandler, getReviewHandler, healthHandler } from './handlers.js';
import { authHook } from './auth.js';

const apiRoutes: FastifyPluginAsync = async (fastify) => {
  // Public routes
  fastify.post('/auth/login', loginHandler);
  fastify.get('/health', healthHandler);

  // Protected routes
  fastify.addHook('preHandler', authHook);
  fastify.post('/user/language', setLanguageHandler);
  fastify.get('/scenarios', getScenariosHandler);
  fastify.get('/sessions', getSessionsHandler);
  fastify.get('/reviews/:sessionId', getReviewHandler);
};

export default apiRoutes;