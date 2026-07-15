# Current online status

Last verified: 2026-07-15 22:48 Asia/Shanghai.

## What is online now

The MVP backend is reachable through a temporary Cloudflare quick tunnel:

```text
https://deals-crest-cartridges-instead.trycloudflare.com
```

Derived endpoints:

```text
API: https://deals-crest-cartridges-instead.trycloudflare.com/api/v1
WebSocket: wss://deals-crest-cartridges-instead.trycloudflare.com/ws
```

The mini program production endpoint currently points to this origin in
`packages/miniprogram/config.ts`, so trial/release builds derive the API and
WebSocket URLs from the tunnel origin.

## Verified checks

These checks passed against the public tunnel on 2026-07-15:

```bash
curl https://deals-crest-cartridges-instead.trycloudflare.com/api/v1/health
PUBLIC_ORIGIN=https://deals-crest-cartridges-instead.trycloudflare.com npm run verify:public
API_URL=https://deals-crest-cartridges-instead.trycloudflare.com/api/v1 \
  WS_URL=wss://deals-crest-cartridges-instead.trycloudflare.com/ws \
  node scripts/mock-e2e-smoke.mjs
```

`npm run verify:public` is the preferred one-command release gate for any
public backend origin. It refuses local endpoints by default, checks HTTPS/WSS
shape, validates `/api/v1/health`, confirms the expected public-trial mock
flags, and then runs the full mock end-to-end smoke test.

The service is intentionally running in public-trial mock mode:

```text
MOCK_AUTH=1
MOCK_VOICE=1
MOCK_LLM=1
MOCK_REVIEW=1
```

This allows the end-to-end practice flow to be tested before WeChat login,
voice, LLM, review, and production database credentials are finalized.

## Important limitation

This is a temporary demo endpoint, not a stable production deployment. It stays
online only while both processes keep running on the local Mac:

1. the Node backend listening on `127.0.0.1:3101`
2. the `cloudflared tunnel --url http://127.0.0.1:3101` process

If the Mac sleeps, restarts, loses network, or the tunnel process exits, the
public URL may stop working. A restarted quick tunnel can also receive a new
hostname, which requires updating `packages/miniprogram/config.ts` and rebuilding
the mini program.

## Stable production blocker

The intended CloudBase Cloud Run endpoint is currently blocked by the Tencent
CloudBase account/resource state, not by application code:

```text
https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/api/v1/health
-> 503 SERVICE_FORBIDDEN: Your server is isolated
```

CloudBase CLI deployment also fails with:

```text
[DescribeCloudRunServerDetail] The current resource is isolated.
```

To make the product production-stable, restore/renew the CloudBase resource pack
or deploy the Docker image to another long-running container platform that
supports WebSocket connections. After a stable HTTPS origin is available, update
`PRODUCTION_SERVER_ORIGIN`, run the quality gates, run the public smoke test, and
push the new commit.
