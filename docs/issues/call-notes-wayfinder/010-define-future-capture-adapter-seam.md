---
id: MN-WF-010
title: Define the Future Capture Adapter Seam
parent: MN-WF-000
status: closed
assignee: Kien
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-002
  - MN-WF-004
  - MN-WF-006
  - MN-WF-009
---

# Define the Future Capture Adapter Seam

## Question

What is the minimum platform-neutral boundary that lets a later Google Meet Media API or native capture source feed the settled Call model without weakening Zoom attribution or introducing a speculative provider framework—covering identities, finalized segments, timestamps, capabilities, lifecycle events, and explicitly unsupported raw-media or transcript-revision behavior?

## Resolution

The provider-neutral boundary begins at normalized textual evidence and lifecycle
events, not raw media. Zoom is the only implemented adapter. No plugin loader, provider
registry, factory hierarchy, or dormant Google/native implementation is added.

### Minimum contract

The Call Notes domain issues three provider-neutral commands:

- start an Attempt for an authorized provider occurrence and Capture User;
- pause the active Attempt when the source declares native Pause support;
- resume a paused Attempt.

There is deliberately no LaunchStack Stop command in release one. Provider termination,
meeting end, or an irrecoverable lifecycle timeout ends an Attempt.

The adapter emits a small append-only event union:

- Attempt connected, paused, resumed, interrupted, reconnected, ended, or failed;
- provider participant observed, left, or returned;
- Transcript segment observed;
- provider meeting occurrence ended.

A normalized Transcript observation carries:

- provider name, occurrence key, Attempt key, and optional provider event key;
- a lossless call-local provider participant key and display name when attribution is
  available, otherwise an explicitly unattributed speaker value;
- provider start/end or message timestamp when supplied, receive timestamp, and receive
  order;
- text, detected language when supplied, and source kind
  (`provider_transcript` or future `derived_asr`);
- canonical source-packet hash for evidence deduplication.

The domain, not the adapter, assigns LaunchStack IDs, enforces company scope, creates
Gaps, orders evidence, decides `partial`, and finalizes the Transcript. The contract has
no transcript-update or delete event and no invented finality flag. A future provider
that revises prior transcript text requires a new domain decision rather than mutating
evidence through this seam.

### Capabilities

An adapter reports only facts that change existing product behavior:

- attributed text delivery;
- native Pause/Resume;
- supported transport reconnect;
- observation of Capture User return.

Release-one Zoom activation fails closed if attributed transcript delivery or required
lifecycle control is unavailable. A future adapter with weaker attribution does not
erase or make optional the provider identity stored for Zoom segments.

Raw audio, video, screen share, codec negotiation, ASR, and diarization are outside this
boundary. If a future Google Meet or native source needs ASR, its source-specific runtime
must convert media to normalized Transcript observations before entering Call Notes.
That work is not scaffolded now.

Zoom SDK, OAuth, webhook, and transport types remain inside the Zoom edge/runtime
adapter. Persistence and product policy contain only the normalized contract. This is
the one seam required to avoid a future data migration without paying for a speculative
multi-provider framework.
