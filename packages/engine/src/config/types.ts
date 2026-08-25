import type { StoragePort } from "@launchstack/runtime";
import type { DbConfig } from "@launchstack/store/client";
import type { OcrConfig, OcrProviderName } from "@launchstack/conversion/ocr/config-types";

export type { OcrConfig, OcrProviderName };

export type { DbConfig };
export type { LoggerPort } from "@launchstack/runtime";
import type { LoggerPort } from "@launchstack/runtime";
import type { JobDispatcherPort } from "@launchstack/runtime";
import type { CreditsPort, MeteringMode } from "@launchstack/store/credits";
import type { RagPort } from "@launchstack/search";
import type { ChatModelsConfig } from "@launchstack/llm";
import type { AuxiliaryOpenAIConfig } from "@launchstack/llm";

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
    /**
     * How much authority the ledger has. Defaults to "off" when omitted, which
     * keeps a host that registers a port but says nothing about metering from
     * accidentally gating work. Hosts that bill set "enforce"; self-hosted
     * deployments set "record". See MeteringMode.
     */
    metering?: MeteringMode;
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

