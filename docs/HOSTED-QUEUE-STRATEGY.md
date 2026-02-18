# Hosted-Scale Queue Strategy (Future)

Last updated: 2026-02-17

## Purpose
Define how OpenSkelo can evolve from single-node execution into hosted-scale queued execution without breaking DAG semantics.

## Principles
- Keep DAG contract and event model unchanged.
- Queue is a transport/scheduling layer, not a logic layer.
- Preserve deterministic replay and audit trace behavior.

## Proposed Queue Model
- **Ingress queue**: receives `run:start` jobs from API/control plane.
- **Control queue**: stop/pause/resume signals.
- **Event egress**: worker events are streamed back to persistence/event bus.

## Routing Keys
- `tenant_id` (future multi-tenant partition)
- `priority` (P0/P1/P2 classes)
- `run_id` (idempotency key)

## Reliability Requirements
- At-least-once delivery with idempotent run start handling.
- Deduplicate by `run_id` + event sequence.
- Dead-letter queue for unrecoverable job envelopes.
- Backpressure controls for noisy tenants/workloads.

## Candidate Implementations (future)
- Redis Streams / BullMQ for early hosted phase.
- NATS JetStream or Kafka for larger event volume.

## Rollout
1. Keep local in-process/worker-thread mode as default.
2. Add queue-backed executor mode behind feature flag.
3. Run shadow traffic with parity assertions.
4. Promote queue mode after parity and durability SLOs are met.
