// Mini program runtime configuration.
//
// The Echoia service runs in the same CloudBase environment that is associated
// with this mini program. Mini program API and WebSocket traffic therefore uses
// wx.cloud.callContainer / wx.cloud.connectContainer instead of public domains.

export const CLOUDBASE_ENV_ID = 'code-realtime-d7gbuxrbze297e600';
export const CLOUDBASE_SERVICE_NAME = 'echoia-server';

// Kept for Web preview and release verification. The mini program itself uses
// the bound CloudBase environment and does not rely on this public URL.
const PRODUCTION_SERVER_ORIGIN = 'https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com';
const DEVELOPMENT_SERVER_ORIGIN = 'http://localhost:3000';

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

export function getCloudContainerConfig() {
  return {
    env: CLOUDBASE_ENV_ID,
    service: CLOUDBASE_SERVICE_NAME,
  };
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
  const origin = getConfiguredOrigin();
  return {
    apiUrl: `${origin}/api/v1`,
    wsUrl: `${toWsOrigin(origin)}/ws`,
  };
}

export function isProductionEndpointConfigured() {
  return !!PRODUCTION_SERVER_ORIGIN;
}

export function assertEndpointConfigReady(_config: EndpointConfig) {
  return true;
}
