// This module re-exports from the @rsc/voice package for server-side consumption.
// In mock mode, the WS handler (ws/handler.ts) implements its own inline mock pipeline.
// In production mode, this will delegate to the voice package's orchestrator.

export { createPipeline } from '../../../voice/src/pipeline/orchestrator.js';
export { createAsrClient } from '../../../voice/src/asr/doubao-asr.js';
export { createTtsClient } from '../../../voice/src/tts/doubao-tts.js';
export { createSentenceBuffer } from '../../../voice/src/tts/sentence-buffer.js';
