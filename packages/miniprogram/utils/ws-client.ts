// utils/ws-client.ts
// WebSocket client with auto-reconnect and heartbeat

import { globalData } from '../app';

/** Frames sent from client to server */
interface ClientFrame {
  type: string;
  [key: string]: unknown;
}

/** Frames received from server */
export interface ServerFrame {
  type: string;
  [key: string]: unknown;
}

type EventPayloadMap = {
  ready: ServerFrame;
  asr_partial: ServerFrame;
  asr_final: ServerFrame;
  llm_delta: ServerFrame;
  tts_chunk: ServerFrame;
  turn_end: ServerFrame;
  error: ServerFrame | Error | WechatMiniprogram.GeneralCallbackResult;
  close: WechatMiniprogram.SocketTaskOnCloseListenerResult;
  open: undefined;
  heartbeat_ack: ServerFrame;
};

interface WsClientOptions {
  url: string;
  token: string;
  maxRetries?: number;
  heartbeatInterval?: number;
}

type EventType = keyof EventPayloadMap;
type EventPayload = EventPayloadMap[EventType];
type EventListener = (data: EventPayload) => void;

class WsClient {
  private url: string;
  private token: string;
  private socket: WechatMiniprogram.SocketTask | null = null;
  private retries = 0;
  private maxRetries: number;
  private heartbeatInterval: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private eventListeners: Record<EventType, EventListener[]> = {
    ready: [],
    asr_partial: [],
    asr_final: [],
    llm_delta: [],
    tts_chunk: [],
    turn_end: [],
    error: [],
    close: [],
    open: [],
    heartbeat_ack: [],
  };

  constructor(options: WsClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.maxRetries = options.maxRetries || 3;
    this.heartbeatInterval = options.heartbeatInterval || 15000;
  }

  connect() {
    if (this.socket) {
      this.socket.close({});
    }

    this.socket = wx.connectSocket({
      url: `${this.url}?token=${this.token}`,
    });

    this.socket.onOpen(() => {
      console.log('WebSocket connected');
      this.retries = 0;
      this.startHeartbeat();
      this.emit('open', undefined);
    });

    this.socket.onMessage((res) => {
      try {
        const raw = typeof res.data === 'string' ? res.data : '';
        const frame = JSON.parse(raw) as ServerFrame;
        switch (frame.type) {
          case 'ready':
          case 'asr_partial':
          case 'asr_final':
          case 'llm_delta':
          case 'tts_chunk':
          case 'turn_end':
          case 'error':
          case 'heartbeat_ack':
            this.emit(frame.type, frame);
            break;
          default:
            console.warn('Unknown frame type:', frame.type);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    });

    this.socket.onClose((res) => {
      console.log('WebSocket closed:', res);
      this.stopHeartbeat();
      this.emit('close', res);

      if (this.retries < this.maxRetries) {
        this.retries++;
        const delay = Math.min(1000 * this.retries, 5000);
        console.log(`Reconnecting in ${delay}ms (attempt ${this.retries}/${this.maxRetries})`);
        setTimeout(() => this.connect(), delay);
      } else {
        console.error('Max retries reached. Could not reconnect.');
      }
    });

    this.socket.onError((err) => {
      console.error('WebSocket error:', err);
      this.emit('error', err);
    });
  }

  send(frame: ClientFrame) {
    if (!this.socket) {
      throw new Error('WebSocket not connected');
    }
    this.socket.send({ data: JSON.stringify(frame) });
  }

  close() {
    if (this.socket) {
      this.socket.close({});
      this.socket = null;
    }
    this.stopHeartbeat();
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket) {
        this.send({ type: 'heartbeat', ts: Date.now() });
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  on(event: EventType, listener: EventListener) {
    this.eventListeners[event].push(listener);
  }

  off(event: EventType, listener: EventListener) {
    this.eventListeners[event] = this.eventListeners[event].filter(l => l !== listener);
  }

  private emit<T extends EventType>(event: T, data: EventPayloadMap[T]) {
    this.eventListeners[event].forEach(listener => listener(data));
  }
}

export function createWsClient(url: string, token: string) {
  return new WsClient({ url, token });
}
