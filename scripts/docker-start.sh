#!/bin/sh
set -e

: "${HOST:=0.0.0.0}"
: "${PORT:=3000}"
export HOST PORT

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
