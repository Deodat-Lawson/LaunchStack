import { env } from "~/env";
import {
  resolveEffectiveEmbeddingConfig,
  type CompanyEmbeddingConfig,
} from "./company-embedding-config";

export type EmbeddingProvider =
  | "openai"
  | "ollama"
  | "huggingface"
  | "sidecar";

export type EmbeddingStorageKind = "legacy" | "dimension_table";

export interface EmbeddingIndexConfig {
  indexKey: string;
  provider: EmbeddingProvider;
  model: string;
  dimension: number;
  shortDimension?: number;
  supportsMatryoshka?: boolean;
  enabled: boolean;
  storageKind: EmbeddingStorageKind;
  version: string;
}

const LEGACY_OPENAI_INDEX: EmbeddingIndexConfig = {
  indexKey: "legacy-openai-1536",
  provider: "openai",
  model: "text-embedding-3-large",
  dimension: 1536,
  shortDimension: 512,
  supportsMatryoshka: true,
  enabled: true,
  storageKind: "legacy",
  version: "v1",
};

function parseDimension(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isSupportedDimensionTableDimension(dimension: number): boolean {
  return dimension === 768 || dimension === 1024;
}

function buildDynamicIndexes(config?: CompanyEmbeddingConfig): EmbeddingIndexConfig[] {
  const indexes: EmbeddingIndexConfig[] = [];
  const effectiveConfig = resolveEffectiveEmbeddingConfig(config);

  const sidecarDimension = parseDimension(env.server.SIDECAR_EMBEDDING_DIMENSION);
  if (env.server.SIDECAR_URL && sidecarDimension && isSupportedDimensionTableDimension(sidecarDimension)) {
    indexes.push({
      indexKey: "sidecar-default",
      provider: "sidecar",
      model: env.server.SIDECAR_EMBEDDING_MODEL ?? "sidecar-embedding-model",
      dimension: sidecarDimension,
      supportsMatryoshka: false,
      enabled: true,
      storageKind: "dimension_table",
      version: env.server.SIDECAR_EMBEDDING_VERSION ?? "v1",
    });
  }

  const ollamaDimension = parseDimension(env.server.OLLAMA_EMBEDDING_DIMENSION);
  const ollamaModel = effectiveConfig.ollamaModel;
  const ollamaBaseUrl = effectiveConfig.ollamaBaseUrl;
  if (ollamaBaseUrl && ollamaModel && ollamaDimension && isSupportedDimensionTableDimension(ollamaDimension)) {
    indexes.push({
      indexKey: "ollama-default",
      provider: "ollama",
      model: ollamaModel,
      dimension: ollamaDimension,
      supportsMatryoshka: false,
      enabled: true,
      storageKind: "dimension_table",
      version: env.server.OLLAMA_EMBEDDING_VERSION ?? "v1",
    });
  }

  const huggingFaceDimension = parseDimension(env.server.HUGGINGFACE_EMBEDDING_DIMENSION);
  if (env.server.HUGGINGFACE_EMBEDDING_MODEL && huggingFaceDimension && isSupportedDimensionTableDimension(huggingFaceDimension)) {
    indexes.push({
      indexKey: "huggingface-default",
      provider: "huggingface",
      model: env.server.HUGGINGFACE_EMBEDDING_MODEL,
      dimension: huggingFaceDimension,
      supportsMatryoshka: false,
      enabled: true,
      storageKind: "dimension_table",
      version: env.server.HUGGINGFACE_EMBEDDING_VERSION ?? "v1",
    });
  }

  return indexes;
}

export function getEmbeddingIndexRegistry(config?: CompanyEmbeddingConfig): EmbeddingIndexConfig[] {
  return [LEGACY_OPENAI_INDEX, ...buildDynamicIndexes(config)];
}

export function getDefaultEmbeddingIndexKey(config?: CompanyEmbeddingConfig): string {
  return resolveEffectiveEmbeddingConfig(config).embeddingIndexKey ?? LEGACY_OPENAI_INDEX.indexKey;
}

export function resolveEmbeddingIndex(
  indexKey?: string,
  config?: CompanyEmbeddingConfig,
): EmbeddingIndexConfig {
  const targetKey = indexKey ?? getDefaultEmbeddingIndexKey(config);
  const index = getEmbeddingIndexRegistry(config).find(
    (candidate) => candidate.indexKey === targetKey && candidate.enabled,
  );

  if (!index) {
    throw new Error(
      `Embedding index "${targetKey}" is not registered or not enabled.`,
    );
  }

  return index;
}

export function isLegacyEmbeddingIndex(index: EmbeddingIndexConfig): boolean {
  return index.storageKind === "legacy";
}

export function supportsShortVectorSearch(index: EmbeddingIndexConfig): boolean {
  return Boolean(
    index.storageKind === "legacy" &&
      index.supportsMatryoshka &&
      index.shortDimension &&
      index.shortDimension > 0,
  );
}
