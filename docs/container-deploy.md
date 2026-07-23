# Container deployment guide

The server is a Dockerized Fastify HTTP/WebSocket service. Any production host
must support long-running containers and WebSocket upgrade traffic on `/ws`.
Static/serverless-only platforms are not enough for the realtime practice loop.

## Published image

Every push to `main` publishes a production Docker image to GitHub Container
Registry:

```text
ghcr.io/wangkaiyu001/realtime-speek-coach:latest
ghcr.io/wangkaiyu001/realtime-speek-coach:main
ghcr.io/wangkaiyu001/realtime-speek-coach:sha-<commit-sha>
```

Use the immutable `sha-<commit-sha>` tag for stable releases and rollbacks.

## Required runtime settings

For the first public trial, run the image with these environment variables:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=mysql://echoia_app:<password>@<shared-mysql-host>:3306/<database>
JWT_SECRET=<long-random-secret>
MOCK=1
MOCK_AUTH=1
MOCK_VOICE=1
MOCK_LLM=1
MOCK_REVIEW=1
CORS_ORIGIN=*
DATABASE_PUSH_ON_START=0
```

Use a managed shared MySQL database. The production container refuses a `file:`
database URL because per-instance SQLite state breaks authentication and session
continuity as soon as traffic reaches more than one pod. Ensure the container service
can route to the database private endpoint (for example by attaching the matching VPC
and subnet). Apply Prisma schema updates explicitly; production startup does not run
`db push` unless `DATABASE_PUSH_ON_START=1` is intentionally set. Production also
refuses a missing or placeholder `JWT_SECRET`, because tokens must remain valid across
container restarts and horizontally scaled instances.

## Health and smoke checks

After the host assigns a public HTTPS domain, verify it before pointing the mini
program at it:

```bash
PUBLIC_ORIGIN=https://<your-domain> npm run verify:public
```

This command checks `/api/v1/health` and `/api/v1/ready`, validates HTTPS/WSS endpoint shape, confirms public-trial mock flags, verifies database connectivity, and runs the full mock end-to-end WebSocket flow.

The HTTP service also sends Helmet security headers. The public login endpoint is limited to 20 requests per client per minute to reduce credential/code-exchange abuse; CloudBase gateway controls should still be used for broader DDoS and traffic protection.

## Mini program switch-over

Only after the new public domain passes verification, update
`packages/miniprogram/config.ts`:

```ts
const PRODUCTION_SERVER_ORIGIN = 'https://<your-domain>';
```

Then rebuild/upload the mini program trial or release build. Also add the HTTPS
and WSS domains to the WeChat mini program legal domain settings.

## Platform notes

Suitable targets include CloudBase Cloud Run, Railway, Render, Fly.io, ECS, or
any other Docker host with WebSocket support. The current preferred MVP host is
CloudBase Cloud Run environment `code-realtime-d7gbuxrbze297e600`, service
`echoia-server`, verified at:

```text
https://echoia-server-263603-8-1419519222.sh.run.tcloudbase.com
```
