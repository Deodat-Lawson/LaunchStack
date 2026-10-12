# Developer onboarding

This is the setup path for a new engineer on macOS, Windows, or Linux. Everyone runs the same services in Docker Compose. Host Node is only for hot reload and tests.

A future setup wizard should follow [What the wizard should do](#what-the-wizard-should-do). Until that exists, run the read-only check and then the commands below.

```bash
pnpm setup:check
# or, before dependencies are installed:
node scripts/dev/setup-doctor.mjs
```

The check never installs software and never writes `.env`. It tells you what is blocking and what is optional.

## What you end up running

`make up-prod` (or the `docker compose` equivalent) starts the local product. The web app accepts commands. The worker executes them. Uploads sit queued forever if the worker is not running.

| Service | Host port | Signup? | What it is |
|---|---|---|---|
| `app` | 3000 | No | Next.js app. Sign-in is `/signin`. The first account to sign up becomes the workspace owner. |
| `worker` | 8020 | No | Durable worker. Ingestion runs here (`/healthz`, `/readyz`). Background Inngest functions are served at `/api/inngest`. |
| `db` | 5433 | No | PostgreSQL 16 with pgvector. Database `pdr_ai_v2`, user `postgres`, password `password` unless `POSTGRES_PASSWORD` is set. |
| `migrate` | — | No | Applies engine migrations, then product migrations, then exits. Schema is never applied on app boot. |
| `seaweedfs` | 8333 (inside the network) | No | S3-compatible file storage. Compose points the app at it. |
| `inngest-dev` | 8288 | No | Inngest dev UI. Ingestion does not use it. Trend search, prospector, founder review, and the other background verticals do. |
| `transcription` | 8000 | No | Local Whisper + yt-dlp. Docs at `/docs`. First start downloads a model and can take a couple of minutes. |
| `adeu-docs-editing` | 8003 | No | Word redlining (tracked changes). Docs at `/docs`. |
| `document-converter` | 8002 | No | OCR routing, vision classification, PDF page rendering. Health at `/health`. |
| `gotenberg` | 8004 | No | The only PDF renderer (Office/HTML → PDF). Health requires basic auth (`launchstack` / `GOTENBERG_SERVICE_PASSWORD`). |
| `docling-serve` | — | No | Office/PDF parse engine. **Off** unless you start the `ocr` profile. Without it, converter `/convert` returns 503 and plain-text ingestion still works. |
| `seed` | — | No | On demand (`--profile seed`). Creates `owner@` / `admin@` / `member@` / `viewer@launchstack.test`. Refuses to run without `DEV_SEED_PASSWORD`. |
| `backfill` | — | No | On demand (`--profile backfill`). Never runs on boot. |

`apps/landing` (the public site, port 3001) is not in Compose. It has no database. Start it only when you are changing marketing pages:

```bash
pnpm --filter @launchstack/landing dev
```

The Python services under `services/` are not part of the pnpm workspace. Compose builds them.

## 1. Install Docker

Docker Desktop on macOS and Windows includes the engine and Compose v2. On Linux, install Docker Engine and the Compose plugin.

| OS | Install |
|---|---|
| macOS | https://docs.docker.com/desktop/setup/install/mac-install/ |
| Windows | https://docs.docker.com/desktop/setup/install/windows-install/ (WSL2 backend) |
| Linux | https://docs.docker.com/engine/install/ |

Start Docker Desktop and wait until the engine is running. `docker info` must succeed.

You do not need Node or pnpm to boot the stack. You need them to edit the app with hot reload, run Jest, or run `pnpm setup:check` via the package script. The check file itself is plain Node and also runs as `node scripts/dev/setup-doctor.mjs`.

- Node 20 or newer (CI uses 20; current local machines on 22 are fine)
- pnpm 10.15.1, the version in the root `packageManager` field: `corepack enable && corepack prepare pnpm@10.15.1 --activate`

Windows machines often have no `make`. Every `make` target below has a `docker compose` equivalent.

## 2. Create `.env`

```bash
git clone https://github.com/Deodat-Lawson/LaunchStack.git
cd LaunchStack
cp .env.example .env
```

`.env` is gitignored. Two values decide whether the stack boots. Everything else has a local default or turns a feature off.

**Required before `make up-prod`:**

```bash
# replace the placeholder BETTER_AUTH_SECRET=BETTER_AUTH_SECRET
openssl rand -base64 32
```

Put that output in `BETTER_AUTH_SECRET`. Compose passes this variable through with no default. An empty or placeholder value makes the app refuse to start.

Set the public origin the browser uses, or sign-up returns `Invalid origin`:

```text
BETTER_AUTH_URL=http://localhost:3000
```

Compose forwards `BETTER_AUTH_URL` when it is in `.env`. Host `next dev` reads the same file.

Leave `DATABASE_URL` on the line from `.env.example`:

```text
DATABASE_URL="postgresql://postgres:password@localhost:5433/pdr_ai_v2"
```

Containers do not use that URL. Compose injects `postgresql://postgres:<password>@db:5432/pdr_ai_v2` for `app`, `worker`, and `migrate`. The localhost URL is for host tools (`psql`, `db:migrate`, `db:seed`) against the published port **5433**.

**Clear the chat placeholder.** `.env.example` ships `CHAT_API_KEY="AIza..."`. That string is not a key. Delete it, or replace it with a real credential from the next section. Copying it as-is sends `AIza...` to Google.

## 3. Boot the stack

```bash
make up-prod
```

Windows, or any machine without `make`:

```powershell
docker compose --env-file .env up --build -d
```

Office documents (DOCX, PPTX, XLSX) need the Docling profile. It adds roughly 800MB of RAM on top of the lite stack (~400MB):

```bash
make up-ocr
# docker compose --env-file .env --profile ocr up --build -d
```

Then:

| Check | URL |
|---|---|
| App (redirects to sign-in) | http://localhost:3000 |
| Worker | http://localhost:8020/healthz |
| Inngest dev UI | http://localhost:8288 |
| Transcription docs | http://localhost:8000/docs |
| Adeu docs | http://localhost:8003/docs |
| Document converter | http://localhost:8002/health |

Logs and shutdown:

```bash
make logs
make down          # stop, keep the database and S3 volumes
make down-clean    # stop and delete volumes
```

The first boot builds the Next.js image, the worker image, and the Python services. Later boots reuse those images.

Sign up at http://localhost:3000/signup. The first person to sign up owns the workspace they create. There is no admin bootstrap.

Optional fixed accounts, after `DEV_SEED_PASSWORD` is set to 8 or more characters:

```bash
docker compose --env-file .env --profile seed run --rm seed
```

That creates one workspace and four users, all on that password:

- `owner@launchstack.test`
- `admin@launchstack.test`
- `member@launchstack.test`
- `viewer@launchstack.test`

The seed container does not start with `make up-prod`. Re-running it is safe.

## 4. Hot reload

Compose runs a production build of the app. UI changes are not picked up until the image is rebuilt.

For day-to-day UI work, keep Compose up so Postgres, SeaweedFS, the worker, and the compute services stay on the standard ports, and run the app on the host:

```bash
pnpm install
pnpm --filter @launchstack/web dev          # http://localhost:3000
```

Stop the Compose `app` container first if it already holds port 3000 (`docker compose stop app`). Leave `worker` running, or run a host worker against the same database:

```bash
pnpm --filter @launchstack/worker dev       # http://localhost:8020/healthz
```

Host `next dev` only accepts uploads. Ingestion still happens in the worker.

`make up-fast` builds Next on the host and then packages that build. It is a faster production-image loop, not hot reload.

Apply schema yourself only when you are not using Compose's `migrate` service:

```bash
pnpm --filter @launchstack/web db:migrate
```

That applies the engine set (`@launchstack/store`) and then the product set. `pnpm --filter @launchstack/store db:migrate` applies the engine set only.

## Environment variables

Boot validation lives in `apps/web/src/env.ts`. The groups below match that schema and the Compose file. `.env.example` is the annotated full list.

### Required to boot

| Variable | Where | External signup? |
|---|---|---|
| `BETTER_AUTH_SECRET` | `.env`, and required by Compose | No. `openssl rand -base64 32`. Signs session cookies. Rotating it signs everyone out. |
| `DATABASE_URL` | Required for any process that is not given one by Compose | No. Compose sets it inside containers. Host tools use the localhost:5433 URL above. |

`DEPLOYMENT_MODE` should stay unset on a developer machine. Unset means self-hosted: usage is recorded and never blocks uploads. `cloud` turns on the token-balance gate and makes `INNGEST_EVENT_KEY` mandatory. There is no in-product way to add credits, so a local stack in `cloud` mode stops accepting documents once the signup grant runs out.

### Chat — app boots without it, answers fail until it is set

Chat talks to one OpenAI-compatible endpoint. Model ids live in `apps/web/config/chat-models.yaml`, not in environment variables. See [Chat models](./chat-models.md).

| Choice | Variables | Signup |
|---|---|---|
| Google Gemini (the default when `CHAT_BASE_URL` is unset) | `GOOGLE_AI_API_KEY` | https://aistudio.google.com/apikey |
| Any other OpenAI-compatible host | `CHAT_BASE_URL` and `CHAT_API_KEY` | OpenAI, OpenRouter, MiniMax, or your own gateway |
| Ollama, llama.cpp, vLLM, LM Studio | `CHAT_BASE_URL=http://localhost:11434/v1` (or the server's URL). Leave the key empty. | No. Run the model server yourself. |

A bare `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, or `OLLAMA_BASE_URL` does not select a chat provider. The key and the URL are a pair. `AI_BASE_URL` / `AI_API_KEY` still work as deprecated names for the chat pair.

`CHAT_MODELS_CONFIG` is optional. It defaults to `config/chat-models.yaml` (the worker remaps that relative path onto the web app's copy).

### Embeddings — required for search indexing, not for boot

Embeddings have no default endpoint. Chat can fall back to Gemini. Embeddings cannot, because vectors are stored and only comparable within one model.

| Choice | Variables | Signup |
|---|---|---|
| Existing local corpus (default index `legacy-openai-1536`, 1536 dimensions, `text-embedding-3-large`) | `EMBEDDING_API_BASE_URL` + `EMBEDDING_API_KEY`, or `AI_BASE_URL` + `AI_API_KEY` | An OpenAI-compatible embeddings API. OpenAI is the model the default index was built for. |
| New empty database | Same URL pair, plus `EMBEDDING_INDEX=gemini-embedding-768` and `EMBEDDING_MODEL=gemini-embedding-001` pointed at Gemini | Google AI Studio key, as a pair with the Gemini OpenAI-compatible base URL |

Set both halves from the same place. A key without its base URL is ignored. Switching index on a database that already has vectors requires a full re-index.

`EMBEDDING_SECRETS_KEY` (32 random bytes, base64) encrypts per-company provider keys and connector tokens. Compose does not default it. Generate one before anyone saves a key in settings or connects Drive, Slack, GitHub, or Gmail:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Provided by Compose — no signup, local defaults

These are set in `docker-compose.yml` when `.env` leaves them empty. Override the passwords before any shared or production machine. They are local defaults, not secrets to commit.

| Variable | Local default | If you unset the service |
|---|---|---|
| `POSTGRES_PASSWORD` | `password` | Database auth fails. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET_NAME` | `pdr_local_key` / `pdr_local_secret` / `launchstack` | Compose forces `NEXT_PUBLIC_STORAGE_PROVIDER=s3` and the SeaweedFS endpoint. All five S3 fields are required in that mode. |
| `TRANSCRIPTION_SERVICE_URL` + `TRANSCRIPTION_SERVICE_API_KEY` | `http://transcription:8000` / `pdr_local_sidecar_key` | Audio transcription via the sidecar returns 401 or is unreachable. The service fails closed when the keys differ. |
| `ADEU_SERVICE_URL` + `ADEU_SERVICE_API_KEY` | `http://adeu-docs-editing:8000` / `pdr_local_adeu_key` | Word redlining returns 503/401. |
| `DOCUMENT_CONVERTER_URL` + `DOCUMENT_CONVERTER_API_KEY` | `http://document-converter:8002` / `pdr_local_converter_key` | OCR routing and parsing return 401. There is no unauthenticated fallback. |
| `GOTENBERG_SERVICE_URL` + username `launchstack` + `GOTENBERG_SERVICE_PASSWORD` | `http://gotenberg:3000` / `pdr_local_gotenberg_key` | Every "download as PDF" route returns 503. |
| `FILE_ACCESS_TOKEN_SECRET` | `pdr_local_file_access_secret` | Database-backed `/api/files/` fetches fail closed with 503. Compose's S3 mode still sets it so the converter can read file URLs. |
| `INNGEST_DEV` | `http://inngest-dev:8288` inside Compose | Set by Compose, not by you. The dev server ignores `INNGEST_EVENT_KEY`. |

`OCR_DEFAULT_PROVIDER` defaults to `DOCLING`. Without the `ocr` profile the converter cannot reach Docling.

Host-only development (no Compose) does not get these defaults. Set `NEXT_PUBLIC_STORAGE_PROVIDER=database` and your own `FILE_ACCESS_TOKEN_SECRET`, or point S3 variables at a store you run.

### Optional external accounts

Leave these unset until you are working on that feature. The UI shows the integration as not configured, or the stage is skipped.

| Variables | Feature | Where to sign up |
|---|---|---|
| `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET` | Google sign-in | Google Cloud OAuth client |
| `AUTH_GITHUB_CLIENT_ID` / `AUTH_GITHUB_CLIENT_SECRET` | GitHub sign-in | GitHub OAuth app |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` plus `GOOGLE_DOCS_EDITING_ENABLED=true` | Drive-linked files | Google Cloud, Drive API, redirect `<APP_PUBLIC_URL>/api/connectors/google/oauth/callback`. Needs `EMBEDDING_SECRETS_KEY`. |
| `NEXT_PUBLIC_GOOGLE_API_KEY` / `NEXT_PUBLIC_GOOGLE_APP_ID` | Google Picker for Drive import | Browser API key restricted to the Picker API, plus the Cloud **project number**. Build-time (`NEXT_PUBLIC_`). |
| `GMAIL_CONNECTOR_ENABLED=true` (same Google OAuth client) | Per-member Gmail sync | Gmail API. `gmail.readonly` is a restricted scope. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Workspace Slack connection | https://api.slack.com/apps |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` | Meeting mirror and Slack events | Slack app. Token alone is a read-only mirror. |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | Workspace GitHub connection | GitHub OAuth app. `repo` scope is read-write by GitHub's design. |
| `GITHUB_TOKEN` | Repo explainer fallback for private repos | GitHub PAT |
| `EXA_API_KEY` | Web search (`SEARCH_PROVIDER=exa`, the default when a search runs) | https://exa.ai |
| `SERPER_API_KEY` | Web search via Serper | https://serper.dev |
| `AZURE_DOC_INTELLIGENCE_ENDPOINT` / `AZURE_DOC_INTELLIGENCE_KEY` | Cloud OCR | Azure Document Intelligence |
| `LANDING_AI_API_KEY` | Cloud OCR fallback | Landing.AI |
| `DATALAB_API_KEY` | Cloud OCR | Datalab |
| `FOURSQUARE_SERVICE_KEY` | Client prospector places | Foursquare |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USER_AGENT` | Marketing pipeline | Reddit app |
| `TWITTER_BEARER_TOKEN` | Marketing pipeline | X developer account |
| `LINKEDIN_ACCESS_TOKEN` | Marketing pipeline | LinkedIn |
| `BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` | Marketing pipeline | Bluesky app password |
| `UPLOADTHING_TOKEN` | Legacy UploadThing uploader. `NEXT_PUBLIC_UPLOADTHING_ENABLED` is in the example. | UploadThing |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob instead of S3 | Vercel |
| `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY` / `LANGCHAIN_PROJECT` | LangSmith traces | LangSmith |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest Cloud. Local Compose uses `inngest-dev` and does not need these. | https://www.inngest.com |
| `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` plus `ENABLE_GRAPH_RETRIEVER` | Graph retrieval. Also needs `ENABLE_ENTITY_EXTRACTION`, which is off because it spends an NER call per chunk and nothing in the product reads those tables by default. | Neo4j, or leave unset |
| `OPENSANCTIONS_API_URL` | Sanctions screening in the distribution pipeline | Self-hosted or hosted `yente` |
| `EMAIL_UNSUBSCRIBE_SECRET` (16+ chars) and `EMAIL_SENDING_ENABLED=true` | Campaign mail actually sends. Anything else is a dry run. | Your mail transport, plus this HMAC secret |
| `SUPPORT_CONTACT_EMAIL` | In-app contact form. Unset, the page points at the issue tracker. | A mailbox you control |

Public search that does not need a key: SEC EDGAR (`SEC_EDGAR_USER_AGENT`, a `name email` contact string, default names the project) and Grants.gov (`GRANTS_GOV_ENABLED`, on unless set to `0`).

### Usually left alone locally

| Variable | Why it exists |
|---|---|
| `BETTER_AUTH_URL` | Public origin. Local sign-up needs `http://localhost:3000`. Behind a proxy, set the outside origin (`https://app.example.com`). |
| `MIGRATE_DATABASE_URL` | Direct Postgres URL when `DATABASE_URL` is a pooler (pgbouncer, Neon pooled, Supabase :6543). Migrations take a session advisory lock. |
| `APP_PUBLIC_URL` | Origin the converter uses to fetch `/api/files/`. Compose uses the in-network name. |
| `METRICS_SCRAPE_TOKEN` | Bearer token for `/api/metrics`. Unset locally means unauthenticated scrapes. Production returns 503 until it is set. |
| `TOKEN_SIGNUP_BONUS` | Signup grant. Default 10,000,000. Only enforced when `DEPLOYMENT_MODE=cloud`. |
| `ENABLE_DEV_ROUTES` | Serves auth-free `/dev/*` preview pages from a **production** build. `next dev` serves them anyway. |
| `LOG_LEVEL` | `fatal` through `trace`. Default `debug` in dev, `info` in prod. |
| `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` | Landing site origin and the app origin its sign-in links use. Build-time for the landing app. Dev defaults to localhost. |
| `CORS_ALLOWED_ORIGINS` | Extra browser origins for the API. |
| `IMAGE_REMOTE_PATTERNS` | Extra hosts for `next/image`. Build-time. |
| `WORKER_PORT` | Worker listen port. Default 8020. |
| `COLLAB_HUB_SECRET` | Remote collab workers. Unset, every agent runs in-process. |

Deprecated names still read, with a warning, while older deployments catch up: `AI_BASE_URL`, `AI_API_KEY`, `SIDECAR_URL`, `SIDECAR_API_KEY`, `DOCUMENT_EDITOR_URL`, `DOCUMENT_EDITOR_API_KEY`, `OCR_ROUTER_URL`. `OCR_WORKER_URL` is ignored. Prefer the names in the tables above.

## What the wizard should do

The wizard is not built yet. `pnpm setup:check` is the read-only probe. A wizard on top of it should do the following, in order, and stop at the first blocking step with one action for the person to take.

1. Detect macOS, Windows, or Linux.
2. If `docker` is missing, open the install page from the table in [Install Docker](#1-install-docker) and stop. Do not try to install Docker Desktop silently. It needs an administrator and, on Windows, a WSL2 reboot.
3. If `docker compose version` fails, point at the Compose plugin (Desktop already includes it).
4. If `docker info` fails, ask them to start Docker Desktop and re-run.
5. If `.env` is missing, copy `.env.example` to `.env`.
6. If `BETTER_AUTH_SECRET` is empty or still the placeholder `BETTER_AUTH_SECRET`, generate one and write it. Do not print it back. Set `BETTER_AUTH_URL=http://localhost:3000` when that line is missing, so browser sign-up is accepted.
7. Leave `DATABASE_URL` on `localhost:5433` unless they chose a database that is not the Compose one.
8. If `CHAT_API_KEY` is `AIza...` or chat has no credential, ask for a Google AI Studio key, an OpenAI-compatible URL plus key, or "skip — chat stays dark". Do not invent a key.
9. Ask the same single question for embeddings: Gemini on a new database (`gemini-embedding-768`), an OpenAI-compatible embeddings URL, or skip. Skipping means uploads will not become searchable.
10. Offer a `DEV_SEED_PASSWORD` (8+ characters) or skip. Skipping means they sign up in the browser.
11. Run `docker compose --env-file .env up --build -d`. Add `--profile ocr` only if they opted into Office parsing.
12. Wait until `http://localhost:3000` responds and `http://localhost:8020/healthz` returns success. Transcription's first start is allowed to take about two minutes.
13. If a seed password was set, run `docker compose --env-file .env --profile seed run --rm seed`.
14. Open `http://localhost:3000/signin`.

The wizard should not start `DEPLOYMENT_MODE=cloud`, should not put secrets in git, and should not run `make down-clean` on its own.

## Tests

With the database up (Compose on port 5433, or your own Postgres with pgvector):

```bash
pnpm check
pnpm --filter @launchstack/web test
```

CI's job is the full list: lint, typecheck, migration against Postgres, package tests, and web Jest. See [CONTRIBUTING](../CONTRIBUTING.md).
