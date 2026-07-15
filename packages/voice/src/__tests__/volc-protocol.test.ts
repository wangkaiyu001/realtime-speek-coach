import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  CompressionMethod,
  EventReceive,
  EventSend,
  MessageFlag,
  MessageType,
  SerializationMethod,
  asrAudioOnlyRequest,
  asrFullClientRequest,
  makeHeader,
  parseAsrResponse,
  parseTtsResponse,
  ttsStartConnectionPayload,
  ttsStartSessionPayload,
  ttsTaskRequestPayload,
} from '../volc-protocol.js';

vi.mock('ws', () => ({
  WebSocket: MockWebSocket,
}));

const sockets: MockWebSocket[] = [];

class MockWebSocket extends EventEmitter {
  static OPEN = 1;

  readyState = 0;
  sent: Buffer[] = [];

  constructor(public url: string, public options?: unknown) {
    super();
    sockets.push(this);
  }

  send(data: Buffer) {
    this.sent.push(Buffer.from(data));
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  close() {
    this.readyState = 3;
    this.emit('close', 1000, Buffer.alloc(0));
  }
}

afterEach(() => {
  sockets.length = 0;
  vi.resetModules();
});

describe('Volcengine binary protocol helpers', () => {
  it('builds a gzip-compressed ASR full client request with sequence', () => {
    const request = { user: { uid: 'u1' }, audio: { format: 'pcm' } };
    const frame = asrFullClientRequest(7, request, true);

    expect([...frame.subarray(0, 4)]).toEqual([
      0x11,
      (MessageType.FullClientRequest << 4) | MessageFlag.PosSequence,
      (SerializationMethod.Json << 4) | CompressionMethod.Gzip,
      0x00,
    ]);
    expect(frame.readInt32BE(4)).toBe(7);

    const payloadSize = frame.readUInt32BE(8);
    const payload = gunzipSync(frame.subarray(12, 12 + payloadSize));
    expect(JSON.parse(payload.toString('utf8'))).toEqual(request);
  });

  it('marks an empty ASR audio frame as the last negative-sequence package', () => {
    const frame = asrAudioOnlyRequest(8, Buffer.alloc(0), false);

    expect(frame[1]).toBe((MessageType.AudioOnlyRequest << 4) | MessageFlag.NegWithSequence);
    expect(frame[2]).toBe((SerializationMethod.Raw << 4) | CompressionMethod.None);
    expect(frame.readInt32BE(4)).toBe(-8);
    expect(frame.readUInt32BE(8)).toBe(0);
  });

  it('parses a gzip-compressed ASR server acknowledgement', () => {
    const message = { result: { text: 'hello world' } };
    const payload = Buffer.from(JSON.stringify(message));
    const compressed = gzipSync(payload);
    const frame = Buffer.concat([
      makeHeader(MessageType.AudioOnlyResponse, MessageFlag.NoSequence, SerializationMethod.Json, CompressionMethod.Gzip),
      int32(4),
      uint32(compressed.length),
      compressed,
    ]);

    const parsed = parseAsrResponse(frame);
    expect(parsed.sequence).toBe(4);
    expect(parsed.isLastPackage).toBe(false);
    expect(parsed.size).toBe(compressed.length);
    expect(parsed.message).toEqual(message);
  });

  it('rejects truncated ASR payloads with protocol errors', () => {
    const frame = Buffer.concat([
      makeHeader(MessageType.AudioOnlyResponse, MessageFlag.NoSequence, SerializationMethod.Json, CompressionMethod.Gzip),
      int32(4),
      uint32(10),
      Buffer.from([1, 2, 3]),
    ]);

    expect(() => parseAsrResponse(frame)).toThrow('Volc ASR response truncated payload');
  });

  it('builds TTS start connection and session event payloads', () => {
    const startConnection = ttsStartConnectionPayload();
    expect([...startConnection.subarray(0, 4)]).toEqual([
      0x11,
      (MessageType.FullClientRequest << 4) | MessageFlag.CarryEventId,
      (SerializationMethod.Json << 4) | CompressionMethod.None,
      0x00,
    ]);
    expect(startConnection.readUInt32BE(4)).toBe(EventSend.StartConnection);

    const sessionFrame = ttsStartSessionPayload('session-1', {
      text: 'Hello',
      speaker: 'voice',
      audio_params: { format: 'mp3', sample_rate: 24000 },
    }, { uid: 'u1' });

    expect(sessionFrame.readUInt32BE(4)).toBe(EventSend.StartSession);
    const sessionLength = sessionFrame.readUInt32BE(8);
    expect(sessionFrame.subarray(12, 12 + sessionLength).toString()).toBe('session-1');

    const payloadOffset = 12 + sessionLength;
    const payloadLength = sessionFrame.readUInt32BE(payloadOffset);
    const payload = JSON.parse(sessionFrame.subarray(payloadOffset + 4, payloadOffset + 4 + payloadLength).toString('utf8'));
    expect(payload).toMatchObject({
      event: EventSend.StartSession,
      namespace: 'BidirectionalTTS',
      user: { uid: 'u1' },
      req_params: { text: 'Hello', speaker: 'voice' },
    });
  });

  it('builds TTS task request event payloads', () => {
    const taskFrame = ttsTaskRequestPayload('session-1', {
      text: 'Hello',
    });

    expect(taskFrame.readUInt32BE(4)).toBe(EventSend.TaskRequest);
    const sessionLength = taskFrame.readUInt32BE(8);
    expect(taskFrame.subarray(12, 12 + sessionLength).toString()).toBe('session-1');

    const payloadOffset = 12 + sessionLength;
    const payloadLength = taskFrame.readUInt32BE(payloadOffset);
    const payload = JSON.parse(taskFrame.subarray(payloadOffset + 4, payloadOffset + 4 + payloadLength).toString('utf8'));
    expect(payload).toMatchObject({
      event: EventSend.TaskRequest,
      namespace: 'BidirectionalTTS',
      req_params: { text: 'Hello' },
    });
    expect(payload.user).toBeUndefined();
  });

  it('sends TTS additions as a JSON string accepted by Volcengine', async () => {
    const { createTtsClient } = await import('../tts/doubao-tts.js');
    const audioChunks: Buffer[] = [];
    const client = createTtsClient({
      mocks: { voice: false },
      volcVoice: {
        apiKey: 'test-api-key',
        appKey: 'test-app-key',
        ttsWsUrl: 'wss://tts.example.test',
        ttsResourceId: 'tts-resource',
        ttsVoiceEn: 'en_female_amanda_mars_bigtts',
        ttsVoiceJa: 'jp_female_mai_mars_bigtts',
        ttsModel: 'seed-tts-1.1',
        ttsFormat: 'mp3',
        ttsSampleRate: 24000,
      },
    } as unknown as Parameters<typeof createTtsClient>[0]);

    const synthesize = client.synthesize('Hello there', 'en', (chunk) => audioChunks.push(chunk), {
      speedRatio: 1.16,
      style: 'native_like',
    });
    const socket = sockets[0];
    socket.open();
    socket.emit('message', ttsServerFrame(EventReceive.ConnectionStarted, 'connection-1', Buffer.from('{}'), SerializationMethod.Json));
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(1));

    const startSessionFrame = socket.sent[1];
    const sessionLength = startSessionFrame.readUInt32BE(8);
    const payloadOffset = 12 + sessionLength;
    const payloadLength = startSessionFrame.readUInt32BE(payloadOffset);
    const payload = JSON.parse(startSessionFrame.subarray(payloadOffset + 4, payloadOffset + 4 + payloadLength).toString('utf8'));

    expect(typeof payload.req_params.additions).toBe('string');
    expect(JSON.parse(payload.req_params.additions)).toEqual({
      explicit_language: 'en',
      disable_markdown_filter: true,
      speaking_style: 'native_like',
    });
    expect(payload.req_params.speed_ratio).toBe(1.16);

    const sessionId = startSessionFrame.subarray(12, 12 + sessionLength).toString();
    socket.emit('message', ttsServerFrame(EventReceive.SessionStarted, sessionId, Buffer.from('{}'), SerializationMethod.Json));
    socket.emit('message', ttsServerFrame(EventReceive.TTSResponse, sessionId, Buffer.from([1, 2, 3]), SerializationMethod.Raw));
    socket.emit('message', ttsServerFrame(EventReceive.SessionFinished, sessionId, Buffer.from('{}'), SerializationMethod.Json));

    await synthesize;
    expect(audioChunks.some((chunk) => chunk.length > 0)).toBe(true);
  });

  it('parses raw TTS audio response payloads', () => {
    const audio = Buffer.from([1, 2, 3, 4]);
    const frame = ttsServerFrame(EventReceive.TTSResponse, 'session-1', audio, SerializationMethod.Raw);

    const parsed = parseTtsResponse(frame);
    expect(parsed.event).toBe(EventReceive.TTSResponse);
    expect(parsed.sessionId).toBe('session-1');
    expect(Buffer.isBuffer(parsed.payload)).toBe(true);
    expect(parsed.payload).toEqual(audio);
  });

  it('parses TTS connection lifecycle payloads with connection id', () => {
    const payload = { status_code: 0, message: 'ok' };
    const frame = ttsServerFrame(
      EventReceive.ConnectionStarted,
      'connection-1',
      Buffer.from(JSON.stringify(payload)),
      SerializationMethod.Json,
    );

    const parsed = parseTtsResponse(frame);
    expect(parsed.event).toBe(EventReceive.ConnectionStarted);
    expect(parsed.sessionId).toBe('');
    expect(parsed.connectionId).toBe('connection-1');
    expect(parsed.payloadSize).toBeGreaterThan(0);
    expect(parsed.payload).toEqual(payload);
  });

  it('parses TTS protocol error frames', () => {
    const payload = { message: 'bad request' };
    const body = Buffer.from(JSON.stringify(payload));
    const frame = Buffer.concat([
      makeHeader(MessageType.ErrorInformation, MessageFlag.NoSequence, SerializationMethod.Json, CompressionMethod.None),
      uint32(400),
      uint32(body.length),
      body,
    ]);

    const parsed = parseTtsResponse(frame);
    expect(parsed.messageType).toBe(MessageType.ErrorInformation);
    expect(parsed.event).toBe(0);
    expect(parsed.errorCode).toBe(400);
    expect(parsed.sessionId).toBe('');
    expect(parsed.payload).toEqual(payload);
  });

  it('parses JSON TTS lifecycle payloads', () => {
    const payload = { status_code: 0, message: 'ok' };
    const frame = ttsServerFrame(
      EventReceive.SessionFinished,
      'session-1',
      Buffer.from(JSON.stringify(payload)),
      SerializationMethod.Json,
    );

    const parsed = parseTtsResponse(frame);
    expect(parsed.event).toBe(EventReceive.SessionFinished);
    expect(parsed.payload).toEqual(payload);
  });

  it('buffers ASR audio that arrives before the WebSocket is open', async () => {
    const { createAsrClient } = await import('../asr/doubao-asr.js');
    const clientFactory = createAsrClient({
      mocks: { voice: false },
      volcVoice: {
        apiKey: 'test-api-key',
        appKey: 'test-app-key',
        asrWsUrl: 'wss://asr.example.test',
        asrResourceId: 'asr-resource',
      },
    } as unknown as Parameters<typeof createAsrClient>[0]);

    const client = clientFactory({
      onPartial: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
    });

    client.sendAudio(Buffer.from([1, 2, 3]));
    client.endAudio();

    const socket = sockets[0];
    expect(socket.sent).toHaveLength(0);

    socket.open();

    expect(socket.sent).toHaveLength(3);
    expect(socket.sent[0][1]).toBe((MessageType.FullClientRequest << 4) | MessageFlag.PosSequence);
    expect(socket.sent[1][1]).toBe((MessageType.AudioOnlyRequest << 4) | MessageFlag.PosSequence);
    expect(socket.sent[1].readInt32BE(4)).toBe(2);
    expect(socket.sent[2][1]).toBe((MessageType.AudioOnlyRequest << 4) | MessageFlag.NegWithSequence);
    expect(socket.sent[2].readInt32BE(4)).toBe(-3);

    client.stop();
  });

  it('locks ASR request language for English and disables translation', async () => {
    const { buildVolcAsrRequest } = await import('../asr/doubao-asr.js');

    expect(buildVolcAsrRequest({ language: 'en', uid: 'u1' })).toMatchObject({
      user: { uid: 'u1' },
      audio: {
        format: 'pcm',
        codec: 'raw',
        rate: 16000,
        bits: 16,
        channel: 1,
        language: 'en-US',
      },
      request: {
        language: 'en-US',
        language_type: 'en-US',
        enable_language_detection: false,
        enable_translation: false,
        result_type: 'full',
      },
    });
  });

  it('locks ASR request language for Japanese and disables translation', async () => {
    const { buildVolcAsrRequest } = await import('../asr/doubao-asr.js');

    expect(buildVolcAsrRequest({ language: 'ja', uid: 'u1' })).toMatchObject({
      user: { uid: 'u1' },
      audio: {
        language: 'ja-JP',
      },
      request: {
        language: 'ja-JP',
        language_type: 'ja-JP',
        enable_language_detection: false,
        enable_translation: false,
      },
    });
  });

  it('emits only one ASR final result and ignores late provider messages', async () => {
    const { createAsrClient } = await import('../asr/doubao-asr.js');
    const onFinal = vi.fn();
    const onPartial = vi.fn();
    const clientFactory = createAsrClient({
      mocks: { voice: false },
      volcVoice: {
        apiKey: 'test-api-key',
        appKey: 'test-app-key',
        asrWsUrl: 'wss://asr.example.test',
        asrResourceId: 'asr-resource',
      },
    } as unknown as Parameters<typeof createAsrClient>[0]);

    const client = clientFactory({
      onPartial,
      onFinal,
      onError: vi.fn(),
    });

    const socket = sockets[0];
    socket.open();
    socket.emit('message', asrServerFrame({ result: { text: 'hello' } }, 1));
    socket.emit('message', asrServerFrame({ result: { text: 'hello world', utterances: [{ definite: true }] } }, -2));
    socket.emit('message', asrServerFrame({ result: { text: 'late duplicate', utterances: [{ definite: true }] } }, -3));

    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('hello world');

    client.sendAudio(Buffer.from([9, 9]));
    expect(socket.sent).toHaveLength(1);

    client.stop();
  });

  it('emits only one ASR provider error and closes the socket', async () => {
    const { createAsrClient } = await import('../asr/doubao-asr.js');
    const onError = vi.fn();
    const clientFactory = createAsrClient({
      mocks: { voice: false },
      volcVoice: {
        apiKey: 'test-api-key',
        appKey: 'test-app-key',
        asrWsUrl: 'wss://asr.example.test',
        asrResourceId: 'asr-resource',
      },
    } as unknown as Parameters<typeof createAsrClient>[0]);

    const client = clientFactory({
      onPartial: vi.fn(),
      onFinal: vi.fn(),
      onError,
    });

    const socket = sockets[0];
    socket.open();
    socket.emit('message', asrErrorFrame({ message: 'bad request' }, 400));
    socket.emit('message', asrErrorFrame({ message: 'still bad' }, 500));
    client.sendAudio(Buffer.from([9, 9]));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('ASR error 400');
    expect(socket.readyState).toBe(3);
    expect(socket.sent).toHaveLength(1);
  });
});

function asrServerFrame(message: unknown, sequence: number) {
  const payload = gzipSync(Buffer.from(JSON.stringify(message)));
  return Buffer.concat([
    makeHeader(MessageType.AudioOnlyResponse, sequence < 0 ? MessageFlag.NegSequence : MessageFlag.NoSequence, SerializationMethod.Json, CompressionMethod.Gzip),
    int32(sequence),
    uint32(payload.length),
    payload,
  ]);
}

function asrErrorFrame(message: unknown, code: number) {
  const payload = Buffer.from(JSON.stringify(message));
  return Buffer.concat([
    makeHeader(MessageType.ErrorInformation, MessageFlag.NoSequence, SerializationMethod.Json, CompressionMethod.None),
    uint32(code),
    uint32(payload.length),
    payload,
  ]);
}

function ttsServerFrame(event: EventReceive, sessionId: string, payload: Buffer, serialization: SerializationMethod) {
  const session = Buffer.from(sessionId);
  return Buffer.concat([
    makeHeader(MessageType.AudioOnlyResponse, MessageFlag.CarryEventId, serialization, CompressionMethod.None),
    uint32(event),
    uint32(session.length),
    session,
    uint32(payload.length),
    payload,
  ]);
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function int32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}
