# Current online status

Last verified: 2026-07-16 09:31 Asia/Shanghai.

## GitHub sync status

The last verified application commit on GitHub `main` is:

```text
9457182b64453f64464f6c441f4dd33d9d1c66fa Include mini program package in Docker build
```

The GitHub Actions runs for that application commit completed successfully:

```text
CI: success, run 29463856209
Publish Docker image: success, run 29463856151
```

The Docker image publish workflow publishes these tags on each `main` push:

```text
ghcr.io/wangkaiyu001/realtime-speek-coach:main
ghcr.io/wangkaiyu001/realtime-speek-coach:latest
ghcr.io/wangkaiyu001/realtime-speek-coach:sha-<commit-sha>
```

For the current repository synchronization state, use `git status --short
--branch` and `git rev-list --left-right --count origin/main...HEAD`; both
should report no local/remote divergence before release handoff.

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
service update time: 2026-07-16 09:25:42 Asia/Shanghai
status: normal
public access: enabled
```

The public health check passed on 2026-07-16 09:31 Asia/Shanghai after the CloudBase redeploy:

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

The full public release verifier also passed after the CloudBase redeploy:

```bash
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run verify:public
```

Result:

```text
Health check passed
Smoke test passed: en en-shopping-01 session cmrmu5v890002dwrmf0u6s9u4
Public release verification passed.
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

Run this gate before uploading a trial/release build:

```bash
npm run verify:miniprogram
```

For final upload handoff, require the real WeChat appid instead of the checked
in placeholder:

```bash
WECHAT_APPID=<wx-appid> VERIFY_REQUIRE_WECHAT_APPID=1 npm run verify:miniprogram
```

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
