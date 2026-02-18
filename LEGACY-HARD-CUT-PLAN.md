# OpenSkelo Legacy Hard-Cut Plan (Next Release)

Owner: Nora
Status: READY_FOR_EXECUTION
Scope: Remove legacy task/pipeline runtime surfaces after one-release deprecation window.

## Goal
Ship a clean DAG-only runtime surface (`/api/dag/*`, `skelo run ...`) by removing legacy task engine codepaths and old task APIs.

---

## Removal Targets

### 1) CLI
- Remove `skelo legacy task ...` command tree from `src/cli.ts`
- Remove `src/commands/task.ts`

### 2) HTTP API
- Remove legacy endpoints from `src/server/api.ts`:
  - `GET /api/tasks`
  - `POST /api/tasks`
  - `GET /api/tasks/:id`
  - `PATCH /api/tasks/:id`
  - `GET /api/tasks/counts`
  - `GET /api/logs`
  - `GET /api/gate-log`
- Keep `/api/health` + DAG routes mounted via `createDAGAPI`

### 3) Core Legacy Runtime
- Remove legacy modules:
  - `src/core/task-engine.ts`
  - `src/core/gate-engine.ts`
  - `src/core/router.ts`
- Remove legacy config/runtime fields from `src/types.ts` where unused:
  - `pipelines`, `gates`, legacy `Task` shape references

### 4) DB Schema Cleanup
- Stop creating legacy tables in new DB init:
  - `tasks`, `audit_log`, `gate_log`, `dispatch_queue`, `runs`, `run_events`, `run_steps`, `run_step_idempotency`, `agents`
- Keep DAG tables:
  - `dag_runs`, `dag_events`, `dag_approvals`
- Add one-way migration note for users with old DB files.

### 5) Docs
- Remove legacy API/CLI references from README/docs.
- Keep migration note: "legacy task runtime removed in this release".

---

## Sequenced Execution Slices

### Slice A (safe prep)
- Introduce DAG-only API context constructor to avoid taskEngine dependencies.
- Update tests to avoid legacy API assumptions.

### Slice B (CLI/API removal)
- Delete task CLI command and legacy endpoints.
- Ensure `skelo --help` shows DAG-first only.

### Slice C (core/schema removal)
- Delete legacy core modules and schema creation paths.
- Keep backwards compatibility for reading old files only if needed.

### Slice D (docs + release notes)
- Update docs and changelog with hard-cut announcement.

---

## Binary Done Definition
- No `task` command appears in CLI help output.
- No `/api/tasks*` routes exist in router table.
- No legacy task engine imports remain in `src/`.
- New DB init creates DAG tables only.
- Build/test pass and DAG integration tests remain green.

---

## Validation Checklist
- `npm run build` passes
- `npm test` passes
- grep checks:
  - `grep -R "api/tasks" src README.md docs` returns none (except migration notes)
  - `grep -R "task-engine\|gate-engine\|createTaskEngine" src` returns none
- Manual smoke:
  - `skelo run start --example ...` works
  - `/api/dag/run` + `/api/dag/runs/:id` works

---

## Risk Notes
- Existing scripts relying on `/api/tasks*` will break; release notes must include migration commands.
- Old DB files may retain unused legacy tables; cleanup can be optional.
