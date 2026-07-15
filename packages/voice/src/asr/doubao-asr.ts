import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { AppConfig } from '../../../contracts/src/config.js';
import type { Language } from '../../../contracts/src/ws.js';
import pino from 'pino';
import {
  asrAudioOnlyRequest,
  asrFullClientRequest,
  createVolcHeaders,
  parseAsrResponse,
} from '../volc-protocol.js';

const logger = pino({
  name: 'doubao-asr',
  level: 'info'
});

interface AsrClient {
  sendAudio(chunk: Buffer): void;
  endAudio(): void;
  stop(): void;
}

interface AsrCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (error: Error) => void;
}

interface AsrClientOptions {
  language?: Language;
  uid?: string;
}

export function buildVolcAsrRequest(options: AsrClientOptions = {}) {
  return buildAsrRequest(options);
}

export function createAsrClient(config: AppConfig): (callbacks: AsrCallbacks, options?: AsrClientOptions) => AsrClient {
  return (callbacks: AsrCallbacks, options: AsrClientOptions = {}) => {
    let ws: WebSocket | null = null;
    let mockAudioCount = 0;
    let isStopped = false;
    let sequence = 1;
    let lastText = '';
    let finalEmitted = false;
    let errorEmitted = false;
    const requestId = randomUUID();
    const pendingAudioFrames: Array<{ chunk: Buffer; hasMore: boolean }> = [];

    const failAsr = (error: Error) => {
      if (isStopped || errorEmitted || finalEmitted) return;
      errorEmitted = true;
      isStopped = true;
      pendingAudioFrames.length = 0;
      callbacks.onError?.(error);
      if (ws) {
        ws.close();
        ws = null;
      }
    };

    const sendAudioFrame = (chunk: Buffer, hasMore: boolean) => {
      if (isStopped || errorEmitted || finalEmitted) return;

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(asrAudioOnlyRequest(sequence++, chunk, hasMore));
        return;
      }

      pendingAudioFrames.push({ chunk, hasMore });
    };

    const flushPendingAudioFrames = () => {
      while (!isStopped && !finalEmitted && ws?.readyState === WebSocket.OPEN && pendingAudioFrames.length > 0) {
        const frame = pendingAudioFrames.shift();
        if (!frame) continue;
        ws.send(asrAudioOnlyRequest(sequence++, frame.chunk, frame.hasMore));
      }
    };

    const handleMessage = (data: WebSocket.RawData) => {
      if (isStopped || errorEmitted || finalEmitted) return;

      try {
        const response = parseAsrResponse(toMessageBuffer(data));

        if (response.code) {
          failAsr(new Error(`ASR error ${response.code}: ${safeStringify(response.message)}`));
          return;
        }

        const text = extractRecognizedText(response.message);
        if (!text) return;

        const isFinal = response.isLastPackage || Boolean(response.sequence && response.sequence < 0) || isDefiniteResult(response.message);
        if (isFinal) {
          finalEmitted = true;
          callbacks.onFinal(text);
          pendingAudioFrames.length = 0;
          if (ws) {
            ws.close();
            ws = null;
          }
        } else if (text !== lastText) {
          callbacks.onPartial(text);
        }
        lastText = text;
      } catch (error) {
        logger.error({ err: error }, 'Failed to parse ASR message');
        failAsr(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const connect = () => {
      if (config.mocks.voice) {
        logger.info('ASR running in mock mode');
        return;
      }

      if (!config.volcVoice.apiKey) {
        throw new Error('ASR config missing: VOLC_VOICE_API_KEY is required');
      }

      const connectId = randomUUID();
      ws = new WebSocket(config.volcVoice.asrWsUrl, {
        headers: createVolcHeaders({
          apiKey: config.volcVoice.apiKey,
          appKey: config.volcVoice.appKey,
          resourceId: config.volcVoice.asrResourceId,
          connectId,
        }),
      });

      ws.on('open', () => {
        logger.info({ connectId, requestId }, 'ASR WebSocket connected');
        ws?.send(asrFullClientRequest(sequence++, buildAsrRequest(options), true));
        flushPendingAudioFrames();
      });

      ws.on('message', handleMessage);

      ws.on('error', (error) => {
        logger.error({ err: error }, 'ASR WebSocket error');
        failAsr(error);
      });

      ws.on('close', (code, reason) => {
        logger.info(`ASR WebSocket closed: ${code} ${reason}`);
        ws = null;
      });
    };

    connect();

    return {
      sendAudio: (chunk: Buffer) => {
        if (isStopped || errorEmitted || finalEmitted) return;

        if (config.mocks.voice) {
          mockAudioCount++;
          if (mockAudioCount % 5 === 0) {
            callbacks.onPartial('I would like a cup of');
          }
          if (mockAudioCount >= 15) {
            finalEmitted = true;
            callbacks.onFinal('I would like a cup of coffee please');
            mockAudioCount = 0;
          }
          return;
        }

        sendAudioFrame(chunk, true);
      },
      endAudio: () => {
        if (isStopped || errorEmitted || finalEmitted) return;
        if (config.mocks.voice) return;
        sendAudioFrame(Buffer.alloc(0), false);
      },
      stop: () => {
        isStopped = true;
        pendingAudioFrames.length = 0;
        if (ws) {
          ws.close();
          ws = null;
        }
        logger.info('ASR client stopped');
      }
    };
  };
}

function toMessageBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function buildAsrRequest(options: AsrClientOptions) {
  const languageCode = options.language === 'ja' ? 'ja-JP' : 'en-US';

  return {
    user: {
      uid: options.uid || 'realtime-speak-coach',
    },
    audio: {
      format: 'pcm',
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
      language: languageCode,
    },
    request: {
      model_name: 'bigmodel',
      language: languageCode,
      language_type: languageCode,
      enable_language_detection: false,
      enable_translation: false,
      enable_itn: true,
      enable_punc: true,
      result_type: 'full',
    },
  };
}

function extractRecognizedText(message: unknown): string {
  const msg = toRecord(message);
  if (!msg) return '';

  const nestedMessage = toRecord(msg.message);
  const result = msg.result ?? nestedMessage?.result;
  const resultRecord = toRecord(result);

  const resultText = readString(resultRecord, 'text');
  if (resultText) return resultText.trim();

  if (Array.isArray(result)) {
    const firstResultText = readString(toRecord(result[0]), 'text');
    if (firstResultText) return firstResultText.trim();
  }

  const messageText = readString(msg, 'text');
  if (messageText) return messageText.trim();

  return '';
}

function isDefiniteResult(message: unknown): boolean {
  const msg = toRecord(message);
  if (!msg) return false;

  const result = toRecord(msg.result);
  const nestedMessage = toRecord(msg.message);
  const nestedResult = toRecord(nestedMessage?.result);
  const utterances = result?.utterances ?? nestedResult?.utterances;

  return Array.isArray(utterances) && utterances.some((item) => toRecord(item)?.definite === true);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
