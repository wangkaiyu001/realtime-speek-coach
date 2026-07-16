# WeChat mini program release handoff

This handoff uses the current stable Echoia public-trial backend.

## Verified backend

```text
Origin: https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
API:    https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/api/v1
Socket: wss://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com/ws
```

The first public trial intentionally runs with mocked login, voice, LLM, and
review providers so users can experience the full practice loop before WeChat
registration/filing and production provider credentials are finalized.

## Required WeChat console settings

In the WeChat mini program console, add this host to the legal domain allowlist:

```text
request legal domain: echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
socket legal domain:  echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
```

Do not use the obsolete Cloudflare quick tunnel for trial or release builds.

## CI upload or preview

The repository includes a `miniprogram-ci` wrapper so the final experience build
can be uploaded without opening WeChat DevTools, as long as the mini program CI
private key has been generated in the WeChat console.

Before running the upload, configure the legal domains above and keep the upload
private key outside the repository. The repo ignores `*.key`, `*.pem`, and
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

3. Replace the checked-in placeholder appid (`touristappid`) with the real mini
   program appid in DevTools local project settings, or temporarily set it in
   `packages/miniprogram/project.config.json` before uploading.
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

For the final upload handoff, also require a real WeChat appid:

```bash
WECHAT_APPID=<wx-appid> VERIFY_REQUIRE_WECHAT_APPID=1 PUBLIC_ORIGIN=https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com npm run verify:miniprogram
```

## Switching from public-trial mode to real login

After the mini program is registered/filed and the legal domains are configured,
set these CloudBase runtime variables and redeploy/restart the service:

```text
MOCK_AUTH=0
WX_APP_ID=<real-mini-program-appid>
WX_APP_SECRET=<real-mini-program-secret>
```

Keep `MOCK_VOICE`, `MOCK_LLM`, and `MOCK_REVIEW` enabled until each real provider
passes its own smoke test. Store all production secrets only in CloudBase runtime
variables, not in repository files.
