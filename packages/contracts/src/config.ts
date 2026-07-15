// ============================================================
// Configuration Schema - Realtime Speak Coach
// ============================================================

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  wsPort: number;
  mock: boolean;

  mocks: {
    auth: boolean;
    voice: boolean;
    llm: boolean;
    review: boolean;
  };

  jwt: {
    secret: string;
    expiresIn: string;
  };

  wx: {
    appId: string;
    appSecret: string;
  };

  deepseek: {
    apiKey: string;
    baseUrl: string;
    modelFlash: string;
    modelPro: string;
  };

  gemini: {
    apiKey: string;
    modelFlash: string;
    modelPro: string;
  };

  volcVoice: {
    apiKey: string;
    appKey: string;
    asrWsUrl: string;
    asrResourceId: string;
    ttsWsUrl: string;
    ttsResourceId: string;
    ttsVoiceEn: string;
    ttsVoiceJa: string;
    ttsModel: string;
    ttsFormat: 'mp3' | 'ogg_opus' | 'pcm' | 'wav';
    ttsSampleRate: number;
    /** Backward-compatible alias. Prefer asrWsUrl/ttsWsUrl for new code. */
    wsUrl: string;
  };

  database: {
    url: string;
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value === 'true';
}

function hasSecret(value: string | undefined): boolean {
  return !!value
    && !value.startsWith('your_')
    && !value.endsWith('_here')
    && !value.startsWith('replace-')
    && !value.startsWith('change-me');
}

function defaultDatabaseUrl(env: Record<string, string | undefined>): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  // Keep the default stable no matter whether the server is started from the
  // workspace root, from packages/server, or from built production files.
  const cwd = env.INIT_CWD || env.PWD || '.';
  return `file:${cwd.replace(/\/$/, '')}/prisma/dev.db`;
}

/** Load config from environment variables with defaults */
export function buildConfigFromEnv(env: Record<string, string | undefined>): AppConfig {
  const mock = parseBool(env.MOCK, false);

  return {
    env: (env.NODE_ENV as AppConfig['env']) || 'development',
    port: parseInt(env.PORT || '3000', 10),
    host: env.HOST || '127.0.0.1',
    wsPort: parseInt(env.WS_PORT || '3001', 10),
    mock,

    mocks: {
      auth: parseBool(env.MOCK_AUTH, mock || !hasSecret(env.WX_APP_SECRET)),
      voice: parseBool(env.MOCK_VOICE, mock),
      llm: parseBool(env.MOCK_LLM, mock),
      review: parseBool(env.MOCK_REVIEW, mock),
    },

    jwt: {
      secret: env.JWT_SECRET || 'dev-secret-change-me',
      expiresIn: env.JWT_EXPIRES_IN || '7d',
    },

    wx: {
      appId: env.WX_APP_ID || 'wxTESTAPPID',
      appSecret: env.WX_APP_SECRET || '',
    },

    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY || '',
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      modelFlash: env.DEEPSEEK_MODEL_FLASH || 'deepseek-v4-flash',
      modelPro: env.DEEPSEEK_MODEL_PRO || 'deepseek-v4-pro',
    },

    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      modelFlash: env.GEMINI_MODEL_FLASH || 'gemini-3.5-flash',
      modelPro: env.GEMINI_MODEL_PRO || 'gemini-3.1-pro',
    },

    volcVoice: {
      apiKey: env.VOLC_VOICE_API_KEY || '',
      appKey: env.VOLC_VOICE_APP_KEY || '',
      asrWsUrl: env.VOLC_ASR_WS_URL || env.VOLC_VOICE_WS_URL || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream',
      asrResourceId: env.VOLC_ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration',
      ttsWsUrl: env.VOLC_TTS_WS_URL || 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
      ttsResourceId: env.VOLC_TTS_RESOURCE_ID || 'seed-tts-1.0',
      ttsVoiceEn: env.VOLC_TTS_VOICE_EN || 'en_female_amanda_mars_bigtts',
      ttsVoiceJa: env.VOLC_TTS_VOICE_JA || 'multi_female_shuangkuaisisi_moon_bigtts',
      ttsModel: env.VOLC_TTS_MODEL || 'seed-tts-1.1',
      ttsFormat: (env.VOLC_TTS_FORMAT as AppConfig['volcVoice']['ttsFormat']) || 'mp3',
      ttsSampleRate: parseInt(env.VOLC_TTS_SAMPLE_RATE || '24000', 10),
      wsUrl: env.VOLC_VOICE_WS_URL || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream',
    },

    database: {
      url: defaultDatabaseUrl(env),
    },
  };
}
