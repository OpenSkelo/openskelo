#!/usr/bin/env bash
set -euo pipefail

API_URL="${OPENSKELO_API:-http://localhost:4040}"
GOAL="${1:-Add rate limiting to the API}"

printf "\n🦴 OpenSkelo viral demo\n"
printf "Goal: %s\n\n" "$GOAL"

printf "1) Starting runtime (if not already running)...\n"
if ! curl -sf "$API_URL/api/health" >/dev/null 2>&1; then
  echo "   Runtime not detected at $API_URL"
  echo "   Start in another terminal: npx openskelo start"
  exit 1
fi

printf "2) Starting autopilot run...\n"
RUN_LINE=$(npx openskelo autopilot "$GOAL" --api "$API_URL" | tr -d '\r')
echo "$RUN_LINE"

RUN_ID=$(echo "$RUN_LINE" | grep -Eo 'run_[A-Za-z0-9]+' | head -n1 || true)
if [[ -z "$RUN_ID" ]]; then
  echo "Could not parse run id from autopilot output."
  exit 1
fi

printf "\n3) Watching run in terminal...\n"
printf "   Run ID: %s\n\n" "$RUN_ID"

npx openskelo run watch "$RUN_ID" --api "$API_URL"

echo "\n✅ Demo flow complete. Capture this terminal for shareable proof."
