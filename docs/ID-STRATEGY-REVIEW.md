# OpenSkelo Dependency & ID Strategy Review

Last updated: 2026-02-17

## Dependency posture
- Keep runtime dependency surface minimal in core executor/state paths.
- Favor existing standard-library + already-adopted packages before introducing new libs.
- Any new dependency must justify one of:
  1) security improvement,
  2) correctness improvement,
  3) substantial maintenance reduction.

## Run/Block/Event ID strategy (current)
- IDs are string-based and provider-agnostic across API, store, and replay paths.
- No hard dependency on UUIDv7 at runtime today.
- IDs remain opaque identifiers; ordering is derived from timestamps/event row order, not lexical ID sort.

## UUIDv7 / sortable ID position
- UUIDv7 remains optional future enhancement.
- Adoption trigger: if cross-node ordering/traceability requirements exceed timestamp+event ordering guarantees.
- Migration path (future): dual-read compatibility period, then write-default UUIDv7 for new runs/events.

## Decision
- **Keep current ID model for now** (stable, compatible, low risk).
- Revisit UUIDv7 when hosted-scale queue/distributed execution work starts.
