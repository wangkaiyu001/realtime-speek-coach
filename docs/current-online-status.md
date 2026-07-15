# Current online status

Last verified: 2026-07-16 00:01 Asia/Shanghai.

## GitHub sync status

The last verified application commit on GitHub `main` is:

```text
32d6fc227253e2ee436bc152949cc37a7af1003c Point mini program to CloudBase backend
```

The GitHub Actions runs for that application commit completed successfully:

```text
CI: success, run 29430289702
Publish Docker image: success, run 29430289378
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
