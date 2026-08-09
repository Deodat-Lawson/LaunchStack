# Pipeline Failure Matrix

> Companion to `[pipeline-architecture.md](./pipeline-architecture.md)`.
> Stage names match that doc. Cite failures by stable ID (e.g. `U7`) in tickets/PRs.

**How to use:** skim the [Index](#index) for unresolved backlog (filter **Needs fix**). Resolved lifecycle invariants are retained below as regression contracts; remaining operational limitations stay explicitly labeled.

---

## Conventions

| Field            | Meaning                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------- |
| **ID**           | Stable prefix + number. Prefixes: `U` Upload/dispatch · `A` Route · `B` OCR · `C` Chunk · `D` Embed/store · `E` Finalize · `F` GraphRAG · `G` Neo4j · `M` Company metadata · `N` Notes rehydrate · `X` Cross-cutting |
| **Dependency**   | External system involved, or `—` if in-process                                                                                                                                                                       |
| **Failure mode** | One concrete scenario (not a category)                                                                                                                                                                               |
| **Status**       | **Working as intended** · \*\*Needs fix (High                                                                                                                                                                        | Mid | Low)** · **Needs discussion\*\* |

Detail cards also record **What happens**, **Left behind** (state + how you’d notice), and **Notes**.

---

## Index

| ID        | Stage             | Dependency                | Failure mode                                                      | Status              |
| --------- | ----------------- | ------------------------- | ----------------------------------------------------------------- | ------------------- |
| [U1](#u1) | Upload / dispatch | Rate limiter              | Caller exceeds `RateLimitPresets.strict`                          | Working as intended |
| [U2](#u2) | Upload / dispatch | —                         | Malformed JSON or missing required fields                         | Working as intended |
| [U3](#u3) | Upload / dispatch | Postgres                  | `userId` not found / active-company resolve errors                | Working as intended |
| [U4](#u4) | Upload / dispatch | Postgres (credits)        | Insufficient credits masked as generic 500                        | Needs fix (Low)     |
| [U5](#u5) | Upload / dispatch | Object storage + Postgres | `document` insert fails; upstream blob orphaned                   | Needs discussion    |
| [U6](#u6) | Upload / dispatch | Postgres                  | Initial lifecycle write fails inside the Document Creation Module | Working as intended |
| [U7](#u7) | Upload / dispatch | Job dispatcher            | Dispatch fails after the lifecycle transaction commits            | Working as intended |
| [U8](#u8) | Upload / dispatch | Inngest + Postgres        | Dispatch could run before a durable, version-linked job exists    | Working as intended |
| [U9](#u9) | Upload / dispatch | Postgres + Inngest        | Retry or concurrent request repeats the same logical upload       | Working as intended |

| ID        | Stage | Dependency                    | Failure mode                                                                            | Status                  |
| --------- | ----- | ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| [A1](#a1) | Route | ocr-router sidecar (external) | Sidecar unreachable/non-200 → silent fallback provider, `pageCount` forced to `0`       | Needs fix (Medium-High) |
| [A2](#a2) | Route | Object storage + `pdf-lib`    | `getPageCount` fails, silently defaults to page count `1`                               | Needs discussion (Low)  |
| [A3](#a3) | Route | —                             | Invalid/unrecognized `preferredProvider` silently ignored, falls back to auto-detection | Working as intended     |

| ID        | Stage           | Dependency                             | Failure mode                                                                       | Status                 |
| --------- | --------------- | -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| [B1](#b1) | OCR / Normalize | Object storage + `pdfjs-serverless`    | `processNativePDF` throws on storage-download failure or corrupted/unparseable PDF | Needs fix (High)       |
| [B2](#b2) | OCR / Normalize | Object storage (HEAD request)          | Content-type sniffing for non-`.pdf`-named URLs fails silently                     | Needs discussion (Low) |
| [B3](#b3) | OCR / Normalize | —                                      | Unrecognized `selectedProvider` silently falls back to native PDF extraction       | Working as intended    |
| [B4](#b4) | OCR / Normalize | Azure Document Intelligence (external) | 5 unhandled throw points + 120s poll timeout                                       | Needs fix (High)       |
| [B5](#b5) | OCR / Normalize | ocr-worker service (self-hosted)       | Unreachable, 10-min timeout, or non-200 response                                   | Needs fix (High)       |

| ID        | Stage | Dependency                     | Failure mode                                                                       | Status                             |
| --------- | ----- | ------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------- |
| [C1](#c1) | Chunk | —                              | `chunkDocument` / `chunkCodeFile` throws on malformed or unexpected page content   | Needs fix (High)                   |
| [C2](#c2) | Chunk | Postgres                       | `loadPipelineState` throws when `"pages"` key is missing from `ocr_jobs.ocrResult` | Needs discussion (Low probability) |
| [C3](#c3) | Chunk | Postgres                       | `savePipelineState`'s read-then-write on `ocrResult` is not atomic                 | Needs discussion                   |
| [C4](#c4) | Chunk | OpenAI (via `getOpenAIClient`) | Table-description LLM call fails or is unconfigured                                | Working as intended                |

| ID        | Stage         | Dependency                                               | Failure mode                                                             | Status           |
| --------- | ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------- |
| [D1](#d1) | Embed / Store | Embedding Provider (OpenAI or external sidecar `/embed`) | Embedding call fails in embedDocuments/embedQuery during step-d-batch-\* | Needs fix (high) |
| [D2](#d2) | Embed / Store | Postgres + pgvector (`storeBatch`)                       | Batch write fails after vectors computed; pipeline retries whole run     | Needs Discussion |
| [D3](#d3) | Embed / Store | Postgres (`documentContextChunks` readback)              | Readback query fails or returns partial set used for downstream GraphRAG | Needs Discussion |

| ID        | Stage    | Dependency                                                        | Failure mode                                                                           | Status           |
| --------- | -------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------- |
| [E1](#e1) | Finalize | Postgres finalize path (`finalizeStorage`)                        | Finalize throws after successful embed/store                                           | Needs fix (high) |
| [E2](#e2) | Finalize | Failure/status model (`markFailureInDb`, Inngest retry semantics) | Non-Inngest path can return failure result without DB failure mark unless flag enabled | Needs Discussion |

| ID        | Stage    | Dependency                                     | Failure mode                                                                             | Status                  |
| --------- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| [F1](#f1) | GraphRAG | External sidecar health (`SIDECAR_URL/health`) | Sidecar unhealthy causes silent skip of entity extraction                                | Needs Discussion        |
| [F2](#f2) | GraphRAG | Entity extraction + Postgres `kg_*` writes     | `extractAndStoreEntities` throws; optional stage fails hard and can fail whole ingestion | Needs fix (Medium-High) |

| ID        | Stage | Dependency                                              | Failure mode                                            | Status              |
| --------- | ----- | ------------------------------------------------------- | ------------------------------------------------------- | ------------------- |
| [G1](#g1) | Neo4j | Neo4j availability/config (`NEO4J_URI`, config, health) | Neo4j absent/unconfigured/unhealthy silently skips sync | Working as intended |
| [G2](#g2) | Neo4j | Neo4j write operation (`syncDocumentToNeo4j`)           | Sync throws and fails whole pipeline after finalize     | Needs Discussion    |

---

## Upload / dispatch

> Scope: `POST /api/uploadDocument` → validation → Document Creation Module → committed lifecycle → post-commit job dispatch. Stops at handoff to Step A.
>
> **Structural note:** the Module is the lifecycle seam for active intake, including ZIP children and the generated archive summary. One transaction writes `document`, the v1 `document_versions` row and `currentVersionId`, and its linked `ocr_jobs` row. A stable `creationKey` converges retries and concurrency; dispatch runs only after commit with the same stable `jobId` and required `versionId` (`[document-creation.ts:93](../../apps/web/src/server/services/document-creation.ts#L93)`, `[trigger.ts:55](../../packages/core/src/ocr/trigger.ts#L55)`). The dispatcher is not an outbox: if remote acceptance is ambiguous, retry with the stable event ID and rely on runner dedupe.

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

`**userId` not found or active-company cookie/DB errors\*\* · Postgres · Working as intended

- **What happens:** Unknown user → 400 "Invalid user" (`[route.ts:67](../../apps/web/src/app/api/uploadDocument/route.ts#L67)`). Thrown DB/cookie errors in `resolveActiveCompanyForUser` → route catch → generic 500.
- **Left behind:** Nothing (both paths run before the first write). Loud 400/500 + `console.error`.
- **Notes:** Missing membership does not throw (falls back to default company); only raw DB/cookie failure throws.

### U4

**Insufficient credits in cloud mode** · Postgres (credits) · Needs fix (Low)

- **What happens:** `hasTokens` false → throw with a clear message (`[document-upload.ts:145](../../apps/web/src/server/services/document-upload.ts#L145)`), but the route catch replaces it with `{error:"Failed to start document processing"}` 500 (`[route.ts:102](../../apps/web/src/app/api/uploadDocument/route.ts#L102)`). Check runs before any write.
- **Left behind:** Nothing. Caller sees a misleading 500; real reason only in server logs.
- **Notes:** UX-only. Prefer surfacing credits (e.g. 402). Confirm no callers depend on the generic shape.

### U5

`**document` insert fails after client already uploaded bytes\*\* · Object storage + Postgres · Needs discussion

- **What happens:** `createDocumentRecord` throws → route catch → 500. Nothing committed for this doc.
- **Left behind:** No `document` / `document_versions` / `ocr_jobs`. Upstream storage object may be **orphaned** (client uploaded before this call). 500 is loud; orphan blob is silent.
- **Notes:** No blob GC for register failures. How common is upload-then-fail-register?

### U6

**Initial lifecycle write fails inside the Document Creation Module** · Postgres · Working as intended

- **What happens:** `createDocumentLifecycle` wraps the `document`, v1 `document_versions`/`currentVersionId`, and linked `ocr_jobs` writes in one transaction. A failure rolls back the complete lifecycle before the caller receives the error.
- **Left behind:** No partial document/version/job tree from this path. An already-uploaded blob can still be orphaned as described in [U5](#u5).
- **Notes:** Resolved by the transactional Module. The legacy repair script remains for rows created before this invariant existed.

### U7

**Dispatch fails after the lifecycle transaction commits** · Job dispatcher · Working as intended

- **What happens:** Dispatch runs after the transaction commits. A dispatcher error is returned to the caller and the linked job is marked `failed` with the error, so the same lifecycle can be retried.
- **Left behind:** The document, current version, and job remain linked; there is no stranded document or missing job. The remote event may or may not have been accepted.
- **Notes:** The persistence invariant is fixed, but this is not atomic network delivery: dispatch is not an outbox. When acceptance is ambiguous, retry the same stable event ID and rely on runner dedupe.

### U8

**Dispatch could run before a durable, version-linked job exists** · Inngest + Postgres · Working as intended

- **What happens:** The Module commits the linked `ocr_jobs` row before post-commit dispatch. The event carries the stable `jobId` and required `versionId`; the worker cannot start from this path without a durable job and explicit version.
- **Left behind:** A dispatch failure has the explicit retryable-job state described in [U7](#u7), not an event racing a missing row. An ambiguously accepted event is handled by stable event-ID retry/dedupe.
- **Notes:** Job-before-dispatch and strict version propagation close the prior race and version-mixing gaps. This does not add an outbox.

### U9

**Retry or concurrent request repeats the same logical upload** · Postgres + Inngest · Working as intended

- **What happens:** Active intake supplies a stable `creationKey`; the Module's unique key and transaction converge retries/concurrency on one document, version, and job. Dispatch reuses the stable job/event identity rather than creating a second tree.
- **Left behind:** No duplicate lifecycle tree or duplicate processing for the same logical request. A caller that intentionally supplies a different logical key still creates a new upload.
- **Notes:** This also resolves archive lifecycle gaps: ZIP children use normalized-entry keys and the generated summary uses its own stable key, and both go through the Module with strict `versionId` propagation.

### A1

Sidecar unreachable/non-200 → silent fallback provider, `pageCount` forced to `0` · ocr-router sidecar (external) · Needs fix (Medium-High)

- What happens: `determineDocumentRouting` (`[complexity.ts:L?]`) wraps its sidecar call in its own try/catch. On any failure it logs a warning and returns a synthetic fallback: a static provider from `getDefaultOCRProvider()` (env-config only, no document inspection), `confidence: 0.5`, `pageCount: 0`. Never throws to its caller.
- Left behind: No error surfaces anywhere except a log line. Routing quality silently degrades (no vision-based complexity detection) for every document processed during an outage. `pageCount: 0` flows into `createRootStructure`'s `endPage` field downstream.
- Notes: Opposite failure shape from the fail-hard stages — degrades silently instead of getting stuck. Worth discussing whether `pageCount: 0` was intentional and whether degraded routing should be surfaced somewhere.

### A2

`getPageCount` fails, silently defaults to page count `1` · Object storage + pdf-lib · Needs discussion (Low)

- What happens: `getPageCount` (`[processor.ts:L?]`) wraps the PDF page-count read in try/catch. On failure, logs a warning and returns `1`. Only runs on the explicit `preferredProvider` branch of `routeDocument`.
- Left behind: No error surfaces; a document with any real page count could get silently recorded with `totalPages: 1` downstream.
- Notes: Low severity alone, but a silent data-correctness gap. Worth confirming whether wrong page counts affect anything downstream (search, UI, credit calculations).

### A3

Invalid/unrecognized `preferredProvider` value silently ignored, falls back to auto-detection · — · Working as intended

- What happens: `routeDocument`'s entry check (`preferred === "NATIVE_PDF" || isValidOCRProvider(preferred)`) simply evaluates false for a bad value and falls through to auto-detection — no error, no warning.
- Left behind: Caller gets no feedback that their explicit preference was ignored.
- Notes: Likely fine as-is, but worth flagging since a typo'd provider name fails completely silently.

### B1

`processNativePDF` throws on storage-download failure or corrupted/unparseable PDF · Object storage + pdfjs-serverless · Needs fix (High)

- What happens: No error handling anywhere in `processNativePDF` (`[processor.ts:L?]`). Failed download throws explicitly; malformed PDF causes `pdfjs-serverless`'s `getDocument(...).promise` to reject. Propagates unhandled to the outer pipeline catch → Inngest retry (5×) → `onFailure`.
- Left behind: `ocr_jobs.status` stuck at `queued`; `document.ocrProcessed` incorrectly set `true` after retries exhaust; real error only in `ocrMetadata`.
- Notes: Also reachable indirectly via the provider-switch `default` case (unrecognized provider falls back to `processNativePDF`), which could hit this on non-PDF content. Cross-reference with B3.

### B2

Content-type sniffing for non-`.pdf`-named URLs fails silently · Object storage (HEAD request) · Needs discussion (Low)

- What happens: `normalizeDocument`'s `isPdf` check falls back to `.catch(() => false)` on a HEAD request if the URL doesn't literally end in `.pdf`.
- Left behind: A real PDF served without a `.pdf` extension could silently lose VLM-enrichment eligibility if the HEAD check fails.
- Notes: Low stakes since VLM enrichment is already optional.

### B3

Unrecognized `selectedProvider` silently falls back to native PDF extraction · — · Working as intended

- What happens: `normalizeDocument`'s provider `switch` default case logs a warning and calls `processNativePDF` regardless of actual file type.
- Left behind: Could cascade into B1 if the content isn't actually a valid PDF.
- Notes: Cross-reference with B1.

### B4

Azure Document Intelligence adapter fails: missing credentials, fetch-document failure, submit failure, poll failure, or 120s poll timeout · Azure Document Intelligence (external) · Needs fix (High)

- What happens: `AzureDocumentIntelligenceAdapter` (`[azureAdapter.ts:L?]`) throws unhandled at five distinct points — none locally caught. Includes a manual 60-poll × 2s (120s total) timeout that throws if Azure never resolves.
- Left behind: Same "queued forever" signature as B1.
- Notes: Two stacked timeout layers — Azure's own 120s internal timeout vs. Inngest's 120-minute function timeout. Worth checking whether re-polling for 120s on each of 5 Inngest retries is an efficient use of the retry budget.

### B5

Self-hosted OCR worker (Marker/Docling) unreachable, times out (10 min), or returns non-200 · ocr-worker service (self-hosted) · Needs fix (High)

- What happens: `OssOCRAdapter.uploadDocument` (`[ossAdapter.ts:L?]`) wraps fetch in try/catch; network failure or the 10-minute `AbortController` timeout throws a rewrapped error; non-OK response also throws. Nothing swallowed.
- Left behind: Same signature as B1/B4.
- Notes: Third provider implementation confirming the same fail-hard shape across native PDF, Azure, and OSS worker. Landing.AI/Datalab assumed consistent but not independently verified.

### X1

`MARKER` provider is dead code / mislabeled as `DOCLING` · — · Needs fix (Medium — correctness bug)

- What happens: `processor.ts`'s provider switch routes both `"MARKER"` and `"DOCLING"` cases to `processWithDocling`; separately, `createMarkerAdapter` in `ossAdapter.ts` hardcodes `"DOCLING"` regardless of intent.
- Left behind: No crash — any document routed to "MARKER" is silently processed via Docling instead. Invisible without reading source.
- Notes: Not a failure/retry issue — a genuine functional bug found while tracing. Flag to whoever owns OCR provider config.

### C1

`chunkDocument` / `chunkCodeFile` throws on malformed or unexpected page content · — · Needs fix (High)

- What happens: No error handling in `chunkPages` or `chunkDocument`. Any throw propagates to `step-c-chunking` → outer catch → Inngest retry cycle.
- Left behind: Same "queued forever" signature.
- Notes: Exact trigger conditions unverified — would need deeper read of edge cases in `chunker.ts`/`code-chunker.ts`.

### C2

`loadPipelineState` throws when `"pages"` key is missing from `ocr_jobs.ocrResult` · Postgres · Needs discussion (Low probability)

- What happens: Explicit, deliberate throw if the expected state key isn't present. Not retried by `withDbRetry` (not a transient DB error) — only Inngest's step retry governs recovery.
- Left behind: Same fail-hard signature if retries exhaust; unlikely in practice given sequential step execution.
- Notes: Confirm with the team whether any realistic scenario (replay, race, manual re-trigger) could actually hit this.

### C3

`savePipelineState`'s read-then-write on `ocrResult` is not atomic · Postgres · Needs discussion

- What happens: Reads current JSON blob, merges new key locally, writes whole object back — a classic lost-update race if ever concurrent.
- Left behind: Unlikely under normal sequential Inngest execution; latent risk rather than confirmed bug.
- Notes: Worth discussing given it sits in some tension with the architecture doc's idempotency claims.

### C4

Table-description LLM call fails or is unconfigured · OpenAI (via getOpenAIClient) · Working as intended

- What happens: `generateTableDescription` computes a rule-based fallback first, then wraps the optional OpenAI call in try/catch; any failure or missing config falls back cleanly.
- Left behind: Nothing — chunking proceeds with a less-polished but usable description.
- Notes: Good positive example of deliberate fail-soft design, worth citing in review. One unverified loose thread: `getOpenAI()` is called outside the try block — if `getOpenAIClient()` can itself throw rather than return `null`, that path is unprotected.

### D1

Embedding provider call fails during vectorization · Embedding provider (OpenAI or external index backend) · Needs fix (High)

- What happens: In `vectorizeWithIndex`, each `step-d-batch-*` calls `embeddings.embedDocuments?.(...) ?? Promise.all(...embedQuery...)`. Any throw bubbles up and fails the ingestion run.
- Left behind: `rootStructure` may already exist from `step-d-setup`; some earlier batches may already be stored, later ones not. On retry, duplicate/partial-write behavior depends on `storeBatch` idempotency (not enforced in this file).
- Notes: Failure occurs after chunking, so retries can re-run expensive work.

### D2

`storeBatch` write failure after successful embedding for a batch · Postgres + pgvector (`storeBatch`) · Needs discussion

- What happens: A batch can successfully produce vectors, then fail on `storeBatch(...)`, causing step failure.
- Left behind: Prior batches may already be committed; current/remaining batches missing. Retry may re-embed and may duplicate previous rows if no uniqueness/idempotency guard exists in storage layer.
- Notes: Consider per-batch idempotency key or deterministic upsert key to make retries safe.

### D3

Post-store readback for `storedSections` fails or is inconsistent · Postgres (`documentContextChunks`) · Needs discussion

- What happens: After all batches, code re-queries `documentContextChunks` by `documentId` to build `storedSections` for Step F. Query failure throws.
- Left behind: Embeddings may already be persisted; GraphRAG input construction fails, causing pipeline failure despite successful storage.
- Notes: This tight coupling means optional Step F depends on a full readback of D outputs.

### E1

`finalizeStorage` fails after successful D writes · Postgres finalize path (`finalizeStorage`) · Needs fix (High)

- What happens: `step-e-finalize` runs after D and can throw.
- Left behind: Chunks/embeddings may already be stored, but document/job final status/metadata may remain unfinalized. On retry, duplicate finalize side effects depend on finalize idempotency.
- Notes: Classic late-stage commit gap; worth ensuring finalize is idempotent and safely retryable.

### E2

Failure marking is runtime-flag dependent and can be skipped · Failure/status model (`markFailureInDb`, Inngest/runtime flags) · Needs discussion

- What happens: In catch, DB failure mark happens only if `markFailureInDb` is true. Otherwise, non-Inngest path returns failure payload without status update in DB.
- Left behind: Potential mismatch between returned failure and persisted job status.
- Notes: Verify all production invocations set `markFailureInDb` as intended.

### F1

GraphRAG skipped when sidecar health check fails · Sidecar health (`SIDECAR_URL/health`) · Needs discussion

- What happens: If `sidecarUrl` is set and `/health` is non-OK/unreachable, step F logs warning and returns (no throw).
- Left behind: Ingestion succeeds without entity/relationship extraction; silent feature degradation except logs.
- Notes: This is deliberate fail-soft behavior.

### F2

Entity extraction/write throws and fails whole ingestion · Entity extraction + Postgres `kg_*` writes · Needs fix (Medium-High)

- What happens: Inside `step-f-graph-rag`, `extractAndStoreEntities(...)` exceptions are uncaught locally and bubble out.
- Left behind: Core ingestion already finalized (E done), but optional graph stage failure can still fail the whole run.
- Notes: Design tension: F is optional conceptually, fail-hard operationally.

### G1

Neo4j missing/unconfigured/unhealthy causes sync skip · Neo4j availability/config/health · Working as intended

- What happens: If no `NEO4J_URI`, returns early. If `isNeo4jConfigured()` false or health check fails, logs warning and skips.
- Left behind: Ingestion success with no Neo4j projection.
- Notes: Explicit fail-soft design.

### G2

`syncDocumentToNeo4j` throw fails ingestion after finalize · Neo4j write operation (`syncDocumentToNeo4j`) · Needs discussion

- What happens: `step-g-neo4j-sync` has no local try/catch around `syncDocumentToNeo4j`; throw bubbles and fails run.
- Left behind: E and likely F may already be committed; Neo4j projection missing; overall run may still be marked failed depending on runtime flags.
- Notes: Similar tension as F2; consider making G fail-soft like G1 health gating.
