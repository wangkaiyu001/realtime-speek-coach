import type { AppConfig } from '../../../contracts/src/config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRouter {
  streamChat(messages: ChatMessage[], opts?: StreamChatOptions): AsyncGenerator<string>;
}

export interface StreamChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export function createLlmRouter(config: AppConfig): LlmRouter {
  return {
    async *streamChat(messages: ChatMessage[], opts: StreamChatOptions = {}): AsyncGenerator<string> {
      if (config.mock) {
        // Mock streaming response
        const mockResponse =
          "I'm doing well, thank you! How can I help you practice your English today? " +
          "Would you like to work on a specific topic or just have a casual conversation?";
        const tokens = mockResponse.split(' ');
        for (const token of tokens) {
          yield token + ' ';
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return;
      }

      // Try DeepSeek V4 Flash first
      try {
        yield* streamDeepSeek(config, messages, opts);
        return;
      } catch (deepSeekErr) {
        console.error('[LLM Router] DeepSeek failed, trying Gemini fallback:', deepSeekErr);
      }

      // Fallback to Gemini 3.5 Flash
      try {
        yield* streamGemini(config, messages, opts);
      } catch (geminiErr) {
        console.error('[LLM Router] Gemini also failed:', geminiErr);
        throw new Error('All LLM providers failed');
      }
    },
  };
}

async function* streamDeepSeek(
  config: AppConfig,
  messages: ChatMessage[],
  opts: StreamChatOptions,
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 8000);

  try {
    const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseek.modelFlash,
        messages,
        stream: true,
        temperature: opts.temperature || 0.7,
        max_tokens: opts.maxTokens || 512,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function* streamGemini(
  config: AppConfig,
  messages: ChatMessage[],
  opts: StreamChatOptions,
): AsyncGenerator<string> {
  // Gemini uses a different API format
  // Convert messages to Gemini format
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const systemInstruction = messages.find((m) => m.role === 'system');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.modelFlash}:streamGenerateContent?alt=sse&key=${config.gemini.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction
          ? { parts: [{ text: systemInstruction.content }] }
          : undefined,
        generationConfig: {
          temperature: opts.temperature || 0.7,
          maxOutputTokens: opts.maxTokens || 512,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);

      try {
        const json = JSON.parse(data);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch {
        // Skip
      }
    }
  }
}
