#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildConfigFromEnv } from '../../packages/voice/dist/contracts/src/config.js';
import { createTtsClient } from '../../packages/voice/dist/voice/src/tts/doubao-tts.js';

const text = process.env.TEXT || 'Hello, welcome to realtime speak coach.';
const language = process.env.LANGUAGE === 'ja' ? 'ja' : 'en';
const output = resolve(process.env.OUTPUT || `/private/tmp/echoia-tts-smoke.${process.env.VOLC_TTS_FORMAT || 'mp3'}`);

const config = buildConfigFromEnv({ ...process.env, MOCK_VOICE: '0' });
const chunks = [];

if (!config.volcVoice.apiKey) {
  throw new Error('Missing VOLC_VOICE_API_KEY');
}

await createTtsClient(config).synthesize(text, language, (chunk, isLast) => {
  if (!isLast && chunk.length > 0) chunks.push(chunk);
});

const audio = Buffer.concat(chunks);
if (audio.length === 0) {
  throw new Error('TTS returned no audio bytes');
}

await writeFile(output, audio);
console.log(`TTS smoke passed: wrote ${audio.length} bytes to ${output}`);
