# OpenSkelo Mutable-State Contract

Last updated: 2026-02-17

This document clarifies where state is mutable vs immutable in the current runtime.

## Immutable by Contract
- `DAGDef` (parsed definition) is treated as immutable during a run.
- Block input/output port schemas are immutable once parsed.
- Event records in `dag_events` are append-only.

## Mutable by Design
- `DAGRun` runtime object is mutable in-memory during execution:
  - `run.status`, `run.updated_at`
  - `run.blocks[blockId].status`, `inputs`, `outputs`, `execution`, retry metadata
  - `run.context` operational keys (approval flags, failure diagnostics, overrides)

## Persistence Semantics
- Runtime mutability is checkpointed into durable state (`dag_runs.run_json`) and event stream (`dag_events`).
- Durable reads may reconstruct from event stream to recover latest known state.

## Operator Guidance
- Treat `run.context` keys prefixed with `__` as internal control/diagnostic fields.
- Prefer adding new diagnostics under explicit namespaced keys (e.g., `__stuck_diagnostics`).
- Do not mutate parsed DAG definitions at execution time; evolve behavior through run context, retries, and events.

## Future Direction
- Introduce typed runtime context namespaces to reduce accidental key collisions.
- Add optional immutable snapshot mode for debugging/replay assertions.
