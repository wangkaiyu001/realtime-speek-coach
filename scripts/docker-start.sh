#!/bin/sh
set -e

: "${HOST:=0.0.0.0}"
: "${PORT:=3000}"
export HOST PORT

if [ -z "${JWT_SECRET:-}" ] || [ "$JWT_SECRET" = "change-me-in-production" ] || [ "$JWT_SECRET" = "dev-secret-change-me" ]; then
  if command -v openssl >/dev/null 2>&1; then
    JWT_SECRET="$(openssl rand -hex 32)"
  else
    JWT_SECRET="runtime-secret-$(date +%s)-$$"
  fi
  export JWT_SECRET
  echo "[startup] JWT_SECRET was not configured; generated an ephemeral runtime secret. Set a persistent Cloud Run variable before production use."
fi

if [ -n "${DATABASE_URL:-}" ]; then
  case "$DATABASE_URL" in
    file:*)
      db_path="${DATABASE_URL#file:}"
      mkdir -p "$(dirname "$db_path")"
      ;;
  esac
fi

pnpm --filter @rsc/server db:push
exec node packages/server/dist/server/src/index.js
