---
id: MN-IMP-002
title: Implement the Local Capture and Cloud Transcription Runtime
parent: MN-IMP-000
status: open
assignee: Kien
labels:
  - call-notes
  - local-capture
  - transcription
  - runtime
tracker: local-markdown
blocked_by:
  - MN-IMP-001
---

# Implement the Local Capture and Cloud Transcription Runtime

## Outcome

A private long-running Node 24+ worker acquires two tagged local PCM streams when full host capture is enabled: the Capture User's microphone and the computer's combined system output. It runs independent Voice Activity and utterance/transcription pipelines, preserves `microphone`/`system` channel provenance in derived v2 CaptureEvents, and never turns the streams into a retained recording. Docker/Linux is an explicit microphone-only development fallback; no mode promises complete coverage, diarization, or speaker attribution.

## Contracts consumed and provided

The runtime consumes authenticated local `StartCaptureInput` and control intent, tagged local audio frames, and deployment transcription settings. Start carries no external `authorizationRef`; the authenticated same-company actor is the Capture User. The runtime provides the `CaptureSource` seam, source-normalized `CaptureEvent` delivery, worker health/readiness, and replay-safe source identities. The worker never creates product Calls directly.

The worker sends its events and lifecycle requests to `POST /api/internal/call-notes/local` with `Authorization: Bearer CALL_NOTES_INTERNAL_TOKEN`:

| Operation | Body                                                                       | Result                       |
| --------- | -------------------------------------------------------------------------- | ---------------------------- |
| `start`   | `companyId`, `userId`, `occurrenceKey`, `attemptKey`, `startedAt`, `title` | `{ callId }`                 |
| `event`   | `companyId`, `event`                                                       | event acknowledgement        |
| `finish`  | `companyId`, `userId`, `callId`, `autoEnrich`                              | finalization acknowledgement |

## Owned surface

`apps/call-worker/**`, the dual local audio/VAD/WAV module, the cloud Transcription Model adapter, the native system-audio helper integration, and the worker's protected application client. The web edge owns the protected internal route; root environment/Compose wiring and shared package changes remain final integration work.

The worker has no public listener. It uses Node 24 native `fetch` and `FormData`; no new HTTP dependency is introduced for the internal route or model call.

## Acceptance

- `PcmFrame` is `{ pcm: Uint8Array; capturedAt: Date; durationMs: number }`, and each `AudioSource.frames(signal)` instance is tagged as `microphone` or `system`.
- Full host mode starts microphone and system-output sources concurrently. Each source has independent VAD and utterance buffering/transcription; either channel can provide the first evidence for the Call, and silence/end decisions consider both channels.
- `FfmpegPcmSource` supplies the microphone PCM boundary; the native `launchstack-system-audio` helper supplies mono signed-16-bit little-endian system PCM; `encodePcm16Wav` turns each utterance into the model input.
- `VoiceActivityDetector.process(frame)` returns `{ active, started, ended, rms }`; one detector runs per audio channel and does not infer a speaker.
- `TranscriptionModel.transcribe({ audioWav, language? })` is the cloud-model boundary, and `OpenAiCompatibleTranscriptionModel` implements the configured compatible endpoint without inventing speaker identity.
- The local pipeline emits, in order, `attempt_connected`, zero or more channel-tagged `transcript_segment` events with `sourceKind: "derived_asr"` and `participant: null`, `attempt_ended` with `reason: "silence_timeout"` after both required channels end, `occurrence_ended`, and then `finish`.
- Every local `transcript_segment` carries required `audioChannel: "microphone" | "system"` provenance. Presentation may use `Me`/`Meeting` fallback labels while `participantId` remains null.
- User stop and source shutdown are explicit `attempt_ended` reasons `user_stopped` and `source_stopped`; missing or interrupted evidence is not silently represented as a complete Transcript. A required stream failure emits `attempt_failed` and fails the attempt; shutdown cancels both streams.
- Source identity uses `source`, `sourceOccurrenceKey`, `sourceAttemptKey`, `sourceStreamKey`, `sourceParticipantKey`, and `sourceSessionKey` where supplied. Transcript timing uses `sourceStartMs` and `sourceEndMs`; no source key or channel is treated as proof of participant identity.
- Duplicate and out-of-order events are replay-safe, retain immutable transcript evidence, and do not create duplicate Calls, work items, or segments.
- The shared capture-source conformance suite passes against deterministic microphone/system-output fixtures and a deterministic Transcription Model. A configured cloud-model smoke verifies request/response and output schema only; it cannot prove complete remote-party or system-audio coverage, complete conversation capture, diarization, or speaker attribution.
- Short PCM utterance buffers are retained only in memory until transcription and durable event acceptance succeed, then zeroed and released; raw audio, worker credentials, and `CALL_NOTES_INTERNAL_TOKEN` are never returned by the application.
- Full dual-channel capture runs the worker on a macOS 14+ host with Microphone and Screen & System Audio Recording permission. Docker/Linux runs only the explicit ALSA microphone fallback and is not feature parity.

## Contract references

The shared v2 contract and its source vocabulary are defined in [`docs/call-notes/implementation-contract.md`](../../call-notes/implementation-contract.md). Any mismatch is resolved there rather than by adding a runtime-local type or compatibility path.

## Non-goals

Product-domain state transitions, Calls API/UI, AI enrichment, knowledge indexing, conferencing-service capture, meeting bots, browser capture, per-app system-audio capture, remote-party audio acquisition, guaranteed diarization or speaker attribution, raw-media retention, custom streaming ASR, a public queue, or a general capture-source framework beyond the dual local-audio seam.
