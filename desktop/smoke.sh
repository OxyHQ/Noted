#!/usr/bin/env bash
# Start the desktop shell and check it is still running after a few seconds.
#
#   desktop/smoke.sh <path-to-binary> [seconds]
#
# A process that is alive when the wait ends opened its window and kept running;
# one that is gone crashed on startup. Portable on purpose (no `timeout`, which
# macOS lacks) so the same check runs on Linux, macOS and Windows runners. It says
# nothing about the web app: the window loads an empty page in CI.
set -u

binary="$1"
seconds="${2:-20}"

"$binary" &
pid=$!
sleep "$seconds"

if kill -0 "$pid" 2>/dev/null; then
  echo "the shell started and was still running after ${seconds}s"
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  exit 0
fi

wait "$pid"
code=$?
echo "::error::the shell exited early with code $code"
exit 1
