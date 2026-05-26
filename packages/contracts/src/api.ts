// ============================================================
// REST API Type Definitions - Realtime Speak Coach
// ============================================================

import type { Language, ProficiencyLevel } from './ws.js';

// ─── Auth ────────────────────────────────────────────────────

export interface LoginRequest {
  code: string; // wx.login() code
}

export interface LoginResponse {
  token: string;
  userId: string;
  isNewUser: boolean;
  language?: Language;
  level?: ProficiencyLevel;
}

// ─── Language Selection ──────────────────────────────────────

export interface SetLanguageRequest {
  language: Language;
}

export interface SetLanguageResponse {
  success: boolean;
}

// ─── Placement Test ──────────────────────────────────────────

export interface PlacementTestResult {
  id: string;
  userId: string;
  language: Language;
  level: ProficiencyLevel;
  dimensions: {
    pronunciation: number; // 0-100
    grammar: number;
    vocabulary: number;
    fluency: number;
    interaction: number;
  };
  createdAt: string;
}

export interface SubmitPlacementRequest {
  sessionId: string;
}

export interface SubmitPlacementResponse {
  result: PlacementTestResult;
}

// ─── Scenarios ───────────────────────────────────────────────

export interface Scenario {
  id: string;
  title: string;
  titleCn: string;
  description: string;
  descriptionCn: string;
  category: ScenarioCategory;
  difficulty: ProficiencyLevel;
  language: Language;
  /** System prompt template for this scenario */
  systemPrompt: string;
  /** Opening line for AI to break the ice */
  openingLine: string;
}

export type ScenarioCategory =
  | 'shopping'
  | 'travel'
  | 'business'
  | 'meeting'
  | 'project'
  | 'news'
  | 'ielts_mock'
  | 'jsst_mock'
  | 'daily'
  | 'food';

export interface ScenarioListResponse {
  scenarios: Scenario[];
}

// ─── Sessions & History ──────────────────────────────────────

export interface SessionSummary {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  turnsCompleted: number;
  totalTurns: number;
  status: 'in_progress' | 'completed' | 'abandoned';
  hasReview: boolean;
  createdAt: string;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
}

// ─── Review (复盘) ───────────────────────────────────────────

export interface ReviewDimensions {
  pronunciation: number; // 0-100
  grammar: number;
  vocabulary: number;
  fluency: number;
  interaction: number;
}

export interface TurnCorrection {
  turnIndex: number;
  userSaid: string;
  nativeSay: string;
  correctionReason: string;
  category: 'pronunciation' | 'grammar' | 'vocabulary' | 'expression';
}

export interface ReviewReport {
  id: string;
  sessionId: string;
  dimensions: ReviewDimensions;
  overallComment: string;
  highlights: string[];
  suggestions: string[];
  corrections: TurnCorrection[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface ReviewResponse {
  review: ReviewReport;
}

// ─── Health ──────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptime: number;
  mock: boolean;
}
