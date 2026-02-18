# Tech Lead Briefing: `feature/block-core-mvp`

**Date:** 2026-02-18
**Reviewer:** Tech Lead
**Branch:** `feature/block-core-mvp` @ `1a18960`
**Verdict:** NOT MERGE-READY (32 type errors, 9 security vulns, no `main` branch on remote)

---

## 1. Current State

### 1.1 Build Status

| Check          | Result     | Detail                                      |
|----------------|------------|----------------------------------------------|
| `vitest run`   | PASS       | 104 passed, 2 skipped, 0 failed (6.63s)     |
| `tsc --noEmit` | **FAIL**   | **32 type errors** across 3 files            |
| `eslint src/`  | **BROKEN** | No `eslint.config.js` found; lint script is non-functional |
| `npm audit`    | **FAIL**   | 9 moderate severity vulnerabilities          |

**The build is red.** Tests pass, but the project does not typecheck. That makes tests unreliable — they're running transpiled JS that skips the 32 type errors `tsc` catches.

### 1.2 File Tree with Line Counts

```
src/                          10,055 lines total
  cli.ts                         161  ← 0% coverage
  index.ts                         6  ← 0% coverage
  types.ts                       164
  commands/                    2,020 lines
    auth.ts                      128  ← 0% coverage, 2 type errors
    autopilot.ts                  35  ← 0% coverage
    dag-cli-utils.ts             131  ← 0% coverage
    explain.ts                   122  ← 0% coverage, 1 type error
    init.ts                      392  ← 98% coverage (only tested command)
    kill.ts                       20  ← 0% coverage
    new.ts                        70  ← 0% coverage
    onboard.ts                   383  ← 0% coverage, 2 type errors
    run.ts                       374  ← 0% coverage
    start.ts                     159  ← 0% coverage
    status.ts                     43  ← 0% coverage
    validate.ts                   27  ← 0% coverage
    watch.ts                     136  ← 0% coverage
  core/                        4,639 lines
    auth.ts                       91  ← 75% coverage
    autopilot.ts                 153  ← 98% coverage
    block.ts                      17  ← 100% (barrel re-export)
    block-engine.ts              299  ← 92% coverage
    block-helpers.ts              71  ← 100% coverage
    block-types.ts               313  ← type-only (no runtime)
    config.ts                    105  ← 0% coverage
    dag-executor.ts            1,401  ← 78% coverage, 21 type errors
    dag-parser.ts                466  ← 85% coverage
    db.ts                        104  ← 100% coverage
    deterministic.ts             126  ← 68% coverage
    errors.ts                     19  ← 100% coverage
    expression-eval.ts           133  ← 66% coverage
    gate-evaluator.ts            287  ← 84% coverage
    mock-provider.ts             102  ← 61% coverage
    oauth.ts                     279  ← 84% coverage
    ollama-provider.ts            96  ← 73% coverage
    openai-compatible-provider.ts 115 ← 75% coverage
    openclaw-provider.ts         429  ← 13% coverage
    provider-utils.ts             17  ← 100% coverage
    yaml-utils.ts                 16  ← 100% coverage
  server/                      3,396 lines
    api.ts                        52  ← 75% coverage
    dag-api.ts                 1,386  ← 66% coverage, 1 type error
    dag-api-approval-text.ts      28  ← 11% coverage
    dag-api-errors.ts             15  ← 100% coverage
    dag-dashboard.ts           1,915  ← 100% stmt coverage (HTML template)

tests/                         2,663 lines (22 files)
  auth.test.ts                    94  (4 tests)
  autopilot.planner.test.ts       44  (3 tests)
  block.test.ts                  509  (32 tests)
  content-pipeline.e2e.test.ts   166  (1 test)
  dag-api.integration.test.ts    511  (16 tests)
  dag-executor.contract.test.ts  264  (8 tests)
  dashboard.smoke.test.ts         86  (6 tests)
  examples.dag-only.test.ts       29  (1 test)
  gate.cost-latency.test.ts       50  (2 tests)
  gate.diff.test.ts               49  (2 tests)
  gate.http.test.ts               47  (2 tests)
  gate.json-schema.test.ts        58  (2 tests)
  gate.llm-review.test.ts        238  (8 tests)
  gate.semantic-review.test.ts    47  (2 tests)
  init-template.test.ts           91  (5 tests)
  init.templates.dag.test.ts      50  (2 tests)
  oauth.test.ts                   66  (2 tests)
  perf.stress.baseline.test.ts    62  (1 test)
  provider.integration.optional.test.ts  28  (2 skipped — needs live API)
  provider.params.test.ts         82  (2 tests)
  provider.stream.test.ts         30  (1 test)
  security.fuzz.baseline.test.ts  62  (2 tests)

examples/                        7 YAML pipelines
docs/                           17 markdown + 7 HTML visual docs
scripts/                        4 utility scripts
```

**Total source:** 10,055 lines. **Test:source ratio:** 0.26:1 (low for a runtime engine).

---

## 2. Architecture Map

### Data Flow: CLI to Provider

```
User
  │
  ├── skelo run pipeline.yaml --input prompt="..." --watch
  │     │
  │     ▼
  │   commands/run.ts
  │     ├── Loads + parses DAG YAML (dag-cli-utils.ts → dag-parser.ts)
  │     ├── Validates required inputs against DAG entry ports
  │     ├── POST /api/dag/run  { dag: <yaml>, context: {...} }
  │     └── If --watch: polls /api/dag/runs/:id in a loop
  │
  ├── skelo start --port 4040
  │     │
  │     ▼
  │   commands/start.ts
  │     ├── loadConfig() → reads skelo.yaml (core/config.ts)
  │     ├── createDB() → initializes SQLite (core/db.ts)
  │     ├── createAPI() → base Hono app (server/api.ts)
  │     │     └── /api/health, /api/config, /api/agents, /api/gates
  │     ├── createDAGAPI() → DAG runtime API (server/dag-api.ts)
  │     │     └── Mounted on /api/dag/*
  │     └── Serves dashboard at /dag (server/dag-dashboard.ts)
  │
  ▼
server/dag-api.ts (1,386 lines — the critical orchestration layer)
  │
  ├── POST /api/dag/run
  │     ├── Parse YAML → DAGDef (via createBlockEngine → dag-parser.ts)
  │     ├── Create DAGRun (nanoid IDs, block instances)
  │     ├── Resolve provider per block:
  │     │     ├── config.providers[] → match by name/type
  │     │     ├── createOpenClawProvider()     — 429 lines, 13% covered
  │     │     ├── createOllamaProvider()       — 96 lines, 73% covered
  │     │     ├── createOpenAICompatibleProvider() — 115 lines, 75% covered
  │     │     └── createMockProvider()         — 102 lines, 61% covered
  │     ├── createDAGExecutor(dag, run, { providers, agents, callbacks })
  │     │     └── Returned: executor.run() → Promise<ExecutorResult>
  │     ├── Safety limits: max concurrent runs, max duration, stall/orphan timeout
  │     ├── Persist to SQLite (dag_runs, dag_events, dag_approvals)
  │     └── Emit SSE events to connected clients
  │
  ├── GET /api/dag/runs/:id/events (SSE stream)
  ├── POST /api/dag/runs/:id/approvals (approve/reject)
  └── POST /api/dag/runs/:id/stop

  ▼
core/dag-executor.ts (1,401 lines — the execution engine)
  │
  ├── Topological sort of blocks (block-helpers.ts)
  ├── Main loop: find ready blocks → dispatch in parallel
  │     ├── Pre-gate evaluation (gate-evaluator.ts)
  │     │     └── Types: regex, json_schema, http, diff, cost, latency,
  │     │           llm_review, semantic_review, shell, expression
  │     ├── Input wiring: upstream outputs → downstream inputs via edges
  │     ├── Provider dispatch: ProviderAdapter.dispatch(DispatchRequest)
  │     │     └── Includes: prompt building, model_params, abort signal
  │     ├── Post-gate evaluation
  │     ├── Retry logic (configurable per-block retry policy)
  │     ├── on_gate_fail routing (skip/retry/reroute/fail)
  │     └── Deterministic block handlers (deterministic.ts)
  ├── Approval gates: pause run, wait for human decision
  ├── Iteration: reject → create child run with feedback
  └── Terminal states: completed | failed | cancelled | iterated
```

### Key Architectural Observations

1. **dag-api.ts owns too much.** It's the provider factory, the run lifecycle manager, the SSE broadcaster, the persistence layer, AND the HTTP handler. The audit checklist acknowledges this ("monolithic decomposition: partial").

2. **Module-level mutable state in dag-api.ts.** Lines 37-44 declare 8 `Map` objects at module scope (`activeRuns`, `runAbortControllers`, `sseClients`, etc.). The `createDAGAPI()` function clears them on each call, but this means the entire DAG API is a singleton. Multiple test suites importing this module will share state.

3. **dag-executor.ts has a clean contract** — the `ExecutorOpts` interface is well-defined. But the 1,401 lines contain 21 type errors, mostly from `"cancelled"` and `"budget"` values that don't match the declared type unions. This means the type system and the runtime have diverged — the code handles states the types don't know about.

4. **Provider adapters are instantiated per-run** inside `dag-api.ts`, not cached or pooled. For Ollama (local) this is fine; for cloud providers with connection overhead, this could be a latency issue at scale.

---

## 3. TODO / FIXME / HACK Comments

**Source code (`src/`):** Zero. Grep for `TODO|FIXME|HACK|XXX|KLUDGE` returned no matches.

**Test code (`tests/`):** Zero.

This is either impressively clean or a red flag that open work is tracked outside the code. In this case, it's the latter — the ROADMAP.md and AUDIT-CLOSURE-CHECKLIST.md contain the real open items:

### Open Items from ROADMAP.md (Execution Board)

| Item | Phase | Status |
|------|-------|--------|
| Event sequence IDs + replay endpoint | A | IN_PROGRESS |
| Store-driven run reconstruction | A | PENDING |
| Execution vs connection state separation | B | PENDING |
| SSE resume cursor + fallback coherence | B | IN_PROGRESS |
| Stale-run quorum/backoff logic | B | PENDING |
| Runtime truth verification | B | PENDING |
| Approval adapter contract (Telegram/Webhook) | C | PENDING |
| Approval TTL + retry/escalation | C | PENDING |
| Restart recovery for active/pending runs | D | PENDING |
| Admin replay/recover/requeue endpoints | D | PENDING |

### Open Items from AUDIT-CLOSURE-CHECKLIST.md

| Item | Status |
|------|--------|
| Shell gate audit-persistence assertion | OPEN |
| Monolithic decomposition (dag-api.ts, dag-dashboard.ts) | PARTIAL |
| Store-first/event reconstruction | PARTIAL |
| Messaging alignment to DAG-canonical | PARTIAL |

---

## 4. Dependency Audit

### 4.1 Security Vulnerabilities (9 moderate)

```
npm audit — 9 moderate severity issues

ajv <8.18.0           ReDoS via $data option (GHSA-2g4f-4pwh-qvx6)
  └── via @eslint/eslintrc → eslint (dev dependency)

esbuild <=0.24.2      Dev server allows cross-origin reads (GHSA-67mh-4wv8-2f99)
  └── via vite → vite-node → vitest (dev dependency)
```

**Assessment:** All 9 vulnerabilities are in the dev-dependency chain (eslint, vitest/vite). None affect the production runtime. Fix is upgrading vitest (^1.0 → ^4.0) and eslint (^9.0 → ^10.0), both breaking changes.

### 4.2 Outdated Packages

| Package             | Current | Latest | Severity |
|---------------------|---------|--------|----------|
| @clack/prompts      | 0.11.0  | 1.0.1  | Major bump — API may break |
| @types/node         | 20.x    | 25.x   | Types only, low risk |
| @vitest/coverage-v8 | 1.6.1   | 4.0.18 | Major — must match vitest |
| better-sqlite3      | 11.x    | 12.x   | Major — native addon, test carefully |
| commander           | 12.x    | 14.x   | Major — CLI framework |
| eslint              | 9.x     | 10.x   | Major — needs config migration |
| open                | 10.x    | 11.x   | Major — ESM changes |
| vitest              | 1.6.1   | 4.0.18 | Major — test framework |

**8 packages are behind their latest major version.** The vitest/coverage-v8 lag is the most actionable since it also resolves the esbuild security advisory.

### 4.3 Unused Dependencies

| Package | Status | Evidence |
|---------|--------|----------|
| `ws`    | **UNUSED** | Zero import statements in `src/`. Not imported in any source file. Declared as runtime dep in package.json. |

`ws` should be moved to devDependencies or removed entirely. It inflates the install footprint with a native addon for no reason.

### 4.4 Missing Configuration

**ESLint is declared as a devDependency (`^9.0.0`) with a `lint` script (`eslint src/`), but there is no `eslint.config.js` file.** The lint script crashes on every invocation:

```
ESLint: 9.39.2
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
```

This means linting has never been enforced. Either add a config or remove the dependency and script.

---

## 5. Test Coverage Gaps

### 5.1 Overall Coverage

```
Statements: 64.83%    Branches: 60.79%    Functions: 72.51%    Lines: 64.83%
```

### 5.2 Modules with ZERO Coverage (0% statements)

| File | Lines | Risk |
|------|-------|------|
| `cli.ts` | 161 | CLI entry point — never exercised |
| `index.ts` | 6 | Public API surface — never exercised |
| `commands/auth.ts` | 128 | Auth login flow |
| `commands/autopilot.ts` | 35 | NL-to-DAG planner CLI |
| `commands/dag-cli-utils.ts` | 131 | DAG path resolution, input parsing |
| `commands/explain.ts` | 122 | DAG explanation output |
| `commands/kill.ts` | 20 | Emergency stop |
| `commands/new.ts` | 70 | Scaffold new DAG |
| `commands/onboard.ts` | 383 | Full onboarding wizard |
| `commands/run.ts` | 374 | Primary run command |
| `commands/start.ts` | 159 | Server startup |
| `commands/status.ts` | 43 | Health display |
| `commands/validate.ts` | 27 | YAML validation CLI |
| `commands/watch.ts` | 136 | Terminal watch mode |
| `core/config.ts` | 105 | Config loading from skelo.yaml |

**Total untested:** 1,899 lines across 15 modules (19% of the codebase).

The entire `commands/` layer is untested except `init.ts`. This means the primary user-facing surface — `skelo run`, `skelo start`, `skelo watch` — has never been exercised by any test.

### 5.3 Critically Under-Tested Modules

| File | Lines | Stmts | Risk |
|------|-------|-------|------|
| `openclaw-provider.ts` | 429 | 13% | The flagship provider has 87% untested code |
| `mock-provider.ts` | 102 | 61% | The test-double provider isn't fully tested itself |
| `dag-api.ts` | 1,386 | 66% | 470+ untested lines in the orchestration core |
| `dag-executor.ts` | 1,401 | 78% | 300+ untested lines in the execution engine |
| `dag-api-approval-text.ts` | 28 | 11% | Approval notification templates |

### 5.4 What IS Well-Tested

- **block-engine.ts** (92%), **block-helpers.ts** (100%), **block.ts** (100%) — the core block model
- **db.ts** (100%) — database layer
- **errors.ts** (100%), **provider-utils.ts** (100%), **yaml-utils.ts** (100%) — utilities
- **gate-evaluator.ts** (84%) with dedicated test files for each gate type
- **dag-executor.ts** (78%) with contract tests
- **dag-api.ts** (66%) with 16 integration tests

### 5.5 The Audit Checklist Claims "40/40"

The AUDIT-CLOSURE-CHECKLIST.md states: "Expanded integration/security coverage (now 40/40)". Actual test count is **104 tests across 22 files** (2 skipped). The "40/40" likely refers to an earlier milestone. The test count has grown but the coverage percentage (64.83%) tells the real story.

---

## 6. Merge Readiness Assessment

### Branch Topology — A Process Problem

`feature/block-core-mvp` and `master` point to the **exact same commit** (`1a18960`). The merge-base is the HEAD of both branches. There are zero divergent commits.

Additionally, **there is no `main` or `master` branch on the remote** — only `origin/feature/block-core-mvp` and `origin/claude/tech-lead-briefing-zIGFD` exist.

This means either:
- Work has been committed directly to both branches simultaneously, or
- One was fast-forwarded to match the other, or
- The "feature branch" workflow was never actually used

**The merge question is moot — there is nothing to merge.** The real question is: *is this codebase ready for a v0.1.0 release from any branch?*

### Commit Log (50 commits, all from 2026-02-18)

The entire repository was built in a single day. The commit history shows a clear progression:

1. **Commits 1-11** — Audit remediation: gate types, gate composition, audit proofs
2. **Commits 12-18** — Docs alignment, execution checklist, CORS, init templates
3. **Commits 19-25** — Demo tooling, autopilot planner, llm_review gate
4. **Commits 26-35** — Dashboard fixes, UI polish, watch command, kill command
5. **Commits 36-40** — Block module split refactor (5 consecutive refactor commits)
6. **Commits 41-44** — Provider improvements, UX polish, OpenRouter support
7. **Commits 45-50** — Auth/OAuth, onboarding wizard, test fix

Full log (chronological):

```
7e361ff docs(audit): record http gate implementation proof sha
97b5c97 feat(gates): add semantic_review gate baseline for keyword coverage
0794552 docs(audit): record semantic-review gate proof sha
7d90e40 feat(gates): add gate_composition all|any logic for pre/post gates
4aaf3e1 docs(audit): record gate composition implementation proof sha
662416b docs(audit): close checklist TODO placeholder
2eb486e docs(audit): record checklist-closure proof sha
f2e847e docs(audit): add final closure report and README pointer
6d9ca44 docs(audit): mark YAML diagnostics item complete with proof shas
74705b7 docs: align messaging and canonical docs to DAG-first post-audit priorities
7461596 docs: add phased execution checklist for v1-to-v2 delivery
ec233f4 feat(p0): add DAG API CORS and graduate init templates to DAG-first
1fbc589 feat(gates): implement llm_review second-model judge with fail-closed parsing
be562c6 feat(autopilot): add NL-to-DAG planner thin-slice command with retry
d448512 feat(demo): add terminal run watch view and viral capture runbook
a8bf0e0 docs(demo): add launch post draft and phase-4 artifact tracking
fcd5a80 feat(demo): add one-command viral demo runner script
7a40300 chore(surface): remove legacy /dashboard route and canonize /dag
adfc4b6 fix(provider): fallback unknown override to local and add openclaw in demo config
ccfbf36 fix(ui): follow latest iterated run aggressively and highlight paused approval block
30db040 fix(ui): stop live preview from reloading unchanged artifact each poll
0955735 feat(cli): add skelo kill command for emergency stop-all
43273f5 feat(cli): add top-level skelo watch for terminal pipeline visualization
f7cbaa2 fix(ui): keep controls active across reject-iterate handoff and follow child run ids
dacb787 fix(cli): make watch follow iterated child runs by default
a220ec3 feat(ui): add long-running block warning banner with timeout countdown
26b2a43 feat(cli): enrich watch output with progress bar, cycle/chain, active block runtime
12e4c47 feat(TASK-UX): add run <dag> --input --watch plus validate/explain/new commands
2b96876 docs(proof): add UX CLI ship proof with inline command evidence
e3f06a9 feat(TASK-llm-gate): ship hybrid deterministic runtime and llm review gate
73e6a2e fix(TASK-dashboard): restore dag selector/render and lock config controls while running
3aa6a65 chore(TASK-stability): pin node22, harden start command, and lock DAG-first defaults
c350588 chore(TASK-cleanup): ignore local patch bundles and demo artifacts
309ac52 fix(TASK-engine): tighten on_gate_fail validation and correct edge type refs
2a3d4c5 refactor(TASK-block-split): add phase-1 module entrypoints for block engine
9637674 refactor(TASK-block-split): extract block type definitions to block-types module
e4b0c22 refactor(TASK-block-split): extract DAG parser implementation into dag-parser module
676b1e8 refactor(TASK-block-split): extract gate evaluation runtime into gate-evaluator module
b49ac78 refactor(TASK-block-split): move runtime engine and shared helpers out of block barrel
8a25766 refactor(TASK-providers): dedupe prompt builder into shared provider utils
5e60b57 feat(TASK-ux-polish): improve run input errors and surface block routing provider/model context
750fb2c feat(TASK-providers): add openrouter provider type and update provider matrix
4368a1c feat(auth): add auth store and runtime token resolution for providers
d74da24 feat(auth): add auth status/logout commands and cli wiring
1c733be feat(onboard): add onboarding command scaffold and oauth refresh primitive
efa06cd fix(onboard): validate connections, add oauth option placeholder, and generate parseable DAG templates
2e6a7b2 fix(onboard): add healthcheck timeouts and harden non-interactive validation errors
7f7ac7f feat(onboard): implement OpenAI PKCE oauth login flow and token persistence
6102c7a feat(auth): add auth login openai and improve oauth onboarding fallback UX
1a18960 fix(tests): close db after stopping active DAG runs to eliminate shutdown snapshot race
```

---

## 7. Prioritized Punch List

### P0 — Merge/Release Blockers

1. **Fix all 32 type errors.** `tsc --noEmit` must pass. The 21 errors in `dag-executor.ts` are the most concerning — they reveal type unions that don't include runtime states like `"cancelled"`, `"iterated"`, and `"budget"`. The types and the code have diverged. This is a correctness risk.

2. **Create or fix `eslint.config.js`.** The lint script is broken. Either add a real config or remove the dead `eslint` dependency and script. A runtime project shipping without linting is not acceptable.

3. **Resolve the branch topology.** There is no `main`/`master` on the remote. Decide on a branching strategy and push the target branch so PRs have something to merge into.

### P1 — Ship Blockers (per ROADMAP release gate criteria)

4. **Raise test coverage on the commands layer.** 12 out of 13 command modules have 0% coverage. The `skelo run` command (374 lines) is the most important user-facing path and has zero tests. At minimum: test `run`, `start`, `validate`, and `watch`.

5. **Test the OpenClaw provider.** At 13% coverage on 429 lines, the flagship provider adapter is essentially untested. Given that the ROADMAP says "OpenClaw-native first and recommended", this is a credibility gap.

6. **Add `config.ts` coverage.** Config loading is at 0%. This is the first thing that runs on `skelo start`. A broken config path means a broken product.

7. **Remove or move `ws` to devDependencies.** It's declared as a runtime dependency but imported nowhere. Dead weight.

### P2 — Technical Debt

8. **Decompose `dag-api.ts` (1,386 lines).** The audit checklist marks this as "partial". Extract: provider factory, run lifecycle manager, SSE broadcaster, and persistence layer into separate modules.

9. **Decompose `dag-dashboard.ts` (1,915 lines).** This is a single function that returns an HTML string. It's the largest file in the codebase and it's an inline template. Consider moving to a real template or static file.

10. **Eliminate module-level mutable state in `dag-api.ts`.** The 8 module-scope `Map` objects (lines 37-44) make the module a hidden singleton. This creates test isolation problems and prevents future multi-instance deployments.

11. **Upgrade vitest and eslint.** Both are 3+ major versions behind. The vitest upgrade resolves the esbuild security advisory. The eslint upgrade requires the config migration the project never did.

12. **Complete Phase A durability.** The ROADMAP marks "event sequence IDs + replay" as IN_PROGRESS and "store-driven run reconstruction" as PENDING. These are P0 in the roadmap's own priority scheme. The current implementation still has in-memory run state that doesn't survive restarts.

### P3 — Nice to Have

13. **Add `@types/ws` usage or remove.** If `ws` is removed, its type package should go too.

14. **Upgrade `@clack/prompts` to 1.x.** The 0.11 → 1.0 jump likely fixes the `spinner.update()` type errors in `auth.ts` and `onboard.ts` (4 of the 32 type errors).

15. **Add CI/CD.** No GitHub Actions, no `.gitlab-ci.yml`, no CI of any kind. The `typecheck` and `test` scripts exist but nothing runs them automatically. In a project with 32 type errors that tests don't catch, automated CI is essential.

---

## Summary

The runtime core (dag-executor, block-engine, gate-evaluator) is solid and reasonably well-tested. The gate system is comprehensive. The architecture is sound.

But the project has accumulated debt faster than it's been paid down: 32 type errors, a broken linter, 9 security advisories, 15 modules at 0% coverage, and an unused dependency in production. The branch topology makes "merge readiness" a non-question — both branches are identical.

**Before any release:** fix the type errors, add a lint config, test the CLI commands, and set up CI. Everything else can be sequenced after.

---

*Generated by tech lead review on 2026-02-18.*
