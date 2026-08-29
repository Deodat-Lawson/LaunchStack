import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
// Leaf module by design: importing ./server/chat-models here would pull the
// core LLM barrel (ChatOpenAI, openai SDK, yaml) into everything that imports
// ~/env, including next.config.ts at build time.
import { resolveChatEndpoint } from "./server/chat-endpoint";

// `.env` lives at the monorepo root, but Next.js (running from apps/web/) only
// auto-loads `.env` from its own cwd. Load the root file here so this module
// — which acts as the env validation gate — sees the real values regardless of
// whether it's pulled in by next.config.ts, route handlers, scripts, or tests.
// dotenv leaves already-defined process.env entries untouched, so platform-set
// vars (Vercel, Docker, root scripts that pre-load) win.
// apps/web is "type": "module", so __dirname is undefined under raw tsx — derive
// from import.meta.url so backfill scripts and Next bundles both resolve it.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(moduleDir, "../../../.env") });

const normalize = (value: unknown) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value;

const requiredString = () => z.preprocess(normalize, z.string().min(1, "Value is required"));

const optionalString = () => z.preprocess(normalize, z.string().min(1).optional());

const serverSchema = z.object({
    // Non-empty string only — avoid z.string().url(): many valid Prisma/Postgres URLs fail strict URL parsing (password encoding, sslmode params, etc.).
    DATABASE_URL: requiredString(),
    // Optional override used only by the migration runner and drizzle-kit.
    // Must be a DIRECT (session) connection: the runner takes a session-level
    // advisory lock, which does not survive a transaction-mode pooler such as
    // pgbouncer, Supabase :6543, or a Neon pooled endpoint. Falls back to
    // DATABASE_URL when unset.
    MIGRATE_DATABASE_URL: optionalString(),
    // OPENAI_API_KEY is optional when AI_API_KEY is set (validated in superRefine)
    OPENAI_API_KEY: optionalString(),
    OPENAI_MODEL: optionalString(),
    // Chat: one OpenAI-compatible endpoint, its credential, and the file
    // describing which models it serves. Model ids and per-model behavior live
    // in that file, never here.
    CHAT_BASE_URL: optionalString(),
    CHAT_API_KEY: optionalString(),
    CHAT_MODELS_CONFIG: optionalString(),
    EMBEDDING_INDEX: optionalString(),
    // 32 raw bytes encoded as base64 (44 chars). Used to encrypt per-company
    // embedding provider credentials at rest. Required whenever a company sets
    // its own API key through the settings UI. Generate with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    EMBEDDING_SECRETS_KEY: optionalString(),
    OPENROUTER_API_KEY: optionalString(),
    GOOGLE_AI_API_KEY: optionalString(),
    GOOGLE_MODEL: optionalString(),
    OLLAMA_BASE_URL: optionalString(),
    OLLAMA_MODEL: optionalString(),
    OLLAMA_EMBEDDING_MODEL: optionalString(),
    OLLAMA_EMBEDDING_DIMENSION: optionalString(),
    OLLAMA_EMBEDDING_VERSION: optionalString(),
    HUGGINGFACE_API_KEY: optionalString(),
    HUGGINGFACE_EMBEDDING_MODEL: optionalString(),
    HUGGINGFACE_EMBEDDING_DIMENSION: optionalString(),
    HUGGINGFACE_EMBEDDING_VERSION: optionalString(),
    // Signs session cookies and verification tokens. Generate with:
    //   openssl rand -base64 32
    // Rotating it invalidates every live session (users just sign in again).
    BETTER_AUTH_SECRET: requiredString(),
    // Public origin of the app (e.g. https://app.example.com). Optional in
    // dev — better-auth infers http://localhost from the request — but set it
    // in any deployment behind a proxy so callback URLs and trusted origins
    // resolve to the outside hostname.
    BETTER_AUTH_URL: optionalString(),
    // Optional social sign-in. Auth works credentials-only without these;
    // a provider appears on the sign-in page only when both halves are set.
    AUTH_GOOGLE_CLIENT_ID: optionalString(),
    AUTH_GOOGLE_CLIENT_SECRET: optionalString(),
    AUTH_GITHUB_CLIENT_ID: optionalString(),
    AUTH_GITHUB_CLIENT_SECRET: optionalString(),
    BLOB_READ_WRITE_TOKEN: optionalString(),
    UPLOADTHING_TOKEN: optionalString(),
    DATALAB_API_KEY: optionalString(),
    // Web search providers
    EXA_API_KEY: optionalString(),
    // Foursquare Places API (for Client Prospector)
    FOURSQUARE_SERVICE_KEY: optionalString(),
    SERPER_API_KEY: optionalString(),
    SEARCH_PROVIDER: z.enum(["exa", "serper", "fallback", "parallel"]).optional(),
    // Platform API Keys for Marketing Pipeline
    REDDIT_CLIENT_ID: optionalString(),
    REDDIT_CLIENT_SECRET: optionalString(),
    REDDIT_USER_AGENT: optionalString(),
    TWITTER_BEARER_TOKEN: optionalString(),
    LINKEDIN_ACCESS_TOKEN: optionalString(),
    BLUESKY_HANDLE: optionalString(),
    BLUESKY_APP_PASSWORD: optionalString(),
    // Azure Document Intelligence (for OCR pipeline)
    AZURE_DOC_INTELLIGENCE_ENDPOINT: optionalString(),
    AZURE_DOC_INTELLIGENCE_KEY: optionalString(),
    // Landing.AI (fallback OCR for complex documents)
    LANDING_AI_API_KEY: optionalString(),
    // LangSmith configuration (optional, for tracing and monitoring)
    LANGCHAIN_TRACING_V2: z.preprocess(
        val => val === "true" || val === "1",
        z.boolean().optional()
    ),
    LANGCHAIN_API_KEY: optionalString(),
    LANGCHAIN_PROJECT: optionalString(), // Optional project name for LangSmith
    // Which kind of deployment this is. Unset means self-hosted: the hosted
    // service opts IN to cloud behaviour rather than every self-hoster opting
    // out of it.
    //
    // The asymmetry is deliberate. If the hosted deploy forgets this var, one
    // operator who owns the environment loses usage metering and fixes it in
    // seconds. If a self-hoster forgets it, their instance refuses uploads the
    // moment a workspace exhausts its signup grant — and there is no way to add
    // credits from anywhere in the product. The failure that lands on the party
    // who cannot fix it must not be the default.
    //
    // Read via ~/server/deployment, never directly: a `.default()` here does NOT
    // apply under SKIP_ENV_VALIDATION (see parseServerEnv), so the fallback has
    // to exist in code as well.
    DEPLOYMENT_MODE: z.enum(["self-hosted", "cloud"]).optional(),
    // Inngest event key — required for cloud deploys; warned about otherwise
    INNGEST_EVENT_KEY: optionalString(),
    // Agent-knowledge connector. Reads Claude Code / Codex knowledge from the
    // filesystem of the machine running this server, so it stays off unless a
    // deployment explicitly opts in — on a shared host the server's disk is not
    // the user's disk.
    AGENT_KNOWLEDGE_CONNECTOR_ENABLED: optionalString(),
    // Path-separator-delimited allowlist of project directories the connector
    // may scan (`:` on POSIX, `;` on Windows). Global `~/.claude` and `~/.codex`
    // are always in scope when the connector is enabled; this governs
    // project-scoped roots only.
    AGENT_KNOWLEDGE_PROJECT_ROOTS: optionalString(),
    // Workspace connections (OAuth). All optional — with no client pair set a
    // provider's Connect button renders "not configured" and its routes
    // decline. Each pair comes from an OAuth app the deployment registers with
    // that provider; the redirect URI to register is
    // <APP_PUBLIC_URL>/api/connectors/<provider>/oauth/callback (slack, github).
    // Storing a grant also requires EMBEDDING_SECRETS_KEY — without it there
    // is nowhere safe to put a token, so the connector declines to exist.
    // (Google Drive's pair is GOOGLE_OAUTH_CLIENT_ID/SECRET below, shared
    // with Drive-linked files.)
    // Slack app client pair (OAuth v2 bot install). Distinct from
    // SLACK_BOT_TOKEN below, which remains the deployment-global fallback.
    SLACK_CLIENT_ID: optionalString(),
    SLACK_CLIENT_SECRET: optionalString(),
    // GitHub OAuth app pair. GITHUB_OAUTH_* to keep clear of GITHUB_TOKEN,
    // the deployment-global PAT fallback used by the repo explainer.
    GITHUB_OAUTH_CLIENT_ID: optionalString(),
    GITHUB_OAUTH_CLIENT_SECRET: optionalString(),
    // services/transcription (ADR-004) — Whisper transcription + yt-dlp
    // download. Used by the voice features when TRANSCRIPTION_PROVIDER=sidecar
    // or when transcribing video-platform URLs.
    TRANSCRIPTION_SERVICE_URL: optionalString(),
    // Shared secret sent as X-API-Key on every transcription-service call.
    // The service fails closed: unset means every call returns 401 rather than
    // running unauthenticated.
    TRANSCRIPTION_SERVICE_API_KEY: optionalString(),
    // services/adeu-ai-docs-editing (ADR-004, renamed in ADR-007) — the
    // authoritative Adeu DOCX redlining service, plus its fail-closed
    // X-API-Key secret.
    ADEU_SERVICE_API_KEY: optionalString(),
    // Deprecated by ADR-007: read as fallbacks for ADEU_SERVICE_* so existing
    // deployments keep working across the rename.
    DOCUMENT_EDITOR_URL: optionalString(),
    DOCUMENT_EDITOR_API_KEY: optionalString(),
    // Legacy (deprecated by ADR-004): the sidecar was split into
    // services/transcription and services/adeu-ai-docs-editing. SIDECAR_URL and
    // SIDECAR_API_KEY are still read as fallbacks for TRANSCRIPTION_SERVICE_*
    // (with a warning); the sidecar embed/rerank/NER inference surface they
    // used to enable was removed entirely — no service ever implemented it.
    SIDECAR_URL: optionalString(),
    SIDECAR_API_KEY: optionalString(),
    ADEU_SERVICE_URL: optionalString(),
    // services/document-converter (ADR-004) — the consolidated OCR routing,
    // vision classification, PDF page rendering, and Docling parsing service.
    // When set, DOCLING becomes available and DoclingIngestionAdapter takes
    // over Office formats.
    DOCUMENT_CONVERTER_URL: optionalString(),
    // Shared secret sent as X-API-Key on every converter call. The converter
    // fails closed: there is deliberately NO legacy fallback for this value —
    // when it is unset, every routing/parsing call returns 401 rather than
    // silently running unauthenticated. Set the same value in the converter's
    // own environment (CONVERTER_API_KEY).
    DOCUMENT_CONVERTER_API_KEY: optionalString(),
    // Legacy (deprecated by ADR-004): read only as a URL fallback for
    // DOCUMENT_CONVERTER_URL so existing deployments keep routing.
    OCR_ROUTER_URL: optionalString(),
    // Legacy (deprecated by ADR-004): the ocr-worker service was removed;
    // this variable is ignored with a startup warning.
    OCR_WORKER_URL: optionalString(),
    // Model for OCR vision classification (default: gemini-2.5-flash). Any OpenAI-compatible vision model.
    OCR_VISION_MODEL: optionalString(),
    // The Marker provider was removed by ADR-004 (it always aliased Docling),
    // so it is deliberately absent here and rejected with an actionable error.
    OCR_DEFAULT_PROVIDER: z
        .enum(["DOCLING", "NATIVE_PDF", "AZURE", "LANDING_AI", "DATALAB"], {
            errorMap: () => ({
                message:
                    "OCR_DEFAULT_PROVIDER must be one of DOCLING, NATIVE_PDF, AZURE, LANDING_AI, DATALAB. " +
                    "The Marker provider was removed (ADR-004): it never had a real implementation and " +
                    "silently aliased Docling — set OCR_DEFAULT_PROVIDER=DOCLING instead.",
            }),
        })
        .optional(),
    // Publicly-reachable origin of this Next.js app. Required when the
    // document-converter is configured and documents live behind relative
    // /api/files URLs — the converter needs an absolute URL to fetch them
    // (and this origin must be in its ALLOWED_FETCH_ORIGINS).
    APP_PUBLIC_URL: optionalString(),
    // Signs short-lived tokens that let the OCR worker read /api/files URLs
    // without a session. Required alongside OCR_WORKER_URL when documents
    // are stored in the database; without it those fetches get a 401.
    // Generate with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    FILE_ACCESS_TOKEN_SECRET: optionalString(),
    // Bearer token required by GET /api/metrics (Prometheus scrapers).
    // In production the endpoint returns 503 if this is unset.
    METRICS_SCRAPE_TOKEN: optionalString(),
    // HMAC key for the unsubscribe links in outgoing campaign mail. Read
    // directly from process.env by packages/features (which cannot import this
    // module), and throws there if unset or under 16 chars — so a campaign send
    // fails at the point of use rather than here. Declared for documentation and
    // so it appears in the same place as every other secret.
    // Generate with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    EMAIL_UNSUBSCRIBE_SECRET: optionalString(),
    // When false/unset, campaign sends run as a dry run and no mail leaves the
    // machine. Read directly by the send routes.
    EMAIL_SENDING_ENABLED: optionalString(),
    // Signing key Inngest uses to verify requests to the serve endpoint. Read by
    // the Inngest SDK itself, not by this app; declared so it is documented.
    INNGEST_SIGNING_KEY: optionalString(),
    // Enable Graph RAG retrieval
    ENABLE_GRAPH_RETRIEVER: z.preprocess(
        val => val === "true" || val === "1",
        z.boolean().optional()
    ),
    // Enable retrieval over user-authored notes in the ensemble search.
    // Off by default: empty-notes deployments would just run extra SQL.
    ENABLE_NOTES_RETRIEVER: z.preprocess(
        val => val === "true" || val === "1",
        z.boolean().optional()
    ),
    NEO4J_URI: optionalString(),
    NEO4J_USERNAME: optionalString(),
    NEO4J_PASSWORD: optionalString(),
    // Storage provider configuration
    // "s3" → any S3-compatible endpoint (AWS, MinIO, SeaweedFS, etc.)
    // "database" → base64 fallback stored in Postgres fileUploads.fileData
    // Unset → auto-detect: "s3" if S3 env vars are present, else "database"
    NEXT_PUBLIC_STORAGE_PROVIDER: z.enum(["s3", "database"]).optional(),
    NEXT_PUBLIC_S3_ENDPOINT: optionalString(),
    S3_PUBLIC_ENDPOINT: optionalString(), // Browser-facing S3 URL (defaults to NEXT_PUBLIC_S3_ENDPOINT)
    S3_REGION: optionalString(),
    S3_ACCESS_KEY: optionalString(),
    S3_SECRET_KEY: optionalString(),
    S3_BUCKET_NAME: optionalString(),
    // Repo Explainer
    GITHUB_TOKEN: optionalString(),
    // Global AI provider fallback — set once to route ALL capabilities to one provider
    // Per-capability env vars override these when set
    AI_BASE_URL: optionalString(), // e.g. https://api.siliconflow.cn/v1
    AI_API_KEY: optionalString(),
    // Per-capability overrides (optional — falls back to AI_BASE_URL / AI_API_KEY / OPENAI_API_KEY)
    EMBEDDING_API_BASE_URL: optionalString(),
    EMBEDDING_API_KEY: optionalString(),
    EMBEDDING_MODEL: optionalString(),
    RERANK_API_BASE_URL: optionalString(),
    RERANK_API_KEY: optionalString(),
    RERANK_MODEL: optionalString(), // required when RERANK_API_BASE_URL is set; else defaults to gemini-2.5-flash-lite
    NER_API_BASE_URL: optionalString(), // e.g. https://api.siliconflow.cn/v1 (Qwen3.5-4B free)
    NER_API_KEY: optionalString(),
    NER_MODEL: optionalString(), // default gemini-2.5-flash-lite; e.g. Qwen/Qwen3.5-4B
    TRANSCRIPTION_API_BASE_URL: optionalString(), // defaults to the Gemini endpoint
    TRANSCRIPTION_API_KEY: optionalString(),
    TRANSCRIPTION_MODEL: optionalString(), // defaults to gemini-2.5-flash
    GEMINI_TTS_VOICE: optionalString(), // Chirp 3: HD voice; defaults to en-US-Chirp3-HD-Kore
    // Transcription mode: "sidecar" routes uploads to the self-hosted
    // services/transcription deployment (TRANSCRIPTION_SERVICE_URL). It is the
    // only capability that still has a self-hosted mode — the sidecar rerank
    // and NER providers were phantoms and were removed with their
    // RERANK_PROVIDER / NER_PROVIDER selectors (ADR-004 §5).
    TRANSCRIPTION_PROVIDER: z.enum(["cloud", "sidecar"]).optional(),
    // Token system
    TOKEN_SIGNUP_BONUS: optionalString(),
    // Collaboration: meetings held in channels, with agents that may run on
    // other machines. COLLAB_HUB_SECRET is the shared secret every remote agent
    // worker signs its requests with — without it the hub refuses to accept any
    // node, which is the safe default for a deployment that does not use them.
    COLLAB_HUB_SECRET: optionalString(),
    COLLAB_HUB_ID: optionalString(),
    // Slack: `SLACK_BOT_TOKEN` posts meeting turns into a channel;
    // `SLACK_SIGNING_SECRET` verifies inbound Events API deliveries so a human
    // can steer a meeting from Slack. Both are required for two-way mirroring.
    SLACK_BOT_TOKEN: optionalString(),
    SLACK_SIGNING_SECRET: optionalString(),
    SLACK_WEBHOOK_URL: optionalString(),
    // Drive-linked files: PDFs and Word docs manually editable via a durable
    // Google Drive sync. Dark until GOOGLE_DOCS_EDITING_ENABLED=true AND the
    // OAuth client below exists — the GCP consent screen is the one real
    // lead-time item, so the flag ships off by default.
    GOOGLE_DOCS_EDITING_ENABLED: optionalString(),
    GOOGLE_OAUTH_CLIENT_ID: optionalString(),
    GOOGLE_OAUTH_CLIENT_SECRET: optionalString(),
    // Absolute callback URL registered on the GCP OAuth client. Defaults to
    // `${APP_PUBLIC_URL}/api/connectors/google/oauth/callback`, falling back
    // to the request origin in dev.
    GOOGLE_OAUTH_REDIRECT_URL: optionalString(),
    // Quiet period before the reconciler pulls a Drive revision (minutes,
    // default 10) — Docs autosaves per keystroke; a settled revision becomes
    // one document version instead of eight.
    GOOGLE_DOCS_SETTLE_MINUTES: optionalString(),
    // CORS
    CORS_ALLOWED_ORIGINS: optionalString(),
    // Logging
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
});

const serverSchemaRefined = serverSchema.superRefine((data, ctx) => {
    // Chat reaches exactly one OpenAI-compatible endpoint. CHAT_BASE_URL names
    // it; the deprecated single-provider variables are translated for one
    // release when they unambiguously describe one endpoint. Which models that
    // endpoint serves is validated when the configuration file is parsed, not
    // here — env only has to establish that an endpoint exists.
    try {
        resolveChatEndpoint(data);
    } catch (error) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["CHAT_BASE_URL"],
            message:
                error instanceof Error
                    ? error.message
                    : "Configure an OpenAI-compatible chat endpoint",
        });
    }

    if (data.NEXT_PUBLIC_STORAGE_PROVIDER === "s3") {
        const required = [
            "NEXT_PUBLIC_S3_ENDPOINT",
            "S3_REGION",
            "S3_ACCESS_KEY",
            "S3_SECRET_KEY",
            "S3_BUCKET_NAME",
        ] as const;
        for (const key of required) {
            if (!data[key]) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [key],
                    message: `${key} is required when NEXT_PUBLIC_STORAGE_PROVIDER is "s3"`,
                });
            }
        }
    }
});

const clientSchema = z.object({
    NEXT_PUBLIC_UPLOADTHING_ENABLED: z.preprocess(
        val => val === "true" || val === "1",
        z.boolean().optional()
    ),
    NEXT_PUBLIC_STORAGE_PROVIDER: z.enum(["s3", "database"]).optional(),
    NEXT_PUBLIC_S3_ENDPOINT: optionalString(),
    // Google Picker needs a browser API key (restricted to the Picker API) and
    // the Cloud project number — setAppId is what registers the drive.file
    // grant for picked items to our OAuth client.
    NEXT_PUBLIC_GOOGLE_API_KEY: optionalString(),
    NEXT_PUBLIC_GOOGLE_APP_ID: optionalString(),
});

const skipValidation =
    process.env.SKIP_ENV_VALIDATION === "true" || process.env.SKIP_ENV_VALIDATION === "1";

const parseEnv = <T extends z.AnyZodObject>(schema: T, values: z.input<T>): z.infer<T> => {
    if (skipValidation) {
        const result = schema.partial().safeParse(values);
        if (result.success) {
            return result.data as z.infer<T>;
        }

        return values as z.infer<T>;
    }

    return schema.parse(values);
};

function parseServerEnv() {
    const rawValues = {
        DATABASE_URL: process.env.DATABASE_URL,
        MIGRATE_DATABASE_URL: process.env.MIGRATE_DATABASE_URL,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_MODEL: process.env.OPENAI_MODEL,
        CHAT_BASE_URL: process.env.CHAT_BASE_URL,
        CHAT_API_KEY: process.env.CHAT_API_KEY,
        CHAT_MODELS_CONFIG: process.env.CHAT_MODELS_CONFIG,
        EMBEDDING_INDEX: process.env.EMBEDDING_INDEX,
        EMBEDDING_SECRETS_KEY: process.env.EMBEDDING_SECRETS_KEY,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
        GOOGLE_MODEL: process.env.GOOGLE_MODEL,
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
        OLLAMA_MODEL: process.env.OLLAMA_MODEL,
        OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL,
        OLLAMA_EMBEDDING_DIMENSION: process.env.OLLAMA_EMBEDDING_DIMENSION,
        OLLAMA_EMBEDDING_VERSION: process.env.OLLAMA_EMBEDDING_VERSION,
        HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY,
        HUGGINGFACE_EMBEDDING_MODEL: process.env.HUGGINGFACE_EMBEDDING_MODEL,
        HUGGINGFACE_EMBEDDING_DIMENSION: process.env.HUGGINGFACE_EMBEDDING_DIMENSION,
        HUGGINGFACE_EMBEDDING_VERSION: process.env.HUGGINGFACE_EMBEDDING_VERSION,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
        AUTH_GOOGLE_CLIENT_ID: process.env.AUTH_GOOGLE_CLIENT_ID,
        AUTH_GOOGLE_CLIENT_SECRET: process.env.AUTH_GOOGLE_CLIENT_SECRET,
        AUTH_GITHUB_CLIENT_ID: process.env.AUTH_GITHUB_CLIENT_ID,
        AUTH_GITHUB_CLIENT_SECRET: process.env.AUTH_GITHUB_CLIENT_SECRET,
        BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
        UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,
        DATALAB_API_KEY: process.env.DATALAB_API_KEY,
        EXA_API_KEY: process.env.EXA_API_KEY,
        FOURSQUARE_SERVICE_KEY: process.env.FOURSQUARE_SERVICE_KEY,
        SERPER_API_KEY: process.env.SERPER_API_KEY,
        SEARCH_PROVIDER: process.env.SEARCH_PROVIDER as
            | "exa"
            | "serper"
            | "fallback"
            | "parallel"
            | undefined,
        REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
        REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
        REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
        TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN,
        LINKEDIN_ACCESS_TOKEN: process.env.LINKEDIN_ACCESS_TOKEN,
        BLUESKY_HANDLE: process.env.BLUESKY_HANDLE,
        BLUESKY_APP_PASSWORD: process.env.BLUESKY_APP_PASSWORD,
        AZURE_DOC_INTELLIGENCE_ENDPOINT: process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT,
        AZURE_DOC_INTELLIGENCE_KEY: process.env.AZURE_DOC_INTELLIGENCE_KEY,
        LANDING_AI_API_KEY: process.env.LANDING_AI_API_KEY,
        LANGCHAIN_TRACING_V2: process.env.LANGCHAIN_TRACING_V2,
        LANGCHAIN_API_KEY: process.env.LANGCHAIN_API_KEY,
        LANGCHAIN_PROJECT: process.env.LANGCHAIN_PROJECT,
        DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE as "self-hosted" | "cloud" | undefined,
        INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
        TRANSCRIPTION_SERVICE_URL: process.env.TRANSCRIPTION_SERVICE_URL,
        TRANSCRIPTION_SERVICE_API_KEY: process.env.TRANSCRIPTION_SERVICE_API_KEY,
        ADEU_SERVICE_API_KEY: process.env.ADEU_SERVICE_API_KEY,
        DOCUMENT_EDITOR_URL: process.env.DOCUMENT_EDITOR_URL,
        DOCUMENT_EDITOR_API_KEY: process.env.DOCUMENT_EDITOR_API_KEY,
        AGENT_KNOWLEDGE_CONNECTOR_ENABLED: process.env.AGENT_KNOWLEDGE_CONNECTOR_ENABLED,
        AGENT_KNOWLEDGE_PROJECT_ROOTS: process.env.AGENT_KNOWLEDGE_PROJECT_ROOTS,
        SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
        GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID,
        GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        SIDECAR_URL: process.env.SIDECAR_URL,
        SIDECAR_API_KEY: process.env.SIDECAR_API_KEY,
        ADEU_SERVICE_URL: process.env.ADEU_SERVICE_URL,
        DOCUMENT_CONVERTER_URL: process.env.DOCUMENT_CONVERTER_URL,
        DOCUMENT_CONVERTER_API_KEY: process.env.DOCUMENT_CONVERTER_API_KEY,
        OCR_WORKER_URL: process.env.OCR_WORKER_URL,
        OCR_ROUTER_URL: process.env.OCR_ROUTER_URL,
        OCR_VISION_MODEL: process.env.OCR_VISION_MODEL,
        OCR_DEFAULT_PROVIDER: process.env.OCR_DEFAULT_PROVIDER as
            | "DOCLING"
            | "NATIVE_PDF"
            | "AZURE"
            | "LANDING_AI"
            | "DATALAB"
            | undefined,
        APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
        FILE_ACCESS_TOKEN_SECRET: process.env.FILE_ACCESS_TOKEN_SECRET,
        METRICS_SCRAPE_TOKEN: process.env.METRICS_SCRAPE_TOKEN,
        EMAIL_UNSUBSCRIBE_SECRET: process.env.EMAIL_UNSUBSCRIBE_SECRET,
        EMAIL_SENDING_ENABLED: process.env.EMAIL_SENDING_ENABLED,
        INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
        ENABLE_GRAPH_RETRIEVER: process.env.ENABLE_GRAPH_RETRIEVER,
        ENABLE_NOTES_RETRIEVER: process.env.ENABLE_NOTES_RETRIEVER,
        NEO4J_URI: process.env.NEO4J_URI,
        NEO4J_USERNAME: process.env.NEO4J_USERNAME,
        NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        AI_BASE_URL: process.env.AI_BASE_URL,
        AI_API_KEY: process.env.AI_API_KEY,
        EMBEDDING_API_BASE_URL: process.env.EMBEDDING_API_BASE_URL,
        EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
        EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
        RERANK_API_BASE_URL: process.env.RERANK_API_BASE_URL,
        RERANK_API_KEY: process.env.RERANK_API_KEY,
        RERANK_MODEL: process.env.RERANK_MODEL,
        NER_API_BASE_URL: process.env.NER_API_BASE_URL,
        NER_API_KEY: process.env.NER_API_KEY,
        NER_MODEL: process.env.NER_MODEL,
        TRANSCRIPTION_API_BASE_URL: process.env.TRANSCRIPTION_API_BASE_URL,
        TRANSCRIPTION_API_KEY: process.env.TRANSCRIPTION_API_KEY,
        TRANSCRIPTION_MODEL: process.env.TRANSCRIPTION_MODEL,
        GEMINI_TTS_VOICE: process.env.GEMINI_TTS_VOICE,
        TRANSCRIPTION_PROVIDER: process.env.TRANSCRIPTION_PROVIDER as
            | "cloud"
            | "sidecar"
            | undefined,
        TOKEN_SIGNUP_BONUS: process.env.TOKEN_SIGNUP_BONUS,
        GOOGLE_DOCS_EDITING_ENABLED: process.env.GOOGLE_DOCS_EDITING_ENABLED,
        GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        GOOGLE_OAUTH_REDIRECT_URL: process.env.GOOGLE_OAUTH_REDIRECT_URL,
        GOOGLE_DOCS_SETTLE_MINUTES: process.env.GOOGLE_DOCS_SETTLE_MINUTES,
        COLLAB_HUB_SECRET: process.env.COLLAB_HUB_SECRET,
        COLLAB_HUB_ID: process.env.COLLAB_HUB_ID,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
        SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
        SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
        NEXT_PUBLIC_STORAGE_PROVIDER: process.env.NEXT_PUBLIC_STORAGE_PROVIDER as
            | "s3"
            | "database"
            | undefined,
        NEXT_PUBLIC_S3_ENDPOINT: process.env.NEXT_PUBLIC_S3_ENDPOINT,
        S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
        S3_REGION: process.env.S3_REGION,
        S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
        S3_SECRET_KEY: process.env.S3_SECRET_KEY,
        S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    };

    let server: z.infer<typeof serverSchemaRefined>;
    if (skipValidation) {
        const result = serverSchema.partial().safeParse(rawValues);
        server = (result.success ? result.data : rawValues) as z.infer<typeof serverSchemaRefined>;
    } else {
        server = serverSchemaRefined.parse(rawValues);
    }

    // Inngest backs the background verticals (trend search, prospector, founder
    // review, …). Ingestion does NOT need it — that runs through the Postgres
    // transactional outbox in apps/worker (ADR-003).
    //
    // So this is fatal only for a cloud deploy, where a missing key is a real
    // misconfiguration. A self-hoster who does not want those verticals should
    // get a warning and a working instance, not a crash-looping container. The
    // old message claimed "required in production" while actually throwing
    // whenever validation ran at all, regardless of NODE_ENV.
    //
    // INNGEST_DEV satisfies it too: the SDK ignores the event key in dev mode,
    // which is exactly what docker-compose's bundled inngest-dev container runs.
    const inngestKeyMissing =
        (server.INNGEST_EVENT_KEY == null || server.INNGEST_EVENT_KEY.length === 0) &&
        !process.env.INNGEST_DEV;

    if (!skipValidation && inngestKeyMissing) {
        if (server.DEPLOYMENT_MODE === "cloud") {
            throw new Error("INNGEST_EVENT_KEY is required when DEPLOYMENT_MODE=cloud.");
        }
        console.warn(
            "[env] INNGEST_EVENT_KEY is not set. Document ingestion is unaffected " +
                "(it runs through the transactional outbox), but the background " +
                "verticals — trend search, client prospector, founder weekly review, " +
                "predictive analysis, website crawl, document modify, reindex — will " +
                "not run. Set INNGEST_EVENT_KEY, or INNGEST_DEV=1 with the bundled " +
                "dev server, to enable them."
        );
    }
    return server;
}

export const env = {
    server: parseServerEnv(),
    client: parseEnv(clientSchema, {
        NEXT_PUBLIC_UPLOADTHING_ENABLED: process.env.NEXT_PUBLIC_UPLOADTHING_ENABLED,
        NEXT_PUBLIC_STORAGE_PROVIDER: process.env.NEXT_PUBLIC_STORAGE_PROVIDER as
            | "s3"
            | "database"
            | undefined,
        NEXT_PUBLIC_S3_ENDPOINT: process.env.NEXT_PUBLIC_S3_ENDPOINT,
        NEXT_PUBLIC_GOOGLE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
        NEXT_PUBLIC_GOOGLE_APP_ID: process.env.NEXT_PUBLIC_GOOGLE_APP_ID,
    }),
};
