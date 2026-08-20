# Call Notes Implementation Contract

**Contract:** `call-notes/v1`
**Enrichment output:** `call-notes-enrichment/v1`
**Execution epic:** [MN-IMP-000](../issues/call-notes-implementation/000-implement-call-notes-zoom-first.md)

This is the shared handoff for independent implementation lanes. Wayfinder tickets remain the source for architecture rationale; exported TypeScript/Zod/Drizzle artifacts are the executable source for wire and persistence shape.

## Domain invariants

- A **Call** is one company-scoped provider occurrence.
- A Call owns one logical **Capture**. Start/Pause/Resume intent lives on Capture, not on a socket.
- Each connected or continued stream is a **Capture Attempt** anchored to one authorized **Capture User**.
- The same Capture User returning while desired mode is `running` creates a new attempt under the existing Call; returning while desired mode is `paused` stays paused.
- **Transcript Segment** evidence is immutable. Provider timestamps order it when available; `receivedAt` plus `receiveOrder` is the fallback.
- Known missing intervals are durable **Gaps**. Any retained Transcript with a known gap finalizes as `partial`, never silently `complete`.
- Every Call has at most one canonical editable **Call Note**, backed by existing `document_notes` and owned by the first user whose Capture start succeeds.
- Transcript evidence is company-visible. The owner may make the Call Note private; non-owners then receive `note: null` while the Transcript remains visible.
- **Enriched Note** is a proposal and immutable run record until the owner explicitly accepts or rejects it. Accept creates a new canonical-note revision.
- Company knowledge contains only the current canonical Call Note when its owner explicitly enables inclusion. Transcript segments never enter company RAG in this release.

## Executable surface

`@launchstack/features/call-notes` exports:

| Artifact                                           | Purpose                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `CallNotesCommandSchema`                           | Internal application commands issued by authenticated API edges                   |
| `DetectedCallCandidateSchema`                      | Best-effort pre-Start suggestion; it is not a Call until Start succeeds           |
| `CaptureEventSchema`                               | The only provider-to-domain event language                                        |
| `CallSnapshotSchema`                               | Read model consumed by APIs and the Calls UI; supports private-note redaction     |
| `EnrichmentInputSchema` / `EnrichmentResultSchema` | Model boundary with provenance-ready structured output                            |
| `KnowledgeNoteSchema`                              | The one downstream knowledge record                                               |
| `CaptureSource`                                    | Zoom runtime seam; future adapters must satisfy the same normalized contract      |
| `CallNotesApplication`                             | Domain/application seam consumed by API handlers and conformance tests            |
| `EnrichmentModel` / `KnowledgeNoteSink`            | AI and retrieval boundaries                                                       |
| `CALL_NOTES_CAPTURE_EVENTS`                        | Deterministic Zoom occurrence with Pause, Resume, leave, return, and finalization |
| `assertCaptureSourceContract`                      | Reusable provider conformance check                                               |
| `runCallNotesVerticalTracer`                       | Shared simulated end-to-end acceptance contract                                   |

The product schema is exported through `@launchstack/features/schema`; its migrations are `apps/web/drizzle/20260820010959_simple_khan.sql`, `apps/web/drizzle/20260820055456_deep_veda.sql`, and `apps/web/drizzle/20260820055726_famous_titanium_man.sql`.

## Replay and identity contract

| Boundary            | Stable identity                        |
| ------------------- | -------------------------------------- |
| User command        | `companyId + requestId`                |
| Provider occurrence | `companyId + provider + occurrenceKey` |
| Capture attempt     | `captureId + providerAttemptKey`       |
| Transcript packet   | `attemptId + sourcePacketHash`         |
| Durable work        | `companyId + kind + idempotencyKey`    |

A provider event may be delivered more than once or after a newer event. Consumers must make repeats harmless and must not replace immutable evidence. `eventId` identifies the normalized observation; `providerEventKey` is preferred when Zoom supplies one; `sourcePacketHash` remains required for transcript replay safety.

## Authorization contract

| Capability                                          | Call Note owner | Same-company user | Company admin |
| --------------------------------------------------- | --------------: | ----------------: | ------------: |
| Read Transcript and company-visible note            |             yes |               yes |           yes |
| Read private note                                   |             yes |                no |            no |
| Edit note, privacy, enrichment, knowledge inclusion |             yes |                no |            no |
| Create a company-visible Bookmark                   |             yes |                no |            no |
| Delete an empty failed Call                         |             yes |                no |           yes |
| Delete a completed or non-empty Call                | no unless admin |                no |           yes |

OAuth tokens, worker leases, and operator configuration are never exposed by `CallSnapshot`.

## Conformance boundary

The shared tracer drives Start through final knowledge inclusion. Its subject must be the real `CallNotesApplication` backed by the production state machine, repositories, authorization, and PostgreSQL. Zoom transport and model output may be deterministic fakes. A recording `KnowledgeNoteProbe` may observe the production sink boundary.

```ts
import {
  runCallNotesVerticalTracer,
  assertCaptureSourceContract,
} from "@launchstack/features/call-notes";

await assertCaptureSourceContract(zoomCaptureSource);
await runCallNotesVerticalTracer(callNotesApplication, recordingKnowledgeSink);
```

Lane-local tests should reuse the fixture and conformance functions, then add only behavior owned by that lane. The final integration suite exercises PostgreSQL, API handlers, and production UI rather than creating a second mocked Call Notes state machine.

## Contract changes

No lane duplicates or widens these types locally. A mismatch is reported with the failing fixture/event/command and the smallest proposed change. Kien updates the canonical contract, schema/migration when applicable, fixture, and conformance expectation together. Consumers then move to that revision without shims or deprecated aliases.

## Deferred seams

Google Meet/native capture, raw-media/ASR, transcript revisions, cross-user Capture handoff, overlapping Attempts, automatic knowledge inclusion, and centrally hosted OAuth are deliberately absent. Add them only after observed demand or provider evidence invalidates this minimal Zoom-first contract.
