import { gzipSync, gunzipSync } from 'node:zlib';

export const VOLC_HOST = 'openspeech.bytedance.com';

export enum MessageType {
  FullClientRequest = 0x1,
  AudioOnlyRequest = 0x2,
  FullServerResponse = 0x9,
  AudioOnlyResponse = 0xb,
  ErrorInformation = 0xf,
}

export enum MessageFlag {
  NoSequence = 0x0,
  PosSequence = 0x1,
  NegSequence = 0x2,
  NegWithSequence = 0x3,
  CarryEventId = 0x4,
}

export enum SerializationMethod {
  Raw = 0x0,
  Json = 0x1,
}

export enum CompressionMethod {
  None = 0x0,
  Gzip = 0x1,
}

export enum EventSend {
  StartConnection = 1,
  FinishConnection = 2,
  StartSession = 100,
  CancelSession = 101,
  FinishSession = 102,
  TaskRequest = 200,
}

export enum EventReceive {
  ConnectionStarted = 50,
  ConnectionFailed = 51,
  ConnectionFinished = 52,
  SessionStarted = 150,
  SessionCanceled = 151,
  SessionFinished = 152,
  SessionFailed = 153,
  TTSSentenceStart = 350,
  TTSSentenceEnd = 351,
  TTSResponse = 352,
  TTSEnded = 359,
}

export interface VolcTtsResponse {
  event: number;
  sessionId: string;
  connectionId?: string;
  payload: Buffer | unknown;
  payloadSize: number;
  errorCode?: number;
  messageType: MessageType;
  serialization: SerializationMethod;
  compression: CompressionMethod;
}

export interface VolcAsrResponse {
  sequence?: number;
  isLastPackage: boolean;
  code?: number;
  message?: unknown;
  size?: number;
  messageType: number;
}

export function makeHeader(
  messageType: MessageType,
  flag: MessageFlag,
  serialization: SerializationMethod,
  compression: CompressionMethod,
): Buffer {
  return Buffer.from([
    0x11,
    (messageType << 4) | flag,
    (serialization << 4) | compression,
    0x00,
  ]);
}

export function createVolcHeaders(config: {
  apiKey: string;
  appKey?: string;
  resourceId?: string;
  connectId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Api-Key': config.apiKey,
    'X-Api-Access-Key': config.apiKey,
    'X-Control-Require-Usage-Tokens-Return': '*',
  };

  if (config.appKey) {
    headers['X-Api-App-Key'] = config.appKey;
    headers['X-Api-App-Id'] = config.appKey;
  }
  if (config.resourceId) headers['X-Api-Resource-Id'] = config.resourceId;
  if (config.connectId) headers['X-Api-Connect-Id'] = config.connectId;

  return headers;
}

export function calculateEventPayload(
  messageType: MessageType,
  event: EventSend,
  options: { sessionId?: string; payload?: unknown; rawPayload?: Buffer } = {},
): Buffer {
  const parts: Buffer[] = [
    makeHeader(messageType, MessageFlag.CarryEventId, SerializationMethod.Json, CompressionMethod.None),
    writeUInt32(event),
  ];

  if (options.sessionId) {
    const sessionBytes = Buffer.from(options.sessionId);
    parts.push(writeUInt32(sessionBytes.length), sessionBytes);
  }

  const body = options.rawPayload ?? Buffer.from(JSON.stringify(options.payload ?? {}));
  parts.push(writeUInt32(body.length), body);

  return Buffer.concat(parts);
}

export function ttsStartConnectionPayload(): Buffer {
  return calculateEventPayload(MessageType.FullClientRequest, EventSend.StartConnection);
}

export function ttsFinishConnectionPayload(): Buffer {
  return calculateEventPayload(MessageType.FullClientRequest, EventSend.FinishConnection);
}

export function ttsStartSessionPayload(sessionId: string, reqParams: Record<string, unknown>, user?: Record<string, unknown>): Buffer {
  return calculateEventPayload(MessageType.FullClientRequest, EventSend.StartSession, {
    sessionId,
    payload: {
      event: EventSend.StartSession,
      namespace: 'BidirectionalTTS',
      req_params: reqParams,
      ...(user ? { user } : {}),
    },
  });
}

export function ttsTaskRequestPayload(sessionId: string, reqParams: Record<string, unknown>, user?: Record<string, unknown>): Buffer {
  return calculateEventPayload(MessageType.FullClientRequest, EventSend.TaskRequest, {
    sessionId,
    payload: {
      event: EventSend.TaskRequest,
      namespace: 'BidirectionalTTS',
      req_params: reqParams,
      ...(user ? { user } : {}),
    },
  });
}

export function ttsFinishSessionPayload(sessionId: string): Buffer {
  return calculateEventPayload(MessageType.FullClientRequest, EventSend.FinishSession, {
    sessionId,
    payload: {},
  });
}

export function parseTtsResponse(data: Buffer): VolcTtsResponse {
  if (data.length < 8) throw new Error('Volc TTS response is too short');

  const headerSize = data[0] & 0x0f;
  const messageType = (data[1] >> 4) as MessageType;
  const serialization = (data[2] >> 4) as SerializationMethod;
  const compression = (data[2] & 0x0f) as CompressionMethod;
  const offset = headerSize * 4;

  if (messageType === MessageType.ErrorInformation) {
    if (data.length < offset + 8) throw new Error('Volc TTS error response is too short');
    const errorCode = data.readUInt32BE(offset);
    const { payload, payloadSize } = readPayload(data, offset + 4, serialization, compression);
    return {
      event: 0,
      sessionId: '',
      payload,
      payloadSize,
      errorCode,
      messageType,
      serialization,
      compression,
    };
  }

  if (data.length < offset + 4) throw new Error('Volc TTS event response is too short');
  const event = data.readUInt32BE(offset);
  const idOffset = offset + 4;

  const hasConnectionId = event === EventReceive.ConnectionStarted
    || event === EventReceive.ConnectionFailed
    || event === EventReceive.ConnectionFinished;
  const { id, nextOffset } = readLengthPrefixedString(data, idOffset, hasConnectionId ? 'connection' : 'session');
  const { payload, payloadSize } = readPayload(data, nextOffset, serialization, compression);

  return {
    event,
    sessionId: hasConnectionId ? '' : id,
    ...(hasConnectionId ? { connectionId: id } : {}),
    payload,
    payloadSize,
    messageType,
    serialization,
    compression,
  };
}

function readLengthPrefixedString(data: Buffer, offset: number, label: string) {
  if (data.length < offset + 4) throw new Error(`Volc TTS response missing ${label} id length`);
  const length = data.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + length;
  if (data.length < end) throw new Error(`Volc TTS response truncated ${label} id`);
  return { id: data.subarray(start, end).toString(), nextOffset: end };
}

function readPayload(
  data: Buffer,
  offset: number,
  serialization: SerializationMethod,
  compression: CompressionMethod,
) {
  if (data.length < offset + 4) return { payload: Buffer.alloc(0), payloadSize: 0 };
  const payloadSize = data.readUInt32BE(offset);
  const payloadStart = offset + 4;
  const payloadEnd = payloadStart + payloadSize;
  if (data.length < payloadEnd) throw new Error('Volc TTS response truncated payload');

  let payloadBuffer = data.subarray(payloadStart, payloadEnd);
  if (payloadBuffer.length > 0 && compression === CompressionMethod.Gzip) {
    payloadBuffer = gunzipSync(payloadBuffer);
  }

  let payload: Buffer | unknown = payloadBuffer;
  if (payloadBuffer.length > 0 && serialization === SerializationMethod.Json) {
    try {
      payload = JSON.parse(payloadBuffer.toString('utf8'));
    } catch {
      payload = payloadBuffer;
    }
  }

  return { payload, payloadSize };
}

export function asrFullClientRequest(sequence: number, requestParams: unknown, compression = true): Buffer {
  let payload = Buffer.from(JSON.stringify(requestParams));
  const compressionMethod = compression ? CompressionMethod.Gzip : CompressionMethod.None;
  if (compression) payload = gzipSync(payload);

  return Buffer.concat([
    makeHeader(MessageType.FullClientRequest, MessageFlag.PosSequence, SerializationMethod.Json, compressionMethod),
    writeInt32(sequence),
    writeUInt32(payload.length),
    payload,
  ]);
}

export function asrAudioOnlyRequest(sequence: number, audio: Buffer, compress = true): Buffer {
  let seq = sequence;
  let payload = audio;
  let compressionMethod = CompressionMethod.None;

  if (!audio.length && sequence > 0) {
    seq = -sequence;
    compress = false;
  }

  if (compress) {
    payload = gzipSync(audio);
    compressionMethod = CompressionMethod.Gzip;
  }

  return Buffer.concat([
    makeHeader(
      MessageType.AudioOnlyRequest,
      seq > 0 ? MessageFlag.PosSequence : MessageFlag.NegWithSequence,
      SerializationMethod.Raw,
      compressionMethod,
    ),
    writeInt32(seq),
    writeUInt32(payload.length),
    payload,
  ]);
}

export function parseAsrResponse(data: Buffer): VolcAsrResponse {
  if (data.length < 4) throw new Error('Volc ASR response is too short');

  const headerSize = data[0] & 0x0f;
  const offset = headerSize * 4;
  if (headerSize < 1 || data.length < offset) throw new Error('Volc ASR response has invalid header size');

  const messageType = data[1] >> 4;
  const flags = data[1] & 0x0f;
  const serialization = data[2] >> 4;
  const compression = data[2] & 0x0f;
  let payload = data.subarray(offset);

  const result: VolcAsrResponse = {
    isLastPackage: Boolean(flags & 0x02),
    messageType,
  };

  if (flags & 0x01) {
    ensureAsrPayloadLength(payload, 4, 'sequence');
    result.sequence = payload.readInt32BE(0);
    payload = payload.subarray(4);
  }

  let payloadSize = 0;
  let payloadMessage: Buffer | undefined;

  if (messageType === MessageType.FullServerResponse) {
    ensureAsrPayloadLength(payload, 4, 'full server payload size');
    payloadSize = payload.readUInt32BE(0);
    payloadMessage = readAsrPayloadMessage(payload, 4, payloadSize);
  } else if (messageType === MessageType.AudioOnlyResponse) {
    ensureAsrPayloadLength(payload, 8, 'audio response sequence and payload size');
    result.sequence = payload.readInt32BE(0);
    payloadSize = payload.readUInt32BE(4);
    payloadMessage = readAsrPayloadMessage(payload, 8, payloadSize);
  } else if (messageType === MessageType.ErrorInformation) {
    ensureAsrPayloadLength(payload, 8, 'error code and payload size');
    result.code = payload.readUInt32BE(0);
    payloadSize = payload.readUInt32BE(4);
    payloadMessage = readAsrPayloadMessage(payload, 8, payloadSize);
  }

  if (!payloadMessage) return result;
  if (compression === CompressionMethod.Gzip) payloadMessage = gunzipSync(payloadMessage);

  result.size = payloadSize;
  if (serialization === SerializationMethod.Json) {
    result.message = JSON.parse(payloadMessage.toString('utf8'));
  } else {
    result.message = payloadMessage;
  }

  return result;
}

function ensureAsrPayloadLength(payload: Buffer, requiredLength: number, label: string) {
  if (payload.length < requiredLength) throw new Error(`Volc ASR response missing ${label}`);
}

function readAsrPayloadMessage(payload: Buffer, messageOffset: number, payloadSize: number) {
  const payloadEnd = messageOffset + payloadSize;
  if (payload.length < payloadEnd) throw new Error('Volc ASR response truncated payload');
  return payload.subarray(messageOffset, payloadEnd);
}

function writeUInt32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function writeInt32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}
