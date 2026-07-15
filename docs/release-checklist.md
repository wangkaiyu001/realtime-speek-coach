# Release checklist for the MVP core flow

Goal: publish a trial/release build that lets users experience the full loop without WeChat real login first:

1. open mini program
2. mock login
3. choose English/Japanese
4. choose a scenario
5. complete voice practice
6. end normally or early with review
7. open the review from the completion page or history

## 1. Server environment

For the first public trial, keep WeChat login mocked and choose the other providers independently:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=file:/app/data/dev.db
JWT_SECRET=<replace-with-a-long-random-secret>

# Login is intentionally deferred until the mini program is registered and filed.
MOCK_AUTH=1

# Fastest stable public trial: all downstream providers mocked.
MOCK_VOICE=1
MOCK_LLM=1
MOCK_REVIEW=1
```

To validate Volcengine voice while keeping the rest of the flow stable:

```bash
MOCK=0
MOCK_AUTH=1
MOCK_VOICE=0
MOCK_LLM=1
MOCK_REVIEW=1
VOLC_VOICE_API_KEY=<your-key>
VOLC_VOICE_APP_KEY=<your-app-key>
VOLC_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
VOLC_TTS_RESOURCE_ID=seed-tts-1.0
VOLC_TTS_FORMAT=mp3
```

## 2. Docker start

The container start script runs database push first and then starts the built server. It defaults to `HOST=0.0.0.0` and `PORT=3000`, so it is suitable for container platforms.

```bash
docker compose up --build server
```

After deployment, verify:

```bash
curl https://<your-domain>/api/v1/health
```

The response should include `status: ok` and the active mock/provider flags.


## 3. CloudBase Cloud Run deployment

CloudBase is the preferred MVP deployment target because the current server already runs as a Dockerized Fastify HTTP/WebSocket service. Deploy it as a Cloud Run container instead of rewriting the realtime flow as cloud functions.

One-time local setup:

```bash
tcb login
tcb --config-file /dev/null env list --json
```

Configure the Cloud Run service environment variables from section 1 in the CloudBase console, then deploy from the repository root:

```bash
CLOUDBASE_ENV_ID=<envId> sh scripts/cloudbase-deploy.sh
```

See `docs/cloudbase-deploy.md` for the full CloudBase MCP/Codex setup, deployment steps, mini program domain configuration, and SQLite persistence notes.

## 4. Mini program endpoint

Before creating a trial/release build, edit:

```text
packages/miniprogram/config.ts
```

Set:

```ts
const PRODUCTION_SERVER_ORIGIN = 'https://<your-domain>';
```

The mini program will derive:

- API: `https://<your-domain>/api/v1`
- WebSocket: `wss://<your-domain>/ws`

For local development, it keeps using `http://localhost:3000` unless `serverOrigin`, `apiUrl`, or `wsUrl` are set in mini program storage.

## 5. Smoke validation

Run the no-port unit/integration suite first:

```bash
pnpm -r typecheck
pnpm -r test
pnpm build
```

If the server can listen on a port in your environment, also run:

```bash
MOCK=1 MOCK_AUTH=1 MOCK_VOICE=1 MOCK_LLM=1 MOCK_REVIEW=1 pnpm --filter @rsc/server dev
API_URL=http://localhost:3000/api/v1 WS_URL=ws://localhost:3000/ws node scripts/mock-e2e-smoke.mjs
```

## 6. Deferred items

These are intentionally not blocking the first public trial:

- real WeChat login and filing-dependent setup
- full placement test
- long-term package/export cleanup
- queue-backed async review infrastructure
