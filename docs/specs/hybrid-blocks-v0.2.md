# Hybrid Blocks v0.2 Spec

Status: Proposed (implementation-ready)
Owner: OpenSkelo

## 1) Purpose

Support three explicit block execution modes:

- `ai` — model/provider-dispatched reasoning/generation
- `deterministic` — local code execution (no model call)
- `approval` — human checkpoint/pause-resume

Keep block output contracts JSON-only across all modes.

---

## 2) Design Principles

1. Backward compatible: omitted `mode` defaults to `ai`.
2. One contract model: outputs validated the same way regardless of mode.
3. Deterministic extensibility via handlers, not hardcoded operation enums.
4. Clear trust boundary:
   - Gate expressions remain sandboxed/safe-eval.
   - Deterministic handlers are trusted local project code.
5. First-class UX visibility: mode badges/colors in DAG UI.

---

## 3) Schema Additions

```yaml
blocks:
  - id: publish
    mode: deterministic                # ai | deterministic | approval (default ai)
    inputs:
      final_markdown: { type: string }
    outputs:
      file_path: { type: string }
      bytes_written: { type: number }
      save_summary: { type: string }
    deterministic:
      handler: builtin:write-file      # builtin:* or project-relative path
      config:
        content_from: final_markdown
        path_from: file_path           # optional
        default_path_template: "/Users/nora/Downloads/content-{timestamp}.md"
        timestamp_format: "YYYYMMDD-HHmmss"
        mkdir: true
        overwrite: false
```

### New block fields

- `mode?: "ai" | "deterministic" | "approval"`
- `deterministic?:`
  - `handler: string` (`builtin:*` or relative file path)
  - `config?: Record<string, unknown>`

Validation:
- if `mode=deterministic` => `deterministic.handler` required.
- if `mode=approval` => approval config required (or mapped from existing approval schema).

---

## 4) Deterministic Handler Interface

```ts
export interface DeterministicHandlerContext {
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  blockId: string;
  runId: string;
}

export type DeterministicHandler = (
  ctx: DeterministicHandlerContext
) => Promise<Record<string, unknown>> | Record<string, unknown>;
```

Rules:
- Return value must satisfy block output contract.
- Throw => block fails.
- Returned output mismatch => contract/gate failure.

---

## 5) Executor Semantics

## `mode=ai`
- Current dispatch path unchanged.

## `mode=deterministic`
- Resolve handler (`builtin:*` or project-relative module).
- Invoke with `{ inputs, config, blockId, runId }`.
- Validate returned outputs against port contract.
- Run post-gates.

## `mode=approval`
- Pause run awaiting human decision.
- Resume with decision payload.
- Maintain current approval lifecycle/events.

---

## 6) Built-in Handlers (v1)

1. `builtin:write-file`
2. `builtin:read-file`
3. `builtin:http-request`
4. `builtin:transform`

### `builtin:write-file` config

Required:
- `content_from: string`

Optional:
- `path_from: string`
- `default_path_template: string`
- `timestamp_format: string` (default `YYYYMMDD-HHmmss`)
- `mkdir: boolean` (default `true`)
- `overwrite: boolean` (default `false`)

Expected outputs (example):
- `file_path: string`
- `bytes_written: number`
- `save_summary: string`

Failure codes:
- `DET_CONFIG_INVALID`
- `DET_CONTENT_MISSING`
- `DET_PATH_INVALID`
- `DET_OVERWRITE_BLOCKED`
- `DET_WRITE_FAILED`

---

## 7) UI / DAG Dashboard

Add mode badges + colors:

- AI: purple/blue badge `AI`
- Deterministic: green badge `DET`
- Approval: amber badge `HUMAN`
- (future) Sub-DAG: teal badge `DAG`

Add filters:
- all | ai | deterministic | approval

---

## 8) Explain/Cost Metadata

Optional per block:

```yaml
estimate:
  tokens: 2000
  cost_usd: 0.02
  duration_sec: 15
```

For deterministic blocks:
- `tokens: 0`
- `cost_usd: 0`

`skelo explain` should summarize totals by mode.

---

## 9) Backward Compatibility

- Existing DAGs with no `mode` continue as `ai`.
- Existing `approval` field can be mapped/aliased during transition.
- Feature is additive.

---

## 10) Implementation Plan (1-day PR scope)

1. Parser/schema: add `mode` + deterministic fields + validation.
2. Executor: add mode branch + deterministic handler execution path.
3. Handler loader: support `builtin:*` and project-relative modules.
4. Built-ins: implement 4 v1 handlers.
5. UI: mode badges/colors/filters.
6. Explain: mode and estimate rollups.
7. Tests: success/failure coverage for deterministic path + built-ins.

---

## 11) Content Pipeline Mapping

- `outline` => `ai`
- `draft` => `ai`
- `images` => `ai`
- `edit` => `ai`
- `publish` => `deterministic` (`builtin:write-file`)
