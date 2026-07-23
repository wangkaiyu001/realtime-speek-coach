import { getCloudContainerConfig } from '../config';

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
    throw new CloudContainerError(detail);
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
    throw new CloudContainerError(detail);
  }
}
