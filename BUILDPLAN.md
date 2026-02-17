# OpenSkelo — Build Plan

**Created:** 2026-02-16
**Updated:** 2026-02-16 22:18 EST
**Goal:** 10 days to launchable MVP
**Approach:** Extract and genericize proven NERV pipeline code. Not a rewrite — a refactor.

---

## What OpenSkelo Is

**Lego blocks for AI workflows.** Each block is an independent unit with typed inputs, outputs, an agent, and quality gates. Snap blocks together to build any workflow — simple or complex. Branch, merge, parallelize, loop. All local, all free, all deterministic.

### The Metaphor
- 🧠 LLMs = Brain (intelligence)
- 💪 OpenClaw/CrewAI = Muscles (execution)
- 🦴 OpenSkelo = Skeleton (structure)

### Core Concepts

**Block** — A self-contained unit of work. Has inputs, outputs, an agent, instructions, and gates. Doesn't know what comes before or after it.

```
┌─────────────────────────┐
│         BLOCK            │
│                          │
│  gate_in → [Agent] → gate_out
│                          │
│  inputs:  what comes in  │
│  outputs: what goes out  │
│  config:  what to do     │
└─────────────────────────┘
```

**Tunnel** — A connected path of blocks. Multiple tunnels can run in parallel and merge.

**Flow** — The full graph of blocks and tunnels. Defined in skelo.yaml. Can be linear, branching, parallel, looping, or any combination.

### Block Rules
1. Blocks with **no inputs** → start immediately
2. Blocks with **inputs** → wait until ALL inputs are satisfied
3. **Multiple outputs** → fan out to multiple downstream blocks
4. **Multiple inputs** → merge point, waits for all
5. **Gates** → validate at entry (gate_in) and exit (gate_out)
6. **Any combination** of inputs/outputs: 1→1, 1→3, 3→1, 2→2, 10→1, etc.

### Flow Control Patterns
```
1. SEQUENCE        [A] → [B] → [C]

2. CONDITION       [A] → when X → [B]
                       → when Y → [C]

3. PARALLEL        [A] → parallel → [B]
                                  → [C]  → wait → [D]
                                  → [E]

4. LOOP            [A] → [B] → when FAIL → [A] (max 3x)
                             → when PASS → [C]

5. MERGE           [A] ──┐
                         ├──→ [C] (waits for both)
                   [B] ──┘

6. FAN OUT         [A] → outputs → [B] gets output-1
                                 → [C] gets output-2
                                 → [D] gets output-3
```

---

## Core Principles

1. **Local-only** — single process, SQLite, no servers, no cloud, no Docker
2. **Light and fast** — minimal deps, instant transitions, small install
3. **Terminal-first** — CLI + live terminal UI with box-drawing block visualization
4. **Config-driven** — entire workflow defined in one skelo.yaml
5. **Block-based** — composable units with typed I/O and gates
6. **Battle-tested** — porting proven NERV logic, not building from scratch

---

## Example: skelo.yaml (Block-Based)

```yaml
name: research-to-presentation

blocks:
  # ── TUNNEL 1 ──
  research-topic-a:
    agent: { role: worker, capability: research }
    config:
      topic: "Market analysis for AI developer tools"
    inputs: []
    outputs: [findings-a]
    gate_out:
      - { type: contains, field: findings-a, values: ["Sources:"] }

  write-report-a:
    agent: { role: worker, capability: writing }
    inputs: [findings-a]
    outputs: [report-a]
    gate_out:
      - { type: min_length, field: report-a, min: 500 }

  # ── TUNNEL 2 (runs parallel with tunnel 1) ──
  research-topic-b:
    agent: { role: worker, capability: research }
    config:
      topic: "Competitive landscape for local-first AI tools"
    inputs: []
    outputs: [findings-b]
    gate_out:
      - { type: contains, field: findings-b, values: ["Sources:"] }

  write-report-b:
    agent: { role: worker, capability: writing }
    inputs: [findings-b]
    outputs: [report-b]
    gate_out:
      - { type: min_length, field: report-b, min: 500 }

  # ── TUNNEL 3 (merged) ──
  create-ppt:
    agent: { role: worker, capability: presentations }
    inputs: [report-a, report-b]
    outputs: [draft-ppt]

  generate-scripts:
    agent: { role: worker, capability: writing }
    inputs: [draft-ppt]
    outputs: [scripts, annotated-ppt]

  revise-draft:
    agent: { role: reviewer, capability: presentations }
    inputs: [annotated-ppt, scripts]
    outputs: [final-ppt]
    gate_out:
      - { type: not_empty, field: final-ppt }

# Conditional branching example:
flow:
  conditions:
    - block: review
      when:
        - if: "{{output.verdict}} == 'PASS'"
          goto: deploy
        - if: "{{output.verdict}} == 'FAIL'"
          goto: revision
  loops:
    - block: revision
      returns_to: review
      max_iterations: 3
      on_max: escalate
```

---

## Terminal UI: skelo watch

Live-updating terminal with box-drawing blocks:

```
🦴 TASK-001: research-to-presentation

  ┌─────────────────────┐     ┌─────────────────────┐
  │ research-topic-a    │     │ research-topic-b    │
  │ 🔧 researcher       │     │ 🔧 researcher       │
  │ ⏳ running...       │     │ ✅ done (2m 14s)    │
  │ gate: —             │     │ gate: ✓ sources     │
  │ in: —  out: →       │     │ in: —  out: →       │
  └─────────┬───────────┘     └─────────┬───────────┘
            │                           │
            ▼                           ▼
  ┌─────────────────────┐     ┌─────────────────────┐
  │ write-report-a      │     │ write-report-b      │
  │ 🔧 writer           │     │ ○ waiting (1 input) │
  │ ○ waiting (1 input) │     │                     │
  │ in: findings-a      │     │ in: findings-b      │
  └─────────┬───────────┘     └─────────┬───────────┘
            │                           │
            └───────────┬───────────────┘
                        ▼
            ┌─────────────────────┐
            │ create-ppt          │
            │ 🔧 presentations    │
            │ ○ waiting (2 inputs)│
            │ in: report-a,       │
            │     report-b        │
            └─────────┬───────────┘
                      ▼
            ┌─────────────────────┐
            │ generate-scripts    │
            │ 🔧 writer           │
            │ ○ waiting           │
            │ out: scripts,       │
            │      annotated-ppt  │
            └──┬──────────┬───────┘
               │          │
               ▼          ▼
            ┌─────────────────────┐
            │ revise-draft        │
            │ 🔍 reviewer         │
            │ ○ waiting (2 inputs)│
            └─────────┬───────────┘
                      ▼
                   OUTPUT
```

**Block status indicators:**
- `○` waiting (inputs not yet satisfied)
- `⏳` running (agent executing)
- `✅` done (output gate passed)
- `✗` failed (gate rejected)
- `↩` retry 2/3 (in a loop)
- `⚠️` escalated (max iterations hit)

**Each box shows:**
- Name (top, bold)
- Agent (role icon + name)
- Status (live-updating)
- Gate results (inline ✓/✗)
- Ports (inputs waiting, outputs produced)

---

## What We're Porting from NERV

| NERV (proven, hardcoded) | → | OpenSkelo (generic, block-based) |
|---|---|---|
| `tasks/[id]/route.ts` PATCH handler | → | Block transition logic |
| if-chains for 4 gates | → | Gate engine per block (gate_in + gate_out) |
| `"mari"` hardcoded 12x | → | Agent matching by role + capability per block |
| `dispatch-webhook.ts` | → | Provider adapter interface (later) |
| `VALID_TRANSITIONS` object | → | DAG execution engine |
| Turso/Next.js API | → | SQLite + pure functions |
| Vercel dashboard | → | Terminal UI (skelo watch) |

## Known Edge Cases (Pre-Fixed from NERV Stress Test)

1. Bounce count stored as string instead of integer
2. Silent failures (no logging)
3. Concurrent dispatch to same agent = second dropped
4. Agent workspace dirty from previous task
5. Task marked DONE but work never happened (phantom completion)
6. Handoff missing context (no description/criteria passed forward)
7. Feedback is vague/useless (no structured format)
8. Wrong agent credited in logs (hardcoded attribution)
9. No kill switch for runaway loops

---

## Build Phases

### Phase 1: Block Engine (Days 1-3)

**Day 1 — Block + Gate Core**
- [ ] Define Block type (inputs, outputs, agent, gates, config)
- [ ] Block state machine (waiting → running → done/failed)
- [ ] Gate engine (gate_in evaluated before block runs, gate_out before output accepted)
- [ ] Port NERV gate logic (8 check types: not_empty, contains, matches, min_length, max_value, valid_json, valid_url, shell)
- [ ] Unit tests: block transitions, gate pass/fail
- **Source:** `mission-control/src/app/api/tasks/[id]/route.ts`

**Day 2 — DAG Execution Engine**
- [ ] Parse blocks from skelo.yaml into a directed acyclic graph
- [ ] Topological sort — determine execution order
- [ ] Parallel execution — blocks with no inputs start simultaneously
- [ ] Merge points — block waits until ALL inputs satisfied
- [ ] Fan out — block output routes to multiple downstream blocks
- [ ] Conditional branching — `when` clauses route to different blocks
- [ ] Loop detection — `max_iterations` kill switch
- [ ] Escalation — `on_max` handler
- **Source:** `mission-control/src/lib/dispatch-webhook.ts` (routing logic)

**Day 3 — CLI + Config**
- [ ] Config loader — parse skelo.yaml with block definitions
- [ ] Validate block graph (no orphans, no cycles without max_iterations, inputs/outputs match)
- [ ] `skelo init` with block-based templates
- [ ] `skelo start` loads config, builds DAG, initializes DB
- [ ] `skelo run` executes a workflow (creates task, runs blocks)
- [ ] `skelo status` shows block states
- [ ] `skelo validate` checks config + graph validity

### Phase 2: Terminal UI (Days 4-5)

**Day 4 — skelo watch**
- [ ] Box-drawing renderer — blocks as bordered boxes with status
- [ ] DAG layout engine — arrange blocks vertically/horizontally based on tunnels
- [ ] Live redraw — poll SQLite, update block status in-place
- [ ] Parallel tunnels rendered side-by-side
- [ ] Merge points shown with converging arrows
- [ ] Color coding — green done, yellow running, gray waiting, red failed

**Day 5 — Polish + Edge Cases**
- [ ] Conditional branches shown with labeled arrows (when X →)
- [ ] Loop iterations shown (↩ retry 2/3)
- [ ] Escalation alert (⚠️ max iterations)
- [ ] Gate results inside each box
- [ ] Responsive — handles different terminal widths
- [ ] `skelo logs` stream for text-based audit trail
- [ ] Error messages that actually help
- [ ] Graceful handling of bad config, missing blocks, broken graphs

### Phase 3: Real Workflow Test (Days 6-7)

- [ ] Build 3 real workflows and run them:
  - [ ] Simple: 3 blocks linear (research → write → done)
  - [ ] Medium: 5 blocks with review loop + bounce
  - [ ] Complex: parallel tunnels + merge + conditions (the PPT example)
- [ ] Verify gates catch all bad outputs
- [ ] Verify merge points wait correctly
- [ ] Verify parallel blocks run simultaneously
- [ ] Verify loops respect max_iterations
- [ ] Verify escalation triggers
- [ ] Fix every edge case found
- [ ] Record terminal sessions for demo

### Phase 4: Launch Prep (Days 8-10)

- [ ] README with real demo GIF/recording
- [ ] `npx openskelo init` works on fresh machine (Mac, Linux)
- [ ] Landing page on openskelo.com (simple, one-page)
- [ ] Launch posts drafted:
  - [ ] Hacker News
  - [ ] Reddit r/LocalLLaMA
  - [ ] Reddit r/selfhosted
  - [ ] Reddit r/artificial
  - [ ] Twitter/X thread with demo GIF
  - [ ] ProductHunt
- [ ] Discord community ready for early adopters
- [ ] Ship it 🦴

---

## Post-Launch (After Adoption Validates)

- Browser dashboard (visual block editor?)
- Provider adapters (Ollama, OpenAI, OpenClaw, HTTP)
- Block marketplace — community shares reusable blocks
- Dispatch queue with retry + dead letter
- Cost tracking per block per task
- Visual block editor (drag & drop in browser)
- Import/export workflows
- Block versioning
- Docker support
- Team features

---

## Key Files

- **Config:** `skelo.yaml` — the product
- **Block engine:** `src/core/block-engine.ts` — block state machine
- **DAG engine:** `src/core/dag-engine.ts` — execution graph
- **Gate engine:** `src/core/gate-engine.ts` — validation
- **Router:** `src/core/router.ts` — agent matching per block
- **Terminal UI:** `src/ui/watch.ts` — box-drawing live view
- **CLI:** `src/commands/` — init, start, run, watch, status
- **Types:** `src/types.ts` — full type system
- **NERV reference:** `~/.openclaw/workspace/projects/mission-control/src/app/api/tasks/[id]/route.ts`

---

## Success Criteria

MVP is done when:
1. `npx openskelo init` creates a working project with block-based config
2. `skelo run` executes a workflow — blocks run in order, parallel, merge
3. `skelo watch` shows live block visualization with boxes in terminal
4. Gates enforce at every block entry and exit
5. Conditional branching routes to correct blocks
6. Loops respect max_iterations and escalate
7. Merge points wait for all inputs
8. The whole thing runs in <2 seconds on cold start
9. Install size under 20MB
10. Works on Mac and Linux without system dependencies
