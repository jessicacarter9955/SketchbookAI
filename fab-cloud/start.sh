#!/bin/sh
set -eu
if [ -z "${FAB_BRIDGE_KEY:-}" ]; then
  echo "FAB_BRIDGE_KEY is required" >&2
  exit 1
fi
exec dbus-run-session -- sh -c 'gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1 || true; exec node /app/fab-cloud/server.cjs'
