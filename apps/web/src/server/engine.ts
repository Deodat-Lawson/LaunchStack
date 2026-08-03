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
import { configureEmbeddingFactory } from "@launchstack/core/embeddings";
import { configureCompanyEmbeddingDefaults } from "@launchstack/core/embeddings";
import { createAppStoragePort } from "./storage/port";
import { createAppJobDispatcherPort } from "./jobs/port";
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

  return {
    db: { url: server.DATABASE_URL },

    llm: {
      // Chat: one OpenAI-compatible endpoint plus the validated model file.
      chat: getAppChatModelsConfig(server),
      // Non-chat OpenAI-compatible work (OCR chunking, VLM enrichment,
      // embeddings fallback) keeps its own credentials — it must never
      // borrow the chat endpoint's key.
      auxiliaryOpenAI: {
        apiKey: server.AI_API_KEY ?? server.OPENAI_API_KEY,
        baseUrl: server.AI_BASE_URL,
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
      sidecar:
        server.SIDECAR_URL &&
        server.SIDECAR_EMBEDDING_MODEL &&
        server.SIDECAR_EMBEDDING_DIMENSION &&
        server.SIDECAR_EMBEDDING_VERSION
          ? {
              url: server.SIDECAR_URL,
              model: server.SIDECAR_EMBEDDING_MODEL,
              dimension: Number(server.SIDECAR_EMBEDDING_DIMENSION),
              version: server.SIDECAR_EMBEDDING_VERSION,
            }
          : undefined,
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
      workerUrl: server.OCR_WORKER_URL,
      routerUrl: server.OCR_ROUTER_URL,
      vision: {
        openaiApiKey: server.OPENAI_API_KEY,
        aiApiKey: server.AI_API_KEY,
        aiBaseUrl: server.AI_BASE_URL,
      },
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
      rerank: {
        baseUrl: server.RERANK_API_BASE_URL,
        apiKey: server.RERANK_API_KEY,
        model: server.RERANK_MODEL,
        provider: server.RERANK_PROVIDER,
      },
      ner: {
        baseUrl: server.NER_API_BASE_URL,
        apiKey: server.NER_API_KEY,
        model: server.NER_MODEL,
        provider: server.NER_PROVIDER,
      },
      transcription: {
        baseUrl: server.TRANSCRIPTION_API_BASE_URL,
        apiKey: server.TRANSCRIPTION_API_KEY,
        model: server.TRANSCRIPTION_MODEL,
        provider: server.TRANSCRIPTION_PROVIDER,
      },
    },

    storage: createAppStoragePort(),

    jobs: {
      dispatcher: createAppJobDispatcherPort(),
    },

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
    sidecar: config.embeddings.sidecar
      ? {
          url: config.embeddings.sidecar.url,
          model: config.embeddings.sidecar.model,
          dimension: config.embeddings.sidecar.dimension,
          version: config.embeddings.sidecar.version,
        }
      : undefined,
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

  configureEmbeddingFactory({
    sidecarUrl: config.embeddings.sidecar?.url,
  });

  // Endpoint and credential are chosen as a PAIR, most specific first: the
  // embeddings-only endpoint, then the shared non-chat one. Never one source's
  // key with another's URL — that posts a credential to a service it does not
  // belong to. There is no built-in default behind either: the operator names
  // where embeddings are sent.
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

  // Register provider config so resolveBaseUrl / resolveApiKey / etc. in
  // ~/lib/providers/registry see the same values as core does.
  configureProviders({
    aiBaseUrl: config.llm.aiBaseUrl,
    aiApiKey: config.llm.aiApiKey,
    sidecarUrl: config.embeddings.sidecar?.url,
    rerankProviderMode: config.providers.rerank?.provider,
    nerProviderMode: config.providers.ner?.provider,
    transcriptionProviderMode: config.providers.transcription?.provider,
    rerankBaseUrl: config.providers.rerank?.baseUrl,
    nerBaseUrl: config.providers.ner?.baseUrl,
    transcriptionBaseUrl: config.providers.transcription?.baseUrl,
  });

  // Register the encryption key used by company-credentials secret-box.
  configureSecretBox({ key: config.embeddings.secretsKey });

  // Register the full OcrConfig so the complexity router, worker adapters,
  // and vision-credential forwarding all read from the same source.
  configureOcr(config.ocr);

  const engine = createEngine(config);
  globalHolder.__launchstackEngine = { engine };
  return engine;
}
