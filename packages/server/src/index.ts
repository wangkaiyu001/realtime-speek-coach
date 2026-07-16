import './env.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfigFromEnv } from '../../contracts/src/config.js';
import { prisma } from './db/client.js';
import { buildServer } from './app.js';

const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);

function hasConfiguredApiKey(value: string): boolean {
  return !!value && !value.startsWith('your_');
}

function getWebPreviewRoot() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, '../../../src/web-preview'),
    path.resolve(__dirname, '../../web-preview'),
    path.resolve(__dirname, './web-preview'),
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, 'index.html'))) || candidates[0];
}

function getContentType(fileName: string) {
  if (fileName.endsWith('.html')) return 'text/html; charset=utf-8';
  if (fileName.endsWith('.css')) return 'text/css; charset=utf-8';
  if (fileName.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function registerWebPreview(fastify: Awaited<ReturnType<typeof buildServer>>) {
  const webPreviewRoot = getWebPreviewRoot();
  const files = new Map([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/styles.css', 'styles.css'],
    ['/app.js', 'app.js'],
  ]);

  for (const [route, fileName] of files) {
    fastify.get(route, async (_request, reply) => {
      try {
        const content = await readFile(path.join(webPreviewRoot, fileName), 'utf8');
        return reply
          .header('Cache-Control', 'no-store, max-age=0')
          .type(getContentType(fileName))
          .send(content);
      } catch {
        return reply.status(404).send('Web preview file not found. Please build the server and copy web-preview assets.');
      }
    });
  }
}

async function main() {
  const fastify = await buildServer({ config });
  await registerWebPreview(fastify);

  try {
    await fastify.listen({
      port: config.port || 3000,
      host: config.host || '127.0.0.1'
    });
    console.log(`Server running on port ${config.port || 3000}`);
    console.log('[Config] Active mocks:', config.mocks);
    console.log('[Config] Providers:', {
      deepseek: hasConfiguredApiKey(config.deepseek.apiKey),
      gemini: hasConfiguredApiKey(config.gemini.apiKey),
      volcVoice: hasConfiguredApiKey(config.volcVoice.apiKey)
    });

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      fastify.log.info({ signal }, 'Graceful shutdown started');

      const forceExit = setTimeout(() => {
        fastify.log.error('Graceful shutdown timed out');
        process.exit(1);
      }, 10000);
      forceExit.unref();

      try {
        await fastify.close();
        await prisma.$disconnect();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (error) {
        fastify.log.error(error, 'Graceful shutdown failed');
        process.exit(1);
      }
    };

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    fastify.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
