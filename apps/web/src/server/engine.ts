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
import { configureProviders } from "~/lib/providers/registry";
import { configureChatModels } from "~/lib/ai/chat-model-factory";
import { configureEmbeddingIndexRegistry } from "~/lib/ai/embedding-index-registry";
import { configureEmbeddingFactory } from "~/lib/ai/embedding-factory";
import { configureCompanyEmbeddingDefaults } from "~/lib/ai/company-embedding-config";
import { createAppStoragePort } from "./storage/port";

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
      openai: server.OPENAI_API_KEY
        ? { apiKey: server.OPENAI_API_KEY, model: server.OPENAI_MODEL }
        : undefined,
      anthropic: server.ANTHROPIC_API_KEY
        ? { apiKey: server.ANTHROPIC_API_KEY, model: server.ANTHROPIC_MODEL }
        : undefined,
      google: server.GOOGLE_AI_API_KEY
        ? { apiKey: server.GOOGLE_AI_API_KEY, model: server.GOOGLE_MODEL }
        : undefined,
      ollama,
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
  };
}

export function getEngine(): Engine {
  if (globalHolder.__launchstackEngine) {
    return globalHolder.__launchstackEngine.engine;
  }
  const config = buildConfig();

  // Register chat-model config so chat-model-factory sees the same
  // provider credentials as core does.
  configureChatModels({
    aiBaseUrl: config.llm.aiBaseUrl,
    aiApiKey: config.llm.aiApiKey,
    openai: config.llm.openai
      ? {
          apiKey: config.llm.openai.apiKey,
          model: env.server.OPENAI_MODEL,
          chatModel: env.server.CHAT_MODEL,
        }
      : undefined,
    anthropic: config.llm.anthropic,
    google: config.llm.google,
    ollama: config.llm.ollama,
  });

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

  configureCompanyEmbeddingDefaults({
    embeddingIndexKey: config.embeddings.indexName,
    openAIApiKey: config.llm.openai?.apiKey,
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

  const engine = createEngine(config);
  globalHolder.__launchstackEngine = { engine };
  return engine;
}
