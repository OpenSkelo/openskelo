# CLAUDE.md — OpenSkelo Project Context

## What This Project Is
OpenSkelo is an orchestration layer for AI tools.

It does NOT execute AI work — it manages task queuing, dispatches to external tools (Claude Code, Codex, Aider, raw APIs), and verifies output with structural checks called "gates."

Three npm packages in a monorepo:
- `@openskelo/gates` — Wraps any AI output with structural verification + retry-with-feedback
- `@openskelo/adapters` — Thin connectors to execution tools (CLI-based and API-based)
- `@openskelo/queue` — Priority task board with atomic claims, leases, watchdog, state machine

## Architecture Rules
1. **Gates are pure functions.** No side effects except command gates (which run shell commands). No state. No daemon. Import, call, done.
2. **Queue uses SQLite only.** No Redis. No Postgres. No Docker. `better-sqlite3` with WAL mode.
3. **Adapters spawn child processes.** They don't import tool libraries. They shell out to CLI tools and capture stdout/stderr.
4. **Execution is external.** OpenSkelo never calls an LLM directly except in `llm_review` gates (which use a cheap model for verification).
5. **Everything is TypeScript.** Strict mode. No `any` in public interfaces (internal `any` is ok for deserialization boundaries).

## Full Spec
The complete technical specification is in `docs/SPEC.md`.

This includes:
- All TypeScript interfaces
- SQLite schema
- REST API endpoints
- State machine transitions
- Gate type specifications
- Adapter interface and reference implementation
- Configuration format (YAML)
- Build plan with daily tasks

**Always reference docs/SPEC.md before implementing.**
If something isn't in the spec, ask — don't assume.

## Monorepo Structure
```
openskelo/
├── packages/
│   ├── gates/        ← @openskelo/gates (ships first)
│   ├── adapters/     ← @openskelo/adapters
│   └── queue/        ← @openskelo/queue
├── examples/         ← Usage examples
├── docs/
│   └── SPEC.md       ← Full technical specification
├── package.json      ← npm workspaces root
├── tsconfig.base.json
├── vitest.config.ts
└── CLAUDE.md         ← This file
```

## Coding Standards

### Testing
- **TDD preferred.** Write tests first, then implement.
- **Vitest** for all tests. No Jest.
- **Test file naming:** `__tests__/[module].test.ts`
- **Target:** 150+ tests for gates, 100+ for queue, 50+ for adapters

### TypeScript
- Strict mode enabled
- Use `interface` over `type` for object shapes (except unions)
- Export types separately: `export type { GateResult }` in addition to runtime exports
- Use Zod for runtime validation, TypeScript interfaces for compile-time

### Style
- 2-space indent
- No semicolons (use ESLint/Prettier to enforce)
- Prefer `const` over `let`
- Prefer named exports over default exports
- Keep files under 300 lines — split if larger
- One gate type per file in `gates/src/gates/`

### Dependencies
- **Production deps must be minimal.** Gates has ONE dep: `zod`.
- **No lodash, no ramda, no utility libraries.** Use native JS.
- **Peer deps for optional features:** `@anthropic-ai/sdk` is a peer dep for llm_review, not a hard dep.

### Error Handling
- Custom error classes: `GateFailureError`, `GateExhaustionError`, `TransitionError`, `LeaseExpiredError`
- Errors carry structured data (gate results, attempt history) not just messages
- Never swallow errors silently. If a gate can't evaluate, it fails with reason, it doesn't pass.

## Current Phase
> **Update this section as you complete phases.**

**Phase 1: Gates (Days 1-10)**
- [x] Day 1: Monorepo scaffold + CI
- [x] Day 2-3: Core gates (json_schema, expression, regex, word_count)
- [x] Day 4-5: command gate + llm_review gate
- [x] Day 6-7: Gate runner + retry engine
- [x] Day 8: gated() public API
- [ ] Day 9: Docs + README + examples
- [ ] Day 10: Publish @openskelo/gates@0.1.0

**Phase 2: Adapters (Days 11-18)**
- [ ] Day 11-12: Base adapter + types
- [ ] Day 13-14: claude-code adapter
- [ ] Day 15: raw-api adapter
- [ ] Day 16: shell adapter
- [ ] Day 17: codex + aider adapters
- [ ] Day 18: Publish @openskelo/adapters@0.1.0

**Phase 3: Queue (Days 19-35)**
- [ ] Day 19-20: SQLite schema + task store
- [ ] Day 21-23: State machine + transition guards
- [ ] Day 24-25: Priority queue + ordering
- [ ] Day 26-27: Dispatcher + atomic claims
- [ ] Day 28-29: Leases + watchdog
- [ ] Day 30-31: Pipeline support
- [ ] Day 32: REST API
- [ ] Day 33: Audit log
- [ ] Day 34: Dashboard
- [ ] Day 35: Publish @openskelo/queue@0.1.0

**Phase 4: Integration (Days 36-42)**
- [ ] Day 36-37: Config loader (YAML)
- [ ] Day 38-39: CLI tool (npx openskelo)
- [ ] Day 40-41: OpenClaw integration example
- [ ] Day 42: Blog post + launch

## Session Protocol
Each Claude Code session should:
1. Read this file (automatic)
2. Check `docs/SPEC.md` for the relevant section
3. Check existing tests to understand what's built
4. Write tests for the day's deliverable FIRST
5. Implement until tests pass
6. Update the checklist in this file
7. Commit with a descriptive message: `feat(gates): add json_schema gate with 25 tests`
8. Push to origin
