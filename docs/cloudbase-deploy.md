# CloudBase deployment guide

This project is deployed to Tencent CloudBase with Cloud Run (container hosting).

## Why Cloud Run

The current MVP server is a Fastify HTTP service with a WebSocket endpoint at `/ws`. Cloud Run is the lowest-risk fit because it can run the existing Docker image without rewriting the realtime practice flow into cloud functions.

For the first public trial, SQLite is acceptable so the product can go online quickly. Treat it as MVP storage only: container rebuilds, scaling, or storage changes can affect persistence. After the core flow is validated, migrate the Prisma datasource to a managed database.

## CloudBase MCP/Codex setup

Official guide: https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/ide-setup/openai-codex-cli

Expected local setup flow:

```bash
# Check CloudBase AI/Codex integration help.
tcb ai -a codex --config

# If the MCP package is missing, install/update the CloudBase CLI or MCP package,
# then register the MCP server with Codex according to the official guide.
npm install -g @cloudbase/cli @cloudbase/cloudbase-mcp
codex mcp add cloudbase -- cloudbase-mcp
codex mcp list
```

If the Codex sandbox cannot write to `~/.codex` or cannot access npm/Tencent Cloud, run the setup commands in a normal terminal and then return to this workspace.

## 1. Log in and choose an environment

```bash
tcb login
# or, for interactive secret input:
tcb login -k
# or, for non-interactive credential login:
tcb login --apiKeyId <secret-id> --apiKey <secret-key>
# or, with a CloudBase environment API key:
tcb login --cloudbase-api-key <cloudbase-api-key> -e <envId>

tcb --config-file /dev/null env list --json
```

Record the target `envId`.

## 2. Configure Cloud Run environment variables

Set these variables in the CloudBase console for the `echoia-server` Cloud Run service before public testing:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=file:/app/data/dev.db
JWT_SECRET=<replace-with-a-long-random-secret>

# Login is intentionally mocked until the mini program is registered and filed.
MOCK_AUTH=1

# Fastest stable public trial: all downstream providers mocked.
MOCK=1
MOCK_VOICE=1
MOCK_LLM=1
MOCK_REVIEW=1
CORS_ORIGIN=*
```

The production Docker image also carries the same safe public-trial defaults so
the container can boot even before console variables are added. Console/service
variables still take precedence and should be used for persistent production
secrets. If `JWT_SECRET` is not set, the container start script generates an
ephemeral secret at boot time; that is acceptable for a short demo, but it will
invalidate sessions after each restart.

To test real Volcengine voice later while keeping the rest stable:

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
VOLC_TTS_SAMPLE_RATE=24000
```

## 3. Deploy

From the repository root:

```bash
CLOUDBASE_ENV_ID=<envId> sh scripts/cloudbase-deploy.sh
```

The script deploys this directory as a container Cloud Run service named `echoia-server` on port `3000`.

## 4. Verify the service

After CloudBase returns the service domain, verify:

```bash
curl https://<cloudbase-domain>/api/v1/health
```

The response should include `status: ok` plus the active mock/provider flags.

CloudBase trial endpoint intended for stable hosting:

```text
https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
```

The repository may temporarily point `PRODUCTION_SERVER_ORIGIN` at a Cloudflare quick tunnel while this CloudBase endpoint is isolated. See `docs/current-online-status.md` for the currently verified public trial URL.

If this returns `503`, redeploy the service and check Cloud Run logs. A common
cause is an old container image that was built before the production defaults in
the Dockerfile were added.

If the response body contains `SERVICE_FORBIDDEN` and `Your server is isolated`,
or if `tcb cloudrun deploy` fails with `The current resource is isolated`, the
blocker is the CloudBase tenant/resource-pack state rather than application code.
In that state CloudBase can still list the service as `normal` and `Public
Access: Allowed`, but the runtime gateway rejects traffic and deployment APIs
cannot read the existing service detail. Restore/renew the CloudBase resource
pack or raise the service quota in the Tencent CloudBase console, then rerun the
deployment command and the health/WebSocket smoke checks.

Current verified blocked state for environment
`code-realtime-d7gbuxrbze297e600` on 2026-07-15:

```text
GET /api/v1/health -> 503 SERVICE_FORBIDDEN: Your server is isolated
tcb cloudrun deploy -> [DescribeCloudRunServerDetail] The current resource is isolated.
```

## 5. Point the mini program to CloudBase

Edit `packages/miniprogram/config.ts` after the stable CloudBase deployment is reachable:

```ts
const PRODUCTION_SERVER_ORIGIN = 'https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com';
```

The mini program derives:

- API: `https://<cloudbase-domain>/api/v1`
- WebSocket: `wss://<cloudbase-domain>/ws`

Trial/release builds intentionally stop with a visible configuration error if `PRODUCTION_SERVER_ORIGIN` is empty, preventing accidental `localhost` traffic in public builds. For temporary DevTools validation, set mini program storage key `serverOrigin` to the CloudBase origin.

Also add the same HTTPS and WSS domains to the WeChat mini program request/socket legal domain settings before trial/release builds.

If the mini program registration and filing are ready, disable login mocking in CloudBase and provide real WeChat credentials:

```bash
MOCK_AUTH=0
WX_APP_ID=<your-mini-program-app-id>
WX_APP_SECRET=<your-mini-program-app-secret>
```

Then call `/api/v1/health` and confirm `auth.mode` is `wechat` and `auth.wechatConfigured` is `true`.

## 6. Pre-release checks

```bash
pnpm -r typecheck
pnpm -r test
pnpm build
```

Optional end-to-end smoke check against a running deployment:

```bash
API_URL=https://<cloudbase-domain>/api/v1 WS_URL=wss://<cloudbase-domain>/ws node scripts/mock-e2e-smoke.mjs
```

## Deferred after MVP

- Real WeChat login and filing-dependent setup.
- Replace SQLite with managed persistent storage.
- Queue-backed async review pipeline.
- Full placement test and production observability.
