---
id: MN-IMP-006
title: Integrate the Zoom-First Vertical Slice
parent: MN-IMP-000
status: open
assignee: Kien
labels:
  - call-notes
  - integration
  - release
tracker: local-markdown
blocked_by:
  - MN-IMP-002
  - MN-IMP-003
  - MN-IMP-004
  - MN-IMP-005
---

# Integrate the Zoom-First Vertical Slice

## Outcome

The four independently implemented lanes become one deployable feature with shared package/export wiring, environment configuration, worker lifecycle, API/UI integration, deterministic end-to-end evidence, real Zoom evidence, and fail-closed pilot controls.

## Contracts consumed and provided

Consumes every lane's handback and the frozen conformance pack. Provides the only cross-lane merge, root dependency/environment/Compose wiring, migration integration, production feature enablement, and release evidence.

## Owned surface

Root/package exports, dependency injection, environment parsing, Docker Compose and deployment wiring, worker registration/health, cross-lane conflict resolution, release documentation, and pilot gate configuration. Peace hands back the shared fixture/E2E harness and integration write-up; Kien owns the final merge and release evidence. Lane internals change only when a failing shared contract demonstrates a necessary integration fix.

## Acceptance

- Self-hosted Docker starts web, PostgreSQL, and one private call worker behind the normal LaunchStack HTTPS origin; Vercel can use the same web contract with the worker hosted privately elsewhere.
- Database migration applies and verifies against a clean database; rollback/upgrade impact is explicit.
- The shared simulated vertical tracer passes through the real state machine, PostgreSQL, product API, production Calls UI, deterministic capture adapter, deterministic model, and recording knowledge sink.
- Duplicate and out-of-order capture events, worker restart, lease expiry, provider reconnect, user Pause/Resume, same-user leave/return, partial finalization, stale enrichment acceptance, private-note access, deletion, and knowledge removal are exercised at the production boundaries.
- One real Zoom meeting confirms normalized events and authoritative Pause/Resume/reconnect/continuation behavior; one configured model confirms structured output.
- Operational health identifies web, database, worker, OAuth/webhook validity, active/leased attempts, stuck work, and failed finalization without introducing a new queue or public worker endpoint.
- Every authenticated user in the deployment may access Call Notes after connecting an eligible Zoom identity. Production uses a deployment-wide new-start kill switch plus verified concurrency and usage boundaries; release one adds no company or user allowlist.
- No duplicate contract types, compatibility shims, stale prototype routes in production navigation, or teammate-owned temporary wiring remain.

## Relevant decisions

All Call Notes Wayfinder decisions, especially MN-WF-006 through MN-WF-013.

## Non-goals

Expanding scope to Google Meet/native capture, centralized OAuth or SaaS operation, adding Redis/Kafka/RabbitMQ, generalizing adapters/models prematurely, marketplace publication, or silently weakening pilot gates because the Zoom account evidence is incomplete.
