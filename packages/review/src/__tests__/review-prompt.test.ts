import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from '../prompts/review-prompt.js';

describe('buildReviewPrompt', () => {
  it('returns valid messages array with system and user roles', () => {
    const messages = buildReviewPrompt('English', 'intermediate', [
      { userText: 'Hello', aiText: 'Hi there!' },
      { userText: 'How are you?', aiText: 'I am fine, thank you.' }
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes turn transcripts in user prompt', () => {
    const turns = [
      { userText: 'Hello', aiText: 'Hi there!' },
      { userText: 'How are you?', aiText: 'I am fine, thank you.' }
    ];
    const messages = buildReviewPrompt('English', 'intermediate', turns);

    expect(messages[1].content).toContain('Turn 0:');
    expect(messages[1].content).toContain('User: Hello');
    expect(messages[1].content).toContain('AI: Hi there!');
    expect(messages[1].content).toContain('Turn 1:');
    expect(messages[1].content).toContain('User: How are you?');
    expect(messages[1].content).toContain('AI: I am fine, thank you.');
  });

  it('specifies JSON output format in system prompt', () => {
    const messages = buildReviewPrompt('English', 'intermediate', [
      { userText: 'Hello', aiText: 'Hi there!' }
    ]);

    expect(messages[0].content).toContain('Output ONLY a valid JSON object');
    expect(messages[0].content).toContain('ReviewReport schema');
    expect(messages[0].content).toContain('Example output:');
  });

  it('includes language and level in the prompt', () => {
    const messages = buildReviewPrompt('Spanish', 'beginner', [
      { userText: 'Hola', aiText: '¡Hola!' }
    ]);

    expect(messages[0].content).toContain('${language}');
    expect(messages[1].content).toContain('language: Spanish');
    expect(messages[1].content).toContain('level: beginner');
  });
});
