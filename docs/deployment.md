# Deployment Guide

This document covers deployment options for Launchstack.

## Prerequisites

- Required environment variables configured
- PostgreSQL with `pgvector` enabled
- API keys for enabled integrations

Enable pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Option 1: Docker Compose (full stack)

Recommended for local and self-hosted deployments.

```bash
docker compose --env-file .env up
```

**Services:**

- `db` — PostgreSQL + pgvector
- `migrate` — schema setup via `db:push`
- `app` — Next.js runtime
- `sidecar` — FastAPI ML service (embeddings, reranking, entity extraction)

Rebuild stack:

```bash
docker compose --env-file .env up --build
```

**Profiles:**

- **default** — all services (db, migrate, app, sidecar)
- `--profile dev` — adds Inngest dev server (dashboard at `http://localhost:8288`)
- `--profile minimal` — db only (for local `pnpm dev`)

Example with Inngest dev server:

```bash
docker compose --env-file .env --profile dev up
```

## Option 2: Vercel + managed PostgreSQL

**See the full guide: [`deployment/vercel.md`](./deployment/vercel.md).**

Short version:

1. Import the repository into Vercel — framework auto-detects as Next.js, root directory stays `./`.
2. Provision Postgres with pgvector (Vercel Postgres, Neon, Supabase, etc.).
3. Set env vars per the [Vercel deployment guide](./deployment/vercel.md#3-configure-environment-variables).
4. Deploy. Migrations run automatically on production builds via [`vercel.json`](../vercel.json).
5. Register `https://<app>.vercel.app/api/inngest` in Inngest Cloud.

Optional integrations:

- Inngest Cloud for background jobs (required in production)
- LangSmith for LLM tracing
- Python sidecars (embeddings/OCR) deployed separately to Fly.io / Railway / Cloud Run

### Trend search (optional)

Trend search calls external search APIs. Configure `TAVILY_API_KEY` and/or `SERPER_API_KEY` and set `SEARCH_PROVIDER` as documented in [`.env.example`](../.env.example) (`tavily`, `serper`, `fallback`, or `parallel`). If no API key backs the chosen path, the pipeline returns empty results and `providerUsed` may be `none`—this is expected when keys are omitted for local or OSS setups.

### Verifying Blob uploads on Vercel

1. After deploy, sign in to the Employer portal and open `/employer/upload`.
2. Upload any small PDF or DOCX. The `/api/upload-local` response should return a `vercel-storage.com` URL.
3. Paste that URL into a new tab. The file should download directly, confirming Blob access end to end.

## Option 3: VPS self-hosted (Node + reverse proxy)

1. Install Node.js 20+, pnpm 10+, Nginx, and PostgreSQL with pgvector.
2. Clone repo and install dependencies.
3. Configure `.env`.
4. Build and run with PM2/systemd.
5. Reverse proxy traffic via Nginx and enable TLS (Let's Encrypt).
6. Apply schema:

```bash
pnpm db:migrate
```

Optional: Run the sidecar separately and point `SIDECAR_URL` to it.

## Environment Variables Summary

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `INNGEST_EVENT_KEY` | Yes (prod) | Inngest event key for background jobs |
| `BLOB_READ_WRITE_TOKEN` | Yes (Vercel) | Required for Vercel Blob uploads |
| `UPLOADTHING_TOKEN` | Optional | UploadThing legacy uploader |
| `SIDECAR_URL` | Optional | Sidecar URL for reranking and Graph RAG |
| `TAVILY_API_KEY` | Optional | Tavily (trend search); required for `tavily` / `fallback` / `parallel` when using Tavily |
| `SERPER_API_KEY` | Optional | Serper Google News (trend search); required for `serper` / `fallback` / `parallel` when using Serper |
| `SEARCH_PROVIDER` | Optional | `tavily` (default), `serper`, `fallback`, or `parallel` — see `.env.example` |
| `AZURE_DOC_INTELLIGENCE_*` | Optional | OCR for scanned PDFs |
| `DATALAB_API_KEY` | Optional | Alternative OCR |
| `LANDING_AI_API_KEY` | Optional | Fallback OCR |
| `JOB_RUNNER` | Optional | `inngest` (default) or `trigger-dev` |

## Post-deployment Checklist

- [ ] Environment variables set for all enabled features
- [ ] `DATABASE_URL` points to production DB
- [ ] `vector` extension enabled on PostgreSQL
- [ ] Schema applied (`pnpm db:migrate` locally, or automatic on Vercel production builds)
- [ ] Clerk, UploadThing, and OpenAI integrations validated
- [ ] OCR providers validated if OCR is enabled
- [ ] Inngest validated if background processing is used
- [ ] Sidecar validated if `SIDECAR_URL` is set

## Troubleshooting

### Corrupted Docker image

```bash
docker rmi pdr_ai_v2-migrate --force
docker compose --env-file .env build --no-cache migrate
docker compose --env-file .env up
```

If another image fails, remove it and rebuild with `--no-cache`.

### Sidecar startup timeout

The sidecar loads ML models at startup (~2 minutes). Increase `start_period` in `docker-compose.yml` if needed, or wait longer before health checks pass.
