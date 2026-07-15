# Current online status

Last verified: 2026-07-15 23:46 Asia/Shanghai.

## GitHub sync status

The local `main` branch was previously synced with GitHub `origin/main` at:

```text
3888828733e2db748a4c73ad2e6e0f52c4987f98 Update current sync and tunnel status
```

The latest GitHub Actions runs for that commit completed successfully:

```text
CI: success, run 29427710672
Publish Docker image: success, run 29427710546
```

The Docker image publish workflow reported these tags:

```text
ghcr.io/wangkaiyu001/realtime-speek-coach:main
ghcr.io/wangkaiyu001/realtime-speek-coach:latest
ghcr.io/wangkaiyu001/realtime-speek-coach:sha-3888828
```

The latest published image digest recorded from the workflow is:

```text
sha256:78b5d56a0353151b2886a90abf9711c21950975cd94de599107e216015ac8b38
```

This document and the mini program endpoint are being updated after CloudBase
resource recovery. After the next push, re-check the new GitHub `main` CI and
image publish runs before treating GitHub as fully synced again.

## Stable CloudBase public trial status

CloudBase account/resource status has recovered. The CloudBase environment is:

```text
code-realtime-d7gbuxrbze297e600: NORMAL
```

The stable CloudBase Cloud Run backend is live at:

```text
https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
```

Derived endpoints:

```text
API: https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/api/v1
WebSocket: wss://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/ws
```

The deployed CloudBase service is:

```text
service: echoia-server
online version: echoia-server-025
status: normal
public access: enabled
```

The public health check passed on 2026-07-15 23:45 Asia/Shanghai:

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

The full public release verifier also passed:

```bash
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run verify:public
```

Result:

```text
Health check passed
Smoke test passed: en en-shopping-01
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
