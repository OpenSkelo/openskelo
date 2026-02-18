# Mutation Testing Plan (Optional)

Last updated: 2026-02-17

This is an optional hardening layer for OpenSkelo. It is not required for normal CI.

## Scope (first pass)
- `src/core/block.ts` gate evaluation + safety guards
- `src/core/dag-executor.ts` failure/timeout/budget branches
- `src/server/dag-api.ts` error envelope + auth/rate-limit branches

## Suggested Tooling
- StrykerJS (TypeScript + Vitest runner) in a separate profile.
- Run on-demand or nightly, not on every PR.

## Operational Mode
- Keep regular CI fast (`npm test`).
- Mutation testing runs in an opt-in lane and may be flaky/slow by design.

## Success Criteria (baseline)
- Mutation profile exists as a documented process.
- Initial target threshold: >= 60% survived-kill ratio on scoped files.
- Raise threshold incrementally after dead-code cleanup.

## Future Additions
- Add `mutation.config` once dependency/cost budget is approved.
- Publish reports under `docs/reports/mutation/`.
