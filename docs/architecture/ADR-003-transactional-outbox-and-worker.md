# ADR-003: Transactional Outbox and `apps/worker` as the Sole Durable Coordinator

**Status:** Accepted
**Date:** 2026-08-09
**Deciders:** Repository maintainers

## Context

Document ingestion today is dispatched from `apps/web`:
`createDocumentLifecycle` commits a transaction (document + documentVersions +
ocrJobs) and then calls `inngest.send` **after** the commit. A crash between
commit and send strands `ocr_jobs` rows in `queued` forever — there is no
reconciler (`docs/pipeline/pipeline-architecture.md` documents this as “the
dispatcher is not an outbox”). Twelve Inngest functions served from
`/api/inngest` inside the Next.js app perform all durable work, capped at
Vercel's `maxDuration`. Several routes additionally run minutes-long work
synchronously in request handlers (video download + transcription, GitHub
zipball download, batch commit fan-out), and three code paths use
fire-and-forget `void` promises for durable writes (note link sync, note
embedding, collab persistence).

One correct transactional outbox already exists in this repository:
`founder_weekly_review_dispatches` (unique `event_id` idempotency key,
`FOR UPDATE SKIP LOCKED` claims, bounded attempts with backoff, a five-minute
reconciler). Per the mapping in `docs/architecture/current-infrastructure-map.md`
and the pipeline failure matrix, that is the pattern to generalize rather than
inventing a second one.

## Decision

1. **Add a generic engine-owned outbox table** `pdr_ai_v2_event_outbox`
   (additive migration in the engine set): unique `event_id` (deterministic
   idempotency key), `event_type`, `schema_version`, `company_id`, `payload`
   (validated against `packages/protocol`), `trace_id`, `status`
   (`pending → processing → processed | dead`; a failed attempt returns the
   row to `pending` with backoff until attempts are exhausted), `attempt_count`,
   `available_at`, `claimed_at`, `processed_at`, `last_error`.
2. **Write commands and events in one transaction.** The upload/import
   lifecycle inserts its `source.version.created` outbox row inside the same
   transaction that creates the source version. The post-commit
   `inngest.send` for ingestion is removed.
3. **Create `apps/worker`** — a long-running Node process and the only durable
   workflow coordinator. It:
   - claims outbox batches with `FOR UPDATE SKIP LOCKED`, bounded retries
     (max 8 attempts, exponential backoff via `available_at`), and a stuck-row
     reclaimer for crashed claims;
   - executes the pipeline through `packages/application` use cases, calling
     compute services through typed ports with timeouts and trace-ID headers;
   - emits the next pipeline event in the same transaction that records the
     current stage's completion (event chaining is itself transactional);
   - exposes `/healthz` and `/readyz`, emits structured JSON logs with
     `trace_id`, and shuts down gracefully on SIGTERM;
   - hosts the Inngest serve endpoint for the remaining non-ingestion durable
     jobs (trend search, client prospector, founder weekly review, predictive
     analysis, website crawl, document modify, reindex), which move here from
     `apps/web` unchanged. `apps/web` keeps only `inngest.send` for those
     verticals — command acceptance, not execution.
4. **Versioned events.** The pipeline emits, at minimum:
   `source.version.created` → `evidence.version.extracted` →
   `evidence.version.indexed` → `company.state.projected`, all defined in
   `packages/protocol` with `schemaVersion`, and all consumers idempotent
   (keyed on deterministic `event_id`s; handlers converge on re-delivery).
   Auxiliary events (e.g. `note.embedding.requested`) use the same envelope.
5. **Replay** is an operational action documented in
   `docs/runbooks/outbox.md`: re-setting a `dead`/`processed` row to `pending`
   re-runs the handler; handlers are required (and tested) to be idempotent.

## Consequences

- The crash window between commit and dispatch disappears for ingestion; the
  stuck-`queued` failure class in the pipeline failure matrix is closed.
- Local Docker Compose gains a `worker` service; `inngest-dev` now polls the
  worker, not the app. Deployments that ran only the Vercel app must add a
  worker process to process uploads — documented in `docs/deployment.md`
  (breaking topology change, intentional and required by the product
  boundary: web accepts commands and serves reads only).
- The fire-and-forget note-embedding path becomes an outbox event; the legacy
  `document/process.requested` Inngest function is removed (its behavior is
  the worker's `source.version.created` handler).
- `founder_weekly_review_dispatches` stays as-is (already correct); a later
  consolidation onto the generic outbox is possible but not required.
