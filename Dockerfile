FROM node:20-alpine AS base
RUN apk add --no-cache openssl libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@8.15.9 --activate
WORKDIR /app
ENV PRISMA_GENERATE_SKIP_AUTOINSTALL=1

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/miniprogram/package.json packages/miniprogram/
COPY packages/server/package.json packages/server/
COPY packages/voice/package.json packages/voice/
COPY packages/review/package.json packages/review/
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY . .

# Generate Prisma client
RUN pnpm --filter @rsc/server db:generate

# Build
RUN pnpm build

# Production
FROM node:20-alpine AS production
RUN apk add --no-cache openssl libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@8.15.9 --activate
WORKDIR /app
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  MOCK=1 \
  MOCK_AUTH=1 \
  MOCK_VOICE=1 \
  MOCK_LLM=1 \
  MOCK_REVIEW=1 \
  CORS_ORIGIN=*
COPY --from=base /app .
EXPOSE 3000
CMD ["sh", "scripts/docker-start.sh"]
