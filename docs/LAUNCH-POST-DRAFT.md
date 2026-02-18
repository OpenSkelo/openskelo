# OpenSkelo Launch Post Draft

## One-line hook
Your AI agents are smart, but unreliable. OpenSkelo adds quality gates to AI agent output so work only advances when standards pass.

## Short post (X/Telegram/GitHub)
We just shipped a major OpenSkelo milestone:

- ✅ DAG-first init templates (v1 → v2 graduation)
- ✅ CORS on `/api/dag/*` for browser integrations
- ✅ `llm_review` gate (second-model semantic judge)
- ✅ `autopilot` thin-slice (`npx openskelo autopilot "<goal>"`)
- ✅ terminal watch mode for shareable run visibility (`skelo run watch <runId>`)

OpenSkelo = **quality gates for AI agent output**.

Try it:
```bash
npx openskelo start
npx openskelo autopilot "Add rate limiting to the API"
npx openskelo run watch <RUN_ID>
```

Runs local-first, provider-agnostic, deterministic.

## HN-style post draft
Title: OpenSkelo: quality gates for AI agent output (DAG runtime, local-first)

Body:
Most agent frameworks make it easy to generate output, but hard to guarantee quality.

OpenSkelo is a DAG runtime that adds deterministic gate checks between agent steps:
- typed block inputs/outputs
- gate enforcement before/after execution
- semantic judge gate (`llm_review`) where a second model evaluates output quality
- durable replay + run visibility

Recent milestone shipped:
- CORS + browser integration unblock
- DAG-first template graduation
- LLM review gate
- natural-language planner thin-slice (`autopilot`)
- terminal watch mode for shareable runs

Core idea: your agent work should not advance unless quality checks pass.

Feedback welcome: where would you want this in your workflow (coding, research, content, ops)?

## Demo narration script (60–90s)
1. "I’ll give OpenSkelo a goal in plain language."
2. Run `npx openskelo autopilot "Add rate limiting to the API"`
3. "It generates a DAG, executes blocks, and runs quality gates between steps."
4. Run `npx openskelo run watch <RUN_ID>`
5. "This is live block status, retries, and gate outcomes in one view."
6. "The key is: output only propagates when gates pass."
7. "That’s OpenSkelo: quality gates for AI agent output."
