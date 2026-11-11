# Runbook: Storage deletion operations

Document and version rows disappear synchronously. Stored bytes are cleaned up
later by the durable `storage.deletion.requested` outbox event. Requests and
items survive document and tenant removal; do not delete these audit records to
clear a backlog. See [ADR-015](../architecture/ADR-015-storage-deletion-lifecycle.md)
and the [reference contract](../storage-ref-contract.md).

Run commands from the repository root with the deployment's `DATABASE_URL` and
storage configuration. They use a direct database connection; the web server does
not need to be running. Both CLIs load the repository-root `.env` quietly; explicit
environment variables win. Stdout is one JSON document; operator audit JSON goes
to stderr. Actors are trimmed, required for writes, and limited to 256 characters.
Object keys are operational data, but credentials are not emitted.

## Inspect the backlog

```sh
pnpm --filter @launchstack/web exec tsx scripts/storage-deletion.ts summary
pnpm --filter @launchstack/web exec tsx scripts/storage-deletion.ts list --status blocked --limit 50
pnpm --filter @launchstack/web exec tsx scripts/storage-deletion.ts list --status pending --company 123 --limit 50
pnpm --filter @launchstack/web exec tsx scripts/storage-deletion.ts show 456
```

`summary` reports request counts by status, item counts by state, the oldest
pending item's age, blocked/quarantined items, and dead deletion outbox rows.
A rising pending age indicates lag or retries; blocked items require a decision,
not simply more time. Dead events and blocked requests are related but not
identical: an event can finish processing a request whose provider refused an
item. A request with a dead event or a pending request whose deterministic event
is missing is operationally blocked even if its persisted status still says
pending: `summary` reports stuck requests and `list --status blocked` includes
them. A missing event is reported as `event_missing`. Inspect the request's item
errors and, when present, the event's `last_error` together. Tenant deletion
cascades outbox rows, but not the deletion audit records; there is currently no
in-product tenant-delete path.

| Item state    | Meaning                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `pending`     | Work remains, including transient failures awaiting outbox retry.                                         |
| `deleted`     | Provider acknowledged deletion. S3/Blob acknowledgements can include already-absent bytes.                |
| `not_found`   | Provider positively confirmed absence.                                                                    |
| `retained`    | A live global reference protects the bytes. This request will not retry them.                             |
| `blocked`     | Ownership, credentials, location, provider refusal, or exhausted outbox attempts require operator action. |
| `quarantined` | The URL identity was ambiguous; no provider ref was invented.                                             |
| `skipped`     | An unrecognized/external URL was not treated as owned storage.                                            |
| `waived`      | An operator accepted that this item will not be deleted by the system; bytes may remain.                  |

Requests are `pending` while any item is pending, otherwise `blocked` if any item
is blocked/quarantined, otherwise `completed`. Waived items count as terminal
success **for request status only**, not proof of byte removal. Completion does
not mean every object was deleted: inspect retained, skipped and waived items.

## Repair and requeue

First fix the cause: restore credentials, configure the correct provider
location, or investigate a provenance mismatch. Never override a company or
location stamp just to make deletion proceed.

```sh
pnpm --filter @launchstack/web exec tsx scripts/storage-deletion.ts requeue 456 --actor operator@example.com --note 'Restored S3 credentials; incident INC-123'
```

Requeue atomically resets retry-budget-exhausted and provider-classified blocked
items to pending with a fresh attempt budget, sets the request pending, and
enqueues/revives its deterministic event using the normal outbox helper.
`foreign_object` provenance blocks are **never requeueable** and are reported as
skipped in the command output; do not clear their error or force them pending.
Deleted, retained, skipped, waived and quarantined items are not reset. If the
event is dead, eligible pending items' attempt/error state is also reset.
Repeating the command after revival does not reset live pending item attempts or
duplicate an active event. A `processing` delivery refuses requeue with “delivery
in flight, retry shortly”; let the current handler finish before retrying.
Completed requests refuse mutation. Affected items durably store `requeued_by`,
`requeue_note` and `requeued_at`, independently of waiver resolution. Delayed
dead callbacks re-read the event under the request lock and cannot undo a
committed requeue.

For `event_missing`, requeue recreates the event only if the stamped company
still exists. If the company has been removed, requeue refuses rather than
inventing a tenant or failing an outbox foreign-key insert. Investigate the
remaining items and use `waive` to record acceptance of residual bytes; restoring
a different company's identity is not recovery.

The [outbox runbook](outbox.md) covers dead rows and stale claims. For storage
cleanup, use this command rather than its raw SQL replay example: replaying only
the event does not reset all blocked item state. Pending deliveries absorb the
reset; processing deliveries refuse it. Do not force-reclaim a healthy active worker.
If the event dies again, inspect its new error before requeueing.

## Waive an item

Waive only after identifying why the object cannot or should not be removed by
this system, and recording a durable explanation (for example an incident or
manual provider cleanup receipt). It is not a workaround for an outage or an
ambiguous ownership claim you have not investigated.

```sh
pnpm --filter @launchstack/web exec tsx scripts/storage-deletion.ts waive 789 --actor operator@example.com --note 'Provider account retired; accepted residual bytes under INC-124'
```

Blocked/quarantined items can be waived. A pending item can also be waived only
when the shared operational check reports its request blocked with `event_missing`
or `event_dead` (including a tenant deletion that removed the outbox row).
Pending items of a live request still refuse waiver. Actor and note are required
in every case. The item stores `resolved_by`, `resolution_note` and `resolved_at`,
preserving its original error details. Its request is recomputed and can complete
if this was its last unresolved item.
Waiving never calls a provider and never marks inventory bytes deleted. An
already-waived item is unchanged when its request remains open; a completed
request refuses even repeated mutations.
If waiver completes a request with a dead event, that event is marked processed
in the same transaction, with `processed_at` set and its last error cleared.
Other event states are left alone; waiver never creates pending work.

## Audit orphaned bytes

The default audit is read-only. Start with a grace period long enough to cover
uploads that have not yet been attached to a document:

```sh
pnpm --filter @launchstack/web exec tsx scripts/storage-orphan-audit.ts --grace-days 7 --out /tmp/storage-orphans.json
pnpm --filter @launchstack/web exec tsx scripts/storage-orphan-audit.ts --grace-days 7 --inventory
```

Population A is undeleted ledger inventory older than the grace cutoff, with no
live reference and no pending/blocked deletion request already covering its URL
or ref. The audit keyset-pages inventory and checks protected URL columns in
set-based SQL per page, sharing the worker's protected-column definition across
all companies, including all three persisted chat-attachment copies, busy OCR
jobs, active/failed batch files and live external-backed database pointers.
Ledgered provider objects use exact canonical URL matching, except rows sourced
from `backfill-file-uploads`: those historical references retain the conservative
parsed alias path, including mixed percent-encoding and live `/api/files` pointers
whose provider URL is an alias. Unledgered provider inventory uses the same legacy
protection. Database `/api/files` paths conservatively protect every origin even
when ledgered. Exact SQL arms are separate from aliases so equality/JSON-containment
indexes can be used. Inventory rows are a superset of successful writes, so known
byte totals are potential reclaimable storage, not proof those bytes still exist.
Unknown sizes are not estimated.

`--inventory` additionally scans population B: paginated `documents/` objects
from the configured S3 bucket and keyset-paged database `file_uploads` ids,
reporting objects absent from the ledger and unused by live rows. It does not
list UploadThing or Vercel Blob. A missing S3 configuration is reported as an
unscanned inventory, not as an empty bucket. Use the reported scan coverage when
interpreting totals. Provider listing requires list permission but does not
require deletion permission. Neither population deletes anything.

Reports group counts and known bytes by population, adapter and location, and
population A additionally by ledger `source` (for example chat uploads versus
document uploads), with bounded key samples. Grace is not a synchronization lock:
references may change
during a scan. Rerun after reviewing the report; do not turn inventory output
into direct provider delete commands.

### Explicitly enqueue population A

```sh
pnpm --filter @launchstack/web exec tsx scripts/storage-orphan-audit.ts --grace-days 7 --enqueue --actor operator@example.com
```

This explicit write mode creates normal `scope: object`, `reason: orphan_audit`
plans and outbox events for population A only. The worker rechecks live
references and provenance before deleting. Rows without a company stamp or whose
stamped company no longer exists remain reported as candidates but are not
enqueued. `ledger.notEnqueueable.count` includes both cases, with separate
`reasonCounts.company_id_null` and `reasonCounts.company_missing` counts in both
read-only and enqueue reports. The enqueue transaction rechecks company existence
and holds `FOR KEY SHARE` on eligible company rows through planner/event insertion,
preventing tenant deletion from racing the outbox foreign key. Ledger pages use
ordered `FOR NO KEY UPDATE` locks to serialize competing audits without blocking
other transactions' deletion-item foreign-key inserts (`FOR KEY SHARE`).
Population B is report-only, including when `--inventory --enqueue` are combined.
Repeated runs exclude objects already covered by active plans. Retained or
waived bytes can appear in later audits because those outcomes do not stamp the
inventory deleted; review their history before accepting another cleanup plan.
`--grace-days` accepts decimal integers only; enqueue additionally requires at
least one day of grace, including when invoked through the server API. If a
later page fails, earlier page transactions stay committed: the CLI exits nonzero
but prints a JSON partial report with `committedRequestIds` and an audit line to
stderr. Inspect those requests before retrying; do not assume the entire run
rolled back.

## Metrics and logs

Scrape the worker's existing HTTP listener at `GET /metrics` (the same configured
`WORKER_PORT` used by `/healthz`). The web process has a different in-memory
registry; `/api/metrics` cannot report counters updated only by the worker.
Configure the same `METRICS_SCRAPE_TOKEN` policy as the web route: send
`Authorization: Bearer <token>` when configured (otherwise 401); production with
no token fails closed with 503 and logs a warning once. Nonproduction may scrape
without a token only when none is configured.

The shared Prometheus registry includes
`pdr_storage_deletion_items_processed_total{outcome}` (committed outcomes, including
retryable attempts), `pdr_storage_deletion_requests_finished_total{status}`
(worker transitions to completed/blocked), `pdr_storage_deletion_pending_items`,
and `pdr_storage_deletion_oldest_pending_age_seconds`. Backlog refresh is
best-effort: database/metric failures log but never fail an outbox attempt.
Gauges refresh after worker processing/dead-letter handling, not continuously;
they can be stale on an idle/stopped process. Counters reset on restart and do
not count operator state changes as provider work. Use `summary` for the
authoritative current database view. No second metrics server or registry exists.

Worker logs include trace/request ids and outcome counts. Operator audit lines
include actor, note and the affected request/item, and are emitted after commit.
Retain these logs with the request/item database audit records.

## Deployment note

The lifecycle table-creation migration and operations CHECK-replacement migration
ship together in this stack, in engine-then-product journal order; do not deploy
the operations migration as an independent pre-lifecycle upgrade. Both generated
CHECK changes target the newly introduced deletion-items table. The subsequent
operator-safety migration adds durable requeue fields and active-plan indexes.
