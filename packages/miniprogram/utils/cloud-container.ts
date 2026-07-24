import { ENABLE_PUBLIC_TRANSPORT_FALLBACK, getCloudContainerConfig, getEndpointConfig, isReleaseLikeEnv } from '../config';

export class CloudContainerError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 0) {
    super(message);
    this.name = 'CloudContainerError';
    this.statusCode = statusCode;
  }
}

function normalizeResponse<T>(value: unknown): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new CloudContainerError('服务返回内容异常，请稍后再试。');
    }
  }

  return value as T;
}

function normalizeHttpResponse<T>(response: WechatMiniprogram.RequestSuccessCallbackResult): T {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    let body = response.data as { message?: string; error?: string; code?: string } | undefined;
    if (typeof response.data === 'string') {
      try {
        body = JSON.parse(response.data) as { message?: string; error?: string; code?: string };
      } catch {
        body = { error: response.data };
      }
    }
    throw new CloudContainerError(
      body?.message || body?.error || `服务请求失败（${response.statusCode}）`,
      response.statusCode,
    );
  }
  return normalizeResponse<T>(response.data);
}

function requestPublicEndpoint<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer,
  header: Record<string, string> = {},
): Promise<T> {
  const { apiUrl } = getEndpointConfig();
  const normalizedPath = path.startsWith('/api/v1') ? path.slice('/api/v1'.length) : path;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiUrl}${normalizedPath}`,
      method,
      data,
      header: { 'Content-Type': 'application/json', ...header },
      success: (response) => {
        try {
          resolve(normalizeHttpResponse<T>(response));
        } catch (error) {
          reject(error);
        }
      },
      fail: (error) => reject(new CloudContainerError(error.errMsg || '公网服务调用失败')),
    });
  });
}

function shouldFallbackContainer(error: unknown) {
  if (!ENABLE_PUBLIC_TRANSPORT_FALLBACK || !isReleaseLikeEnv()) return false;
  if (!(error instanceof CloudContainerError) || error.statusCode !== 0) return false;
  const message = error.message.toLowerCase();
  return message.includes('callcontainer')
    || message.includes('cloud')
    || message.includes('environment')
    || message.includes('env')
    || message.includes('not found')
    || message.includes('permission');
}

export async function callContainer<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer,
  header: Record<string, string> = {},
): Promise<T> {
  const { env, service } = getCloudContainerConfig();
  let response: { data: unknown; statusCode: number };
  try {
    response = await wx.cloud.callContainer({
      config: { env },
      path,
      method,
      data,
      dataType: 'text',
      header: {
        'Content-Type': 'application/json',
        'X-WX-SERVICE': service,
        ...header,
      },
    });
  } catch (error) {
    const detail = error && typeof error === 'object' && 'errMsg' in error
      ? String(error.errMsg)
      : '云托管调用失败';
    const containerError = new CloudContainerError(detail);
    if (shouldFallbackContainer(containerError)) {
      return requestPublicEndpoint<T>(path, method, data, header);
    }
    throw containerError;
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    let body = response.data as { message?: string; error?: string; code?: string } | undefined;
    if (typeof response.data === 'string') {
      try {
        body = JSON.parse(response.data) as { message?: string; error?: string; code?: string };
      } catch {
        body = { error: response.data };
      }
    }
    throw new CloudContainerError(
      body?.message || body?.error || `服务请求失败（${response.statusCode}）`,
      response.statusCode,
    );
  }

  return normalizeResponse<T>(response.data);
}

function publicWebSocketUrl(path: string) {
  const { wsUrl } = getEndpointConfig();
  if (path === '/ws') return wsUrl;
  return `${wsUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function shouldFallbackSocket(error: unknown) {
  if (!ENABLE_PUBLIC_TRANSPORT_FALLBACK || !isReleaseLikeEnv()) return false;
  if (!(error instanceof CloudContainerError)) return false;
  const message = error.message.toLowerCase();
  return message.includes('connectcontainer')
    || message.includes('cloud')
    || message.includes('environment')
    || message.includes('env')
    || message.includes('not found')
    || message.includes('permission');
}

export async function connectContainerSocket(path: string, token: string): Promise<WechatMiniprogram.SocketTask> {
  const { env, service } = getCloudContainerConfig();
  try {
    const response = await wx.cloud.connectContainer({
      config: { env },
      service,
      path,
      header: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.socketTask;
  } catch (error) {
    const detail = error && typeof error === 'object' && 'errMsg' in error
      ? String(error.errMsg)
      : '云托管实时连接失败';
    const containerError = new CloudContainerError(detail);
    if (!shouldFallbackSocket(containerError)) throw containerError;

    try {
      return wx.connectSocket({
        url: publicWebSocketUrl(path),
        header: { Authorization: `Bearer ${token}` },
      });
    } catch (fallbackError) {
      const fallbackDetail = fallbackError && typeof fallbackError === 'object' && 'errMsg' in fallbackError
        ? String(fallbackError.errMsg)
        : '公网实时连接失败';
      throw new CloudContainerError(fallbackDetail);
    }
  }
}
