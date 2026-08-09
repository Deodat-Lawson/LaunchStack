# What is in this repository

Read this before `README.md`. The README describes the product; this file
describes the repository as it actually is today.

## The short version

Launchstack is a **cited company-memory system**: sources go in through one
ingestion path, immutable evidence comes out, and answers cite that evidence
with stable anchors. The repository holds two private applications (web and
worker), five publishable engine packages, one private product package
(`packages/features`), and three compute services.

The 2026-08 refactor (ADR-002 … ADR-006) replaced the previous
mid-transition layout: the engine now lives in layered packages with an
enforced dependency direction, durable work runs in a dedicated worker
through a transactional outbox, and the OCR/transcription/DOCX services have
single owners.

## Layout

| Path | Runtime | What it is |
| --- | --- | --- |
| `apps/web` | Next.js 15 | UI, auth (Clerk), API/BFF. **Command acceptance and synchronous reads only** — it hosts no durable work and no Inngest endpoint. |
| `apps/worker` | Node (tsx) | **The sole durable workflow coordinator** (ADR-003): consumes the transactional outbox for ingestion and hosts the Inngest serve endpoint (`:8020/api/inngest`) for the background verticals (trend search, prospector, founder review, predictive analysis, website crawl, document modify, reindex). |
| `packages/protocol` | TS library (published) | Cross-language contracts only: zod event/EvidenceDocument/service schemas + generated JSON Schemas (`schemas/v1/`) consumed by the Python services' contract tests. |
| `packages/evidence` | TS library (published) | Pure company-state logic: citation anchors, supersession, diffing, conflicts, reconciliation, freshness. No IO, no env. |
| `packages/application` | TS library (published) | Use cases and ports: command acceptance, the outbox tick with bounded retries, the pipeline event dispatch table, citation building. |
| `packages/adapters` | TS library (published) | Implementations: Postgres repositories (incl. the outbox), the ingestion pipeline stages, storage/provider/LLM adapters, HTTP clients for the compute services, the engine schema source. |
| `packages/core` | TS library (published) | **Compatibility facade**: every historical `@launchstack/core` subpath re-exports from the packages above. No business logic — `scripts/ci/check-core-facade.mjs` enforces it. Owns the engine migrations dir (`packages/core/drizzle`, immutable history). |
| `packages/features` | TS library (private) | Product verticals: founder weekly review, trend search, client prospector, company metadata, voice, adeu client, and others. (`mcp`, `workflow-generation`, `rules-extraction`, `connectors` are roadmap stubs — each a README plus `export {}`, not shipped code.) |
| `services/document-converter` | Node/Express | Routing decisions, vision classification, PDF page rendering, docling-backed parsing → typed `EvidenceDocument`. Replaced `ocr-router` + `ocr-worker` (ADR-004). |
| `services/transcription` | Python/FastAPI | Whisper + yt-dlp → timestamped transcripts. |
| `services/document-editor` | Python/FastAPI | The authoritative Adeu DOCX-redlining service. |
| `api/adeu` | Python | **DEPRECATED** duplicate of the editor service, retained tested pending an owner decision (ADR-004 §4). |
| `docker/` | config | SeaweedFS, Caddy, DB bootstrap. |
| `scripts/` | mixed | `scripts/ci` (gates, also runnable locally), `scripts/dev` (manual probes), `scripts/ops`. |
| `docs/` | Markdown | ADRs (`docs/architecture/ADR-00*.md`), `target-architecture.md`, deployment, runbooks (`docs/runbooks/outbox.md`). |

> **`services/*` stays outside the pnpm workspace** (deliberate — their deps
> must not enter every Vercel install). They are covered by their own CI
> jobs (`python-services`, `document-converter` in CI.yml), not by
> `pnpm -r typecheck`.

## The dependency direction (enforced)

```
protocol ← evidence ← application ← adapters ← core(facade) ← apps/services
```

ESLint blocks every illegal edge (per-package blocks in `eslint.config.js`);
`check-core-facade.mjs` keeps core re-exports-only; `check-schema-boundary.mjs`
keeps engine SQL free of product references. Core/evidence/application/
adapters must not read `process.env` — configuration flows through
`CoreConfig`/ports from the composition roots (`apps/web/src/server/engine.ts`,
reused by the worker).

## The one ingestion path (ADR-003)

```
upload/import (web route) ──ONE tx──► document + document_versions + ocr_jobs
                                      + event_outbox(source.version.created)
worker ── source.version.created ───► extract (converter / text fast path /
                                      archive expansion)
       ── evidence.version.extracted► chunk + embed + store (+ graph)
       ── evidence.version.indexed ─► note re-anchoring
                                      + company.state.projection.requested
       ── projection.requested ─────► company-metadata extraction
                                      → company.state.projected
query (web) ────────────────────────► ensemble retrieval → citations with
                                      stable anchors + freshness
```

Handlers are idempotent, retries bounded (8, exponential backoff), dead
events visible and replayable (`docs/runbooks/outbox.md`). The old
dispatch-after-commit Inngest path is gone; `founder_weekly_review_dispatches`
remains as the vertical-local outbox it always was.

## Two migration sets, one database

Unchanged from before (see `CONTRIBUTING.md`): engine set in
`packages/core/drizzle` (ledger `_launchstack_migrations`; schema source now
`packages/adapters/src/db/schema/`), product set in `apps/web/drizzle`
(ledger `_launchstack_web_migrations`). Forward-only, checksummed, applied
by `packages/core/scripts/migrate.mjs` everywhere. `drizzle-kit push` stays
banned on deploy surfaces. The one engine table the refactor added:
`pdr_ai_v2_event_outbox`.

## Deploy targets

| Target | Built from | Notes |
| --- | --- | --- |
| Vercel — web app | `apps/web` | Runs `db:migrate` on production builds. **Accepts uploads but cannot process them without a worker deployment.** |
| GHCR images | `apps/web/Dockerfile`, `apps/worker/Dockerfile` | `.github/workflows/docker.yml` (`…-web`, `…-web-worker`). |
| npm packages | `packages/{protocol,evidence,application,adapters,core}` | One Changesets flow (`release.yml`); `check-package-exports.mjs` gates every core subpath. |
| Local | `docker-compose.yml` via `Makefile` | `make up` starts the required stack: db, migrate, seaweedfs, transcription, document-editor, document-converter, worker, app, inngest-dev. `--profile ocr` adds docling-serve; `--profile backfill` for data backfills. |

## Verification (all blocking — ADR-006)

`pnpm lint` · `pnpm -r typecheck` · package tests
(`pnpm --filter @launchstack/<pkg> test`) · full web Jest suite ·
`next build` (type errors fail it) · protocol `schemas:check` ·
Python service pytest suites · converter vitest suite ·
migration gates (journal, drift, DML/destructive, parity, upgrade) ·
Docker Compose smoke with an end-to-end cited-ingestion script
(`scripts/ci/e2e-ingest.mjs`). No `continue-on-error`, no excluded suites,
no `ignoreBuildErrors`.

## Open questions

1. **`api/adeu` retirement** still needs an explicit call by its authors
   (ADR-004 §4). Until then it stays, tested, deprecated.
2. **Compose files at the root** — deferred by owner decision (unchanged).
3. **`apps/web` is two products** (marketing site + application in one route
   tree) — unchanged.
4. **Worker composition reuse** — the worker boots through
   `apps/web/src/server/engine.ts` (one config authority). That keeps the
   worker's env surface identical to the app's (including Clerk keys it
   never uses); splitting a framework-free composition root out of web is
   the natural next refactor (ADR-002 consequences).
5. **`employerPasskey`/`employeePasskey`** remain plaintext columns on
   `company` — pre-existing; needs a hashing migration + backfill.
