# What is in this repository

Read this before `README.md`. The README describes the product; this file
describes the repository as it actually is today.

## The short version

Launchstack is a **cited company-memory system**: sources go in through one
ingestion path, immutable evidence comes out, and answers cite that evidence
with stable anchors. The repository holds two private applications (web and
worker), fifteen publishable feature packages under `packages/` (the
bricks), one publishable compositions package at `pipelines/` (level two:
chains of bricks toward business outcomes), and three compute services
(plus two off-the-shelf service images, docling-serve and gotenberg).

The 2026-08 refactors (ADR-002 … ADR-008) replaced the previous layouts in
two steps: first layered engine packages with an enforced dependency
direction, a dedicated worker over a transactional outbox, and single-owner
compute services; then ADR-008 reorganized the packages **by feature** —
each package owns its tools, its wire contracts, and its clients — and the
kind-based engine packages were deleted
outright, since nothing was ever published under the old names.

## Layout

| Path                                  | Runtime                | What it is                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                            | Next.js 15             | UI, auth (Clerk), API/BFF. **Command acceptance and synchronous reads only** — it hosts no durable work and no Inngest endpoint.                                                                                                                                                                       |
| `apps/landing`                        | Next.js 15             | The public site (launchstack.app): landing, pricing, contact, the deployment guide. No database, no auth, no engine packages. Deployed on its own; excluded from every image (`.dockerignore`), so it is **not** part of a self-hosted deployment.                                                     |
| `apps/worker`                         | Node (tsx)             | **The sole durable workflow coordinator** (ADR-003): consumes the transactional outbox for ingestion and hosts the Inngest serve endpoint (`:8020/api/inngest`) for the background verticals (trend search, prospector, founder review, predictive analysis, website crawl, document modify, reindex). |
| `packages/runtime`                    | TS library (publishable) | The bottom of the graph: clock/logger ports, actor context, error taxonomy, storage/job slots, the singleton slot, the wire version. Imports nothing.                                                                                                                                                  |
| `packages/evidence`                   | TS library (publishable) | Pure company-state logic as tool-directories: citation-anchors, fact-assertions/-conflicts/-ledger, version-diff/-freshness/-supersession. Zero dependencies.                                                                                                                                          |
| `packages/store`                      | TS library (publishable) | Shared persistence: Drizzle client + engine schema (25 tables), sealed credentials, signed file-access tokens, credit metering, backfills. Owns the engine migration ledger (`packages/store/drizzle`, immutable history).                                                                             |
| `packages/llm`                        | TS library (publishable) | Everything that calls a model: structured output, message normalization, usage accounting, guardrails, NER, embeddings, and the vendor wiring behind one OpenAI-compatible transport.                                                                                                                  |
| `packages/orchestration`              | TS library (publishable) | Durable work (ADR-003): the pipeline-events contract, the SKIP LOCKED outbox store, the worker tick with bounded retries, transactional source acceptance, and the stage ports.                                                                                                                        |
| `packages/conversion`                 | TS library (publishable) | Any source → EvidenceDocument: per-type document converters with their wire + client, audio- and video-transcription in their own folders, OCR primitives, chunking, archive expansion, the extraction router.                                                                                         |
| `packages/indexing`                   | TS library (publishable) | EvidenceDocument → searchable: the two-stage doc-ingestion pipeline, entity extraction, Neo4j graph sync (optional peer).                                                                                                                                                                              |
| `packages/retrieval`                 | TS library (publishable) | Question → cited answer: every retrieval algorithm as a documented folder under `src/algorithms/` (bm25, vector, fusion, ensemble, rlm, graph, reranking) behind the replaceable RagPort, plus the retrieval-facing tools under `src/tools/`.                                   |
| `packages/editing`                    | TS library (publishable) | Tracked-changes Word editing (ADR-007): the adeu wire contract + typed client.                                                                                                                                                                                                                         |
| `packages/document-conversion-engine` | TS library (publishable) | PDF rendering (ADR-009): the typed client for the Gotenberg service — Office → PDF via LibreOffice, HTML/Markdown → PDF via Chromium. Imports nothing, reads no env.                                                                                                                                   |
| `packages/google-drive`               | TS library (publishable) | Thin typed client for the Google Drive v3 REST API and Google OAuth 2.0 token endpoints — the wire layer for Drive-linked documents. Framework-free; credentials injected, never read from the environment.                                                                                            |
| `packages/collab`                     | TS library (publishable) | Agent meetings in Slack-shaped channels, signed HTTP agent transport. Node built-ins only.                                                                                                                                                                                                             |
| `packages/simulation`                 | TS library (publishable) | Round-based social simulation (a TypeScript port of the OASIS design): agents read ranked feeds, post, react, follow, and can be interviewed. Zero dependencies; the host injects the model.                                                                                                           |
| `packages/engine`                     | TS library (publishable) | The one-install aggregate: `createEngine(CoreConfig)` plus selected conversion, indexing, and orchestration re-exports.                                                                                                                                                                               |
| `packages/schema-generator`           | TS library (publishable) | Walks the feature wire contracts and emits the `packages/schema-generator/schemas/v1/` bundle the Python contract tests validate against.                                                                                                                                                             |
| `packages/tools`                      | TS library (publishable) | Shared, contract-typed capabilities the verticals compose (company-context, grounded-retrieval, brand-voice, persona, web-research, social-publish, platform-profiles, content-scoring, claim-evidence, stage-runner). Tools may import bricks up to `retrieval`, never a vertical.                       |
| `packages/design-tokens`              | CSS (private)            | The design contract: primitives feeding semantic tokens, one file, no build step.                                                                                                                                                                                                                      |
| `pipelines/`                          | TS library (publishable) | **The compositions tier** — the verticals (marketing, email, founder-weekly-review, legal-templates, company-metadata, client-prospector, trend-search, connectors, repo-explainer, repo-workspace, distribution, proposals, vantage) + the product schema they own. May import any brick; bricks must not import compositions.                                        |
| `services/document-converter`         | Node/Express           | Routing decisions, vision classification, PDF page rendering, docling-backed parsing → typed `EvidenceDocument`. Replaced `ocr-router` + `ocr-worker` (ADR-004).                                                                                                                                       |
| `services/transcription`              | Python/FastAPI         | Whisper + yt-dlp → timestamped transcripts.                                                                                                                                                                                                                                                            |
| `services/adeu-ai-docs-editing`       | Python/FastAPI         | The authoritative Word-editing service (ADR-007): tracked changes, review-item enumeration, review actions, CriticMarkup preview, diffing. Backs the in-app Word editor.                                                                                                                               |
| `docker/`                             | config                 | SeaweedFS, Caddy, DB bootstrap.                                                                                                                                                                                                                                                                        |
| `scripts/`                            | mixed                  | `scripts/ci` (gates, also runnable locally), `scripts/dev` (manual probes), `scripts/ops`.                                                                                                                                                                                                             |
| `docs/`                               | Markdown               | ADRs (`docs/architecture/ADR-00*.md`), `target-architecture.md`, deployment, runbooks (`docs/runbooks/outbox.md`).                                                                                                                                                                                     |

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
retrieval                  ← question → cited answer
engine                     ← createEngine() aggregate
pipelines/  apps/          ← compositions and products (never imported by bricks)
```

ESLint enforces per-package import boundaries in `eslint.config.js`,
including a **flat ban on deleted package names**.
`scripts/ci/check-schema-boundary.mjs` keeps engine SQL free of product
references. Most engine-package source scopes prohibit `process.env`.
Explicit exemptions cover `packages/conversion/src/transcription-service.ts`,
`packages/conversion/src/audio-transcription/providers/`, and all of
`packages/editing`. The no-env rule is also absent from the `packages/tools`
and `packages/schema-generator` scopes. Otherwise, configuration flows through
`CoreConfig` and `configure*` hooks from the composition roots
(`apps/web/src/server/engine.ts`, reused by the worker).

`packages/tools` (`@launchstack/tools`) holds shared, contract-typed
capabilities the verticals compose — a tool is _imported_, a service is
_deployed_. Capabilities move down into tools; compositions stay up in
`pipelines/` (tools cannot import `@launchstack/pipelines`, lint-enforced).
ESLint allows `process.env` throughout tools; provider configuration belongs
in each tool's `config.ts` by convention. See `packages/tools/README.md` for
the catalog.

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

## Mindmap — a source type inside the Documents workspace

`apps/web/src/app/employer/documents/_mindmap` is a diagramming editor
(mindmaps, flowcharts, org charts, ERDs) with its own document model, canvas
and storage. It lives under the documents route because a mindmap *is a
source*: it is listed, searched, filed, renamed and deleted through the same
workspace controls as an upload, previewed in the same viewer, and edited in
place (`?source=m<id>&edit=1`). It has no pages of its own. It is structured
like a library: `_mindmap/model` is pure TypeScript with no React or DOM, and
carries the bulk of the tests.

It joins ingestion at exactly one seam. A diagram is **made citable** — the
server renders its outline from the stored document, stores it through
`uploadFile`, then hands it to `processDocumentUpload` the first time and to
`createDocumentVersionLifecycle` every time after, so one document is
re-indexed in place rather than a new copy added. There is no diagram-shaped
special case in ingestion; the document row carries a `kind: "mindmap"`
marker in `ocrMetadata` so viewers render it as the map. Entry points: _Add a
source → Create → Mindmap_, and the Studio feature menu.

Its tables (`pdr_ai_v2_mindmaps`, `…_mindmap_revisions`, `…_mindmap_presence`)
belong to the product migration set. Documents are stored whole as `jsonb` with
an optimistic-concurrency `revision`; see
`apps/web/src/app/employer/documents/_mindmap/README.md` for why, and for the
one place the editor deliberately does not use design tokens.

## Vantage — the weekly founder-meeting loop

`pipelines/src/vantage` is the tenth vertical and
`apps/web/src/app/employer/tools/vantage` its app (`/employer/tools/vantage`, a
Studio tool beside Growth). Evidence and metric observations go in through the
week; on Thursday a draft agenda comes out — three to five topics, each with
cited facts, why it matters, the decision to make and a proposed next step —
from the deployment's chat model when one is configured and from deterministic
rules otherwise; a recorded decision opens a commitment that next week's agenda
checks. Sharing is per topic, commitment and evidence item; the program triage
view and the weekly update read only shared rows.
`pipelines/src/vantage/README.md` has the tables and the honesty rules (what
"verified" means, unsupported facts, private notes).

## History — one sidebar feed over chats and pipeline runs

The workspace rail has two tabs. **Sources** is the knowledge tree; **History**
is everything that has already happened, newest first.

Two different things share that list, and their scopes differ on purpose:

- **Chat sessions** (`pdr_ai_v2_workspace_sessions` + `…_session_messages`) are
  **personal** — one person inside one workspace. A half-finished question is a
  draft, and a colleague finding your drafts in their sidebar is a surprise
  nobody asked for. A session is created by the *first send*, never by opening
  the composer, and its id lives in `?session=<id>` so a reload lands back in
  the same conversation. Reopening replays the stored transcript, its pinned
  sources, and its imported-transcript continuation.
- **Pipeline runs** are **workspace-wide**, read out of the verticals' own
  tables (`trend_search_jobs`, `client_prospector_jobs`, `repo_explainer_jobs`,
  `distribution_runs`, `email_campaigns`, `founder_weekly_review_runs`,
  `vantage_agendas`). Nothing
  is copied into a second table: history is a *read* over the rows the verticals
  already own, so it can never drift from them.

Grants runs (`proposal_runs`) join the same feed through their own loader.

`apps/web/src/lib/workspace-history.ts` is the shared contract — the entry
shape, four normalized statuses, date grouping, all pure and both-sides.
`apps/web/src/server/history/loaders.ts` holds one loader per kind; the merge in
`…/history/index.ts` settles them rather than awaiting as a group, so a vertical
whose query throws costs you that vertical and is named in `degraded`, instead of
blanking the sidebar. **Adding a vertical to the feed is a loader plus a kind —
no UI change.** A vertical with no surface yet still lists its runs, without a
link it cannot honour.

## Two migration sets, one database

The engine set lives in `packages/store/drizzle` (ledger
`_launchstack_migrations`; schema source `packages/store/src/db/schema.ts`).
The product set lives in `apps/web/drizzle` (ledger
`_launchstack_web_migrations`); its schema sources are
`apps/web/src/server/db/schema/`, `pipelines/src/*/schema.ts`, and
`pipelines/src/*/cache-schema.ts`. Both sets are forward-only, checksummed,
and applied by `packages/store/scripts/migrate.mjs`.
`pnpm --filter @launchstack/web db:migrate` applies engine then product
(see `CONTRIBUTING.md`). `drizzle-kit push` remains banned on deploy
surfaces. The engine set owns `pdr_ai_v2_event_outbox`.

## Deploy targets

| Target         | Built from                                      | Notes                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GHCR images    | `apps/web/Dockerfile`, `apps/worker/Dockerfile` | `.github/workflows/docker.yml` (`…-web`, `…-web-worker`). The web image **accepts uploads but cannot process them without the worker deployed.**                                                                                     |
| `apps/landing` | —                                               | The public marketing site has no deploy pipeline in this repo.                                                                                                                                                                       |
| npm packages   | publishable `packages/*` + `pipelines/`          | One Changesets flow (`.github/workflows/release.yml`); `scripts/ci/check-package-exports.mjs` checks configured publishable subpaths under plain Node ESM. The private design-tokens package is excluded.                                                                                         |
| Local          | `docker-compose.yml` via `Makefile`             | `make up` starts the required stack: db, migrate, seaweedfs, transcription, adeu-docs-editing, document-converter, gotenberg, worker, app, inngest-dev. `--profile ocr` adds docling-serve; `--profile backfill` for data backfills. |

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
   `company` — unused since ADR-010 (invitations and join links replaced the
   passkey signup); dropped, with `users.role` / `users.status`, once a release
   has shipped with zero reads.
6. **~~Clerk is a hard dependency.~~ Resolved (2026-08): auth is first-party.**
   Clerk was replaced by better-auth running inside `apps/web` against the
   same Postgres (`pdr_ai_v2_auth_*` tables) — no external auth service, no
   account required, air-gapped deployments work. The predicted `AuthPort`
   turned out to be unnecessary: because tenancy was already entirely our own
   Postgres (`users`, `userCompanyMemberships`, `company`, plus the
   `pdr_active_company` cookie), the swap was confined to the
   `lib/require-workspace-context.ts` chokepoint, `middleware.ts`, and the
   auth UI. `users.userId` now holds an opaque auth subject ID; rows imported
   from Clerk keep their original `user_…` strings
   (`apps/web/scripts/import-clerk-users.ts`).
