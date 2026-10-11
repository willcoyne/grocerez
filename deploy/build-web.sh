#!/usr/bin/env bash
# Build the Expo web export into deploy/web-dist (served by Caddy). Runs in a node container, so the box needs only Docker.
# Usage: ./deploy/build-web.sh <host>      e.g. ./deploy/build-web.sh pantry.example.com
# Optional env: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, EXPO_PUBLIC_DEMO_KEY
set -euo pipefail
HOST="${1:?usage: build-web.sh <host>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/web-dist"
mkdir -p "$OUT"
find "$OUT" -mindepth 1 -delete
docker run --rm \
  -v "$ROOT/app:/src:ro" -v "$OUT:/out" \
  -e EXPO_PUBLIC_API_URL="https://${HOST}/api" \
  -e EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -e EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID -e EXPO_PUBLIC_DEMO_KEY \
  node:22-slim sh -c 'cp -r /src /build && cd /build && rm -rf node_modules && npm ci && npx expo export --platform web --output-dir /out'
echo "web build written to $OUT"
