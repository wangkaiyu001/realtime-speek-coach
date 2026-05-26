import { AppConfig } from '../../../contracts/src/config.js';
import type { ReviewReport, ReviewDimensions, TurnCorrection } from '../../../contracts/src/api.js';
import { mockReview } from '../prompts/mock-review.js';
import { buildReviewPrompt } from '../prompts/review-prompt.js';

// DeepSeek V4 Pro OpenAI-compatible client
class DeepSeekClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.deepseek.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async chatCompletions(messages: { role: string; content: string }[]): Promise<any> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}

export function createReviewWorker(config: AppConfig, prismaClient: any) {
  const deepseekClient = new DeepSeekClient(config.deepseek.apiKey);

  return {
    async enqueueReview(sessionId: string) {
      // Mark review as processing in DB
      await prismaClient.review.upsert({
        where: { sessionId },
        update: { status: 'processing' },
        create: {
          sessionId,
          status: 'processing',
          dimensions: { pronunciation: 0, grammar: 0, vocabulary: 0, fluency: 0, interaction: 0 },
          corrections: [],
          rawResponse: ''
        }
      });

      // Start async processing
      this.processReview(sessionId).catch(async (error) => {
        console.error('Review processing failed:', error);
        await prismaClient.review.update({
          where: { sessionId },
          data: {
            status: 'failed',
            rawResponse: error.message
          }
        });
      });
    },

    async processReview(sessionId: string) {
      // Check if mock mode is enabled
      if (config.mock) {
        // Simulate delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        const mockData = mockReview;
        await prismaClient.review.update({
          where: { sessionId },
          data: {
            status: 'completed',
            dimensions: mockData.dimensions,
            overallComment: mockData.overallComment,
            highlights: mockData.highlights,
            suggestions: mockData.suggestions,
            corrections: mockData.corrections,
            rawResponse: JSON.stringify(mockData)
          }
        });
        return;
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
        session.level,
        session.turns.map((turn: { userText: string; aiText: string }) => ({ userText: turn.userText, aiText: turn.aiText }))
      );

      // Call LLM
      const response = await deepseekClient.chatCompletions(messages);
      const content = response.choices[0].message.content;

      // Parse response
      const reviewReport: ReviewReport = JSON.parse(content);

      // Update DB
      await prismaClient.review.update({
        where: { sessionId },
        data: {
          status: 'completed',
          dimensions: reviewReport.dimensions,
          overallComment: reviewReport.overallComment,
          highlights: reviewReport.highlights,
          suggestions: reviewReport.suggestions,
          corrections: reviewReport.corrections,
          rawResponse: content
        }
      });
    }
  };
}
