#!/usr/bin/env bash
# Boot the built API image the way ECS runs it, against a throwaway Postgres,
# and fail unless the production runtime (Bun under dumb-init, the image's own
# user, entrypoint and CMD) can:
#   1. apply both migrator phases with the command deploy-aws.yml runs,
#   2. serve /health/ready with 200 from the image's default CMD, with Bun as
#      the server process and the Dockerfile HEALTHCHECK reporting healthy,
#   3. turn SIGTERM (`docker stop`, as ECS does on a rollout) into the graceful
#      shutdown and exit 0,
#   4. run the capability-catalog one-shot under Bun and exit non-zero when it
#      has no identity (the success path is in scripts/check-backend-entrypoints.ts).
# A unit suite cannot see any of these: they are properties of the image.
set -euo pipefail

: "${IMAGE:?IMAGE required}"
: "${DATABASE_URL:?DATABASE_URL required (a throwaway database named noted)}"
PORT="${PORT:-3001}"
NAME="noted-api-smoke-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for phase in pre post; do
  docker run --rm --network host -e DATABASE_URL "$IMAGE" \
    bun packages/backend/dist/migrate.js --target-database=noted --phase="$phase"
done

docker run -d --name "$NAME" --network host -e DATABASE_URL -e PORT="$PORT" "$IMAGE" >/dev/null

ready=
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health/ready" || true)" = 200 ]; then
    ready=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]; then
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  docker logs "$NAME" || true
  echo "::error::the API image never answered /health/ready with 200"
  exit 1
fi

# PID 1 is dumb-init and its only child is Bun running the bundle. A wrapper
# shell in between would swallow the SIGTERM tested below; a `node` here would
# mean the CMD regressed (in this image `node` is a symlink to bun).
pid1=$(docker exec "$NAME" cat /proc/1/cmdline | tr '\0' ' ')
case "$pid1" in
  "dumb-init -- bun packages/backend/dist/index.js "*) ;;
  *)
    echo "::error::PID 1 is '$pid1', expected 'dumb-init -- bun packages/backend/dist/index.js'"
    exit 1
    ;;
esac
# shellcheck disable=SC2016 # expanded inside the container
server=$(docker exec "$NAME" sh -c '
  for d in /proc/[0-9]*; do
    if [ "$(awk "/^PPid:/ {print \$2}" "$d/status" 2>/dev/null)" = 1 ]; then
      tr "\0" " " <"$d/cmdline"; echo
    fi
  done')
case "$server" in
  "bun packages/backend/dist/index.js "*) ;;
  *)
    echo "::error::dumb-init's child is '$server', expected 'bun packages/backend/dist/index.js'"
    exit 1
    ;;
esac
uid=$(docker exec "$NAME" id -u)
if [ "$uid" != 1000 ]; then
  echo "::error::the server runs as uid $uid, expected the image's unprivileged bun user (1000)"
  exit 1
fi

# The Dockerfile HEALTHCHECK (interval 30 s) must pass under Bun too.
health=
for _ in $(seq 1 75); do
  health=$(docker inspect -f '{{.State.Health.Status}}' "$NAME")
  [ "$health" = healthy ] && break
  [ "$health" = unhealthy ] && break
  sleep 1
done
if [ "$health" != healthy ]; then
  docker inspect -f '{{json .State.Health}}' "$NAME" || true
  echo "::error::the image HEALTHCHECK reported '$health', expected healthy"
  exit 1
fi

docker stop -t 35 "$NAME" >/dev/null
exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")
logs=$(docker logs "$NAME" 2>&1)
if [ "$exit_code" != 0 ] || ! grep -q 'Graceful shutdown complete' <<<"$logs"; then
  printf '%s\n' "$logs"
  echo "::error::SIGTERM did not end in a graceful exit 0 (exit code $exit_code)"
  exit 1
fi

# The catalog one-shot, as deploy-aws.yml overrides the CMD, with no identity.
set +e
catalog=$(docker run --rm --network host "$IMAGE" \
  bun packages/backend/dist/register-capability-catalog.js 2>&1)
catalog_code=$?
set -e
if [ "$catalog_code" = 0 ] || ! grep -q 'Noted has no Oxy identity' <<<"$catalog"; then
  printf '%s\n' "$catalog"
  echo "::error::the catalog one-shot without an identity exited $catalog_code instead of failing on it"
  exit 1
fi

echo "API image smoke passed: migrations, /health/ready, Bun under dumb-init, HEALTHCHECK, graceful SIGTERM, catalog one-shot"
