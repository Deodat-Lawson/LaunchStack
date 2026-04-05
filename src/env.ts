import { z } from "zod";

const normalize = (value: unknown) =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const requiredString = () =>
  z.preprocess(normalize, z.string().min(1, "Value is required"));

const optionalString = () =>
  z.preprocess(normalize, z.string().min(1).optional());

const serverSchema = z.object({
  // Non-empty string only — avoid z.string().url(): many valid Prisma/Postgres URLs fail strict URL parsing (password encoding, sslmode params, etc.).
  DATABASE_URL: requiredString(),
  OPENAI_API_KEY: requiredString(),
  OPENAI_MODEL: optionalString(),
  ANTHROPIC_API_KEY: optionalString(),
  ANTHROPIC_MODEL: optionalString(),
  GOOGLE_AI_API_KEY: optionalString(),
  GOOGLE_MODEL: optionalString(),
  OLLAMA_BASE_URL: optionalString(),
  OLLAMA_MODEL: optionalString(),
  CLERK_SECRET_KEY: requiredString(),
  BLOB_READ_WRITE_TOKEN: optionalString(),
  UPLOADTHING_TOKEN: optionalString(),
  DATALAB_API_KEY: optionalString(),
  // Web search providers
  TAVILY_API_KEY: optionalString(),
  SERPER_API_KEY: optionalString(),
  SEARCH_PROVIDER: z
    .enum(["tavily", "serper", "fallback", "parallel"])
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
  // Enable Graph RAG retrieval
  ENABLE_GRAPH_RETRIEVER: z.preprocess(
    (val) => val === "true" || val === "1",
    z.boolean().optional()
  ),
  NEO4J_URI: optionalString(),
  NEO4J_USERNAME: optionalString(),
  NEO4J_PASSWORD: optionalString(),
  // Storage provider configuration
  NEXT_PUBLIC_STORAGE_PROVIDER: z.enum(["cloud", "local"]).default("cloud"),
  NEXT_PUBLIC_S3_ENDPOINT: optionalString(),
  S3_REGION: optionalString(),
  S3_ACCESS_KEY: optionalString(),
  S3_SECRET_KEY: optionalString(),
  S3_BUCKET_NAME: optionalString(),
});

const serverSchemaRefined = serverSchema.superRefine((data, ctx) => {
  if (data.NEXT_PUBLIC_STORAGE_PROVIDER === "local") {
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
          message: `${key} is required when NEXT_PUBLIC_STORAGE_PROVIDER is "local"`,
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
  NEXT_PUBLIC_STORAGE_PROVIDER: z.enum(["cloud", "local"]).default("cloud"),
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
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    GOOGLE_MODEL: process.env.GOOGLE_MODEL,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,
    DATALAB_API_KEY: process.env.DATALAB_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    SEARCH_PROVIDER: process.env.SEARCH_PROVIDER as "tavily" | "serper" | "fallback" | "parallel" | undefined,
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
    ENABLE_GRAPH_RETRIEVER: process.env.ENABLE_GRAPH_RETRIEVER,
    NEO4J_URI: process.env.NEO4J_URI,
    NEO4J_USERNAME: process.env.NEO4J_USERNAME,
    NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
    NEXT_PUBLIC_STORAGE_PROVIDER: process.env.NEXT_PUBLIC_STORAGE_PROVIDER as
      | "cloud"
      | "local"
      | undefined,
    NEXT_PUBLIC_S3_ENDPOINT: process.env.NEXT_PUBLIC_S3_ENDPOINT,
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
      | "cloud"
      | "local"
      | undefined,
    NEXT_PUBLIC_S3_ENDPOINT: process.env.NEXT_PUBLIC_S3_ENDPOINT,
  }),
};

