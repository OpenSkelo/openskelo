# 🦴 OpenSkelo

**Give your AI agents a backbone.**

Your AI agents have brains (LLMs) and muscles (OpenClaw, CrewAI, LangGraph). OpenSkelo gives them a skeleton — deterministic structure so they ship reliably, not just chat.

> CI/CD for AI agents. One config file. Runs on your laptop. Costs $0.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Why OpenSkelo?

Every AI agent framework lets agents *talk*. None of them make agents *ship*.

- **CrewAI** — agents collaborate, but no quality gates
- **LangGraph** — powerful graphs, but no pipeline discipline
- **AutoGen** — agents chat, but non-deterministic output

OpenSkelo is different. It's not another agent framework — it's the **skeleton** that gives any agent framework structure:

- 🔒 **Deterministic gates** — transitions are validated, not hoped for
- ⚙️ **Config-driven** — your entire pipeline in one YAML file
- 🏠 **Local-first** — runs on your laptop with Ollama, zero API costs
- 👁️ **Observable** — built-in dashboard, audit logs, gate logs
- 🔌 **Pluggable** — OpenClaw + Ollama + OpenAI-compatible adapters supported today

## Runtime Status (Important)

- ✅ **Canonical runtime:** `/api/dag/*` (DAG engine, approvals, replay, durability)
- ✅ **Legacy surface removed from CLI default path**; migration targets DAG runtime APIs/commands

### Provider Support Matrix (Current)

| Provider Type | Status | Notes |
|---|---|---|
| `openclaw` | ✅ Implemented | Native OpenClaw adapter |
| `ollama` | ✅ Implemented | Uses Ollama `/api/chat` |
| `openai` | ✅ Implemented via openai-compatible | Uses `/chat/completions` |
| `http` | ✅ Implemented via openai-compatible | Configurable base URL + auth header/env |
| `anthropic` | 🟨 Routed via openai-compatible path | Native Anthropic adapter planned |

## Quick Start

```bash
# Create a new pipeline project
npx openskelo init my-pipeline --template coding

# Enter the project
cd my-pipeline

# Start the pipeline
npx openskelo start
```

```
🦴 OpenSkelo starting...

  ✓ Config loaded: my-pipeline
  ✓ Database initialized (.skelo/skelo.db)
  ✓ 2 agents registered
  ✓ 1 pipeline, 4 gates

  🔥 OpenSkelo running

  Pipeline:  http://localhost:4040
  Dashboard: http://localhost:4040/dashboard
  API:       http://localhost:4040/api

  🔧 coder (worker, codellama:13b)
  🔍 reviewer (reviewer, llama3:8b)
```

## How It Works

### 1. Define your pipeline in `skelo.yaml`

> Note: names like `coder` and `reviewer` below are example labels only. You can name agents anything.

```yaml
name: my-pipeline

providers:
  - name: local
    type: ollama
    url: http://localhost:11434

agents:
  coder:
    role: worker
    capabilities: [coding]
    provider: local
    model: codellama:13b
    max_concurrent: 1

  reviewer:
    role: reviewer
    capabilities: [coding]
    provider: local
    model: llama3:8b
    max_concurrent: 1

pipelines:
  coding:
    stages:
      - name: PENDING
        transitions: [IN_PROGRESS]
      - name: IN_PROGRESS
        route: { role: worker, capability: coding }
        transitions: [REVIEW, BLOCKED]
      - name: REVIEW
        route: { role: reviewer, capability: coding }
        transitions: [DONE, IN_PROGRESS]
      - name: DONE

gates:
  - name: structured-feedback
    on: { from: REVIEW, to: IN_PROGRESS }
    check: { type: contains, field: notes, values: ["WHAT:", "WHERE:", "FIX:"] }
    error: "Bounce requires structured feedback"

  - name: done-evidence
    on: { to: DONE }
    check: { type: min_length, field: notes, min: 10 }
    error: "Provide evidence of completion"
```

### 2. Blocks are the core building unit

A **block** is a single step in your workflow DAG.

Each block has:
- typed **inputs** and **outputs**
- an **agent/provider** assignment
- optional **pre/post gates**
- optional **retry policy**
- optional **human approval**

Think of it like this:

`spec -> build -> qa -> release`

OpenSkelo runs blocks in dependency order, tracks each block's runtime metadata, and lets you inspect/replay runs safely.

Quick architecture view:

```text
[DAG YAML]
   ↓
[Block Engine] → validate types/wiring/gates
   ↓
[DAG Executor] → run/order/retry/approval/stop
   ↓
[Provider Adapter] → OpenClaw (or other provider)
   ↓
[Runtime + DB] → run state, events, approvals
   ↓
[API + SSE + Dashboard]
```

```mermaid
flowchart TD
  A[DAG YAML] --> B[Block Engine]
  B --> C[DAG Executor]
  C --> D[Provider Adapter]
  D --> E[Runtime State]
  E --> F[(SQLite)]
  E --> G[API + SSE]
  G --> H[Dashboard]
  F --> G
```

Approval flow (high level):

```mermaid
sequenceDiagram
  participant User
  participant Channel as Telegram/UI
  participant API as OpenSkelo API
  participant Exec as DAG Executor

  Exec->>API: approval:requested
  API->>Channel: notify
  User->>Channel: APPROVE / REJECT
  Channel->>API: approval decision
  API->>Exec: resume or fail path
```

### 4. Gates enforce quality — deterministically

Gates are rules that **cannot be broken**. The API rejects transitions that fail gates.

**Built-in gate checks:**

| Check | What it validates |
|---|---|
| `not_empty` | Field must have a value |
| `contains` | Field must include specific strings |
| `matches` | Field must match a regex pattern |
| `min_length` | Field must be at least N characters |
| `max_value` | Numeric field must be under a limit |
| `valid_json` | Field must be valid JSON |
| `valid_url` | Field must be a valid URL |
| `shell` | Custom shell command (exit 0 = pass) |

The `shell` check is the escape hatch — any validation you can write as a bash one-liner works as a gate.

## Templates

```bash
skelo init my-project --template coding    # Coder + Reviewer pipeline
skelo init my-project --template research  # Researcher with source validation
skelo init my-project --template content   # Writer + Editor with revision loop
skelo init my-project --template custom    # Blank starting point
```

## CLI Reference

> `skelo task *` commands are legacy-deprecated and will be removed in the next release.

```bash
skelo init [name]              # Create new project
skelo start                    # Start pipeline server + dashboard
skelo status                   # Pipeline health overview
skelo run start --example ...  # Start DAG run (canonical)
skelo run list                 # List DAG runs
skelo run status <runId>       # DAG run status
skelo run approve <runId>      # Approve pending gate
skelo run reject <runId> --feedback "..."   # Reject pending gate
skelo run stop <runId>         # Stop a run
skelo agents                   # List registered agents
skelo gates                    # List pipeline gates
skelo logs                     # Stream audit log
skelo validate                 # Validate skelo.yaml
```

## API

When running, OpenSkelo exposes a REST API.

- Canonical runtime: `/api/dag/*`
- Legacy `/api/tasks*` runtime: removed in hard-cut release

```
GET    /api/health          — Runtime health
GET    /api/config          — Current configuration
GET    /api/agents          — List configured agents
GET    /api/gates           — List configured gates

POST   /api/dag/run         — Start DAG run
GET    /api/dag/runs        — List runs
GET    /api/dag/runs/:id    — Run state
GET    /api/dag/runs/:id/replay?since=<seq> — Durable replay events
POST   /api/dag/runs/:id/approvals — Approve/reject pending approval
POST   /api/dag/runs/:id/stop — Stop run
POST   /api/dag/runs/stop-all — Emergency stop all runs
GET    /api/dag/safety      — Effective safety policy
```

## DAG API Reliability Contracts

OpenSkelo's canonical runtime is the DAG API (`/api/dag/*`).

### Replay and resume
- SSE event stream supports replay via `Last-Event-ID` / `since`
- Durable replay endpoint: `GET /api/dag/runs/:id/replay?since=<seq>`
- Events include durable sequence numbers (`seq`)

### Durability
- Run snapshots and events are persisted in SQLite (`dag_runs`, `dag_events`, `dag_approvals`)
- `GET /api/dag/runs/:id` supports durable fallback when run is not in memory

### Safety controls
- Hard stop single run: `POST /api/dag/runs/:id/stop`
- Emergency stop all: `POST /api/dag/runs/stop-all`
- Safety policy introspection: `GET /api/dag/safety`


## 60-Second Demo

- Quick walkthrough: `docs/DEMO-60S.md`
- Claim alignment: `docs/CLAIM-ALIGNMENT.md`
- ID strategy review: `docs/ID-STRATEGY-REVIEW.md`
- Mutable-state contract: `docs/MUTABILITY-CONTRACT.md`
- Error model baseline: `src/core/errors.ts`
- Mutation testing plan (optional lane): `docs/MUTATION-TESTING-PLAN.md`

## Testing & Reports

- Optional real-provider profile: set `OPENSKELO_RUN_PROVIDER_INTEGRATION=1` before `npm test` to enable provider integration tests (skipped by default in CI).
- Provider param passthrough tests: `tests/provider.params.test.ts`.

```bash
npm run test
npm run test:coverage
npm run test:report
```

`npm run test:report` generates architecture-review artifacts under `docs/reports/`:

- `vitest-results.json`
- `coverage/coverage-summary.json`
- `test-summary.json`
- `test-summary.md`


## The Skeleton Metaphor

```
🧠 LLMs         = Brain (intelligence)
💪 OpenClaw      = Muscles (execution)
🦴 OpenSkelo     = Skeleton (structure)
```

Without a skeleton, your agents are smart but shapeless — they produce output but with no reliability, no quality control, no reproducibility.

OpenSkelo is the bones that make everything else work together.

## License

MIT — do whatever you want with it.
