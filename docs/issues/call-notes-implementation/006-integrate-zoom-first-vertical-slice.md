---
id: MN-IMP-006
title: Integrate the Local-Audio Vertical Slice
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

# Integrate the Local-Audio Vertical Slice

## Outcome

The independently implemented lanes become one deployable feature with shared package/export wiring, local worker lifecycle, strict local event validation and actor/call scoping, protected internal API ingress, bounded dual-stream audio/transcription cancellation, host configuration and permission diagnostics, API/UI integration, deterministic end-to-end evidence, and release evidence that states the limits of local audio capture.

## Contracts consumed and provided

Consumes every lane's handback and the frozen `call-notes/v2` contract. Provides the only cross-lane merge, root dependency/environment/Compose wiring, migration integration, protected local-worker route, production feature enablement, and release evidence.

## Owned surface

Root/package exports, dependency injection, environment parsing, Docker Compose and deployment wiring, native-helper configuration, migration integration, protected `POST /api/internal/call-notes/local` ingress and `CALL_NOTES_INTERNAL_TOKEN` configuration, strict local event-set and scope enforcement, cancellable worker lifecycle, cross-lane conflict resolution, and release documentation. Peace hands back the shared fixture/E2E harness and integration write-up; Kien owns the final merge and release evidence. Lane internals change only when a failing shared contract demonstrates a necessary integration fix.

## Acceptance

- Self-hosted Docker starts web, PostgreSQL, and one private microphone-only Local Capture Worker behind the normal LaunchStack HTTPS origin. Full dual-channel capture runs the worker on a macOS 14+ host; Vercel can use the same protected web contract with that worker hosted privately.
- The worker targets Node 24 or newer, uses native `fetch` and `FormData`, and introduces no new HTTP dependency.
- Database migration applies and verifies against a clean database; rollback/upgrade impact is explicit.
- The shared domain tracer and HTTP E2E pass through the real state machine, PostgreSQL, product/private APIs, worker polling, deterministic microphone/system-output fixtures, and deterministic transcription/enrichment output. Production Calls controls receive separate browser verification; authenticated full-shell navigation and real-device capture are separate acceptance checks.
- Duplicate and out-of-order events, idle startup, exclusive worker claims, required-stream loss, sustained silence without automatic completion, explicit Stop, partial finalization, stale enrichment acceptance, private-note access, deletion, and knowledge removal are exercised at production boundaries. Installed-agent restart/recovery remains deferred deployment work.
- Only authenticated Start creates a Capture. The worker stays idle until a poll claims it. Normal evidence order is `attempt_connected`, channel-tagged derived-ASR transcripts, then—only after explicit Stop and successful draining—`attempt_ended` with `reason: "user_stopped"`, `occurrence_ended`, and `finish`. Unexpected EOF, cancellation, and source failure never become successful finalization.
- The event envelope remains exactly `{ kind: "event", companyId, userId, callId, event }`. Scope and session identifiers come from configured identity and the claimed poll response, not a private `start` request. Ingress validates capture control, occurrence identity, and the persisted claimed attempt before ingestion; queued transcript writes remain valid while finalizing.
- Local worker ingress accepts only `attempt_connected`, `transcript_segment`, `attempt_ended`, `attempt_failed`, and `occurrence_ended`. A local `transcript_segment` must use `sourceKind: "derived_asr"`, valid `audioChannel: "microphone" | "system"`, and literal `participant: null`; participant-lifecycle and transport events are rejected.
- A configured cloud Transcription Model confirms request/response and structured output compatibility only. It is not evidence of complete remote-party or system-audio coverage, complete conversation capture, diarization, or speaker attribution; the deterministic dual-channel fixture remains the correctness oracle.
- Operational health identifies web, database, worker, transcription failures, active attempts, stuck work, and failed finalization without a public worker endpoint or a new queue.
- Start requires the enabled deployment's configured company/user to match the authenticated actor. The actor is persisted as `captureUserId`; no external conferencing identity is required. General multi-user device enrollment is deferred.
- macOS host onboarding documents `pnpm run build:system-audio`, `pnpm run system-audio:request-permission`, and the non-prompting `pnpm run system-audio:status`; it requires Microphone and Screen & System Audio Recording permission and a worker/web-app restart after grants.
- Privacy behavior is explicit at the product boundary: transcript evidence is derived from microphone/system-output audio supplied to the cloud model, short PCM is retained only in memory until transcription plus durable transcript-event acceptance succeed and then zeroed, raw audio is never persisted or exposed and internal credentials are never exposed in Call Notes snapshots, private-note redaction remains intact, and no UI or release claim presents channel provenance as speaker attribution or complete recording.
- Local backend `poll`, `event`, and `finish` operations accept an optional `AbortSignal` and have finite HTTP timeouts. Explicit `stop()` closes audio and drains pending transcription; cancellation `close()` terminates outstanding work without reporting success.
- No duplicate contract types, compatibility shims, stale prototype routes in production navigation, or obsolete external-service configuration remain.
- Installer packaging, signing/notarization, per-user agent supervision, installed-identity permissions, device enrollment, and installed-artifact verification are deferred as recorded in the implementation contract; the development worker is not a release-verified macOS application.

## Contract references

The shared v2 wire, source vocabulary, local worker requests, and evidence boundary are defined in [`docs/call-notes/implementation-contract.md`](../../call-notes/implementation-contract.md). Integration changes consume that contract directly and do not add local aliases.

## Non-goals

Conferencing-service capture, meeting bots, browser capture, per-app system-audio capture, guaranteed remote-party audio, complete meeting recording, diarization or speaker attribution, raw-media retention, custom streaming ASR, centralized hosted/SaaS operation, adding Redis/Kafka/RabbitMQ, generalizing capture sources or models prematurely, marketplace publication, automatic company-wide indexing, or a second knowledge system are outside v2.
