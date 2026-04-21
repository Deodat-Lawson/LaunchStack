import type { StoragePort } from "../storage/types";
import type { JobDispatcherPort } from "../jobs/types";
import type { CreditsPort } from "../credits/types";
import type { RagPort } from "../rag/types";

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
  openai?: ProviderCredentials;
  anthropic?: ProviderCredentials;
  google?: ProviderCredentials;
  ollama?: OllamaConfig;
  huggingface?: HuggingfaceConfig;
  /**
   * Global AI-provider fallback. If set, any capability without per-provider
   * credentials resolves through this OpenAI-compatible endpoint.
   */
  aiBaseUrl?: string;
  aiApiKey?: string;
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
  /** Sidecar-hosted embedding service (bge-m3 etc.) — opt-in. */
  sidecar?: SidecarEmbeddingConfig;
}

export interface SidecarEmbeddingConfig {
  url: string;
  model: string;
  dimension: number;
  version: string;
}

export interface OcrConfig {
  /** Per-page provider override, honored by the OCR router. */
  defaultProvider?: OcrProviderName;
  /** Absolute origin of the app — needed by OCR workers to fetch /api/files/ URLs. */
  appPublicUrl?: string;
  /** Model identifier for the vision classifier in the OCR router. */
  visionModel?: string;
  /** Adapter-specific credentials. Each is optional; adapters no-op if missing. */
  datalabApiKey?: string;
  azure?: { endpoint: string; key: string };
  landingAi?: { apiKey: string };
  /** OCR worker URL (Marker / Docling sidecar). */
  workerUrl?: string;
  /** OCR router URL (vision classifier + PDF renderer). */
  routerUrl?: string;
}

export type OcrProviderName =
  | "MARKER"
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
  rerank?: ProviderCapabilityOverride & { provider?: "cloud" | "sidecar" };
  ner?: ProviderCapabilityOverride & { provider?: "cloud" | "sidecar" };
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
