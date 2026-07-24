# Current online status

Last verified: 2026-07-24 07:49 Asia/Shanghai.

## Source and release status

The reviewed deployment source and deployment archive hygiene changes are
committed and synchronized to GitHub `main`:

```text
e131ff3e99f355f8ff8ff2a718a7b90b63c43704 Keep CloudBase deploy archives clean
```

GitHub Actions evidence for that commit:

```text
CI: success, run 30041092371
Publish Docker image: success, run 30041092391
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
service update time: 2026-07-24 04:08:14 Asia/Shanghai
online version: echoia-server-040
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

The final public release verification passed after version 040 received 100% of
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
cmrxye89k0002w8dibbo4rnwy
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

The final go-live audit completed with `pass=8, warn=1, fail=0`. The warning is
intentional: auth, voice, LLM, and review providers remain in mock mode until
provider launch decisions and credentials are approved.

## Mini program CloudBase container access

The Echoia mini program is associated with the same CloudBase environment and
service:

```text
Environment: code-realtime-d7gbuxrbze297e600
Service: echoia-server
Trial/release HTTP: wx.request -> stable public HTTPS origin
Trial/release WebSocket: wx.connectSocket -> stable public WSS origin
Development/future linked HTTP: wx.cloud.callContainer
Development/future linked WebSocket: wx.cloud.connectContainer
AppID: wx37f86133fd3d2de4
```

The public transport is preferred in trial/release builds until the WeChat
account is explicitly associated with the Tencent-created CloudBase environment.
The WeChat server-domain list must contain the Echoia HTTPS request domain and
WSS socket domain before real-device testing.

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

The local code-upload IP whitelist is now working. On 2026-07-24, the
repository successfully generated a fresh preview QR code and uploaded mini
program version `0.1.1` with robot 1 to the WeChat console as an experience /
review-candidate build. The QR image is intentionally kept outside Git in:

```text
tmp/wechat-preview-qrcode.jpg
```

The GitHub Actions preview path passes the full release gate but GitHub-hosted
runner IPs are not stable. Run `30054075464` reached WeChat and was rejected only
because its new egress IP `20.29.223.65` was not in the code-upload whitelist.
The reliable current release path is the validated local CI key; add the exact
new runner IP before a remote retry, or use a self-hosted runner with a stable
outbound IP for unattended releases.

The release verifier now retries a short-lived readiness failure up to three
times. This handles transient CloudBase MySQL connection interruptions without
hiding persistent failures; the initial remote retry failure was confirmed as a
single Prisma `P1001`, followed by repeated successful readiness checks.

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
