import type { Language } from '../../../contracts/src/ws.js';

const HIRAGANA_RE = /[\u3040-\u309f]/g;
const KATAKANA_RE = /[\u30a0-\u30ff\uff66-\uff9f]/g;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const LATIN_RE = /[A-Za-z]/g;
const MEANINGFUL_RE = /[\p{L}\p{N}]/gu;

const CHINESE_SIGNAL_RE = /(?:我|你|您|他|她|们|的|了|吗|呢|吧|请|谢谢|您好|你好|咖啡|热|冰|冷|一个|一杯|给我|我要|想要|有没有|可以|多少|这里|这个|那个|什么|怎么|为什么|袋子|不要|需要|发票|收据|付款|支付|扫码|菜单|推荐|好喝|加糖|加奶)/;
const ENGLISH_PHRASE_RE = /\b(?:i\s+(?:would|want|need|like|am|will|can|could|have)|can\s+i|could\s+i|do\s+you|would\s+you|thank\s+you|how\s+(?:much|many|do)|what\s+(?:is|are|do)|where\s+(?:is|are|can)|please\b)\b/i;

const ENGLISH_SIGNAL_WORDS = new Set([
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'the', 'a', 'an', 'is', 'are', 'am', 'be', 'do', 'does', 'did',
  'would', 'could', 'can', 'may', 'might', 'want', 'need', 'like', 'have', 'has', 'had', 'please', 'thanks',
  'thank', 'hello', 'hi', 'yes', 'no', 'hot', 'iced', 'ice', 'coffee', 'latte', 'milk', 'sugar', 'bag', 'receipt',
  'card', 'cash', 'pay', 'buy', 'order', 'recommend', 'menu', 'much', 'many', 'what', 'where', 'when', 'why', 'how',
]);

const ROMAJI_SIGNAL_WORDS = new Set([
  'ai', 'aisu', 'arigato', 'arigatou', 'arimasu', 'chotto', 'daijoubu', 'de', 'desu', 'dochira', 'dozo', 'douzo',
  'fukuro', 'ga', 'gozaimasu', 'hai', 'haraemasu', 'hitotsu', 'hotto', 'ikura', 'irimasen', 'ka', 'kaado',
  'kashikomarimashita', 'kimasu', 'kore', 'koohii', 'kudasai', 'masu', 'mata', 'miruku', 'mo', 'nasaimasu', 'ne',
  'ni', 'nomimasu', 'o', 'onegai', 'pan', 'reshiito', 'satou', 'shimasu', 'sumimasen', 'tabemasu', 'to', 'wa',
  'watashi', 'wo', 'yoroshiku',
]);

const STRONG_ROMAJI_SIGNAL_RE = /\b(?:arigato(?:u)?|sumimasen|onegai|kudasai|desu|masu|gozaimasu|koohii|hotto|aisu|miruku|satou|fukuro|reshiito|kaado|kashikomarimashita|daijoubu|hitotsu|dochira|nasaimasu|irimasen|haraemasu|watashi|yoroshiku)\b/i;

function countMatches(text: string, regex: RegExp) {
  return text.match(regex)?.length || 0;
}

function latinTokens(text: string) {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function countTokenSignals(tokens: string[], signals: Set<string>) {
  return tokens.reduce((count, token) => count + (signals.has(token) ? 1 : 0), 0);
}

function isLikelyRomajiJapanese(text: string) {
  const tokens = latinTokens(text);
  if (!tokens.length) return false;

  const romajiScore = countTokenSignals(tokens, ROMAJI_SIGNAL_WORDS);
  const englishScore = countTokenSignals(tokens, ENGLISH_SIGNAL_WORDS);
  const hasStrongRomajiSignal = STRONG_ROMAJI_SIGNAL_RE.test(text);
  const hasEnglishPhrase = ENGLISH_PHRASE_RE.test(text);

  if (hasEnglishPhrase && !hasStrongRomajiSignal && romajiScore < 2) return false;
  if (englishScore >= 2 && !hasStrongRomajiSignal && romajiScore < 2) return false;
  if (hasStrongRomajiSignal || romajiScore >= 2) return true;

  // Unknown Latin output in a Japanese session is more dangerous than helpful:
  // it usually means ASR translated/recognized into another language, and would
  // pollute the role-play if sent to the coach.
  return false;
}

export function isAcceptableAsrTextForLanguage(text: string, language: Language) {
  const normalized = text.trim();
  if (!normalized) return false;

  const cjkCount = countMatches(normalized, CJK_RE);
  const meaningfulCount = countMatches(normalized, MEANINGFUL_RE) || normalized.length;

  if (language === 'en') {
    return cjkCount === 0 || cjkCount / meaningfulCount < 0.2;
  }

  const kanaCount = countMatches(normalized, HIRAGANA_RE) + countMatches(normalized, KATAKANA_RE);
  if (kanaCount > 0) return true;

  const latinCount = countMatches(normalized, LATIN_RE);
  if (cjkCount === 0) return latinCount > 0 && isLikelyRomajiJapanese(normalized);

  if (CHINESE_SIGNAL_RE.test(normalized)) return false;

  return cjkCount < 2 || cjkCount / meaningfulCount < 0.35;
}

export function asrLanguageMismatchMessage(language: Language) {
  if (language === 'ja') {
    return '这次语音识别结果不像日语，已阻止发送给教练。请再说一次日语，或改用文本输入继续。';
  }

  return '这次语音识别语言不正确，已阻止发送给教练。请再说一次目标语言，或改用文本输入继续。';
}
