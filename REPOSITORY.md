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
| `api/adeu` | Python | `QUARANTINE` | A 503-line serverless function that duplicates `sidecar/app/routes/adeu.py` and imports `sidecar/` through `sys.path` manipulation. Nothing in the TypeScript codebase references it, and the owner has confirmed it is not deployed on Vercel. Retained pending a decision from its authors — see [Open questions](#open-questions). |
| `docker/` | config | `INFRA` | SeaweedFS, Caddy, and database bootstrap configuration. |
| `scripts/` | mixed | `INFRA` | See [Scripts](#scripts). |
| `docs/` | Markdown | — | Deployment, architecture, and feature notes. See `docs/collaboration.md` for meetings, the Slack bridge, and distributed agents. |
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

> **The npm release path cannot run.** `.changeset/` does not exist, although
> the root `package.json` defines `changeset` / `version` / `release` scripts
> and `.github/workflows/release.yml` expects it. Separately, the release job
> is gated on `if: github.repository == 'launchstack/launchstack'`
> (`release.yml:20`) while this repository is `Deodat-Lawson/LaunchStack`, so
> it is skipped on every push.
>
> The **package itself is publish-ready**, contrary to what an earlier revision
> of this file claimed. `packages/core/package.json` carries a `publishConfig`
> block that redirects `main`, `types` and the entire `exports` map to
> `./dist/*`; npm and pnpm apply those overrides at publish time, and
> `release.yml` runs `publint` and `@arethetypeswrong/cli` against the packed
> tarball. The top-level `exports` pointing at `./src/*.ts` is what makes the
> workspace build work in development, not what would ship.

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
| `packages/core/scripts/` | Migration runner, journal check, push guard, seed. |
| `apps/web/scripts/` | Wired into `apps/web/package.json`. Backfill CLI, workers. |
| `scripts/ops/` | Operational tasks: database backup, model download. |
| `scripts/dev/` | Manual developer probes. Not tests, not run by CI. |
| `scripts/ci/` | Checks CI runs that are useful to run locally too. |

### One way to change the database

Schema is declared in `packages/core/src/db/schema/`, migrations are generated
from it into `packages/core/drizzle/`, and **every environment applies them with
the same command**: local dev, CI, the Docker `migrate` service, and the Vercel
production build all run `db:migrate`.

`drizzle-kit push` is banned anywhere it can reach a real database
(`scripts/ci/check-no-push.mjs` enforces it). Previously push was the de-facto
schema source for dev/CI/Docker while Vercel production ran SQL migrations —
two strategies that produced provably different databases.

See [Changing the database](CONTRIBUTING.md#changing-the-database) for the
workflow.

### Migrations are immutable

`packages/core/scripts/migrate.mjs` records a SHA-256 checksum per migration and
**refuses to apply anything** if a previously-applied file has changed —
including its comments. Because `vercel.json` runs `db:migrate` during
production builds, editing history fails the deploy. Always add a new forward
migration; there are no down migrations by design.

The runner also takes a session advisory lock before reading its ledger, so two
concurrent production builds cannot both decide the same migration is pending,
and `db:verify` exits `2` for pending, `3` for checksum drift and `4` when the
database is *ahead* of the build being deployed.

## Where to start reading

| If you want to understand… | Read |
| --- | --- |
| The retrieval pipeline | `apps/web/src/lib/tools/rag/search/ensemble-search.ts` |
| Meetings, Slack, and agents on other machines | `docs/collaboration.md`, then `packages/core/src/collab/` |
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
5. **`api/adeu` has no owner decision yet.** It is unreferenced and undeployed,
   but it was authored and tested by contributors other than the repository
   owner (created 2026-03-30, fixed and verified against preservation tests
   2026-04-09). "Not deployed" is not the same as "not wanted" — retiring it
   should be an explicit call by its authors, not an inference. Until then it
   stays.
