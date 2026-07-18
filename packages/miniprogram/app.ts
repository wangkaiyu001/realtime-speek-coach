// app.ts
// App entry file

export interface IAppOption {
  globalData: {
    token: string;
    userId: string;
    language: string;
    level: string;
    wsUrl: string;
    apiUrl: string;
  };
}

import { assertEndpointConfigReady, getEndpointConfig, getMiniProgramEnvVersion, isProductionEndpointConfigured } from './config';

interface LoginResponse {
  token: string;
  userId: string;
  isNewUser: boolean;
  language?: string;
  level?: string | number;
}

export const globalData: IAppOption['globalData'] = {
  token: '',
  userId: '',
  language: '',
  level: 'beginner',
  wsUrl: '',
  apiUrl: '',
};

function navigateByProfile(language?: string) {
  wx.reLaunch({
    url: language ? '/pages/hub/index' : '/pages/onboarding/index',
  });
}

function saveLoginState(data: LoginResponse) {
  globalData.token = data.token;
  globalData.userId = data.userId;
  globalData.language = data.language || '';
  globalData.level = data.level ? String(data.level) : 'beginner';

  wx.setStorageSync('token', data.token);
  wx.setStorageSync('userId', data.userId);
  if (data.language) {
    wx.setStorageSync('language', data.language);
  } else {
    wx.removeStorageSync('language');
  }
  wx.setStorageSync('level', globalData.level);
}

function restoreCachedLogin() {
  const cachedToken = wx.getStorageSync('token');
  const cachedUserId = wx.getStorageSync('userId');
  const cachedLanguage = wx.getStorageSync('language');
  const cachedLevel = wx.getStorageSync('level');

  if (!cachedToken || !cachedUserId) {
    return false;
  }

  globalData.token = cachedToken;
  globalData.userId = cachedUserId;
  globalData.language = cachedLanguage || '';
  globalData.level = cachedLevel || 'beginner';
  navigateByProfile(globalData.language);
  return true;
}

function completeLogin(code: string, navigate = true): Promise<LoginResponse> {
  return new Promise((resolve, reject) => {
    if (!globalData.apiUrl) {
      reject(new Error('服务地址还没有准备好'));
      return;
    }

    wx.request({
      url: `${globalData.apiUrl}/auth/login`,
      method: 'POST',
      data: { code },
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`登录失败（${res.statusCode}）`));
          return;
        }

        const data = res.data as LoginResponse;
        if (!data || !data.token || !data.userId) {
          reject(new Error('登录响应异常'));
          return;
        }

        saveLoginState(data);
        if (navigate) navigateByProfile(data.language);
        resolve(data);
      },
      fail: (error) => reject(new Error(error.errMsg || '网络连接失败')),
    });
  });
}

export function refreshLogin(): Promise<LoginResponse> {
  return new Promise((resolve, reject) => {
    const envVersion = getMiniProgramEnvVersion();
    const isReleaseLike = envVersion === 'release' || envVersion === 'trial';
    if (!isReleaseLike) {
      completeLogin(wx.getStorageSync('mockLoginCode') || 'dev-user-001', false).then(resolve).catch(reject);
      return;
    }

    wx.login({
      success: (res) => {
        if (!res.code) {
          reject(new Error('微信登录没有返回有效凭证'));
          return;
        }
        completeLogin(res.code, false).then(resolve).catch(reject);
      },
      fail: (error) => reject(new Error(error.errMsg || '微信登录失败')),
    });
  });
}

function bootstrapLogin() {
  refreshLogin()
    .then((data) => navigateByProfile(data.language))
    .catch(() => {
      const isReleaseLike = getMiniProgramEnvVersion() === 'release' || getMiniProgramEnvVersion() === 'trial';
      wx.showToast({
        title: isReleaseLike ? '服务暂时不可用，请稍后重试' : '请先启动本地服务',
        icon: 'none',
      });
      if (!restoreCachedLogin()) navigateByProfile('');
    });
}

App<IAppOption>({
  globalData,

  onLaunch() {
    const endpoints = getEndpointConfig();
    globalData.apiUrl = endpoints.apiUrl;
    globalData.wsUrl = endpoints.wsUrl;

    const envVersion = getMiniProgramEnvVersion();
    if ((envVersion === 'release' || envVersion === 'trial') && !isProductionEndpointConfigured()) {
      console.error('[App] PRODUCTION_SERVER_ORIGIN is not configured for release/trial build.');
    }

    if (!assertEndpointConfigReady(endpoints)) {
      return;
    }

    bootstrapLogin();
  },
});
