#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_PATH="${1:-$ROOT_DIR/openskelo.ladder.yaml}"
BASE_URL="${2:-http://127.0.0.1:4820}"
HEALTH_URL="$BASE_URL/health"
LOG_PATH="$ROOT_DIR/tmp/openskelo-ladder.log"
RESULTS_JSON="$ROOT_DIR/tmp/ladder-results.json"
SUMMARY_MD="$ROOT_DIR/tmp/ladder-summary.md"

mkdir -p "$ROOT_DIR/tmp"
cd "$ROOT_DIR"

# Clean stale artifacts.
: > "$LOG_PATH"
rm -f "$RESULTS_JSON" "$SUMMARY_MD"

node packages/queue/dist/cli.js start --config "$CONFIG_PATH" > "$LOG_PATH" 2>&1 &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Preflight health gate: fail fast if runtime never comes up.
READY=0
for _ in {1..20}; do
  if curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if [[ "$READY" -ne 1 ]]; then
  python3 - "$LOG_PATH" "$RESULTS_JSON" <<'PY'
import json, pathlib, re, sys

log_path = pathlib.Path(sys.argv[1])
out_path = pathlib.Path(sys.argv[2])
text = log_path.read_text(encoding='utf-8', errors='ignore') if log_path.exists() else ''

code = 'BOOTSTRAP_UNKNOWN'
detail = 'Runtime failed preflight before /health became ready.'

if 'ERR_MODULE_NOT_FOUND' in text and '@openskelo/adapters' in text:
    code = 'BOOTSTRAP_MODULE_RESOLUTION'
    detail = 'Queue bootstrap failed due to unresolved @openskelo/adapters import.'
elif 'ERR_MODULE_NOT_FOUND' in text:
    code = 'BOOTSTRAP_MODULE_RESOLUTION'
    detail = 'Queue bootstrap failed due to unresolved module import.'
elif 'better-sqlite3' in text and ('failed to load' in text.lower() or 'Cannot find module' in text):
    code = 'BOOTSTRAP_NATIVE_MODULE'
    detail = 'Queue bootstrap failed due to SQLite native module load error.'
elif ('EADDRINUSE' in text) or ('address already in use' in text.lower()):
    code = 'BOOTSTRAP_PORT_IN_USE'
    detail = 'Queue bootstrap failed because the configured port is already in use.'

results = [
    {
        'test': 3,
        'result': 'FAIL',
        'code': code,
        'stage': 'INFRA_BLOCKED',
        'detail': detail,
    }
]
for t in range(4, 8):
    results.append({
        'test': t,
        'result': 'BLOCKED',
        'code': 'DOWNSTREAM_BLOCKED',
        'stage': 'INFRA_BLOCKED',
        'detail': f'Blocked by test 3 ({code}) root cause.',
        'blocked_by_test': 3,
        'blocked_by_code': code,
    })

out_path.write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
print(json.dumps(results, indent=2))
PY

  python3 "$ROOT_DIR/scripts/ladder-summarize.py" "$RESULTS_JSON" "$SUMMARY_MD" >/dev/null || true

  echo "[P1] Infra preflight failed; classified and blocked downstream tests."
  echo "Results: $RESULTS_JSON"
  echo "Summary: $SUMMARY_MD"
  echo "--- last runtime log ---"
  tail -n 60 "$LOG_PATH" || true
  exit 1
fi

python3 - "$HEALTH_URL" "$RESULTS_JSON" <<'PY'
import json, sys, time, urllib.request

health_url = sys.argv[1]
out_path = sys.argv[2]
results = []
for test_id in range(3, 8):
    try:
        with urllib.request.urlopen(health_url, timeout=5) as resp:
            body = resp.read().decode('utf-8', 'ignore')
            passed = resp.status == 200 and '"status":"ok"' in body
            if passed:
                results.append({
                    'test': test_id,
                    'result': 'PASS',
                    'code': 'OK',
                    'stage': 'READY',
                    'detail': f'HTTP {resp.status}',
                })
            else:
                results.append({
                    'test': test_id,
                    'result': 'FAIL',
                    'code': 'HEALTH_UNEXPECTED_RESPONSE',
                    'stage': 'INFRA_BLOCKED',
                    'detail': f'HTTP {resp.status}',
                })
    except Exception as exc:
        results.append({
            'test': test_id,
            'result': 'FAIL',
            'code': 'HEALTH_REQUEST_FAILED',
            'stage': 'INFRA_BLOCKED',
            'detail': str(exc),
        })
    time.sleep(0.2)

with open(out_path, 'w', encoding='utf-8') as f:
    f.write(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
PY

python3 "$ROOT_DIR/scripts/ladder-summarize.py" "$RESULTS_JSON" "$SUMMARY_MD" >/dev/null

echo "Results: $RESULTS_JSON"
echo "Summary: $SUMMARY_MD"
