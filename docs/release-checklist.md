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

The production Docker image sets these public-trial defaults as a safety net.
Cloud Run service variables still override Dockerfile defaults, so set a stable
`JWT_SECRET` in CloudBase before sharing a long-lived trial build. Without a
stable secret, the start script generates an ephemeral secret and existing
sessions expire after container restarts.

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
PUBLIC_ORIGIN=https://<your-domain> npm run verify:public
```

The response should include `status: ok` and the active mock/provider flags.
The `verify:public` script is the preferred single release gate because it also
checks HTTPS/WSS endpoint shape and runs the full public mock practice smoke.


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

If CloudBase is blocked or isolated, deploy the published Docker image from
GitHub Container Registry to another long-running container platform with
WebSocket support. See `docs/container-deploy.md` for the image tags, required
environment variables, persistence notes, and verification steps.

## 4. Mini program endpoint and login mode

Before creating a trial/release build, edit:

```text
packages/miniprogram/config.ts
```

Set it to the verified public HTTPS origin for the backend. The current temporary demo origin is:

```ts
const PRODUCTION_SERVER_ORIGIN = 'https://deals-crest-cartridges-instead.trycloudflare.com';
```

The mini program will derive:

- API: `https://deals-crest-cartridges-instead.trycloudflare.com/api/v1`
- WebSocket: `wss://deals-crest-cartridges-instead.trycloudflare.com/ws`

This tunnel origin is suitable only for short trial/demo validation because it depends on a local Mac backend and cloudflared process staying alive. For stable production, replace it with a long-running CloudBase or other container-hosting HTTPS origin after that deployment passes the same health and WebSocket smoke checks.

Trial/release builds now fail fast if `PRODUCTION_SERVER_ORIGIN` is empty, so they will not accidentally point real users at `localhost`. For preview testing without editing the constant, set mini program storage keys `serverOrigin`, `apiUrl`, or `wsUrl` in DevTools. For local development, the default remains `http://localhost:3000`.

The client uses `wx.login()` in trial/release builds and sends the real WeChat code to `/auth/login`. The server supports both modes:

- `MOCK_AUTH=1`: creates a deterministic mock user for public-trial demos before registration/filing is complete.
- `MOCK_AUTH=0` with `WX_APP_ID` and `WX_APP_SECRET`: exchanges the code via WeChat `jscode2session` and stores the returned `openid`/`unionid`.

Check `/api/v1/health` before submission. It reports `auth.mode`, `auth.wechatConfigured`, and provider flags so you can confirm the deployed service is using the expected login/provider setup.

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

For a deployed public endpoint, use the release verification script instead:

```bash
PUBLIC_ORIGIN=https://<your-domain> npm run verify:public
```

The script intentionally rejects localhost and non-HTTPS/WSS URLs unless
`VERIFY_ALLOW_LOCAL=1` is set for local-only development checks.

## 6. Deferred items

These are intentionally not blocking the first public trial:

- real WeChat login and filing-dependent setup
- full placement test
- long-term package/export cleanup
- queue-backed async review infrastructure
