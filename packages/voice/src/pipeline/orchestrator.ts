import { AppConfig } from '../../../contracts/src/config.js';
import { WsServerFrame } from '../../../contracts/src/ws.js';
import { createAsrClient } from '../asr/doubao-asr.js';
import { createTtsClient } from '../tts/doubao-tts.js';
import { createSentenceBuffer } from '../tts/sentence-buffer.js';
import pino from 'pino';

const logger = pino({
  name: 'pipeline-orchestrator',
  level: 'info'
});

interface LlmRouter {
  generateResponse(text: string): AsyncGenerator<string, void, unknown>;
}

interface Pipeline {
  startTurn(turnIndex: number): void;
  sendAudio(chunk: Buffer): void;
  endAudio(): void;
  abort(): void;
}

export function createPipeline(
  config: AppConfig,
  llmRouter: LlmRouter,
  onFrame: (frame: WsServerFrame) => void
): Pipeline {
  const asrClientFactory = createAsrClient(config);
  const ttsClient = createTtsClient(config);
  const sentenceBuffer = createSentenceBuffer(handleSentence);

  let currentTurnIndex = -1;
  let asrClient: ReturnType<typeof asrClientFactory> | null = null;
  let isProcessing = false;
  let abortController = new AbortController();

  function handleAsrPartial(text: string) {
    onFrame({
      type: 'asr_partial',
      turnIndex: currentTurnIndex,
      text
    });
  }

  async function handleAsrFinal(text: string) {
    onFrame({
      type: 'asr_final',
      turnIndex: currentTurnIndex,
      text
    });

    if (isProcessing) return;
    isProcessing = true;

    try {
      const responseGenerator = llmRouter.generateResponse(text);
      for await (const delta of responseGenerator) {
        if (abortController.signal.aborted) break;
        onFrame({
          type: 'llm_delta',
          turnIndex: currentTurnIndex,
          delta
        });
        sentenceBuffer.push(delta);
      }
      sentenceBuffer.flush();
    } catch (error) {
      logger.error('LLM processing error:', error);
    } finally {
      isProcessing = false;
    }
  }

  async function handleSentence(sentence: string) {
    if (abortController.signal.aborted) return;

    try {
      await ttsClient.synthesize(sentence, 'en', (chunk, isLast) => {
        onFrame({
          type: 'tts_chunk',
          turnIndex: currentTurnIndex,
          audio: chunk.toString('base64'),
          isLast
        });
      });
    } catch (error) {
      logger.error('TTS synthesis error:', error);
    }
  }

  return {
    startTurn: (turnIndex: number) => {
      this.abort();
      abortController = new AbortController();
      currentTurnIndex = turnIndex;
      asrClient = asrClientFactory({
        onPartial: handleAsrPartial,
        onFinal: handleAsrFinal
      });
      logger.info(`Started turn ${turnIndex}`);
    },
    sendAudio: (chunk: Buffer) => {
      if (!asrClient) {
        logger.warn('No active turn, dropping audio chunk');
        return;
      }
      asrClient.sendAudio(chunk);
    },
    endAudio: () => {
      if (asrClient) {
        asrClient.stop();
      }
    },
    abort: () => {
      abortController.abort();
      if (asrClient) {
        asrClient.stop();
        asrClient = null;
      }
      sentenceBuffer.flush();
      if (currentTurnIndex >= 0) {
        onFrame({
          type: 'turn_end',
          turnIndex: currentTurnIndex
        });
      }
      currentTurnIndex = -1;
      isProcessing = false;
      logger.info('Pipeline aborted');
    }
  };
}
