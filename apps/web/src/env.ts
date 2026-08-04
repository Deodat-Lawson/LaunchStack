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

const requiredString = () =>
  z.preprocess(normalize, z.string().min(1, "Value is required"));

const optionalString = () =>
  z.preprocess(normalize, z.string().min(1).optional());

const serverSchema = z.object({
  // Non-empty string only — avoid z.string().url(): many valid Prisma/Postgres URLs fail strict URL parsing (password encoding, sslmode params, etc.).
  DATABASE_URL: requiredString(),
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
  CLERK_SECRET_KEY: requiredString(),
  BLOB_READ_WRITE_TOKEN: optionalString(),
  UPLOADTHING_TOKEN: optionalString(),
  DATALAB_API_KEY: optionalString(),
  // Web search providers
  EXA_API_KEY: optionalString(),
  // Foursquare Places API (for Client Prospector)
  FOURSQUARE_SERVICE_KEY: optionalString(),
  SERPER_API_KEY: optionalString(),
  SEARCH_PROVIDER: z
    .enum(["exa", "serper", "fallback", "parallel"])
    .optional(),
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
    (val) => val === "true" || val === "1",
    z.boolean().optional()
  ),
  LANGCHAIN_API_KEY: optionalString(),
  LANGCHAIN_PROJECT: optionalString(), // Optional project name for LangSmith
  // Job runner backend
  JOB_RUNNER: z.enum(["inngest"]).default("inngest"),
  // Inngest event key — required in production; optional in development
  INNGEST_EVENT_KEY: optionalString(),
  // Sidecar configuration (optional, for local ML compute)
  // When set, Graph RAG entity extraction is automatically enabled
  SIDECAR_URL: optionalString(),
  SIDECAR_EMBEDDING_MODEL: optionalString(),
  SIDECAR_EMBEDDING_DIMENSION: optionalString(),
  SIDECAR_EMBEDDING_VERSION: optionalString(),
  // OSS OCR worker (Marker + Docling). When set, MARKER becomes the default
  // OCR provider and DoclingIngestionAdapter takes over Office formats.
  OCR_WORKER_URL: optionalString(),
  // OCR router sidecar — vision classification + PDF rendering for document routing
  OCR_ROUTER_URL: optionalString(),
  // Model for OCR vision classification (default: gemini-2.5-flash). Any OpenAI-compatible vision model.
  OCR_VISION_MODEL: optionalString(),
  OCR_DEFAULT_PROVIDER: z.enum(["MARKER", "DOCLING", "NATIVE_PDF", "AZURE", "LANDING_AI", "DATALAB"]).optional(),
  // Publicly-reachable origin of this Next.js app. Required when OCR_WORKER_URL
  // is set and documents live behind relative /api/files URLs — the worker
  // needs an absolute URL to fetch them.
  APP_PUBLIC_URL: optionalString(),
  // Enable Graph RAG retrieval
  ENABLE_GRAPH_RETRIEVER: z.preprocess(
    (val) => val === "true" || val === "1",
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
  AI_BASE_URL: optionalString(),           // e.g. https://api.siliconflow.cn/v1
  AI_API_KEY: optionalString(),
  // Per-capability overrides (optional — falls back to AI_BASE_URL / AI_API_KEY / OPENAI_API_KEY)
  EMBEDDING_API_BASE_URL: optionalString(),
  EMBEDDING_API_KEY: optionalString(),
  EMBEDDING_MODEL: optionalString(),
  RERANK_API_BASE_URL: optionalString(),
  RERANK_API_KEY: optionalString(),
  RERANK_MODEL: optionalString(),          // required when RERANK_API_BASE_URL is set; else defaults to gemini-2.5-flash-lite
  NER_API_BASE_URL: optionalString(),      // e.g. https://api.siliconflow.cn/v1 (Qwen3.5-4B free)
  NER_API_KEY: optionalString(),
  NER_MODEL: optionalString(),             // default gemini-2.5-flash-lite; e.g. Qwen/Qwen3.5-4B
  TRANSCRIPTION_API_BASE_URL: optionalString(), // defaults to the Gemini endpoint
  TRANSCRIPTION_API_KEY: optionalString(),
  TRANSCRIPTION_MODEL: optionalString(),   // defaults to gemini-2.5-flash
  GEMINI_TTS_VOICE: optionalString(),      // Chirp 3: HD voice; defaults to en-US-Chirp3-HD-Kore
  // Legacy provider API keys (fallback when per-capability keys not set)
  // Provider overrides (cloud vs sidecar)
  RERANK_PROVIDER: z.enum(["cloud", "sidecar"]).optional(),
  NER_PROVIDER: z.enum(["cloud", "sidecar"]).optional(),
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
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: requiredString(),
  NEXT_PUBLIC_UPLOADTHING_ENABLED: z.preprocess(
    (val) => val === "true" || val === "1",
    z.boolean().optional()
  ),
  NEXT_PUBLIC_STORAGE_PROVIDER: z.enum(["s3", "database"]).optional(),
  NEXT_PUBLIC_S3_ENDPOINT: optionalString(),
});

const skipValidation =
  process.env.SKIP_ENV_VALIDATION === "true" ||
  process.env.SKIP_ENV_VALIDATION === "1";

const parseEnv = <T extends z.AnyZodObject>(
  schema: T,
  values: z.input<T>,
): z.infer<T> => {
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
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,
    DATALAB_API_KEY: process.env.DATALAB_API_KEY,
    EXA_API_KEY: process.env.EXA_API_KEY,
    FOURSQUARE_SERVICE_KEY: process.env.FOURSQUARE_SERVICE_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    SEARCH_PROVIDER: process.env.SEARCH_PROVIDER as "exa" | "serper" | "fallback" | "parallel" | undefined,
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
    JOB_RUNNER: process.env.JOB_RUNNER as "inngest" | undefined,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    SIDECAR_URL: process.env.SIDECAR_URL,
    SIDECAR_EMBEDDING_MODEL: process.env.SIDECAR_EMBEDDING_MODEL,
    SIDECAR_EMBEDDING_DIMENSION: process.env.SIDECAR_EMBEDDING_DIMENSION,
    SIDECAR_EMBEDDING_VERSION: process.env.SIDECAR_EMBEDDING_VERSION,
    OCR_WORKER_URL: process.env.OCR_WORKER_URL,
    OCR_ROUTER_URL: process.env.OCR_ROUTER_URL,
    OCR_VISION_MODEL: process.env.OCR_VISION_MODEL,
    OCR_DEFAULT_PROVIDER: process.env.OCR_DEFAULT_PROVIDER as "MARKER" | "DOCLING" | "NATIVE_PDF" | "AZURE" | "LANDING_AI" | "DATALAB" | undefined,
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
    ENABLE_GRAPH_RETRIEVER: process.env.ENABLE_GRAPH_RETRIEVER,
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
    RERANK_PROVIDER: process.env.RERANK_PROVIDER as "cloud" | "sidecar" | undefined,
    NER_PROVIDER: process.env.NER_PROVIDER as "cloud" | "sidecar" | undefined,
    TRANSCRIPTION_PROVIDER: process.env.TRANSCRIPTION_PROVIDER as "cloud" | "sidecar" | undefined,
    TOKEN_SIGNUP_BONUS: process.env.TOKEN_SIGNUP_BONUS,
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

  if (
    !skipValidation &&
    (server.INNGEST_EVENT_KEY == null || server.INNGEST_EVENT_KEY.length === 0)
  ) {
    throw new Error("INNGEST_EVENT_KEY is required in production");
  }
  return server;
}

export const env = {
  server: parseServerEnv(),
  client: parseEnv(clientSchema, {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_UPLOADTHING_ENABLED:
      process.env.NEXT_PUBLIC_UPLOADTHING_ENABLED,
    NEXT_PUBLIC_STORAGE_PROVIDER: process.env.NEXT_PUBLIC_STORAGE_PROVIDER as
      | "s3"
      | "database"
      | undefined,
    NEXT_PUBLIC_S3_ENDPOINT: process.env.NEXT_PUBLIC_S3_ENDPOINT,
  }),
};
