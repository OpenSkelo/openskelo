# OpenSkelo Documentation

## Overview

OpenSkelo is a **deterministic pipeline runtime for AI agents**. Think of it like CI/CD for AI agents — instead of just prompting an LLM and hoping for the best, you define a pipeline with gates that must pass before work can move forward.

**Core concept:** A pipeline is made of **blocks** connected as a DAG. Each block has typed inputs/outputs, optional gates, and runs on an assigned agent/provider.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenSkelo Engine                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │  Config  │   │ Task Engine  │   │   Gate Engine    │   │
│  │(skelo.yaml)│   │ (state machine)│   │ (validators)    │   │
│  └──────────┘   └──────────────┘   └──────────────────┘   │
│         │              │                     │               │
│         └──────────────┼─────────────────────┘               │
│                        │                                     │
│                   ┌────┴────┐                                │
│                   │   DB    │ (SQLite)                       │
│                   │ tasks   │                                │
│                   │ audit   │                                │
│                   │ gates   │                                │
│                   └─────────┘                                │
├─────────────────────────────────────────────────────────────┤
│                    Router                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Pipeline Stage → Agent Match (role + capability)      │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                 Provider Adapters                            │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌────────────┐     │
│  │ Ollama  │ │ OpenAI  │ │OpenClaw  │ │   HTTP     │     │
│  └─────────┘ └─────────┘ └──────────┘ └────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## Blocks (Plain English)

A **block** is one unit of work in a workflow.

Each block defines:
- **Inputs** (what it needs)
- **Outputs** (what it must produce)
- **Agent routing** (who should run it)
- **Gates** (rules to pass before/after execution)
- **Retry policy** (what happens on failure)
- **Optional approval** (human approval before continuing)

Blocks are connected by **edges** in a DAG:
- Upstream block outputs become downstream block inputs
- OpenSkelo executes blocks in dependency order
- Independent blocks can run in parallel

Why this matters:
- Easier debugging (you can inspect each block)
- Better reliability (gates/retries/approval per block)
- Safer operations (stop/replay/audit at run + block level)

Example (conceptual):

`spec -> build -> qa -> release`

### Visual: What a single block contains

```text
┌──────────────────────────────────────────────┐
│ Block: build                                │
├──────────────────────────────────────────────┤
│ Inputs   : game_spec, dev_plan              │
│ Agent    : route by role/capability         │
│ Pre-gates: required inputs present          │
│ Execute  : provider dispatch (OpenClaw)     │
│ Post-gates: artifact_html must exist        │
│ Retry    : max_attempts=2, backoff=linear   │
│ Output   : artifact_html, changelog, branch │
└──────────────────────────────────────────────┘
```

### Visual: How blocks tie into OpenSkelo architecture

```text
DAG YAML
  ↓ parse
Block Engine (types/wiring/gates)
  ↓ ready-to-run blocks
DAG Executor (scheduling + retries + approvals)
  ↓ dispatch
Provider Adapter (OpenClaw/Ollama/OpenAI/...)
  ↓ result
Runtime State (run + block metadata)
  ↓ persist
SQLite (dag_runs, dag_events, dag_approvals)
  ↓ surface
API + SSE + /dag Dashboard
```

```mermaid
flowchart TD
  A[DAG YAML] --> B[Block Engine\nparse + validate + wire]
  B --> C[DAG Executor\nready queue + retries + approvals + stop]
  C --> D[Provider Adapter\nOpenClaw / Ollama / OpenAI / HTTP]
  D --> E[Runtime State\nrun + block metadata]
  E --> F[(SQLite\ndag_runs / dag_events / dag_approvals)]
  E --> G[API + SSE]
  G --> H[/dag Dashboard]
  F --> G
```

### Visual: Approval flow (Telegram/UI ↔ Runtime)

```mermaid
sequenceDiagram
  participant U as User (Andy)
  participant T as Telegram/UI
  participant A as OpenSkelo API
  participant E as DAG Executor
  participant P as Provider Adapter

  E->>P: Execute next block
  P-->>E: Block reaches approval-required step
  E->>A: Emit approval:requested
  A->>T: Send approval prompt
  T->>U: "APPROVE or REJECT"

  U->>T: APPROVE (or REJECT <reason>)
  T->>A: POST /api/dag/runs/:id/approvals
  A->>E: Apply decision

  alt Approved
    E->>E: Resume run
    E->>P: Continue next block dispatch
  else Rejected
    E->>E: Mark run failed/cancelled path
  end

  A-->>T: approval:decided + updated run status
```

### Visual: Runtime lifecycle for one block

```text
pending → ready → running → completed
                     │
                     ├─ pre/post gate fail → retrying → pending
                     ├─ approval required → paused_approval
                     ├─ stop/timeout/stall → skipped/cancelled
                     └─ unrecoverable error → failed
```

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> ready
  ready --> running
  running --> completed

  running --> retrying: gate fail / dispatch fail
  retrying --> pending: retry delay elapsed

  ready --> paused_approval: approval required
  paused_approval --> ready: approved
  paused_approval --> failed: rejected

  running --> cancelled: stop / timeout / stall
  pending --> cancelled: stop / timeout / stall
  ready --> cancelled: stop / timeout / stall
  cancelled --> [*]

  running --> failed: unrecoverable error
  failed --> [*]
  completed --> [*]
```

---

## Core Components

### 1. Config (`skelo.yaml`)

Defines the entire system:
- **providers**: LLM backends (Ollama, OpenAI, OpenClaw, Anthropic, HTTP)
- **agents**: Workers with role, capabilities, model
- **pipelines**: DAG of stages with transitions
- **gates**: Validators that must pass for transitions

### 2. Task Engine

Manages task lifecycle:
```
PENDING → IN_PROGRESS → REVIEW → DONE
              ↑            ↓
              └── BLOCKED ←┘
```

Each task has:
- `id`: Auto-generated (TASK-001, TASK-002...)
- `pipeline`: Which pipeline
- `status`: Current stage
- `assigned`: Which agent
- `notes`: Documentation
- `bounce_count`: How many times returned from REVIEW
- `metadata`: Custom fields

### 3. Gate Engine

Deterministic validators. Each gate:
- **on**: Which transition triggers it (`from: PENDING, to: IN_PROGRESS`)
- **check**: What to validate
- **error**: Message when fails
- **bypass**: Roles that can skip it

**Check types:**
| Type | Purpose |
|------|---------|
| `not_empty` | Field must have value |
| `contains` | Field must contain strings |
| `matches` | Field matches regex |
| `min_length` | String min length |
| `max_value` | Number max value |
| `valid_json` | Field is valid JSON |
| `valid_url` | Field is valid URL |
| `shell` | Run command, check exit code |

### 4. Router

Finds the right agent for a stage:
1. Look at stage's `route` rule
2. Match by `role` + `capability`
3. Pick agent with lowest load
4. Exclude busy agents (at `max_concurrent`)

> Note: agent IDs in examples (e.g., `coder`, `reviewer`) are template labels, not platform requirements.

---

## Pipeline Stages

A pipeline is a DAG of stages:

```yaml
pipelines:
  coding:
    stages:
      - name: PENDING              # Initial state
        transitions: [IN_PROGRESS] # Can only go to IN_PROGRESS
      
      - name: IN_PROGRESS         # Work happening
        route: { role: worker, capability: coding }  # Auto-dispatch to coder
        transitions: [REVIEW, BLOCKED]
      
      - name: REVIEW              # Quality check
        route: { role: reviewer, capability: coding } # Auto-dispatch to reviewer
        transitions: [DONE, IN_PROGRESS]  # Approve or bounce
      
      - name: DONE               # Complete
      - name: BLOCKED             # Stuck, needs human
        transitions: [PENDING]    # Can restart
```

---

## How Work Flows

```
User Input
    ↓
Create Task (POST /api/tasks)
    ↓
PENDING
    ↓
Transition: PENDING → IN_PROGRESS
    ↓
Gate: needs-assignee (must have "assigned" field)
    ↓
Router finds available "worker" agent
    ↓
Agent executes work (via Provider adapter)
    ↓
Transition: IN_PROGRESS → REVIEW
    ↓
Router finds available "reviewer" agent
    ↓
Agent reviews (approve or bounce)
    ↓
If bounce: REVIEW → IN_PROGRESS (bounce_count++)
    ↓
If approve: REVIEW → DONE
    ↓
Gate: done-evidence (notes must be ≥10 chars)
    ↓
Done
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health |
| GET | `/api/config` | Current config |
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/:id` | Get task |
| PATCH | `/api/tasks/:id` | Update task (transition) |
| GET | `/api/tasks/counts` | Task counts by status |
| GET | `/api/agents` | List agents |
| GET | `/api/gates` | List gates |
| GET | `/api/logs` | Audit log |
| GET | `/api/gate-log` | Gate execution log |

## Block Core MVP

OpenSkelo now includes a deterministic **run/block engine** for observer-mode dashboards.

### Block loop contract

`PLAN -> EXECUTE -> REVIEW -> DONE -> PLAN`

- Every `POST /api/runs/:id/step` advances exactly one transition.
- `REVIEW -> DONE` is gate-protected and requires `reviewApproved: true` (in step body or run context).
- Gate failures return `400` with gate details.
- Invalid transition state returns `400`.

#### Idempotency contract for step retries

Step retries support idempotency keys through either:

- request header: `Idempotency-Key` (or `X-Idempotency-Key`)
- request body field: `idempotencyKey`

Semantics:

- same key + same payload => deduplicated replay (`200`, `deduplicated: true`)
- same key + different payload => deterministic conflict (`409`, `code: IDEMPOTENCY_KEY_REUSED`)
- mismatched header/body keys => `400`

#### Transactional concurrency control

Run mutation for `/step` is atomic in one SQLite transaction:

1. conditional `runs` update (optimistic `run_version` compare-and-swap)
2. `run_steps` insert
3. `run_events` append
4. optional idempotency response record insert

Concurrent stale writers fail deterministically with `409` and `code: RUN_STEP_CONFLICT`.

### Run model

Each run stores:
- `original_prompt`
- `current_block`, `iteration`
- shared `context`
- `blocks` output history (backward-compatible aggregate)
- latest `artifact_path` + `artifact_preview`

Each executed transition is also persisted as a first-class `run_step` record with:
- `step_index` (strictly increasing per run)
- `transition` (`FROM->TO`)
- `block`, `agent`, `output`
- `context_snapshot`, `timestamp`
- artifact metadata for that step

Artifacts are now persisted to local disk under `.skelo/artifacts/...` (derived from `artifact_path`), making UI preview/read APIs observer-only against real local files.

The `DONE` block output always includes:
- `"what else can we improve on this?"`
- the original prompt

### New endpoints

- `POST /api/runs` — create run
- `GET /api/runs/:id` — current run state + ordered events + ordered steps
- `GET /api/runs/:id/steps` — ordered step records (contract-stable step history)
- `POST /api/runs/:id/step` — deterministic single-step transition
- `GET /api/runs/:id/context` — get shared context
- `POST /api/runs/:id/context` — patch shared context
- `GET /api/runs/:id/artifact` — latest artifact path + preview payload + local persistence metadata
- `GET /api/runs/:id/artifact/content` — raw artifact HTML from local disk

---

## Current Demo State

The demo at `localhost:4040` has:
- **2 example agents**: `coder` (worker), `reviewer` (reviewer)
- **1 example pipeline**: "coding"
- **4 gates**:
  1. `needs-assignee` — PENDING→IN_PROGRESS requires "assigned" field
  2. `structured-feedback` — REVIEW→IN_PROGRESS requires "WHAT:", "WHERE:", "FIX:" in notes
  3. `done-evidence` — Any→DONE requires notes ≥10 chars
  4. `max-bounces` — max 3 bounces per task

---

## Missing: Agent Execution

The engine currently:
- ✅ Manages task state
- ✅ Validates transitions with gates
- ✅ Routes to agents
- ❌ Does NOT actually execute agents

**What's needed:**
- Provider adapter that spawns real agents (OpenClaw, Ollama, etc.)
- `/api/dispatch` endpoint that:
  1. Takes task + context + acceptance criteria
  2. Spawns agent via provider
  3. Captures output
  4. Returns result for REVIEW

**Dashboard should show:**
- What was planned (context, acceptance criteria)
- What is being executed (real-time output from assigned agent)
- What was reviewed (gate results, feedback)
- Live preview (artifact from agent output)

---

## Test Strategy

OpenSkelo uses a deterministic Vitest suite focused on run-core behavior and contract safety.

### Scope

- Run creation and payload validation
- Deterministic block transitions
- Gate fail/pass behavior (`REVIEW -> DONE` approval contract)
- Shared context read/write persistence
- Artifact metadata + persisted content endpoints
- `run_steps` ordering and integrity guarantees
- Integration flow loop: `PLAN -> EXECUTE -> REVIEW -> DONE -> PLAN`
- Reliability edge cases (repeated step calls, missing IDs, malformed payloads)

### Commands

```bash
npm run test            # deterministic test run
npm run test:coverage   # run + coverage output
npm run test:report     # coverage + machine/human summary artifacts
```

### Reporting outputs

Generated under `docs/reports/`:

- `vitest-results.json` — raw machine output from Vitest
- `coverage/coverage-summary.json` — machine-readable coverage totals
- `test-summary.json` — normalized machine summary (counts + risk/gap matrix)
- `test-summary.md` — human-readable report for architecture review

## CLI Commands

```bash
npx skelo init           # Create new project
npx skelo start          # Start server
npx skelo task create    # Create task
npx skelo task list      # List tasks
npx skelo status         # Show health
npx skelo validate       # Validate config
```
