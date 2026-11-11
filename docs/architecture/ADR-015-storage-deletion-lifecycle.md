# ADR-015: Relational-first durable storage deletion

- Status: Accepted
- Date: 2026-11-10
- Related: ADR-003 (transactional outbox), issue #313

## Context

Deleting a document used to delete its relational rows while leaving its stored
bytes behind. Versions, OCR inputs, upload batches and website previews can each
reference different objects. Re-embedding and reverting can also legitimately
share one URL across immutable versions. A provider delete must not destroy bytes
another live row still uses, including a row in another workspace.

This ports the intent of PRs #337 and #357 by Tiffany Wei (@t1ffnyw), with
@karMareal1 and @sfloody1, without their asynchronous relational purge, flags,
leader/follower items, tombstones, or separate Inngest dispatch and sweep.

## Decision

The user-facing delete remains synchronous. One caller-owned transaction locks
the document, snapshots its byte-bearing URLs into `storage_deletion_requests`
and `storage_deletion_items`, enqueues `storage.deletion.requested`, and deletes
the relational rows. A failed transaction leaves neither a plan nor an event.
Document/version identifiers and company stamps on requests deliberately have no
foreign keys: requests are the durable audit record, even after tenant deletion.
Items reference the request with CASCADE and the inventory with SET NULL.

`deleteDocumentCore` requires `requestedBy`, `reason`, and `traceId`; all document
purges pass through it. The version DELETE route plans the version and its jobs,
then removes those OCR jobs and the version in one transaction; permissions are
checked first and current/last-version guards are rechecked under lock.
Archive expansion injects relational cleanup from the application's ingestion
boundary into the engine pipeline and conversion function; packages never import
application code. Its cleanup explicitly skips connector deletion memory and
Drive-pick removal (archive expansion is not a user's delete). Replayed archive
events whose original document has already disappeared converge without reading
the deleted ZIP.

Repointing a document URL (Adeu, DOCX editing, or version revert) and replacing a
website preview plans the old URL in the same transaction as the update. This
intentionally also plans URLs held by immutable history: shared bytes are retained.

### Planning

Candidates include document and version URLs, attached OCR-job and batch-file
URLs, `ocr_metadata.websitePreview.url`, and `ocr_metadata.audioUrl` on documents
and versions. Audio references are snapshotted even though a transcript does not
uniquely own recording bytes: whichever document is deleted last must still
request cleanup. Global references retain the bytes while the other survives.
Future transcripts store the recording's canonical URL, not its absolute
processing/fetch URL. The planner recovers historical any-origin numeric file
aliases in every candidate column only when their file row exists, preserving
the source URL and file-company provenance. Missing external ids are skipped,
not invented as local byte ownership. `file_uploads.id` is PostgreSQL bigint;
reference joins cast to bigint, while parser/planner ids must remain JS-safe integers.
Candidates are deduplicated per request. Empty candidates produce no request or event.

Transcript-creation rollback is different: it must not plan the caller's source
upload, which batch re-commit or client retry may reuse. It only plans storage
created by the failed attempt (a transcript object), while removing newly-created
relational rows. An unused original upload is discoverable by orphan audit later.

An internal `/api/files/<id>` row can itself point at external provider storage.
Planning snapshots both the numeric pointer and the real provider ref from
`file_uploads.storage_url`; provider cleanup inherits the pointer's company stamp.
Foreign or null provenance blocks cleanup. Live references to such pointers
also protect their provider bytes.

The URL parser supplies the canonical ref first, and ref lookup attaches the
inventory id regardless of URL spelling (S3 public/internal endpoints,
UploadThing hosts, or absolute/relative file URLs). Only URLs the parser cannot
resolve fall back to exact ledger URL lookup. Multiple fallback ledger
identities are quarantined rather than choosing arbitrarily.
External/unrecognized links are skipped. Neither case invents a provider ref.

### Dispatch, retries, and states

ADR-003's transactional outbox owns dispatch, bounded retries, backoff, stale
claim recovery and dead lettering. There is no flag, second queue, or cron sweep.
One request produces one deterministic `storage.deletion.requested:<requestId>`
event, with payload `{ requestId }` and the command's trace/company envelope.

Requests start `pending`. Items start `pending`, `quarantined` (ambiguous), or
`skipped` (unrecognized). The worker processes only pending items:

| Transition                                           | Meaning                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| pending → retained                                   | Any live reference still uses these bytes; do not delete.                |
| pending → blocked                                    | Foreign ownership or provider authorization/configuration refusal.       |
| pending → deleted                                    | Provider acknowledged deletion.                                          |
| pending → not_found                                  | Provider positively confirmed absence.                                   |
| pending → pending                                    | Retryable provider result; persist attempt/error and throw after commit. |
| pending → blocked                                    | Outbox dead lettering; `retry_budget_exhausted`.                         |
| blocked (retry_budget_exhausted) → pending           | Redelivery/replay renews the cleanup attempt.                            |
| blocked (retry_budget_exhausted) → deleted/not_found | A concurrent provider success wins: bytes are already gone.              |

Every provider attempt increments `attempts`; shared-reference and provenance
checks do not. Confirmed deleted/not-found refs stamp inventory `deleted_at`.
Pending items keep the request pending and cause a retryable handler failure.
Otherwise any blocked/quarantined item makes the request blocked; all other
outcomes complete it and set `completed_at`. Completed delivery is a no-op.
Normal and validation-dead callbacks block remaining pending items; confirmed
provider deletion/absence supersedes a concurrent retry-budget block and stamps
the inventory. On redelivery, only `retry_budget_exhausted` blocks return to
pending; provenance/provider blocks and quarantined identities require a
separate operator decision. An event that is dead makes its request operationally
blocked even if the callback could not persist the request/item status.
`storageDeletionOperationalState` also reports pending requests without their
outbox event as blocked (`event_missing`). The outbox company FK cascades on
tenant removal, while cleanup requests intentionally survive. There is no
in-product tenant-delete path. Operators must stop tenant removal until cleanup
finishes; for an already removed tenant, inspect surviving inventory and requests
and explicitly waive or perform approved manual cleanup rather than waiting for
a vanished event. A surviving tenant's missing event can be recreated by the
operator tooling; dead events use outbox replay after resolving the cause.
Logs include trace id, request id and outcome counts.

The spec's nullable-ref CHECK allowed only quarantined items while also requiring
unrecognized URLs to be skipped. The implemented CHECK permits fully null refs
for **both quarantined and skipped**, and otherwise requires all three fields.
This is a deliberate consistency correction, not a fabricated placeholder ref.

### Global shared-reference coverage

Every protected reference writer (document ingress, persona/channel avatars,
persisted/queued chat attachments, and upload-batch registration) authorizes
stored URLs through the shared `authorizeStoredObjectUrl` rule. Provider refs at
the configured current location must be byte-identical to a live owned ledger
row; aliases, deleted ledger rows and foreign owners are rejected with each
caller's existing error convention. Provider refs at other locations are external
links. Database refs must have owned file rows, and ingress persists their
WHATWG-normalized `/api/files/<id>` path (document processing retains its absolute
URL convention). Provider refs remain byte-identical to the live ledger URL.
Authorization inside a transaction uses its executor, never a second pooled connection.
Ledgered provider reference checks can therefore use exact canonical equality.

Each protected column has a separate SQL UNION arm, rather than combining an
indexed column and unindexed JSON expression with OR. Documents, versions, active
job inputs, retryable batch inputs, and JSON preview/audio fields all have
equality indexes. Media/avatar exact checks have hash indexes.

Only legacy provider refs without ledger rows use a case-insensitive prefilter
matching the key's last path segment literally or percent-encoded, followed by
parsed adapter/location/key comparison. Each batch uses one constant alternation
regex with at most 64 alternatives per statement, not a candidate-by-table regex
join. Matching URLs are parsed once and mapped back to candidates by identity.
The worker batches these legacy scans once per request. Database refs use
`(regexp_match(col, '/api/files/0*([0-9]+)([/?#]|$)'))[1]` equality and concurrent
expression indexes, plus a bounded historical fallback for path-relative forms
(`api/files/<id>`, `./api/files/<id>`), dot segments, percent escapes, backslashes
and whitespace/control characters normalized by the same WHATWG parser. Only historical rows can
hold those spellings (ingress now persists canonical URLs), so this fallback runs
once per request alongside the legacy provider alias scans; the per-item refresh
re-runs only the indexed arms.
Canonical relative/internal-origin database URLs protect bytes globally. Other
spellings count only when the referencing row's company equals the file owner's
company, preventing arbitrary external `/api/files/<id>` links from pinning a
different tenant's file. Versions inherit company from their document; message
attachments/replay payloads inherit company from their session. Every protected
source has an owner path; none require a tenant-blind alias exception.
Only historical database chat attachments need JSON-array scans, which remain
request-wide. Per-item extracted-id matching excludes all three JSON-array
sources; the GIN containment arms still refresh canonical chat URLs, the only
relative spelling current ingress persists. Chat payload validation accepts
those canonical `/api/files/<digits>` URLs when queued/claimed sends or Ask again
are echoed back. Today's chat upload route is S3-only. Pointer matching has a separate indexed
`file_uploads.storage_url` equality arm, with constant legacy prefilters only for
unledgered provider refs. The indexed exact/extracted-id arms, including new
provider pointers' downstream references, are re-read for each item inside its
locked precheck transaction immediately before deletion. The request-wide
snapshot accelerates expensive aliases but is not the final canonical-reference
decision.
Inventory rows imported by `backfill-file-uploads` retain this legacy matching
path: their historical owners never passed canonical ingress validation. Their
company stamp still participates in the normal provenance checks.

There is **no cross-call advisory lock or reserved database connection**.
The outbox claims an event with `FOR UPDATE SKIP LOCKED`; request/item row locks
in short ordinary transactions coordinate prechecks, terminal state and retries.
Provider deletion is idempotent, so different requests for shared bytes can
safely converge even if both provider calls observe an unreferenced object.
A deletion-only lock would not synchronize writers that create new references
and therefore cannot close that race.

Network adapters run after the precheck transaction commits, outside any SQL
transaction or row lock. A fresh persistence transaction re-reads the item
`FOR UPDATE`; a pending item or concurrent retry-budget block accepts confirmed
success, while unrelated terminal/provenance decisions are not overwritten. Database
bytes are deleted through the existing transaction executor in one short
transaction with their item/inventory outcome. A supported nested Drizzle
transaction supplies a savepoint scope, isolating postgres.js's tracking of a
caught statement error before the outer transaction stores a retryable outcome.

The engine and product schema review identified these live URL fields:

- `document.url`
- `document_versions.url`
- `document.ocr_metadata.websitePreview.url` and `.audioUrl`
- `document_versions.ocr_metadata.websitePreview.url` and `.audioUrl`
- `ocr_jobs.document_url`, only queued/processing jobs whose document still exists
- `upload_batch_files.storage_url`, only queued/uploaded/processing/failed files, even when detached from a document (batch retries reuse the bytes)
- `brand_media.storage_url`
- `brand_channels.avatar_url` (conservatively protected even though normally remote)
- `collab_agent_persona.avatar_url` (can be a configured HTTPS picture)
- `workspace_session_messages.attachments[*].url`
- `workspace_session_messages.metadata.send.attachments[*].url`
- `workspace_sessions.queued_messages[*].send.attachments[*].url`

Completed OCR jobs and complete batch files are history, not live processing
ownership. Detached unfinished batch files still retain their storage objects.
`file_uploads.storage_url` is not an unconditional live reference: it is pointer
inventory whose downstream live usage must protect provider bytes.
`storage_objects.url` is object inventory, not independent ownership.
`claude_artifacts.source_url` and generated
document citation `sourceUrl` fields are provenance, not live byte ownership.
Brand profile URLs, credential/model endpoint URLs and OCR webhooks
are remote addresses, not stored objects. Profile images and feedback attachments
store their bytes inline rather than referring to the object-storage adapters.

The regenerated, unshipped engine migration builds all URL, preview/audio,
extracted database-file-id, OCR/batch input, and pointer URL indexes concurrently.
Product migrations index media/avatar equality and extracted file ids, chat JSON
containment, and create request/item tables. All index additions to existing
tables use Drizzle's `concurrently()` builder and generated
`CREATE INDEX CONCURRENTLY`; the only generated-SQL adjustment is the migration
runner's `-- launchstack:no-transaction` and `-- Reason:` headers. No journal or
snapshot is hand-edited. These builds avoid blocking existing writers;
interrupted nontransactional migrations require the runner's partial-state
investigation before retry.

### Embedded JSON review

Chat uploads from the composer's `purpose: "chat"` storage route are not Sources.
The session repository persists their URL in three real byte-owning locations:
turn attachments, saved `metadata.send` controls used by Ask again, and queued
`send` payloads. Each has an independent `@>` containment arm backed by a
concurrent GIN `jsonb_path_ops` index. Legacy/database alias checks expand just
these attachment arrays and apply the same bounded URL predicate in SQL.

Reviewed and excluded as non-ownership:

- Session context-source ids, refs and created-source ids point at document ids;
  citations are snippets/page references, web-source URLs are remote web pages,
  continuation is clipped inline transcript text. Attachment-chip Markdown is
  written alongside the structured attachment arrays, not a separate upload.
- `assistant_conversations` has no messages/JSON body: it indexes a saved
  conversation document by id. MCP message strings become uploaded Markdown
  owned by that document/version, not another JSON object reference.
- Agent-AI message content, tool input/output, task result/metadata, memory value,
  and execution input/output are opaque client JSON with no storage-upload
  producer or structured file URL field. Request-only query attachments are not
  persisted there. Model endpoint JSON stores offered model ids/capabilities.
- Mindmap document/revision images and thumbnails are inline data URIs; hrefs
  are arbitrary click-through links, presence is node ids. Publishing uploads an
  outline onto a separately guarded document.
- Document-note rich content and anchors are prose/selectors; generated-document
  citations and artifact source URLs are provenance for inline bodies.
- Collab message/meeting JSON stores event ids, phases, participants and prose;
  Brand capabilities/refs store flags and network CIDs. Feedback screenshots are
  inline bytea, not object-storage URLs.
- Proposal evidence URLs are funder web pages; draft/review/input JSON references
  document ids and quotes. Trend-cache result source URLs are remote web hits.
  OCR/batch JSON carries processing results/options; their actual input byte
  URLs are the separately guarded job/batch columns.
- Marketing run research URLs are trend-search hits; content-history metadata
  is not written. Founder snapshots/reviews carry document ids, in-app viewer
  links, excerpts and model metadata, not uploaded file references.
  Distribution provenance/event JSON records tools, run ids, statuses and
  scores; agreements point at their document via a numeric column. Scenario
  references are document ids/open targets, repo outputs are code text and
  published document ids, and accelerator/prospector URLs are public websites.
- OCR dispatch/outbox JSON duplicates `transcriptionMetadata.audioUrl` for
  processing. It is not an independent owner: these history rows outlive their
  documents. Guarding them would pin audio after both recording and transcript
  disappear. OCR results contain text blocks, extraction timing, and chunks;
  the live job guard is its active `document_url` column.

### Provenance and residual legacy risk

Before deletion, a non-null ledger company must match the request company.
Database refs additionally require the existing `file_uploads.company_id` to
match; null and foreign stamps block with `foreign_object`. An already absent
file may safely produce not-found. These checks run before provider invocation,
even if the request acquired a URL from a malicious relational attachment.
Every provider attempt also rechecks `file_uploads` pointer provenance, blocking
if any matching pointer has a null or foreign company stamp, even after an item
was forcibly reset to pending. Confirmed S3 deletion/absence removes same-company
pointer rows in the outcome transaction so they cannot remain dangling.
Layer 2 blocks new foreign/unledgered provider URL attachments at client ingress.

Legacy provider refs without inventory cannot prove historical ownership.
They may be deleted only after the global live-reference check finds no use.
This residual is intentional: otherwise old orphaned objects could never be
cleaned up. Canonical ref comparison protects plausible alternate live URL forms.
Residual race: a request body may create a reference after the worker's global
reference check but before its provider deletion. Reference writers do not take
a common lock; adding a deletion-only lock would not prevent this. Ingress
ownership checks and immutable version conventions limit, but do not eliminate,
that window.

### Known follow-ups

- Brand media, Brand channel avatar, collab persona avatar, and persisted chat
  attachment/queue owners protect
  bytes, but their owner deletion paths do not yet plan byte cleanup. Their
  lifecycle wiring is a known follow-up; orphan audit finds the resulting
  unreferenced inventory in the meantime.
- `createDocumentVersionLifecycle` can repoint a document after Adeu produced an
  in-place URL not held by an immutable version. This package-level replacement
  leak is deliberately not changed here; orphan audit covers that old object.

## Consequences

Documents disappear immediately, independently of provider health. Byte cleanup
is durable and auditable but can remain blocked or quarantined until an operator
resolves it. Shared bytes remain until the last relevant deletion request sees no
live references. A provider may complete just before a database failure; retry
must tolerate already-missing bytes. Existing provider contracts provide that
idempotency. No serving gates, UI polling, or deferred SQL purge are needed.
