#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const miniRoot = path.join(repoRoot, 'packages', 'miniprogram');
const requireRealAppId = process.env.VERIFY_REQUIRE_WECHAT_APPID === '1';
const expectedOrigin = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');

const warnings = [];

function fail(message) {
  throw new Error(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(relativePath) {
  const absolutePath = path.join(miniRoot, relativePath);
  if (!fs.existsSync(absolutePath)) fail(`Missing ${relativePath}`);

  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function assertFile(relativePath) {
  const absolutePath = path.join(miniRoot, relativePath);
  if (!fs.existsSync(absolutePath)) fail(`Missing ${relativePath}`);
}

function extractProductionOrigin() {
  const configPath = path.join(miniRoot, 'config.ts');
  if (!fs.existsSync(configPath)) fail('Missing config.ts');

  const source = fs.readFileSync(configPath, 'utf8');
  const match = source.match(/const\s+PRODUCTION_SERVER_ORIGIN\s*=\s*['"]([^'"]*)['"]/);
  if (!match) fail('config.ts must define PRODUCTION_SERVER_ORIGIN as a string literal.');
  return match[1].replace(/\/$/, '');
}

function assertHttpsOrigin(origin) {
  if (!origin) fail('PRODUCTION_SERVER_ORIGIN is empty; trial/release builds would fail fast.');

  let url;
  try {
    url = new URL(origin);
  } catch {
    fail(`PRODUCTION_SERVER_ORIGIN is not a valid URL: ${origin}`);
  }

  if (url.protocol !== 'https:') fail(`PRODUCTION_SERVER_ORIGIN must use HTTPS, got ${origin}`);

  const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
  if (localHosts.has(url.hostname)) fail(`PRODUCTION_SERVER_ORIGIN must not be local, got ${origin}`);

  if (/trycloudflare\.com$/i.test(url.hostname)) {
    fail(`PRODUCTION_SERVER_ORIGIN points to a temporary Cloudflare tunnel, got ${origin}`);
  }
}

function verifyAppJson() {
  const appJson = readJson('app.json');
  if (!Array.isArray(appJson.pages) || appJson.pages.length === 0) {
    fail('app.json must contain at least one page.');
  }

  for (const page of appJson.pages) {
    for (const ext of ['json', 'ts', 'wxml', 'wxss']) {
      assertFile(`${page}.${ext}`);
    }
  }

  if (appJson.sitemapLocation) {
    const sitemap = readJson(appJson.sitemapLocation);
    if (!Array.isArray(sitemap.rules) || sitemap.rules.length === 0) {
      fail(`${appJson.sitemapLocation} must contain a non-empty rules array.`);
    }
  } else {
    warn('app.json has no sitemapLocation; WeChat upload checks may warn about sitemap configuration.');
  }
}

function verifyProjectConfig() {
  const projectConfig = readJson('project.config.json');
  if (projectConfig.compileType !== 'miniprogram') fail('project.config.json compileType must be "miniprogram".');
  if (projectConfig.miniprogramRoot !== './') warn('project.config.json miniprogramRoot is not "./"; confirm DevTools import path manually.');

  const appid = String(process.env.WECHAT_APPID || projectConfig.appid || '').trim();
  const isPlaceholderAppId = !appid || appid === 'touristappid' || /^wx(?:0+|x+)$/i.test(appid) || appid.includes('<');
  if (requireRealAppId && isPlaceholderAppId) {
    fail('Set WECHAT_APPID or replace project.config.json appid before upload/release verification.');
  }
  if (isPlaceholderAppId) {
    warn('project.config.json still uses a placeholder appid; replace it or set WECHAT_APPID before uploading an experience/release build.');
  }
}

function main() {
  verifyAppJson();
  verifyProjectConfig();

  const productionOrigin = extractProductionOrigin();
  assertHttpsOrigin(productionOrigin);
  if (expectedOrigin && productionOrigin !== expectedOrigin) {
    fail(`PRODUCTION_SERVER_ORIGIN (${productionOrigin}) does not match PUBLIC_ORIGIN (${expectedOrigin}).`);
  }

  console.log('Mini program release readiness checks passed.');
  console.log(`PRODUCTION_SERVER_ORIGIN=${productionOrigin}`);
  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const message of warnings) console.log(`- ${message}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
