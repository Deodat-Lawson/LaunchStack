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
purges pass through it. The version DELETE route plans and removes the version
in one transaction while preserving permissions and current/last-version guards.
Archive expansion injects relational cleanup from the application's ingestion
boundary into the engine pipeline and conversion function; packages never import
application code. Its existing OCR-job cleanup is preserved.

Repointing a document URL (Adeu or DOCX editing) and replacing a website preview
plans the old URL in the same transaction as the update. This intentionally also
plans URLs still held by immutable history: the worker retains shared bytes.

### Planning

Candidates include document and version URLs, attached OCR-job and batch-file
URLs, and `ocr_metadata.websitePreview.url` on both documents and versions.
`audioUrl` is not owned by a transcript: it points at the separate recording
document, so it is never a planner candidate. It remains a live-reference guard.
The `websitePreview.source` is provenance, not another preview object.
Candidates are deduplicated per request. Empty candidates produce no request or event.

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

| Transition | Meaning |
| --- | --- |
| pending → retained | Any live reference still uses these bytes; do not delete. |
| pending → blocked | Foreign ownership or provider authorization/configuration refusal. |
| pending → deleted | Provider acknowledged deletion. |
| pending → not_found | Provider positively confirmed absence. |
| pending → pending | Retryable provider result; persist attempt/error and throw after commit. |
| pending → blocked | Outbox dead lettering; `retry_budget_exhausted`. |

Every provider attempt increments `attempts`; shared-reference and provenance
checks do not. Confirmed deleted/not-found refs stamp inventory `deleted_at`.
Pending items keep the request pending and cause a retryable handler failure.
Otherwise any blocked/quarantined item makes the request blocked; all other
outcomes complete it and set `completed_at`. Completed delivery is a no-op.
Normal and validation-dead outbox callbacks both block remaining pending items;
terminal item outcomes remain intact. Logs include trace id, request id and
outcome counts. Repair/replay operator tooling belongs to the next layer.

The spec's nullable-ref CHECK allowed only quarantined items while also requiring
unrecognized URLs to be skipped. The implemented CHECK permits fully null refs
for **both quarantined and skipped**, and otherwise requires all three fields.
This is a deliberate consistency correction, not a fabricated placeholder ref.

### Global shared-reference coverage

The worker first checks the item's original `source_url` and canonical ledger
URL using indexed equality. On a miss, each protected SQL column is filtered
before any candidate URL crosses into the application: provider URLs must
contain the complete object key (`strpos`), and database URLs must match the
numeric `/api/files/0*<id>/?([?#]|$)` boundary (including the parser's optional
trailing slash). Only those plausible aliases are
parsed and compared by complete ref identity. This preserves host/query-string
aliases without pulling the full live URL population into the worker.
The check is global, never tenant-filtered.

There is **no cross-call advisory lock or reserved database connection**.
The outbox claims an event with `FOR UPDATE SKIP LOCKED`; request/item row locks
in short ordinary transactions coordinate prechecks, terminal state and retries.
Provider deletion is idempotent, so different requests for shared bytes can
safely converge even if both provider calls observe an unreferenced object.
A deletion-only lock would not synchronize writers that create new references
and therefore cannot close that race.

Network adapters run after the precheck transaction commits, outside any SQL
transaction or row lock. A fresh persistence transaction re-reads the item
`FOR UPDATE` and only applies an outcome while it remains pending. Database
bytes are deleted through the existing transaction executor in one short
transaction with their item/inventory outcome. A supported nested Drizzle
transaction supplies a savepoint scope, isolating postgres.js's tracking of a
caught statement error before the outer transaction stores a retryable outcome.

The engine and product schema review identified these live URL fields:

- `document.url`
- `document_versions.url`
- `document.ocr_metadata.websitePreview.url` and `.audioUrl`
- `document_versions.ocr_metadata.websitePreview.url` and `.audioUrl`
- `ocr_jobs.document_url`, only when `document_id` still joins a live document
- `upload_batch_files.storage_url`, only when `document_id` still joins a live document
- `brand_media.storage_url`
- `brand_channels.avatar_url` (conservatively protected even though normally remote)
- `collab_agent_persona.avatar_url` (can be a configured HTTPS picture)

Detached OCR and upload-batch history does not retain objects forever.
`file_uploads.storage_url`/`storage_pathname` and `storage_objects.url` are the
object inventory itself, not independent live usage; counting them would retain
every recorded object indefinitely. `claude_artifacts.source_url` and generated
document citation `sourceUrl` fields are provenance, not live byte ownership.
Brand profile URLs, credential/model endpoint URLs and OCR webhooks
are remote addresses, not stored objects. Profile images and feedback attachments
store their bytes inline rather than referring to the object-storage adapters.

Btree indexes on `document.url` and `document_versions.url` are generated in the
append-only engine migration set; product request/item tables are generated in
the product migration set.

### Provenance and residual legacy risk

Before deletion, a non-null ledger company must match the request company.
Database refs additionally require the existing `file_uploads.company_id` to
match; null and foreign stamps block with `foreign_object`. An already absent
file may safely produce not-found. These checks run before provider invocation,
even if the request acquired a URL from a malicious relational attachment.
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

## Consequences

Documents disappear immediately, independently of provider health. Byte cleanup
is durable and auditable but can remain blocked or quarantined until an operator
resolves it. Shared bytes remain until the last relevant deletion request sees no
live references. A provider may complete just before a database failure; retry
must tolerate already-missing bytes. Existing provider contracts provide that
idempotency. No serving gates, UI polling, or deferred SQL purge are needed.
