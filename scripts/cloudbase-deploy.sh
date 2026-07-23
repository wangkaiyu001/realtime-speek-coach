#!/bin/sh
set -e

: "${CLOUDBASE_ENV_ID:?Set CLOUDBASE_ENV_ID to your CloudBase environment ID first}"
: "${CLOUDBASE_SERVICE_NAME:=echoia-server}"
: "${CLOUDBASE_PORT:=3000}"

tcb -e "$CLOUDBASE_ENV_ID" cloudrun deploy \
  -s "$CLOUDBASE_SERVICE_NAME" \
  --port "$CLOUDBASE_PORT" \
  --source . \
  --installDependency true \
  --force
