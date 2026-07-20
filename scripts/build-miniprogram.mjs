#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'packages', 'miniprogram');
const outputRoot = path.resolve(process.env.MINIPROGRAM_BUILD_DIR || path.join(repoRoot, 'tmp', 'miniprogram-release'));

function copyAssets(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'miniprogram_npm'].includes(entry.name)) continue;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyAssets(source, target);
    } else if (!entry.name.endsWith('.ts') && !['tsconfig.json', 'package.json'].includes(entry.name)) {
      fs.copyFileSync(source, target);
    }
  }
}


fs.rmSync(outputRoot, { recursive: true, force: true });
copyAssets(sourceRoot, outputRoot);

const tscPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [
  tscPath,
  '--project', path.join(sourceRoot, 'tsconfig.json'),
  '--outDir', outputRoot,
  '--rootDir', sourceRoot,
  '--declaration', 'false',
  '--sourceMap', 'false',
  '--noEmit', 'false',
], { cwd: repoRoot, stdio: 'inherit', env: process.env });

if (result.status !== 0) process.exit(result.status || 1);

const requiredFiles = [
  'app.js',
  'app.json',
  'pages/onboarding/index.js',
  'pages/hub/index.js',
  'pages/practice/index.js',
  'pages/review/index.js',
];
for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(outputRoot, relativePath))) {
    console.error(`Mini program build missing ${relativePath}`);
    process.exit(1);
  }
}
console.log(`Mini program release build written to ${outputRoot}`);
