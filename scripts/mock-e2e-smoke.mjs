#!/usr/bin/env node

import WebSocket from 'ws';

const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1';
const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const LANGUAGE = process.env.SMOKE_LANGUAGE === 'ja' ? 'ja' : 'en';
const SCENARIO_ID = process.env.SMOKE_SCENARIO_ID || (LANGUAGE === 'ja' ? 'ja-shopping-01' : 'en-shopping-01');
const REQUESTED_TURNS = Number(process.env.SMOKE_TURNS || '0');
const ABORT_AFTER = Number(process.env.SMOKE_ABORT_AFTER || '0');
const LOGIN_CODE = process.env.SMOKE_LOGIN_CODE || `smoke-${LANGUAGE}`;
const REQUIRE_MOCK_LLM = process.env.SMOKE_REQUIRE_MOCK_LLM !== '0';
const REQUIRE_MOCK_REVIEW = process.env.SMOKE_REQUIRE_MOCK_REVIEW !== '0';
const REVIEW_REQUEST_TURNS = Number(process.env.SMOKE_REVIEW_REQUEST_TURNS || '0');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${options.method || 'GET'} ${path} returned non-JSON ${response.status}: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${text}`);
  }

  return body;
}

function waitFor(socket, predicate, timeoutMs = 15000, label = 'WebSocket frame') {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);

    const onMessage = (event) => {
      const frame = JSON.parse(event.data.toString());
      if (frame.type === 'error') {
        cleanup();
        reject(new Error(`Server error ${frame.code}: ${frame.message}`));
        return;
      }

      if (predicate(frame)) {
        cleanup();
        resolve(frame);
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
    }

    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
  });
}

function createFrameQueue(socket) {
  const buffered = [];
  const waiters = [];

  function settleWaiter(waiter, frame) {
    clearTimeout(waiter.timeout);
    waiter.resolve(frame);
  }

  function rejectWaiter(waiter, error) {
    clearTimeout(waiter.timeout);
    waiter.reject(error instanceof Error ? error : new Error(String(error)));
  }

  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(event.data.toString());
    if (frame.type === 'error') {
      while (waiters.length) {
        rejectWaiter(waiters.shift(), new Error(`Server error ${frame.code}: ${frame.message}`));
      }
      return;
    }

    for (let index = 0; index < waiters.length; index++) {
      const waiter = waiters[index];
      if (waiter.predicate(frame)) {
        waiters.splice(index, 1);
        settleWaiter(waiter, frame);
        return;
      }
    }

    buffered.push(frame);
  });

  socket.addEventListener('error', (error) => {
    while (waiters.length) rejectWaiter(waiters.shift(), error);
  });

  return {
    waitFor(predicate, timeoutMs = 15000, label = 'WebSocket frame') {
      const bufferedIndex = buffered.findIndex(predicate);
      if (bufferedIndex >= 0) {
        const [frame] = buffered.splice(bufferedIndex, 1);
        return Promise.resolve(frame);
      }

      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timeout: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error(`Timed out waiting for ${label}`));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

async function loginAndSelectLanguage(loginCode) {
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ code: loginCode }),
  });
  assert(login.token, 'Login did not return a token');

  await request('/user/language', {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ language: LANGUAGE }),
  });

  return login;
}

async function runPracticeSession(token, { abortAfter = 0, requestReviewOnAbort = false } = {}) {
  const socket = new WebSocket(`${WS_URL}?token=${token}`);
  const frames = createFrameQueue(socket);

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.send(JSON.stringify({
    type: 'hello',
    sessionId: '',
    scenarioId: SCENARIO_ID,
    language: LANGUAGE,
  }));

  const ready = await frames.waitFor((frame) => frame.type === 'ready', 15000, 'ready frame');
  assert(ready.sessionId, 'Ready frame did not include a sessionId');
  await frames.waitFor((frame) => frame.type === 'tts_chunk' && frame.isLast, 15000, 'opening TTS completion');

  const totalTurns = Number(ready.totalTurns || REQUESTED_TURNS || 10);
  const maxTurns = abortAfter > 0 ? abortAfter : (REQUESTED_TURNS > 0 ? Math.min(REQUESTED_TURNS, totalTurns) : totalTurns);
  for (let turnIndex = 1; turnIndex <= maxTurns; turnIndex++) {
    socket.send(JSON.stringify({ type: 'audio_chunk', data: Buffer.alloc(320).toString('base64'), seq: turnIndex }));
    socket.send(JSON.stringify({ type: 'audio_end', turnIndex }));

    await frames.waitFor((frame) => frame.type === 'asr_final' && frame.turnIndex === turnIndex, 15000, `ASR final for turn ${turnIndex}`);
    const turnEnd = await frames.waitFor((frame) => frame.type === 'turn_end' && frame.turnIndex === turnIndex, 20000, `turn_end for turn ${turnIndex}`);

    if (abortAfter > 0 && turnIndex === abortAfter) {
      socket.send(JSON.stringify({ type: 'abort', reason: 'user_exit', requestReview: requestReviewOnAbort }));
      let abortEnd;
      if (requestReviewOnAbort) {
        abortEnd = await frames.waitFor((frame) => frame.type === 'turn_end' && frame.reviewRequested, 10000, 'early-end review turn_end');
        assert(abortEnd.sessionComplete === true, 'Early-end review did not complete the session');
      }
      if (requestReviewOnAbort) {
        socket.close(1000, 'smoke abort');
      }
      return { sessionId: ready.sessionId, socket, abortEnd };
    }

    if (turnIndex < totalTurns) {
      assert(turnEnd.sessionComplete === false, `Turn ${turnIndex} completed the session too early`);
    } else {
      assert(turnEnd.sessionComplete === true, 'Final turn did not complete the session');
    }

    if (turnEnd.sessionComplete) {
      break;
    }
  }

  socket.close(1000, 'smoke complete');
  return { sessionId: ready.sessionId, socket };
}

async function runPartialSession(token, completedTurns) {
  const socket = new WebSocket(`${WS_URL}?token=${token}`);
  const frames = createFrameQueue(socket);

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.send(JSON.stringify({
    type: 'hello',
    sessionId: '',
    scenarioId: SCENARIO_ID,
    language: LANGUAGE,
  }));

  const ready = await frames.waitFor((frame) => frame.type === 'ready', 15000, 'partial ready frame');
  assert(ready.sessionId, 'Ready frame did not include a sessionId');
  await frames.waitFor((frame) => frame.type === 'tts_chunk' && frame.isLast, 15000, 'partial opening TTS completion');

  for (let turnIndex = 1; turnIndex <= completedTurns; turnIndex++) {
    socket.send(JSON.stringify({ type: 'audio_chunk', data: Buffer.alloc(320).toString('base64'), seq: turnIndex }));
    socket.send(JSON.stringify({ type: 'audio_end', turnIndex }));

    await frames.waitFor((frame) => frame.type === 'asr_final' && frame.turnIndex === turnIndex, 15000, `partial ASR final for turn ${turnIndex}`);
    const turnEnd = await frames.waitFor((frame) => frame.type === 'turn_end' && frame.turnIndex === turnIndex, 20000, `partial turn_end for turn ${turnIndex}`);
    assert(turnEnd.sessionComplete === false, `Partial session completed too early at turn ${turnIndex}`);
  }

  socket.close(1000, 'smoke partial');

  return { sessionId: ready.sessionId, socket };
}

async function main() {
  console.log(`Running smoke test against ${API_URL} and ${WS_URL}`);

  const health = await request('/health');
  assert(health.status === 'ok', 'Health check did not return ok');
  assert(health.mocks?.auth, 'MOCK_AUTH must be enabled for this smoke test');
  assert(health.mocks?.voice, 'MOCK_VOICE must be enabled for this smoke test');
  if (REQUIRE_MOCK_LLM) {
    assert(health.mocks?.llm, 'MOCK_LLM must be enabled for this smoke test. Set SMOKE_REQUIRE_MOCK_LLM=0 for hybrid real-LLM validation.');
  }
  if (REQUIRE_MOCK_REVIEW) {
    assert(health.mocks?.review, 'MOCK_REVIEW must be enabled for this smoke test. Set SMOKE_REQUIRE_MOCK_REVIEW=0 for real-review validation.');
  }

  const login = await loginAndSelectLanguage(LOGIN_CODE);

  const scenarios = await request('/scenarios', {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert(Array.isArray(scenarios.scenarios), 'Scenarios response is invalid');
  assert(scenarios.scenarios.some((scenario) => scenario.id === SCENARIO_ID), `Scenario ${SCENARIO_ID} not found`);

  const primarySession = await runPracticeSession(login.token, {
    abortAfter: ABORT_AFTER,
    requestReviewOnAbort: ABORT_AFTER > 0,
  });

  const review = await request(`/reviews/${primarySession.sessionId}`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert(review.review?.status === 'completed', `Review is not completed: ${review.review?.status}`);

  const sessions = await request('/sessions', {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert(Array.isArray(sessions.sessions), 'Sessions response is invalid');
  const savedSession = sessions.sessions.find((session) => session.id === primarySession.sessionId);
  assert(savedSession, 'Completed session was not returned in history');
  assert(savedSession.language === LANGUAGE, 'Session history language is invalid');
  assert(savedSession.hasReview === true, 'Completed session history did not expose review availability');

  if (REVIEW_REQUEST_TURNS > 0) {
    const partialLogin = await loginAndSelectLanguage(`${LOGIN_CODE}-request-review`);
    const partialSession = await runPartialSession(partialLogin.token, REVIEW_REQUEST_TURNS);

    const partialSessions = await request('/sessions', {
      headers: { Authorization: `Bearer ${partialLogin.token}` },
    });
    const partialSavedSession = partialSessions.sessions.find((session) => session.id === partialSession.sessionId);
    assert(partialSavedSession, 'Partial session was not returned in history');
    assert(partialSavedSession.turnsCompleted === REVIEW_REQUEST_TURNS, 'Partial session history has wrong turn count');
    assert(partialSavedSession.hasReview === false, 'Partial session should not have a review before explicit request');

    const requestReviewResponse = await request(`/reviews/${partialSession.sessionId}/request`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${partialLogin.token}` },
      body: JSON.stringify({}),
    });
    assert(requestReviewResponse.accepted === true, 'Review request was not accepted');
    assert(['completed', 'processing', 'pending'].includes(requestReviewResponse.status), `Unexpected review request status: ${requestReviewResponse.status}`);

    const partialReview = await request(`/reviews/${partialSession.sessionId}`, {
      headers: { Authorization: `Bearer ${partialLogin.token}` },
    });
    assert(partialReview.review?.status === 'completed', `Requested partial review is not completed: ${partialReview.review?.status}`);
  }

  console.log(`Smoke test passed: ${LANGUAGE} ${SCENARIO_ID} session ${primarySession.sessionId}${ABORT_AFTER > 0 ? ` early-end-after-${ABORT_AFTER}` : ''}${REVIEW_REQUEST_TURNS > 0 ? ` request-review-after-${REVIEW_REQUEST_TURNS}` : ''}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
