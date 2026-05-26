// utils/api.ts
// HTTP request wrapper with retry logic

import { globalData } from '../app';

interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

const DEFAULT_RETRY_COUNT = 3;
const RETRY_DELAY = 1000;

// Mock data for API responses
const mockData = {
  scenarios: [
    { id: '1', category: 'daily', title: 'Greeting', description: 'Practice basic greetings', difficulty: 'beginner' },
    { id: '2', category: 'daily', title: 'Ordering Food', description: 'Practice ordering food in a restaurant', difficulty: 'beginner' },
    { id: '3', category: 'travel', title: 'Asking for Directions', description: 'Practice asking for directions', difficulty: 'intermediate' },
    { id: '4', category: 'travel', title: 'Hotel Check-in', description: 'Practice checking into a hotel', difficulty: 'intermediate' },
  ],
  review: {
    id: '123',
    status: 'completed',
    score: 85,
    radar: { pronunciation: 80, fluency: 90, vocabulary: 85, grammar: 75, coherence: 90 },
    comment: 'Great job! You have a good command of basic conversation skills.',
    highlights: ['Clear pronunciation', 'Good vocabulary range'],
    suggestions: ['Practice more complex sentence structures', 'Improve grammar accuracy'],
    corrections: [
      { user: 'I go to park yesterday', native: 'I went to the park yesterday' },
      { user: 'He like coffee', native: 'He likes coffee' },
    ],
  },
};

export async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: any, retries = DEFAULT_RETRY_COUNT): Promise<T> {
  const { apiUrl, token } = globalData;
  const url = `${apiUrl}${path}`;

  // Return mock data if server is not available
  if (path === '/scenarios' && method === 'GET') {
    return new Promise((resolve) => {
      setTimeout(() => resolve(mockData.scenarios as unknown as T), 500);
    });
  }

  if (path.startsWith('/reviews/') && method === 'GET') {
    return new Promise((resolve) => {
      setTimeout(() => resolve(mockData.review as unknown as T), 500);
    });
  }

  try {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        data,
        header: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        success: (res) => {
          const response = res.data as ApiResponse<T>;
          if (response.code === 0) {
            resolve(response.data);
          } else {
            reject(new Error(response.message || 'API request failed'));
          }
        },
        fail: (err) => {
          if (retries > 0) {
            setTimeout(() => {
              request(method, path, data, retries - 1)
                .then(resolve)
                .catch(reject);
            }, RETRY_DELAY);
          } else {
            reject(new Error(`Request failed after ${DEFAULT_RETRY_COUNT} retries: ${err.errMsg}`));
          }
        },
      });
    });
  } catch (error) {
    throw new Error(`API request error: ${(error as Error).message}`);
  }
}

// API methods

// User
export async function setUserLanguage(language: string) {
  return request('POST', '/user/language', { language });
}

// Scenarios
export async function getScenarios() {
  return request('GET', '/scenarios');
}

// Review
export async function getReview(sessionId: string) {
  return request('GET', `/reviews/${sessionId}`);
}