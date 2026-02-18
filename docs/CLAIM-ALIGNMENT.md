# Claim Alignment (Audit Closure)

Last updated: 2026-02-17

This document aligns public claims to implemented reality.

## Runtime Surface
- Canonical runtime: `/api/dag/*` ✅
- Legacy task runtime: removed from active CLI/API/core paths ✅

## Provider Support (Implemented)
- OpenClaw adapter ✅
- Ollama adapter ✅
- OpenAI-compatible adapter ✅ (supports configurable base URL, auth header, API key env)

## Provider Support (Planned)
- Native Anthropic adapter (currently routed via openai-compatible path)
- Streaming-first provider interface
- Full model parameter passthrough per block

## Reliability/Safety (Implemented)
- Output contract enforcement + repair loop
- Approval bridge with signal-based resume (no polling loop)
- Request size limits + rate limits + optional API key auth
- Per-block timeout enforcement (`DISPATCH_TIMEOUT`)
- Token budget caps (`BUDGET_EXCEEDED`)
- Durable replay + reconstruction on fallback reads

## Remaining High-Impact Gaps
- Full store-first/event-sourced completion
- Monolith decomposition (`dag-api.ts`, dashboard split)
- Real provider integration CI profile

## Evidence Pointers
- See `AUDIT-CLOSURE-CHECKLIST.md` for item-by-item status + proof SHAs.
