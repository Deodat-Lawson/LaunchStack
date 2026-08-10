/**
 * Startup configuration for services/document-converter (ADR-004).
 *
 * `process.env` is read exactly ONCE, at boot, by `server.ts` calling
 * `loadConfig(process.env)`. Nothing else in this service reads (let alone
 * writes) `process.env`. The old ocr-router accepted a per-request `env` map
 * and mutated `process.env` between concurrent requests — a documented race
 * that also put live provider secrets in request bodies. That mechanism is
 * gone and must not return: all provider/vision configuration flows from this
 * typed object, passed down as parameters.
 *
 * Invalid configuration is a startup failure with a message listing every
 * invalid field — never a half-configured running service.
 */
import { z } from "zod";

/** Providers in the frozen wire contract (converter.route-*.schema.json). */
export const OCR_PROVIDERS = [
  "AZURE",
  "LANDING_AI",
  "NATIVE_PDF",
  "DATALAB",
  "INGESTION",
  "DOCLING",
] as const;
export type OcrProvider = (typeof OCR_PROVIDERS)[number];

/**
 * Providers an operator may pin via OCR_DEFAULT_PROVIDER. `MARKER` is
 * deliberately absent — it never had a real implementation (it silently
 * aliased Docling, ADR-004) and is rejected with an actionable error below.
 * `INGESTION` is a pipeline-internal value, not a converter default.
 */
export const CONFIGURABLE_DEFAULT_PROVIDERS = [
  "DOCLING",
  "NATIVE_PDF",
  "AZURE",
  "LANDING_AI",
  "DATALAB",
] as const;
export type ConfigurableDefaultProvider =
  (typeof CONFIGURABLE_DEFAULT_PROVIDERS)[number];

export interface Config {
  port: number;
  /** Shared secret for X-API-Key auth. Required — the service fails closed. */
  apiKey: string;
  /** docling-serve base URL. Absent → /convert answers 503 (typed). */
  doclingServeUrl?: string;
  doclingServeTimeoutMs: number;
  /** Timeout for fetching source documents from allow-listed origins. */
  fetchTimeoutMs: number;
  /** Streaming cap on downloaded document size. */
  maxFetchBytes: number;
  /** URL origins the service may fetch documents from. Never empty. */
  allowedFetchOrigins: string[];
  /** Operator-pinned default provider, when set. */
  defaultProvider?: ConfigurableDefaultProvider;
  // Vision classification (hosted OpenAI-compatible endpoint, Gemini default
  // pairing, SigLIP WASM fallback).
  aiBaseUrl?: string;
  aiApiKey?: string;
  openaiApiKey?: string;
  googleAiApiKey?: string;
  visionModel?: string;
  // Presence of these is used ONLY for routing decisions — the converter
  // never calls these providers itself.
  azureEndpoint?: string;
  azureKey?: string;
  landingAiApiKey?: string;
  datalabApiKey?: string;
}

const DEFAULT_PORT = 8002;
const DEFAULT_DOCLING_TIMEOUT_MS = 600_000;
const DEFAULT_FETCH_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_FETCH_BYTES = 104_857_600; // 100 MiB

/** "" and unset are both "absent" — compose interpolation produces "". */
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().optional(),
);

const positiveInt = (name: string, fallback: number) =>
  z.preprocess(
    (v) => {
      if (typeof v !== "string" || v.trim() === "") return fallback;
      return Number(v.trim());
    },
    z
      .number({ invalid_type_error: `${name} must be a positive integer` })
      .int(`${name} must be a positive integer`)
      .positive(`${name} must be a positive integer`),
  );

const httpUrl = (name: string) =>
  optionalString
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} is not a valid URL: "${value}"`,
        });
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must be an http(s) URL, got scheme "${parsed.protocol}"`,
        });
      }
    })
    .transform((value) => value?.replace(/\/+$/, ""));

const envSchema = z.object({
  PORT: positiveInt("PORT", DEFAULT_PORT),

  CONVERTER_API_KEY: optionalString.superRefine((value, ctx) => {
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "required. Every non-/health endpoint authenticates X-API-Key " +
          "against this value and fails closed (401) — the service refuses " +
          "to start rather than run an unauthenticated routing/parsing " +
          "surface (the old ocr-router/ocr-worker had no auth at all). Set " +
          "a per-service secret and share it with callers.",
      });
    }
  }),

  DOCLING_SERVE_URL: httpUrl("DOCLING_SERVE_URL"),
  DOCLING_SERVE_TIMEOUT_MS: positiveInt(
    "DOCLING_SERVE_TIMEOUT_MS",
    DEFAULT_DOCLING_TIMEOUT_MS,
  ),
  FETCH_TIMEOUT_MS: positiveInt("FETCH_TIMEOUT_MS", DEFAULT_FETCH_TIMEOUT_MS),
  MAX_FETCH_BYTES: positiveInt("MAX_FETCH_BYTES", DEFAULT_MAX_FETCH_BYTES),

  ALLOWED_FETCH_ORIGINS: optionalString.transform((value, ctx) => {
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "required. Comma-separated list of URL origins the service may " +
          "fetch documents from (e.g. \"http://app:3000,https://s3.internal:9000\"). " +
          "The converter rejects any documentUrl/url outside this list — " +
          "arbitrary URLs were an SSRF surface in the old services (ADR-004 §6).",
      });
      return z.NEVER;
    }
    const origins: string[] = [];
    let valid = true;
    for (const entry of value.split(",")) {
      const trimmed = entry.trim();
      if (trimmed === "") continue;
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `entry "${trimmed}" is not a valid URL origin`,
        });
        valid = false;
        continue;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `entry "${trimmed}": only http and https origins are allowed`,
        });
        valid = false;
        continue;
      }
      if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
    }
    if (valid && origins.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must contain at least one http(s) origin",
      });
      valid = false;
    }
    return valid ? origins : z.NEVER;
  }),

  OCR_DEFAULT_PROVIDER: optionalString
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const upper = value.toUpperCase();
      if (upper === "MARKER") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'the MARKER provider was removed (ADR-004): it never had a real ' +
            "implementation and silently aliased Docling. Set " +
            'OCR_DEFAULT_PROVIDER="DOCLING" instead.',
        });
        return;
      }
      if (
        !(CONFIGURABLE_DEFAULT_PROVIDERS as readonly string[]).includes(upper)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${value}" is not a supported provider; expected one of ${CONFIGURABLE_DEFAULT_PROVIDERS.join(", ")}`,
        });
      }
    })
    .transform((value) =>
      value === undefined
        ? undefined
        : (value.toUpperCase() as ConfigurableDefaultProvider),
    ),

  AI_BASE_URL: httpUrl("AI_BASE_URL"),
  AI_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  GOOGLE_AI_API_KEY: optionalString,
  OCR_VISION_MODEL: optionalString,

  AZURE_DOC_INTELLIGENCE_ENDPOINT: optionalString,
  AZURE_DOC_INTELLIGENCE_KEY: optionalString,
  LANDING_AI_API_KEY: optionalString,
  DATALAB_API_KEY: optionalString,
});

/**
 * Parse and validate the environment. Throws a single readable Error listing
 * EVERY invalid field; `server.ts` prints it and exits non-zero.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const issue of result.error.issues) {
      const field = issue.path.join(".") || "config";
      const line = `  - ${field}: ${issue.message}`;
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    }
    throw new Error(
      `document-converter: refusing to start — invalid configuration:\n${lines.join("\n")}`,
    );
  }

  const parsed = result.data;
  return {
    port: parsed.PORT,
    apiKey: parsed.CONVERTER_API_KEY!,
    doclingServeUrl: parsed.DOCLING_SERVE_URL,
    doclingServeTimeoutMs: parsed.DOCLING_SERVE_TIMEOUT_MS,
    fetchTimeoutMs: parsed.FETCH_TIMEOUT_MS,
    maxFetchBytes: parsed.MAX_FETCH_BYTES,
    allowedFetchOrigins: parsed.ALLOWED_FETCH_ORIGINS,
    defaultProvider: parsed.OCR_DEFAULT_PROVIDER,
    aiBaseUrl: parsed.AI_BASE_URL,
    aiApiKey: parsed.AI_API_KEY,
    openaiApiKey: parsed.OPENAI_API_KEY,
    googleAiApiKey: parsed.GOOGLE_AI_API_KEY,
    visionModel: parsed.OCR_VISION_MODEL,
    azureEndpoint: parsed.AZURE_DOC_INTELLIGENCE_ENDPOINT,
    azureKey: parsed.AZURE_DOC_INTELLIGENCE_KEY,
    landingAiApiKey: parsed.LANDING_AI_API_KEY,
    datalabApiKey: parsed.DATALAB_API_KEY,
  };
}
