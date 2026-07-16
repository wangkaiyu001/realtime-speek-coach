# Current online status

Last verified: 2026-07-16 14:40 Asia/Shanghai.

## GitHub sync status

The latest verified commit on GitHub `main` is:

```text
5256a98551d30087ea303c56acfa80f0ed24cca8 Add deployment readiness checks
```

At verification time, the local worktree was clean and matched `origin/main` exactly:

```text
git status --short --branch: ## main...origin/main
git rev-list --left-right --count origin/main...HEAD: 0 0
```

The GitHub Actions runs for the latest commit completed successfully:

```text
CI: success, run 29475119503
Publish Docker image: success, run 29475119496
```

The Docker image publish workflow publishes these tags on each `main` push:

```text
ghcr.io/wangkaiyu001/realtime-speek-coach:main
ghcr.io/wangkaiyu001/realtime-speek-coach:latest
ghcr.io/wangkaiyu001/realtime-speek-coach:sha-<commit-sha>
```

The current go-live audit reports five passing gates and four expected warnings:

```text
pass=5, warn=4, fail=0
```

The warnings are the real WeChat AppID, WeChat CI private key, matching GitHub secrets, and mocked production providers. They do not block the public mock-mode trial, but they do block a real WeChat experience/release build and production-provider launch.

## Stable CloudBase public trial status

CloudBase account/resource status has recovered. The CloudBase environment is:

```text
code-realtime-d7gbuxrbze297e600: NORMAL
```

The stable CloudBase Cloud Run backend is live at:

```text
https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
```

The root web preview is also reachable and serves the `Echoia Web 体验版` page.

Derived endpoints:

```text
API: https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/api/v1
WebSocket: wss://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/ws
```

The deployed CloudBase service is:

```text
service: echoia-server
service update time: 2026-07-16 14:03:28 Asia/Shanghai
status: normal
public access: enabled
```

The public health check passed on 2026-07-16 14:40 Asia/Shanghai during the latest online audit:

```bash
curl --max-time 20 https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/api/v1/health
```

Response summary:

```json
{
  "status": "ok",
  "mock": true,
  "mocks": {
    "auth": true,
    "voice": true,
    "llm": true,
    "review": true
  },
  "providers": {
    "deepseek": true,
    "gemini": false,
    "volcVoice": false
  },
  "auth": {
    "mode": "mock",
    "wechatConfigured": false
  }
}
```

The deployed service now exposes `/api/v1/ready`. It verifies database connectivity separately from process liveness and reports `{"status":"ready","database":"connected"}`. The release verifier requires this result before running the end-to-end smoke flow. The server also handles `SIGTERM`/`SIGINT` with graceful Fastify and Prisma shutdown.

The full release verifier also passed during the latest verification:

```bash
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run verify:release
```

Result:

```text
Health check passed
Smoke test passed: en en-shopping-01 session cmrmxerf9001bdwrmsmcz1zrm
Public release verification passed.
Mini program release readiness checks passed.
Full release verification passed.
```

The service is intentionally running in public-trial mock mode:

```text
MOCK=1
MOCK_AUTH=1
MOCK_VOICE=1
MOCK_LLM=1
MOCK_REVIEW=1
```

This allows the end-to-end practice flow to be tested before WeChat login,
voice, LLM, review, and production database credentials are finalized.

## Mini program endpoint

The mini program production endpoint in `packages/miniprogram/config.ts` now
points to the stable CloudBase origin:

```ts
const PRODUCTION_SERVER_ORIGIN = 'https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com';
```

Trial/release builds derive the API and WebSocket URLs from that origin.

The repository also includes the static files needed for WeChat DevTools import
and release checks:

- `packages/miniprogram/project.config.json`
- `packages/miniprogram/sitemap.json`
- `scripts/verify-miniprogram-release.mjs`

Run this full release gate before uploading a trial/release build:

```bash
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run verify:release
```

Run this static mini program gate when only checking DevTools packaging metadata:

```bash
npm run verify:miniprogram
```

The complete WeChat handoff is in `docs/wechat-release-handoff.md`. For final upload handoff, require the real WeChat appid instead of the checked
in placeholder:

```bash
WECHAT_APPID=<wx-appid> VERIFY_REQUIRE_WECHAT_APPID=1 npm run verify:miniprogram
```

When the WeChat CI private key is available, the repository can generate a
preview QR code or upload an experience/release candidate without manual
DevTools import:

```bash
WECHAT_APPID=<wx-appid> WECHAT_PRIVATE_KEY_PATH=/absolute/path/private.<wx-appid>.key npm run miniprogram:preview
WECHAT_APPID=<wx-appid> WECHAT_PRIVATE_KEY_PATH=/absolute/path/private.<wx-appid>.key WECHAT_UPLOAD_VERSION=0.1.0 npm run miniprogram:upload
```

These commands still require the real appid, upload private key, and WeChat
console legal-domain configuration before they can complete.

The same upload path is available from GitHub Actions through the manual
**WeChat mini program release** workflow after adding repository secrets
`WECHAT_APPID` and `WECHAT_PRIVATE_KEY`. Use its `preview` action to create a QR
artifact for real-device testing, then `upload` when the experience build is
ready for the WeChat console.

## Obsolete temporary tunnel

The previous Cloudflare quick tunnel is obsolete and should not be used for
trial/release builds:

```text
https://deals-crest-cartridges-instead.trycloudflare.com
```

It returned Cloudflare 530 / error 1016 during the latest checks. The stable
CloudBase endpoint above replaces it.

## Remaining production-hardening items

These are not blocking the first public trial because the current deployment is
explicitly a mock-mode trial backend:

1. Register/file the WeChat mini program and switch `MOCK_AUTH=0` with
   `WX_APP_ID` and `WX_APP_SECRET`.
2. Decide which downstream providers should be real in production and switch
   `MOCK_VOICE`, `MOCK_LLM`, and `MOCK_REVIEW` independently after their own
   smoke tests pass.
3. Replace SQLite-on-container storage with durable production persistence for
   long-term user history.
4. Set or rotate production secrets only through CloudBase runtime variables,
   not repository files.
