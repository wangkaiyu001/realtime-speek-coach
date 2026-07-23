#!/bin/sh
set -e

: "${HOST:=0.0.0.0}"
: "${PORT:=3000}"
export HOST PORT

if [ -z "${JWT_SECRET:-}" ] || [ "$JWT_SECRET" = "change-me-in-production" ] || [ "$JWT_SECRET" = "dev-secret-change-me" ]; then
  if [ "${NODE_ENV:-}" = "production" ]; then
    echo "[startup] JWT_SECRET is required in production and must be persistent across instances."
    exit 1
  fi
  if command -v openssl >/dev/null 2>&1; then
    JWT_SECRET="$(openssl rand -hex 32)"
  else
    JWT_SECRET="runtime-secret-$(date +%s)-$$"
  fi
  export JWT_SECRET
  echo "[startup] JWT_SECRET was not configured; generated an ephemeral runtime secret. Set a persistent Cloud Run variable before production use."
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[startup] DATABASE_URL is required and must use shared persistent storage."
  exit 1
fi

case "$DATABASE_URL" in
  mysql://*)
    ;;
  file:*)
    if [ "${NODE_ENV:-}" = "production" ]; then
      echo "[startup] Refusing container-local SQLite in production. Configure CloudBase MySQL."
      exit 1
    fi
    db_path="${DATABASE_URL#file:}"
    mkdir -p "$(dirname "$db_path")"
    ;;
  *)
    if [ "${NODE_ENV:-}" = "production" ]; then
      echo "[startup] Production DATABASE_URL must use the mysql:// scheme."
      exit 1
    fi
    ;;
esac

if [ "${DATABASE_PUSH_ON_START:-0}" = "1" ]; then
  echo "[startup] Applying Prisma schema before starting the server."
  pnpm --filter @rsc/server db:push
else
  echo "[startup] Skipping Prisma schema push; run db:push explicitly during database maintenance."
fi

exec node packages/server/dist/server/src/index.js
