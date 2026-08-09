# Deploying `apps/web` to Vercel

Vercel is the primary deploy target for the Launchstack reference app. This guide walks through a production setup end-to-end.

For self-hosted (Docker) deploys, see [`../deployment.md`](../deployment.md).

## Overview

| Concern | Where it lives |
|---|---|
| Next.js app (commands + reads) | Vercel (this guide) |
| Worker (`apps/worker` — outbox consumer + Inngest serve endpoint) | Fly.io / Railway / Cloud Run (separate deploy, **required for ingestion**) |
| PostgreSQL + pgvector | Vercel Postgres, Neon, Supabase, or RDS |
| Object storage | Vercel Blob, S3-compatible (SeaweedFS, R2, AWS S3) |
| Background jobs | Inngest Cloud (functions served by the worker) |
| Compute services (`services/transcription`, `services/document-editor`, `services/document-converter`) | Fly.io / Railway / Cloud Run (separate deploy) |
| Auth | Clerk |
| DB migrations | Run automatically on production builds |

> **Topology note (ADR-003):** Vercel hosts only the Next.js app. Document
> ingestion is executed by `apps/worker`, which consumes the transactional
> outbox and hosts the `/api/inngest` endpoint. A Vercel-only deployment
> accepts uploads but never processes them — deploy the worker alongside.

## 1. Create the Vercel project

1. Sign in to [vercel.com](https://vercel.com) and click **Add New → Project**.
2. Import the GitHub repo.
3. **Framework preset**: Next.js (auto-detected).
4. **Root directory**: set it to `apps/web` — [`apps/web/vercel.json`](../../apps/web/vercel.json) controls install + build.
5. **Node.js version**: 20.x (Project Settings → General).
6. Don't deploy yet — set env vars first (step 3).

### What `vercel.json` does

```json
{
  "installCommand": "npx -y pnpm@10.15.1 install --frozen-lockfile --ignore-scripts",
  "buildCommand": "if [ \"$VERCEL_ENV\" = \"production\" ]; then npx -y pnpm@10.15.1 db:migrate; fi && npx -y pnpm@10.15.1 build",
  "ignoreCommand": "git -C \"$(git rev-parse --show-toplevel)\" diff --quiet HEAD^ HEAD . ':(exclude)docs/**' ':(exclude)*.md' ':(exclude).github/**'"
}
```

- `installCommand` — lockfile-strict install; skip postinstall scripts (faster, safer)
- `buildCommand` — on **production** deploys, run DB migrations first; on previews, skip migrations and build directly
- `ignoreCommand` — skip rebuilds when only docs or CI changed

Migrations only run on production builds, so preview deploys don't mutate the prod database.

## 2. Provision Postgres + pgvector

Pick one:

**Vercel Postgres** (simplest)
1. In the Vercel project, Storage → **Create Database** → Postgres.
2. After creation, `DATABASE_URL` is injected automatically.
3. Enable pgvector: open the SQL console and run `CREATE EXTENSION IF NOT EXISTS vector;`.

**Neon** (recommended for pgvector + branching)
1. Create a project at [neon.tech](https://neon.tech); pgvector is enabled by default.
2. Copy the connection string (with `?sslmode=require`) into Vercel as `DATABASE_URL`.

**Supabase / RDS / self-hosted**
- Any Postgres 15+ works. Enable pgvector: `CREATE EXTENSION IF NOT EXISTS vector;`.

**Region**: pick one close to `iad1` (Vercel's default function region) or set `regions` in `vercel.json` to match your DB.

## 3. Configure environment variables

In the Vercel project: **Settings → Environment Variables**. Add each as **Production**, **Preview**, and/or **Development** as appropriate.

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string with SSL if remote |
| `CLERK_SECRET_KEY` | From Clerk dashboard |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From Clerk dashboard |
| `CHAT_BASE_URL` | The OpenAI-compatible chat endpoint, e.g. `https://generativelanguage.googleapis.com/v1beta/openai`. Optional — unset falls back to that same Gemini endpoint, authenticated with `GOOGLE_AI_API_KEY` |
| `CHAT_API_KEY` | Bearer credential for that endpoint (omit only for keyless endpoints, which are rare on Vercel) |
| `EMBEDDING_SECRETS_KEY` | 32-byte base64. Generate once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Keep constant across deploys** — rotating it invalidates stored per-company credentials |
| `INNGEST_EVENT_KEY` | From Inngest Cloud (step 4) |
| `INNGEST_SIGNING_KEY` | From Inngest Cloud (step 4) |

### Conditionally required

| Variable | When |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | If using Vercel Blob for file storage |
| `S3_*` + `NEXT_PUBLIC_S3_*` | If `NEXT_PUBLIC_STORAGE_PROVIDER=s3` |
| `NEO4J_URI` + `NEO4J_USERNAME` + `NEO4J_PASSWORD` | If using Graph RAG |
| `DOCUMENT_EDITOR_URL` | If using DOCX redlining (`services/document-editor`); the legacy `ADEU_SERVICE_URL` is being phased out per ADR-004 — set both while the migration completes |
| `AI_BASE_URL`, or a per-capability `*_API_BASE_URL` | If enabled OCR/VLM or NER should not use the default Gemini endpoint. Optional for those; **required** for embeddings, which have no fallback because switching model invalidates every stored vector |
| `AI_API_KEY`, `OPENAI_API_KEY`, or per-capability keys | The credential for the base URL above, when that endpoint requires one |

Gemini is the default, not a requirement — any endpoint implementing the
OpenAI chat-completions protocol works. Vercel cannot host a
local model itself, but it can call an externally hosted compatible endpoint.

Which model serves each route lives in `apps/web/config/chat-models.yaml`,
which is deployed with the repository, so changing a model is a commit rather
than a dashboard edit. To keep separate model sets per environment, commit a
second file and set `CHAT_MODELS_CONFIG` per Vercel environment:

```
CHAT_MODELS_CONFIG=config/chat-models.production.yaml
```

Routes that need a capability the configured model lacks report themselves
unavailable rather than falling back, so verify the file before promoting a
deployment. See [Chat Models](../chat-models.md) for the full reference.

### Optional (feature flags / overrides)

See [`.env.example`](../../.env.example) — every variable there is either required or an optional override. Don't set optional variables you aren't using; the fallback behavior is usually what you want.

### Automatic (set by Vercel)

- `VERCEL` — `"1"` on all Vercel runs
- `VERCEL_ENV` — `"production"`, `"preview"`, or `"development"` — used to gate migrations
- `VERCEL_GIT_COMMIT_SHA` — exposed by [`/api/health`](../../apps/web/src/app/api/health/route.ts) as the `version` field

## 4. Connect Inngest Cloud

Inngest Cloud schedules the background jobs. Since ADR-003 the functions are
**served by the worker** (`apps/worker`), not by the Vercel app — the app only
sends events.

1. Sign up at [inngest.com](https://www.inngest.com) and create an app.
2. Copy the **Event Key** → set as `INNGEST_EVENT_KEY` on **both** the Vercel
   app and the worker deployment.
3. Copy the **Signing Key** → set as `INNGEST_SIGNING_KEY` on the worker
   deployment (and the Vercel app if it sends signed events).
4. Deploy the worker (step 5) and the app (step 6).
5. In the Inngest dashboard, register the **worker's** endpoint:
   `https://<your-worker-host>/api/inngest`. Inngest will GET that URL to sync
   the function registry. The Vercel app has no `/api/inngest` route.

### Long-running steps

The worker is a long-running container, so durable steps are not subject to
Vercel function duration limits. Vercel plan limits still apply to the app's
own API routes.

## 5. Deploy the worker and compute services

The worker (`apps/worker`) and the compute services
(`services/transcription`, `services/document-editor`,
`services/document-converter`) don't run on Vercel — they're long-running
container services (ADR-003/ADR-004). Deploy them to Fly.io, Railway, Cloud
Run, or anywhere else that runs containers, then point the app and worker at
the services:

| Env var | Service |
|---|---|
| `TRANSCRIPTION_SERVICE_URL` + `TRANSCRIPTION_SERVICE_API_KEY` | Whisper transcription + yt-dlp (`services/transcription`) |
| `DOCUMENT_EDITOR_URL` + `DOCUMENT_EDITOR_API_KEY` | Adeu DOCX redlining (`services/document-editor`) |
| `DOCUMENT_CONVERTER_URL` + `DOCUMENT_CONVERTER_API_KEY` | OCR routing, vision classification, PDF rendering, docling-backed parsing (`services/document-converter`) |

These are the variables the Docker Compose stack uses. The legacy names
(`SIDECAR_URL`, `ADEU_SERVICE_URL`, `OCR_ROUTER_URL`, `OCR_WORKER_URL`) are
being phased out per ADR-004 — while the migration completes, set both the
new and the legacy name if a service isn't being picked up. Each service
reads its own provider credentials at startup — the app never forwards
secrets — and authenticates callers with a fail-closed per-service API key.

**Or** skip the optional services and use hosted providers. Transcription,
reranking, NER and OCR/VLM all default to Gemini on `GOOGLE_AI_API_KEY`;
Azure Document Intelligence remains available for scanned-layout OCR.
Embeddings are the exception — set `EMBEDDING_API_BASE_URL`/`EMBEDDING_API_KEY`
explicitly, since the model is tied to stored vectors. The worker itself is
**not** optional: without it, uploads are never processed.

## 6. First deploy

1. Push to `main` (or click **Deploy** in Vercel).
2. Vercel runs: `pnpm install` → `pnpm --filter @launchstack/web db:migrate` (production only) → `pnpm --filter @launchstack/web build`.
3. Deploy completes; note the production URL.

### Verify

```bash
# Health check
curl https://<your-app>.vercel.app/api/health
# Expect HTTP 200 with { "status": "ok", "checks": { "database": { "status": "ok" } } }

# Worker health (ingestion depends on this)
curl https://<your-worker-host>/healthz

# Inngest sync (registers functions with Inngest Cloud — served by the worker)
curl https://<your-worker-host>/api/inngest
# Should return function list

# App loads
open https://<your-app>.vercel.app
```

## 7. Ongoing deploys

- **Merge to `main`** → production deploy, runs migrations
- **Open a PR** → preview deploy with a unique URL, **no migrations** (shares the prod DB schema)
- **Tag `vX.Y.Z`** → no Vercel action by default; the tag is consumed by [`.github/workflows/release.yml`](../../.github/workflows/release.yml) to publish `@launchstack/core` and by [`docker.yml`](../../.github/workflows/docker.yml) to push Docker images

### Preview deploy data model

Previews share the production database unless you configure Neon branch databases or swap `DATABASE_URL` per-preview. Be mindful: destructive feature tests in a preview will hit prod data. For sensitive work, switch the preview env's `DATABASE_URL` to a staging database.

## 8. Rollback

**Via Vercel dashboard** (fast, recommended)
1. Deployments tab → pick the last-good deployment → **Promote to Production**.

**Via Git**
1. `git revert <bad-commit>` and push to `main`.
2. New deploy rolls the app forward with the revert.

Migrations are **forward-only** ([`packages/core/scripts/migrate.mjs`](../../packages/core/scripts/migrate.mjs)). Rolling back code does **not** roll back schema. Plan breaking schema changes as additive-then-cleanup sequences.

If you roll back to a build older than the applied migrations, `db:migrate` exits **4** ("database is ahead of this build") rather than running old code against a newer schema. Preview builds run `db:verify`, which reports pending migrations without failing the build.

## 9. Troubleshooting

### Build fails at `pnpm --filter @launchstack/web db:migrate`

- Confirm `DATABASE_URL` is set for the Production environment in Vercel.
- Check the migrate log output in the build — the script prints which file failed.
- Pgvector missing: run `CREATE EXTENSION IF NOT EXISTS vector;` against the database, then redeploy.

### Inngest endpoint returns 404 or 401

- The endpoint is on the **worker**, not the Vercel app: `https://<your-worker-host>/api/inngest` (exactly — no trailing slash). Registering the Vercel URL will 404.
- Confirm `INNGEST_SIGNING_KEY` on the worker matches the one Inngest shows in the dashboard.
- Check that the worker has deployed and is reachable; Inngest sync only works against a live URL.

### Uploads accepted but never processed

- The worker isn't running or can't reach the database. Check `https://<your-worker-host>/healthz` and see [`../runbooks/outbox.md`](../runbooks/outbox.md) for inspecting and replaying outbox rows.

### Bundle too large

- The app uses `serverExternalPackages` ([`next.config.ts`](../../apps/web/next.config.ts)) to skip tracing heavy libs (LangChain, AWS SDK, sharp, etc.) into the function bundle. If you add a big dependency, add it to that list.
- Check `.vercel/output` after a local `vercel build` to see function sizes.

### `/api/health` returns 503 for Neo4j

- If you're not using Graph RAG, leave `NEO4J_URI` unset; the health check will mark Neo4j as `skipped` instead of `error`.
- If you are using it, confirm the Neo4j instance is reachable from Vercel's function regions.
