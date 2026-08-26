# What is in this repository

Read this before `README.md`. The README describes the product; this file
describes the repository as it actually is today.

## The short version

Launchstack is a **cited company-memory system**: sources go in through one
ingestion path, immutable evidence comes out, and answers cite that evidence
with stable anchors. The repository holds two private applications (web and
worker), thirteen publishable feature packages under `packages/` (the
bricks), one publishable compositions package at `pipelines/` (level two:
chains of bricks toward business outcomes), and three compute services.

The 2026-08 refactors (ADR-002 … ADR-008) replaced the previous layouts in
two steps: first layered engine packages with an enforced dependency
direction, a dedicated worker over a transactional outbox, and single-owner
compute services; then ADR-008 reorganized the packages **by feature** —
each package owns its tools, its wire contracts, and its clients — and the
kind-based packages (protocol/application/adapters/core) were deleted
outright, since nothing was ever published under the old names.

## Layout

| Path | Runtime | What it is |
| --- | --- | --- |
| `apps/web` | Next.js 15 | UI, auth (Clerk), API/BFF. **Command acceptance and synchronous reads only** — it hosts no durable work and no Inngest endpoint. |
| `apps/landing` | Next.js 15 | The public site (launchstack.app): landing, pricing, contact, the deployment guide. No database, no auth, no engine packages. Deployed on its own; excluded from every image (`.dockerignore`), so it is **not** part of a self-hosted deployment. |
| `apps/worker` | Node (tsx) | **The sole durable workflow coordinator** (ADR-003): consumes the transactional outbox for ingestion and hosts the Inngest serve endpoint (`:8020/api/inngest`) for the background verticals (trend search, prospector, founder review, predictive analysis, website crawl, document modify, reindex). |
| `packages/runtime` | TS library (published) | The bottom of the graph: clock/logger ports, actor context, error taxonomy, storage/job slots, the singleton slot, the wire version. Imports nothing. |
| `packages/evidence` | TS library (published) | Pure company-state logic as tool-directories: citation-anchors, fact-assertions/-conflicts/-ledger, version-diff/-freshness/-supersession. Zero dependencies. |
| `packages/store` | TS library (published) | Shared persistence: Drizzle client + engine schema (25 tables), sealed credentials, signed file-access tokens, credit metering, backfills. Owns the engine migration ledger (`packages/store/drizzle`, immutable history). |
| `packages/llm` | TS library (published) | Everything that calls a model: structured output, message normalization, usage accounting, guardrails, NER, embeddings, and the vendor wiring behind one OpenAI-compatible transport. |
| `packages/orchestration` | TS library (published) | Durable work (ADR-003): the pipeline-events contract, the SKIP LOCKED outbox store, the worker tick with bounded retries, transactional source acceptance, and the stage ports. |
| `packages/conversion` | TS library (published) | Any source → EvidenceDocument: per-type document converters with their wire + client, audio- and video-transcription in their own folders, OCR primitives, chunking, archive expansion, the extraction router. |
| `packages/indexing` | TS library (published) | EvidenceDocument → searchable: the two-stage doc-ingestion pipeline, entity extraction, Neo4j graph sync (optional peer). |
| `packages/search` | TS library (published) | Question → cited answer: BM25 + vector ensemble behind a replaceable port, reranking, the citation builder. |
| `packages/editing` | TS library (published) | Tracked-changes Word editing (ADR-007): the adeu wire contract + typed client. |
| `packages/collab` | TS library (published) | Agent meetings in Slack-shaped channels, signed HTTP agent transport. Node built-ins only. |
| `packages/engine` | TS library (published) | The one-install aggregate: `createEngine(CoreConfig)` plus re-exports of every feature surface. |
| `packages/schema-generator` | TS library (published) | Walks the feature wire contracts and emits the one `schemas/v1/` bundle the Python contract tests validate against. |
| `packages/tools` | TS library | Shared, contract-typed capabilities the verticals compose (company-context, grounded-retrieval, brand-voice, persona, web-research, social-publish, platform-profiles, content-scoring, claim-evidence, stage-runner). Tools may import bricks up to `search`, never a vertical. |
| `packages/design-tokens` | CSS (published) | The design contract: primitives feeding semantic tokens, one file, no build step. |
| `pipelines/` | TS library (published) | **The compositions tier** — nine verticals (marketing, email, founder-weekly-review, legal-templates, company-metadata, client-prospector, trend-search, connectors, repo-explainer) + the product schema they own. May import any brick; no brick may import it (lint-enforced). |
| `services/document-converter` | Node/Express | Routing decisions, vision classification, PDF page rendering, docling-backed parsing → typed `EvidenceDocument`. Replaced `ocr-router` + `ocr-worker` (ADR-004). |
| `services/transcription` | Python/FastAPI | Whisper + yt-dlp → timestamped transcripts. |
| `services/adeu-ai-docs-editing` | Python/FastAPI | The authoritative Word-editing service (ADR-007): tracked changes, review-item enumeration, review actions, CriticMarkup preview, diffing. Backs the in-app Word editor. |
| `docker/` | config | SeaweedFS, Caddy, DB bootstrap. |
| `scripts/` | mixed | `scripts/ci` (gates, also runnable locally), `scripts/dev` (manual probes), `scripts/ops`. |
| `docs/` | Markdown | ADRs (`docs/architecture/ADR-00*.md`), `target-architecture.md`, deployment, runbooks (`docs/runbooks/outbox.md`). |

> **`services/*` stays outside the pnpm workspace** (deliberate — their deps
> must not enter every app install). They are covered by their own CI
> jobs (`python-services`, `document-converter` in CI.yml), not by
> `pnpm -r typecheck`.

## The dependency direction (enforced)

```
runtime  evidence          ← bottom: ports/slots/errors · pure domain math
store  llm                 ← persistence · model calls (embeddings live here)
orchestration              ← events, outbox, tick, source acceptance
conversion                 ← any source → EvidenceDocument
indexing                   ← EvidenceDocument → chunks, vectors, graph
search                     ← question → cited answer
engine                     ← createEngine() aggregate
pipelines/  apps/          ← compositions and products (never imported by bricks)
```

ESLint blocks every illegal edge with composed per-package blocks in
`eslint.config.js`, plus a **flat ban on the deleted legacy names**
(`@launchstack/{core,protocol,application,adapters,features}`) — the ban
that replaced the facade ratchet. `check-schema-boundary.mjs` keeps engine
SQL free of product references. Engine packages must not read
`process.env` (two documented exceptions: the transcription and adeu
clients, inherited from the old features tier) — configuration flows
through `CoreConfig` from the composition roots
(`apps/web/src/server/engine.ts`, reused by the worker).

`packages/tools` (`@launchstack/tools`) holds shared, contract-typed
capabilities the feature verticals compose — a tool is _imported_, a service is
_deployed_. Capabilities move down into tools; pipelines stay up in features
(tools cannot import `@launchstack/features`, lint-enforced), and `process.env`
is allowed only in a tool's `config.ts`. See `packages/tools/README.md` for the
catalog.

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

## Mindmap — a second app inside `apps/web`

`apps/web/src/app/employer/mindmap` is a diagramming app (mindmaps, flowcharts,
org charts, ERDs) with its own document model, canvas and storage. It is a route
area rather than a package because it is product UI, but it is structured like a
library: `_mindmap/model` is pure TypeScript with no React or DOM, and carries
the bulk of the tests.

It joins the rest of the system at exactly one seam. A diagram is **published
into the Sources library** — rendered to a Markdown outline, stored through
`uploadFile`, then handed to `processDocumentUpload`, which is the same
ingestion path an uploaded PDF takes. There is no diagram-shaped special case in
ingestion, and a published mindmap is chunked, embedded and citable like any
other source. Entry points: _Add a source → Create → Mindmap_, and the Studio
feature menu.

Its tables (`pdr_ai_v2_mindmaps`, `…_mindmap_revisions`, `…_mindmap_presence`)
belong to the product migration set. Documents are stored whole as `jsonb` with
an optimistic-concurrency `revision`; see `apps/web/src/app/employer/mindmap/README.md`
for why, and for the one place the app deliberately does not use design tokens.

## Two migration sets, one database

Unchanged from before (see `CONTRIBUTING.md`): engine set in
`packages/core/drizzle` (ledger `_launchstack_migrations`; schema source now
`packages/adapters/src/db/schema/`), product set in `apps/web/drizzle`
(ledger `_launchstack_web_migrations`). Forward-only, checksummed, applied
by `packages/store/scripts/migrate.mjs` everywhere. `drizzle-kit push` stays
banned on deploy surfaces. The one engine table the refactor added:
`pdr_ai_v2_event_outbox`.

## Deploy targets

| Target | Built from | Notes |
| --- | --- | --- |
| GHCR images | `apps/web/Dockerfile`, `apps/worker/Dockerfile` | `.github/workflows/docker.yml` (`…-web`, `…-web-worker`). The web image **accepts uploads but cannot process them without the worker deployed.** |
| `apps/landing` | — | The public marketing site has no deploy pipeline in this repo. |
| npm packages | every `packages/*` + `pipelines/` | One Changesets flow (`release.yml`); `check-package-exports.mjs` proves every published subpath loadable under plain Node ESM (127 exports). |
| Local | `docker-compose.yml` via `Makefile` | `make up` starts the required stack: db, migrate, seaweedfs, transcription, adeu-docs-editing, document-converter, worker, app, inngest-dev. `--profile ocr` adds docling-serve; `--profile backfill` for data backfills. |

## Verification (all blocking — ADR-006)

`pnpm lint` · `pnpm -r typecheck` · package tests
(`pnpm --filter @launchstack/<pkg> test`) · full web Jest suite ·
`next build` (type errors fail it) · schema-generator `schemas:check` ·
Python service pytest suites · converter vitest suite ·
migration gates (journal, drift, DML/destructive, parity, upgrade) ·
Docker Compose smoke with an end-to-end cited-ingestion script
(`scripts/ci/e2e-ingest.mjs`). No `continue-on-error`, no excluded suites,
no `ignoreBuildErrors`.

## Open questions

1. ~~**`api/adeu` retirement**~~ **Closed** (ADR-007). Deleted: its
   `sys.path` import of a sibling directory was never visible to a serverless
   bundler, so it could not have run in the environment it existed for, and no
   caller referenced it. History remains in git.
2. **Compose files at the root** — deferred by owner decision (unchanged).
3. ~~**`apps/web` is two products** (marketing site + application in one route
   tree).~~ **Closed.** The public site is now `apps/landing`, deployed
   separately and excluded from every image; `apps/web` serves the application
   only, and `/` redirects to `/signin`.
4. **Worker composition reuse** — the worker boots through
   `apps/web/src/server/engine.ts` (one config authority). That keeps the
   worker's env surface identical to the app's (including Clerk keys it
   never uses); splitting a framework-free composition root out of web is
   the natural next refactor (ADR-002 consequences). Note this shared root is
   also what makes `DEPLOYMENT_MODE` reach the worker for free — the app and
   the worker cannot disagree about metering.
5. **`employerPasskey`/`employeePasskey`** remain plaintext columns on
   `company` — pre-existing; needs a hashing migration + backfill.
6. **Clerk is a hard dependency.** `CLERK_SECRET_KEY` and
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` are `requiredString()`, so a self-hoster
   needs a Clerk account and an air-gapped deployment is impossible. The
   coupling is small — `clerkMiddleware` in `middleware.ts`, `auth()` behind
   `lib/require-workspace-context.ts` (the single chokepoint for 227 call
   sites), `<ClerkProvider>`, four UI components and ~12 `useAuth`/`useUser`
   hooks — with no `clerkClient`, no `@clerk/backend`, and no webhook route.
   Tenancy is already entirely our own Postgres (`users`,
   `userCompanyMemberships`, `company`, plus the `pdr_active_company` cookie),
   so an `AuthPort` in `apps/web` with a Clerk adapter proven to be a no-op is
   a tractable first step. Deliberately not bundled with the self-hosting work:
   it moves a security boundary and deserves its own review.
