import { z } from "zod";

const normalize = (value: unknown) =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const requiredString = () =>
  z.preprocess(normalize, z.string().min(1, "Value is required"));

const optionalString = () =>
  z.preprocess(normalize, z.string().min(1)).optional();

const serverSchema = z.object({
  DATABASE_URL: z.preprocess(normalize, z.string().url()),
  OPENAI_API_KEY: requiredString(),
  CLERK_SECRET_KEY: requiredString(),
  UPLOADTHING_TOKEN: optionalString(),
  DATALAB_API_KEY: optionalString(),
  TAVILY_API_KEY: optionalString(),
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
});

const clientSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: requiredString(),
  NEXT_PUBLIC_UPLOADTHING_ENABLED: z.preprocess(
    (val) => val === "true" || val === "1",
    z.boolean().optional()
  ),
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
  const server = parseEnv(serverSchema, {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,
    DATALAB_API_KEY: process.env.DATALAB_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    AZURE_DOC_INTELLIGENCE_ENDPOINT: process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT,
    AZURE_DOC_INTELLIGENCE_KEY: process.env.AZURE_DOC_INTELLIGENCE_KEY,
    LANDING_AI_API_KEY: process.env.LANDING_AI_API_KEY,
    LANGCHAIN_TRACING_V2: process.env.LANGCHAIN_TRACING_V2,
    LANGCHAIN_API_KEY: process.env.LANGCHAIN_API_KEY,
    LANGCHAIN_PROJECT: process.env.LANGCHAIN_PROJECT,
    JOB_RUNNER: process.env.JOB_RUNNER as "inngest" | undefined,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    SIDECAR_URL: process.env.SIDECAR_URL,
  });
  if (
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
  }),
};

