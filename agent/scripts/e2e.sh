#!/usr/bin/env bash
# Manual end-to-end check: login as the seeded demo user, start an agent run, poll until it ends, apply the plan.
#
# Prerequisites (all running): Postgres + seeded server (AGENT_URL / AGENT_SHARED_SECRET set) and this agent
# service (`uvicorn app.main:app --port 8000`) with the SAME AGENT_SHARED_SECRET and AGENT_PUBLIC_API_URL
# reachable from the agent. Needs curl and jq.
#
# Usage:  API=http://localhost:3000/api ./scripts/e2e.sh
# Env:    API       server base incl. /api            (default http://localhost:3000/api)
#         USER_ID   seeded user to log in as          (default seed "User 1")
#         PROMPT    run prompt                        (default: the demo prompt)
#         BUDGET    budgetCents                       (default 6000)
#         TIMEOUT   seconds to wait for the run       (default 150)
#         DEMO_KEY  only if the server runs in production with DEMO_KEY set
set -euo pipefail

API="${API:-http://localhost:3000/api}"
USER_ID="${USER_ID:-00000000-0000-4000-8000-000000000101}"
# Default kept in its own variable: macOS bash 3.2 treats the apostrophe inside ${VAR:-...} as a quote.
DEFAULT_PROMPT="Plan 3 dinners for this week. Use what's expiring first, keep it under \$60, and make sure everyone can eat it."
PROMPT="${PROMPT:-$DEFAULT_PROMPT}"
BUDGET="${BUDGET:-6000}"
TIMEOUT="${TIMEOUT:-150}"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
demo_hdr=()
[ -n "${DEMO_KEY:-}" ] && demo_hdr=(-H "x-demo-key: ${DEMO_KEY}")

echo "1/5 login-as ${USER_ID}"
TOKEN=$(curl -fsS -X POST ${demo_hdr[@]+"${demo_hdr[@]}"} "$API/dev/login-as/$USER_ID" | jq -r .token)
AUTH=(-H "Authorization: Bearer $TOKEN")

echo "2/5 find the group"
GID=$(curl -fsS "${AUTH[@]}" "$API/groups" | jq -r '.[0].id')
[ -n "$GID" ] && [ "$GID" != "null" ] || { echo "no group for this user" >&2; exit 1; }
echo "    group $GID"

echo "3/5 start run"
BODY=$(jq -n --arg p "$PROMPT" --argjson b "$BUDGET" '{prompt:$p, budgetCents:$b}')
RUN=$(curl -fsS -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d "$BODY" "$API/groups/$GID/agent/runs" | jq -r .runId)
echo "    run $RUN"

echo "4/5 poll (every 1.5 s, up to ${TIMEOUT}s)"
START=$(date +%s); SEEN=0; STATUS=running
while :; do
  JSON=$(curl -fsS "${AUTH[@]}" "$API/groups/$GID/agent/runs/$RUN")
  STATUS=$(jq -r .status <<<"$JSON")
  jq -r --argjson n "$SEEN" '.steps[$n:][] | "    [\(.seq)] \(.status)\t\(.label)"' <<<"$JSON" || true
  SEEN=$(jq '.steps | length' <<<"$JSON")
  [ "$STATUS" != "running" ] && break
  [ $(( $(date +%s) - START )) -ge "$TIMEOUT" ] && { echo "timed out waiting for the run" >&2; exit 1; }
  sleep 1.5
done
echo "    status=$STATUS  elapsed=$(( $(date +%s) - START ))s  meta=$(jq -c .meta <<<"$JSON")"
[ "$STATUS" = "proposed" ] || { echo "run ended as '$STATUS': $(jq -r .error <<<"$JSON")" >&2; exit 1; }
jq -r '.plan.meals[] | "    - \(.day // "-") \(.title)  (missing: \(.missing | join(", ")))"' <<<"$JSON"

echo "5/5 apply"
RESULT=$(curl -fsS -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d '{}' "$API/groups/$GID/agent/runs/$RUN/apply")
echo "    added=$(jq .added <<<"$RESULT") skipped=$(jq -c '[.skipped[].name]' <<<"$RESULT")"
LIST=$(curl -fsS "${AUTH[@]}" "$API/groups/$GID/shopping-list")
NOTED=$(jq --arg r "$RUN" '[.[] | select(.note != null and (.note | startswith("✨")))] | length' <<<"$LIST")
echo "    list rows with a ✨ note: $NOTED"
[ "$NOTED" -ge "$(jq .added <<<"$RESULT")" ] || { echo "FAIL: fewer noted rows than added" >&2; exit 1; }
echo "OK"
