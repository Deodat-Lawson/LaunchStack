# Deployment Guide

This document covers deployment options for Launchstack.

## Self-hosting defaults

A deployment is **self-hosted unless it says otherwise** (`DEPLOYMENT_MODE`
unset). In that mode:

- **No usage metering gate.** Token usage is still recorded — `/api/credits/usage`
  and `token_usage_daily` answer "which document burned 400k embedding tokens" —
  but nothing is ever refused for want of balance. Only `DEPLOYMENT_MODE=cloud`
  enforces a balance, because only a billing deployment has a way to add credits.
- **No telemetry and no phone-home.** Vercel Analytics is mounted only on cloud
  deployments, `NEXT_TELEMETRY_DISABLED=1` is set in the images, and there is no
  usage reporting of any kind.
- **No third-party asset fetches.** The pdf.js worker is served from the instance
  (copied into `public/` at build time), so PDFs render on an air-gapped host.
- **No contact form that goes nowhere.** The in-app support page is driven by
  `SUPPORT_CONTACT_EMAIL` / `SUPPORT_COMMUNITY_URL`; with none set it points at
  the project's issue tracker rather than showing a form that discards messages.
- **The instance names itself.** Workspace URLs use the host you serve from, not
  `launchstack.app`.

The public marketing site is **not** part of a self-hosted deployment. It is a
separate app (`apps/landing`, deployed independently); Docker and Compose build
`apps/web` only. On a self-hosted instance `/` redirects to `/signin`.

**The first person to sign up becomes the owner** of the workspace they create,
already verified — there is no separate admin bootstrap step and no approval
queue to clear for that first account.

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
- `adeu-docs-editing` — Adeu DOCX redlining service (host port 8003)
- `document-converter` — OCR routing, vision classification, PDF rendering, docling-backed parsing (port 8002)
- `gotenberg` — PDF rendering: DOCX/Office → PDF via LibreOffice, HTML/Markdown → PDF via Chromium (host port 8004, [ADR-009](./architecture/ADR-009-gotenberg-pdf-rendering.md))
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

## Option 2: Container images (any container host)

`.github/workflows/docker.yml` builds and publishes two images to GHCR on every
push to `main` and on version tags:

- `ghcr.io/<owner>/<repo>-web` — the Next.js app (`apps/web/Dockerfile`)
- `ghcr.io/<owner>/<repo>-web-worker` — the durable worker (`apps/worker/Dockerfile`)

Deploy both to any container host (Fly.io / Railway / Cloud Run / ECS / your own
Kubernetes) alongside managed PostgreSQL with pgvector:

1. Provision Postgres with pgvector (Neon, Supabase, RDS, Cloud SQL, …) and set
   `DATABASE_URL`.
2. Apply schema before rolling the app — run `db:migrate` as a one-shot job on
   the same image (`docker compose run --rm migrate`, a Kubernetes Job, or a
   release command). Nothing applies schema on container boot.
3. Set the environment variables in the [summary table](#environment-variables-summary).
4. **Deploy the worker image too.** The web app only accepts commands; without a
   worker, uploads are stored but never processed (ADR-003).
5. Register the **worker's** public `/api/inngest` URL in Inngest Cloud — the
   Next.js app no longer serves an Inngest endpoint.

`apps/landing` is a separate app and has no deploy pipeline in this repo; it is
not part of a self-hosted deployment.

Optional integrations:

- Inngest Cloud for background jobs (required in production)
- LangSmith for LLM tracing
- Compute services (`services/transcription`, `services/adeu-ai-docs-editing`,
  `services/document-converter`) deployed separately to Fly.io / Railway /
  Cloud Run

### Trend search (optional)

Trend search calls external search APIs. Configure `EXA_API_KEY` and/or `SERPER_API_KEY` and set `SEARCH_PROVIDER` as documented in [`.env.example`](../.env.example) (`exa`, `serper`, `fallback`, or `parallel`). If no API key backs the chosen path, the pipeline returns empty results and `providerUsed` may be `none`—this is expected when keys are omitted for local or OSS setups.

### Verifying object-storage uploads

1. After deploy, sign in to the Employer portal and open `/employer/upload`.
2. Upload any small PDF or DOCX. The `/api/upload-local` response should return
   a URL on the storage backend you configured (SeaweedFS/S3 host, or
   `vercel-storage.com` if you set `BLOB_READ_WRITE_TOKEN`).
3. Paste that URL into a new tab. The file should download directly, confirming
   storage access end to end.

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
`TRANSCRIPTION_SERVICE_URL`, `ADEU_SERVICE_URL`, and
`DOCUMENT_CONVERTER_URL` at them.

## Environment Variables Summary

Chat reaches one endpoint implementing the OpenAI chat-completions protocol.
Model ids, per-model behavior, and route assignments live in
`apps/web/config/chat-models.yaml` — not in environment variables. See
[Chat Models](./chat-models.md) for presets, route inheritance, reasoning
modes, and migration from the pre-PR variables.

| Variable                                                                            | Required    | Description                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                      | Yes         | PostgreSQL connection string                                                                                                                                                                                                                                       |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                                 | Yes         | Clerk publishable key                                                                                                                                                                                                                                              |
| `CLERK_SECRET_KEY`                                                                  | Yes         | Clerk secret key                                                                                                                                                                                                                                                   |
| `CHAT_BASE_URL`                                                                     | Yes         | The OpenAI-compatible chat endpoint every route talks to                                                                                                                                                                                                           |
| `CHAT_API_KEY`                                                                      | Conditional | Bearer credential for that endpoint; omit for keyless local endpoints                                                                                                                                                                                              |
| `CHAT_MODELS_CONFIG`                                                                | Optional    | Path to the chat model configuration file. Defaults to `config/chat-models.yaml`                                                                                                                                                                                   |
| `OPENAI_API_KEY` or `AI_API_KEY`                                                    | Conditional | Supporting non-chat capabilities (OCR, embeddings, rerank, NER, transcription) when no per-capability provider is configured. Never used for chat                                                                                                                  |
| `INNGEST_EVENT_KEY`                                                                 | Cloud only  | Inngest event key. Required when `DEPLOYMENT_MODE=cloud`; otherwise a missing key warns at boot and the background verticals stay off. **Ingestion does not need it** — that runs through the transactional outbox                                                 |
| `BLOB_READ_WRITE_TOKEN`                                                             | Conditional | Only when using Vercel Blob as the object-storage backend; S3-compatible storage (SeaweedFS, MinIO, S3) is configured separately                                                                                                                                   |
| `UPLOADTHING_TOKEN`                                                                 | Optional    | UploadThing legacy uploader                                                                                                                                                                                                                                        |
| `TRANSCRIPTION_SERVICE_URL` + `TRANSCRIPTION_SERVICE_API_KEY`                       | Optional    | Whisper transcription service (`services/transcription`) — the names the Compose stack uses                                                                                                                                                                        |
| `ADEU_SERVICE_URL` + `ADEU_SERVICE_API_KEY`                                         | Optional    | DOCX redlining service (`services/adeu-ai-docs-editing`) — the names the Compose stack uses                                                                                                                                                                        |
| `DOCUMENT_CONVERTER_URL` + `DOCUMENT_CONVERTER_API_KEY`                             | Optional    | OCR routing/parsing service (`services/document-converter`) — the names the Compose stack uses                                                                                                                                                                     |
| `GOTENBERG_SERVICE_URL` + `GOTENBERG_SERVICE_USERNAME`/`GOTENBERG_SERVICE_PASSWORD` | Optional    | Gotenberg PDF-rendering service ([ADR-009](./architecture/ADR-009-gotenberg-pdf-rendering.md)) — the one PDF owner. Unset, every PDF-producing route returns a typed 503. Override `GOTENBERG_SERVICE_PASSWORD` in production — the Compose default is a local key |

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
| `DEPLOYMENT_MODE` | Optional | `self-hosted` (default when unset) or `cloud` — see [Self-hosting defaults](#self-hosting-defaults) |
| `NEXT_PUBLIC_SITE_URL` | Optional | Origin the public site (`apps/landing`) is served from |
| `NEXT_PUBLIC_APP_URL` | Optional | Origin this app is served from; where the public site's sign-in links point |
| `EMAIL_UNSUBSCRIBE_SECRET` | Conditional | HMAC key for unsubscribe links; required to send email campaigns, min 16 chars |
| `SUPPORT_CONTACT_EMAIL` | Optional | Address the in-app contact form composes to. Unset hides the form |

## Post-deployment Checklist

- [ ] Environment variables set for all enabled features
- [ ] `DATABASE_URL` points to production DB
- [ ] `vector` extension enabled on PostgreSQL
- [ ] Schema applied (`pnpm --filter @launchstack/web db:migrate`, or the Compose `migrate` service / a one-shot job on the image)
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
