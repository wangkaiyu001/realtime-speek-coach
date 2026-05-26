import type { Scenario } from '../../../contracts/src/api.js';
import type { Language, ProficiencyLevel } from '../../../contracts/src/ws.js';
import type { ChatMessage } from './router.js';

/**
 * Build the prompt for a conversation turn.
 * Enforces strict monolingual environment.
 */
export function buildConversationPrompt(
  scenario: Scenario,
  level: ProficiencyLevel,
  language: Language,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
): ChatMessage[] {
  const langName = language === 'en' ? 'English' : 'Japanese';
  const examStandard = language === 'en' ? 'IELTS' : 'JSST';

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
5. Ask follow-up questions to maintain dialogue flow.
6. Stay in character for the scenario at all times.`;

  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  // Add conversation history
  for (const turn of conversationHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }

  return messages;
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
