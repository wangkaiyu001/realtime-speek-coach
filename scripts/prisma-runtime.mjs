#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = path.join(
  repoRoot,
  process.env.DATABASE_URL?.startsWith('mysql:')
    ? 'prisma/schema.prisma'
    : 'prisma/schema.sqlite.prisma',
);

const args = ['prisma', ...process.argv.slice(2), '--schema', schema];
const result = spawnSync('pnpm', ['exec', ...args], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
