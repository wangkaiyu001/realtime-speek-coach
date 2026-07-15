import type { AppConfig } from '../../../contracts/src/config.js';
import type { TurnCorrection } from '../../../contracts/src/api.js';
import { mockReview, type ReviewLlmOutput } from '../prompts/mock-review.js';
import { buildReviewPrompt } from '../prompts/review-prompt.js';
import type { PrismaClient } from '@prisma/client';

type ChatMessage = { role: string; content: string };

interface DeepSeekChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

// DeepSeek V4 Pro OpenAI-compatible client
class DeepSeekClient {
  private apiKey: string;
  private baseUrl: string;

  private model: string;
  private timeoutMs: number;

  constructor(apiKey: string, baseUrl: string = 'https://api.deepseek.com', model: string = 'deepseek-v4-pro', timeoutMs = 18000) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async chatCompletions(messages: ChatMessage[]): Promise<DeepSeekChatCompletionResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.5,
          max_tokens: 1200,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`DeepSeek review request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<DeepSeekChatCompletionResponse>;
  }
}

function normalizeScore(score: unknown): number {
  return typeof score === 'number' && Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : 0;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeReviewOutput(review: Partial<ReviewLlmOutput>): ReviewLlmOutput {
  const dimensions = review.dimensions || ({} as Partial<ReviewLlmOutput['dimensions']>);

  return {
    dimensions: {
      pronunciation: normalizeScore(dimensions.pronunciation),
      grammar: normalizeScore(dimensions.grammar),
      vocabulary: normalizeScore(dimensions.vocabulary),
      fluency: normalizeScore(dimensions.fluency),
      interaction: normalizeScore(dimensions.interaction)
    },
    overallComment: typeof review.overallComment === 'string' ? review.overallComment : '',
    highlights: safeArray<string>(review.highlights),
    suggestions: safeArray<string>(review.suggestions),
    corrections: safeArray<TurnCorrection>(review.corrections)
  };
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function parseStringArray(value: unknown): string[] {
  return safeArray<unknown>(value).filter((item): item is string => typeof item === 'string');
}

function isTurnCorrectionCategory(value: unknown): value is TurnCorrection['category'] {
  return value === 'pronunciation'
    || value === 'grammar'
    || value === 'vocabulary'
    || value === 'fluency'
    || value === 'interaction'
    || value === 'expression';
}

function parseCorrections(value: unknown): TurnCorrection[] {
  return safeArray<unknown>(value).map((item) => {
    const record = toRecord(item);
    if (!record) return undefined;

    const category = isTurnCorrectionCategory(record.category) ? record.category : 'expression';
    return {
      turnIndex: typeof record.turnIndex === 'number' && Number.isFinite(record.turnIndex) ? Math.max(0, Math.round(record.turnIndex)) : 0,
      userSaid: typeof record.userSaid === 'string' ? record.userSaid : '',
      nativeSay: typeof record.nativeSay === 'string' ? record.nativeSay : '',
      correctionReason: typeof record.correctionReason === 'string' ? record.correctionReason : '',
      category,
    };
  }).filter((item): item is TurnCorrection => Boolean(item));
}

function parseReviewObject(value: unknown): Partial<ReviewLlmOutput> {
  const record = toRecord(value);
  if (!record) return {};

  const dimensions = toRecord(record.dimensions);
  return {
    dimensions: dimensions ? {
      pronunciation: normalizeScore(dimensions.pronunciation),
      grammar: normalizeScore(dimensions.grammar),
      vocabulary: normalizeScore(dimensions.vocabulary),
      fluency: normalizeScore(dimensions.fluency),
      interaction: normalizeScore(dimensions.interaction),
    } : undefined,
    overallComment: typeof record.overallComment === 'string'
      ? record.overallComment
      : typeof record.overall_comment === 'string'
        ? record.overall_comment
        : '',
    highlights: parseStringArray(record.highlights),
    suggestions: parseStringArray(record.suggestions),
    corrections: parseCorrections(record.corrections),
  };
}

function extractJsonObjectText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function parseReviewContent(content: string): Partial<ReviewLlmOutput> {
  const jsonText = extractJsonObjectText(content);
  return parseReviewObject(JSON.parse(jsonText));
}

function toReviewPersistenceData(review: Partial<ReviewLlmOutput>, rawResponse: string) {
  const normalized = normalizeReviewOutput(review);

  return {
    pronunciation: normalized.dimensions.pronunciation,
    grammar: normalized.dimensions.grammar,
    vocabulary: normalized.dimensions.vocabulary,
    fluency: normalized.dimensions.fluency,
    interaction: normalized.dimensions.interaction,
    overallComment: normalized.overallComment,
    highlights: JSON.stringify(normalized.highlights),
    suggestions: JSON.stringify(normalized.suggestions),
    corrections: JSON.stringify(normalized.corrections),
    rawResponse,
    completedAt: new Date()
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toFailedReviewData(error: unknown) {
  const message = toErrorMessage(error);
  return {
    status: 'failed',
    overallComment: `复盘暂时生成失败：${message}`,
    rawResponse: message,
    completedAt: new Date(),
  };
}

async function markReviewProcessing(prismaClient: PrismaClient, sessionId: string) {
  await prismaClient.review.upsert({
    where: { sessionId },
    update: {
      status: 'processing',
      rawResponse: '',
      completedAt: null
    },
    create: {
      sessionId,
      status: 'processing',
      rawResponse: ''
    }
  });
}

async function markReviewFailed(prismaClient: PrismaClient, sessionId: string, error: unknown) {
  const failedReviewData = toFailedReviewData(error);
  await prismaClient.review.upsert({
    where: { sessionId },
    update: failedReviewData,
    create: {
      sessionId,
      ...failedReviewData,
    }
  });
}

export function createReviewWorker(config: AppConfig, prismaClient: PrismaClient) {
  const deepseekClient = new DeepSeekClient(
    config.deepseek.apiKey,
    config.deepseek.baseUrl,
    config.deepseek.modelPro || 'deepseek-v4-pro'
  );

  return {
    async enqueueReview(sessionId: string) {
      await markReviewProcessing(prismaClient, sessionId);
      void this.processReviewSafely(sessionId);
    },

    async processReviewSafely(sessionId: string) {
      await markReviewProcessing(prismaClient, sessionId);
      try {
        await this.processReview(sessionId);
      } catch (error) {
        console.error('Review processing failed:', error);
        await markReviewFailed(prismaClient, sessionId, error);
      }
    },

    async processReview(sessionId: string) {
      // Check if mock mode is enabled
      if (config.mocks.review) {
        // Simulate delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        const rawResponse = JSON.stringify(mockReview);
        await prismaClient.review.upsert({
          where: { sessionId },
          update: {
            status: 'completed',
            ...toReviewPersistenceData(mockReview, rawResponse)
          },
          create: {
            sessionId,
            status: 'completed',
            ...toReviewPersistenceData(mockReview, rawResponse)
          }
        });
        return;
      }

      if (!config.deepseek.apiKey) {
        throw new Error('DEEPSEEK_API_KEY is required when MOCK mode is disabled');
      }

      // Fetch session data from DB
      const session = await prismaClient.session.findUnique({
        where: { id: sessionId },
        include: { turns: true }
      });

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Build prompt
      const messages = buildReviewPrompt(
        session.language,
        String(session.level),
        session.turns.map((turn: { userText?: string | null; aiText?: string | null }) => ({
          userText: turn.userText || '',
          aiText: turn.aiText || ''
        }))
      );

      // Call LLM
      const response = await deepseekClient.chatCompletions(messages);
      const content = response?.choices?.[0]?.message?.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('DeepSeek returned an empty review response');
      }

      // Parse response
      const reviewReport = parseReviewContent(content);

      // Update DB
      await prismaClient.review.upsert({
        where: { sessionId },
        update: {
          status: 'completed',
          ...toReviewPersistenceData(reviewReport, content)
        },
        create: {
          sessionId,
          status: 'completed',
          ...toReviewPersistenceData(reviewReport, content)
        }
      });
    }
  };
}
