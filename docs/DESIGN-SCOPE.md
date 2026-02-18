# OpenSkelo Design Scope Statements

Last updated: 2026-02-17

This document codifies product-scope decisions from the audit closure process.

## 1) Static vs Dynamic DAGs
Current scope is **static DAG-first**: DAG shape is defined before run start.

- Supported now: deterministic retries, approval loops, iteration child runs.
- Not yet supported: runtime graph mutation (`addBlock`/`addEdge` during execution).
- Planned path: evaluate controlled dynamic expansion after core durability goals are complete.

## 2) Single-Shot vs Multi-Turn Blocks
Current scope is **single-shot block dispatch** with deterministic repair/retry overlays.

- A block dispatches one request and receives one response (plus optional contract-repair retries).
- Full conversational multi-turn within one block is not a current GA guarantee.

## 3) Product Posture: Framework vs Library vs Platform
Primary posture is **runtime platform with importable core modules**.

- Canonical operational interface: `/api/dag/*` + `skelo run ...`
- Core modules remain reusable internally and by advanced integrators.
- Platform behavior and reliability contracts are prioritized over broad framework abstraction at this stage.

## 4) OpenClaw-Coupled vs Provider-Agnostic
Strategy is **OpenClaw-native first, provider-agnostic by adapter**.

- OpenClaw path is first-class and recommended.
- Ollama + OpenAI-compatible adapters are implemented for broader interoperability.
- Native provider-specific advanced features (e.g., deep vendor-specific APIs) are phased additions.
