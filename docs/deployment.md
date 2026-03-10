# Deployment Guide

This document covers deployment options for PDR AI.

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

1. Import repository into Vercel.
2. Configure managed PostgreSQL (Vercel Postgres, Neon, Supabase, etc.).
3. Set `DATABASE_URL` and app environment variables.
4. Deploy with Vercel defaults.
5. Apply schema once:

```bash
DATABASE_URL="your_production_db_url" pnpm db:push
```

Optional integrations:

- Inngest for background document processing
- LangSmith for tracing
- Sidecar (deploy separately and set `SIDECAR_URL`)

## Option 3: VPS self-hosted (Node + reverse proxy)

1. Install Node.js 18+, pnpm, Nginx, and PostgreSQL with pgvector.
2. Clone repo and install dependencies.
3. Configure `.env`.
4. Build and run with PM2/systemd.
5. Reverse proxy traffic via Nginx and enable TLS (Let's Encrypt).
6. Apply schema:

```bash
pnpm db:push
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
| `UPLOADTHING_TOKEN` | Optional | UploadThing for cloud storage |
| `SIDECAR_URL` | Optional | Sidecar URL for reranking and Graph RAG |
| `TAVILY_API_KEY` | Optional | Web search for analysis |
| `AZURE_DOC_INTELLIGENCE_*` | Optional | OCR for scanned PDFs |
| `DATALAB_API_KEY` | Optional | Alternative OCR |
| `LANDING_AI_API_KEY` | Optional | Fallback OCR |
| `JOB_RUNNER` | Optional | `inngest` (default) or `trigger-dev` |

## Post-deployment Checklist

- [ ] Environment variables set for all enabled features
- [ ] `DATABASE_URL` points to production DB
- [ ] `vector` extension enabled on PostgreSQL
- [ ] Schema applied (`pnpm db:push`)
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
