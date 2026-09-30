# Call Notes Implementation Contract

**Contract:** `call-notes/v2`
**Enrichment output:** `call-notes-enrichment/v1`
**Execution epic:** MN-IMP-000

This is the shared handoff for the Call Notes implementation lanes. Exported TypeScript, Zod, and Drizzle artifacts are the executable source for wire and persistence shape; this document records the boundaries those artifacts must preserve.

## Call Notes indexed as documents — 2026-09-29

Call Notes are canonical application-managed files, indexed through the normal document ingestion and permission-scoped retrieval path while retaining the specialized Calls editor. This supersedes the earlier file-only and opt-in publication boundaries; there is no separate knowledge-inclusion toggle or command.

- **Indexing mechanism:** `CallNoteIndex` in `pipelines/src/call-notes/ports.ts` exposes idempotent `sync({ companyId, callId })`. The application invokes it after the owning write commits when the canonical note revision/title, visibility, or Call lifecycle changes. `apps/web/src/server/call-notes/document-index.ts` publishes the saved title and canonical Markdown through the same document ingestion path used by mindmap publishing, creating a regular `document` in the `Calls` folder with creation key `call-note:<callId>` and an `ocr_metadata.callNote` marker.
- **Eligibility and revisions:** only completed Calls with a saved canonical note, revision greater than zero, and company visibility are indexable. Later revisions add document versions under the same document ID, using revision keys `call-note:<callId>:r<revision>`. Index publication is serialized per Call by a row lock and rechecks the current revision before ingestion. Sync removes ineligible documents, including after privacy changes or Call deletion; restoring company visibility republishes an eligible note.
- **Upload lifecycle:** Markdown is uploaded only when the pre-check permits publication. After each upload, a `finally` cleanup discards its upload row and blob unless a document/version references it, including removed, stale or unchanged exits, errors and retries. Uploads retained by independently committed ingestion are kept.
- **Private-note decision:** private Call Notes are ineligible for indexing. Ordinary document permissions give non-guest `folders.manage` holders with document-read access a grant-restriction bypass, so folder or document grants alone would otherwise expose an owner-only note. `apps/web/src/lib/authz/scope.ts` denies Call Note document reads for every subject unless a live same-company Call points to that document, remains completed and company-visible, has revision greater than zero, and has a canonical note matching its note ID, owner and company. This denial does not wait for index cleanup or depend on its success. Owners can still open private notes in Calls, but private notes are unavailable to document retrieval and cannot be pinned as workspace chat context.
- **Durable provenance:** ingestion, edit and connector updates merge `document.ocr_metadata`, preserving `callNote` through failures and revisions. Index sync merge-stamps the marker on publication, versioning and unchanged paths. Call Note documents are recognized by that marker **or** a same-company `call_notes_calls` row referencing them via `indexed_document_id`. Both the scope denial and the mutation guards use this marker-or-reference boundary; `apps/web/src/lib/call-note-document.ts` supplies the guards' classification. Successful Google Drive/Gmail re-syncs merge metadata while clearing `driveDeleted` / `gmailDeleted`, respectively.
- **Managed-document guards:** visible Call Note documents return 409 for generic document PATCH, versions POST/DELETE/revert, `deleteDocument`, `batchDelete`, google-docs open/sync/unlink, adeu apply, and document-access changes. Generic PUT/DELETE at `/api/notes/[noteId]` also refuse a Call's canonical note with 409 `Call Notes are managed from Calls`. Calls-folder rename/move/delete through the Categories and folders APIs also return 409. Canonical mutations remain Calls operations.
- **File-read boundary:** session requests to `/api/files/[id]` apply the caller's document scope to uploads mapped to a document's current or historical versions, using either internal file URLs or external storage URLs.
- **Deletion boundary:** `deleteDocumentCore` deletes document/dependent rows and unshared upload rows in the caller's transaction and returns blob-deletion requests. `deleteDocument`, `batchDelete` and the Call Note index delete blobs only after commit; failures are logged. Uploads still referenced by another document/version are kept, including `/api/files/<id>` aliases with query strings, fragments or trailing slashes.
- **Canonical content only:** Call Notes are no longer note-embedded; `embed-note.ts` removes their legacy note vectors, and every `NotesRetriever` scope excludes Call-linked notes. Transcripts and unaccepted Enriched Note proposals never enter the document index. Explicit acceptance creates a canonical revision that is indexed when eligible.
- **Workspace context and citations:** `WorkspaceCallNoteFile.documentId` identifies the indexed document. Indexed Call Notes appear once in the source rail, can be selected as workspace chat context, and retain that context in chat history. Document-ID citations resolve to the Call Note and open `feature=calls&call=<id>`, not a second Markdown editor. Private or unindexed notes remain openable in Calls but expose no context checkbox. The Call Note context menu keeps opening and title/link copying separate from generic document mutation controls.
- **Migration and backfill:** product migration `20260930011158_call_note_document_index` adds `indexed_document_id` / `indexed_revision`, drops `knowledge_included`, and indexes `call_notes_calls(company_id, indexed_document_id)`. Engine migration `20260930011049_call_note_document_scope_index` adds the partial index `document(company_id, id) WHERE ocr_metadata ? 'callNote'`. Each step of the resumable, idempotent backfill `2026-09-call-note-documents` first merge-stamps every same-company document referenced by a Call's `indexed_document_id`, regardless of eligibility, then removes legacy Call Note vectors and syncs completed Calls through the same index. Run `pnpm --filter @launchstack/web db:backfill --only=2026-09-call-note-documents` after applying migrations.

## Approved capture and workspace behavior

- **Explicit Start:** the initial Calls UI requires an authenticated user to explicitly start capture. Speech detection alone must not create a new Call. Voice Activity detection remains responsible for utterance boundaries within a user-started capture.
- **Backend capture controls implemented:** authenticated Start creates a pending Capture; a private outbound-polling worker claims it before opening audio. Stop closes the sources and drains transcription before finalization. Startup and silence do not create Calls, and silence does not finish them. Backend-only HTTP/PostgreSQL E2E coverage uses controlled PCM and deterministic model responses; it requires no frontend and is not installed-macOS or live-device capture proof.
- **Frontend integrated:** the authenticated Calls workspace starts/stops capture, polls durable transcript and lifecycle state, autosaves title and rich notes, manages visibility, and generates, edits, accepts, rejects, or regenerates AI proposals. Confirmed mutations invalidate older in-flight reads; audio timestamps are not treated as monotonic snapshot revisions.
- **Workspace files, not host files:** Call Notes are application-managed file entries under `Calls`, with each entry opening the specialized Calls UI. Call history and the workspace file tree refer to the same underlying Call and canonical note; stored Markdown is a derived indexing projection, not a host-managed file or a second writable copy.
- **Permission-scoped assistant retrieval:** completed, company-visible canonical Call Notes with a saved revision use normal document retrieval. Private Call Notes are denied document retrieval even if index cleanup fails; Transcripts and unaccepted proposals never enter that index. There is no separate publication opt-in.
- **File integration delivered:** permission-scoped metadata listing, canonical title/preview refresh, workspace title/preview filtering, command-palette discovery, and specialized file-open routing. Indexed Call Notes can be pinned as assistant context and cited back to Calls. Note edits, visibility, and deletion remain Calls operations, not generic document controls.
- **Transcript bookmarks retired — 2026-09-06:** no transcript marker controls, bookmark commands, guidance, capability, or bookmark citation metadata remain. Migration `20260906060000_sunset_transcript_bookmarks` drops the marker table, removes `bookmarkPassages` from stored original/editable enrichment proposals, and deletes pending/failed bookmark-command receipts. Saved note prose, immutable transcript evidence, and other enrichment metadata are preserved. Apply migrations and deploy the web application and rebuilt worker together; restart old worker processes so they consume the current snapshot contract. Earlier issue documents are historical records, not authorization to restore bookmarking.

## Deferred local application lifecycle todos

The shared application/worker process launcher is deferred. The current Capture reliability work does not implement it.

- [ ] Add one local startup command for Next.js, Inngest, and the Local Capture Worker. Load the same configuration and prevent duplicate workers.
- [ ] Keep the worker idle between Captures. Application startup must not open microphone or Computer Audio inputs.
- [ ] On application shutdown, reject new Starts, close audio inputs, drain pending transcription within a defined limit, and stop the worker before Next.js.
- [ ] Terminate ffmpeg and the system-audio helper on worker exit, application crash, or shutdown timeout. No orphan capture processes may remain.
- [ ] Add bounded worker restart supervision without silently starting a new Capture Attempt.
- [ ] Verify application start/stop, worker crash, repeated startup, and forced shutdown on the real local Mac. Closing a browser tab is not application shutdown.

## Deferred macOS deployment work

The supported deployment is a server-hosted web application and one macOS-only Local Capture Worker running directly on the configured Capture User's Mac. The Node worker uses ffmpeg and a locally built ScreenCaptureKit helper in the logged-in session; see `apps/call-worker/README.md` for setup. There is no Docker/Linux Capture fallback. This manual development deployment is not an installable, release-verified macOS product.

Reliable Mac distribution remains deferred after explicit capture controls and frontend integration. The deployment work must cover:

- A versioned installation with pinned worker, Node, ffmpeg, and native-helper artifacts; users must not need a repository checkout or developer toolchain.
- Stable application identity, signing/notarization, and tested installation, upgrade, rollback, and uninstall.
- Per-user background-agent supervision in the logged-in session, singleton operation, bounded crash restart, and child-process cleanup. Starting or restarting the agent must leave capture idle.
- Separate microphone and system-audio permission/device checks under the installed application's actual process identity, with actionable denied/revoked-permission states.
- Explicit behavior for sleep/wake, logout, device removal, lost display targets, and backend outages; interruptions must not be represented as complete evidence.
- A tested macOS-version/architecture support matrix and installed-artifact capture tests. A successful permission preflight alone is not capture proof.
- Device-scoped enrollment, revocation, and protected credential storage before deployment across users' Macs. The current configured company/user and internal bearer token remain a controlled single-worker development boundary, not general device enrollment.

The previously observed system-audio backpressure and capture-target failures remain runtime acceptance concerns; packaging alone does not resolve them. No installer, login agent, signing workflow, or device-enrollment system is included in the current Start/Stop implementation scope.

## Domain invariants

- A **Call** is one company-scoped conversation occurrence.
- A Call owns one logical **Capture**. Start, Pause, and Resume intent lives on the Capture, not on a worker process or audio stream.
- Each continuous local-audio interval is a **Capture Attempt** anchored to one authenticated same-company **Capture User**. A later interval is a new attempt; cross-user handoff and overlapping attempts are not supported.
- A Capture's source is `local_audio`. The supported dual-channel macOS path combines independent microphone and Computer Audio streams. The source preserves Audio Channel provenance but does not guarantee complete coverage, diarization, or speaker attribution.
- **Transcript Segment** evidence is immutable. Every derived segment carries required `audioChannel` provenance (`microphone` or `system`); this is a capture path, not speaker attribution. Source timestamps order it when available; `receivedAt` plus `receiveOrder` is the fallback.
- Known missing intervals are durable **Gaps**. Any retained Transcript with a known gap finalizes as `partial`, never silently `complete`.
- Every Call has at most one canonical editable **Call Note**, backed by existing `document_notes` and owned by the first user whose Capture start succeeds.
- Derived transcript evidence is company-visible. It may have no participant or speaker identity; local ingest requires `participant: null`. The owner may make the Call Note private, and non-owners then receive `note: null` while transcript evidence remains visible.
- Transcript presentation may use `Me` for microphone evidence and `Meeting` for system-output evidence as fallback labels. These labels never populate `participantId` and must not be presented as diarization.
- **Enriched Note** is a proposal and immutable run record until the owner explicitly accepts or rejects it. Accept creates a new canonical-note revision.
- Company knowledge indexes the current canonical Call Note as a document when the Call is completed, its saved revision is greater than zero, and its visibility is company-wide. Private Call Notes are ineligible for document retrieval; Transcripts and unaccepted Enriched Note proposals are never indexed.

## Local source and transcription contract

- `CallNotesSourceSchema` is the canonical source schema, whose value in this release is `local_audio`.
- `AudioChannel` and `AudioChannelSchema` are exactly the two provenance values `microphone` and `system`. `microphone` identifies the Capture User's local microphone stream; `system` identifies the computer's combined system output. Neither value identifies a person, participant, or application.
- Capture-domain source vocabulary is explicit: `source`, `sourceOccurrenceKey`, `sourceAttemptKey`, `sourceStreamKey`, `sourceParticipantKey`, `sourceSessionKey`, `sourceStartMs`, and `sourceEndMs`. These names replace connection- or service-specific vocabulary at the domain boundary.
- One Capture Attempt uses `sourceStreamKey: "local-audio"`; each transcript segment carries its actual `audioChannel`. `sourceParticipantKey` and `sourceSessionKey` identify source observations when supplied, never channel provenance or diarization evidence.
- Transcript events use only `sourceKind: "derived_asr"`. There is no service-supplied transcript variant in v2.
- A local `transcript_segment` must carry a valid `audioChannel` and the literal `participant: null`. `audioChannel` is provenance only and cannot be used to infer a participant.
- The unknown gap kind is `capture_unknown`; the durable work kind for a capture event is `capture_event`.
- Attempt end reasons are exactly `silence_timeout`, `user_stopped`, or `source_stopped`.
- Start commands and `StartCaptureInput` carry no external `authorizationRef`. The authenticated same-company actor is the Capture User, and persistence stores `captureUserId`; there is no source connection table.
- The protected local-worker ingress narrows the general `CaptureEvent` union to exactly `attempt_connected`, `transcript_segment`, `attempt_ended`, `attempt_failed`, and `occurrence_ended`. A local `transcript_segment` must use `sourceKind: "derived_asr"`, a valid `audioChannel`, and literal `participant: null`; participant-lifecycle and transport events are rejected before ingestion even though the general schema can represent them.

## Executable surface

`@launchstack/pipelines/call-notes` exports:

| Artifact                                           | Purpose                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CallNotesCommandSchema`                           | Internal application commands issued by authenticated API edges                                                                                                    |
| `StartCaptureInput`                                | Local-source start input bound to the authenticated Capture User                                                                                                   |
| `DetectedCallCandidateSchema`                      | Best-effort pre-Start suggestion; it is not a Call until Start succeeds                                                                                            |
| `CallNotesSourceSchema`                            | Canonical `local_audio` source value                                                                                                                               |
| `AudioChannelSchema` / `AudioChannel`              | Required transcript provenance: `microphone` or `system`, never speaker identity                                                                                   |
| `CaptureEventSchema`                               | The only source-to-domain event language                                                                                                                           |
| `CallSnapshotSchema`                               | Read model consumed by APIs and the Calls UI, with private-note redaction                                                                                          |
| `EnrichmentInputSchema` / `EnrichmentResultSchema` | Model boundary with provenance-ready structured output                                                                                                             |
| `CallNoteIndex`                                    | Post-commit synchronization of the canonical Call Note's document index                                                                                            |
| `CaptureSource`                                    | Local capture-source seam consumed by the application                                                                                                              |
| `CallNotesApplication`                             | Domain/application seam consumed by API handlers and conformance checks                                                                                            |
| `EnrichmentModel`                                  | AI proposal-generation boundary                                                                                                                                    |
| `CALL_NOTES_CAPTURE_EVENTS`                        | Deterministic v2 application timeline with dual-channel derived transcription and finalization; the worker HTTP ingress accepts only the strict local subset above |
| `assertCaptureSourceContract`                      | Reusable local capture-source conformance check                                                                                                                    |
| `runCallNotesVerticalTracer`                       | Shared simulated end-to-end acceptance contract                                                                                                                    |

The local audio/transcription module exports:

- `PcmFrame { pcm: Uint8Array; capturedAt: Date; durationMs: number }`
- `AudioSource.frames(signal): AsyncIterable<PcmFrame>` and optional `stop(reason)`; process-backed sources expose immediate native-child shutdown independently of iterator progress
- `FfmpegPcmSource` for the microphone stream
- `VoiceActivityDetector.process(frame)`, returning `{ active, started, ended, rms }`; the worker owns one detector per audio channel
- `TranscriptionModel.transcribe({ audioWav, language? })`
- `OpenAiCompatibleTranscriptionModel` and `AzureSpeechFastTranscriptionModel`; `CALL_NOTES_TRANSCRIPTION_PROVIDER` selects `openai` or `azure_speech`
- `encodePcm16Wav`

The product schema is exported through `@launchstack/pipelines/schema`. The local-capture cutover is recorded by `apps/web/drizzle/20260902130152_opposite_gargoyle.sql`; `apps/web/drizzle/20260902141503_big_jean_grey.sql` adds required `audio_channel`, backfills existing local rows to `microphone`, removes the temporary default, and rewrites stored `local_microphone` source values to `local_audio`. Earlier migration history remains unchanged.

Worker heartbeat persistence is added by `apps/web/drizzle/20260906041526_youthful_strong_guy.sql`. Apply product migrations before starting the updated worker.

The main reconciliation preserves every applied SQL file byte-for-byte and combines the two journals in timestamp order with contiguous indices. Snapshots carry the cumulative schema from both histories and one continuous `prevId` lineage. Three historical Call Notes migrations predate the DDL-only/destructive-change markers; CI approves only their exact SHA-256 checksums rather than changing applied SQL. New migrations must follow the normal marker/backfill rules. Clean replay and schema comparison must end with the ten current Call Notes tables, no Zoom connection or bookmark table, and the canonical note/enrichment columns. `pnpm --filter @launchstack/web db:verify` checks the existing database ledger before deployment; do not reset a database to reconcile the branch.

## Calls workspace and assistant

`/employer/documents?feature=calls` opens the notes home in the existing workspace's main pane, replacing chat while preserving the source sidebar, workspace header, Studio menu, and account controls. Adding `&call=<id>` opens one focused note in that same pane. Home, note selection, and browser history preserve the URL; returning to chat or another Studio feature clears the Calls selection. Calls sizing and responsive breakpoints follow the available pane, not the browser viewport.

The UI uses Tiptap for canonical notes and keeps enrichment proposals separate. The owner can edit; other authorized viewers receive a read-only surface, and private-note redaction never instantiates an editor. The formatting toolbar sticks below the Calls controls while the note scrolls. Transcript and AI chat share one persistent bottom dock with collapsed, transcript, and chat modes. The complete waveform-and-composer surface expands upward from 56px into the same panel, capped at 680 × 464px, with a fixed bottom edge and a reversible 160ms eased transition. Switching modes crossfades content over 90ms without replacing the container; drafts, conversation history, and transcript search remain mounted. The note stays fixed behind it, including during keyboard focus transfer. Microphone bubbles align right and computer-audio bubbles left without inferring speaker identity. Search filters the transcript; copy exports the visible results, including gaps when unfiltered. New segments follow the scroll only while the reader is near the bottom. Escape or minimize collapses the dock and restores focus to the corresponding trigger; clicking outside collapses without stealing focus. Inactive views are inert, and reduced-motion preferences disable transitions. Home lists real calls grouped by date; it does not invent calendar events. Both application themes retain purple accents.

The displayed note title is also its rename surface, not a separate input. Owners double-click the heading or focus it and press Enter/F2 to edit plain text in place. Enter or blur commits through the existing title-save path; Escape cancels. The heading keeps its typography, and polling does not replace in-progress title text. Blank edits restore the saved title, and committed titles remain within the 512-character command limit.

Note edits use the existing `POST /api/call-notes` `update_note` command with `schemaVersion`, `requestId`, `callId`, `baseRevision`, the existing note `title`, Tiptap JSON `contentRich`, and its Markdown projection `contentMarkdown`. Identity and company remain server-resolved. Rich JSON takes precedence; legacy `{}` rich payloads load from Markdown. Unsupported rich nodes or marks show a source-preserving read-only fallback. Hydration and polling do not create revisions or enter undo history.

Autosave waits 600ms and serializes writes per Call. New typing remains a separate draft while a request is pending; uncertain failures retry the original request ID and body before sending newer content. Conflicts never silently rebase or overwrite a newer revision: the owner can copy the local draft or explicitly discard it in favor of the polled saved version. Drafts survive note and enrichment-tab navigation within Calls. Page unload warns about pending edits, and leaving Calls flushes pending unsaved writes; drafts are not a durable offline store, and an unmounted feature cannot present later network failures.

`GET /api/call-notes/files` returns authorized metadata for canonical notes without loading transcript rows or applying the Calls history page limit. Private notes appear only for their owner. File opening preserves `feature=calls&call=<id>`; selected Calls outside the history page continue polling through their detail route. Enrichment remains a separate proposal until explicit acceptance writes one new canonical revision, including any owner edits.

Enrichment generation prompt `call-notes-enrichment-generation/v5` produces concise chronological key notes rather than a fixed note template. Short topic headings and section count follow the discussion. Every section body uses Markdown bullet points, not paragraphs: one key point per short bullet, with nested bullets only for essential supporting detail. The prompt prioritizes key facts, decisions, follow-ups, risks, and open questions while cutting filler, repeated explanations, and recap prose without dropping distinct user-note ideas or uncertainty. Decisions, follow-ups, and note/transcript discrepancies belong inline in their relevant topic, not in appended Summary, Decisions, Action items, evidence, or user-note sections.

Ideas from the current user note's body are paraphrased into that summary and marked with `**Markdown bold**`; transcript-only context remains unbolded. Questions retain their uncertainty, unsupported user concerns remain explicitly attributed, and contrary transcript evidence is distinguished from the user's idea. An empty note body calls for no bold citations. These are model instructions and intuitive source cues, not mechanically verified semantic citations; proposal review remains necessary.

Long-input enrichment is on-demand, not continuous during capture. Short inputs retain one generation call. Larger inputs are split at transcript-segment boundaries where possible; oversized segments are split without breaking Unicode characters and retain their speaker/timestamp label on each fragment. Owner-note bodies are compacted separately from transcript evidence, including when the rich-text representation is large. Summaries preserve supplied order even when requests finish out of order; the final composition never receives the entire oversized transcript. The configured reasoning model serves both compaction and final composition.

Each initial model request budgets at most 24,000 UTF-8 bytes of system/user messages. Bytes conservatively upper-bound tokens; when the model declares a context limit, the budget is reduced further to reserve 4,096 tokens for schema/framing and up to 4,096 output tokens (capped by the model's declared output limit). Compaction runs at most two requests per wave per enrichment. Summaries are size-validated, and another reduction pass runs when their combined size exceeds the final prompt budget; no source text is silently truncated. A failed summary prevents final composition. Intermediate summaries are not persisted or exposed as note previews; previews start during final composition, and the saved note still changes only on acceptance.

Two stages do not imply two-request latency: bounded waves and very large inputs can require additional calls. This limits individual request size and per-run concurrency, not deployment-wide requests/tokens per minute; provider quotas and existing SDK retry behavior still apply. Compaction is lossy and its factual fidelity remains a model instruction, so owner review remains necessary.

Relative deadlines remain visible in the note and action text. `actionItems.dueDate` is populated only when the evidence establishes a full `YYYY-MM-DD` date; incomplete dates such as “Friday” or “October 12” without a year use `null`, rather than guessing a date or violating the output schema.

The `call-notes-enrichment/v1` schema version remains in use after removing bookmark-only fields. Summary, decisions, action items, conflict records, and owner-context labels remain structured metadata. Input validation rejects duplicate transcript segment IDs and invalid timestamp ranges. Only `chronologicalSections` renders into the editable note. The renderer returns Markdown with empty rich content so the existing Tiptap importer preserves lists and bold; edits serialize both Markdown and rich marks. The sunset migration strips only retired citation metadata; existing saved notes and other proposal content are not rewritten.

Queued and generating enrichments expose a provisional Markdown preview through `GET /api/call-notes/<id>/enrichment/stream?run=<runId>`. The SSE endpoint replays the latest durable preview, then emits changed `{ type: "progress", runId, status, markdown }` frames and a terminal `{ type: "complete", snapshot }`. It checks the better-auth session, active workspace, visible note, and the current exposed run; subsequent polls recheck access and stop on redaction, deletion, or run replacement. Disconnecting releases the observer, not the independent generation.

The configured model explicitly enables streaming. Native structured output uses cumulative JSON parsing before final Zod validation; the JSON fallback preserves raw structured text and clears its preview before its one repair attempt. Only partial `chronologicalSections` headings and Markdown are projected into `preview_markdown`, bounded to 120,000 characters and coalesced around 250ms. SSE polls that durable state around 500ms. Partial content never becomes a proposal, canonical note, or chat evidence; final schema and provenance validation still gate readiness.

For models declaring native `json-schema` output, streaming uses the OpenAI SDK's strict Zod-to-JSON-Schema conversion and explicitly sends `strict: true`, matching non-streamed generation while retaining cumulative previews. Converting Zod with the general-purpose converter alone loses strict enforcement and leaves defaulted nested fields out of `required`; a successful HTTP response can then fail final proposal validation. Provider refusal, truncation, and locally enforced refinements can still fail generation; partial JSON is never accepted as a fallback.

The existing manual enrichment POST remains synchronous. Normal Calls polling discovers its queued/generating run while that request remains pending, then the client subscribes to the same SSE endpoint used for automatic after-Stop enrichment. Reconnects replay stored text rather than restarting the model or animating a completed response. The browser renders provisional Markdown until the validated proposal replaces it with the existing review editor. The review notice has a subtle uniform border and background, no left accent, and disappears after acceptance. Apply the additive `20260906194545_legal_bromley` product migration before deploying this preview storage.

Automatic worker `finish` and manual `request_enrichment` both use `processQueuedCallNotesEnrichment` and `ConfiguredCallNotesEnrichmentModel`; there is no separate legacy automatic model route. Automatic generation runs in Next.js `after` after persisting its queued run, while manual generation awaits the same runner inside the request. Both choose direct generation versus bounded parallel compaction from input size, not trigger type. Failure records preserve the error message but not the raw provider response, so historical schema failures cannot establish the exact malformed output or provider finish reason.

`POST /api/call-notes/<id>/chat` accepts `{ question, history?: [{ role: "user" | "assistant", content }] }`. The route resolves the better-auth session and active workspace, then obtains a fresh authorized snapshot through `getCall` for every question, follow-up, and retry; it never trusts client-supplied note content or performs document retrieval. Context includes the latest saved note, all transcript segments received when the request is handled, capture state, and gaps, independently of UI polling. Audio still being transcribed and unsaved local edits are not included. Conversation history helps interpret follow-ups but is not call evidence; current context supersedes earlier answers. Private-note redaction does not hide the authorized company transcript.

After the call completes, ready AI-enhanced notes are included as a draft awaiting review, using the same chronological Markdown renderer as the UI and only while their base note revision matches the saved note. Pending, rejected, and stale proposals are not supplied. Once accepted, the latest canonical note supplies the final notes, including owner edits, rather than replaying the original proposal. Each subsequent question picks up newly ready or accepted notes without restarting chat. Enhanced draft content is included in the same context-size limit.

Successful chat requests return an SSE stream (`text/event-stream`) with JSON `data:` frames: `{ type: "delta", text }` appends answer text, `{ type: "done", text, aiModel }` supplies the complete normalized answer, and `{ type: "error", message }` reports generation failure. Authentication, validation, context limits, and model setup errors remain HTTP JSON errors before streaming starts. The client renders incremental Markdown, preserves UTF-8 across transport chunks, and requires a `done` event before committing an assistant reply to conversation history. Interrupted text remains visibly incomplete and is excluded from follow-ups and retries; retry does not duplicate the user question. Leaving the call cancels the request and upstream generation.

Call chat resolves its model with `{ streaming: true }` before calling `.stream()`. The installed ChatOpenAI adapter otherwise disables streaming at construction and silently falls back to a buffered completion, even through `.stream()`. Regression coverage exercises the real resolver and SDK against a held-open HTTP response, not only mocked model chunks.

Questions are limited to 8,000 characters. History is limited to 20 messages, 4,000 characters per message, and 40,000 characters total. Call context exceeding 60,000 characters returns 413 without silently dropping evidence. Call-scoped chat is session-local, does not alter the canonical note, and drafts email without sending it. The home composer opens the separate workspace assistant, whose permission-scoped document retrieval can include indexed Call Notes.

## Local worker HTTP wire

The Local Capture Worker sends requests to `POST /api/internal/call-notes/local`. Every request uses `Authorization: Bearer CALL_NOTES_INTERNAL_TOKEN`; the token is deployment secret material and never appears in Call Notes snapshots.

| Operation | Body                                          | Response                                   |
| --------- | --------------------------------------------- | ------------------------------------------ |
| `poll`    | `companyId`, `userId`, `workerId`             | `{ capture: LocalCaptureSession \| null }` |
| `event`   | `companyId`, `userId`, `callId`, `event`      | acknowledgement                            |
| `finish`  | `companyId`, `userId`, `callId`, `autoEnrich` | finalization response                      |

There is no private worker `start` operation. Only authenticated `POST /api/call-notes` with `kind: "start_capture"` creates a Call. Start requires a worker heartbeat newer than 15 seconds for the configured company and Capture User; an unavailable worker returns 503 without creating a Call. Each poll records the scoped heartbeat and renews the owned attempt lease. A poll atomically claims a connecting Capture and returns `callId`, `captureId`, `occurrenceKey`, `attemptKey`, `startedAt`, `title`, and `desiredMode`. The process-scoped worker ID is persisted as the attempt source key; another worker cannot take over that claim.

The internal route requires configured company and user context. For `event` and `finish`, it resolves the supplied `callId` as the configured user before any write. Event ingress requires capture control, matching occurrence identity, and a persisted claimed attempt matching the supplied attempt key. Finalizing Captures still accept their pending transcript writes. Finish requires a terminal Capture and Call Note-owner authorization. Missing scope, capability, occurrence, or claimed-attempt identity is rejected. The route is not a replacement for the authenticated user API.

Authenticated `GET /api/call-notes/worker` returns `{ available, lastSeenAt }` for the current configured company and user, without exposing worker identifiers or credentials. The Calls UI checks availability before enabling Start; an unavailable worker never disables Stop for an active Capture. Calls polling is non-overlapping at one-second intervals.

Polling and application reads reconcile abandoned claimed-local attempts instead of leaving Connecting or Finalizing indefinitely. Expired ownership, including legacy claimed attempts without an expiry, terminates the Capture with a `worker_unavailable` Gap. Saved evidence produces a completed but partial Call; no evidence produces a failed Call. Stale events cannot append after recovery. A healthy finalizing worker receives a 30-second drain grace; losing its heartbeat still bounds recovery. This is request-driven recovery, not a background application-process supervisor.

## Pipeline

`AudioSource.frames(signal)` and local backend operations accept an optional `AbortSignal`. The HTTP backend combines caller cancellation with a finite request timeout. `LocalCapturePipeline` receives an assigned `LocalCaptureSession`; it never creates Calls. `stop()` is a bounded graceful drain, while `close()` cancels capture and must not produce a successful finalization. The worker remains idle between assigned sessions.

The implemented v2 path is:

1. An authenticated configured user issues Start. At most one nonterminal Capture may exist for that user; repeated starts for the same occurrence converge. The worker atomically claims the pending session before opening sources.
2. On the supported dual-channel macOS path, the worker opens microphone and Computer Audio streams concurrently and waits for valid PCM from both before emitting `attempt_connected` and showing Live. Readiness has a 10-second deadline; silence represented by zero PCM is valid. Required-source failure never emits connected. After readiness, either Audio Channel may contribute evidence independently.
3. Each channel has independent Voice Activity detection, a 200ms pre-roll buffer preserving speech onset and VAD activation frames, and Audio Utterance buffering. Defaults send at 300ms of silence or a 3-second utterance limit. Speech and silence determine utterance boundaries only; neither creates nor ends a Call.
4. The configured Transcription Model returns text for each channel-specific utterance. For non-empty text the worker emits a strict local `transcript_segment` with `sourceKind: "derived_asr"`, the utterance's `audioChannel`, and `participant: null`, plus source timing when available. A single Call/attempt has one global receive order across both channels.
5. Each utterance's short PCM buffer remains in memory until transcription succeeds and the transcript event is durably accepted. The worker then zeroes the PCM bytes before releasing the buffer; an empty transcription result has no transcript event and may be zeroed after the model call succeeds. Raw audio is never written to a recording or persisted.
6. A required stream error or unexpected EOF is capture loss. The worker must best-effort emit `attempt_failed`, never a successful finish or auto-enrichment. Cancellation, timeout, abort, and unsupported pause are also failed paths.
7. Stop sets `desiredMode: "stopped"` and exposes finalizing state. The worker closes audio, drains outstanding utterances and transcript writes, then emits `attempt_ended` with `reason: "user_stopped"` followed by `occurrence_ended`. Stopping an unclaimed Capture terminates it without opening audio. Repeated Stop is harmless; pause/resume cannot resurrect a stopped Capture.
8. Only after successful evidence persistence does the worker send `finish` using the assigned `callId` and configured user. Auto-enrichment is durably queued before the response, while model generation runs separately through Next.js `after`; it is not part of audio shutdown or the Stop drain deadline. The unaccepted proposal neither replaces the canonical Call Note nor enters the document index.
9. Shutdown cancels both source streams and all in-flight transcription/backend work. It must not convert cancellation or incomplete evidence into successful finalization or enrichment.

An unexpected capture loss, abort, fatal transcription failure, or transcript-event persistence failure is a failed path. It must not emit a successful `attempt_ended`, `occurrence_ended`, or `finish`, and must not request or run auto-enrichment. The worker may best-effort emit `attempt_failed` when the backend is reachable.

The order above is evidence ordering, not a claim that every participant was heard. Microphone evidence is the acoustic mix reaching that microphone; system evidence is the computer's combined output; neither establishes who spoke.

Stop invokes the native source stop hooks immediately when the worker observes stopped intent, then allows pending transcription and transcript persistence up to `CALL_NOTES_STOP_DRAIN_TIMEOUT_MS` (default 30000). Expiry rejects the drain and reports failure; it cannot masquerade as successful completion. Forced close remains cancellation, not graceful Stop. A null assignment revokes a running pipeline, but does not cancel a pipeline already draining an explicit Stop.

Audio timing defaults are `CALL_NOTES_AUDIO_PRE_ROLL_MS=200`, `CALL_NOTES_AUDIO_READY_TIMEOUT_MS=10000`, `CALL_NOTES_UTTERANCE_MAX_MS=3000`, `CALL_NOTES_VAD_RELEASE_FRAMES=15` at 20ms per frame, and `CALL_NOTES_TRANSCRIPTION_TIMEOUT_MS=20000`. Azure Fast Transcription returns completed utterance chunks, not word-streaming output. Continuous speech now generates approximately 20 requests per minute per channel; shorter utterances can produce more. Cloud processing and the one-second UI poll add to visible latency.

## Replay and identity contract

| Boundary                       | Stable identity                               |
| ------------------------------ | --------------------------------------------- |
| User command                   | `companyId + requestId`                       |
| Worker event request           | `companyId + userId + callId + event.eventId` |
| Source occurrence              | `companyId + source + sourceOccurrenceKey`    |
| Capture attempt                | `captureId + sourceAttemptKey`                |
| Capture stream                 | `attemptId + sourceStreamKey`                 |
| Source participant observation | `attemptId + sourceParticipantKey`            |
| Source session observation     | `attemptId + sourceSessionKey`                |
| Transcript packet              | `attemptId + sourcePacketHash`                |
| Durable work                   | `companyId + kind + idempotencyKey`           |

A capture event may be delivered more than once or after a newer event. Consumers must make repeats harmless and must not replace immutable evidence. `eventId` identifies the normalized observation; source keys identify the originating occurrence, attempt, stream, participant observation, or session when present; `sourcePacketHash` remains required for transcript replay safety. A replayed worker event still has to carry the configured `userId` and `callId`, and its occurrence key must match the resolved Call before ingestion.

## Authorization and privacy contract

| Capability                               | Call Note owner | Same-company user | Company admin |
| ---------------------------------------- | --------------: | ----------------: | ------------: |
| Read Transcript and company-visible note |             yes |               yes |           yes |
| Read private note                        |             yes |                no |            no |
| Edit note, privacy, enrichment           |             yes |                no |            no |
| Delete an empty failed Call              |             yes |                no |           yes |
| Delete a completed or non-empty Call     | no unless admin |                no |           yes |

Company-admin deletion authority includes both `owner` and `admin` membership roles. Note ownership alone only permits deletion of an empty failed Call; advertised capabilities and command authorization use the same distinction.

Starting a Capture requires an authenticated actor matching the enabled deployment's configured company and user. That actor becomes `captureUserId`; the internal bearer token protects only the worker-to-application boundary, not general device enrollment.

Private ingress fails closed on missing configuration, mismatched worker scope, missing capture control, mismatched occurrence, or an unclaimed/foreign attempt. The generic provider-neutral application event interface remains available to domain fixtures, but private HTTP ingestion uses the stricter claimed-session method. Finish retains owner authorization and rejects nonterminal Captures.

The worker sends short Audio Utterances to the deployment's configured cloud Transcription Model and persists derived transcript evidence, not a claim of complete call recording. PCM exists only in memory while its utterance is being transcribed and ingested; after successful ingestion the bytes are zeroed and the buffer is released. Raw audio is never persisted, exported, logged, or exposed. Microphone input can include nearby speech and ambient sound; system input is a combined computer mix that can include meeting and other system output. Neither channel guarantees remote-party coverage, diarization, or speaker attribution. Call snapshots expose neither raw audio nor internal credentials, and private-note redaction remains unchanged.

## Deployment and runtime

- The Local Capture Worker targets Node 24 or newer and uses native `fetch` and `FormData`; no new HTTP dependency is required.
- Azure Speech Fast Transcription uses the synchronous `2025-10-15` API with short WAV utterances, `Ocp-Apim-Subscription-Key`, and the configured locale. It reads `combinedPhrases` as one channel-local transcript and does not infer participant identity.
- Supported Capture runs the Local Capture Worker directly on one configured Capture User's Mac with macOS 14 or newer; setup is documented in `apps/call-worker/README.md`. The native `launchstack-system-audio` helper uses public ScreenCaptureKit APIs, captures the combined system mix (not per-app audio), excludes the helper's own audio, and supports headphones.
- macOS requires Microphone and Screen & System Audio Recording permission for the worker's actual launch context. Follow the permission and microphone-selection steps in `apps/call-worker/README.md`; manual setup does not constitute installed-artifact verification.
- Configure `CALL_NOTES_SYSTEM_AUDIO_ENABLED=true` and `CALL_NOTES_SYSTEM_AUDIO_HELPER_PATH` to the absolute release binary path `apps/call-worker/native/system-audio-capture/.build/release/launchstack-system-audio`. Keep the flag false when the helper is unavailable.
- The helper operator commands, run from `apps/call-worker`, are:
  - `pnpm run build:system-audio`
  - `pnpm run system-audio:request-permission`
  - `pnpm run system-audio:status`
    `--status` prints one JSON object and exits 0 only when macOS support and authorization are ready; it never prompts. Capture mode is `launchstack-system-audio --sample-rate 16000`, which writes mono signed-16-bit little-endian PCM to stdout and diagnostics only to stderr.
- The worker has no public listener. It calls the protected internal route over the deployment's normal HTTPS origin, using `CALL_NOTES_INTERNAL_TOKEN`.
- The web application is server-hosted using container images and Compose. The Docker `call-worker` service and capture Dockerfile are removed; no Linux/containerized Capture fallback is supported.
- Run one Local Capture Worker directly on the configured Capture User's Mac, following `apps/call-worker/README.md`. It polls the protected web route and needs no database credentials. Installer, background-agent supervision, and device enrollment remain deferred.
- Local backend HTTP calls have a finite default timeout combined with the pipeline's `AbortSignal`; timeout or cancellation is surfaced as a failed operation and cannot be converted into successful finalization or enrichment.

## Conformance and evidence boundary

The shared tracer drives Start through canonical-note editing, private-note redaction, explicit enrichment acceptance, and Transcript search. Its subject must be the real `CallNotesApplication` backed by the production state machine, repositories, authorization, and PostgreSQL. Deterministic microphone and system-channel audio fixtures and a deterministic `TranscriptionModel` may stand in for host capture and cloud model output. There is no separate knowledge sink or publication command in the tracer.
The tracer requires a fresh worker heartbeat before invocation; it checks availability without claiming a fixture-created Capture.

```ts
import {
  runCallNotesVerticalTracer,
  assertCaptureSourceContract,
} from "@launchstack/pipelines/call-notes";

await assertCaptureSourceContract(localCaptureSource);
await runCallNotesVerticalTracer(callNotesApplication);
```

`CALL_NOTES_CAPTURE_EVENTS` and the deterministic dual-channel audio/model fixtures are the correctness oracle for ordering, gaps, replay, channel provenance, and persistence. A configured cloud Transcription Model smoke verifies request/response and output-schema compatibility only; it cannot prove complete remote-party or system-audio coverage, complete conversation capture, diarization, or speaker attribution. Lane-local checks should reuse the fixture and conformance functions, then add only behavior owned by that lane. The final integration suite exercises PostgreSQL, API handlers, and production UI rather than creating a second mocked Call Notes state machine.

`apps/web/__tests__/callNotes/local-capture.e2e.test.ts` hosts production API handlers over localhost HTTP with a migrated isolated PostgreSQL database. It exercises the real worker polling client and pipeline from idle through Start, two-channel evidence, Stop during outstanding model work, finalization, proposal creation, explicit acceptance, and canonical workspace-file projection. Audio input, the better-auth session, and external model output are controlled test boundaries.

Streaming coverage additionally holds the real LangChain/OpenAI-compatible HTTP response open until a parsed partial reaches its consumer. The capture/PostgreSQL scenario reads persisted preview SSE while model completion is still gated, verifies that the canonical note is unchanged, and then receives the validated terminal snapshot. Browser fixtures exercised progressive Markdown, review-editor handoff, interruption retention, acceptance, desktop/mobile layout, and reduced motion; they do not claim a live-provider browser streaming run.

Earlier full-shell browser verification exercised real better-auth authentication, isolated migrated PostgreSQL, the real worker runtime with synthetic spoken PCM on both channels, configured Azure Speech transcription, and the configured enrichment model. The UI started/stopped capture, displayed persisted evidence, autosaved a renamed note, accepted an owner-edited proposal, changed visibility, and reopened the same canonical note through workspace search after reload. Model proposals still require review: the smoke observed an unsupported inferred date. This is real provider/integration proof, not native microphone/system-audio, installed-macOS, or model factual-accuracy certification.

The browser also verified regenerated proposal lists through the existing Markdown importer, explicit rejection without a note revision, command-palette reopening, and authorized deletion removing the canonical file. A deleted Call returns 404. The web application service is cached per module rather than across Next route bundles, preserving domain error identity and preventing expected 403/404 responses from becoming generic 503 errors.

The capture-reliability browser smoke used the real macOS microphone and ScreenCaptureKit sources plus Azure transcription. Quiet startup reached Live; the spoken system-audio check produced three saved segments, with the first saved about 4.1 seconds after speech began and the final segment about 0.9 seconds after speech ended. Stop retained the final spoken words, completed the Capture, and left no ffmpeg or system-audio helper process. These are one-run observations, not latency guarantees or microphone speech-recognition proof. The smoke's separate enrichment run failed without blocking Capture completion. The previously orphaned Call recovered as partial with all ten existing segments retained. Only the temporary verification Call was removed.

Bookmark sunset verification used a populated throwaway PostgreSQL database upgraded through the real migration chain: the marker table and retired command payloads were removed, citation metadata was stripped from ready/accepted/rejected proposals, and other proposal fields plus Call/Transcript rows were unchanged. A temporary browser preview rendered the production `CallsWorkspace` with owner-capable fixtures and verified no bookmark controls, transcript search, and copying both channel-labelled segments. These checks did not modify an existing deployment database or rerun live capture/cloud enrichment.

## Contract changes

No lane duplicates or widens these types locally. A mismatch is reported with the failing fixture, event, or command and the smallest proposed change. Kien updates the canonical contract, schema/migration when applicable, fixture, and conformance expectation together. Consumers then move to that revision without shims or deprecated aliases.

## Non-goals and deferred seams

Conferencing-service capture, conversation bots, browser capture, per-app system-audio capture, guaranteed remote-party audio, diarization or speaker attribution, raw-media retention, custom streaming ASR, transcript revisions, cross-user Capture handoff, overlapping Attempts, indexing Transcripts or unaccepted Enriched Note proposals, centralized hosted/SaaS operation, a public queue, and a second knowledge system are deliberately absent. The local microphone/Computer Audio source and cloud transcription boundary are the complete v2 capture surface; add another source only after an explicit contract revision.
