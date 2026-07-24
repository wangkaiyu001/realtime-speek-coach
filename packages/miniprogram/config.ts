// Mini program runtime configuration.
//
// Echoia currently ships as a public-trial mini program. Trial/release builds
// use the stable public HTTPS/WSS endpoint until this WeChat account is linked
// to the Tencent-created CloudBase environment. CloudBase container transport
// remains available for development and for the future linked configuration.

export const CLOUDBASE_ENV_ID = 'code-realtime-d7gbuxrbze297e600';
export const CLOUDBASE_SERVICE_NAME = 'echoia-server';

// Keep the public transport available for trial/release builds until the
// WeChat Mini Program account is explicitly associated with this Tencent
// Cloud-created environment. Direct CloudBase container calls remain the
// preferred path once that association is active.
export const ENABLE_PUBLIC_TRANSPORT_FALLBACK = true;

// The uploaded build is a public-trial release candidate. Prefer the stable
// public transport immediately so a missing Tencent-created environment link
// cannot block login before the fallback is reached. Set this to false after
// the mini program is explicitly associated with the CloudBase environment.
export const PREFER_PUBLIC_TRANSPORT_FOR_RELEASE = true;

// Stable public endpoint used by the Web trial, release verification, and the
// mini program trial/release transport while CloudBase linking is pending.
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
