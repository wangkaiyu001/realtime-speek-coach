# Current online status

Last verified: 2026-07-24 03:30 Asia/Shanghai.

## Source and release status

The release currently serving production was built from these source changes
and deployed before the final Git commit. The reviewed source is now committed
and synchronized to GitHub `main`:

```text
0fa0228438cd5e5edf667f6e3fa0b0b4853302f3 Harden CloudBase production persistence
```

GitHub Actions evidence for that commit:

```text
CI: success, run 30039964138
Publish Docker image: success, run 30039964102
```

The Docker image publish workflow creates these tags on each `main` push:

```text
ghcr.io/wangkaiyu001/realtime-speek-coach:main
ghcr.io/wangkaiyu001/realtime-speek-coach:latest
ghcr.io/wangkaiyu001/realtime-speek-coach:sha-<commit-sha>
```

## Stable CloudBase public trial

CloudBase environment:

```text
code-realtime-d7gbuxrbze297e600: NORMAL
region: ap-shanghai
package: personal plan
auto-renew: enabled
```

The stable CloudBase Cloud Run backend and Web preview are live at:

```text
https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
```

Derived endpoints:

```text
API: https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/api/v1
WebSocket: wss://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/ws
```

Current service configuration:

```text
service: echoia-server
service update time: 2026-07-24 03:14:39 Asia/Shanghai
online version: echoia-server-039
traffic: 100%
status: normal
public access: enabled
access types: OA, PUBLIC, MINIAPP
CPU / memory: 0.5 CPU / 1 GB
instances: 1-5
production schema push on startup: disabled
```

The service is attached to the private network used by CloudBase MySQL:

```text
VPC: vpc-2xght3xc (172.17.0.0/16)
Subnet: subnet-qdmeiifz (172.17.0.0/24)
```

Production uses the shared CloudBase MySQL database. Container-local SQLite is
rejected by the startup guard, and `DATABASE_PUSH_ON_START=0` prevents normal
container restarts from changing the production schema.

## Runtime verification

The final public release verification passed after version 039 received 100% of
traffic:

```text
Health check passed
Readiness check passed: database connected
HTTP/WebSocket mock smoke passed
Mini program release readiness passed
Full release verification passed
```

Verification smoke session:

```text
cmrxw7z730002if78dbbkubm7
```

The version 039 startup log confirms the production schema guard is active:

```text
[startup] Skipping Prisma schema push
Server running on port 3000
```

The `/api/v1/ready` response reports `database=connected`, proving that the
running Cloud Run instances can reach MySQL through the configured VPC.

The public health response reports the current trial mode without exposing
secrets:

```json
{
  "status": "ok",
  "mock": true,
  "mocks": {
    "auth": true,
    "voice": true,
    "llm": true,
    "review": true
  }
}
```

The HTTP service also sends Helmet security headers and rate-limit headers. The
login limiter is per process, so strict global traffic protection should still
be configured at the platform edge before a broad public launch.

## Mini program CloudBase container access

The Echoia mini program is associated with the same CloudBase environment and
service:

```text
Environment: code-realtime-d7gbuxrbze297e600
Service: echoia-server
HTTP: wx.cloud.callContainer
WebSocket: wx.cloud.connectContainer
AppID: wx37f86133fd3d2de4
```

This transport replaces direct `wx.request` / `wx.connectSocket` calls for the
mini program path, so the CloudBase container route does not depend on adding the
public default domain to WeChat server-domain settings. The public domain remains
enabled for the Web trial and external release verification.

The repository contains the static project files and CI tooling required for a
preview or upload:

- `packages/miniprogram/project.config.json`
- `packages/miniprogram/sitemap.json`
- `scripts/build-miniprogram.mjs`
- `scripts/verify-miniprogram-release.mjs`
- `scripts/upload-miniprogram.mjs`
- `.github/workflows/wechat-miniprogram.yml`

GitHub Actions has both required secret names configured:

```text
WECHAT_APPID
WECHAT_PRIVATE_KEY
```

Use the manual **WeChat mini program release** workflow with the `preview`
action to produce the `wechat-preview-qrcode` artifact. The local private key is
also available outside the repository for a local preview fallback. Never commit
or print its contents.

Preview upload attempts on 2026-07-24 compiled successfully but WeChat rejected
the upload gateways because they were not yet present in the code-upload IP
whitelist:

```text
local upload: 115.194.3.176
GitHub Actions upload: 172.184.247.2 (run 30040134535)
```

Add both current egress IPs in WeChat Development settings, then rerun the
workflow. A future GitHub-hosted runner can use a different outbound IP, so use
the exact `invalid ip` value reported by a retry if it changes.

The detailed handoff and real-device checklist are in
`docs/wechat-release-handoff.md`.

## Obsolete temporary tunnel

Do not use the old Cloudflare quick tunnel in trial or release builds. The
stable CloudBase endpoint above replaces it.

## Remaining production decisions

The current deployment is a working, durable, end-to-end public trial, but it is
intentionally not a real-provider launch:

1. Complete a real-device mini program preview test and submit the build through
   WeChat review, filing, and release steps.
2. When real WeChat login is approved, configure `WX_APP_ID` and
   `WX_APP_SECRET`, set `MOCK_AUTH=0`, and run a dedicated login smoke test.
3. Switch voice, LLM, and review providers independently only after confirming
   credentials, billing authorization, quotas, latency, privacy, and rollback.
4. Monitor CloudBase MySQL backups, indexes, connections, resource usage, and
   the environment renewal status.
5. Keep production secrets only in CloudBase or GitHub secret storage, never in
   repository files or deployment logs.
