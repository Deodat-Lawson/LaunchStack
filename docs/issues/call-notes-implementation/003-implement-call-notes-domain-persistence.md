---
id: MN-IMP-003
title: Implement Call Notes Domain and Persistence
parent: MN-IMP-000
status: open
assignee: Peace
labels:
  - call-notes
  - domain
  - backend
tracker: local-markdown
blocked_by:
  - MN-IMP-001
---

# Implement Call Notes Domain and Persistence

## Outcome

The frozen Call Notes commands and normalized capture events drive one durable, company-scoped Call/Capture state machine backed by PostgreSQL, with authorization, idempotency, partial outcomes, and query behavior suitable for the production UI and worker.

## Contracts consumed and provided

Consumes `CallNotesCommand`, `CaptureEvent`, the canonical Drizzle tables, deterministic clock/ID sources, and knowledge/enrichment ports. Provides the real `CallNotesApplication` implementation and stable product API handlers for commands, Call lists/details, Transcript search, and live state updates.

## Owned surface

Call/Capture domain services, repositories, authorization rules, state transitions, finalization, durable work claiming, application-service implementation, and Call Notes product API handlers. Canonical contracts/schema/migration, Zoom runtime, production UI, enrichment internals, and root wiring are exclusive to other lanes.

Peace also owns transcript finalization, shared fixture alignment, and the deterministic integration harness. Root environment/Compose wiring and the final cross-lane merge remain Kien's responsibility.

## Acceptance

- One provider occurrence maps idempotently to one Call and one logical Capture; every connected or continued stream is a separate Capture Attempt.
- Segment insertion is immutable and replay-safe by provider identity or packet hash, with timestamp-first and receive-order fallback ordering.
- Pause, Resume, transport interruption, capture-user absence/return, worker unavailability, occurrence end, and failure maintain explicit gaps and honest complete/partial/failed outcomes.
- Request/work idempotency and PostgreSQL leases survive retries, worker restart, reconnect replay, and concurrent claims without adding another queue.
- Eligible detected occurrences and per-user Dismiss suppression remain separate from Calls until Start; dismissing one occurrence does not suppress future occurrences.
- Company membership scopes every access. Company users can read the Transcript; only the owner edits/enriches the canonical Call Note; private notes are redacted from other users; company-admin Call deletion and owner deletion of empty failed Calls follow MN-WF-008.
- The first successful Capture start owns the one canonical `document_notes` row and revision history; accepted enrichment never overwrites owner changes implicitly.
- Transcript search filters immutable segments without indexing Transcript evidence into company RAG.
- Focused state-machine/repository tests and the shared application conformance tracer pass against PostgreSQL and deterministic external fakes.

## Relevant decisions

MN-WF-002 through MN-WF-012 and MN-WF-014.

## Non-goals

Zoom SDK/OAuth behavior, page/component implementation, model prompts, embeddings/retrieval implementation, root exports/Compose, a second note store, transcript editing, or cross-user Capture handoff.
