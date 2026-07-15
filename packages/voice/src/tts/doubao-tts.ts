import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { AppConfig } from '../../../contracts/src/config.js';
import type { Language } from '../../../contracts/src/ws.js';
import pino from 'pino';
import {
  EventReceive,
  MessageType,
  createVolcHeaders,
  parseTtsResponse,
  ttsFinishConnectionPayload,
  ttsFinishSessionPayload,
  ttsStartConnectionPayload,
  ttsStartSessionPayload,
  ttsTaskRequestPayload,
} from '../volc-protocol.js';

const logger = pino({
  name: 'doubao-tts',
  level: 'info'
});

export interface TtsSynthesisOptions {
  /** 1.0 is provider default. Lower values sound more classroom-like; higher values sound more realistic. */
  speedRatio?: number;
  /** Optional style hint for providers that support expressive speech metadata. */
  style?: 'classroom' | 'natural' | 'native_like';
}

interface TtsClient {
  synthesize(
    text: string,
    language: Language,
    onAudioChunk: (data: Buffer, isLast: boolean) => void,
    options?: TtsSynthesisOptions,
  ): Promise<void>;
}

interface PendingTtsRequest {
  sessionId: string;
  onAudioChunk: (data: Buffer, isLast: boolean) => void;
  resolveStarted: () => void;
  rejectStarted: (error: Error) => void;
  resolve: () => void;
  reject: (error: Error) => void;
}

export function createTtsClient(config: AppConfig): TtsClient {
  let ws: WebSocket | null = null;
  let connecting: Promise<WebSocket> | null = null;
  const pending = new Map<string, PendingTtsRequest>();

  async function ensureConnected(): Promise<WebSocket> {
    if (config.mocks.voice) {
      throw new Error('TTS client should not connect in mock voice mode');
    }

    if (ws?.readyState === WebSocket.OPEN) return ws;
    if (connecting) return connecting;

    if (!config.volcVoice.apiKey) {
      throw new Error('TTS config missing: VOLC_VOICE_API_KEY is required');
    }

    connecting = new Promise((resolve, reject) => {
      const connectId = randomUUID();
      const socket = new WebSocket(config.volcVoice.ttsWsUrl, {
        headers: createVolcHeaders({
          apiKey: config.volcVoice.apiKey,
          appKey: config.volcVoice.appKey,
          resourceId: config.volcVoice.ttsResourceId,
          connectId,
        }),
      });

      const failConnect = (error: Error) => {
        socket.off('open', onOpen);
        socket.off('message', onMessage);
        connecting = null;
        reject(error);
      };

      const onOpen = () => {
        logger.info({ connectId }, 'TTS WebSocket connected');
        socket.send(ttsStartConnectionPayload());
      };

      const onMessage = (data: WebSocket.RawData) => {
        try {
          const response = parseTtsResponse(toMessageBuffer(data));
          logTtsResponse(response);

          if (response.messageType === MessageType.ErrorInformation) {
            const error = new Error(`TTS protocol error ${response.errorCode ?? 'unknown'}: ${payloadMessage(response.payload)}`);
            logger.error({ err: error, errorCode: response.errorCode }, 'TTS protocol error');
            if (connecting) failConnect(error);
            rejectAllPending(error);
            return;
          }

          if (response.event === EventReceive.ConnectionStarted) {
            ws = socket;
            connecting = null;
            resolve(socket);
            return;
          }

          if (response.event === EventReceive.ConnectionFailed) {
            failConnect(new Error(`TTS connection failed: ${payloadMessage(response.payload)}`));
            return;
          }

          handleTtsMessage(response.event, response.sessionId, response.payload);
        } catch (error) {
          logger.error({ err: error }, 'Failed to parse TTS message');
        }
      };

      socket.on('open', onOpen);
      socket.on('message', onMessage);
      socket.on('error', (error) => {
        logger.error({ err: error }, 'TTS WebSocket error');
        if (!ws || socket === ws) rejectAllPending(error);
        if (connecting) failConnect(error);
      });
      socket.on('close', (code, reason) => {
        logger.info(`TTS WebSocket closed: ${code} ${reason}`);
        if (socket === ws) ws = null;
        if (connecting) failConnect(new Error(`TTS WebSocket closed before ready: ${code}`));
        rejectAllPending(new Error(`TTS WebSocket closed: ${code}`));
      });
    });

    return connecting;
  }

  function handleTtsMessage(event: number, sessionId: string, payload: Buffer | unknown) {
    const request = pending.get(sessionId);
    if (!request) {
      logger.warn({ event, sessionId: redactId(sessionId), payload: payloadSummary(payload) }, 'TTS event did not match a pending session');
      return;
    }

    if (event === EventReceive.SessionStarted) {
      logger.info({ event, sessionId: redactId(sessionId) }, 'TTS session started');
      request.resolveStarted();
      return;
    }

    if (event === EventReceive.TTSResponse) {
      if (Buffer.isBuffer(payload)) {
        logger.info({ event, sessionId: redactId(sessionId), bytes: payload.length }, 'TTS audio chunk received');
        request.onAudioChunk(payload, false);
      }
      return;
    }

    if (event === EventReceive.TTSEnded || event === EventReceive.SessionFinished) {
      logger.info({ event, sessionId: redactId(sessionId) }, 'TTS session finished');
      request.onAudioChunk(Buffer.alloc(0), true);
      pending.delete(sessionId);
      request.resolve();
      return;
    }

    if (event === EventReceive.SessionFailed || event === EventReceive.ConnectionFailed) {
      pending.delete(sessionId);
      const error = new Error(`TTS session failed: ${payloadMessage(payload)}`);
      request.rejectStarted(error);
      request.reject(error);
    }
  }

  function rejectAllPending(error: Error) {
    for (const request of pending.values()) {
      request.rejectStarted(error);
      request.reject(error);
    }
    pending.clear();
  }

  return {
    synthesize: async (text, language, onAudioChunk, options) => {
      if (config.mocks.voice) {
        logger.info('TTS running in mock mode');
        onAudioChunk(Buffer.alloc(0), true);
        return;
      }

      const socket = await ensureConnected();
      const sessionId = randomUUID();
      const sessionParams = buildTtsSessionParams(config, language, options);
      const user = { uid: 'realtime-speak-coach' };

      let done: Promise<void> | undefined;
      const started = new Promise<void>((resolveStarted, rejectStarted) => {
        done = new Promise<void>((resolve, reject) => {
          pending.set(sessionId, { sessionId, onAudioChunk, resolveStarted, rejectStarted, resolve, reject });
          logger.info({ sessionId: redactId(sessionId), language, params: sessionParamSummary(sessionParams) }, 'Starting TTS session');
          socket.send(ttsStartSessionPayload(sessionId, sessionParams, user));
        });
      });
      if (!done) {
        pending.delete(sessionId);
        throw new Error('TTS session setup failed');
      }

      try {
        await started;
        logger.info({ sessionId: redactId(sessionId), textLength: text.length }, 'Sending TTS text task');
        socket.send(ttsTaskRequestPayload(sessionId, { text }));
        logger.info({ sessionId: redactId(sessionId) }, 'Finishing TTS session input');
        socket.send(ttsFinishSessionPayload(sessionId));
        await done;
      } finally {
        pending.delete(sessionId);
      }
    }
  };
}

export async function closeTtsClient(clientSocket: WebSocket | null) {
  if (clientSocket?.readyState === WebSocket.OPEN) {
    clientSocket.send(ttsFinishConnectionPayload());
    clientSocket.close();
  }
}

function buildTtsSessionParams(config: AppConfig, language: Language, options?: TtsSynthesisOptions) {
  const speaker = language === 'ja' ? config.volcVoice.ttsVoiceJa : config.volcVoice.ttsVoiceEn;
  const shouldSendModel = speaker.startsWith('saturn_') && Boolean(config.volcVoice.ttsModel);
  const additions = {
    explicit_language: language === 'ja' ? 'ja' : 'en',
    disable_markdown_filter: true,
    ...(options?.style ? { speaking_style: options.style } : {}),
  };

  return {
    speaker,
    ...(shouldSendModel ? { model: config.volcVoice.ttsModel } : {}),
    ...(options?.speedRatio ? { speed_ratio: options.speedRatio } : {}),
    audio_params: {
      format: config.volcVoice.ttsFormat,
      sample_rate: config.volcVoice.ttsSampleRate,
    },
    additions: JSON.stringify(additions),
  };
}

function logTtsResponse(response: ReturnType<typeof parseTtsResponse>) {
  logger.info({
    event: response.event,
    eventName: EventReceive[response.event as EventReceive] ?? 'Unknown',
    messageType: response.messageType,
    serialization: response.serialization,
    sessionId: response.sessionId ? redactId(response.sessionId) : undefined,
    connectionId: response.connectionId ? redactId(response.connectionId) : undefined,
    payloadSize: response.payloadSize,
    payload: payloadSummary(response.payload),
  }, 'TTS message received');
}

function payloadSummary(payload: Buffer | unknown) {
  if (Buffer.isBuffer(payload)) return { type: 'buffer', bytes: payload.length };
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    return {
      type: 'json',
      code: record.code,
      status_code: record.status_code,
      message: record.message,
      event: record.event,
    };
  }
  return { type: typeof payload, value: typeof payload === 'string' ? payload.slice(0, 160) : payload };
}

function sessionParamSummary(params: ReturnType<typeof buildTtsSessionParams>) {
  let explicitLanguage: unknown;
  let speakingStyle: unknown;
  try {
    const additions = JSON.parse(params.additions) as { explicit_language?: unknown; speaking_style?: unknown };
    explicitLanguage = additions.explicit_language;
    speakingStyle = additions.speaking_style;
  } catch {
    explicitLanguage = undefined;
    speakingStyle = undefined;
  }

  return {
    speaker: params.speaker,
    hasModel: 'model' in params,
    format: params.audio_params.format,
    sampleRate: params.audio_params.sample_rate,
    explicitLanguage,
    speakingStyle,
    speedRatio: 'speed_ratio' in params ? params.speed_ratio : undefined,
  };
}

function redactId(id: string) {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

function payloadMessage(payload: Buffer | unknown) {
  if (Buffer.isBuffer(payload)) return payload.toString('utf8');
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function toMessageBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
