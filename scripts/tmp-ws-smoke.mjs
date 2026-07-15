import WebSocket from 'ws';

const base = 'https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com';
const scenarioId = 'en-business-01';
const login = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: `smoke-${Date.now()}` }),
}).then(async (r) => {
  if (!r.ok) throw new Error(`login ${r.status}: ${await r.text()}`);
  return r.json();
});
const token = login.token;
await fetch(`${base}/api/v1/user/language`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ language: 'en' }),
}).then(async (r) => {
  if (!r.ok) throw new Error(`language ${r.status}: ${await r.text()}`);
});
const scenarios = await fetch(`${base}/api/v1/scenarios?language=en`, {
  headers: { authorization: `Bearer ${token}` },
}).then(async (r) => {
  if (!r.ok) throw new Error(`scenarios ${r.status}: ${await r.text()}`);
  return r.json();
});
const found = scenarios.scenarios?.some((s) => s.id === scenarioId);
console.log(JSON.stringify({ login: Boolean(token), scenarioFound: found, scenarios: scenarios.scenarios?.length }, null, 2));

const wsUrl = base.replace('https:', 'wss:') + `/ws?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(wsUrl);
const seen = [];
const started = Date.now();
let done = false;
function finish(code=0) {
  if (done) return;
  done = true;
  try { ws.close(); } catch {}
  const sanitized = seen.map((f) => ({ type: f.type, sessionId: f.sessionId ? 'present' : undefined, turnIndex: f.turnIndex, totalTurns: f.totalTurns, sessionComplete: f.sessionComplete, isLast: f.isLast, textLen: f.text?.length, accumulatedLen: f.accumulated?.length, dataLen: f.data?.length, code: f.code, message: f.message }));
  console.log(JSON.stringify({ websocket: code === 0 ? 'ok' : 'failed', elapsedMs: Date.now() - started, frames: sanitized }, null, 2));
  process.exit(code);
}
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', sessionId: '', scenarioId, language: 'en' }));
});
ws.on('message', (data) => {
  const frame = JSON.parse(data.toString());
  seen.push(frame);
  if (frame.type === 'error') finish(1);
  if (frame.type === 'turn_end' && frame.turnIndex === 0 && frame.sessionComplete === false) finish(0);
});
ws.on('error', (err) => { console.error('ws error', err.message); finish(1); });
setTimeout(() => finish(1), 30000);
