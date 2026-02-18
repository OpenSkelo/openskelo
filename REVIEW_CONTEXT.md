# OpenSkelo Review Context

## What this is
OpenSkelo is a DAG-based AI pipeline orchestrator. Stack: TypeScript (ESM), Hono API server, SQLite persistence, Vitest tests, local-first runtime.

## Architecture map
- `src/core/` — DAG parser/executor, blocks, deterministic handlers, gates, providers, auth/OAuth.
- `src/server/` — API and dashboard routes (`dag-api`, dashboard wiring, lifecycle control).
- `src/commands/` — CLI surface (`init`, `start`, `run`, `watch`, `auth`, `onboard`, etc.).
- `tests/` — unit/integration/e2e tests.

## Core conventions
- Provider/token resolution order:
  1) auth store by provider name, 2) auth store by provider type, 3) env var, 4) `OPENAI_API_KEY` fallback.
- Auth source of truth: `~/.skelo/auth.json` (global), env as fallback.
- DAG-first behavior is canonical. Avoid introducing legacy pipeline/stage semantics.
- Error handling: handle null/undefined, timeouts, and external API failure paths with actionable messages.
- Types: avoid `any`; prefer explicit types and type guards.
- Tests: new features should include tests; bug fixes should include regression coverage.

## Review policy
- Prioritize correctness, safety, and architectural consistency over style nitpicks.
- For CI/internal tooling files (`.github/workflows/*`, CI scripts), apply lighter scrutiny than user-facing runtime code.
- Distinguish **blocking issues** (breakage/security/data loss/regression risk) vs **advisory improvements**.
