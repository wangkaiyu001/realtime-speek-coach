#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOrigin = 'https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com';
const publicOrigin = trimTrailingSlash(process.env.PUBLIC_ORIGIN || defaultOrigin);
const githubRepo = process.env.GITHUB_REPOSITORY || 'wangkaiyu001/realtime-speek-coach';
const timeoutMs = Number(process.env.GO_LIVE_AUDIT_TIMEOUT_MS || '15000');
const skipNetwork = process.env.GO_LIVE_AUDIT_SKIP_NETWORK === '1';
const requireProductionProviders = process.env.GO_LIVE_AUDIT_REQUIRE_PROVIDERS === '1';

const results = [];

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function record(name, status, detail) {
  results.push({ name, status, detail });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: options.timeout || timeoutMs,
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error,
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function extractProductionOrigin() {
  const configPath = path.join(repoRoot, 'packages', 'miniprogram', 'config.ts');
  if (!fs.existsSync(configPath)) return '';
  const source = fs.readFileSync(configPath, 'utf8');
  const match = source.match(/const\s+PRODUCTION_SERVER_ORIGIN\s*=\s*['"]([^'"]*)['"]/);
  return match ? trimTrailingSlash(match[1]) : '';
}

function isPlaceholderAppId(appid) {
  return !appid || appid === 'touristappid' || /^wx(?:0+|x+)$/i.test(appid) || appid.includes('<');
}

function auditGit() {
  const status = run('git', ['status', '--short', '--branch']);
  if (!status.ok) {
    record('git-status', 'fail', status.stderr || status.error?.message || 'git status failed');
    return;
  }

  const lines = status.stdout.split('\n').filter(Boolean);
  const dirtyLines = lines.filter((line) => !line.startsWith('##'));
  record('git-worktree', dirtyLines.length === 0 ? 'pass' : 'fail', dirtyLines.length === 0 ? 'clean' : dirtyLines.join('\n'));

  const sync = run('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
  if (!sync.ok) {
    record('git-sync', 'warn', sync.stderr || 'cannot compare origin/main...HEAD');
    return;
  }
  const [behind, ahead] = sync.stdout.split(/\s+/).map((value) => Number(value));
  record('git-sync', behind === 0 && ahead === 0 ? 'pass' : 'fail', `behind=${behind || 0}, ahead=${ahead || 0}`);
}

async function auditHealth() {
  if (skipNetwork) {
    record('public-health', 'warn', 'skipped because GO_LIVE_AUDIT_SKIP_NETWORK=1');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${publicOrigin}/api/v1/health`, { signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      record('public-health', 'fail', `non-JSON response ${response.status}: ${text.slice(0, 200)}`);
      return null;
    }
    if (!response.ok || body.status !== 'ok') {
      record('public-health', 'fail', `HTTP ${response.status}: ${JSON.stringify(body)}`);
      return body;
    }
    record('public-health', 'pass', JSON.stringify({ status: body.status, mock: body.mock, mocks: body.mocks, auth: body.auth, providers: body.providers }));

    const readinessResponse = await fetch(`${publicOrigin}/api/v1/ready`, { signal: controller.signal });
    const readinessText = await readinessResponse.text();
    let readinessBody;
    try {
      readinessBody = readinessText ? JSON.parse(readinessText) : {};
    } catch {
      record('public-readiness', 'fail', `non-JSON response ${readinessResponse.status}: ${readinessText.slice(0, 200)}`);
      return body;
    }
    if (!readinessResponse.ok || readinessBody.status !== 'ready' || readinessBody.database !== 'connected') {
      record('public-readiness', 'fail', `HTTP ${readinessResponse.status}: ${JSON.stringify(readinessBody)}`);
    } else {
      record('public-readiness', 'pass', JSON.stringify(readinessBody));
    }
    return body;
  } catch (error) {
    record('public-health', 'fail', error.message || String(error));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function auditMiniConfig() {
  const configuredOrigin = extractProductionOrigin();
  record(
    'miniprogram-origin',
    configuredOrigin === publicOrigin ? 'pass' : 'fail',
    `PRODUCTION_SERVER_ORIGIN=${configuredOrigin || '<missing>'}, PUBLIC_ORIGIN=${publicOrigin}`,
  );

  let appid = process.env.WECHAT_APPID?.trim() || '';
  try {
    const projectConfig = readJson('packages/miniprogram/project.config.json');
    if (!appid) appid = String(projectConfig.appid || '').trim();
  } catch (error) {
    record('wechat-appid', 'fail', `cannot read project.config.json: ${error.message}`);
    return;
  }
  record('wechat-appid', isPlaceholderAppId(appid) ? 'warn' : 'pass', isPlaceholderAppId(appid) ? 'real appid not configured locally' : `appid=${appid}`);

  const keyPath = process.env.WECHAT_PRIVATE_KEY_PATH?.trim();
  const keyValue = process.env.WECHAT_PRIVATE_KEY?.trim();
  if (keyPath && fs.existsSync(path.resolve(keyPath))) {
    record('wechat-private-key', 'pass', `WECHAT_PRIVATE_KEY_PATH=${path.resolve(keyPath)}`);
  } else if (keyValue) {
    record('wechat-private-key', keyValue.includes('PRIVATE KEY') ? 'pass' : 'fail', 'WECHAT_PRIVATE_KEY environment variable is set');
  } else {
    record('wechat-private-key', 'warn', 'not configured locally');
  }
}

function auditGithubSecrets() {
  if (skipNetwork) {
    record('github-secrets', 'warn', 'skipped because GO_LIVE_AUDIT_SKIP_NETWORK=1');
    return;
  }

  const ghCheck = run('gh', ['--version']);
  if (!ghCheck.ok) {
    record('github-secrets', 'warn', 'gh CLI unavailable');
    return;
  }

  const secrets = run('gh', ['secret', 'list', '--repo', githubRepo]);
  if (!secrets.ok) {
    record('github-secrets', 'warn', secrets.stderr || 'cannot list GitHub secrets');
    return;
  }

  const names = new Set(
    secrets.stdout
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  );
  const missing = ['WECHAT_APPID', 'WECHAT_PRIVATE_KEY'].filter((name) => !names.has(name));
  record('github-secrets', missing.length === 0 ? 'pass' : 'warn', missing.length === 0 ? 'WECHAT_APPID and WECHAT_PRIVATE_KEY configured' : `missing: ${missing.join(', ')}`);
}

function auditProviderMode(health) {
  if (!health) {
    record('provider-mode', 'warn', 'health unavailable; cannot determine provider mode');
    return;
  }

  const mocked = Object.entries(health.mocks || {})
    .filter(([, value]) => value)
    .map(([name]) => name);
  if (mocked.length === 0) {
    record('provider-mode', 'pass', 'no mocked providers reported');
    return;
  }

  record(
    'provider-mode',
    requireProductionProviders ? 'fail' : 'warn',
    `public trial is using mocked providers: ${mocked.join(', ')}`,
  );
}

function printSummary() {
  const counts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  console.log('Echoia go-live audit');
  console.log(`PUBLIC_ORIGIN=${publicOrigin}`);
  console.log(`GITHUB_REPOSITORY=${githubRepo}`);
  console.log('');

  for (const result of results) {
    const marker = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${result.name}: ${result.detail}`);
  }

  console.log('');
  console.log(`Summary: pass=${counts.pass || 0}, warn=${counts.warn || 0}, fail=${counts.fail || 0}`);

  const failures = results.filter((result) => result.status === 'fail');
  if (failures.length > 0) process.exitCode = 1;
}

async function main() {
  auditGit();
  const health = await auditHealth();
  auditMiniConfig();
  auditGithubSecrets();
  auditProviderMode(health);
  printSummary();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
