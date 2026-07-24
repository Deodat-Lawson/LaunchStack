# Pipeline Failure Matrix

> Companion to `[pipeline-architecture.md](./pipeline-architecture.md)`.
> Stage names match that doc. Cite failures by stable ID (e.g. `U7`) in tickets/PRs.

**How to use:** skim the [Index](#index) for backlog (filter **Needs fix**). Open a detail card for mechanics and left-behind state.

---

## Conventions


| Field            | Meaning                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**           | Stable prefix + number. Prefixes: `U` Upload/dispatch · `A` Route · `B` OCR · `C` Chunk · `D` Embed/store · `E` Finalize · `F` GraphRAG · `G` Neo4j · `M` Company metadata · `N` Notes rehydrate · `X` Cross-cutting |
| **Dependency**   | External system involved, or `—` if in-process                                                                                                                                                                       |
| **Failure mode** | One concrete scenario (not a category)                                                                                                                                                                               |
| **Status**       | **Working as intended** · **Needs fix (High|Mid|Low)** · **Needs discussion**                                                                                                                                        |


Detail cards also record **What happens**, **Left behind** (state + how you’d notice), and **Notes**.

---

## Index


| ID        | Stage             | Dependency                | Failure mode                                              | Status              |
| --------- | ----------------- | ------------------------- | --------------------------------------------------------- | ------------------- |
| [U1](#u1) | Upload / dispatch | Rate limiter              | Caller exceeds `RateLimitPresets.strict`                  | Working as intended |
| [U2](#u2) | Upload / dispatch | —                         | Malformed JSON or missing required fields                 | Working as intended |
| [U3](#u3) | Upload / dispatch | Postgres                  | `userId` not found / active-company resolve errors        | Working as intended |
| [U4](#u4) | Upload / dispatch | Postgres (credits)        | Insufficient credits masked as generic 500                | Needs fix (Low)     |
| [U5](#u5) | Upload / dispatch | Object storage + Postgres | `document` insert fails; upstream blob orphaned           | Needs discussion    |
| [U6](#u6) | Upload / dispatch | Postgres                  | `createInitialVersion` fails after `document` committed   | Needs fix (Mid)     |
| [U7](#u7) | Upload / dispatch | Inngest                   | Dispatch throws after `document`+version committed        | Needs fix (High)    |
| [U8](#u8) | Upload / dispatch | Inngest + Postgres        | Event dispatched before / without durable `ocr_jobs` row  | Needs fix (High)    |
| [U9](#u9) | Upload / dispatch | Postgres + Inngest        | Client retry or concurrent upload creates duplicate trees | Needs discussion    |

| ID        | Stage             | Dependency                | Failure mode                                              | Status              |
| --------- | ----------------- | ------------------------- | --------------------------------------------------------- | ------------------- |
| [D1](#u1) | Embed / Store | Embedding Provider (OpenAI or external sidecar `/embed`)              |                   |  |
| [D2](#u2) | Embed / Store | Postgres + pgvector (`storeBatch`)                         |                 |  |
| [D3](#u3) | Embed / Store | Postgres structure/metadata writes                 |         |  |

| ID        | Stage             | Dependency                | Failure mode                                              | Status              |
| --------- | ----------------- | ------------------------- | --------------------------------------------------------- | ------------------- |
| [E1](#u1) | Finalize | Postgres finalize path (`finalizeStorage`)              |                   |  |
| [E2](#u2) | Finalize | Status model (`onFailure` + runtime flags)                         |                 |  |


| ID        | Stage             | Dependency                | Failure mode                                              | Status              |
| --------- | ----------------- | ------------------------- | --------------------------------------------------------- | ------------------- |
| [F1](#u1) | GraphRAG | External sidecar health (`SIDECAR_URL/health`)              |                   |  |
| [F2](#u2) | GraphRAG | Entity extraction + Postgres `kg_*` writes                         |                 |  |


| ID        | Stage             | Dependency                | Failure mode                                              | Status              |
| --------- | ----------------- | ------------------------- | --------------------------------------------------------- | ------------------- |
| [G1](#u1) | Neo4j | Neo4j availability/config (`NEO4J_URI`, config, health)              |                   |  |
| [G2](#u2) | Neo4j | Neo4j write operation (`syncDocumentToNeo4j`)                         |                 |  |

---

## Upload / dispatch

> Scope: `POST /api/uploadDocument` → validation → `document` / `document_versions` / `ocr_jobs` → Inngest event. Stops at handoff to Step A.
>
> **Structural note:** all three DB writes run in the HTTP handler **before** `process-document`, so they are **not** in `step.run` (no Inngest memoization). No transaction spans the three tables: `document` insert (`[create-document.ts:29](../../apps/web/src/server/services/create-document.ts#L29)`), then `document_versions` + `currentVersionId` (`[document-upload.ts:88](../../apps/web/src/server/services/document-upload.ts#L88)`), then `ocr_jobs` (`[trigger-job.ts:50](../../apps/web/src/server/services/trigger-job.ts#L50)`). The event is dispatched **before** the `ocr_jobs` insert (`[trigger.ts:92](../../packages/core/src/ocr/trigger.ts#L92)`).

### U1

**Caller exceeds `RateLimitPresets.strict`** · Rate limiter · Working as intended

- **What happens:** `withRateLimit` returns 429 + `Retry-After` before the handler body (`[rate-limit-middleware.ts:60](../../apps/web/src/lib/rate-limit-middleware.ts#L60)`).
- **Left behind:** Nothing. Loud 429 to caller.
- **Notes:** Limiter is in-memory; multi-instance behavior not verified.

### U2

**Malformed JSON or missing/blank `userId` / `documentUrl` / `documentName`** · — · Working as intended

- **What happens:** `validateRequestBody` returns 400 before any write (`[route.ts:45](../../apps/web/src/app/api/uploadDocument/route.ts#L45)`).
- **Left behind:** Nothing. Loud 400 with field detail.
- **Notes:** Route uses an inline Zod schema (`[route.ts:24](../../apps/web/src/app/api/uploadDocument/route.ts#L24)`) that differs from the exported `UploadDocumentSchema` in `validation.ts` (`.min(1)` vs `.url()`). Worth reconciling.

### U3

`**userId` not found or active-company cookie/DB errors** · Postgres · Working as intended

- **What happens:** Unknown user → 400 "Invalid user" (`[route.ts:67](../../apps/web/src/app/api/uploadDocument/route.ts#L67)`). Thrown DB/cookie errors in `resolveActiveCompanyForUser` → route catch → generic 500.
- **Left behind:** Nothing (both paths run before the first write). Loud 400/500 + `console.error`.
- **Notes:** Missing membership does not throw (falls back to default company); only raw DB/cookie failure throws.

### U4

**Insufficient credits in cloud mode** · Postgres (credits) · Needs fix (Low)

- **What happens:** `hasTokens` false → throw with a clear message (`[document-upload.ts:145](../../apps/web/src/server/services/document-upload.ts#L145)`), but the route catch replaces it with `{error:"Failed to start document processing"}` 500 (`[route.ts:102](../../apps/web/src/app/api/uploadDocument/route.ts#L102)`). Check runs before any write.
- **Left behind:** Nothing. Caller sees a misleading 500; real reason only in server logs.
- **Notes:** UX-only. Prefer surfacing credits (e.g. 402). Confirm no callers depend on the generic shape.

### U5

`**document` insert fails after client already uploaded bytes** · Object storage + Postgres · Needs discussion

- **What happens:** `createDocumentRecord` throws → route catch → 500. Nothing committed for this doc.
- **Left behind:** No `document` / `document_versions` / `ocr_jobs`. Upstream storage object may be **orphaned** (client uploaded before this call). 500 is loud; orphan blob is silent.
- **Notes:** No blob GC for register failures. How common is upload-then-fail-register?

### U6

`**createInitialVersion` fails after `document` insert committed** · Postgres · Needs fix (Mid)

- **What happens:** Version insert + `currentVersionId` update share a transaction and roll back together; the earlier `document` insert does not (`[document-upload.ts:88](../../apps/web/src/server/services/document-upload.ts#L88)`). Route catch → 500.
- **Left behind:** Orphan `document` with `currentVersionId=NULL`, `ocrProcessed=false`; no version, no `ocr_jobs`, no event. Never processes. 500 to caller; orphan only findable via `currentVersionId IS NULL` and no job.
- **Notes:** Low probability (same DB, back-to-back) but structural. Wrap `document` + v1 version in one transaction.

### U7

`**dispatcher.dispatch` throws after `document`+version committed** · Inngest · Needs fix (High)

- **What happens:** `triggerDocumentProcessing` wraps + rethrows (`[trigger.ts:103](../../packages/core/src/ocr/trigger.ts#L103)`); `ocr_jobs` insert never reached; route catch → 500.
- **Left behind:** `document` + `document_versions` committed; **no** `ocr_jobs`, **no** event. Looks pending (`ocrProcessed=false`) forever. Loud at request time; stranded doc silent afterward.
- **Notes:** Classic dispatch-after-commit gap. No outbox/retry. Client retry of the 500 can also produce [U9](#u9) duplicates.

### U8

**Event dispatched before / without a durable `ocr_jobs` row** · Inngest + Postgres · Needs fix (High)

- **What happens:** Event is sent first; then `db.insert(ocrJobs)` may throw → 500 with event already in flight (`[trigger-job.ts:50](../../apps/web/src/server/services/trigger-job.ts#L50)`). Same ordering also creates a success-path race (worker starts before the insert commits).
- **Left behind:** `document` + version committed; often **no** `ocr_jobs`. Worker still runs: `savePipelineState` SELECT-then-UPDATE is a silent no-op on a missing row; `loadPipelineState` later throws. Permanent insert failure → retries keep failing. Transient race → Inngest retries usually recover once the row exists (worst case: wasted OCR on attempt 1).
- **Notes:** Insert `ocr_jobs` **before** dispatch, or use an outbox after commit.

### U9

**Client retries the POST, or concurrent uploads of the same file** · Postgres + Inngest · Needs discussion

- **What happens:** No idempotency key and no unique constraint on `(companyId, url)`. Each request creates a new `document` + v1 version + `ocr_jobs` + event. Writes are pre-Inngest, so memoization does not apply.
- **Left behind:** Duplicate document trees; file processed 2× (double work/credits). Silent — no constraint violation.
- **Notes:** Re-upload may be intended product behavior. Sharp case: [U7](#u7) 500 after commit → client retry → duplicates. Concurrent same-file uploads don’t collide on `versionNumber=1` because each gets a distinct `documentId`.

