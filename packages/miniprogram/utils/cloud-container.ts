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
  const response = await wx.cloud.callContainer({
    config: { env },
    service,
    path,
    method,
    data,
    header: {
      'Content-Type': 'application/json',
      ...header,
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const body = response.data as { message?: string; error?: string } | undefined;
    throw new CloudContainerError(
      body?.message || body?.error || `服务请求失败（${response.statusCode}）`,
      response.statusCode,
    );
  }

  return normalizeResponse<T>(response.data);
}

export async function connectContainerSocket(path: string, token: string): Promise<WechatMiniprogram.SocketTask> {
  const { env, service } = getCloudContainerConfig();
  const response = await wx.cloud.connectContainer({
    config: { env },
    service,
    path,
    header: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.socketTask;
}
