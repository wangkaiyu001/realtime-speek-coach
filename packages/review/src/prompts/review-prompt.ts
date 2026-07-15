const FEW_SHOT_EXAMPLE = `{
  "dimensions": {
    "pronunciation": 85,
    "grammar": 78,
    "vocabulary": 82,
    "fluency": 75,
    "interaction": 80
  },
  "overallComment": "Your speaking is generally good. You have a wide vocabulary and good interaction skills. However, there are some grammar mistakes and pronunciation issues with certain words.",
  "highlights": [
    "You used a variety of vocabulary related to travel",
    "Your interaction with the AI was natural and appropriate"
  ],
  "suggestions": [
    "Practice the pronunciation of 'th' sounds",
    "Be careful with subject-verb agreement in complex sentences"
  ],
  "corrections": [
    {
      "turnIndex": 0,
      "userSaid": "I go to park yesterday",
      "nativeSay": "I went to the park yesterday",
      "correctionReason": "Past tense should be used for yesterday",
      "category": "grammar"
    },
    {
      "turnIndex": 2,
      "userSaid": "I very like this place",
      "nativeSay": "I really like this place",
      "correctionReason": "'Very' cannot modify verbs directly; use 'really' instead",
      "category": "vocabulary"
    }
  ]
}`;

export function buildReviewPrompt(
  language: string,
  level: string,
  turns: { userText: string; aiText: string }[]
): { role: string; content: string }[] {
  const turnTranscripts = turns.map((turn, index) => `Turn ${index}:
User: ${turn.userText}
AI: ${turn.aiText}`).join('\n\n');

  const systemPrompt = `You are an expert IELTS/JSST examiner. Analyze the user's speaking performance and provide a comprehensive review. Follow these instructions strictly:

1. Evaluate the user's performance across 5 dimensions (score 0-100):
   - pronunciation: How accurate is the user's pronunciation?
   - grammar: How correct is the user's grammar?
   - vocabulary: How appropriate and varied is the user's vocabulary?
   - fluency: How smooth and natural is the user's speech?
   - interaction: How well does the user interact with the AI?

2. Provide an overall_comment (2-3 sentences in \${language} with Chinese translation)

3. List 2-3 highlights (things the user did well)

4. List 2-3 suggestions (areas for improvement)

5. For each user turn with errors, provide a correction with:
   - turnIndex: The index of the turn (0-based)
   - userSaid: What the user said
   - nativeSay: The correct native speaker version
   - correctionReason: Explanation of the correction
   - category: One of [pronunciation, grammar, vocabulary, fluency, interaction]

6. Output ONLY a valid JSON object matching the ReviewReport schema. Do NOT include any other text.

Example output:
${FEW_SHOT_EXAMPLE}`;

  const userPrompt = `Analyze the following conversation (language: ${language}, level: ${level}):

${turnTranscripts}

Provide your analysis as a JSON object.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}
