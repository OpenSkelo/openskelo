# OpenSkelo Execution Checklist (v1 → v2 Graduation)

Last updated: 2026-02-18
Owner: Nora + Andy
Branch: `feature/block-core-mvp`

Purpose: single execution reference for shipping in order, one lane at a time.

---

## Phase 0 — Scope Lock

- [ ] Confirm shipping order is frozen in roadmap:
  1. CORS on `/api/dag/*`
  2. `skelo init` template graduation (v1 → v2 DAG format)
  3. `llm_review` gate (true second-model evaluation)
  4. planner thin-slice (`autopilot`)
  5. viral demo artifact
- [ ] Confirm language standard in docs/updates: **"v1 → v2 graduation"** (avoid "broken/regression" framing)

Exit criteria:
- Roadmap reflects sequence exactly
- Team updates use consistent framing

---

## Phase 1A — CORS on DAG API (P0)

### Build
- [x] Add CORS middleware coverage for DAG routes (`/api/dag/*`)
- [x] Ensure preflight handling for `OPTIONS`
- [x] Verify allowed methods/headers match expected browser usage

### Tests
- [x] Add integration test for cross-origin preflight on DAG route
- [x] Add integration test for standard DAG call from cross-origin client

### Docs
- [ ] Note CORS behavior in API docs

Exit criteria:
- Browser-origin calls to `/api/dag/*` pass CORS
- New tests green in CI

---

## Phase 1B — `skelo init` Template Graduation to DAG (P0)

### Build
- [x] Replace legacy pipeline/stage template emitters with DAG block templates
- [x] Ensure templates `coding|research|content|custom` emit DAG-compatible YAML
- [x] Remove legacy schema keys from generated templates (`pipelines`, `stages`, etc.)

### Tests
- [x] Add/upgrade init-template tests
- [x] Parse generated templates via DAG parser (`parseDAG`) in tests
- [x] Add guard test that generated templates contain no legacy schema keys

### Docs
- [ ] Update README examples to match generated output exactly
- [ ] Update docs where template outputs are shown

Exit criteria:
- Fresh `openskelo init` project runs DAG flow first try
- Generated template format is canonical DAG only
- Tests enforce this permanently

---

## Phase 2 — `llm_review` Gate (P0 Differentiator)

### Build
- [x] Add new gate type: `llm_review`
- [x] Keep `semantic_review` as keyword-coverage baseline (backward-compatible)
- [x] Support gate config fields:
  - [x] review provider/model selection
  - [x] criteria list
  - [x] pass threshold
  - [x] structured decision + rationale
- [x] Fail closed on malformed judge outputs
- [x] Persist review metadata into durable events

### Tests
- [x] pass case
- [x] fail case
- [ ] provider error case
- [ ] timeout case
- [x] malformed output fail-closed case
- [x] deterministic parsing contract case

### Docs
- [x] Explicitly distinguish `semantic_review` vs `llm_review`
- [ ] Add minimal `llm_review` YAML example

Exit criteria:
- Second model can evaluate first model output deterministically
- Gate rationale visible in run/replay artifacts
- Docs/tests complete

---

## Phase 3 — Planner Thin-Slice (`autopilot`) (P1)

### Build
- [ ] Add `openskelo autopilot "<goal>"` command
- [ ] Generate DAG YAML from natural language prompt
- [ ] Validate with parser; retry on validation errors
- [ ] Execute validated DAG

### Tests
- [ ] 3 canned prompts succeed end-to-end
- [ ] validation failure/retry path test

### Docs
- [ ] Add quickstart for autopilot command

Exit criteria:
- NL goal → valid DAG → execution works deterministically

---

## Phase 4 — Viral Demo Artifact (P1)

### Build
- [ ] Terminal renderer optimized for shareability
- [ ] Display: block states, gate outcomes, retry loops, correction passes
- [ ] Include budget/tokens metadata in readable format

### Artifact
- [ ] Record 60–90s demo showing:
  - [ ] initial failure
  - [ ] gate catches issue
  - [ ] auto-correction
  - [ ] final pass
- [ ] Produce launch post draft (HN/X/GitHub)

Exit criteria:
- One-command reproducible demo
- Polished shareable artifact published internally

---

## Reporting Protocol (every phase)

- [ ] Commit SHA(s)
- [ ] Test proof (`npm test`, targeted suites)
- [ ] Before/after diff summary
- [ ] Documentation updates included in same phase PR/commit when possible

---

## Future Strategy Note (not now)

Revenue strategy is reference-only until PMF/usage signals are hit.
Do not change current shipping priorities based on monetization ideas.
