# WeChat mini program release handoff

This handoff uses the current stable Echoia public-trial backend.

## Verified backend and mini program access

```text
CloudBase environment: code-realtime-d7gbuxrbze297e600
Cloud Run service:      echoia-server
Public web origin:      https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
```

The mini program now initializes the bound CloudBase environment and calls the
container through `wx.cloud.callContainer` and `wx.cloud.connectContainer`.
This keeps API and WebSocket traffic inside the CloudBase mini program access
path and does **not** require the public default domain to be added under
WeChat "server domains" for the mini program path.

The public default domain is still kept for the Web trial and public release
verification. It remains useful for browser access but is no longer the mini
program's runtime transport.

Before previewing or uploading, ensure the Echoia mini program is associated
with `code-realtime-d7gbuxrbze297e600` in CloudBase and the environment contains
the `echoia-server` Cloud Run service.

## CI upload or preview

The repository includes a `miniprogram-ci` wrapper so the final experience build
can be uploaded without opening WeChat DevTools, as long as the mini program CI
private key has been generated in the WeChat console.

Before running the upload, confirm the mini program remains associated with the CloudBase environment above and keep the upload private key outside the repository. The repo ignores `*.key`, `*.pem`, and
`project.private.config.json`; do not commit those files.

Create an experience-version preview QR code:

```bash
WECHAT_APPID=<wx-appid> \
WECHAT_PRIVATE_KEY_PATH=/absolute/path/private.<wx-appid>.key \
WECHAT_UPLOAD_DESC="Echoia MVP public trial preview" \
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com \
npm run miniprogram:preview
```

Upload an experience/release candidate version:

```bash
WECHAT_APPID=<wx-appid> \
WECHAT_PRIVATE_KEY_PATH=/absolute/path/private.<wx-appid>.key \
WECHAT_UPLOAD_VERSION=0.1.0 \
WECHAT_UPLOAD_DESC="Echoia MVP public trial" \
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com \
npm run miniprogram:upload
```

If CI can only provide the private key as an environment variable, set
`WECHAT_PRIVATE_KEY` instead of `WECHAT_PRIVATE_KEY_PATH`. Use literal newlines
or escaped `\n` line breaks. Optional variables:

- `WECHAT_ROBOT`: WeChat upload robot number, default `1`.
- `WECHAT_QR_OUTPUT`: preview QR image output path, default
  `tmp/wechat-preview-qrcode.jpg`.

Both scripts run the mini program release gate first with
`VERIFY_REQUIRE_WECHAT_APPID=1`, so uploads stop before contacting WeChat if the
checked-in appid is still only a placeholder or the release endpoint is wrong.

### GitHub Actions upload path

For remote handoff, configure these repository secrets in GitHub Actions:

- `WECHAT_APPID`: the real mini program appid.
- `WECHAT_PRIVATE_KEY`: the WeChat CI upload private key. Store the full PEM
  text; escaped `\n` line breaks are also accepted by the upload script.

Then run the **WeChat mini program release** workflow manually from GitHub. Use
`preview` to generate a QR-code artifact named `wechat-preview-qrcode`, or
`upload` to upload the version to the WeChat mini program console. The workflow
runs `pnpm verify:release` before calling WeChat, so the public CloudBase origin
and mini program release metadata are checked on every remote upload attempt.

## DevTools import and upload

1. Open WeChat DevTools.
2. Import the project directory:

   ```text
   packages/miniprogram
   ```

3. Confirm DevTools shows the checked-in AppID `wx37f86133fd3d2de4` and the
   CloudBase environment `code-realtime-d7gbuxrbze297e600`.
4. Build/upload an experience version first.
5. Run through the MVP loop on a real device:
   - open mini program
   - mock login
   - choose English/Japanese
   - choose a scenario
   - complete or end a practice session
   - open the review page
6. Submit for review/release after the real-device experience version passes.

DevTools remains a valid manual fallback when the CI private key is not yet
available.

## Verification gates before upload

Run the full release gate from the repository root:

```bash
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run verify:release
```

When resuming release work after a local/network interruption, run the aggregate
go-live audit first:

```bash
PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run audit:go-live
```

The audit prints pass/warn/fail lines for Git sync, the public CloudBase health
endpoint, mini program origin configuration, local WeChat upload credentials,
GitHub secret names, and whether the deployed backend is still in public-trial
mock-provider mode. It does not read or print secret values.

The real WeChat AppID is configured. This command keeps the AppID gate explicit:

```bash
WECHAT_APPID=<wx-appid> VERIFY_REQUIRE_WECHAT_APPID=1 PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run verify:miniprogram
```

## Switching from public-trial mode to real login

After the mini program is registered/filed, set these CloudBase runtime variables and redeploy/restart the service:

```text
MOCK_AUTH=0
WX_APP_ID=<real-mini-program-appid>
WX_APP_SECRET=<real-mini-program-secret>
```

Keep `MOCK_VOICE`, `MOCK_LLM`, and `MOCK_REVIEW` enabled until each real provider
passes its own smoke test. Store all production secrets only in CloudBase runtime
variables, not in repository files.

## Current upload status

The AppID and CI private key have been validated by WeChat. The repository compiles TypeScript into a clean staging directory before invoking `miniprogram-ci`, and the WeChat compiler completes successfully.

The local upload gateway previously required these public IPs in **Development
management -> Development settings -> Mini Program code upload -> IP
whitelist**:

```text
116.6.206.132
183.159.105.112
115.194.3.176
172.184.247.2
```

The last two values are the local and GitHub Actions upload gateways observed on
2026-07-24. If WeChat reports `invalid ip` again, add the exact current upload
egress IP and rerun the preview rather than disabling the whitelist. GitHub
hosted runners do not guarantee a fixed outbound IP, so a later run may report a
new value.
