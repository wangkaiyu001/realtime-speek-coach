#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ci from 'miniprogram-ci';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const miniRoot = path.join(repoRoot, 'packages', 'miniprogram');
const projectConfigPath = path.join(miniRoot, 'project.config.json');
const packageJsonPath = path.join(repoRoot, 'package.json');
const publicOrigin = 'https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com';
const command = process.argv[2] || 'upload';
const allowedCommands = new Set(['upload', 'preview']);

const tempFiles = [];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing required environment variable: ${name}`);
  return value;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Failed to read ${path.relative(repoRoot, filePath)}: ${error.message}`);
  }
}

function resolveVersion() {
  const explicit = process.env.WECHAT_UPLOAD_VERSION?.trim();
  if (explicit) return explicit;

  const rootPackage = readJson(packageJsonPath);
  if (typeof rootPackage.version === 'string' && rootPackage.version.trim()) {
    return rootPackage.version.trim();
  }

  const miniPackage = readJson(path.join(miniRoot, 'package.json'));
  return typeof miniPackage.version === 'string' && miniPackage.version.trim() ? miniPackage.version.trim() : '0.1.0';
}

function resolveRobot() {
  const raw = process.env.WECHAT_ROBOT?.trim() || '1';
  const robot = Number.parseInt(raw, 10);
  if (!Number.isInteger(robot) || robot < 1 || robot > 30) {
    fail('WECHAT_ROBOT must be an integer between 1 and 30.');
  }
  return robot;
}

function resolvePrivateKeyOptions() {
  const privateKeyPath = process.env.WECHAT_PRIVATE_KEY_PATH?.trim();
  const privateKey = process.env.WECHAT_PRIVATE_KEY?.trim();

  if (privateKeyPath && privateKey) {
    fail('Set only one of WECHAT_PRIVATE_KEY_PATH or WECHAT_PRIVATE_KEY, not both.');
  }

  if (privateKeyPath) {
    const absolutePath = path.resolve(privateKeyPath);
    if (!fs.existsSync(absolutePath)) fail(`WECHAT_PRIVATE_KEY_PATH does not exist: ${absolutePath}`);
    return { privateKeyPath: absolutePath };
  }

  if (privateKey) {
    const normalized = privateKey.includes('\\n') ? privateKey.replaceAll('\\n', '\n') : privateKey;
    if (!normalized.includes('BEGIN') || !normalized.includes('PRIVATE KEY')) {
      fail('WECHAT_PRIVATE_KEY does not look like a PEM private key.');
    }

    const tempPath = path.join(os.tmpdir(), `echoia-wechat-upload-${process.pid}.key`);
    fs.writeFileSync(tempPath, normalized, { mode: 0o600 });
    tempFiles.push(tempPath);
    return { privateKeyPath: tempPath };
  }

  fail('Missing upload private key. Set WECHAT_PRIVATE_KEY_PATH=/absolute/path/private.key or WECHAT_PRIVATE_KEY.');
}

function cleanup() {
  for (const filePath of tempFiles) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function runMiniProgramGate(appid) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'verify-miniprogram-release.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      WECHAT_APPID: appid,
      VERIFY_REQUIRE_WECHAT_APPID: '1',
      PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN?.trim() || publicOrigin,
    },
  });

  if (result.status !== 0) {
    fail('Mini program release gate failed; aborting upload/preview.');
  }
}

function createProject(appid, privateKeyOptions) {
  if (!fs.existsSync(projectConfigPath)) {
    fail(`Missing ${path.relative(repoRoot, projectConfigPath)}`);
  }

  return new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath: miniRoot,
    ignores: [
      'node_modules/**/*',
      'miniprogram_npm/**/*',
      '.git/**/*',
      '.DS_Store',
      '*.pem',
      '*.key',
      'project.private.config.json',
    ],
    ...privateKeyOptions,
  });
}

function compileSetting() {
  return {
    es6: true,
    es7: true,
    minify: true,
    minifyJS: true,
    minifyWXML: true,
    minifyWXSS: true,
    autoPrefixWXSS: true,
  };
}

function progressLogger(task) {
  if (typeof task === 'string') {
    console.log(task);
    return;
  }

  const status = task.status ? `[${task.status}]` : '';
  const message = task.message || task.id || '';
  if (message) console.log(`${status} ${message}`.trim());
}

async function main() {
  if (!allowedCommands.has(command)) fail('Usage: node scripts/upload-miniprogram.mjs <upload|preview>');

  const appid = requireEnv('WECHAT_APPID');
  const privateKeyOptions = resolvePrivateKeyOptions();
  const project = createProject(appid, privateKeyOptions);
  const version = resolveVersion();
  const desc = process.env.WECHAT_UPLOAD_DESC?.trim() || `Echoia public trial ${new Date().toISOString()}`;
  const robot = resolveRobot();
  const setting = compileSetting();

  runMiniProgramGate(appid);

  if (command === 'preview') {
    const qrcodeOutputDest = path.resolve(
      process.env.WECHAT_QR_OUTPUT?.trim() || path.join(repoRoot, 'tmp', 'wechat-preview-qrcode.jpg'),
    );
    fs.mkdirSync(path.dirname(qrcodeOutputDest), { recursive: true });

    console.log(`Creating WeChat preview QR code for ${appid}...`);
    await ci.preview({
      project,
      desc,
      setting,
      robot,
      qrcodeFormat: 'image',
      qrcodeOutputDest,
      onProgressUpdate: progressLogger,
    });
    console.log(`Preview QR code written to ${qrcodeOutputDest}`);
    return;
  }

  console.log(`Uploading WeChat mini program ${appid} version ${version} with robot ${robot}...`);
  const result = await ci.upload({
    project,
    version,
    desc,
    setting,
    robot,
    onProgressUpdate: progressLogger,
  });

  console.log('WeChat mini program upload completed.');
  if (result && Object.keys(result).length > 0) {
    console.log(JSON.stringify(result, null, 2));
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

main().catch((error) => {
  cleanup();
  console.error(error?.message || error);
  process.exit(1);
});
