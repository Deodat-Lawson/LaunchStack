import type { StoragePort } from "../storage/types";
import type { JobDispatcherPort } from "../jobs/types";
import type { CreditsPort } from "../credits/types";
import type { RagPort } from "../rag/types";
import type { ChatModelsConfig } from "../llm/chat-config";
import type { AuxiliaryOpenAIConfig } from "../llm/openai-client";

/**
 * CoreConfig is the single parameter to createEngine. The app constructs one
 * from env.ts and hands it down; core itself never reads process.env.
 *
 * Subsystems are progressively elaborated as they move into core. Fields are
 * declared optional when the corresponding subsystem can run without them —
 * e.g. graph/neo4j-driven features gracefully degrade when `neo4j` is absent.
 */
export interface CoreConfig {
  db: DbConfig;
  llm: LlmConfig;
  embeddings: EmbeddingsConfig;
  ocr: OcrConfig;
  neo4j?: Neo4jConfig;
  providers: ProvidersConfig;
  storage: StoragePort;
  jobs?: JobsConfig;
  credits?: CreditsConfig;
  rag?: RagConfig;
  logger?: LoggerPort;
}

export interface RagConfig {
  /** Port that runs retrieval queries against the hosted RAG pipeline. */
  port: RagPort;
}

export interface JobsConfig {
  /** Port that dispatches background jobs (Inngest, Trigger.dev, etc.). */
  dispatcher: JobDispatcherPort;
}

export interface CreditsConfig {
  /** Port that debits per-company token balances when absent is a no-op. */
  port: CreditsPort;
}

export interface DbConfig {
  /** Postgres connection string (DATABASE_URL shape). */
  url: string;
  /** Max concurrent connections per pool. Defaults to 10. */
  maxConnections?: number;
}

export interface LlmConfig {
  /**
   * Chat: one OpenAI-compatible endpoint plus the model definitions and route
   * assignments validated from the chat model configuration file.
   */
  chat?: ChatModelsConfig;
  /**
   * Credentials for the **non-chat** OpenAI-compatible subsystems (OCR
   * chunking, VLM enrichment, embeddings fallback). Kept separate so those
   * capabilities never borrow the chat endpoint's key.
   */
  auxiliaryOpenAI?: AuxiliaryOpenAIConfig;
  openai?: ProviderCredentials;
  ollama?: OllamaConfig;
  openaiCompatible?: OpenAICompatibleConfig;
  huggingface?: HuggingfaceConfig;
  /**
   * Global AI-provider fallback for non-chat capabilities. If set, any
   * capability without its own credentials resolves through this
   * OpenAI-compatible endpoint.
   */
  aiBaseUrl?: string;
  aiApiKey?: string;
}

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export interface ProviderCredentials {
  apiKey: string;
  /** Default model for chat completions on this provider. */
  model?: string;
}

export interface OllamaConfig {
  baseUrl: string;
  model?: string;
  embeddingModel?: string;
  embeddingDimension?: number;
  embeddingVersion?: string;
}

export interface HuggingfaceConfig {
  apiKey: string;
  embeddingModel?: string;
  embeddingDimension?: number;
  embeddingVersion?: string;
}

export interface EmbeddingsConfig {
  /** Base64-encoded 32-byte key used to encrypt per-company provider credentials at rest. */
  secretsKey?: string;
  /** Name of the default embedding index (e.g. "openai-3-small"). */
  indexName?: string;
  /** Per-capability override for the embedding provider. Falls back to OpenAI. */
  override?: ProviderCapabilityOverride;
  // The `sidecar` embedding surface (SidecarEmbeddingConfig) was removed by
  // ADR-004 §5: it targeted a ${SIDECAR_URL}/embed route that no service in
  // this repository ever implemented.
}

export interface OcrConfig {
  /** Local-fallback provider pin; the converter honors its own OCR_DEFAULT_PROVIDER. */
  defaultProvider?: OcrProviderName;
  /** Absolute origin of the app — needed by the converter to fetch /api/files/ URLs. */
  appPublicUrl?: string;
  /** Model identifier for the vision classifier (converter reads its own copy). */
  visionModel?: string;
  /** Adapter-specific credentials. Each is optional; adapters no-op if missing. */
  datalabApiKey?: string;
  azure?: { endpoint: string; key: string };
  landingAi?: { apiKey: string };
  /**
   * services/document-converter (ADR-004): the consolidated routing, vision
   * classification, PDF page rendering, and docling parsing service. Every
   * endpoint authenticates X-API-Key and fails closed — an empty apiKey means
   * every call returns 401.
   */
  converter?: { url: string; apiKey: string };
  /**
   * @deprecated The ocr-worker service was removed by ADR-004 (consolidated
   * into services/document-converter). Ignored at runtime with a startup
   * warning — configure `converter` instead.
   */
  workerUrl?: string;
  /**
   * @deprecated The ocr-router service was removed by ADR-004 (consolidated
   * into services/document-converter). Ignored at runtime with a startup
   * warning — configure `converter` instead.
   */
  routerUrl?: string;
  /**
   * @deprecated Vision credentials are no longer forwarded per-request: the
   * removed ocr-router accepted them in an `env` map (ADR-004); the
   * document-converter reads its own vision configuration at startup. Ignored
   * at runtime with a startup warning.
   */
  vision?: {
    googleApiKey?: string;
    openaiApiKey?: string;
    aiApiKey?: string;
    aiBaseUrl?: string;
  };
}

export type OcrProviderName =
  | "DOCLING"
  | "NATIVE_PDF"
  | "AZURE"
  | "LANDING_AI"
  | "DATALAB";

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  /** When true, the RAG pipeline layers a graph retriever over the vector retriever. */
  enableGraphRetriever?: boolean;
}

export interface ProvidersConfig {
  // Rerank and NER are cloud-only (ADR-004 §5): their `provider` selectors
  // pointed at sidecar routes no service ever implemented and were removed.
  rerank?: ProviderCapabilityOverride;
  ner?: ProviderCapabilityOverride;
  /**
   * Transcription keeps its mode: "sidecar" selects the real self-hosted
   * Whisper service (services/transcription) and is only ever chosen by this
   * explicit override, never inferred from a URL.
   */
  transcription?: ProviderCapabilityOverride & { provider?: "cloud" | "sidecar" };
}

export interface ProviderCapabilityOverride {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/**
 * Optional structured logger. Core uses pino-shaped levels; any logger that
 * exposes info/warn/error/debug is acceptable.
 */
export interface LoggerPort {
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}
