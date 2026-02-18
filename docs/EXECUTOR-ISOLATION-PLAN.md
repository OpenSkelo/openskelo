# Executor/API Isolation Strategy (Worker Thread Path)

Last updated: 2026-02-17

## Goal
Decouple HTTP/API lifecycle from DAG execution lifecycle so long-running DAG runs are resilient to API backpressure and safer under load.

## Baseline Architecture
- API process owns request validation, auth, rate-limit, and persistence I/O.
- Executor runs in a dedicated worker-thread lane.
- API submits run jobs + receives progress/finalization events via message channel.

## Message Contract (v1)
- `run:start` (api -> worker): `{ runId, dag, context, options }`
- `run:control` (api -> worker): `{ runId, action: stop|pause|resume }`
- `run:event` (worker -> api): normalized DAG event payloads
- `run:final` (worker -> api): `{ runId, status, traceSummary }`
- `run:error` (worker -> api): `{ runId, code, message, details? }`

## Safety + Durability Requirements
- Worker emits events first; API persists events to `dag_events`.
- API snapshots state to `dag_runs` on key transitions.
- Worker crash handling: API marks affected active runs as orphaned/recoverable.

## Rollout Plan
1. Add worker wrapper around current executor (single worker mode).
2. Keep existing in-process mode as fallback via config flag.
3. Route one test profile through worker mode (smoke only).
4. Expand to controlled worker pool after parity checks.

## Non-Goals (this phase)
- Hosted distributed queue orchestration
- Multi-node scheduling
- Cross-machine run migration
