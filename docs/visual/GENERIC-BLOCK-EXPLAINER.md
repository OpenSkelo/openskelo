# Generic Block Explainer (Human-Friendly)

This page explains the two most confusing parts of the generic block engine in plain language:

1. **Input priority** (`override → edge → context → default`)
2. **Output handling** (`parsed + validated + metadata attached`)

---

## 1) Input Priority (Plain English)

When a block needs an input value (for example `approved`, `prompt`, or `dev_plan`), OpenSkelo checks **4 places in order** and uses the **first match**.

### Priority Order

1. **override** (highest)
2. **edge**
3. **context**
4. **default** (lowest)

### What each one means

#### 1) Override
Force a value for a specific block input.

Example:
- `__override_input_release_approved = true`

If this exists, it wins — even if upstream data says otherwise.

Use case: approval bridge, manual correction, emergency operator override.

---

#### 2) Edge
Use upstream block output connected by DAG wiring.

Example:
- `spec.dev_plan -> build.dev_plan`

This is the normal pipeline data flow.

---

#### 3) Context
Use run-level shared input.

Example:
- run started with `{ prompt: "doom clone" }`
- `spec` reads `prompt` from context.

This is where user/session input usually starts.

---

#### 4) Default
Use fallback value defined on the input port.

Example:
- `timeout_ms` default exists, no override/edge/context value provided.

Good for safe fallback behavior.

---

### Memory shortcut

**Override beats wire, wire beats context, context beats default.**

---

## 2) Outputs: "parsed + validated + metadata attached"

After a provider returns raw text, output processing happens in 3 layers:

### A) Parsed
Raw text is interpreted into the block's output ports.

Example:
- Raw JSON text is parsed into:
  - `game_spec`
  - `dev_plan`

If parsing fails, contract checks will usually fail.

---

### B) Validated
Parsed outputs are checked against the block's declared output contract:
- required keys present?
- types correct? (string/json/boolean/etc.)

If strict mode is on (`strict_output: true`):
- repair attempts may run (`contract_repair_attempts`)
- if still invalid → `OUTPUT_CONTRACT_FAILED`

---

### C) Metadata attached
Execution metadata is attached for trace/debug/observability.

Common metadata includes:
- actual agent/model/provider
- duration
- token usage
- structured repair telemetry
- contract trace (attempts, errors, final result)

This is what powers inspector/debug views and event diagnostics.

---

## Example Walkthrough

Block: `release`
Input port: `approved`

1. check override: `__override_input_release_approved`
2. else check edge from upstream block output (`qa.approved`)
3. else check context (`context.approved`)
4. else use default if defined

Then release pre-gate evaluates that resulting `approved` value.

---

## Why this design exists

- **Predictable behavior**: deterministic resolution order
- **Safe overrides**: operator/human decisions can be bridged intentionally
- **Strong contracts**: outputs are not blindly trusted
- **Debuggable runs**: metadata + event trail explain what happened

---

## Related docs

- `docs/generic-block-visualizer.html`
- `src/core/block.ts` (input wiring + gate checks)
- `src/core/dag-executor.ts` (execution flow + contract handling)
- `src/server/dag-api.ts` (approval bridge + persistence/events)
