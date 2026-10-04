---
id: MN-WF-012
title: Decide Architecture Verification and Rollout Gates
parent: MN-WF-000
status: open
assignee: Kien
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-005
  - MN-WF-007
  - MN-WF-008
  - MN-WF-009
  - MN-WF-010
  - MN-WF-011
  - MN-WF-013
---

# Decide Architecture Verification and Rollout Gates

## Question

What observable scenarios, cost limits, security checks, failure drills, migration checks, and operator acceptance criteria must the eventual implementation satisfy before an internal pilot and before a supported OSS release—and which constraints are architectural gates rather than implementation-task details beyond this map's destination?

## Decided rollout shape

Implementation begins as a local-testing slice. Call Notes is available to every
authenticated user in that local LaunchStack deployment; there is no company or user
allowlist. Each user must still connect an eligible Zoom identity before starting.

Production rollout keeps the same all-users product shape, but a deployment-wide kill
switch can prevent new starts. The switch never pretends to terminate an already active
provider stream. New starts and automatic continuation attempts are also rejected when
the deployment's verified concurrency or configured usage boundary is exhausted.

`MN-WF-013` must supply the actual account entitlements and Pause/Resume billing
behavior before numeric limits are configured. This issue remains open until that
evidence exists.

## Local-testing gate

Before calling the first implementation slice locally complete, one real disclosed Zoom
meeting through a public HTTPS tunnel must demonstrate:

1. OAuth connection, signed webhook receipt, and one manual Start.
2. Attributed Transcript segments persisted and streamed to the Calls UI in stable
   order.
3. Call Note autosave during capture; Bookmark creation and exact in-Call search.
4. Native Pause and Resume with a visible typed Gap and `partial` outcome.
5. Same Capture User leave and return, automatic new Capture Attempt, and one logical
   Capture with a visible absence Gap.
6. Web process restart without ending the worker-owned Attempt.
7. Worker interruption with either verified Zoom reconnect or an honest
   `worker_unavailable` Gap—never fabricated continuity.
8. Provider end, bounded finalization, immutable Transcript, and retained failed/partial
   state.
9. Owner-requested enrichment with chronological substantive-topic coverage, labelled
   unsupported owner context, Bookmark-only visible citations, editable proposal,
   Reject, and Accept as a new canonical revision.
10. Explicit company-knowledge inclusion and removal for a company-visible note, with
    private notes and unaccepted proposals absent from retrieval.

## Internal-pilot gates

The local slice may become an internal pilot only when:

- `MN-WF-013` proves the target account's General App, required scopes/events and
  settings, user assignment, Developer Pack credits, transcription rate, concurrent
  stream entitlement, Pause/Resume billing, reconnect behavior, and leave/return
  behavior.
- configured maximum concurrency is no higher than the observed entitlement;
- the operator sets a new-start minute/credit budget from the observed rate, usage is
  visible, and local accounting is reconciled against Zoom for Pause and restarted
  Attempts;
- reaching a budget prevents new Attempts rather than silently overbooking or claiming
  that an active provider stream was stopped;
- webhook signatures and replay windows, OAuth `state`, least-privilege scopes, encrypted
  tokens, secret redaction, worker fencing, and wrong-company not-found behavior have
  been exercised;
- duplicate webhook/command delivery, duplicate and out-of-order Transcript packets,
  token revocation, host denial, database interruption, web restart, worker restart, and
  provider termination all produce the settled durable state;
- completed-Call admin deletion removes Transcript, notes, embeddings, proposals,
  consent/lifecycle evidence, and deep-link access in one audited company-scoped
  operation;
- operator health output distinguishes web, database, worker heartbeat, Zoom
  authorization, and active/failed Attempts.

All authenticated users may access the feature after these deployment-wide gates; no
release-one allowlist is introduced.

## Supported OSS-release gates

A supported OSS release additionally requires:

- a clean Docker Compose install and ordered migration from the previous supported
  schema;
- restart and upgrade with an active or partial Capture producing documented,
  non-corrupt state;
- backup/restore verification for PostgreSQL Call Notes data;
- documented public-origin, local-tunnel, Zoom app, secret rotation, disconnect,
  deletion, health, and troubleshooting procedures;
- two-company isolation coverage across UI/API reads, commands, worker claims,
  Transcript search, note retrieval, and deletion;
- multiple authorized users converging on one company Capture without duplicate RTMS
  billing or Call Note ownership;
- bounded logs and metrics that contain IDs/statuses but no OAuth tokens, note bodies, or
  Transcript text by default;
- no dependency on raw-media storage, the batch transcription sidecar, a hidden support
  entitlement, or a development-only Inngest service.

Exact test frameworks, dashboard layout, alert vendor, retry constants, and deployment
automation are implementation choices. The observable scenarios, tenancy and evidence
invariants, provider/account proof, budget boundary, recoverability, and operator
acceptance checks above are architecture gates.

## Closure condition

Close this ticket only after `MN-WF-013` supplies the account-specific concurrency,
rate, Pause/Resume, reconnect, and continuation facts needed to replace the remaining
unknown limits with tested configuration.
