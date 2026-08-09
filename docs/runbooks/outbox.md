# Runbook: Ingestion Outbox Operations

The ingestion pipeline (ADR-003) is driven by `pdr_ai_v2_event_outbox`.
`apps/web` writes a `source.version.created` row in the same transaction as
the source version; `apps/worker` claims rows, runs handlers, and chains the
next event transactionally. This runbook covers observing and repairing it.

## Health signals

- `GET :8020/healthz` — worker process is up.
- `GET :8020/readyz` — DB reachable; response includes `deadOutboxEvents`.
  A non-zero count means events exhausted their 8 attempts and need an
  operator decision.
- Worker logs are JSON lines; filter by `traceId` to follow one upload
  end-to-end (web → outbox → worker → compute service).

## Inspecting the outbox

```sql
-- Queue depth by state
SELECT status, count(*) FROM pdr_ai_v2_event_outbox GROUP BY status;

-- Dead events with their errors
SELECT event_id, event_type, company_id, attempt_count, last_error, updated_at
FROM pdr_ai_v2_event_outbox WHERE status = 'dead' ORDER BY updated_at DESC;

-- Everything for one trace
SELECT event_id, event_type, status, attempt_count, last_error
FROM pdr_ai_v2_event_outbox WHERE trace_id = '<traceId>' ORDER BY id;
```

## Replaying an event

Handlers are idempotent (content-hash dedup, upserts, deterministic event
ids), so replay converges rather than duplicating work:

```sql
UPDATE pdr_ai_v2_event_outbox
SET status = 'pending', available_at = CURRENT_TIMESTAMP, claimed_at = NULL
WHERE event_id = '<eventId>';
```

The worker picks the row up on its next poll (default ≤2s). Replaying
`source.version.created` re-runs extraction AND, via chaining, indexing and
projection. Replaying a later stage re-runs only that stage onward.

Re-uploading the same file (same creation key) does the same thing through
the product: the lifecycle revives a dead event automatically.

## Stuck `processing` rows

A worker killed mid-handler leaves rows in `processing`. The reclaimer
returns claims older than `OUTBOX_STALE_CLAIM_MS` (default 30 min) to
`pending` automatically. If you must force it:

```sql
UPDATE pdr_ai_v2_event_outbox
SET status = 'pending', claimed_at = NULL
WHERE status = 'processing' AND claimed_at < now() - interval '30 minutes';
```

Never do this while the claiming worker is still alive and mid-handler — you
get a concurrent duplicate run. It converges (idempotent handlers), but
wastes compute.

## When an event is dead

1. Read `last_error`. Converter/transcription unreachable → fix the service,
   then replay. Contract-validation failures (`payload failed protocol
   validation`) mean a producer bug — fix code first; replay will not help.
2. The matching `pdr_ai_v2_ocr_jobs` row was marked `failed` with the same
   error (failure visibility) — the product UI shows the document as failed.
3. After fixing the cause, replay (above). The job returns to `processing`
   and, on success, `completed`.

## Tuning

Worker env (validated at startup, `apps/worker/src/env.ts`):
`OUTBOX_BATCH_SIZE` (10), `OUTBOX_IDLE_POLL_MS` (2000),
`OUTBOX_STALE_CLAIM_MS` (30 min), `OUTBOX_RECLAIM_INTERVAL_MS` (60s).
Retry policy is code (`DEFAULT_RETRY_POLICY`): 8 attempts, 30s base
exponential backoff capped at 1h.
