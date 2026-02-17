# OpenSkelo Genericity Review (Required)

Use this checklist before merging any feature.

## Gate 0 (must pass first)
**Is this generic?**
- Does it work for any domain (not just coding/game/dev)?
- Does it avoid team-specific names/identities in core contracts?
- Does it avoid provider-specific assumptions in core runtime?

If any answer is "no", redesign before merge.

## Core Principles
1. **Core contract first** — define runtime behavior in generic types/contracts.
2. **Adapter second** — provider/channel specifics belong in adapters, not core.
3. **Surface last** — UI/docs reflect core, not vice versa.
4. **No personal hardcoding** — no Nora/Rei/Mari/etc in core runtime or docs examples labeled as "the model".
5. **Domain-neutral examples** — use neutral examples unless a file is explicitly a demo.
6. **Truthful metadata** — runtime must report actual execution values.
7. **Deterministic behavior** — retries, stops, replay, and approvals must be predictable.

## PR Review Questions
- What part is core vs adapter vs surface?
- What assumptions are domain-specific? Are they isolated?
- Could a non-OpenClaw adapter implement this unchanged?
- Does stop/replay/recovery still work under this change?
- Are docs/examples clearly marked as generic vs demo-specific?

## Required PR Footer
Every PR must include:
- **Genericity:** PASS/FAIL
- **Core leakage:** NONE / LIST
- **Adapter assumptions:** LIST
- **Determinism impact:** NONE / EXPLAIN
- **Safety impact:** NONE / EXPLAIN
