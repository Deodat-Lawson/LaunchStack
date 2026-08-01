# What is in this repository

Read this before `README.md`. The README describes the engine we are building.
This file describes the repository as it actually is today.

## The short version

There is **one** Next.js application (`apps/web`), **one** publishable library
(`packages/core`), and **three** long-running services (two Python, one Node).
Everything else is configuration, docs, or scripts.

The repository is mid-transition. We are separating an **open-source engine**
from a **closed-source SaaS product**. That separation is not finished, and in
two places the boundary currently runs the wrong way — see
[The boundary today](#the-boundary-today).

## Labels used below

| Label | Meaning |
| --- | --- |
| `ENGINE` | Intended to be open source. Must not know about tenants, billing, or auth. |
| `CLOUD` | Closed-source product. Tenancy, billing, auth, verticals, UI. |
| `SERVICE` | Standalone process, called over HTTP. Deployed as a container. |
| `INFRA` | Build, deploy, and local-development plumbing. |
| `QUARANTINE` | Unowned or duplicated. Needs a decision before it is kept or deleted. |

## Directory map

| Path | Runtime | Label | What it is |
| --- | --- | --- | --- |
| `apps/web` | Next.js 15 | `CLOUD` | The only Next.js app. Marketing site, product UI, and every API route. **Also contains the real RAG engine** (`src/lib/tools/rag/`), which belongs in `packages/core`. |
| `packages/core` | TypeScript library | `ENGINE` | Published as `@launchstack/core`. Engine ports, ingestion, embeddings, graph, OCR. **Also contains the SaaS database schema** (`src/db/schema/`), which belongs in `apps/web`. |
| `packages/features` | TypeScript library | `CLOUD` | 14 vertical products: client prospector, marketing pipeline, legal templates, trend search, voice, connectors, MCP, and others. |
| `services/ocr-router` | Node / Express | `SERVICE` | Routes OCR jobs by document complexity. |
| `services/ocr-worker` | Python | `SERVICE` | Docling-based OCR worker. |
| `sidecar` | Python / FastAPI | `SERVICE` | Whisper transcription and the ADEU document routines. |
| `docker/` | config | `INFRA` | SeaweedFS, Caddy, and database bootstrap configuration. |
| `scripts/` | mixed | `INFRA` | See [Scripts](#scripts). |
| `docs/` | Markdown | — | Deployment, architecture, and feature notes. |
| `patches/` | patch files | `INFRA` | One pnpm patch for `drizzle-kit`. |

> **`services/*` is not part of the pnpm workspace.** `pnpm-workspace.yaml`
> globs only `apps/*` and `packages/*`. This is deliberate — `ocr-router`
> depends on `@huggingface/transformers`, and adding it to the workspace would
> pull that into every Vercel install. The cost is that `services/ocr-router`
> is **not** covered by `pnpm -r typecheck` or `pnpm check`. It also duplicates
> `packages/core/src/ocr/complexity.ts` in its own `src/complexity.ts`.

## The boundary today

The separation is **inverted in two places**. Both are known and tracked; do not
"fix" them incidentally in an unrelated change.

1. **`packages/core` owns SaaS data.** `src/db/schema/` holds users, companies,
   memberships, invite codes, credit ledgers, marketing history, and company
   credentials. These are product concerns living in the package we publish.
   The engine's public search contract is also keyed on `companyId`, which
   forces every consumer to adopt our tenancy model.

2. **`apps/web` owns the engine.** The retrieval pipeline — BM25, vector, graph,
   and RLM retrievers plus ensemble fusion — lives in
   `apps/web/src/lib/tools/rag/`. `packages/core/src/rag/` is only a port; its
   own doc comment says the implementation lives in the app.

Until those are inverted, treat "is it in `packages/core`?" as an unreliable
signal for "is it open source?".

### Enforcement

`eslint.config.js` already forbids `packages/core` from importing Next, Clerk,
React, `apps/web` (`~/*`), or `@launchstack/features`, and forbids reading
`process.env`. These rules are correct but currently report errors rather than
blocking merges.

## Deploy targets

Four different things ship from this repository. This is the main reason the
root directory looks crowded.

| Target | Built from | Triggered by |
| --- | --- | --- |
| Vercel — web app | `apps/web` | `vercel.json`. Runs `db:migrate` on production builds. |
| GHCR container images | `apps/web/Dockerfile`, `apps/web/Dockerfile.prebuilt` | `.github/workflows/docker.yml` |
| npm package | `packages/core` | `.github/workflows/release.yml` via Changesets |

> **The npm release path is currently broken in two ways.** `.changeset/` does
> not exist, although the root `package.json` defines `changeset` / `version` /
> `release` scripts and `.github/workflows/release.yml` expects it. Separately,
> `packages/core/package.json` resolves its `exports` to `./src/*.ts` while
> `files` ships only `dist`, so a published tarball would contain no importable
> entry point.

### Local development

`docker-compose.yml` defines nine services: `db`, `migrate`, `seaweedfs`,
`sidecar`, `docling-serve`, `ocr-router`, `ocr-worker`, `app`, and `inngest-dev`.
Use the `Makefile` rather than raw compose commands:

```bash
make up
```

### The repository root is not an application

The root `package.json` is a **workspace manifest, not an app manifest**. It has
zero dependencies, holds no application code, and does not start a server.
Running `pnpm dev` at the root does nothing — target a package explicitly:

```bash
pnpm --filter @launchstack/web dev
```

Only genuinely repo-wide commands live at the root: `lint`, `typecheck`,
`format:*`, `check`, and the Changesets release scripts. Every Dockerfile now
lives beside the thing it builds, so no single application owns the root.

## Scripts

Three separate script locations exist, and they are not interchangeable.

| Location | Purpose |
| --- | --- |
| `apps/web/scripts/` | Wired into `apps/web/package.json`. The migration runner lives here. |
| `scripts/ops/` | Operational tasks: database backup, model download. |
| `scripts/dev/` | Manual developer probes. Not tests, not run by CI. |
| `scripts/backfill-embedding-credentials.ts` | Deliberately **not** moved. Migrations `0010` and `0011` reference this exact path, and those files are immutable — see below. |

### Migrations are immutable

`apps/web/scripts/migrate.mjs` records a SHA-256 checksum per migration file and
**exits non-zero on any drift**. Because `vercel.json` runs `db:migrate` during
production builds, editing an already-applied migration — *including its
comments* — will fail production deploys. Always add a new migration instead.

> The `0010` → `0011` chain is currently frozen: `0010` requires an application
> deploy and a credential backfill before `0011` drops the plaintext columns,
> but the runner applies all pending files consecutively.

## Where to start reading

| If you want to understand… | Read |
| --- | --- |
| The retrieval pipeline | `apps/web/src/lib/tools/rag/search/ensemble-search.ts` |
| The engine's public surface | `packages/core/src/index.ts` |
| What the engine promises hosts | `packages/core/src/config/types.ts` |
| The data model | `packages/core/src/db/schema/` |
| Product verticals | `packages/features/src/` |

## Open questions

These need an owner decision, not a code change.

1. **Compose files still sit at the root** — four of them. Consolidating them
   under `docker/` means every relative build context changes, because Compose
   resolves those against the first `-f` file's directory. *Deferred by owner
   decision.* The Dockerfiles have already moved to `apps/web/`.
2. **`sidecar/` sits outside `services/`** — it is a service and belongs at
   `services/sidecar/`, next to `ocr-router` and `ocr-worker`. Moving it means
   rewriting its build context in `docker-compose.yml`.
3. **`apps/web` is two products** — a marketing site (`/`, `/contact`,
   `/pricing`, `/deployment`) and the application (`/employer`, `/employee`,
   `/workspaces`) share one route tree with no route groups separating them.
   The `employer` / `employee` naming also predates `workspaces`.
4. **`qodana.yaml` and root `CHANGELOG.md`** — nothing references the Qodana
   config, and the root changelog was last updated 2026-01-31 and documents
   files under a root `src/` directory that no longer exists. The real
   changelog for the published package is `packages/core/CHANGELOG.md`.
