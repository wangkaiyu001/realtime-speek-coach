// ============================================================
// WebSocket Frame Protocol - Realtime Speak Coach
// ============================================================

/** Language supported by the system */
export type Language = 'en' | 'ja';

/** Difficulty level aligned to IELTS / JSST bands */
export type ProficiencyLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// ─── Client → Server Frames ─────────────────────────────────

export interface WsClientHello {
  type: 'hello';
  sessionId: string;
  scenarioId: string;
  language: Language;
}

export interface WsClientAudioChunk {
  type: 'audio_chunk';
  /** Base64-encoded PCM 16kHz 16bit mono */
  data: string;
  seq: number;
}

export interface WsClientAudioEnd {
  type: 'audio_end';
  turnIndex: number;
}

export interface WsClientHeartbeat {
  type: 'heartbeat';
  ts: number;
}

export interface WsClientAbort {
  type: 'abort';
  reason: 'user_exit' | 'error';
}

export type WsClientFrame =
  | WsClientHello
  | WsClientAudioChunk
  | WsClientAudioEnd
  | WsClientHeartbeat
  | WsClientAbort;

// ─── Server → Client Frames ─────────────────────────────────

export interface WsServerReady {
  type: 'ready';
  sessionId: string;
  totalTurns: number;
}

export interface WsServerAsrPartial {
  type: 'asr_partial';
  text: string;
}

export interface WsServerAsrFinal {
  type: 'asr_final';
  text: string;
  turnIndex: number;
}

export interface WsServerLlmDelta {
  type: 'llm_delta';
  text: string;
  /** Accumulated full text so far */
  accumulated: string;
}

export interface WsServerTtsChunk {
  type: 'tts_chunk';
  /** Base64-encoded audio data (MP3 or PCM depending on config) */
  data: string;
  seq: number;
  isLast: boolean;
}

export interface WsServerTurnEnd {
  type: 'turn_end';
  turnIndex: number;
  totalTurns: number;
  /** When turnIndex === totalTurns, session is complete */
  sessionComplete: boolean;
}

export interface WsServerError {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
}

export interface WsServerHeartbeatAck {
  type: 'heartbeat_ack';
  ts: number;
}

export type WsServerFrame =
  | WsServerReady
  | WsServerAsrPartial
  | WsServerAsrFinal
  | WsServerLlmDelta
  | WsServerTtsChunk
  | WsServerTurnEnd
  | WsServerError
  | WsServerHeartbeatAck;

// ─── Session State Machine ───────────────────────────────────

export type TurnState = 'idle' | 'recording' | 'processing_asr' | 'thinking' | 'speaking';

export interface SessionState {
  sessionId: string;
  scenarioId: string;
  language: Language;
  level: ProficiencyLevel;
  currentTurn: number;
  totalTurns: number;
  turnState: TurnState;
}
