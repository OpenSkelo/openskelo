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
