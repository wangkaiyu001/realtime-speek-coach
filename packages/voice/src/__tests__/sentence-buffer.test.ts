import { describe, it, expect } from 'vitest';
import { createSentenceBuffer } from '../tts/sentence-buffer.js';

describe('SentenceBuffer', () => {
  it('should split English sentences correctly', () => {
    const sentences: string[] = [];
    const buffer = createSentenceBuffer((sentence) => sentences.push(sentence));

    buffer.push('Hello, how are you? I am fine.');
    buffer.flush();

    expect(sentences).toEqual([
      'Hello,',
      'how are you?',
      'I am fine.'
    ]);
  });

  it('should flush remaining text', () => {
    const sentences: string[] = [];
    const buffer = createSentenceBuffer((sentence) => sentences.push(sentence));

    buffer.push('This is an incomplete sentence');
    buffer.flush();

    expect(sentences).toEqual(['This is an incomplete sentence']);
  });

  it('should split Japanese sentences correctly', () => {
    const sentences: string[] = [];
    const buffer = createSentenceBuffer((sentence) => sentences.push(sentence));

    buffer.push('こんにちは、元気ですか？私は元気です。');
    buffer.flush();

    expect(sentences).toEqual([
      'こんにちは、',
      '元気ですか？',
      '私は元気です。'
    ]);
  });

  it('should handle mixed punctuation', () => {
    const sentences: string[] = [];
    const buffer = createSentenceBuffer((sentence) => sentences.push(sentence));

    buffer.push('Hello! How are you? I am fine, thank you.');
    buffer.flush();

    expect(sentences).toEqual([
      'Hello!',
      'How are you?',
      'I am fine,',
      'thank you.'
    ]);
  });

  it('should handle empty buffer', () => {
    const sentences: string[] = [];
    const buffer = createSentenceBuffer((sentence) => sentences.push(sentence));

    buffer.flush();
    expect(sentences).toEqual([]);
  });
});
