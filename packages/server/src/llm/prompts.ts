import type { Scenario } from '../../../contracts/src/api.js';
import type { Language, ProficiencyLevel } from '../../../contracts/src/ws.js';
import type { ChatMessage } from './router.js';

export const SESSION_COMPLETE_MARKER = '[SESSION_COMPLETE]';

export interface ConversationPolicy {
  minTurns: number;
  maxTurns: number;
  naturalEndGoal: string;
}

export interface ConversationTurnControl {
  text: string;
  shouldComplete: boolean;
}

/**
 * Build the prompt for a conversation turn.
 * Enforces strict monolingual environment.
 */
export function buildConversationPrompt(
  scenario: Scenario,
  level: ProficiencyLevel,
  language: Language,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  policy: ConversationPolicy = getConversationPolicy(scenario),
  currentUserTurn = countUserTurns(conversationHistory),
): ChatMessage[] {
  const langName = language === 'en' ? 'English' : 'Japanese';
  const examStandard = language === 'en' ? 'IELTS' : 'JSST';
  const styleGuide = buildStyleGuide(language, level, scenario.difficulty);
  const mustClose = currentUserTurn >= policy.maxTurns;
  const mayClose = currentUserTurn >= policy.minTurns;

  // Replace {{level}} placeholder in scenario prompt
  const scenarioPrompt = scenario.systemPrompt.replace('{{level}}', String(level));

  const systemPrompt = `${scenarioPrompt}

## Critical Rules (NEVER violate):
1. You MUST speak ONLY in ${langName}. Never use Chinese, and never mix languages.
2. If the user speaks in Chinese or mixes languages, respond ONLY in ${langName} and politely ask them to rephrase entirely in ${langName}.
3. Adapt your vocabulary complexity to ${examStandard} Band ${level}:
   - Level 1-3: Simple vocabulary, short sentences, common expressions.
   - Level 4-6: Moderate vocabulary, compound sentences, idiomatic expressions.
   - Level 7-9: Advanced vocabulary, complex structures, nuanced expressions.
4. Keep responses to 1-3 sentences maximum. Be conversational, not lecturing.
5. Stay in character for the scenario at all times.
6. Do not force a fixed number of turns. Current user turn: ${currentUserTurn}. Minimum before closing: ${policy.minTurns}. Maximum: ${policy.maxTurns}.
7. Natural completion goal: ${policy.naturalEndGoal}
8. If the goal is not complete and this is not the maximum turn, ask one useful follow-up question to move the role-play forward.
9. If the task is naturally complete, the user says they are done/thanks/no more requests, or this is the maximum turn, give a normal human closing line and append ${SESSION_COMPLETE_MARKER} at the very end.
10. ${mayClose ? 'You MAY close now if the scenario feels naturally complete.' : `Do NOT close yet unless the user explicitly refuses to continue; guide the scenario forward until at least turn ${policy.minTurns}.`}
11. ${mustClose ? `You MUST close naturally in this response and append ${SESSION_COMPLETE_MARKER}.` : `Only append ${SESSION_COMPLETE_MARKER} when closing. Never explain the marker.`}

## Speech and realism style:
${styleGuide}`;

  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  // Add conversation history
  for (const turn of conversationHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }

  return messages;
}

export function getConversationPolicy(scenario: Scenario): ConversationPolicy {
  const fallback = policyByCategory(scenario.category);
  return {
    minTurns: clampTurnCount(scenario.minTurns ?? fallback.minTurns, 1, 10),
    maxTurns: clampTurnCount(scenario.maxTurns ?? fallback.maxTurns, 2, 12),
    naturalEndGoal: scenario.naturalEndGoal || fallback.naturalEndGoal,
  };
}

export function parseAiTurnControl(rawText: string, canComplete: boolean): ConversationTurnControl {
  const markerPattern = /\s*\[SESSION_COMPLETE\]\s*$/i;
  const shouldComplete = markerPattern.test(rawText) && canComplete;
  const text = rawText.replace(markerPattern, '').trim();
  return { text, shouldComplete };
}

function countUserTurns(conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>) {
  return conversationHistory.filter((turn) => turn.role === 'user').length;
}

function policyByCategory(category: Scenario['category']): ConversationPolicy {
  switch (category) {
    case 'shopping':
    case 'food':
    case 'travel':
      return {
        minTurns: 2,
        maxTurns: 5,
        naturalEndGoal: 'The practical task has been completed and the user has no important unresolved request.',
      };
    case 'daily':
      return {
        minTurns: 2,
        maxTurns: 6,
        naturalEndGoal: 'The small talk has reached a friendly, natural closing point.',
      };
    case 'ielts_mock':
    case 'jsst_mock':
      return {
        minTurns: 4,
        maxTurns: 8,
        naturalEndGoal: 'The candidate has provided enough spoken output for a meaningful speaking-practice review.',
      };
    case 'business':
    case 'meeting':
    case 'project':
    case 'news':
    default:
      return {
        minTurns: 4,
        maxTurns: 8,
        naturalEndGoal: 'The main topic, follow-up details, and next steps are clear enough to end naturally.',
      };
  }
}

function clampTurnCount(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function buildStyleGuide(language: Language, level: ProficiencyLevel, difficulty: ProficiencyLevel) {
  const effectiveLevel = Math.max(level, difficulty) as ProficiencyLevel;
  if (effectiveLevel <= 3) {
    return language === 'ja'
      ? '- 教室で先生が話すように、ゆっくり、はっきり、標準的で丁寧な表現を使う。俗語や省略表現は避ける。'
      : '- Sound like a patient classroom coach: slow, clear, steady, standard wording, no slang unless you briefly teach it.';
  }
  if (effectiveLevel <= 6) {
    return language === 'ja'
      ? '- 自然な会話速度で、適度に口語表現を使う。ただし聞き取りやすさは保つ。'
      : '- Use a natural conversational pace with some contractions and everyday idioms, while staying easy to follow.';
  }
  return language === 'ja'
    ? '- 実際の日本語環境に近く、やや速めで自然な抑揚を使う。場面に合えば省略、あいづち、くだけた表現を混ぜる。'
    : '- Sound close to a real native environment: faster, more varied intonation, contractions, fillers, casual phrasing, and occasional scenario-appropriate slang.';
}

/**
 * Build the prompt for the placement test.
 */
export function buildPlacementPrompt(
  language: Language,
  testLevel: 1 | 2 | 3,
  previousResponse?: string,
): ChatMessage[] {
  const langName = language === 'en' ? 'English' : 'Japanese';

  const levelInstructions: Record<number, string> = {
    1: `Ask the user to read a simple daily sentence aloud. Provide both the original language and Chinese translation. Example: "Please read this sentence: 'I would like a cup of coffee, please.' (我想要一杯咖啡，谢谢。)"`,
    2: `Ask a simple open-ended question in ${langName} without any text hints. Keep it about daily life topics. Example: "What did you do last weekend?"`,
    3: `Based on the user's previous answer, ask a challenging follow-up that requires complex grammar (subordinate clauses, conditionals, comparisons). Push them to think harder.`,
  };

  const systemPrompt = `You are a ${langName} proficiency examiner conducting a placement test.
Level ${testLevel} task: ${levelInstructions[testLevel]}

Rules:
- Speak only in ${langName} (except when providing Chinese translations at Level 1).
- Be encouraging but evaluate strictly internally.
- Keep instructions clear and concise.`;

  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  if (previousResponse) {
    messages.push({ role: 'user', content: previousResponse });
  }

  return messages;
}
