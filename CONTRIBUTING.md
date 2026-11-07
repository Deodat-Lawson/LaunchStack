# Contributing to Launchstack

Thanks for your interest in contributing! This document covers how to set up a dev environment, the change-management workflow, and what we expect in a pull request.

## Before you start

- **One issue per PR.** If your change spans multiple concerns, split it.
- Search [existing issues](https://github.com/launchstack/launchstack/issues) and [discussions](https://github.com/launchstack/launchstack/discussions) before opening a new one.
- Substantial features (new packages, new ports, API-breaking changes) should be discussed in an issue first — we want to agree on the shape before you invest time writing code.

## Repo layout

```
packages/runtime                     host ports, actor context, errors, singleton slots — publishable
packages/evidence                    pure company-state logic (anchors, supersession, freshness) — publishable
packages/store                       Postgres client, engine schema, credentials, credits — publishable
packages/llm                         model calls, structured output, guardrails, embeddings — publishable
packages/orchestration               outbox, worker tick, source lifecycle, stage ports — publishable
packages/conversion                  document conversion, OCR, transcription, archives — publishable
packages/indexing                    chunking, embeddings, entity extraction, graph sync — publishable
packages/retrieval                   hybrid retrieval, reranking, citations — publishable
packages/tools                       shared capabilities composed by verticals — publishable
packages/engine                      @launchstack/engine — createEngine() aggregate — publishable
packages/editing                     tracked-changes Word editing contract and client — publishable
packages/collab                      channels, multi-agent meetings, signed HTTP protocol — publishable
packages/document-conversion-engine  Gotenberg PDF-rendering client — publishable
packages/google-drive                Google Drive v3 and OAuth client — publishable
packages/schema-generator            generated JSON Schema from wire contracts — publishable
packages/design-tokens               shared CSS design tokens (private, not published)
pipelines/                           @launchstack/pipelines — 13 vertical compositions — publishable
apps/web                             Next.js app: UI, auth, command acceptance, synchronous reads
apps/worker                          the durable workflow coordinator (outbox consumer + Inngest host)
apps/landing                         public marketing site (no engine)
services/                            Compute services (document-converter, transcription, adeu-ai-docs-editing)
```

The **layer boundaries are enforced by ESLint** (see [`eslint.config.js`](eslint.config.js))
with per-package import allowlists and the one-way boundary `packages/* ← pipelines ← apps`:

- `runtime`/`evidence` have no dependencies; they must not import frameworks or read `process.env`.
- `store` may import `runtime`; `llm` and `orchestration` may import `runtime`/`store`. `conversion`, `indexing`, and `retrieval` have their own dependency allowlists. Bricks must not import `@launchstack/pipelines`.
- Configuration is injected into the engine through `CoreConfig`/ports and `configure*` hooks. ESLint bans `process.env` in `runtime`, `evidence`, `store`, `llm`, `orchestration`, `conversion`, `indexing`, `retrieval`, `engine`, `collab`, `document-conversion-engine`, and `google-drive`. Transcription clients in `conversion` are exempt; `editing`, `tools`, `schema-generator`, and `pipelines` are outside this ban.
- `@launchstack/engine` assembles the bricks with `createEngine()`. The release workflow checks built publishable exports with `scripts/ci/check-package-exports.mjs`.
- `@launchstack/pipelines` must not import from the host app (`~/*`) or pull in Next/React or Clerk. Pipelines can read `process.env`.
- Violations fail lint (blocking in CI — ADR-006).

## Local dev

### Requirements

- Node.js **20+**
- pnpm **10+** (matches the `packageManager` field in [`package.json`](package.json); use `corepack enable` if you don't have it)
- Docker & Docker Compose (for the full local stack with Postgres + the compute services)

### Minimal setup (hosted Postgres)

```bash
git clone https://github.com/launchstack/launchstack.git
cd launchstack
pnpm install
cp .env.example .env                  # fill in DATABASE_URL, BETTER_AUTH_SECRET, a chat key and an embeddings key (see README "Run it locally")
pnpm --filter @launchstack/web db:migrate      # apply BOTH migration sets (engine, then product)
DEV_SEED_PASSWORD=<8+ chars> pnpm --filter @launchstack/web db:seed   # optional: one workspace + four role accounts
pnpm --filter @launchstack/web dev             # Next.js app on :3000 (plain `next dev` — no background work)
pnpm --filter @launchstack/worker dev          # the durable worker on :8020 — required for ingestion
```

The web app only *accepts* uploads; the worker consumes the outbox and runs
the pipeline, so an ingestion-capable setup needs both processes. Add
`pnpm --filter @launchstack/web inngest:dev` (Inngest dev UI on :8288,
pointed at the worker's `:8020/api/inngest`) if you are working on the
Inngest-hosted background verticals.

### Full local stack (Postgres + SeaweedFS + worker + compute services)

```bash
make up            # lite stack (~400MB RAM; OCR via Azure if its key is set, else the PDF text layer)
make up-ocr        # full stack with Docling for Office docs and as the OCR fallback
make up-fast       # build Next on host first, then compose (fastest for testing prod image)
make down          # tear down
make down-clean    # tear down + wipe volumes
```

Once the stack is up: app at `localhost:3000`, worker health at `localhost:8020/healthz`, Inngest dashboard at `localhost:8288`, transcription API at `localhost:8000/docs`, adeu-docs-editing at `localhost:8003/docs`, document-converter at `localhost:8002/health`.

## Changing the database

There are **two migration sets** against one database. Which one you touch
depends on whether the table belongs to the reusable engine or the product.

| Set | Schema | Migrations | Owns |
| --- | --- | --- | --- |
| **engine** | `packages/store/src/db/schema.ts` (exported by `@launchstack/store/schema`) | `packages/store/drizzle/` | company, documents, OCR, retrieval/embeddings, knowledge graph, outbox |
| **product** | `apps/web/src/server/db/schema/*.ts`, `pipelines/src/*/schema.ts`, and `pipelines/src/*/cache-schema.ts` | `apps/web/drizzle/` | identity, chatbot, collab, credits, notes, and the feature verticals |

The dependency is **one-way**: product tables may reference engine tables, never
the reverse. That is what lets someone embed `@launchstack/engine` and apply
`packages/store/drizzle` alone to get a working engine database. ESLint blocks
`@launchstack/store` from importing `~/*` or `@launchstack/pipelines`, and
`scripts/ci/check-schema-boundary.mjs` re-checks the boundary against generated SQL.

Feature-vertical tables live in `pipelines/` rather than `apps/web`
because a package cannot import from an app — but they are on the product side
of the boundary and ship in the product migration set.

```bash
# engine change
pnpm --filter @launchstack/store db:generate --name=add_document_language

# product change
pnpm --filter @launchstack/web db:generate --name=add_meeting_transcripts

# read the generated SQL. Nobody else will if you don't.

# apply BOTH sets, engine first (the order is load-bearing)
pnpm --filter @launchstack/web db:migrate

# engine only — what an embedding consumer runs
pnpm --filter @launchstack/store db:migrate

# useful
pnpm --filter @launchstack/store db:migrate --check                  # engine pending? (deploy preflight)
pnpm --filter @launchstack/store db:migrate --set=product --check    # product pending? (deploy preflight)
pnpm --filter @launchstack/store db:check                           # engine journal/snapshot integrity
pnpm --filter @launchstack/store db:check --set=product              # product journal/snapshot integrity
pnpm --filter @launchstack/store db:migrate --set=product --dry-run
```

**Rules**

- **`drizzle-kit push` is banned** anywhere it can reach a real database. It
  rewrites a live schema to match your code, unreviewed and unrecorded, and
  will DROP columns to do it. `db:push:danger` exists for scratch databases and
  refuses to run against a migration-managed one. CI enforces this
  (`node scripts/ci/check-no-push.mjs`).
- **Migrations are immutable.** The runner stores a SHA-256 per file and
  refuses to apply *anything* if a previously-applied migration has changed —
  including its comments. Fix mistakes with a new forward migration. There are
  no down migrations by design.
- **DDL only.** No `UPDATE`/`INSERT`/`DELETE`/`DO $$` in a migration; data
  changes go in a backfill (below). Override with `-- launchstack:allow-dml`
  when genuinely unavoidable.
- **Destructive DDL needs a marker.** `DROP TABLE` / `DROP COLUMN` requires
  `-- launchstack:destructive-ok` on the file, so it gets a second look.
- **`CREATE INDEX CONCURRENTLY`** cannot run in a transaction. Put it in its own
  file starting with `-- launchstack:no-transaction` plus a `-- Reason:` line.

### If `_journal.json` conflicts

Two PRs that each add a migration will both append an entry. **Never hand-merge
it** — a textual merge produces duplicate `idx` values and silently breaks the
ordering. Resolve by regenerating the artifacts for the affected migration set:

```bash
git rebase origin/main
# delete YOUR .sql and its meta/*_snapshot.json, then take main's _journal.json
# engine set
git checkout origin/main -- packages/store/drizzle/meta/_journal.json
pnpm --filter @launchstack/store db:generate --name=<your-change>
pnpm --filter @launchstack/store db:check

# product set (use this block instead for a product migration)
git checkout origin/main -- apps/web/drizzle/meta/_journal.json
pnpm --filter @launchstack/web db:generate --name=<your-change>
pnpm --filter @launchstack/store db:check --set=product
```

Regenerating is always cheaper and always correct.

### Data backfills

Rewriting existing rows is *not* a migration: it is unbounded, restartable, and
meaningless on a fresh database. Add an entry to
`apps/web/src/server/backfills/index.ts` instead — it gets a ledger row, a
resume cursor, and its own advisory lock so it can never block a deploy.

```bash
pnpm --filter @launchstack/web db:backfill --list
pnpm --filter @launchstack/web db:backfill --only=<id> [--batch=500] [--dry-run]
```

Backfills are never run automatically on container boot.

Contract for a `step()`:

- **Advance the cursor only to the last _successful_ row, then throw.** Catching
  an error and moving past it lets the run finish and mark itself `done` while
  that row stays unprocessed forever — a re-run will never revisit it.
- **`--dry-run` never calls `step()`**, because steps write. Implement the
  optional read-only `estimate()` if you want a dry run to report how much work
  remains.
- Set `requiresEngine: false` for a pure-SQL backfill so it runs with nothing
  but `DATABASE_URL`. Needing chat-endpoint config to repair legacy rows is
  exactly the wrong dependency in an incident.
- Backfills take a session advisory lock on a **pinned** connection (key
  `4919/2`, separate from the migration lock `4919/1`), so a long backfill can
  never block a deploy.

## Quality checks

Run before opening a PR:

```bash
pnpm check         # eslint + pnpm -r typecheck
pnpm --filter @launchstack/web test          # Jest (apps/web)
```

All three must pass in CI. Boundary rules (injected engine configuration with the exemptions above, no `~/*` in pipelines) are checked by ESLint — don't try to work around them with `/* eslint-disable */`; talk to us if the rule seems wrong.

## Changesets (for releases)

We use [Changesets](https://github.com/changesets/changesets) to release the publishable packages under `packages/*` (all except private `packages/design-tokens/`) and `pipelines/` (`@launchstack/pipelines`) to npm. These packages are not yet published. **If your PR changes any of these publishable packages**, you must add a changeset:

```bash
pnpm changeset
```

Follow the prompt — pick `patch` / `minor` / `major` and write a short user-facing summary of what changed. The tool writes a Markdown file under `.changeset/` that you commit with your PR.

On merge to `main`, the Changesets release workflow opens (or updates) a "Version Packages" PR. Merging that PR publishes the new package versions to npm.

Changes to `packages/design-tokens/` and `apps/*` **do not** need a changeset — they're private.

## Pull request checklist

Before requesting review:

- [ ] Commits are focused and have meaningful messages
- [ ] `pnpm check` passes
- [ ] `pnpm --filter @launchstack/web test` passes
- [ ] Changeset added if a publishable package under `packages/*` or `pipelines/` changed
- [ ] New env vars documented in [`.env.example`](.env.example) and [`apps/web/src/env.ts`](apps/web/src/env.ts)
- [ ] If the change touches UI, you've exercised the flow in a browser (not just a successful build)
- [ ] PR description explains **why**, not just **what**

## Code style

- TypeScript strict mode; prefer `type` over `interface` for shapes
- Import types with `import type`
- Don't add comments that restate the code. Only comment when the *why* is non-obvious.
- Match the surrounding file's style — no sweeping refactors in feature PRs

## Getting help

- **Questions**: [GitHub Discussions](https://github.com/launchstack/launchstack/discussions)
- **Bug reports**: [New issue](https://github.com/launchstack/launchstack/issues/new/choose)
- **Security**: see [SECURITY.md](SECURITY.md) — do not open public issues for vulnerabilities

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
