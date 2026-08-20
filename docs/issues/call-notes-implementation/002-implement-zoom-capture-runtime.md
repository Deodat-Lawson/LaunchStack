---
id: MN-IMP-002
title: Implement the Zoom Capture Runtime
parent: MN-IMP-000
status: open
assignee: Kien
labels:
  - call-notes
  - zoom
  - runtime
tracker: local-markdown
blocked_by:
  - MN-IMP-001
---

# Implement the Zoom Capture Runtime

## Outcome

A private long-running Node worker consumes commands and signed webhook events, owns RTMS transcript streams, and turns provider lifecycle signals into the normalized `CaptureEvent` contract while executing authoritative Start, Pause, Resume, reconnect, and same-user continuation behavior.

## Contracts consumed and provided

Consumes `StartCaptureInput`, `CaptureControlInput`, durable commands/webhook events, Zoom connection references, and the settled provider facts. Provides `CaptureSource`, normalized `CaptureEvent` delivery, worker health/readiness, and replay-safe provider identities. Unknown MN-WF-013 account limits remain fail-closed configuration, not guessed constants.

## Owned surface

`apps/call-worker/**`, provider-adapter tests, and the Zoom-specific integration module consumed by the web edge. Per MN-WF-006, `apps/web` hosts OAuth initiation/callbacks and the public signed-webhook endpoint; the worker publishes no endpoint. Root environment/Compose wiring and shared package changes remain Kien's integration work.

## Acceptance

- OAuth tokens are encrypted at rest and scoped to the LaunchStack user/company connection that owns them.
- Zoom webhook authenticity and tenant/user routing fail closed.
- The Node RTMS client exposes attributed transcript segments, timestamps/order, lifecycle events, and native Pause/Resume through the frozen capture-source contract.
- The worker runtime is Node 22 or newer, matching the supported official `@zoom/rtms` package contract.
- Provider duplicates and reconnect replay retain stable identities; the worker never creates product Calls directly.
- Same-user return starts a new attempt under the same occurrence; paused intent remains paused and running intent resumes automatically.
- Lease loss, worker restart, reconnect, provider stop, and terminal failure become explicit normalized evidence rather than silent loss.
- The shared capture-source conformance suite passes; one real target-account meeting produces the same normalized event classes as the deterministic fixture.
- The worker runs privately in self-hosted Docker and beside Vercel without a public worker port.

## Relevant decisions

MN-WF-001, MN-WF-006, MN-WF-007, MN-WF-009, MN-WF-010, MN-WF-012, and MN-WF-013.

## Non-goals

Product-domain state transitions, Calls API/UI, AI enrichment, knowledge indexing, Google Meet, native/browser capture, raw-media retention, custom ASR, a public queue, or a provider framework beyond the `CaptureSource` seam.
