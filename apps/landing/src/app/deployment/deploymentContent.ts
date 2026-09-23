/** Keep this reference aligned with the product checkout, not just the marketing branch. */
export const CONFIG_REVISION = "862963ca";
const repository = "https://github.com/Deodat-Lawson/LaunchStack";
export const sourceUrl = (path: string) => `${repository}/blob/${CONFIG_REVISION}/${path}`;
export type GuideLink = { label: string; href: string };
export type GuideBlock = {
    title: string;
    body: string[];
    code?: string;
    file?: string;
    note?: string;
    rows?: { name: string; detail: string }[];
    links?: GuideLink[];
};
export type Guide = {
    id: string;
    title: string;
    group: "Get started" | "Configure" | "Operate";
    summary: string;
    keywords: string;
    blocks: GuideBlock[];
    sources: GuideLink[];
};
const source = (label: string, path: string): GuideLink => ({ label, href: sourceUrl(path) });
const guideLink = (label: string, id: string): GuideLink => ({
    label,
    href: `/deployment?section=${id}`,
});

export const GUIDES: Guide[] = [
    {
        id: "main",
        title: "Deploy your workspace",
        group: "Get started",
        summary:
            "Run the startup operating system on infrastructure you control. Start with the local stack, configure your models, then choose a production host.",
        keywords: "overview quick start requirements install setup self hosted",
        blocks: [
            {
                title: "A complete workspace has two processes",
                body: [
                    "The web app serves the product and accepts work. A separate, long-running worker ingests documents and executes durable jobs. Both use the same PostgreSQL database, storage, credentials, and model configuration.",
                ],
                rows: [
                    { name: "Web app", detail: "The authenticated product. Local port 3000." },
                    {
                        name: "Worker",
                        detail: "Document ingestion, durable execution, and the Inngest endpoint. Local port 8020.",
                    },
                    {
                        name: "PostgreSQL + pgvector",
                        detail: "Workspace data, jobs, and vector search. Compose exposes it on port 5433.",
                    },
                    {
                        name: "Storage + processing",
                        detail: "S3-compatible objects, document conversion, editing, and PDF rendering. Compose supplies local services.",
                    },
                    {
                        name: "Public website",
                        detail: "A separate app in apps/landing, normally on port 3001. Its account links point to the web app.",
                    },
                ],
            },
            {
                title: "Start from the repository",
                body: [
                    "Use Git and Docker with the Compose plugin. For commands outside Docker, use Node.js 20 and pnpm 10.15.1. Run the commands from the repository root; keep .env private.",
                ],
                code: "git clone https://github.com/Deodat-Lawson/LaunchStack.git\ncd LaunchStack\ncp .env.example .env\nopenssl rand -base64 32",
                file: "Terminal",
                note: "The final command generates one secret. Generate independent values for BETTER_AUTH_SECRET and EMBEDDING_SECRETS_KEY, then place them in .env. Configure chat and embeddings before starting the stack.",
                links: [
                    guideLink("Configure chat & embeddings", "ai-providers"),
                    guideLink("Run the local Docker stack", "docker"),
                ],
            },
            {
                title: "Choose your route",
                body: [
                    "Docker is the most complete local path. The production overlay adds a TLS proxy and published app/worker images. Vercel can host the web frontend, but still needs a separately hosted worker and services.",
                ],
                links: [
                    guideLink("Local Docker setup", "docker"),
                    guideLink("Production with Compose", "production"),
                    guideLink("Local development", "local-dev"),
                    guideLink("Vercel & split hosting", "vercel"),
                ],
            },
        ],
        sources: [
            source("Compose service definitions", "docker-compose.yml"),
            source("Workspace commands", "package.json"),
        ],
    },
    {
        id: "docker",
        title: "Local Docker setup",
        group: "Get started",
        summary: "Run the app, worker, database, object storage, and document services together.",
        keywords: "docker compose install setup local ports docling ocr make",
        blocks: [
            {
                title: "1. Set the required configuration",
                body: [
                    "Copy .env.example to .env, generate a BETTER_AUTH_SECRET, and choose chat and embedding providers. Compose constructs DATABASE_URL for its db service from POSTGRES_PASSWORD; it does not use your host database URL.",
                ],
                code: "DEPLOYMENT_MODE=self-hosted\nPOSTGRES_PASSWORD=replace-with-a-strong-password\nBETTER_AUTH_SECRET=replace-with-an-independent-random-secret\nBETTER_AUTH_URL=http://localhost:3000\nEMBEDDING_SECRETS_KEY=replace-with-32-random-bytes-in-base64",
                file: ".env · add your AI settings too",
                links: [guideLink("Chat, model routes & embeddings", "ai-providers")],
            },
            {
                title: "2. Start the complete document stack",
                body: [
                    "Enable the ocr profile for the default Docling parser. The migrate service applies both engine and product migrations before the app and worker start.",
                ],
                code: "docker compose --env-file .env --profile ocr up --build -d\ndocker compose ps\ndocker compose logs --tail=100 migrate app worker",
                file: "Terminal",
                note: "Without the ocr profile, the default local parser is unavailable: PDF/Office conversion can return 503 even while text uploads work. A configured cloud OCR provider is the alternative.",
            },
            {
                title: "3. Open the product and verify a document",
                body: [
                    "Visit http://localhost:3000, create an account, and add a workspace. Upload a small document, wait for processing, then ask a question and open its citation.",
                ],
                rows: [
                    { name: "http://localhost:3000", detail: "Product and account creation." },
                    {
                        name: "http://localhost:8020/healthz",
                        detail: "Worker liveness. /readyz also checks database readiness.",
                    },
                    {
                        name: "http://localhost:8288",
                        detail: "Local Inngest dashboard for optional background workflows.",
                    },
                    {
                        name: "localhost:5433",
                        detail: "PostgreSQL for local tools; inside Compose use db:5432.",
                    },
                ],
                note: "make up-prod runs the base Compose stack. Use the production overlay explicitly for the public deployment described in this guide.",
            },
        ],
        sources: [
            source("Local Compose stack", "docker-compose.yml"),
            source("Make targets", "Makefile"),
        ],
    },
    {
        id: "production",
        title: "Production with Compose",
        group: "Get started",
        summary:
            "Use the production overlay for a public instance with TLS, private service ports, and a persistent worker.",
        keywords: "production server vm caddy tls domain ghcr deploy ssl environment override",
        blocks: [
            {
                title: "Prepare the host and domains",
                body: [
                    "Use a current Docker Compose plugin that supports !reset (2.24.4 or newer). Point DOMAIN, files.DOMAIN, and home.DOMAIN at the server. The supplied Caddy configuration sends the product to app:3000, /api/inngest to worker:8020, files to SeaweedFS, and the public site to landing:3001.",
                ],
                code: "DOMAIN=workspace.example.com\nACME_EMAIL=ops@example.com\nBETTER_AUTH_URL=https://workspace.example.com\nAPP_PUBLIC_URL=https://workspace.example.com\nOCR_DEFAULT_PROVIDER=AZURE\nAZURE_DOC_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com\nAZURE_DOC_INTELLIGENCE_KEY=replace-with-your-resource-key\nCONVERTER_ALLOWED_FETCH_ORIGINS=https://workspace.example.com,https://files.workspace.example.com\nADEU_ALLOWED_FETCH_ORIGINS=https://workspace.example.com,https://files.workspace.example.com",
                file: ".env · example public origins and cloud OCR",
                note: "Replace the local defaults for database, storage, auth, file tokens, and all service credentials. Keep EMBEDDING_SECRETS_KEY stable: it protects stored provider credentials and OAuth grants.",
                links: [
                    {
                        label: "Docker Compose merge reference",
                        href: "https://docs.docker.com/reference/compose-file/merge/",
                    },
                ],
            },
            {
                title: "Forward settings to both processes",
                body: [
                    "Compose uses an explicit environment allowlist. A value in .env reaches a container only if that service forwards it. Add an operator override for settings absent from the base file, including APP_PUBLIC_URL and any OAuth or feature flags you enable.",
                ],
                code: "services:\n  app:\n    environment: &operator-env\n      APP_PUBLIC_URL: ${APP_PUBLIC_URL:?Set the public app origin}\n  worker:\n    environment: *operator-env",
                file: "docker-compose.operator.yml",
                note: "Add provider client IDs, secrets, and feature flags to this shared block when enabling connections or optional capabilities. Existing base values are retained by the Compose merge.",
            },
            {
                title: "Build the public site for your origins",
                body: [
                    "NEXT_PUBLIC_* variables are bundled at build time. The current landing Dockerfile does not consume build arguments for its origins; runtime environment entries in the production overlay cannot rewrite account links already in the browser bundle. Add the following to its builder stage before the build command, then pass matching build.args on the landing service.",
                ],
                code: "ARG NEXT_PUBLIC_SITE_URL\nARG NEXT_PUBLIC_APP_URL\nENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL\nENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL",
                file: "apps/landing/Dockerfile · builder stage",
                links: [
                    guideLink("Public-site build commands", "vercel"),
                    {
                        label: "Next.js environment variables",
                        href: "https://nextjs.org/docs/app/guides/environment-variables",
                    },
                ],
            },
            {
                title: "Set landing build arguments",
                body: [
                    "Extend the same operator override with the landing service below. Use the same origins for the build and runtime settings.",
                ],
                code: "  landing:\n    build:\n      args:\n        NEXT_PUBLIC_SITE_URL: https://home.${DOMAIN}\n        NEXT_PUBLIC_APP_URL: https://${DOMAIN}",
                file: "docker-compose.operator.yml · under services",
            },
            {
                title: "Start and check the merged stack",
                body: [
                    "The overlay uses published app and worker images; migrations still build from your checkout. For repeatable releases, pin both images to a tested release or digest and use a matching source checkout for migrations and model configuration. Preview the merged service names, then start.",
                ],
                code: "docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.operator.yml --env-file .env config --services\ndocker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.operator.yml --env-file .env up --build -d\ndocker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.operator.yml logs --tail=100 migrate app worker caddy",
                file: "Terminal",
                note: "The lean overlay disables local Whisper and the Inngest dev server. Configure cloud transcription and OCR, or explicitly enable the relevant profiles. The supplied files hostname serves objects anonymously by URL; choose storage and access controls that fit your deployment.",
                links: [
                    guideLink("Workers & scheduled jobs", "workers"),
                    guideLink("Health, updates & backups", "operations"),
                ],
            },
        ],
        sources: [
            source("Production overlay", "docker-compose.prod.yml"),
            source("Caddy routes", "docker/Caddyfile.prod"),
            source("Landing Dockerfile", "apps/landing/Dockerfile"),
        ],
    },
    {
        id: "local-dev",
        title: "Local development",
        group: "Get started",
        summary: "Run the web app and worker from source while keeping infrastructure in Docker.",
        keywords: "pnpm dev node migration db migrate verify store package local development",
        blocks: [
            {
                title: "Install and configure",
                body: [
                    "Use Node.js 20 and pnpm 10.15.1. Copy .env.example to .env and configure auth, chat, and embeddings. Point host processes at localhost service ports; Compose hostnames such as db and document-converter only resolve inside the Docker network.",
                ],
                code: "corepack enable\ncorepack prepare pnpm@10.15.1 --activate\npnpm install --frozen-lockfile\ndocker compose --profile ocr up -d db seaweedfs docling-serve transcription adeu-docs-editing document-converter gotenberg",
                file: "Terminal",
            },
            {
                title: "Use host-reachable endpoints",
                body: [
                    "Use the POSTGRES_PASSWORD from your Compose setup in the connection string. Copy the corresponding service keys from .env and keep them identical on the clients and service containers.",
                ],
                code: "DATABASE_URL=postgresql://postgres:your-password@localhost:5433/pdr_ai_v2\nBETTER_AUTH_URL=http://localhost:3000\nAPP_PUBLIC_URL=http://host.docker.internal:3000\nTRANSCRIPTION_SERVICE_URL=http://localhost:8000\nDOCUMENT_CONVERTER_URL=http://localhost:8002\nADEU_SERVICE_URL=http://localhost:8003\nGOTENBERG_SERVICE_URL=http://localhost:8004",
                file: ".env · host-run processes",
                note: "host.docker.internal lets Docker Desktop services fetch database-backed files from your host. Linux hosts need an equivalent host-gateway mapping. Allow that exact origin in the converter/editing fetch allowlists. Use a browser-reachable APP_PUBLIC_URL when testing OAuth callbacks.",
                links: [
                    guideLink("Storage configuration", "storage"),
                    guideLink("Document services", "processing"),
                ],
            },
            {
                title: "Migrate, then run both processes",
                body: [
                    "The web migration command applies engine and product SQL. Run the web app and worker in separate terminals; a web server alone will not process document jobs.",
                ],
                code: "pnpm --filter @launchstack/web db:migrate\npnpm --filter @launchstack/web db:verify\npnpm --filter @launchstack/web dev",
                file: "Terminal 1",
            },
            {
                title: "Start the worker",
                body: [
                    "The worker reads the same provider and database configuration. Use the separate public-site development command only when working on the marketing website.",
                ],
                code: "pnpm --filter @launchstack/worker dev",
                file: "Terminal 2",
                links: [guideLink("Inngest development server", "workers")],
            },
        ],
        sources: [
            source("Web scripts", "apps/web/package.json"),
            source("Worker scripts", "apps/worker/package.json"),
            source("Environment reference", ".env.example"),
        ],
    },
    {
        id: "ai-providers",
        title: "Chat & embeddings",
        group: "Configure",
        summary:
            "Choose one chat endpoint, define model routes, and configure the embedding provider independently.",
        keywords:
            "AI models Gemini OpenAI OpenRouter Ollama chat yaml embedding index key base url rerank ner settings",
        blocks: [
            {
                title: "Chat endpoint and model routes",
                body: [
                    "CHAT_BASE_URL and CHAT_API_KEY select one OpenAI-compatible chat endpoint. apps/web/config/chat-models.yaml assigns the default, fast, reasoning, and vision routes. The checked-in file uses vendor-prefixed IDs; those IDs must be available at the endpoint you select.",
                    "For a direct Gemini endpoint, use bare model IDs with a matching registered preset or explicit behavior. The example below illustrates the current schema with an existing preset; confirm the model is available on your provider account.",
                ],
                code: "CHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai\nCHAT_API_KEY=replace-with-your-gemini-key\nCHAT_MODELS_CONFIG=config/chat-models.yaml",
                file: ".env",
            },
            {
                title: "An explicit model configuration",
                body: [
                    "This minimal example uses one model for every route. Add distinct models when you want a separate fast or reasoning tier. Unknown models require a complete behavior definition; the app does not infer capabilities from the model name.",
                ],
                code: "version: 1\nmodels:\n  primary:\n    id: gemini-2.5-flash\n    preset: google/gemini-2.5-flash\nroutes:\n  default: primary\n  fast: primary\n  reasoning: primary\n  vision: primary",
                file: "apps/web/config/chat-models.yaml",
                note: "Compose mounts this file read-only into both app and worker. After a model edit, restart both processes. For host development, use an absolute CHAT_MODELS_CONFIG path if their working directories differ.",
            },
            {
                title: "Embeddings are a separate configuration",
                body: [
                    "Chat credentials do not configure embeddings. Supply EMBEDDING_API_BASE_URL and EMBEDDING_API_KEY together, plus a model compatible with the selected index. The default index, legacy-openai-1536, stores 1536-dimensional vectors.",
                    "For a new, empty workspace using the registered Gemini index, use the following settings. Do not apply this switch to an existing corpus without a reindex plan: stored vectors belong to a specific model and dimension.",
                ],
                code: "EMBEDDING_INDEX=gemini-embedding-768\nEMBEDDING_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai\nEMBEDDING_API_KEY=replace-with-your-gemini-key\nEMBEDDING_MODEL=gemini-embedding-001",
                file: ".env · new Gemini corpus only",
            },
            {
                title: "Supporting capabilities and workspace settings",
                body: [
                    "AI_BASE_URL + AI_API_KEY provide a global endpoint pair for non-chat capabilities. Per-capability EMBEDDING_*, RERANK_*, NER_*, and TRANSCRIPTION_* API pairs can override it. Keep each key paired with its intended endpoint.",
                    "Workspace Settings → Models shows the resolved chat models and routes as a read-only view. Settings → Processing manages workspace embedding settings. EMBEDDING_SECRETS_KEY must contain 32 random bytes encoded as base64 to encrypt workspace provider credentials. Preserve that key across restarts and restores.",
                ],
                note: "GOOGLE_MODEL is not the chat model selector. Use the mounted YAML. Do not replace the embedding index just to change the chat model.",
            },
        ],
        sources: [
            source("Chat model configuration", "apps/web/config/chat-models.yaml"),
            source("Model presets", "packages/llm/src/presets.ts"),
            source("Embedding index registry", "packages/llm/src/embeddings/index-registry.ts"),
            source(
                "Workspace model settings",
                "apps/web/src/app/employer/documents/_workspace/settings/ModelsSection.tsx"
            ),
        ],
    },
    {
        id: "storage",
        title: "Files & object storage",
        group: "Configure",
        summary:
            "Choose S3-compatible object storage or PostgreSQL-backed files. Vercel Blob and UploadThing are not required for the default upload path.",
        keywords:
            "storage upload files s3 seaweedfs minio postgres database blob uploadthing token",
        blocks: [
            {
                title: "S3-compatible storage",
                body: [
                    "Set NEXT_PUBLIC_STORAGE_PROVIDER=s3 and all five S3 settings. Compose configures SeaweedFS automatically. For another object store, supply its endpoint, region, access key, secret, and bucket, and ensure browser-facing object URLs are reachable.",
                ],
                code: "NEXT_PUBLIC_STORAGE_PROVIDER=s3\nNEXT_PUBLIC_S3_ENDPOINT=https://objects.example.com\nS3_REGION=us-east-1\nS3_ACCESS_KEY=replace-with-storage-access-key\nS3_SECRET_KEY=replace-with-storage-secret\nS3_BUCKET_NAME=launchstack",
                file: ".env",
                note: "The base Compose stack pins its endpoint to SeaweedFS. Override app and worker environment entries when changing stores; editing .env alone will not replace those fixed values. Never put storage secrets in NEXT_PUBLIC_* variables.",
            },
            {
                title: "PostgreSQL-backed files",
                body: [
                    "Set NEXT_PUBLIC_STORAGE_PROVIDER=database to store file content in PostgreSQL. This is the fallback when no complete S3 configuration exists. It is database storage, not a local disk directory.",
                ],
                code: "NEXT_PUBLIC_STORAGE_PROVIDER=database\nFILE_ACCESS_TOKEN_SECRET=replace-with-an-independent-random-secret\nAPP_PUBLIC_URL=https://workspace.example.com",
                file: ".env",
                note: "The app and worker must share FILE_ACCESS_TOKEN_SECRET. Conversion services must be able to reach APP_PUBLIC_URL and allow it as a fetch origin, because they read short-lived signed /api/files URLs.",
            },
            {
                title: "Existing Blob and UploadThing deployments",
                body: [
                    "BLOB_READ_WRITE_TOKEN and UPLOADTHING_TOKEN remain relevant to compatible legacy paths and existing files. Keep credentials needed to read those objects during a migration. New standard uploads can use S3 or PostgreSQL without either service.",
                    "Back up the database and object store together. Changing the backend does not automatically move previously uploaded objects.",
                ],
                links: [
                    guideLink("Service origins & credentials", "processing"),
                    guideLink("Backups and release checks", "operations"),
                ],
            },
        ],
        sources: [
            source("Storage backend selection", "apps/web/src/lib/storage.ts"),
            source("Storage environment schema", "apps/web/src/env.ts"),
        ],
    },
    {
        id: "auth",
        title: "Accounts & access",
        group: "Configure",
        summary:
            "Configure the built-in Better Auth accounts, public origins, and optional social sign-in.",
        keywords:
            "authentication better auth secret login signup google github oauth origins clerk",
        blocks: [
            {
                title: "Required account configuration",
                body: [
                    "The app uses Better Auth with its PostgreSQL database. Generate a stable BETTER_AUTH_SECRET and set BETTER_AUTH_URL to the actual public product origin, particularly behind a reverse proxy.",
                ],
                code: "BETTER_AUTH_SECRET=replace-with-a-random-secret\nBETTER_AUTH_URL=https://workspace.example.com\nAPP_PUBLIC_URL=https://workspace.example.com\nDEPLOYMENT_MODE=self-hosted",
                file: ".env",
                note: "Keep the landing origin separate from the authenticated app origin. The public site's NEXT_PUBLIC_APP_URL must be set during its build.",
            },
            {
                title: "Optional social sign-in",
                body: [
                    "AUTH_GOOGLE_CLIENT_ID / AUTH_GOOGLE_CLIENT_SECRET enable Google sign-in. AUTH_GITHUB_CLIENT_ID / AUTH_GITHUB_CLIENT_SECRET enable GitHub sign-in. Register the callback URLs required by the configured Better Auth provider on your public origin.",
                    "Sign-in OAuth and workspace connections use different configuration names. A working Google login does not configure a Google Drive connection.",
                ],
                links: [guideLink("Workspace connection setup", "connections")],
            },
            {
                title: "Deployment mode",
                body: [
                    "self-hosted is the default mode. cloud enables the hosted product's metering path and requires INNGEST_EVENT_KEY. Use self-hosted for an instance you operate, and configure workspace memberships and roles in the product.",
                    "Keep development preview routes disabled on public instances. ENABLE_DEV_ROUTES is for isolated development previews.",
                ],
            },
        ],
        sources: [
            source("Authentication implementation", "apps/web/src/server/auth/index.ts"),
            source("Validated environment", "apps/web/src/env.ts"),
        ],
    },
    {
        id: "workers",
        title: "Workers & scheduled jobs",
        group: "Configure",
        summary:
            "Keep document ingestion running, then enable Inngest for the background workflows that use it.",
        keywords:
            "worker outbox ingestion background jobs inngest events signing key cron health ready",
        blocks: [
            {
                title: "The worker is required for ingestion",
                body: [
                    "The app accepts document work into a durable database outbox. The worker consumes it. Inngest is not required for that ingestion path, but stopping the worker leaves accepted work waiting.",
                    "Run app and worker with the same database, storage, provider configuration, and encryption keys. The worker exposes /healthz for liveness and /readyz for a bounded database readiness check.",
                ],
            },
            {
                title: "Local Inngest",
                body: [
                    "The base Docker stack runs an Inngest dev server registered against http://worker:8020/api/inngest. For host development, run the worker first and launch the CLI below. Configure INNGEST_DEV for the dev server's reachable origin.",
                ],
                code: "pnpm --filter @launchstack/web inngest:dev",
                file: "Separate development terminal",
                note: "The serve endpoint belongs to the worker on port 8020, not the Next.js app on port 3000.",
            },
            {
                title: "Production Inngest",
                body: [
                    "The production overlay clears INNGEST_DEV and removes the dev server from the default stack. For workflows using Inngest, configure an event key and signing key, then register the worker's publicly reachable serve URL with your Inngest environment.",
                ],
                code: "INNGEST_EVENT_KEY=replace-with-your-event-key\nINNGEST_SIGNING_KEY=replace-with-your-signing-key",
                file: ".env",
                note: "The supplied Caddy route serves the worker at https://your-domain/api/inngest. Keep the signing key consistent with the registered Inngest environment.",
                links: [
                    {
                        label: "Serving Inngest functions",
                        href: "https://www.inngest.com/docs/learn/serving-inngest-functions",
                    },
                    {
                        label: "Signing keys",
                        href: "https://www.inngest.com/docs/platform/signing-keys",
                    },
                ],
            },
        ],
        sources: [
            source("Worker entry point", "apps/worker/src/main.ts"),
            source("Production services", "docker-compose.prod.yml"),
        ],
    },
    {
        id: "processing",
        title: "Documents, audio & editing",
        group: "Configure",
        summary:
            "Configure the document parser, conversion services, audio providers, and PDF export used by the workspace.",
        keywords:
            "ocr azure landing ai datalab docling converter adeu gotenberg pdf word voice audio transcription tts whisper",
        blocks: [
            {
                title: "Document parsing and OCR",
                body: [
                    "OCR_DEFAULT_PROVIDER selects the parser. Local Compose defaults to DOCLING, which needs --profile ocr. Cloud options include AZURE, LANDING_AI, and DATALAB; set the selected provider's credentials on both app and worker.",
                ],
                rows: [
                    {
                        name: "AZURE",
                        detail: "AZURE_DOC_INTELLIGENCE_ENDPOINT + AZURE_DOC_INTELLIGENCE_KEY.",
                    },
                    { name: "LANDING_AI", detail: "LANDING_AI_API_KEY." },
                    { name: "DATALAB", detail: "DATALAB_API_KEY." },
                    {
                        name: "DOCLING",
                        detail: "Local Docling service through the document converter; enable the ocr profile.",
                    },
                ],
                note: "Use DOCUMENT_CONVERTER_URL for the current conversion service. OCR_WORKER_URL is obsolete; OCR_ROUTER_URL is a deprecated fallback.",
            },
            {
                title: "Conversion, editing, and PDF export",
                body: [
                    "Compose wires these services and local development credentials. For remote services, share the matching credential with each server and allow only the origins from which that service needs to fetch files.",
                ],
                rows: [
                    {
                        name: "Document converter",
                        detail: "DOCUMENT_CONVERTER_URL + DOCUMENT_CONVERTER_API_KEY on clients. Server uses CONVERTER_API_KEY and ALLOWED_FETCH_ORIGINS; Compose reads CONVERTER_ALLOWED_FETCH_ORIGINS.",
                    },
                    {
                        name: "ADEU editing",
                        detail: "ADEU_SERVICE_URL + ADEU_SERVICE_API_KEY. Configure ADEU_ALLOWED_FETCH_ORIGINS for app and storage origins.",
                    },
                    {
                        name: "Gotenberg PDF export",
                        detail: "GOTENBERG_SERVICE_URL, GOTENBERG_SERVICE_USERNAME, and GOTENBERG_SERVICE_PASSWORD. Uses Basic auth.",
                    },
                ],
                note: "Missing conversion services can surface as a typed 503 for the affected action. Health-check the service and its credentials before retrying a failed document.",
            },
            {
                title: "Audio transcription",
                body: [
                    "Cloud is the default transcription mode. Configure TRANSCRIPTION_API_BASE_URL + TRANSCRIPTION_API_KEY and TRANSCRIPTION_MODEL independently from chat when using a dedicated compatible endpoint.",
                    "For local Whisper, set TRANSCRIPTION_PROVIDER=sidecar plus TRANSCRIPTION_SERVICE_URL and TRANSCRIPTION_SERVICE_API_KEY. The service uses TRANSCRIPTION_API_KEY for the matching server credential. The production overlay requires --profile whisper, and TRANSCRIPTION_PROVIDER must be explicitly forwarded into app and worker.",
                ],
            },
            {
                title: "Spoken responses",
                body: [
                    "Text-to-speech uses GOOGLE_AI_API_KEY with Google Cloud Text-to-Speech enabled. GEMINI_TTS_VOICE selects the voice; the current default is en-US-Chirp3-HD-Kore. A chat endpoint key alone does not enable this service.",
                ],
            },
        ],
        sources: [
            source("Processing environment", "apps/web/src/env.ts"),
            source("Service wiring", "docker-compose.yml"),
            source("Provider defaults", "packages/llm/src/types.ts"),
        ],
    },
    {
        id: "connections",
        title: "Workspace connections",
        group: "Configure",
        summary:
            "Enable the connections now offered in the product: Google Drive, Slack, GitHub, and opt-in Gmail.",
        keywords:
            "connections integrations google drive gmail slack github oauth picker encryption sync",
        blocks: [
            {
                title: "Enable secure credential storage first",
                body: [
                    "Every workspace connection needs EMBEDDING_SECRETS_KEY plus its OAuth client pair. Without both, the product reports the provider as not configured. Generate the encryption key from 32 random bytes encoded as base64 and preserve it for the lifetime of stored grants.",
                ],
                code: "openssl rand -base64 32",
                file: "Generate a new encryption key",
                note: "Compose already forwards EMBEDDING_SECRETS_KEY. Forward the connection-specific environment variables into app and worker in your operator override as well.",
                links: [guideLink("Compose environment forwarding", "production")],
            },
            {
                title: "Provider configuration",
                body: [
                    "Register each callback on your public APP_PUBLIC_URL. Connection credentials are separate from AUTH_GOOGLE_* and AUTH_GITHUB_* social sign-in credentials.",
                ],
                rows: [
                    {
                        name: "Google Drive",
                        detail: "GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET. Callback: /api/connectors/google/oauth/callback.",
                    },
                    {
                        name: "Slack",
                        detail: "SLACK_CLIENT_ID + SLACK_CLIENT_SECRET. Callback: /api/connectors/slack/oauth/callback.",
                    },
                    {
                        name: "GitHub",
                        detail: "GITHUB_OAUTH_CLIENT_ID + GITHUB_OAUTH_CLIENT_SECRET. Callback: /api/connectors/github/oauth/callback.",
                    },
                    {
                        name: "Gmail · opt-in",
                        detail: "The Google OAuth pair plus GMAIL_CONNECTOR_ENABLED=true. Uses a separate mailbox grant and the shared Google callback; reads mail without sending or deleting it.",
                    },
                ],
                note: "Gmail uses the restricted gmail.readonly scope. Prepare the Google consent screen and the verification or internal-app setup before enabling it for users.",
            },
            {
                title: "Google Picker and linked editing",
                body: [
                    "The Google file picker needs NEXT_PUBLIC_GOOGLE_API_KEY (a restricted browser API key) and NEXT_PUBLIC_GOOGLE_APP_ID (the numeric project ID) at web-app build time.",
                    "GOOGLE_DOCS_EDITING_ENABLED=true enables the separate Drive-linked editing capability. It is not required merely to configure a Drive knowledge connection.",
                ],
            },
            {
                title: "Host-local agent sources",
                body: [
                    "AGENT_KNOWLEDGE_CONNECTOR_ENABLED with AGENT_KNOWLEDGE_PROJECT_ROOTS enables access to configured project roots on the server host. AGENT_SESSIONS_CONNECTOR_ENABLED enables local agent transcript sources. These are optional personal-instance capabilities: a hosted server does not gain access to a visitor's local computer.",
                ],
            },
        ],
        sources: [
            source(
                "Connection availability gates",
                "apps/web/src/server/services/connectors/config.ts"
            ),
            source(
                "Gmail configuration",
                "apps/web/src/server/services/connectors/gmail/config.ts"
            ),
            source("Environment schema", "apps/web/src/env.ts"),
        ],
    },
    {
        id: "capabilities",
        title: "Search, images & campaigns",
        group: "Configure",
        summary:
            "Enable supporting capabilities as you need them, without treating every integration as a setup requirement.",
        keywords:
            "optional search exa serper langchain langsmith tracing images campaigns email sending collaboration slack",
        blocks: [
            {
                title: "Web research",
                body: [
                    "SEARCH_PROVIDER selects exa, serper, fallback, or parallel. Supply EXA_API_KEY and/or SERPER_API_KEY for the chosen strategy. Forward settings absent from the Compose allowlist to the processes that use them.",
                ],
            },
            {
                title: "Image generation",
                body: [
                    "IMAGE_API_BASE_URL + IMAGE_API_KEY select an optional image endpoint; IMAGE_MODEL selects its model. If unset, the tool falls back to the chat endpoint pair. The endpoint and model must actually support image generation.",
                    "IMAGE_API_SHAPE can explicitly select openrouter, openai-compatible, or gemini-native for a gateway whose hostname does not identify its wire format.",
                ],
            },
            {
                title: "Campaign delivery",
                body: [
                    "Campaign sends run as a dry run unless EMAIL_SENDING_ENABLED=true. Before enabling delivery, configure the campaign's sending integration and a stable EMAIL_UNSUBSCRIBE_SECRET of at least 16 characters. Enabling the flag alone does not configure a mail provider.",
                ],
            },
            {
                title: "Tracing and collaboration",
                body: [
                    "LANGCHAIN_TRACING_V2, LANGCHAIN_API_KEY, and LANGCHAIN_PROJECT configure optional LangSmith tracing.",
                    "Remote-agent collaboration can use COLLAB_HUB_SECRET. Slack collaboration mirroring uses SLACK_BOT_TOKEN; inbound events also need SLACK_SIGNING_SECRET and the /api/collab/slack/events route. These settings are distinct from the Slack knowledge connection's OAuth client pair.",
                ],
            },
        ],
        sources: [
            source("Environment reference", ".env.example"),
            source("Validated configuration", "apps/web/src/env.ts"),
        ],
    },
    {
        id: "operations",
        title: "Health, updates & backups",
        group: "Operate",
        summary:
            "Check the whole request path and keep your data, configuration, and release versions together.",
        keywords:
            "health ready metrics scrape monitor backup update migration deploy troubleshooting 503 indexing",
        blocks: [
            {
                title: "Verify the running release",
                body: [
                    "Check worker liveness and readiness, review the migration result, and verify both migration sets. In the public Compose stack the worker ports are internal; run its health checks from inside the deployment network.",
                ],
                code: "pnpm --filter @launchstack/web db:verify\ncurl --fail http://localhost:8020/healthz\ncurl --fail http://localhost:8020/readyz",
                file: "Host development checks",
                note: "The curl examples use exposed local ports. Run db:verify with the same DATABASE_URL and source version as the deployed app.",
            },
            {
                title: "Check the actual product path",
                body: [
                    "Sign in, upload a small document, wait until it is ready, ask a source-grounded question, and open the citation. If enabled, also test a PDF export and one connection with its configured OAuth callback.",
                ],
                rows: [
                    {
                        name: "Upload stays queued",
                        detail: "Check worker readiness, shared DATABASE_URL, and worker logs.",
                    },
                    {
                        name: "Conversion returns 503",
                        detail: "Check the selected OCR provider, Docling profile, service health, credentials, and allowed fetch origins.",
                    },
                    {
                        name: "Chat or vectors fail",
                        detail: "Check endpoint/key pairs, YAML routes, and the embedding model/index pairing.",
                    },
                    {
                        name: "Connection is not configured",
                        detail: "Check the provider client pair, encryption key, feature flag if required, and Compose environment forwarding.",
                    },
                    {
                        name: "Account link points to another host",
                        detail: "Rebuild the public site with NEXT_PUBLIC_APP_URL set to your product origin.",
                    },
                ],
            },
            {
                title: "Metrics",
                body: [
                    "Set METRICS_SCRAPE_TOKEN to enable authenticated production access to /api/metrics. Send it as a Bearer token from your scraper. In production, the route returns 503 when that token is not configured.",
                ],
            },
            {
                title: "Updates and backups",
                body: [
                    "Back up PostgreSQL, uploaded objects, mounted model configuration, and the secrets needed to decrypt stored credentials. Test restores before relying on them.",
                    "Use a matching source checkout and app/worker release. Review pending migrations before an update, run the web db:migrate command for both migration sets, and restart app and worker together. An image rollback does not undo database migrations.",
                    "For a model-only change, edit the mounted YAML and restart both processes. Keep the embedding index unchanged unless you are deliberately reindexing the corpus.",
                ],
            },
        ],
        sources: [
            source("Migration commands", "apps/web/package.json"),
            source("Worker health routes", "apps/worker/src/main.ts"),
            source("Metrics route", "apps/web/src/app/api/metrics/route.ts"),
        ],
    },
    {
        id: "vercel",
        title: "Vercel & split hosting",
        group: "Operate",
        summary:
            "Host the public website and web frontend separately while running the worker and document services on durable infrastructure.",
        keywords:
            "vercel serverless hosting landing build public app url site url frontend monorepo",
        blocks: [
            {
                title: "Deploy the web frontend",
                body: [
                    "Use apps/web as the Next.js product project in your monorepo host. Supply the validated app environment, a reachable PostgreSQL database, storage, chat configuration, and remote document-service endpoints.",
                    "Run @launchstack/worker on a container host or VM with a long-running process. A Vercel web deployment does not run the durable ingestion worker. Use shared credentials and a reachable worker Inngest endpoint when that capability is enabled.",
                ],
                links: [
                    guideLink("Worker requirements", "workers"),
                    guideLink("Remote document services", "processing"),
                ],
            },
            {
                title: "Deploy the public website",
                body: [
                    "Create a separate Next.js project rooted at apps/landing. It needs public site and app origins, and does not need your database or provider secrets. Set both origins before building so sign-in links and metadata point to the correct hosts.",
                ],
                code: "NEXT_PUBLIC_SITE_URL=https://home.example.com NEXT_PUBLIC_APP_URL=https://workspace.example.com pnpm --filter @launchstack/landing build\npnpm --filter @launchstack/landing start",
                file: "Equivalent public-site build and start commands",
                note: "On Vercel, set these values in the project's environment settings and redeploy. Changing a NEXT_PUBLIC_* value at runtime does not update an existing browser bundle.",
            },
            {
                title: "Run migrations as a release step",
                body: [
                    "Use the same source version and database credentials as the release. Apply migrations once in a controlled release job, then verify them. Do not start a competing migration process on every serverless request.",
                ],
                code: "pnpm --filter @launchstack/web db:migrate\npnpm --filter @launchstack/web db:verify",
                file: "Release environment",
                links: [
                    {
                        label: "Next.js public environment variables",
                        href: "https://nextjs.org/docs/app/guides/environment-variables",
                    },
                ],
            },
        ],
        sources: [
            source("Web build commands", "apps/web/package.json"),
            source("Public-site origins", "apps/landing/src/config/site.ts"),
            source("Worker package", "apps/worker/package.json"),
        ],
    },
];

export const LEGACY_GUIDE_IDS: Record<string, string> = {
    inngest: "workers",
    langchain: "capabilities",
    exa: "capabilities",
    uploadthing: "storage",
    "vercel-blob": "storage",
    ocr: "processing",
    "ocr-azure": "processing",
    "ocr-landing": "processing",
    "ocr-datalab": "processing",
    voice: "processing",
};
export function resolveGuide(id?: string): Guide {
    const resolved = id && Object.hasOwn(LEGACY_GUIDE_IDS, id) ? LEGACY_GUIDE_IDS[id] : id;
    return GUIDES.find(guide => guide.id === resolved) ?? GUIDES[0]!;
}
export function filterGuides(query: string): Guide[] {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return GUIDES.filter(guide => {
        const haystack = [
            guide.title,
            guide.summary,
            guide.keywords,
            ...guide.blocks.flatMap(block => [
                block.title,
                ...block.body,
                block.code ?? "",
                block.note ?? "",
                ...(block.rows ?? []).flatMap(row => [row.name, row.detail]),
            ]),
        ]
            .join(" ")
            .toLowerCase();
        return terms.every(term => haystack.includes(term));
    });
}
