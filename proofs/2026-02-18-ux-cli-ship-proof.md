# OpenSkelo UX CLI Ship Proof — 2026-02-18

## Scope shipped
Commit: `12e4c47`  
Branch: `feature/block-core-mvp`

Features included:
- `skelo run <dag-file> --input key=value --watch`
- `skelo validate <dag-file>`
- `skelo explain <dag-file>`
- `skelo new <name> --pattern ... --blocks ...`
- DAG file resolution from direct path, `pipelines/`, and `examples/`

## Proof artifacts

### Inline command evidence (captured during ship)

```bash
$ node dist/cli.js validate examples/game-builder-pipeline.yaml
✓ YAML/DAG schema valid
✓ 5 blocks parsed
✓ 11 edges validated
Required context inputs:
  - prompt (string) — Game request
```

```bash
$ node dist/cli.js new proof-pipeline --pattern linear --blocks "plan,build,test"
✓ Created /private/tmp/openskelo-proof/pipelines/proof-pipeline.yaml
Run: skelo run /private/tmp/openskelo-proof/pipelines/proof-pipeline.yaml --input prompt="Build X" --watch
```

```bash
$ node dist/cli.js run examples/game-builder-pipeline.yaml
✗ Missing required input(s):
  - prompt (string) — Game request
Usage: skelo run examples/game-builder-pipeline.yaml --input prompt=...
```

```bash
$ git log --oneline -n 5
12e4c47 feat(TASK-UX): add run <dag> --input --watch plus validate/explain/new commands
26b2a43 feat(cli): enrich watch output with progress bar, cycle/chain, active block runtime
a220ec3 feat(ui): add long-running block warning banner with timeout countdown
dacb787 fix(cli): make watch follow iterated child runs by default
f7cbaa2 fix(ui): keep controls active across reject-iterate handoff and follow child run ids
```

### 1) Build passes
- Log: `proofs/2026-02-18-build.log`
- Command: `npm run build -s`

### 2) Validate command works on real DAG
- Log: `proofs/2026-02-18-validate.log`
- Command: `node dist/cli.js validate examples/game-builder-pipeline.yaml`
- Evidence (from log):
  - `✓ YAML/DAG schema valid`
  - `✓ 5 blocks parsed`
  - `✓ 11 edges validated`
  - required input surfaced: `prompt`

### 3) Explain command renders execution plan
- Log: `proofs/2026-02-18-explain.log`
- Command: `node dist/cli.js explain examples/game-builder-pipeline.yaml`
- Evidence includes execution layers, wiring, gates, approvals, bounce routes, required context inputs.

### 4) New scaffold command creates pipeline file
- Log: `proofs/2026-02-18-new.log`
- File listing proof: `proofs/2026-02-18-new-files.log`
- Command:
  - `node dist/cli.js new proof-pipeline --pattern linear --blocks "plan,build,test"`
- Evidence:
  - Created `/tmp/openskelo-proof/pipelines/proof-pipeline.yaml`

### 5) Run command enforces required named inputs
- Log: `proofs/2026-02-18-run-missing-input.log`
- Command: `node dist/cli.js run examples/game-builder-pipeline.yaml --api http://localhost:4040`
- Evidence:
  - `✗ Missing required input(s):`
  - `prompt (string) — Game request`
  - clear usage hint for `--input prompt=...`

### 6) Git history proof
- Log: `proofs/2026-02-18-git-head.log`
- Includes shipped UX commit plus recent related UX/watch/dashboard commits.

## Notes
- Full integration test suite remains environment-sensitive due to known `better-sqlite3` Node ABI mismatch when Node version changes.
- This does not block CLI UX feature proof above; build and command-level proofs are captured.
