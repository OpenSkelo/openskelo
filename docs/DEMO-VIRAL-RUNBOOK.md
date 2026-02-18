# OpenSkelo Viral Demo Runbook (Terminal-first)

Goal: produce a shareable 60–90 second terminal demo where an agent run shows gate-enforced quality and visible progression.

## One-command demo flow

With runtime already running (`npx openskelo start`):

```bash
npm run demo:viral
```

Optional custom goal:

```bash
npm run demo:viral -- "Add input validation to registration"
```

Manual equivalent:

```bash
npx openskelo autopilot "Add rate limiting to the API"
npx openskelo run watch <RUN_ID>
```

## What to capture on screen

1. Autopilot command in terminal
2. Run ID returned
3. `run watch` output with live block states
4. At least one gate review stage shown in output
5. Terminal end state (`completed`)

## Suggested framing line

"OpenSkelo adds quality gates to AI agent output. It plans, executes, reviews, and only advances when standards pass."

## Output artifacts

- 60–90s terminal screen recording
- 1 screenshot of mid-run watch state
- 1 screenshot of final completed status
