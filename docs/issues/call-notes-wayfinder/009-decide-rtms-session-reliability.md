---
id: MN-WF-009
title: Decide the RTMS Session Reliability Model
parent: MN-WF-000
status: closed
assignee: Kien
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-001
  - MN-WF-002
  - MN-WF-006
  - MN-WF-007
---

# Decide the RTMS Session Reliability Model

## Question

What state machine and persistence guarantees govern a single-user RTMS capture from authorization through start, buffering, transcript ingestion, duplicate or out-of-order packets, worker restart, transport reconnect, the Capture User leaving and returning, stop, finalization, and partial failure—and which guarantees are required for the internal pilot versus deferred until measured concurrency demands them? Same-user continuation through a new Capture Attempt is in scope; cross-user handoff is not.

## Resolution

Release one provides durable, gap-honest capture rather than claiming exactly-once or
gap-free Transcript delivery. PostgreSQL state is authoritative; worker memory and live
UI events are disposable projections.

### State model

`Capture` records two independent facts to avoid a combinatorial status enum:

- desired mode: `running` or `paused`;
- lifecycle: `connecting`, `live`, `interrupted`, `finalizing`, `completed`, or
  `failed`.

Each `Capture Attempt` is one provider stream interval with lifecycle `connecting`,
`live`, `reconnecting`, `ended`, or `failed`. A Capture outcome is `complete`,
`partial`, or `failed`; any known interval without Transcript evidence, including a
user Pause, makes it `partial`.

The normal transitions are:

```text
start -> connecting -> live
live -> paused -> live
live -> reconnecting -> live
live -> interrupted -> new Attempt -> live
live/interrupted/paused -> finalizing -> completed
connecting/reconnecting/finalizing -> failed
```

The UI derives `Paused`, `Reconnecting`, `Waiting for participant`, and `Partial` from
these durable facts rather than persisting a second product-only state machine.

### Continuation and gaps

- Native Zoom Pause preserves the current Attempt when Zoom does. Desired mode becomes
  `paused`; nothing automatically unpauses it. The interval is a visible
  `user_paused` Gap.
- A brief media/signaling interruption uses Zoom's supported reconnect path within the
  same Attempt. The worker records the observed interruption even when reconnect
  succeeds.
- When the Capture User leaves, the provider stream and Attempt end. If that same
  provider user returns to the same still-open Zoom meeting occurrence while desired
  mode is `running`, LaunchStack automatically starts a new Attempt under the existing
  Capture. The interval remains a visible `capture_user_absent` Gap.
- A user-paused Capture does not restart on return until the user explicitly resumes.
- Automatic continuation never crosses to another user, another Zoom meeting
  occurrence, or a finalized Call. Cross-user handoff remains out of scope.

### Persistence guarantees

- Start, Pause, Resume, webhook, reconnect, and finalization inputs have durable
  idempotency keys. Database uniqueness allows only one open Capture per
  company/provider occurrence and one active Attempt per Capture.
- Worker leases carry fencing tokens. A worker whose lease expired cannot append state
  after a successor claims the Attempt.
- Transcript packets are persisted before they are published to the live UI. Each row
  records Attempt, provider participant identity, provider timestamps, receive order,
  normalized text/language, and a hash of the canonical provider packet.
- Zoom documents no universal Transcript packet idempotency key or total-order
  guarantee. Identical canonical packets within one Attempt are deduplicated by hash;
  otherwise evidence is retained. Canonical display order uses provider time followed by
  receive order as the deterministic tie-breaker.
- Finalized Transcript segments are immutable. Corrections, guessed words, or AI repairs
  never replace provider evidence.
- Every unavailable interval is represented as a typed Gap:
  `user_paused`, `capture_user_absent`, `transport_interruption`,
  `worker_unavailable`, or `provider_unknown`. No code fabricates missing Transcript.
- A worker restart may reclaim an eligible lease and attempt provider-supported
  reconnect. If Zoom cannot replay or reconnect, the Attempt ends and the Capture
  remains partial; restart is not represented as seamless.
- Finalization begins only after a terminal provider event or a bounded, persisted
  irrecoverable timeout, waits a configurable late-packet grace period, then freezes
  ordering and outcome. Timeout and reconnect values must come from the verified account
  behavior in `MN-WF-013`, not guessed production constants.
- Empty and partial failed Calls remain visible with their failure reason and Retry or
  owner-only Delete behavior. There is no automatic cleanup.

### Pilot limits

One worker replica and one Capture User per Capture are sufficient for the internal
pilot. The worker rejects new starts before exceeding the concurrency entitlement
verified by `MN-WF-013`; it does not optimistically overbook RTMS streams. Horizontal
workers may later share the same lease protocol. Transcript replay recovery,
cross-user handoff, overlapping Attempts, and continuity billing are deferred until
provider evidence and measured demand justify them.
