// config.ts
// Mini program runtime endpoint configuration.
//
// Before publishing a trial/release build, set PRODUCTION_SERVER_ORIGIN to the
// HTTPS domain of the deployed server, for example: https://api.example.com
// The app will derive /api/v1 and /ws from this origin.

const DEVELOPMENT_SERVER_ORIGIN = 'http://localhost:3000';
const PRODUCTION_SERVER_ORIGIN = '';

export interface EndpointConfig {
  apiUrl: string;
  wsUrl: string;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, '');
}

function toWsOrigin(origin: string) {
  if (origin.startsWith('https://')) return origin.replace(/^https:\/\//, 'wss://');
  if (origin.startsWith('http://')) return origin.replace(/^http:\/\//, 'ws://');
  return origin;
}

function getMiniProgramEnvVersion() {
  try {
    return wx.getAccountInfoSync?.().miniProgram?.envVersion || 'develop';
  } catch {
    return 'develop';
  }
}

function getConfiguredOrigin() {
  const storedOrigin = wx.getStorageSync('serverOrigin');
  if (storedOrigin) return trimTrailingSlash(String(storedOrigin));

  const envVersion = getMiniProgramEnvVersion();
  if (envVersion === 'release' || envVersion === 'trial') {
    return trimTrailingSlash(PRODUCTION_SERVER_ORIGIN || DEVELOPMENT_SERVER_ORIGIN);
  }

  return trimTrailingSlash(DEVELOPMENT_SERVER_ORIGIN);
}

export function getEndpointConfig(): EndpointConfig {
  const storedApiUrl = wx.getStorageSync('apiUrl');
  const storedWsUrl = wx.getStorageSync('wsUrl');
  const origin = getConfiguredOrigin();

  return {
    apiUrl: storedApiUrl ? trimTrailingSlash(String(storedApiUrl)) : `${origin}/api/v1`,
    wsUrl: storedWsUrl ? trimTrailingSlash(String(storedWsUrl)) : `${toWsOrigin(origin)}/ws`,
  };
}

export function isProductionEndpointConfigured() {
  return !!PRODUCTION_SERVER_ORIGIN;
}
