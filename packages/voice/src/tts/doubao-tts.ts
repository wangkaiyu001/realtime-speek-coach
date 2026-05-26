import { WebSocket } from 'ws';
import { AppConfig } from '../../../contracts/src/config.js';
import pino from 'pino';

const logger = pino({
  name: 'doubao-tts',
  level: 'info'
});

interface TtsClient {
  synthesize(
    text: string,
    language: 'en' | 'ja',
    onAudioChunk: (data: Buffer, isLast: boolean) => void
  ): Promise<void>;
}

export function createTtsClient(config: AppConfig): TtsClient {
  let ws: WebSocket | null = null;
  let currentRequestId = 0;

  const connect = () => {
    if (config.mock) return;

    if (!config.volcVoice?.wsUrl || !config.volcVoice?.apiKey) {
      throw new Error('TTS config missing: volcVoice.wsUrl and volcVoice.apiKey are required');
    }

    ws = new WebSocket(config.volcVoice.wsUrl, {
      headers: {
        'Authorization': `Bearer ${config.volcVoice.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    ws.on('open', () => {
      logger.info('TTS WebSocket connected');
    });

    ws.on('error', (error) => {
      logger.error('TTS WebSocket error:', error);
    });

    ws.on('close', (code, reason) => {
      logger.info(`TTS WebSocket closed: ${code} ${reason}`);
      setTimeout(connect, 1000); // Auto-reconnect
    });
  };

  connect();

  return {
    synthesize: async (text, language, onAudioChunk) => {
      if (config.mock) {
        logger.info('TTS running in mock mode');
        // Generate 3 fake PCM chunks with 100ms delays
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          // Create a small buffer of zeros (simulating PCM audio)
          const chunk = Buffer.alloc(1024, 0);
          onAudioChunk(chunk, i === 2);
        }
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('TTS WebSocket not connected');
      }

      const requestId = currentRequestId++;
      const voice = language === 'en' ? 'en-US-Standard-B' : 'ja-JP-Standard-A';

      return new Promise((resolve, reject) => {
        const messageHandler = (data: WebSocket.Data) => {
          if (typeof data === 'string') {
            const event = JSON.parse(data);
            if (event.requestId === requestId) {
              if (event.type === 'audio_chunk') {
                const audioBuffer = Buffer.from(event.audio, 'base64');
                onAudioChunk(audioBuffer, event.isLast);
                if (event.isLast) {
                  ws?.off('message', messageHandler);
                  resolve();
                }
              } else if (event.type === 'error') {
                ws?.off('message', messageHandler);
                reject(new Error(`TTS error: ${event.message}`));
              }
            }
          } else if (data instanceof Buffer) {
            // Handle binary audio data directly
            onAudioChunk(data, false);
          }
        };

        ws.on('message', messageHandler);

        ws.send(JSON.stringify({
          type: 'start_tts',
          requestId,
          config: {
            text,
            language,
            voice,
            format: 'pcm',
            sample_rate: 16000
          }
        }));
      });
    }
  };
}
