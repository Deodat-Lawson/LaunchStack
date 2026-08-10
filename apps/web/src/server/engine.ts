/**
 * getEngine() — the single place apps/web reaches into core. Constructs a
 * CoreConfig from env.ts, hands it to createEngine, and caches the result
 * on globalThis so Next.js HMR doesn't keep opening new Postgres pools.
 *
 * Callers should prefer `const { db } = getEngine()` over importing the
 * legacy singleton at ~/server/db. During step 5/6 of the monorepo
 * restructure the old singleton will be rewritten to delegate here.
 */

import { createEngine, type CoreConfig, type Engine } from "@launchstack/core";

import { env } from "~/env";
import { configureProviders } from "@launchstack/core/providers/registry";
import { configureSecretBox } from "@launchstack/core/crypto";
import { configureOcr } from "@launchstack/core/ocr/config";
import { configureEmbeddingIndexRegistry } from "@launchstack/core/embeddings";
import { configureCompanyEmbeddingDefaults } from "@launchstack/core/embeddings";
import { createAppStoragePort } from "./storage/port";
import { createAppCreditsPort } from "./credits/port";
import { createAppRagPort } from "./rag/port";
import { configureAppChatModels, getAppChatModelsConfig } from "./chat-models";

type EngineHolder = { engine: Engine };

const globalHolder = globalThis as unknown as {
  __launchstackEngine?: EngineHolder;
};

function buildConfig(): CoreConfig {
  const server = env.server;

  const ollama = server.OLLAMA_BASE_URL
    ? {
        baseUrl: server.OLLAMA_BASE_URL,
        model: server.OLLAMA_MODEL,
        embeddingModel: server.OLLAMA_EMBEDDING_MODEL,
        embeddingDimension: server.OLLAMA_EMBEDDING_DIMENSION
          ? Number(server.OLLAMA_EMBEDDING_DIMENSION)
          : undefined,
        embeddingVersion: server.OLLAMA_EMBEDDING_VERSION,
      }
    : undefined;

  const huggingface = server.HUGGINGFACE_API_KEY
    ? {
        apiKey: server.HUGGINGFACE_API_KEY,
        embeddingModel: server.HUGGINGFACE_EMBEDDING_MODEL,
        embeddingDimension: server.HUGGINGFACE_EMBEDDING_DIMENSION
          ? Number(server.HUGGINGFACE_EMBEDDING_DIMENSION)
          : undefined,
        embeddingVersion: server.HUGGINGFACE_EMBEDDING_VERSION,
      }
    : undefined;

  // services/document-converter (ADR-004). The legacy OCR_ROUTER_URL is
  // honored as a URL fallback so existing deployments keep routing, but the
  // API key deliberately has NO fallback: the converter authenticates every
  // call and fails closed, so a missing DOCUMENT_CONVERTER_API_KEY surfaces
  // as 401s instead of an unauthenticated service.
  const documentConverterUrl =
    server.DOCUMENT_CONVERTER_URL ?? server.OCR_ROUTER_URL;
  if (!server.DOCUMENT_CONVERTER_URL && server.OCR_ROUTER_URL) {
    console.warn(
      "[env] OCR_ROUTER_URL is deprecated (ADR-004): the ocr-router service was replaced by " +
        "services/document-converter. Using its value as DOCUMENT_CONVERTER_URL for now — " +
        "set DOCUMENT_CONVERTER_URL (and DOCUMENT_CONVERTER_API_KEY, which has no legacy fallback)."
    );
  }
  if (server.OCR_WORKER_URL) {
    console.warn(
      "[env] OCR_WORKER_URL is deprecated and ignored (ADR-004): the ocr-worker service was " +
        "consolidated into services/document-converter — set DOCUMENT_CONVERTER_URL / " +
        "DOCUMENT_CONVERTER_API_KEY instead."
    );
  }

  return {
    db: { url: server.DATABASE_URL },

    llm: {
      // Chat: one OpenAI-compatible endpoint plus the validated model file.
      chat: getAppChatModelsConfig(server),
      // Non-chat OpenAI-compatible work (OCR chunking, VLM enrichment,
      // embeddings fallback) keeps its own credentials — it must never
      // borrow the chat endpoint's key.
      // apiKey belongs to AI_BASE_URL; googleApiKey belongs to the Gemini
      // fallback. Kept apart so an OPENAI_API_KEY can never be paired with
      // Google's endpoint, and so a Gemini-only deployment still has a
      // credential for VLM enrichment and table summaries.
      auxiliaryOpenAI: {
        apiKey: server.AI_BASE_URL
          ? (server.AI_API_KEY ?? server.OPENAI_API_KEY)
          : undefined,
        baseUrl: server.AI_BASE_URL,
        googleApiKey: server.GOOGLE_AI_API_KEY,
      },
      openai: server.OPENAI_API_KEY
        ? { apiKey: server.OPENAI_API_KEY, model: server.OPENAI_MODEL }
        : undefined,
      ollama,
      openaiCompatible: server.AI_BASE_URL
        ? { baseUrl: server.AI_BASE_URL, apiKey: server.AI_API_KEY }
        : undefined,
      huggingface,
      aiBaseUrl: server.AI_BASE_URL,
      aiApiKey: server.AI_API_KEY,
    },

    embeddings: {
      secretsKey: server.EMBEDDING_SECRETS_KEY,
      indexName: server.EMBEDDING_INDEX,
      override: {
        baseUrl: server.EMBEDDING_API_BASE_URL,
        apiKey: server.EMBEDDING_API_KEY,
        model: server.EMBEDDING_MODEL,
      },
      // The sidecar embedding surface (SIDECAR_EMBEDDING_*) was removed by
      // ADR-004 §5 — no service ever implemented ${SIDECAR_URL}/embed.
    },

    ocr: {
      defaultProvider: server.OCR_DEFAULT_PROVIDER,
      appPublicUrl: server.APP_PUBLIC_URL,
      fileAccessTokenSecret: server.FILE_ACCESS_TOKEN_SECRET,
      visionModel: server.OCR_VISION_MODEL,
      datalabApiKey: server.DATALAB_API_KEY,
      azure:
        server.AZURE_DOC_INTELLIGENCE_ENDPOINT &&
        server.AZURE_DOC_INTELLIGENCE_KEY
          ? {
              endpoint: server.AZURE_DOC_INTELLIGENCE_ENDPOINT,
              key: server.AZURE_DOC_INTELLIGENCE_KEY,
            }
          : undefined,
      landingAi: server.LANDING_AI_API_KEY
        ? { apiKey: server.LANDING_AI_API_KEY }
        : undefined,
      // No vision credential forwarding: the converter owns its own vision
      // configuration (the old per-request env map is gone, ADR-004).
      converter: documentConverterUrl
        ? {
            url: documentConverterUrl,
            apiKey: server.DOCUMENT_CONVERTER_API_KEY ?? "",
          }
        : undefined,
    },

    neo4j: server.NEO4J_URI
      ? {
          uri: server.NEO4J_URI,
          user: server.NEO4J_USERNAME ?? "neo4j",
          password: server.NEO4J_PASSWORD ?? "",
          enableGraphRetriever: server.ENABLE_GRAPH_RETRIEVER ?? false,
        }
      : undefined,

    providers: {
      // Rerank and NER are cloud-only (ADR-004 §5) — their *_PROVIDER
      // selectors pointed at sidecar routes no service ever implemented.
      rerank: {
        baseUrl: server.RERANK_API_BASE_URL,
        apiKey: server.RERANK_API_KEY,
        model: server.RERANK_MODEL,
      },
      ner: {
        baseUrl: server.NER_API_BASE_URL,
        apiKey: server.NER_API_KEY,
        model: server.NER_MODEL,
      },
      transcription: {
        baseUrl: server.TRANSCRIPTION_API_BASE_URL,
        apiKey: server.TRANSCRIPTION_API_KEY,
        model: server.TRANSCRIPTION_MODEL,
        provider: server.TRANSCRIPTION_PROVIDER,
      },
    },

    storage: createAppStoragePort(),

    // No `jobs` port: document ingestion is driven by the transactional
    // outbox consumed by apps/worker (ADR-003). The InngestDispatcher path
    // it replaced has been deleted.

    credits: {
      port: createAppCreditsPort(),
    },

    rag: {
      port: createAppRagPort(),
    },
  };
}

export function getEngine(): Engine {
  if (globalHolder.__launchstackEngine) {
    return globalHolder.__launchstackEngine.engine;
  }
  const config = buildConfig();

  // Register chat-model config so chat-model-factory sees the same
  // provider credentials as core does.
  configureAppChatModels(env.server);

  // Register embedding-related defaults so the index registry, the
  // embedding factory, and the company-override resolver all read from
  // the same config tree instead of env.ts at runtime.
  configureEmbeddingIndexRegistry({
    ollama: {
      embeddingDimension: config.llm.ollama?.embeddingDimension,
      embeddingVersion: config.llm.ollama?.embeddingVersion,
    },
    huggingface: {
      embeddingModel: config.llm.huggingface?.embeddingModel,
      embeddingDimension: config.llm.huggingface?.embeddingDimension,
      embeddingVersion: config.llm.huggingface?.embeddingVersion,
    },
    defaultIndexKey: config.embeddings.indexName,
  });

  // Endpoint and credential are chosen as a PAIR, most specific first: the
  // embeddings-only endpoint, then the shared non-chat one. Never one source's
  // key with another's URL — that posts a credential to a service it does not
  // belong to.
  //
  // Unlike chat, OCR/VLM and NER, embeddings have NO built-in default behind
  // either: the operator names where they are sent. Embedding vectors are
  // persisted and only comparable within one model, so silently defaulting the
  // endpoint would change the model under an existing corpus and degrade every
  // stored vector rather than merely routing a request somewhere new.
  const embeddingEndpoint = config.embeddings.override?.baseUrl
    ? config.embeddings.override
    : config.llm.auxiliaryOpenAI;

  configureCompanyEmbeddingDefaults({
    embeddingIndexKey: config.embeddings.indexName,
    openAIApiKey: embeddingEndpoint?.apiKey,
    openAIBaseUrl: embeddingEndpoint?.baseUrl,
    huggingFaceApiKey: config.llm.huggingface?.apiKey,
    ollamaBaseUrl: config.llm.ollama?.baseUrl,
    ollamaEmbeddingModel: config.llm.ollama?.embeddingModel,
    ollamaModel: config.llm.ollama?.model,
  });

  // Register provider config so resolveEndpoint / resolveModel / etc. in
  // core's provider registry see the same values as core does.
  configureProviders({
    aiBaseUrl: config.llm.aiBaseUrl,
    // Same fallback the auxiliary client uses, so both halves of the
    // deployment agree on which credential belongs to AI_BASE_URL. Without it,
    // a deployment naming AI_BASE_URL but holding only OPENAI_API_KEY sent an
    // empty bearer token from NER, reranking and transcription while OCR/VLM
    // authenticated fine against the very same URL.
    aiApiKey: config.llm.aiBaseUrl
      ? (config.llm.aiApiKey ?? env.server.OPENAI_API_KEY)
      : config.llm.aiApiKey,
    // Separate from aiApiKey so a capability falling back to Gemini
    // authenticates with a Google credential and never with another vendor's.
    googleApiKey: env.server.GOOGLE_AI_API_KEY,
    // Only transcription keeps a provider mode: "sidecar" names the real
    // services/transcription deployment and must be chosen explicitly.
    // SIDECAR_URL never selects a provider (ADR-004 §5).
    transcriptionProviderMode: config.providers.transcription?.provider,
    // Per-capability overrides (RERANK_API_* / NER_API_*). The provider
    // constructors read these from the registry slot instead of process.env
    // (ADR-002) — this registration is what makes those values reach them.
    rerank: config.providers.rerank,
    ner: config.providers.ner,
  });

  // Register the encryption key used by company-credentials secret-box.
  configureSecretBox({ key: config.embeddings.secretsKey });

  // Register the full OcrConfig so the complexity router and the
  // document-converter adapters all read from the same source.
  configureOcr(config.ocr);

  const engine = createEngine(config);
  globalHolder.__launchstackEngine = { engine };
  return engine;
}
