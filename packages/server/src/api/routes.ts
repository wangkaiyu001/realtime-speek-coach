import type { FastifyPluginAsync } from 'fastify';
import {
  loginHandler,
  setLanguageHandler,
  getScenariosHandler,
  getSessionsHandler,
  getReviewHandler,
  requestReviewHandler,
  healthHandler,
  readinessHandler,
} from './handlers.js';
import { authHook } from './auth.js';

const apiRoutes: FastifyPluginAsync = async (fastify) => {
  // Public routes (no auth)
  fastify.register(async (publicScope) => {
    publicScope.post('/auth/login', loginHandler);
    publicScope.get('/health', healthHandler);
    publicScope.get('/ready', readinessHandler);
  });

  // Protected routes (auth required)
  fastify.register(async (protectedScope) => {
    protectedScope.addHook('preHandler', authHook);
    protectedScope.post('/user/language', setLanguageHandler);
    protectedScope.get('/scenarios', getScenariosHandler);
    protectedScope.get('/sessions', getSessionsHandler);
    protectedScope.get('/reviews/:sessionId', getReviewHandler);
    protectedScope.post('/reviews/:sessionId/request', requestReviewHandler);
  });
};

export default apiRoutes;
