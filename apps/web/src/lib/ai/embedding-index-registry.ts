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

/**
 * Registry-wide config injected by the hosting app (see
 * apps/web/src/server/engine.ts). When unset, getRegistryConfig() falls
 * back to process.env — retained for the transitional window before
 * this file moves to @launchstack/core in step 6.
 */
export interface EmbeddingIndexRegistryConfig {
  sidecar?: { url: string; model?: string; dimension: number; version?: string };
  ollama?: { embeddingDimension?: number; embeddingVersion?: string };
  huggingface?: { embeddingModel?: string; embeddingDimension?: number; embeddingVersion?: string };
  defaultIndexKey?: string;
}

let _registryConfig: EmbeddingIndexRegistryConfig | null = null;

export function configureEmbeddingIndexRegistry(
  config: EmbeddingIndexRegistryConfig,
): void {
  _registryConfig = config;
  embeddingIndexEnvChecked = false; // re-check on next access
}

function parseDimension(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getRegistryConfig(): EmbeddingIndexRegistryConfig {
  if (_registryConfig) return _registryConfig;
  return {
    sidecar:
      process.env.SIDECAR_URL && process.env.SIDECAR_EMBEDDING_DIMENSION
        ? {
            url: process.env.SIDECAR_URL,
            model: process.env.SIDECAR_EMBEDDING_MODEL,
            dimension: Number(process.env.SIDECAR_EMBEDDING_DIMENSION),
            version: process.env.SIDECAR_EMBEDDING_VERSION,
          }
        : undefined,
    ollama: {
      embeddingDimension: parseDimension(process.env.OLLAMA_EMBEDDING_DIMENSION),
      embeddingVersion: process.env.OLLAMA_EMBEDDING_VERSION,
    },
    huggingface: {
      embeddingModel: process.env.HUGGINGFACE_EMBEDDING_MODEL,
      embeddingDimension: parseDimension(process.env.HUGGINGFACE_EMBEDDING_DIMENSION),
      embeddingVersion: process.env.HUGGINGFACE_EMBEDDING_VERSION,
    },
    defaultIndexKey: process.env.EMBEDDING_INDEX,
  };
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

function isSupportedDimensionTableDimension(dimension: number): boolean {
  return dimension === 768 || dimension === 1024;
}

function buildDynamicIndexes(config?: CompanyEmbeddingConfig): EmbeddingIndexConfig[] {
  const indexes: EmbeddingIndexConfig[] = [];
  const effectiveConfig = resolveEffectiveEmbeddingConfig(config);
  const registry = getRegistryConfig();

  const sidecarDimension = registry.sidecar?.dimension;
  if (registry.sidecar?.url && sidecarDimension && isSupportedDimensionTableDimension(sidecarDimension)) {
    indexes.push({
      indexKey: "sidecar-default",
      provider: "sidecar",
      model: registry.sidecar.model ?? "sidecar-embedding-model",
      dimension: sidecarDimension,
      supportsMatryoshka: false,
      enabled: true,
      storageKind: "dimension_table",
      version: registry.sidecar.version ?? "v1",
    });
  }

  const ollamaDimension = registry.ollama?.embeddingDimension;
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
      version: registry.ollama?.embeddingVersion ?? "v1",
    });
  }

  const huggingFaceDimension = registry.huggingface?.embeddingDimension;
  if (registry.huggingface?.embeddingModel && huggingFaceDimension && isSupportedDimensionTableDimension(huggingFaceDimension)) {
    indexes.push({
      indexKey: "huggingface-default",
      provider: "huggingface",
      model: registry.huggingface.embeddingModel,
      dimension: huggingFaceDimension,
      supportsMatryoshka: false,
      enabled: true,
      storageKind: "dimension_table",
      version: registry.huggingface.embeddingVersion ?? "v1",
    });
  }

  return indexes;
}

export function getEmbeddingIndexRegistry(config?: CompanyEmbeddingConfig): EmbeddingIndexConfig[] {
  return [LEGACY_OPENAI_INDEX, ...buildDynamicIndexes(config)];
}

// Validate EMBEDDING_INDEX once per process so a typo in `.env` surfaces in
// server logs instead of failing at document-ingestion time. Warn rather
// than throw: a missing dynamic index might just mean the corresponding
// env vars aren't set yet (which is expected in dev).
let embeddingIndexEnvChecked = false;
function checkEmbeddingIndexEnv(): void {
  if (embeddingIndexEnvChecked) return;
  embeddingIndexEnvChecked = true;
  const configured = getRegistryConfig().defaultIndexKey;
  if (!configured) return;
  const registry = getEmbeddingIndexRegistry();
  const known = registry.find((idx) => idx.indexKey === configured);
  if (!known) {
    console.warn(
      `[embedding-index-registry] EMBEDDING_INDEX="${configured}" is not in the enabled registry. ` +
        `Enabled indexes: ${registry.map((idx) => idx.indexKey).join(", ") || "(none)"}. ` +
        "Companies without a per-row index key will fail to ingest or query. " +
        "Either set the provider env vars that enable this index, or update EMBEDDING_INDEX.",
    );
  }
}

export function getDefaultEmbeddingIndexKey(config?: CompanyEmbeddingConfig): string {
  checkEmbeddingIndexEnv();
  return resolveEffectiveEmbeddingConfig(config).embeddingIndexKey ?? LEGACY_OPENAI_INDEX.indexKey;
}

export function resolveEmbeddingIndex(
  indexKey?: string,
  config?: CompanyEmbeddingConfig,
): EmbeddingIndexConfig {
  checkEmbeddingIndexEnv();
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
