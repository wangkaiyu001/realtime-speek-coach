import { WebSocket } from 'ws';
import { AppConfig } from '../../../contracts/src/config.js';
import { WsServerFrame } from '../../../contracts/src/ws.js';
import pino from 'pino';

const logger = pino({
  name: 'doubao-asr',
  level: 'info'
});

interface AsrClient {
  sendAudio(chunk: Buffer): void;
  stop(): void;
}

interface AsrCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
}

export function createAsrClient(config: AppConfig): (callbacks: AsrCallbacks) => AsrClient {
  return (callbacks: AsrCallbacks) => {
    let ws: WebSocket | null = null;
    let mockAudioCount = 0;
    let isStopped = false;

    const handleMessage = (data: WebSocket.Data) => {
      if (typeof data === 'string') {
        try {
          const event = JSON.parse(data);
          if (event.type === 'partial_result') {
            callbacks.onPartial(event.text);
          } else if (event.type === 'final_result') {
            callbacks.onFinal(event.text);
          }
        } catch (error) {
          logger.error('Failed to parse ASR message:', error);
        }
      }
    };

    const connect = () => {
      if (config.mock) {
        logger.info('ASR running in mock mode');
        return;
      }

      if (!config.volcVoice?.wsUrl || !config.volcVoice?.apiKey) {
        throw new Error('ASR config missing: volcVoice.wsUrl and volcVoice.apiKey are required');
      }

      ws = new WebSocket(config.volcVoice.wsUrl, {
        headers: {
          'Authorization': `Bearer ${config.volcVoice.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      ws.on('open', () => {
        logger.info('ASR WebSocket connected');
        ws?.send(JSON.stringify({
          type: 'start_asr',
          config: {
            sample_rate: 16000,
            format: 'pcm',
            language: 'en'
          }
        }));
      });

      ws.on('message', handleMessage);

      ws.on('error', (error) => {
        logger.error('ASR WebSocket error:', error);
      });

      ws.on('close', (code, reason) => {
        logger.info(`ASR WebSocket closed: ${code} ${reason}`);
        if (!isStopped) {
          setTimeout(connect, 1000); // Auto-reconnect
        }
      });
    };

    connect();

    return {
      sendAudio: (chunk: Buffer) => {
        if (isStopped) return;

        if (config.mock) {
          mockAudioCount++;
          if (mockAudioCount % 5 === 0) {
            callbacks.onPartial('I would like a cup of');
          }
          if (mockAudioCount >= 15) {
            callbacks.onFinal('I would like a cup of coffee please');
            mockAudioCount = 0;
          }
          return;
        }

        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        } else {
          logger.warn('ASR WebSocket not open, dropping audio chunk');
        }
      },
      stop: () => {
        isStopped = true;
        if (ws) {
          ws.close();
        }
        logger.info('ASR client stopped');
      }
    };
  };
}
