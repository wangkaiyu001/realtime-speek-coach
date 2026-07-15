import { describe, expect, test } from 'vitest';
import { isAcceptableAsrTextForLanguage } from '../ws/asr-language.js';

describe('ASR target language guard', () => {
  test('accepts natural Japanese with kana', () => {
    expect(isAcceptableAsrTextForLanguage('ホットコーヒーを一つお願いします。', 'ja')).toBe(true);
    expect(isAcceptableAsrTextForLanguage('コーヒーお願いします', 'ja')).toBe(true);
    expect(isAcceptableAsrTextForLanguage('駅へ行きたいです。', 'ja')).toBe(true);
  });

  test('blocks Chinese ASR output in Japanese practice', () => {
    expect(isAcceptableAsrTextForLanguage('我要一杯热咖啡', 'ja')).toBe(false);
    expect(isAcceptableAsrTextForLanguage('请给我一个袋子', 'ja')).toBe(false);
    expect(isAcceptableAsrTextForLanguage('谢谢，不需要发票', 'ja')).toBe(false);
  });

  test('blocks English ASR output in Japanese practice', () => {
    expect(isAcceptableAsrTextForLanguage('I would like a hot coffee.', 'ja')).toBe(false);
    expect(isAcceptableAsrTextForLanguage('Can I have a coffee please?', 'ja')).toBe(false);
    expect(isAcceptableAsrTextForLanguage('Please give me a receipt.', 'ja')).toBe(false);
  });

  test('accepts Japanese romaji fallbacks in Japanese practice', () => {
    expect(isAcceptableAsrTextForLanguage('Koohii o hitotsu kudasai.', 'ja')).toBe(true);
    expect(isAcceptableAsrTextForLanguage('Hotto de onegai shimasu.', 'ja')).toBe(true);
    expect(isAcceptableAsrTextForLanguage('Arigatou gozaimasu.', 'ja')).toBe(true);
  });

  test('accepts English but blocks mostly CJK text in English practice', () => {
    expect(isAcceptableAsrTextForLanguage('I would like a hot latte.', 'en')).toBe(true);
    expect(isAcceptableAsrTextForLanguage('我要一杯咖啡', 'en')).toBe(false);
  });
});
