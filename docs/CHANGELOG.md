# Changelog

## 2026-02-17

### Iteration 1 — Block core contract hardening (schema/run/step)
- Added `run_steps` persistence table with deterministic `step_index` ordering per run.
- Introduced `RunStepRecord` contract in `src/types.ts`.
- Updated run engine to persist one step record per successful deterministic transition.
- Added `listSteps(runId)` runtime API and exposed steps in:
  - `GET /api/runs/:id`
  - `GET /api/runs/:id/steps`
- Kept backward compatibility by preserving existing `run.blocks` aggregate output history.

### Iteration 2 — Artifact persistence + preview API hardening
- Persisted generated artifact preview HTML to local disk (`.skelo/artifacts/...`) on each successful step.
- Extended artifact payload with local persistence metadata:
  - `file_path`
  - `persisted`
- Added `GET /api/runs/:id/artifact/content` to serve artifact HTML directly from disk for observer clients.

### Iteration 3 — Reliability hardening (idempotency + transactionality + contract tests)
- Added run-step idempotency support for `POST /api/runs/:id/step`:
  - accepts `Idempotency-Key`/`X-Idempotency-Key` header or `idempotencyKey` body field
  - deduplicates same-key/same-payload retries and replays original success/failure response
  - rejects same-key/different-payload re-use with `409 IDEMPOTENCY_KEY_REUSED`
  - rejects mismatched header/body keys with `400`
- Added transactional concurrency control for run mutation:
  - run update + `run_steps` insert + `run_events` append execute atomically
  - introduced `runs.run_version` optimistic CAS field to detect stale writers
  - deterministic conflict semantics on stale mutation: `409 RUN_STEP_CONFLICT`
- Added idempotency persistence table: `run_step_idempotency` with unique `(run_id, idempotency_key)`.
- Expanded test suite with:
  - idempotency dedupe and key-reuse conflict tests
  - response contract snapshots for `/api/runs/:id`, `/steps`, `/artifact`, `/artifact/content`
- Updated README + OPENSKELO docs and regenerated reports under `docs/reports/`.
