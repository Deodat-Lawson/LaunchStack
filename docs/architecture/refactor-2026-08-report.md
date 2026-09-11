# Refactor Report — Production-Grade Single-Product Architecture (2026-08-09)

One-pass refactor of Launchstack into a layered, outbox-driven cited
company-memory platform, per ADR-002 … ADR-006. This is the implementation
report: what changed, the compatibility decisions, migration status, the
verification that ran, and the remaining explicit risks.

## Changed architecture

- **Layered engine packages** (`protocol ← evidence ← application ←
  adapters ← core-facade`), ESLint-enforced per edge, with
  `scripts/ci/check-core-facade.mjs` keeping `@launchstack/core`
  re-exports-only. All five publish together via Changesets.
- **One ingestion path** (ADR-003): upload/import → ONE transaction
  (document + version + job + `pdr_ai_v2_event_outbox` row) → `apps/worker`
  claims with `FOR UPDATE SKIP LOCKED` → extract → index → note re-anchoring
  → company-state projection → cited query. Versioned events
  (`source.version.created`, `evidence.version.extracted`,
  `evidence.version.indexed`, `company.state.projection.requested`,
  `company.state.projected`, `note.embedding.requested`), deterministic
  idempotency keys, 8 bounded retries with exponential backoff, stale-claim
  reclaim, dead-letter visibility + documented replay
  (`docs/runbooks/outbox.md`).
- **apps/web slimmed to command acceptance + synchronous reads**: the
  `/api/inngest` endpoint and the `process-document` /
  `extract-company-metadata` / `rehydrate-note-anchors` functions are gone
  from web; the surviving background verticals execute on the worker's
  Inngest endpoint (`:8020/api/inngest`). Fire-and-forget durable writes
  (note embedding, note link sync, collab persistence ordering) were
  converted to outbox events / awaited / ordered chains.
- **Compute services** (ADR-004): `services/document-converter` (replaces
  ocr-router + ocr-worker; typed `EvidenceDocument` out),
  `services/transcription`, `services/document-editor` (authoritative Adeu);
  `api/adeu` retained deprecated + tested pending owner sign-off. All
  services: fail-closed X-API-Key, `/health`, trace-id structured logs,
  timeouts, startup-validated typed config, URL origin allow-lists.
- **Eliminated dishonest surfaces**: the request-scoped `process.env`
  mutation race in OCR routing; provider secrets forwarded in request
  bodies; the fake Marker provider; fabricated confidence constants (OCR
  router 0.99/0.95/0.5, worker 92.0, processor 1.0/95, adapters 95/90/100,
  Q&A references 0.25/0.8, transcription constant 0.0 → real Whisper
  log-prob derivation); the phantom `/embed` `/rerank` `/extract-entities`
  endpoints and every configuration referencing them; the dead experimental
  embedding surface; the unauthenticated files/metrics/AIChat/upload/
  predictive routes; body-supplied identity; the second unvalidated DB
  pool; the `Map<number>.get(string)` title-lookup bug.

## Compatibility decisions

- Every historical `@launchstack/core` subpath keeps working through the
  facade; `scripts/ci/check-package-exports.mjs` (Node-ESM loadability of
  every subpath from the packed tarball) remains the release gate.
  Breaking surface changes are limited to: `MARKER` removed from the OCR
  provider enums (config rejects it with a message naming DOCLING;
  persisted historical dispatch options are mapped with a logged warning),
  and the sidecar embedding/rerank/NER provider surface removed (it never
  had a server side). Both are documented in changesets (core is 0.x).
- Legacy env names are read as deprecated fallbacks with one-line startup
  warnings: `SIDECAR_URL`/`SIDECAR_API_KEY` →
  `TRANSCRIPTION_SERVICE_URL`/`_API_KEY`, `ADEU_SERVICE_URL` →
  `DOCUMENT_EDITOR_URL`, `OCR_ROUTER_URL` → `DOCUMENT_CONVERTER_URL`
  (API keys never fall back — service auth fails closed).
- Upload/route response shapes are unchanged; `userId` in request bodies is
  still accepted on the wire but overridden by the session identity (logged
  when they differ). `GET /api/files/[id]` keeps legacy-open behavior when
  `FILE_ACCESS_HMAC_KEY` is unset (loud warning) so existing deployments
  don't break; setting the key enables sessions + signed time-limited
  references + an `X-Service-Key` path for compute services.
- The web lifecycle API (`~/server/services/document-creation`) and
  `@launchstack/features/doc-ingestion` remain as re-export shims over the
  moved implementations; `eventIds` in lifecycle results is now always `[]`
  (Inngest event ids no longer exist for ingestion).

## Migrations / backfills

- One additive engine migration: `20260809081723_event_outbox.sql`
  (`pdr_ai_v2_event_outbox` + indexes). Forward-only, journaled,
  checksummed; both sets apply cleanly to an empty database and re-running
  is a no-op (CI parity gates unchanged and still blocking). No data was
  deleted or rewritten; no backfill was required. `document_embeddings_exp`
  is marked unused in the schema (kept — additive-only policy).

## Verification (commands and results)

Recorded on this machine during the refactor; the authoritative rerun of
each also lives in `.github/workflows/CI.yml` (all blocking):

| Command | Result |
| --- | --- |
| `pnpm -r typecheck` | pass (all 9 workspace projects) |
| `pnpm lint` | **exit 0 — 0 errors** (47 pre-existing warnings) after removing `continue-on-error` and fixing the ~1,000-error baseline that it had been hiding |
| `pnpm --filter @launchstack/protocol test` | 8 passed |
| `pnpm --filter @launchstack/evidence test` | 96 passed |
| `pnpm --filter @launchstack/application test` | 17 passed |
| `pnpm --filter @launchstack/adapters test` (TEST_DATABASE_URL set) | 22 passed (outbox + lifecycle integration vs real Postgres) |
| `pnpm --filter @launchstack/worker test` | 4 passed |
| `apps/web` jest, no DB | 104 suites / 1,095 tests passed (12 DB-gated suites self-skip) |
| `apps/web` jest, DATABASE_URL set | **116/116 suites, 1,152/1,152 tests passed** — incl. the nine formerly-excluded legacy suites and the outbox-migrated lifecycle integration suite (19 tests, deterministic across reruns) |
| `pnpm --filter @launchstack/web build` (`ignoreBuildErrors` REMOVED) | pass ("Compiled successfully", types checked) |
| engine package builds + `check-package-exports.mjs` | pass — 39 exports load under Node ESM from the publish shape |
| `check-core-facade.mjs` / `check-schema-boundary.mjs` / `check-no-push.mjs` / `db:check` | all pass (facade re-exports only; 26 engine + 39 product tables, one-way FKs; journal clean) |
| `pnpm --filter @launchstack/protocol schemas:check` | pass (19 contracts) |
| `services/transcription` pytest | 34 passed |
| `services/document-editor` pytest | 86 passed |
| `api/adeu` pytest | 14 passed |
| `services/document-converter` `npm test` + `tsc --noEmit` | 70 passed, clean |
| `scripts/ci/e2e-ingest.mjs` vs live worker + stub embeddings | **passed twice** (before AND after the core→facade evacuation): outbox tx → worker chain → evidence chunks → cited answer `src:<doc>/ver:<ver>/page:1` (fresh) → cross-company scoping enforced |
| `docker compose config` (base + test + ci overlays) | valid |

The e2e smoke also caught and drove fixes for three real defects: a
non-idempotent `document_metadata` insert (replay-breaking), graph
extraction failures aborting indexing, and sequential outbox processing
letting one slow LLM-bound handler starve the batch.

## Remaining explicit risks

1. **Worker composition reuse**: `apps/worker` boots through
   `apps/web/src/server/engine.ts`, so its env surface includes web-only
   variables (Clerk keys) it never uses. Documented transitional decision
   (ADR-002 consequences); the clean split is the next refactor.
2. **Synchronous media/import routes**: `upload/video-url` (yt-dlp +
   transcription via the service) and `upload/github-repo` (≤500MB zipball)
   still run inside the request to preserve their response contracts; the
   compute happens in services/GitHub, but long requests remain. Converting
   them to fully-async accepted commands changes the client contract and
   was deliberately deferred.
3. **`api/adeu` retirement** needs the owners' explicit decision; until
   then it is deprecated, tested, and not deployed.
4. **`FILE_ACCESS_HMAC_KEY`/`METRICS_BEARER_TOKEN` unset = legacy-open**
   (with loud warnings) for deployment compatibility; production setups
   must set them.
5. **Pre-existing data-model warts** (plaintext company passkeys, stringly
   `company_id` on note/kg tables, `workspace_results` TTL without a
   sweeper) are out of scope and unchanged — tracked in REPOSITORY.md.
6. **External deploys were not exercised** (no Vercel/GHCR/npm credentials
   in this environment): the release workflow, image pushes, and Vercel
   build are validated to the extent CI can (workflow syntax, local
   equivalents of each step). First real release/deploy is the only
   remaining external verification.

## File-by-file summary

See `git status`/`git diff` on this branch for the full change set —
668 files against `origin/main` at the time of writing
(`git diff --stat origin/main...HEAD`). Roughly double the ~250 files the
refactor first touched, because the facade evacuation counts every moved
module twice: its implementation in `packages/adapters` plus the re-export
stub left behind in `packages/core`. High-level map:

- `packages/protocol/**`, `packages/evidence/**`,
  `packages/application/**`, `packages/adapters/**` — new packages.
- `packages/core/**` — outbox schema + migration; then evacuated to a
  re-export facade (implementation now in adapters).
- `apps/worker/**` — new durable coordinator (+ Dockerfile).
- `apps/web` — inngest endpoint/functions removed; lifecycle/document
  creation shimmed to adapters; notes/collab durable-write fixes; auth +
  SSRF hardening across files/uploads/AIChat/predictive/metrics; env
  additions; retired event types removed; route-export fixes.
- `services/document-converter/**` (new), `services/transcription/**`
  (new), `services/document-editor/**` (new); `services/ocr-router`,
  `services/ocr-worker`, `sidecar/` removed; `api/adeu` deprecated + tests.
- `docker-compose*.yml`, `Makefile`, `apps/worker/Dockerfile`,
  `.github/workflows/{CI,docker,release}.yml` — new topology + blocking CI.
- `docs/architecture/ADR-002…006`, `target-architecture.md`,
  `docs/runbooks/outbox.md`, `REPOSITORY.md`, `README.md`,
  `CONTRIBUTING.md`, `docs/deployment*`, `.env.example` — rewritten.
- Landing/pricing/deployment UI — truthful-claims pass (ADR-006).
