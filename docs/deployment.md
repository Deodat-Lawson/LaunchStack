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

**Services (default profile):**

- `db` — PostgreSQL 16 + pgvector (host port 5433)
- `migrate` — applies the ordered SQL migrations (`db:migrate`), then exits
- `seaweedfs` — S3-compatible object storage for uploaded files
- `transcription` — Whisper transcription + yt-dlp download (port 8000, [ADR-004](./architecture/ADR-004-compute-service-consolidation.md))
- `document-editor` — Adeu DOCX redlining service (host port 8003)
- `document-converter` — OCR routing, vision classification, PDF rendering, docling-backed parsing (port 8002)
- `worker` — the sole durable workflow coordinator (port 8020): consumes the transactional outbox and hosts the Inngest serve endpoint at `/api/inngest` ([ADR-003](./architecture/ADR-003-transactional-outbox-and-worker.md)); health at `/healthz` and `/readyz`
- `app` — Next.js runtime (port 3000) — command acceptance and reads only
- `inngest-dev` — Inngest dev server (dashboard at `http://localhost:8288`), polling `http://worker:8020/api/inngest`

Rebuild stack:

```bash
docker compose --env-file .env up --build
```

**Profiles:**

- **default** — everything Local mode requires (all services above)
- `--profile ocr` — adds `docling-serve`, the converter's parse engine for
  PDFs/Office docs (~800MB RAM). Without it, `/convert` returns a typed 503
  and text-file ingestion still works
- `--profile backfill` — on-demand data backfills:
  `docker compose --profile backfill run --rm backfill --list`

Example with the OCR parse engine:

```bash
docker compose --env-file .env --profile ocr up
```

**Ingestion flow:** upload → source version + outbox row
(`pdr_ai_v2_event_outbox`) written in one transaction → `worker` claims the
event → compute services → evidence persistence → indexing → company-state
projection. Operations (replaying dead events, monitoring) are documented in
[`docs/runbooks/outbox.md`](./runbooks/outbox.md).

## Option 2: Vercel + managed PostgreSQL

**See the full guide: [`deployment/vercel.md`](./deployment/vercel.md).**

Short version:

1. Import the repository into Vercel and set the project root directory to `apps/web`.
2. Provision Postgres with pgvector (Vercel Postgres, Neon, Supabase, etc.).
3. Set env vars per the [Vercel deployment guide](./deployment/vercel.md#3-configure-environment-variables).
4. Deploy. Migrations run automatically on production builds via [`apps/web/vercel.json`](../apps/web/vercel.json).
5. **Deploy `apps/worker` separately** (Fly.io / Railway / Cloud Run / any
   container host). The web app only accepts commands; without a worker,
   uploads are stored but never processed (ADR-003).
6. Register the **worker's** public `/api/inngest` URL in Inngest Cloud — the
   Next.js app no longer serves an Inngest endpoint.

Optional integrations:

- Inngest Cloud for background jobs (required in production)
- LangSmith for LLM tracing
- Compute services (`services/transcription`, `services/document-editor`,
  `services/document-converter`) deployed separately to Fly.io / Railway /
  Cloud Run

### Trend search (optional)

Trend search calls external search APIs. Configure `EXA_API_KEY` and/or `SERPER_API_KEY` and set `SEARCH_PROVIDER` as documented in [`.env.example`](../.env.example) (`exa`, `serper`, `fallback`, or `parallel`). If no API key backs the chosen path, the pipeline returns empty results and `providerUsed` may be `none`—this is expected when keys are omitted for local or OSS setups.

### Verifying Blob uploads on Vercel

1. After deploy, sign in to the Employer portal and open `/employer/upload`.
2. Upload any small PDF or DOCX. The `/api/upload-local` response should return a `vercel-storage.com` URL.
3. Paste that URL into a new tab. The file should download directly, confirming Blob access end to end.

## Option 3: VPS self-hosted (Node + reverse proxy)

1. Install Node.js 20+, pnpm 10+, Nginx, and PostgreSQL with pgvector.
2. Clone repo and install dependencies.
3. Configure `.env`.
4. Build and run the web app **and** the worker (`apps/worker`) with
   PM2/systemd — the worker is required for ingestion (ADR-003).
5. Reverse proxy traffic via Nginx and enable TLS (Let's Encrypt).
6. Apply schema:

```bash
pnpm --filter @launchstack/web db:migrate
```

Optional: run the compute services separately and point
`TRANSCRIPTION_SERVICE_URL`, `DOCUMENT_EDITOR_URL`, and
`DOCUMENT_CONVERTER_URL` at them.

## Environment Variables Summary

Chat reaches one endpoint implementing the OpenAI chat-completions protocol.
Model ids, per-model behavior, and route assignments live in
`apps/web/config/chat-models.yaml` — not in environment variables. See
[Chat Models](./chat-models.md) for presets, route inheritance, reasoning
modes, and migration from the pre-PR variables.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key |
| `CHAT_BASE_URL` | Yes | The OpenAI-compatible chat endpoint every route talks to |
| `CHAT_API_KEY` | Conditional | Bearer credential for that endpoint; omit for keyless local endpoints |
| `CHAT_MODELS_CONFIG` | Optional | Path to the chat model configuration file. Defaults to `config/chat-models.yaml` |
| `OPENAI_API_KEY` or `AI_API_KEY` | Conditional | Supporting non-chat capabilities (OCR, embeddings, rerank, NER, transcription) when no per-capability provider is configured. Never used for chat |
| `INNGEST_EVENT_KEY` | Yes (prod) | Inngest event key for background jobs |
| `BLOB_READ_WRITE_TOKEN` | Yes (Vercel) | Required for Vercel Blob uploads |
| `UPLOADTHING_TOKEN` | Optional | UploadThing legacy uploader |
| `TRANSCRIPTION_SERVICE_URL` + `TRANSCRIPTION_SERVICE_API_KEY` | Optional | Whisper transcription service (`services/transcription`) — the names the Compose stack uses |
| `DOCUMENT_EDITOR_URL` + `DOCUMENT_EDITOR_API_KEY` | Optional | DOCX redlining service (`services/document-editor`) — the names the Compose stack uses |
| `DOCUMENT_CONVERTER_URL` + `DOCUMENT_CONVERTER_API_KEY` | Optional | OCR routing/parsing service (`services/document-converter`) — the names the Compose stack uses |

The legacy variables (`SIDECAR_URL`, `ADEU_SERVICE_URL`, `OCR_ROUTER_URL`,
`OCR_WORKER_URL`) are being phased out per
[ADR-004](./architecture/ADR-004-compute-service-consolidation.md); while the
migration completes, set both the new and the legacy name if a service isn't
being picked up.
| `EXA_API_KEY` | Optional | Exa (trend search); required for `exa` / `fallback` / `parallel` when using Exa |
| `SERPER_API_KEY` | Optional | Serper Google News (trend search); required for `serper` / `fallback` / `parallel` when using Serper |
| `SEARCH_PROVIDER` | Optional | `exa` (default), `serper`, `fallback`, or `parallel` — see `.env.example` |
| `AZURE_DOC_INTELLIGENCE_*` | Optional | OCR for scanned PDFs |
| `DATALAB_API_KEY` | Optional | Alternative OCR |
| `LANDING_AI_API_KEY` | Optional | Fallback OCR |
| `JOB_RUNNER` | Optional | `inngest` (default) or `trigger-dev` |

## Post-deployment Checklist

- [ ] Environment variables set for all enabled features
- [ ] `DATABASE_URL` points to production DB
- [ ] `vector` extension enabled on PostgreSQL
- [ ] Schema applied (`pnpm --filter @launchstack/web db:migrate` locally, or automatic on Vercel production builds)
- [ ] Clerk and the selected chat provider/model validated
- [ ] OpenAI/global/per-capability integrations validated when enabled
- [ ] OCR providers validated if OCR is enabled
- [ ] Inngest validated if background processing is used (endpoint served by the worker)
- [ ] Worker running and healthy (`/healthz`) — required for ingestion
- [ ] Compute services validated if their `*_URL` variables are set

## Troubleshooting

### Corrupted Docker image

```bash
docker rmi pdr_ai_v2-migrate --force
docker compose --env-file .env build --no-cache migrate
docker compose --env-file .env up
```

If another image fails, remove it and rebuild with `--no-cache`.

### Transcription service startup timeout

The `transcription` service loads the Whisper model at startup (up to
~2 minutes). Its health check already allows a 120s `start_period`; increase
it in `docker-compose.yml` if your hardware needs longer.

### Uploads accepted but never processed

Ingestion runs in the `worker` (outbox consumer). Check
`curl http://localhost:8020/healthz` and see
[`docs/runbooks/outbox.md`](./runbooks/outbox.md) for inspecting and replaying
outbox rows.
