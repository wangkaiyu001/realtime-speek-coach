// utils/api.ts
// HTTP request wrapper with retry logic

import { globalData } from '../app';

export class ApiRequestError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 0, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface ApiEnvelope<T> {
  code?: number;
  data?: T;
  message?: string;
  error?: string;
}

export interface Scenario {
  id: string;
  category: string;
  title: string;
  titleCn?: string;
  description: string;
  descriptionCn?: string;
  difficulty: number;
  language?: 'en' | 'ja';
  openingLine?: string;
}

export interface SessionSummary {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  language: 'en' | 'ja';
  turnsCompleted: number;
  totalTurns: number;
  progressText: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  statusText: string;
  hasReview: boolean;
  reviewStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  createdAtText: string;
  canOpenReview: boolean;
  canRequestReview: boolean;
  primaryActionText: string;
}

interface ScenarioListResponse {
  scenarios: Scenario[];
}

export interface ReviewResult {
  id: string;
  status: string;
  score: number;
  isCompleted: boolean;
  isPending: boolean;
  isFailed: boolean;
  radar: {
    pronunciation: number;
    fluency: number;
    vocabulary: number;
    grammar: number;
    coherence: number;
  };
  comment: string;
  highlights: string[];
  suggestions: string[];
  corrections: { user: string; native: string; reason: string }[];
}

interface BackendReviewResponse {
  review: {
    id: string;
    status: string;
    dimensions?: {
      pronunciation?: number;
      fluency?: number;
      vocabulary?: number;
      grammar?: number;
      interaction?: number;
    };
    overallComment?: string;
    highlights?: string[];
    suggestions?: string[];
    corrections?: {
      user?: string;
      native?: string;
      userSaid?: string;
      nativeSay?: string;
      correctionReason?: string;
    }[];
  };
}

interface SessionListResponse {
  sessions: Omit<SessionSummary, 'progressText' | 'statusText' | 'createdAtText' | 'canOpenReview' | 'canRequestReview' | 'primaryActionText'>[];
}

interface RequestReviewResponse {
  accepted: boolean;
  sessionId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

const DEFAULT_RETRY_COUNT = 3;
const RETRY_DELAY = 1000;
let authRefreshPromise: Promise<void> | null = null;

function unwrapResponse<T>(body: unknown): T {
  const response = body as ApiEnvelope<T>;

  if (typeof response?.code === 'number') {
    if (response.code === 0) {
      return response.data as T;
    }
    throw new Error(response.message || response.error || 'API request failed');
  }

  return body as T;
}

export async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: string | WechatMiniprogram.IAnyObject | ArrayBuffer, retries = DEFAULT_RETRY_COUNT, authRetried = false): Promise<T> {
  const { apiUrl, token } = globalData;
  const url = `${apiUrl}${path}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (res) => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const errorBody = res.data as ApiEnvelope<unknown>;
            const message = errorBody?.message || errorBody?.error || `HTTP ${res.statusCode}`;
            if (res.statusCode === 401 && !authRetried) {
              if (!authRefreshPromise) {
                authRefreshPromise = import('../app')
                  .then(({ refreshLogin }) => refreshLogin())
                  .then(() => undefined)
                  .finally(() => { authRefreshPromise = null; });
              }
              authRefreshPromise
                .then(() => request<T>(method, path, data, retries, true))
                .then(resolve)
                .catch(reject);
              return;
            }
            reject(new ApiRequestError(message, res.statusCode, res.statusCode === 401 ? 'AUTH_EXPIRED' : 'HTTP_ERROR'));
            return;
          }

          resolve(unwrapResponse<T>(res.data));
        } catch (error) {
          reject(error);
        }
      },
      fail: (err) => {
        if (retries > 0) {
          setTimeout(() => {
            request<T>(method, path, data, retries - 1, authRetried)
              .then(resolve)
              .catch(reject);
          }, RETRY_DELAY);
        } else {
          reject(new ApiRequestError(
            '暂时连接不上服务，请检查网络后重试。',
            0,
            /url not in domain list|domain/i.test(err.errMsg || '') ? 'DOMAIN_NOT_ALLOWED' : 'NETWORK_ERROR',
          ));
        }
      },
    });
  });
}

// API methods

// User
export async function setUserLanguage(language: string): Promise<void> {
  await request<{ success: boolean }>('POST', '/user/language', { language });
}

// Scenarios
export async function getScenarios(): Promise<Scenario[]> {
  const response = await request<ScenarioListResponse>('GET', '/scenarios');
  return response.scenarios;
}

function toSessionStatusText(session: SessionSummary) {
  if (session.hasReview) return '复盘已生成';
  if (session.reviewStatus === 'processing' || session.reviewStatus === 'pending') return '复盘生成中';
  if (session.status === 'completed') return '练习已完成';
  if (session.status === 'abandoned') return '已提前结束';
  return '进行中';
}

function toDateText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}

function normalizeSession(session: SessionListResponse['sessions'][number]): SessionSummary {
  const normalized = {
    ...session,
    progressText: `${session.turnsCompleted}/${session.totalTurns}`,
    statusText: '',
    createdAtText: toDateText(session.createdAt),
    canOpenReview: session.hasReview || session.reviewStatus === 'processing' || session.reviewStatus === 'pending',
    canRequestReview: !session.hasReview && !session.reviewStatus && session.turnsCompleted > 0,
    primaryActionText: '',
  } as SessionSummary;

  normalized.statusText = toSessionStatusText(normalized);
  normalized.primaryActionText = normalized.canOpenReview
    ? '查看复盘'
    : normalized.canRequestReview
      ? '生成复盘'
      : '再练一次';

  return normalized;
}

// Sessions
export async function getSessions(): Promise<SessionSummary[]> {
  const response = await request<SessionListResponse>('GET', '/sessions');
  return (response.sessions || []).map(normalizeSession);
}

export async function requestReview(sessionId: string): Promise<RequestReviewResponse> {
  return request<RequestReviewResponse>('POST', `/reviews/${sessionId}/request`, {});
}

// Review
export async function getReview(sessionId: string): Promise<ReviewResult> {
  const response = await request<BackendReviewResponse>('GET', `/reviews/${sessionId}`);
  const review = response.review;
  const dimensions = review.dimensions || {};
  const scoreValues = [
    dimensions.pronunciation,
    dimensions.fluency,
    dimensions.vocabulary,
    dimensions.grammar,
    dimensions.interaction,
  ].filter((value): value is number => typeof value === 'number');
  const score = scoreValues.length
    ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)
    : 0;

  return {
    id: review.id,
    status: review.status,
    score,
    isCompleted: review.status === 'completed',
    isPending: review.status === 'pending' || review.status === 'processing',
    isFailed: review.status === 'failed',
    radar: {
      pronunciation: dimensions.pronunciation || 0,
      fluency: dimensions.fluency || 0,
      vocabulary: dimensions.vocabulary || 0,
      grammar: dimensions.grammar || 0,
      coherence: dimensions.interaction || 0,
    },
    comment: review.overallComment || '',
    highlights: review.highlights || [],
    suggestions: review.suggestions || [],
    corrections: (review.corrections || []).map(item => ({
      user: item.user || item.userSaid || '',
      native: item.native || item.nativeSay || '',
      reason: item.correctionReason || '',
    })),
  };
}
