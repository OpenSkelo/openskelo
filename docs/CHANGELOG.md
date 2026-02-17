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
