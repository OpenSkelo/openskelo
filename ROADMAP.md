# OpenSkelo Roadmap (Living)

_Last updated: 2026-02-17 (America/New_York)_
_Owner: Nora + Andy_

This is the single source of truth for OpenSkelo priorities.
As new threads/snapshots appear, they get merged here under the correct section.

---

## 0) Product North Star
Build OpenSkelo into a **generic DAG/block runtime** with:
- real agent execution
- inspectable I/O and artifacts
- robust background operation (UI optional)
- adapter-driven approvals/interventions (Telegram/UI/other channels)

Guiding rule: **Core contract first → Adapter second → Surface last**.

Product strategy: **OpenClaw-native first and recommended** (best end-to-end agent orchestration), with provider-agnostic adapters as a deliberate expansion path.

---

## 1) Current Status Summary

### ✅ Completed Foundations
- Generic block + DAG core runtime
- Config-driven gate-fail reroute (`on_gate_fail`)
- DAG API + SSE event stream
- Unified DAG interface (`/dag` canonical; `/dag/live` alias)
- Live preview + inspector
- Approval Bridge v1 (`paused_approval`, request/decide endpoints, tokenless run approval)
- Latest pending approval lookup endpoint
- Per-block worker visibility (agent/model/provider)

### 🔄 In Progress (Now)
- **Phase A — Core Durability**
  1. Persist runs + approvals + events to SQLite (authoritative)
  2. Add event sequence numbers + replay contract
  3. Reconstruct run state from durable store (not in-memory only)

---

## 2) Core Worksheet (Execution Plan)

## Phase A — Core Durability (P0)
1. Durable persistence for runs/events/approvals
2. Sequence IDs + replay endpoint
3. Store-driven run read model

## Phase B — Transport Hardening (P1)
4. Separate execution state vs connection state
5. Stale-run logic uses threshold/quorum (not single 404)
6. SSE resume cursor + fallback polling only on degradation

## Phase C — Approval Bridge Completion (P0.1 completion + generalization)
7. Plain `APPROVE` / `REJECT <reason>` maps to latest pending
8. Adapter contract (`notify`, `ingestDecision`) for Telegram/UI/Webhook
9. Approval TTL + expiration + retry/escalation

## Phase D — Restart Safety + Ops (P2)
10. Restart recovery for active/pending runs
11. Resume paused/running workflows cleanly
12. Admin ops endpoints: replay/recover/requeue

---

## 3) Backlog (Queued after A→D)
- Replay/Fork UX polish
- Failure queue dashboard and controls
- Usage accounting UI breakdown
- Diff/trace comparator
- Concurrency scheduler policy tuning
- Artifact contract hardening for playable/live outputs

### Context Integrated from Prior Strategy Threads
- Product positioning: **"GitHub Actions / CI-CD for AI agents"** with deterministic gates.
- Distribution thesis: local-first, zero-cost starter, one-command setup, YAML-first configuration, visual proof.
- Architecture thesis: split into **core runtime + adapters + dashboard**; keep OpenClaw as first-class adapter but not hard dependency.
- Differentiator thesis: deterministic stage transitions, quality gates, approval gates, retries/dead-letter, and built-in observability.
- Market thesis: focus on accessibility + reliability gap (most alternatives are either powerful-but-complex or easy-but-non-deterministic).

### Candidate Enhancements (phase-mapped)

#### Map to Phase A (Core Durability)
- Sequential dispatch queue + dead-letter retries (core queue durability foundations)
- Gate logs foundation (durable event/gate persistence)

#### Map to Phase B (Transport Hardening)
- Pipeline observability transport reliability (stream resume + fallback coherence)

#### Map to Phase C (Approval Bridge Completion)
- Context enforcement (WHY/INTENT/FIT) at task creation/dispatch for approval/ops clarity

#### Map to Phase D (Restart Safety + Ops)
- Operational recover/requeue controls for dead-letter and stuck runs

#### Post A→D (New Phase E: Generic Runtime Generalization)
- Agent registry (roles/capabilities/status)
- Task/pipeline type definitions (per-type stages, required fields)
- Generic gate engine backed by config/store (not hardcoded if-chains)
- Handoff contracts + output schema validation
- Generic routing by role/capability
- Max iteration cap to prevent runaway loops
- Merge verification/evidence gate for DONE transitions
- Cost accounting per stage/agent/run
- Gate logs + utilization metrics + advanced pipeline observability panels

#### Priority tags for Phase E candidates
- **P0:** Agent registry; task/pipeline type definitions; generic gate engine
- **P1:** Handoff contracts/output schema validation; generic routing; max iteration cap; merge verification gate
- **P2:** Cost accounting; advanced utilization metrics/observability
- **P3:** Additional ecosystem polish and non-critical UI enhancements

---

## 4) Working Agreements
- This file is a **living roadmap**. Do not fork competing lists.
- Every new branch conversation must map into one bucket:
  - Now (active)
  - Next (queued)
  - Later (backlog)
- If scope changes, update this file first, then execute.
- Status updates should be in format: **Now / Done / Next**.

---

## 5) Open Questions
- DB backend for durable store long-term (SQLite now, optional Postgres later)
- Event retention/compaction policy
- Approval auth model across channels
- Multi-tenant run isolation model

---

## 6) Execution Board (Living)

| Item | Phase | Priority | Status | Owner | Notes |
|---|---|---|---|---|---|
| Durable persistence (runs/events/approvals) | A | P0 | DONE | Nora | Authoritative store (SQLite) implemented |
| Event sequence IDs + replay endpoint | A | P0 | IN_PROGRESS | Nora | SSE replay supports Last-Event-ID with durable event seq |
| Store-driven run reconstruction | A | P0 | PENDING | Nora | Remove memory-only truth |
| Execution vs connection state separation | B | P1 | PENDING | Nora | Prevent transport glitches from mutating run truth |
| SSE resume cursor + fallback coherence | B | P1 | IN_PROGRESS | Nora | Hybrid-smart transport hardening |
| Stale-run quorum/backoff logic | B | P1 | PENDING | Nora | Avoid single-blip stale classification |
| Runtime truth verification (field provenance + consistency checks) | B | P1 | PENDING | Nora | Source-of-truth badges + verify endpoint + drift warnings |
| Plain APPROVE/REJECT conversational ingest | C | P0 | PARTIAL | Nora | Latest endpoint exists; full adapter ingest pending |
| Approval adapter contract (notify/ingest) | C | P1 | PENDING | Nora | Telegram/UI/Webhook normalized path |
| Approval TTL + retry/escalation | C | P1 | PENDING | Nora | Full lifecycle hardening |
| Restart recovery for active/pending runs | D | P1 | PENDING | Nora | Resume after process restart |
| Admin replay/recover/requeue endpoints | D | P2 | PENDING | Nora | Ops controls |
| Agent registry (roles/capabilities/status) | E | P0 | PENDING | Nora | First generalization pillar |
| Task/pipeline type definitions | E | P0 | PENDING | Nora | Per-type stages/fields |
| Generic gate engine (config/store-backed) | E | P0 | PENDING | Nora | Remove hardcoded path logic |
| Handoff/output schema validation | E | P1 | PENDING | Nora | Contract-safe stage boundaries |
| Generic routing by role/capability | E | P1 | PENDING | Nora | Multi-agent extensibility |
| Max iteration cap / runaway loop stop | E | P1 | PENDING | Nora | Safety + cost control |
| Merge/evidence verification gates | E | P1 | PENDING | Nora | Prevent phantom-done class issues |
| Cost accounting per stage/agent/run | E | P2 | PENDING | Nora | Usage economics |
| Advanced gate logs + utilization metrics | E | P2 | PENDING | Nora | Product observability |

## 7) Release Gate — Definition of Done (v0 Generic Deterministic Runtime)

A v0 release is only valid if **all** checks below pass.

### A) Installability (new-user path)
- Fresh machine setup works with documented commands (no hidden manual fixes)
- `init/start` flow succeeds and exposes API + dashboard
- At least one bundled example DAG runs end-to-end
- **OpenClaw-native first-run pickup:** OpenSkelo can discover existing OpenClaw agents on a fresh machine (e.g., user-created `henry`) and expose them for workflow routing without code edits

### B) Deterministic control flow
- Same DAG + same inputs + pinned runtime settings run repeatedly (N>=10)
- Block transition graph is identical across runs
- Gate pass/fail decisions are identical across runs
- Event sequence is replayable and internally consistent

### C) Genericity (config-first)
- At least 3 distinct pipeline types run via configuration only (no code edits)
  - coding
  - research
  - content (or equivalent non-coding flow)
- Core contracts unchanged across all three (same runtime engine)

### D) Runtime truth integrity
- Inspector/UI clearly distinguishes field provenance where applicable (`planned` vs `actual`)
- Displayed agent/model for each block matches provider-reported execution metadata
- For discovered OpenClaw agents (e.g., `henry`), UI labels and run metadata show the same agent/model that actually executed
- `/verify`-style consistency check passes for run/block/event/artifact coherence

### E) Durability + recovery
- Runs/events/approvals persist durably (not memory-only)
- Restart during active run recovers state correctly
- Pending approvals survive restart and can still be resolved

### F) Operability + safety
- Failure queue/dead-letter path exists for dispatch failures
- Stale-run handling uses threshold/backoff (not single transient errors)
- Audit trail captures decisions, gate failures, retries, and terminal outcomes

### G) Usability + docs
- One quickstart guide for 2-minute "aha" path
- One architecture guide describing core/adapters/surfaces split
- One troubleshooting guide covering common failure modes and recovery steps

---

## 8) Immediate Next Checkpoint
**Phase A Checkpoint 1 — DELIVERED ✅**
- [x] durable tables created (`dag_runs`, `dag_events`, `dag_approvals`)
- [x] write path active for run/events/approvals (durable persistence enabled)
- [x] smoke validation passing (run creation + DB writes + durable read fallback)

**Next:** Phase A Checkpoint 2
- add sequence IDs + replay endpoint semantics
- advance store-driven reconstruction toward full in-memory independence
