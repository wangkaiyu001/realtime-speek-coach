interface SentenceBuffer {
  push(token: string): void;
  flush(): void;
}

/** Punctuation characters that mark sentence boundaries */
const SPLIT_CHARS = new Set([',', '.', '?', '!', '。', '、', '！', '？']);

export function createSentenceBuffer(onSentence: (sentence: string) => void): SentenceBuffer {
  let buffer = '';

  function processSplits() {
    let lastSplitEnd = 0;

    for (let i = 0; i < buffer.length; i++) {
      if (SPLIT_CHARS.has(buffer[i])) {
        const sentence = buffer.substring(lastSplitEnd, i + 1).trim();
        if (sentence.length > 0) {
          onSentence(sentence);
        }
        lastSplitEnd = i + 1;
      }
    }

    // Keep unfinished portion in buffer
    buffer = buffer.substring(lastSplitEnd);
  }

  return {
    push(token: string) {
      buffer += token;
      processSplits();
    },
    flush() {
      const remaining = buffer.trim();
      if (remaining.length > 0) {
        onSentence(remaining);
      }
      buffer = '';
    },
  };
}
