#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildConfigFromEnv } from '../../packages/voice/dist/contracts/src/config.js';
import { createAsrClient } from '../../packages/voice/dist/voice/src/asr/doubao-asr.js';

const input = process.env.INPUT;
if (!input) {
  throw new Error('Set INPUT to a 16kHz mono PCM file path');
}

const language = process.env.LANGUAGE === 'ja' ? 'ja' : 'en';
const chunkSize = Number(process.env.CHUNK_SIZE || '3200');
const timeoutMs = Number(process.env.TIMEOUT_MS || '15000');
const config = buildConfigFromEnv({ ...process.env, MOCK_VOICE: '0' });

if (!config.volcVoice.apiKey) {
  throw new Error('Missing VOLC_VOICE_API_KEY');
}

const audio = await readFile(input);

let client;
const finalText = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    client?.stop();
    reject(new Error('Timed out waiting for ASR final text'));
  }, timeoutMs);

  client = createAsrClient(config)({
    onPartial: (text) => console.log(`partial: ${text}`),
    onFinal: (text) => {
      clearTimeout(timeout);
      client?.stop();
      resolve(text);
    },
    onError: (error) => {
      clearTimeout(timeout);
      client?.stop();
      reject(error);
    },
  }, { language, uid: 'voice-smoke' });

  setTimeout(() => {
    for (let offset = 0; offset < audio.length; offset += chunkSize) {
      client.sendAudio(audio.subarray(offset, offset + chunkSize));
    }
    client.endAudio();
  }, 500);
});

console.log(`ASR smoke passed: ${finalText}`);
