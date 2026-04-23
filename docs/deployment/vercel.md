# Deploying `apps/web` to Vercel

Vercel is the primary deploy target for the Launchstack reference app. This guide walks through a production setup end-to-end.

For self-hosted (Docker) deploys, see [`../deployment.md`](../deployment.md).

## Overview

| Concern | Where it lives |
|---|---|
| Next.js app | Vercel (this guide) |
| PostgreSQL + pgvector | Vercel Postgres, Neon, Supabase, or RDS |
| Object storage | Vercel Blob, S3-compatible (SeaweedFS, R2, AWS S3) |
| Background jobs | Inngest Cloud |
| Python ML sidecars | Fly.io / Railway / Cloud Run (separate deploy) |
| Auth | Clerk |
| DB migrations | Run automatically on production builds |

## 1. Create the Vercel project

1. Sign in to [vercel.com](https://vercel.com) and click **Add New → Project**.
2. Import the GitHub repo.
3. **Framework preset**: Next.js (auto-detected).
4. **Root directory**: leave as `./` — [`vercel.json`](../../vercel.json) at the repo root controls install + build.
5. **Node.js version**: 20.x (Project Settings → General).
6. Don't deploy yet — set env vars first (step 3).

### What `vercel.json` does

```json
{
  "installCommand": "pnpm install --frozen-lockfile --ignore-scripts",
  "buildCommand": "if [ \"$VERCEL_ENV\" = \"production\" ]; then pnpm db:migrate; fi && pnpm build",
  "ignoreCommand": "git diff --quiet HEAD^ HEAD . ':(exclude)docs/**' ':(exclude)*.md' ':(exclude).github/**'"
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
| `OPENAI_API_KEY` *or* `AI_API_KEY` | At least one of the two — validated in [`env.ts`](../../apps/web/src/env.ts) |
| `EMBEDDING_SECRETS_KEY` | 32-byte base64. Generate once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Keep constant across deploys** — rotating it invalidates stored per-company credentials |
| `INNGEST_EVENT_KEY` | From Inngest Cloud (step 4) |
| `INNGEST_SIGNING_KEY` | From Inngest Cloud (step 4) |

### Conditionally required

| Variable | When |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | If using Vercel Blob for file storage |
| `S3_*` + `NEXT_PUBLIC_S3_*` | If `NEXT_PUBLIC_STORAGE_PROVIDER=s3` |
| `NEO4J_URI` + `NEO4J_USERNAME` + `NEO4J_PASSWORD` | If using Graph RAG |
| `ADEU_SERVICE_URL` | If using DOCX redlining (Adeu sidecar) |

### Optional (feature flags / overrides)

See [`.env.example`](../../.env.example) — every variable there is either required or an optional override. Don't set optional variables you aren't using; the fallback behavior is usually what you want.

### Automatic (set by Vercel)

- `VERCEL` — `"1"` on all Vercel runs
- `VERCEL_ENV` — `"production"`, `"preview"`, or `"development"` — used to gate migrations
- `VERCEL_GIT_COMMIT_SHA` — exposed by [`/api/health`](../../apps/web/src/app/api/health/route.ts) as the `version` field

## 4. Connect Inngest Cloud

Inngest Cloud runs the background jobs and calls your Vercel function to execute each step.

1. Sign up at [inngest.com](https://www.inngest.com) and create an app.
2. Copy the **Event Key** → Vercel env as `INNGEST_EVENT_KEY`.
3. Copy the **Signing Key** → Vercel env as `INNGEST_SIGNING_KEY`.
4. Deploy the app to Vercel (step 6).
5. In the Inngest dashboard, register the app endpoint: `https://<your-app>.vercel.app/api/inngest`. Inngest will GET that URL to sync the function registry.

### Long-running steps

The Inngest route declares `export const maxDuration = 300;` (5 minutes). This requires **Vercel Pro** — Hobby plans cap at 60s.

Hobby workaround: break each Inngest step into sub-steps under 60s, or move long-running work into a sidecar.

## 5. Provision sidecars (optional)

The Launchstack Python sidecars (`services/sidecar`, `services/ocr-router`, `services/ocr-worker`) don't run on Vercel — they're long-running container services. Deploy them to Fly.io, Railway, Cloud Run, or anywhere else that runs containers, then point the Next.js app at them:

| Env var | Sidecar |
|---|---|
| `SIDECAR_URL` | Embeddings + reranking + transcription (`services/sidecar`) |
| `OCR_ROUTER_URL` | PDF-rendering + vision classifier (`services/ocr-router`) |
| `OCR_WORKER_URL` | Docling/Marker worker (optional) |

**Or** skip sidecars entirely and use cloud providers: OpenAI embeddings, Azure Document Intelligence for OCR, Groq for transcription. Set the per-capability env vars instead.

## 6. First deploy

1. Push to `main` (or click **Deploy** in Vercel).
2. Vercel runs: `pnpm install` → `pnpm db:migrate` (production only) → `pnpm build`.
3. Deploy completes; note the production URL.

### Verify

```bash
# Health check
curl https://<your-app>.vercel.app/api/health
# Expect HTTP 200 with { "status": "ok", "checks": { "database": { "status": "ok" } } }

# Inngest sync (registers functions with Inngest Cloud)
curl https://<your-app>.vercel.app/api/inngest
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

Migrations are **forward-only** ([`apps/web/scripts/migrate.mjs`](../../apps/web/scripts/migrate.mjs)). Rolling back code does **not** roll back schema. Plan breaking schema changes as additive-then-cleanup sequences.

## 9. Troubleshooting

### Build fails at `pnpm db:migrate`

- Confirm `DATABASE_URL` is set for the Production environment in Vercel.
- Check the migrate log output in the build — the script prints which file failed.
- Pgvector missing: run `CREATE EXTENSION IF NOT EXISTS vector;` against the database, then redeploy.

### Inngest endpoint returns 404 or 401

- Endpoint path is `/api/inngest` (exactly — no trailing slash).
- Confirm `INNGEST_SIGNING_KEY` matches the one Inngest shows in the dashboard.
- Check that the app has deployed at least once; Inngest sync only works against a live URL.

### Functions time out at 60s

- You're on the Hobby plan. Upgrade to Pro, or rewrite long steps as smaller Inngest sub-steps.

### Bundle too large

- The app uses `serverExternalPackages` ([`next.config.ts`](../../apps/web/next.config.ts)) to skip tracing heavy libs (LangChain, AWS SDK, sharp, etc.) into the function bundle. If you add a big dependency, add it to that list.
- Check `.vercel/output` after a local `vercel build` to see function sizes.

### `/api/health` returns 503 for Neo4j

- If you're not using Graph RAG, leave `NEO4J_URI` unset; the health check will mark Neo4j as `skipped` instead of `error`.
- If you are using it, confirm the Neo4j instance is reachable from Vercel's function regions.
