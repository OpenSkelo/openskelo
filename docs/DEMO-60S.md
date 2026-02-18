# OpenSkelo 60-Second Demo

Goal: show deterministic DAG execution + replay visibility in under a minute.

## Prereqs
- OpenSkelo project cloned
- `npm install` complete
- Optional local model runtime (Ollama/OpenClaw)

## Steps

```bash
# 1) start server
npm run build
node dist/cli.js start

# 2) in another terminal, start a run
node dist/cli.js run start --example coding-pipeline.yaml --context-json '{"prompt":"Build a login page"}'

# 3) list and inspect runs
node dist/cli.js run list
node dist/cli.js run status <run_id>

# 4) open dashboard + replay path
open http://localhost:4040/dag
curl "http://localhost:4040/api/dag/runs/<run_id>/replay?since=0"
```

## What to point out in demo
- Canonical runtime is `/api/dag/*`
- Run-level deterministic event trail
- Approval/reject path support via `/api/dag/runs/:id/approvals`
- Durable replay endpoint for audit/debug

## Expected outcome
Within ~60 seconds, reviewer sees:
1. run creation
2. run progression/status
3. replayable event history
