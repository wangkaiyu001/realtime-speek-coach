# Mock E2E smoke test

This smoke test exercises the current end-to-end MVP path without real WeChat login or real voice services:

1. health check
2. mock login
3. language selection
4. scenario loading
5. WebSocket practice flow
6. session completion or early-end partial review
7. review retrieval
8. recent session history

It can also create a deliberately unfinished session and verify that review generation can be requested later from history.

In full mock voice mode, the server emits text deltas plus an empty terminal TTS frame. This avoids feeding fake MP3 bytes to the mini-program audio player while still exercising the same WebSocket sequencing that the real voice path will use.

## Start the mock server

```bash
PORT=3101 NODE_ENV=development MOCK=1 MOCK_AUTH=1 MOCK_VOICE=1 MOCK_LLM=1 MOCK_REVIEW=1 \
JWT_SECRET=dev-secret-change-me DATABASE_URL=file:/Users/bytedance/Documents/Echoia/prisma/dev.db \
pnpm --filter @rsc/server dev
```

If `pnpm` is not installed globally in this environment, use:

```bash
NPM_CONFIG_CACHE=/private/tmp/echoia-npm-cache npm exec --yes --package pnpm@8.15.9 -- pnpm --filter @rsc/server dev
```

## Run smoke tests

```bash
API_URL=http://localhost:3101/api/v1 WS_URL=ws://localhost:3101/ws node scripts/mock-e2e-smoke.mjs
```

Japanese path:

```bash
API_URL=http://localhost:3101/api/v1 WS_URL=ws://localhost:3101/ws SMOKE_LANGUAGE=ja node scripts/mock-e2e-smoke.mjs
```

Early-end partial review path:

```bash
API_URL=http://localhost:3101/api/v1 WS_URL=ws://localhost:3101/ws SMOKE_ABORT_AFTER=3 node scripts/mock-e2e-smoke.mjs
```

History-triggered partial review path:

```bash
API_URL=http://localhost:3101/api/v1 WS_URL=ws://localhost:3101/ws \
SMOKE_REVIEW_REQUEST_TURNS=2 node scripts/mock-e2e-smoke.mjs
```

## Hybrid real-LLM validation

Keep login, voice, and review mocked while routing the coach response to the real LLM provider:

```bash
PORT=3101 NODE_ENV=development MOCK=0 MOCK_AUTH=1 MOCK_VOICE=1 MOCK_LLM=0 MOCK_REVIEW=1 \
JWT_SECRET=dev-secret-change-me DEEPSEEK_API_KEY=your_key_here \
DATABASE_URL=file:/Users/bytedance/Documents/Echoia/prisma/dev.db \
pnpm --filter @rsc/server dev
```

Then run:

```bash
API_URL=http://localhost:3101/api/v1 WS_URL=ws://localhost:3101/ws \
SMOKE_REQUIRE_MOCK_LLM=0 node scripts/mock-e2e-smoke.mjs
```

Use `SMOKE_REQUIRE_MOCK_REVIEW=0` only when validating the real async review worker as well.

## Real voice mode

The real ASR/TTS path is now wired through Volcengine's binary WebSocket protocol instead of the earlier JSON placeholder. Keep `MOCK_AUTH=1` while WeChat login is deferred, then disable only voice mocks when validating speech:

```bash
MOCK=0 MOCK_AUTH=1 MOCK_VOICE=0 MOCK_LLM=1 MOCK_REVIEW=1 \
VOLC_VOICE_API_KEY=... VOLC_VOICE_APP_KEY=... \
VOLC_ASR_RESOURCE_ID=volc.seedasr.sauc.duration \
VOLC_TTS_RESOURCE_ID=seed-tts-1.0 VOLC_TTS_FORMAT=mp3 \
pnpm --filter @rsc/server dev
```

For local non-audio smoke tests with `MOCK_VOICE=0`, set `VOICE_TEXT_HARNESS=1` and send `TEXT:...` chunks. In production validation, leave `VOICE_TEXT_HARNESS` unset so mini-program PCM chunks are sent to real ASR and TTS returns MP3 chunks for playback.

## Real voice single-service smoke scripts

After running `pnpm build`, use these scripts to validate Volcengine credentials before testing the mini-program flow:

```bash
MOCK_VOICE=0 VOLC_VOICE_API_KEY=... VOLC_VOICE_APP_KEY=... \
VOLC_TTS_RESOURCE_ID=seed-tts-1.0 VOLC_TTS_FORMAT=mp3 \
node scripts/voice/tts-smoke.mjs
```

This writes `/private/tmp/echoia-tts-smoke.mp3` by default.

For ASR, provide a 16kHz mono PCM file:

```bash
MOCK_VOICE=0 VOLC_VOICE_API_KEY=... VOLC_VOICE_APP_KEY=... \
VOLC_ASR_RESOURCE_ID=volc.seedasr.sauc.duration \
INPUT=/path/to/16k-mono.pcm node scripts/voice/asr-smoke.mjs
```
