#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = Number(process.env.VERIFY_HTTP_TIMEOUT_MS || '15000');
const ALLOW_LOCAL = process.env.VERIFY_ALLOW_LOCAL === '1';
const RUN_FULL_SMOKE = process.env.VERIFY_SKIP_FULL_SMOKE !== '1';
const REQUIRE_MOCKS = {
  auth: process.env.VERIFY_REQUIRE_MOCK_AUTH !== '0',
  voice: process.env.VERIFY_REQUIRE_MOCK_VOICE !== '0',
  llm: process.env.VERIFY_REQUIRE_MOCK_LLM !== '0',
  review: process.env.VERIFY_REQUIRE_MOCK_REVIEW !== '0',
};

function fail(message) {
  throw new Error(message);
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function normalizeOrigin(value) {
  if (!value) return '';
  return trimTrailingSlash(String(value).trim());
}

function deriveWsUrl(apiUrl) {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/api\/v1\/?$/, '/ws');
  url.search = '';
  url.hash = '';
  return trimTrailingSlash(url.toString());
}

function endpointConfigFromEnv() {
  const publicOrigin = normalizeOrigin(process.env.PUBLIC_ORIGIN);
  if (publicOrigin) {
    return {
      apiUrl: `${publicOrigin}/api/v1`,
      wsUrl: `${publicOrigin.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')}/ws`,
      source: 'PUBLIC_ORIGIN',
    };
  }

  const apiUrl = normalizeOrigin(process.env.API_URL);
  const wsUrl = normalizeOrigin(process.env.WS_URL || (apiUrl ? deriveWsUrl(apiUrl) : ''));
  return { apiUrl, wsUrl, source: process.env.API_URL ? 'API_URL/WS_URL' : '' };
}

function assertPublicEndpoint(apiUrl, wsUrl) {
  if (!apiUrl || !wsUrl) {
    fail('Set PUBLIC_ORIGIN, or set API_URL and WS_URL, before running public release verification.');
  }

  const urls = [new URL(apiUrl), new URL(wsUrl)];
  const localHostnames = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
  for (const url of urls) {
    if (!ALLOW_LOCAL && localHostnames.has(url.hostname)) {
      fail(`Refusing to verify local endpoint ${url.href}. Set VERIFY_ALLOW_LOCAL=1 only for local development.`);
    }
  }

  if (!['https:', 'http:'].includes(urls[0].protocol)) {
    fail(`API_URL must be http(s), got ${apiUrl}`);
  }
  if (!['wss:', 'ws:'].includes(urls[1].protocol)) {
    fail(`WS_URL must be ws(s), got ${wsUrl}`);
  }
  if (!ALLOW_LOCAL && urls[0].protocol !== 'https:') {
    fail(`Public release API must use HTTPS, got ${apiUrl}`);
  }
  if (!ALLOW_LOCAL && urls[1].protocol !== 'wss:') {
    fail(`Public release WebSocket must use WSS, got ${wsUrl}`);
  }
  if (!apiUrl.endsWith('/api/v1')) {
    fail(`API_URL must end with /api/v1, got ${apiUrl}`);
  }
  if (!wsUrl.endsWith('/ws')) {
    fail(`WS_URL must end with /ws, got ${wsUrl}`);
  }
}

async function requestJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      fail(`GET ${url} returned non-JSON ${response.status}: ${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      fail(`GET ${url} failed: ${response.status} ${text.slice(0, 500)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function assertHealth(health) {
  if (health.status !== 'ok') fail(`Health status is not ok: ${JSON.stringify(health)}`);
  for (const [name, required] of Object.entries(REQUIRE_MOCKS)) {
    if (required && !health.mocks?.[name]) {
      fail(`Health check must report mocks.${name}=true for public-trial verification. Set VERIFY_REQUIRE_MOCK_${name.toUpperCase()}=0 only for hybrid validation.`);
    }
  }
}

function runSmoke(apiUrl, wsUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/mock-e2e-smoke.mjs'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        API_URL: apiUrl,
        WS_URL: wsUrl,
        SMOKE_REQUIRE_MOCK_LLM: REQUIRE_MOCKS.llm ? '1' : '0',
        SMOKE_REQUIRE_MOCK_REVIEW: REQUIRE_MOCKS.review ? '1' : '0',
      },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`mock-e2e smoke failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

async function main() {
  const { apiUrl, wsUrl, source } = endpointConfigFromEnv();
  assertPublicEndpoint(apiUrl, wsUrl);

  console.log(`Verifying public release endpoint from ${source}:`);
  console.log(`API_URL=${apiUrl}`);
  console.log(`WS_URL=${wsUrl}`);

  const health = await requestJson(`${apiUrl}/health`);
  assertHealth(health);
  console.log('Health check passed:', JSON.stringify({ status: health.status, mock: health.mock, mocks: health.mocks, auth: health.auth }));

  if (RUN_FULL_SMOKE) {
    await runSmoke(apiUrl, wsUrl);
  } else {
    console.log('Full smoke skipped because VERIFY_SKIP_FULL_SMOKE=1');
  }

  console.log('Public release verification passed.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
