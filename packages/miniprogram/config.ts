// config.ts
// Mini program runtime endpoint configuration.
//
// Before publishing a trial/release build, set PRODUCTION_SERVER_ORIGIN to the
// HTTPS domain of the deployed server, for example: https://api.example.com
// The app will derive /api/v1 and /ws from this origin.
//
// If PRODUCTION_SERVER_ORIGIN is left empty, trial/release builds intentionally
// fail fast instead of silently pointing users to a local development server.
// For preview testing, set wx storage key `serverOrigin`, `apiUrl`, or `wsUrl`
// from DevTools before launching the mini program.

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

export function getMiniProgramEnvVersion() {
  try {
    return wx.getAccountInfoSync?.().miniProgram?.envVersion || 'develop';
  } catch {
    return 'develop';
  }
}

export function isReleaseLikeEnv() {
  const envVersion = getMiniProgramEnvVersion();
  return envVersion === 'release' || envVersion === 'trial';
}

export function getConfiguredOrigin() {
  const storedOrigin = wx.getStorageSync('serverOrigin');
  if (storedOrigin) return trimTrailingSlash(String(storedOrigin));

  if (isReleaseLikeEnv()) {
    return PRODUCTION_SERVER_ORIGIN ? trimTrailingSlash(PRODUCTION_SERVER_ORIGIN) : '';
  }

  return trimTrailingSlash(PRODUCTION_SERVER_ORIGIN || DEVELOPMENT_SERVER_ORIGIN);
}

export function getEndpointConfig(): EndpointConfig {
  const storedApiUrl = wx.getStorageSync('apiUrl');
  const storedWsUrl = wx.getStorageSync('wsUrl');
  const origin = getConfiguredOrigin();

  if (!origin && (!storedApiUrl || !storedWsUrl)) {
    return { apiUrl: '', wsUrl: '' };
  }

  return {
    apiUrl: storedApiUrl ? trimTrailingSlash(String(storedApiUrl)) : `${origin}/api/v1`,
    wsUrl: storedWsUrl ? trimTrailingSlash(String(storedWsUrl)) : `${toWsOrigin(origin)}/ws`,
  };
}

export function isProductionEndpointConfigured() {
  return !!PRODUCTION_SERVER_ORIGIN;
}

export function assertEndpointConfigReady(config: EndpointConfig) {
  if (config.apiUrl && config.wsUrl) return true;

  if (isReleaseLikeEnv()) {
    wx.showModal({
      title: '服务地址未配置',
      content: '当前体验版/正式版没有配置生产服务地址，请联系管理员发布正确的后端域名。',
      showCancel: false,
    });
    return false;
  }

  wx.showToast({ title: '请先配置或启动本地服务', icon: 'none' });
  return false;
}
