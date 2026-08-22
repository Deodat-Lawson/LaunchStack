---
id: MN-WF-006
title: Decide the LaunchStack Module and Runtime Boundaries
parent: MN-WF-000
status: closed
assignee: Kien
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-001
  - MN-WF-002
  - MN-WF-004
---

# Decide the LaunchStack Module and Runtime Boundaries

## Question

Which responsibilities belong in `apps/web`, a long-running workspace application such as `apps/call-worker`, `packages/features`, `packages/core`, PostgreSQL, object storage, Inngest, and the existing batch transcription sidecar—and what dependency and process boundaries keep Zoom lifecycle code, product policy, knowledge integration, and portable infrastructure from leaking into one another?

## Resolution

Release one adds one private, long-running TypeScript workspace application:
`apps/call-worker`. It runs beside the existing web and PostgreSQL containers on the
same self-hosted deployment; it is not a separately operated product or public API.

### Responsibility boundaries

- `apps/web` owns the Calls UI, Clerk-authenticated user commands, Zoom OAuth
  initiation/callbacks, and the public signed-webhook endpoint. Its handlers validate,
  persist, and acknowledge quickly; they never hold an RTMS media connection.
- `apps/call-worker` owns command leasing, Zoom signaling/media WebSockets, ready and
  keepalive protocol, Pause/Resume execution, reconnect handling, Transcript packet
  normalization, and durable lifecycle/segment writes. Browser or web-process exit does
  not stop a Capture Attempt.
- `packages/features` owns the Call Notes domain module: state transitions,
  authorization and ownership policy, command/event contracts, repositories,
  finalization, Call Note revision rules, and knowledge-inclusion orchestration. Both
  deployable applications reuse this module rather than reimplementing policy.
- `packages/core` gains no Call Notes product policy. Call Notes reuses its existing
  database, model-routing, structured-output, and knowledge primitives.
- PostgreSQL is the durable coordination boundary. Web transactions append idempotent
  commands and webhook events; workers claim them with leases, persist provider events,
  and enforce uniqueness/state constraints. Basic polling is sufficient initially;
  PostgreSQL `LISTEN/NOTIFY` may reduce wake-up latency without becoming the source of
  truth.
- Object storage is not required for Zoom-first capture because release one stores no
  raw audio or video. Transcript evidence lives in PostgreSQL.
- Inngest may run finite, retryable post-call work such as user-requested enrichment and
  note reindexing. It never owns an active RTMS connection or Capture Attempt.
- The existing transcription sidecar is not used for Zoom RTMS Transcript packets and
  receives no Call Notes-specific endpoint. Existing note embedding configuration may
  continue to use its normal infrastructure without Call Notes calling the sidecar
  directly.

### Operational shape

Only `apps/web` is public. `apps/call-worker` needs database access, Zoom credentials or
authorized token access, outbound HTTPS/WSS, health checks, logs, and a restart policy.
One worker replica is the release-one default. Database leases permit later horizontal
replicas without adding Redis, Kafka, RabbitMQ, or a private worker-control HTTP API.

The extra Node process is accepted to prevent web deploys, request-runtime recycling, or
browser closure from terminating active Calls. RTMS usage remains the dominant
incremental cost; the worker adds only a small container and one operational health
surface.
