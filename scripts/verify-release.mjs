#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const miniConfigPath = path.join(repoRoot, 'packages', 'miniprogram', 'config.ts');

function fail(message) {
  throw new Error(message);
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function extractProductionOrigin() {
  if (!fs.existsSync(miniConfigPath)) fail('Missing packages/miniprogram/config.ts');
  const source = fs.readFileSync(miniConfigPath, 'utf8');
  const match = source.match(/const\s+PRODUCTION_SERVER_ORIGIN\s*=\s*['"]([^'"]*)['"]/);
  if (!match) fail('config.ts must define PRODUCTION_SERVER_ORIGIN as a string literal.');
  return trimTrailingSlash(match[1]);
}

function assertPublicOrigin(origin) {
  if (!origin) fail('Set PUBLIC_ORIGIN or configure PRODUCTION_SERVER_ORIGIN before release verification.');
  let url;
  try {
    url = new URL(origin);
  } catch {
    fail(`PUBLIC_ORIGIN is not a valid URL: ${origin}`);
  }
  if (url.protocol !== 'https:') fail(`PUBLIC_ORIGIN must use HTTPS for release verification, got ${origin}`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

async function main() {
  const configuredOrigin = extractProductionOrigin();
  const publicOrigin = trimTrailingSlash(process.env.PUBLIC_ORIGIN || configuredOrigin);
  assertPublicOrigin(publicOrigin);

  console.log('Running full Echoia release verification.');
  console.log(`PUBLIC_ORIGIN=${publicOrigin}`);
  console.log('');

  const env = { PUBLIC_ORIGIN: publicOrigin };
  await run('npm', ['run', 'verify:public'], env);
  await run('npm', ['run', 'verify:miniprogram'], env);

  console.log('');
  console.log('Full release verification passed.');
  console.log(`Request domain: ${new URL(publicOrigin).hostname}`);
  console.log(`Socket domain: ${new URL(publicOrigin).hostname}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
