---
"@launchstack/protocol": minor
"@launchstack/evidence": minor
"@launchstack/application": minor
"@launchstack/adapters": minor
"@launchstack/core": minor
---

Introduce the layered engine packages (ADR-002) and the transactional
ingestion outbox (ADR-003):

- `@launchstack/protocol` — versioned zod contracts: pipeline event
  envelopes (`source.version.created` → `evidence.version.extracted` →
  `evidence.version.indexed` → `company.state.projection.requested` →
  `company.state.projected`), the converter's typed `EvidenceDocument`, and
  the compute-service request/response schemas, with generated JSON Schemas
  for cross-language contract tests.
- `@launchstack/evidence` — pure company-state domain logic: citation
  anchors, version supersession, content diffing, conflict detection,
  reconciliation and freshness.
- `@launchstack/application` — use cases and ports: command acceptance,
  outbox processing with bounded retries, and citation building.
- `@launchstack/adapters` — Postgres outbox store, the outbox-transactional
  source lifecycle (moved from apps/web), archive expansion, the two-stage
  doc-ingestion pipeline, and typed HTTP clients for the compute services.
- `@launchstack/core` — gains the `pdr_ai_v2_event_outbox` engine table and
  migration. Document processing is no longer dispatched post-commit via a
  job runner; the lifecycle enqueues the event inside its own transaction.
