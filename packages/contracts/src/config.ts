// ============================================================
// Configuration Schema - Realtime Speak Coach
// ============================================================

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  wsPort: number;
  mock: boolean;

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
    wsUrl: string;
  };

  database: {
    url: string;
  };
}

/** Load config from environment variables with defaults */
export function buildConfigFromEnv(env: Record<string, string | undefined>): AppConfig {
  return {
    env: (env.NODE_ENV as AppConfig['env']) || 'development',
    port: parseInt(env.PORT || '3000', 10),
    wsPort: parseInt(env.WS_PORT || '3001', 10),
    mock: env.MOCK === '1' || env.MOCK === 'true',

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
      wsUrl: env.VOLC_VOICE_WS_URL || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    },

    database: {
      url: env.DATABASE_URL || 'file:../prisma/dev.db',
    },
  };
}
