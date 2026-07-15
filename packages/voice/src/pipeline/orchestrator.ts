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
  let sentenceBuffer = createSentenceBuffer(handleSentence);

  let currentTurnIndex = -1;
  let asrClient: ReturnType<typeof asrClientFactory> | null = null;
  let isProcessing = false;
  let abortController = new AbortController();

  function handleAsrPartial(text: string) {
    onFrame({
      type: 'asr_partial',
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
      let accumulated = '';
      const responseGenerator = llmRouter.generateResponse(text);
      for await (const delta of responseGenerator) {
        if (abortController.signal.aborted) break;
        accumulated += delta;
        onFrame({
          type: 'llm_delta',
          text: delta,
          accumulated
        });
        sentenceBuffer.push(delta);
      }
      sentenceBuffer.flush();
    } catch (error) {
      logger.error({ err: error }, 'LLM processing error');
    } finally {
      isProcessing = false;
    }
  }

  let ttsSeq = 0;

  async function handleSentence(sentence: string) {
    if (abortController.signal.aborted) return;

    try {
      await ttsClient.synthesize(sentence, 'en', (chunk, isLast) => {
        onFrame({
          type: 'tts_chunk',
          data: chunk.toString('base64'),
          seq: ttsSeq++,
          isLast
        });
      });
    } catch (error) {
      logger.error({ err: error }, 'TTS synthesis error');
    }
  }

  function abort() {
    abortController.abort();
    if (asrClient) {
      asrClient.stop();
      asrClient = null;
    }
    sentenceBuffer.flush();
    if (currentTurnIndex >= 0) {
      onFrame({
        type: 'turn_end',
        turnIndex: currentTurnIndex,
        totalTurns: 0,
        sessionComplete: false
      });
    }
    currentTurnIndex = -1;
    isProcessing = false;
    logger.info('Pipeline aborted');
  }

  return {
    startTurn: (turnIndex: number) => {
      abort();
      abortController = new AbortController();
      currentTurnIndex = turnIndex;
      sentenceBuffer = createSentenceBuffer(handleSentence);
      asrClient = asrClientFactory({
        onPartial: handleAsrPartial,
        onFinal: handleAsrFinal
      }, {
        language: 'en'
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
        asrClient.endAudio();
      }
    },
    abort
  };
}
