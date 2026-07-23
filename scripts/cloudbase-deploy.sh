#!/bin/sh
set -e

: "${CLOUDBASE_ENV_ID:?Set CLOUDBASE_ENV_ID to your CloudBase environment ID first}"
: "${CLOUDBASE_SERVICE_NAME:=echoia-server}"
: "${CLOUDBASE_PORT:=3000}"

deploy_dir="$(mktemp -d "${TMPDIR:-/tmp}/echoia-cloudbase-deploy.XXXXXX")"
cleanup() {
  rm -rf "$deploy_dir"
}
trap cleanup EXIT HUP INT TERM

tar -c -f - \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.agents' \
  --exclude='.codex' \
  --exclude='node_modules' \
  --exclude='.pnpm-store' \
  --exclude='dist' \
  --exclude='build' \
  --exclude='coverage' \
  --exclude='tmp' \
  --exclude='.cache' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='*.log' \
  --exclude='*.db' \
  --exclude='*.db-journal' \
  --exclude='*.sqlite' \
  --exclude='*.sqlite-journal' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='project.private.config.json' \
  . | tar -x -f - -C "$deploy_dir"

tcb -e "$CLOUDBASE_ENV_ID" cloudrun deploy \
  -s "$CLOUDBASE_SERVICE_NAME" \
  --port "$CLOUDBASE_PORT" \
  --source "$deploy_dir" \
  --installDependency true \
  --force
