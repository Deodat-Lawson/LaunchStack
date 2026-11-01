# Deployment Guide

This document covers deployment options for Launchstack.

## Self-hosting defaults

A deployment is **self-hosted unless it says otherwise** (`DEPLOYMENT_MODE`
unset). In that mode:

- **No usage metering gate.** Token usage is still recorded — `/api/credits/usage`
  and `token_usage_daily` answer "which document burned 400k embedding tokens" —
  but nothing is ever refused for want of balance. Only `DEPLOYMENT_MODE=cloud`
  enforces a balance, because only a billing deployment has a way to add credits.
- **No AI limit per person unless you set one.** Every model call is recorded
  against the person it was for. To cap what one person can run on your models,
  set `AI_MONTHLY_TOKEN_LIMIT_PER_USER` (see [AI allowances](#ai-allowances-per-person));
  workspace admins can also set their own limits. Unlike a credit balance, a
  limit can always be raised, so it applies in either mode.
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

Recommended for local and self-hosted deployments. For the production
single-VM variant (GHCR images, Caddy TLS, no Whisper/Docling/Inngest-dev
containers), layer `docker-compose.prod.yml` on top — see
[`docs/runbooks/azure-lean-deploy.md`](./runbooks/azure-lean-deploy.md).

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
5. Give the worker an Inngest server: either self-host `inngest start` beside
   it (what `docker-compose.prod.yml` does; set `INNGEST_BASE_URL` on app and
   worker and `INNGEST_SERVE_HOST` on the worker), or register the **worker's**
   public `/api/inngest` URL in Inngest Cloud. Either way set
   `INNGEST_EVENT_KEY` **and** `INNGEST_SIGNING_KEY`; with only the event key,
   jobs are accepted and never run. The Next.js app serves no Inngest endpoint.

`apps/landing` is a separate app and has no deploy pipeline in this repo; it is
not part of a self-hosted deployment.

Optional integrations:

- Inngest for background jobs, self-hosted or Inngest Cloud (Drive/Gmail sync, crons and the other verticals need it)
- LangSmith for LLM tracing
- Compute services (`services/transcription`, `services/adeu-ai-docs-editing`,
  `services/document-converter`) deployed separately to Fly.io / Railway /
  Cloud Run

### Web search (optional)

One setting, `SEARCH_PROVIDER`, picks the engine for every feature that
searches the web: Ask's `search_web` tool, Prospects, competitor analysis,
grant search (Find funders), the document generator's web research,
predictive analysis, and trend search (news). Each engine needs one
credential:

| `SEARCH_PROVIDER` | Credential             | Notes                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exa`             | `EXA_API_KEY`          | The only engine with a company index. Exa bills the operator about $7 per 1,000 searches (type `auto`, up to 10 results) and $1 per 1,000 pages for contents and summaries; new accounts get $10 of free credit that resets monthly. Keys: <https://dashboard.exa.ai/api-keys> |
| `serper`          | `SERPER_API_KEY`       | Google results through <https://serper.dev>                                                                                                                                                                                                                                    |
| `brave`           | `BRAVE_SEARCH_API_KEY` | The Brave Search API, <https://brave.com/search/api/>                                                                                                                                                                                                                          |
| `tavily`          | `TAVILY_API_KEY`       | <https://app.tavily.com>                                                                                                                                                                                                                                                       |
| `searxng`         | `SEARXNG_URL`          | Base URL of a SearXNG instance with JSON output enabled. Free and self-hosted; see below                                                                                                                                                                                       |

Leave `SEARCH_PROVIDER` unset (or empty) and the first engine with a
credential wins, in the order exa, serper, brave, tavily, searxng, so a
deployment that only sets `EXA_API_KEY` or `SERPER_API_KEY` keeps working
unchanged. Name an engine and only that engine is used: if its credential is
missing, web search is **off** (logged, and shown in Settings › Models),
never a silent switch to another engine. Settings › Models has a read-only
Web search card showing the active engine. The old trend-search values
`fallback` and `parallel` are gone; a configuration that still sets them
keeps booting and is treated as unset.

Company search needs Exa. With Exa active, Prospects finds companies in
Exa's company index and offers lookalikes ("companies like our customers").
With any other engine, Prospects discovers companies through ordinary web
search on that engine, and lookalikes are off.

**SearXNG, the free self-hosted option.** The Compose stack includes an
optional SearXNG service under the `search` profile. It publishes no port;
only the app and the worker reach it, over the Compose network. Its
configuration, [`docker/searxng/settings.yml`](../docker/searxng/settings.yml),
turns on JSON output and turns off SearXNG's bot limiter, which would
otherwise reject the app's requests. Set the engine in `.env`:

```bash
SEARCH_PROVIDER=searxng
SEARXNG_URL=http://searxng:8080
# Signs SearXNG's cookies. The Compose default is a local key; override it in production.
SEARXNG_SECRET=<a long random string>
```

Then start the stack with the profile. This starts SearXNG and recreates the
app and the worker with the new settings:

```bash
docker compose --profile search up -d
```

SearXNG is a metasearch engine: it asks public engines (Google, Bing,
DuckDuckGo and others) from your server's IP address, and they may
rate-limit or CAPTCHA a busy instance, which then returns fewer results or
none. It suits light and personal use; for steady traffic, use a keyed
engine. To use a SearXNG instance you already run, point `SEARXNG_URL` at it
and make sure `json` is in its `search.formats`, or it answers 403.

With no engine, the features above skip their web step (trend search returns
empty results with `providerUsed: none`, and Ask does not offer
`search_web`), which is expected for local or OSS setups. Ask still reads
links people paste into a question without any key. See
[`.env.example`](../.env.example).

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

| Variable                                                                            | Required    | Description                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Yes         | PostgreSQL connection string                                                                                                                                                                                                                                            |
| `BETTER_AUTH_SECRET`                                                                | Yes         | Signs auth session cookies — `openssl rand -base64 32`                                                                                                                                                                                                                  |
| `BETTER_AUTH_URL`                                                                   | Yes         | Public origin, e.g. `https://app.example.com` (`http://localhost:3000` locally). Without it, browser sign-up is refused with "Invalid origin"                                                                                                                           |
| `CHAT_BASE_URL`                                                                     | Yes         | The OpenAI-compatible chat endpoint every route talks to                                                                                                                                                                                                                |
| `CHAT_API_KEY`                                                                      | Conditional | Bearer credential for that endpoint; omit for keyless local endpoints                                                                                                                                                                                                   |
| `CHAT_MODELS_CONFIG`                                                                | Optional    | Chat model configuration file, relative to `apps/web`. Defaults to `config/chat-models.yaml` (Gemini); `config/chat-models.azure.yaml` targets Azure OpenAI                                                                                                             |
| `OPENAI_API_KEY` or `AI_API_KEY`                                                    | Conditional | Supporting non-chat capabilities (OCR, embeddings, rerank, NER, transcription) when no per-capability provider is configured. Never used for chat                                                                                                                       |
| `INNGEST_EVENT_KEY`                                                                 | Cloud only  | Inngest event key. Required when `DEPLOYMENT_MODE=cloud`; otherwise a missing key warns at boot and the background verticals stay off. **Ingestion does not need it** — that runs through the transactional outbox                                                      |
| `BLOB_READ_WRITE_TOKEN`                                                             | Conditional | Only when using Vercel Blob as the object-storage backend; S3-compatible storage (SeaweedFS, MinIO, S3) is configured separately                                                                                                                                        |
| `UPLOADTHING_TOKEN`                                                                 | Optional    | UploadThing legacy uploader                                                                                                                                                                                                                                             |
| `TRANSCRIPTION_SERVICE_URL` + `TRANSCRIPTION_SERVICE_API_KEY`                       | Optional    | Whisper transcription service (`services/transcription`) — the names the Compose stack uses                                                                                                                                                                             |
| `ADEU_SERVICE_URL` + `ADEU_SERVICE_API_KEY`                                         | Optional    | DOCX redlining service (`services/adeu-ai-docs-editing`) — the names the Compose stack uses                                                                                                                                                                             |
| `DOCUMENT_CONVERTER_URL` + `DOCUMENT_CONVERTER_API_KEY`                             | Optional    | OCR routing/parsing service (`services/document-converter`) — the names the Compose stack uses                                                                                                                                                                          |
| `GOTENBERG_SERVICE_URL` + `GOTENBERG_SERVICE_USERNAME`/`GOTENBERG_SERVICE_PASSWORD` | Optional    | Gotenberg PDF-rendering service ([ADR-009](./architecture/ADR-009-gotenberg-pdf-rendering.md)) — the one PDF owner. Unset, every PDF-producing route returns a typed 503. Override `GOTENBERG_SERVICE_PASSWORD` in production — the Compose default is a local key      |
| `SEARCH_PROVIDER`                                                                   | Optional    | Web search engine for every feature: `exa`, `serper`, `brave`, `tavily` or `searxng`. Unset or empty: the first one with a credential, in that order. Named but missing its credential: web search is off, never another engine. See [Web search](#web-search-optional) |
| `EXA_API_KEY`                                                                       | Optional    | Exa credential. The only engine with a company index (Prospects company search + lookalikes). ~$7 per 1,000 searches; $10 free monthly credit                                                                                                                           |
| `SERPER_API_KEY`                                                                    | Optional    | Serper (Google results) credential                                                                                                                                                                                                                                      |
| `BRAVE_SEARCH_API_KEY`                                                              | Optional    | Brave Search API credential                                                                                                                                                                                                                                             |
| `TAVILY_API_KEY`                                                                    | Optional    | Tavily credential                                                                                                                                                                                                                                                       |
| `SEARXNG_URL`                                                                       | Optional    | Base URL of a SearXNG instance with JSON output enabled, e.g. `http://searxng:8080` for the Compose `search` profile                                                                                                                                                    |
| `SEARXNG_SECRET`                                                                    | Optional    | Compose only: signs the bundled SearXNG's cookies. Override the local default in production                                                                                                                                                                             |
| `AZURE_DOC_INTELLIGENCE_*`                                                          | Optional    | OCR for scanned PDFs                                                                                                                                                                                                                                                    |
| `DATALAB_API_KEY`                                                                   | Optional    | Alternative OCR                                                                                                                                                                                                                                                         |
| `LANDING_AI_API_KEY`                                                                | Optional    | Fallback OCR                                                                                                                                                                                                                                                            |
| `DEPLOYMENT_MODE`                                                                   | Optional    | `self-hosted` (default when unset) or `cloud` — see [Self-hosting defaults](#self-hosting-defaults)                                                                                                                                                                     |
| `AI_MONTHLY_TOKEN_LIMIT_PER_USER`                                                   | Optional    | Monthly cap on one person's AI tokens (in + out) on this server's models, across all their workspaces; unset or `0` = none — see [AI allowances](#ai-allowances-per-person)                                                                                             |
| `AI_TOKEN_LIMIT_EXEMPT_EMAILS`                                                      | Optional    | Comma-separated emails the server-wide cap never applies to (yours, say)                                                                                                                                                                                                |
| `LANDING_PUBLIC_URL`                                                                | Optional    | Origin the public site (`apps/landing`) is served from, read per request. The logo, sign-out, Help, `/privacy` and `/terms` redirect there; set it when you run a prebuilt image                                                                                        |
| `NEXT_PUBLIC_SITE_URL`                                                              | Optional    | The same origin, inlined at build time; the fallback when `LANDING_PUBLIC_URL` is unset                                                                                                                                                                                 |
| `NEXT_PUBLIC_APP_URL`                                                               | Optional    | Origin this app is served from; where the public site's sign-in links point                                                                                                                                                                                             |
| `EMAIL_UNSUBSCRIBE_SECRET`                                                          | Conditional | HMAC key for unsubscribe links; required to send email campaigns, min 16 chars                                                                                                                                                                                          |
| `SUPPORT_CONTACT_EMAIL`                                                             | Optional    | Address the in-app contact form composes to. Unset hides the form                                                                                                                                                                                                       |
| `FEEDBACK_ADMIN_EMAILS`                                                             | Optional    | Turns on in-app bug reports and feature requests and names who triages them: account emails, comma/space/semicolon separated, case-insensitive. Unset keeps the feature off. Accounts are not email-verified, so create the operator's account before listing it        |
| `FEEDBACK_WEBHOOK_URL`                                                              | Optional    | Slack or Discord incoming webhook told about each new report — one line with the kind, severity, title and a Triage link; never the body, context or screenshots                                                                                                        |

The legacy variables (`SIDECAR_URL`, `ADEU_SERVICE_URL`, `OCR_ROUTER_URL`,
`OCR_WORKER_URL`) are being phased out per
[ADR-004](./architecture/ADR-004-compute-service-consolidation.md); while the
migration completes, set both the new and the legacy name if a service isn't
being picked up.

## AI allowances per person

Two limits can apply to a person; the tighter one binds. Both count AI tokens
in plus out, as the Usage tab reports them, by calendar month in
UTC, and reset on the 1st.

- **The server's** — `AI_MONTHLY_TOKEN_LIMIT_PER_USER`. It protects your model
  bill: it sums one person's calls on this server's own models across every
  workspace they belong to. Calls to an endpoint a workspace brought itself
  (Settings › Bring your own keys) never count toward it, and it does not apply
  while that workspace runs on its own models. People listed in
  `AI_TOKEN_LIMIT_EXEMPT_EMAILS` are never capped. Because anyone who creates a
  workspace owns it, this is the only limit an individual can't lift themselves.
- **The workspace's** — set in Usage › Spending › AI limits per person
  by anyone with _settings.manage_: a default for everyone, and an override per
  person (no limit, or a number of tokens). It counts all of the person's calls
  in that workspace, whoever's endpoint served them.

At a limit, new AI work is refused with a message that says which limit, when it
resets and who can raise it (HTTP 429, `code: "ai_allowance_reached"`). Work
already running — a background run, a meeting, indexing — finishes and is
counted; uploads are still accepted, and the AI that indexing spends on them
counts toward the uploader. Usage recorded before this feature shipped belongs
to no one, so allowances start counting from the upgrade.

## Post-deployment Checklist

- [ ] Environment variables set for all enabled features
- [ ] `DATABASE_URL` points to production DB
- [ ] `vector` extension enabled on PostgreSQL
- [ ] Schema applied (`pnpm --filter @launchstack/web db:migrate`, or the Compose `migrate` service / a one-shot job on the image)
- [ ] Sign-in (better-auth) and the selected chat provider/model validated
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
