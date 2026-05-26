import { ReviewReport, ReviewDimensions, TurnCorrection } from '../../../contracts/src/api.js';

export const mockReview: ReviewReport = {
  dimensions: {
    pronunciation_accuracy: 82,
    grammar: 76,
    vocabulary: 85,
    fluency: 78,
    interaction: 88
  },
  overallComment: "Your English speaking is quite good, with a wide range of vocabulary and good interaction skills. However, there are some grammar mistakes and pronunciation issues with certain words. 你的英语口语相当不错，词汇量丰富，互动能力强。但是，存在一些语法错误和某些单词的发音问题。",
  highlights: [
    "You used a variety of vocabulary related to daily life",
    "Your interaction with the AI was natural and appropriate",
    "You maintained a good pace during the conversation"
  ],
  suggestions: [
    "Practice the pronunciation of 'ed' endings in past tense verbs",
    "Be careful with article usage (a/an/the)",
    "Try to use more complex sentence structures"
  ],
  corrections: [
    {
      turnIndex: 0,
      userSaid: "I eat breakfast at 7 o'clock yesterday",
      nativeSay: "I ate breakfast at 7 o'clock yesterday",
      correctionReason: "Past tense should be used for yesterday",
      category: "grammar"
    },
    {
      turnIndex: 1,
      userSaid: "I go to park every Sunday",
      nativeSay: "I go to the park every Sunday",
      correctionReason: "Missing article 'the' before 'park'",
      category: "grammar"
    },
    {
      turnIndex: 3,
      userSaid: "I very happy today",
      nativeSay: "I am very happy today",
      correctionReason: "Missing verb 'am' in the sentence",
      category: "grammar"
    }
  ]
};
