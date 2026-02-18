# OpenSkelo Audit Closure Checklist

Last updated: 2026-02-17
Source audit: Independent architecture review (feature/block-core-mvp)

Legend:
- [x] DONE
- [~] PARTIAL / IN PROGRESS
- [ ] TODO

---

## 1) Architecture Analysis
- [~] Dual architecture (legacy + DAG) deprecation path complete; hard removal pending
  - Proof: `376cd2e`, `16ab25f`, `66738d3`, `53b0710`
- [ ] Monolithic decomposition (`dag-api.ts`, `dag-dashboard.ts` split)
- [ ] Final dependency/ID strategy review (UUIDv7/sortable IDs optional)

## 2) Code Quality & Implementation
- [x] Parse-time validation hardening for gates/ports
  - Proof: `37c4392`
- [ ] Structured error hierarchy (`SkeloError` family)
- [ ] Mutable-state contract clarity (explicit mutable vs immutable semantics)

## 3) Security Audit
- [x] Remove `new Function()` in expr/transform
  - Proof: `19c6360`
- [x] Shell gates default-deny + opt-in + timeout + audit metadata
  - Proof: `a534aa7`
- [x] Security regression coverage + durable shell audit assertion
  - Proof: `19c6360`, `a534aa7`, `b7be7cc`
- [x] Remove hardcoded Telegram approval target default
  - Proof: `0bf9d44`
- [x] Regex ReDoS hardening strategy (parse-time unsafe pattern guard)
  - Proof: `b616a52`

## 4) Gate System
- [x] Core gate system preserved and strengthened
- [ ] Add semantic/LLM review gate type
- [ ] Add gate types: `json_schema`, `http`, `diff`, `cost`, `latency`
- [ ] Add gate composition logic (OR/conditional)

## 5) Provider Layer
- [x] Ollama adapter implemented
  - Proof: `1b5bbb2`
- [x] OpenAI-compatible adapter implemented (baseURL/auth header/env)
  - Proof: `1b5bbb2`
- [x] Provider override routing tests (name/type)
  - Proof: `deceee7`
- [~] Docs support matrix clarity (implemented vs planned) needs final table
- [ ] Streaming provider interface
- [ ] Full model parameter passthrough (temp/top_p/max_tokens/etc.)

## 6) DAG Executor
- [x] Contract/repair path present and tested
- [ ] Replace approval busy-wait with event/promise wait
- [ ] Improve scheduling beyond batch `Promise.allSettled`
- [ ] Add richer stuck diagnostics
- [~] Per-block timeout enforcement (safety caps present; strict end-to-end proof pending)
- [ ] Cost/budget enforcement

## 7) State Management & Durability
- [~] Durable tables + replay endpoint implemented
- [ ] Store-first/event-sourced reconstruction completion
- [ ] Remove legacy DB schema paths/tables in hard-cut release
- [ ] Numbered migration framework (`schema_migrations` + migration files)

## 8) API & Server
- [x] Legacy `/api/tasks*` deprecation headers
  - Proof: `376cd2e`
- [ ] Rate limiting
- [ ] Request size limits
- [ ] Optional auth model
- [ ] SSE client lifecycle hardening (IDs/dedupe)
- [ ] Error contract/pagination consistency polish

## 9) DX & CLI
- [x] DAG-first CLI commands (`skelo run ...`)
  - Proof: `66738d3`
- [x] Legacy commands moved under explicit namespace (`skelo legacy task ...`)
  - Proof: `53b0710`
- [ ] DAG-only template verification and cleanup
- [ ] YAML line/column diagnostics and typo hints

## 10) Testing & QA
- [x] Expanded integration/security coverage (now 40/40)
  - Proof: `deceee7`, `b7be7cc`
- [ ] Real provider integration test profile (optional/skippable in CI)
- [ ] Performance/stress test baseline
- [ ] Broader security regression/fuzz suite
- [ ] Mutation testing (optional but recommended)

## 11) Performance & Scalability
- [ ] Edge indexing for large DAGs
- [ ] Executor/API isolation strategy (worker thread path)
- [ ] Hosted-scale queue strategy (future)

## 12) Design Philosophy Decisions (to codify)
- [ ] Static vs dynamic DAG scope statement
- [ ] Single-shot vs multi-turn block scope statement
- [ ] Library/framework/platform primary posture statement
- [ ] OpenClaw-coupled vs provider-agnostic strategy statement

## 13) Market/Positioning Alignment
- [~] Messaging improved to DAG-canonical
- [ ] Full claim alignment package (feature matrix + roadmap notes)
- [ ] 60-second demo deliverable (explicit launch artifact)

## 14) Recommended Architecture Changes
- [~] P0/P1 subset done; remaining structural items tracked above

## 15) Prioritized Action Plan Closure
- [x] Security holes closed
- [x] Provider v1 shipped (Ollama + OpenAI-compatible)
- [~] Cleanup started (deprecations complete; hard cut pending)
- [~] YAML validation improved (line/column diagnostics pending)
- [ ] 60-second demo artifact pending

---

## Immediate Remaining Priority (Execution Order)

### P0-Remaining
1. Legacy hard cut (remove legacy task engine/routes/db usage)
   - Plan committed: `LEGACY-HARD-CUT-PLAN.md`
   - Slice A complete: DAG-first API startup path no longer requires task engine wiring
   - Slice B complete: legacy task CLI removed from command surface; legacy /api tasks/log routes removed
   - Slice C progress: legacy core modules (`task-engine`, `gate-engine`, `router`) removed from active codebase
   - Slice C progress: DB init now creates DAG tables only
2. Remove hardcoded Telegram target default
3. Regex ReDoS hardening
4. YAML line/column diagnostics

### P1-Remaining
1. Approval wait model upgrade (no polling loop)
2. Scheduler upgrade beyond batch waits
3. Store-first reconstruction completion
4. Optional auth + rate-limit + request-size safeguards

### P2-Remaining
1. Gate type expansion
2. Cost/budget enforcement
3. Monolith decomposition
4. Perf/stress/mutation testing

---

## Recently Shipped Proof Chain
- `19c6360` fix(security): replace new Function eval with safe AST expression evaluator
- `a534aa7` fix(security): default-deny shell gates with opt-in, timeout, and audit metadata
- `1b5bbb2` feat(providers): add ollama and openai-compatible adapters to dag runtime
- `37c4392` feat(validation): add parse-time gate and port schema validation
- `376cd2e` chore(legacy): add deprecation notices for task CLI and /api/tasks endpoints
- `16ab25f` docs(readme): mark legacy task surface deprecated and DAG runtime canonical
- `66738d3` feat(cli): add DAG run commands for canonical /api/dag runtime
- `53b0710` chore(cli): move legacy task commands under explicit legacy namespace
- `a8720a2` docs(roadmap): add audit remediation board with lane-by-lane git proofs
- `deceee7` test(dag-api): cover provider override routing by type/name to adapter endpoints
- `b7be7cc` test(security): assert shell gate audit metadata persists in durable replay events
