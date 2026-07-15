import '../env.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildConfigFromEnv } from '../../../contracts/src/config.js';

const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);

// JWT helpers
export function signJwt(payload: object): string {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: '7d' });
}

export function verifyJwt(token: string): object | null {
  try {
    return jwt.verify(token, config.jwt.secret) as object;
  } catch (err) {
    return null;
  }
}

// Auth hook
export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyJwt(token);
  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  request.user = payload as { userId: string };
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    user: { userId: string };
  }
}
