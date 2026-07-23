import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';

// The server is commonly started in two ways:
// - from the workspace root, e.g. `node packages/server/dist/server/src/index.js`
// - from the package directory via pnpm filters, e.g. `pnpm --filter @rsc/server dev`
// Load the likely .env locations before any module snapshots process.env.
for (const path of ['.env', '../../.env', 'packages/server/.env']) {
  loadDotenv({ path });
}

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml')) || existsSync(join(current, 'prisma', 'schema.prisma'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return startDir;
}

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production and must point to shared persistent storage.');
}

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL?.startsWith('mysql://')) {
  throw new Error('DATABASE_URL must use CloudBase MySQL in production.');
}

if (
  process.env.NODE_ENV === 'production'
  && (!process.env.JWT_SECRET || ['change-me-in-production', 'dev-secret-change-me'].includes(process.env.JWT_SECRET))
) {
  throw new Error('JWT_SECRET is required in production and must be persistent across instances.');
}

if (!process.env.DATABASE_URL) {
  const workspaceRoot = findWorkspaceRoot(process.env.INIT_CWD || process.cwd());
  process.env.DATABASE_URL = `file:${join(workspaceRoot, 'prisma', 'dev.db')}`;
}
