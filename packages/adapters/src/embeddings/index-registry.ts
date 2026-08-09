import {
  resolveEffectiveEmbeddingConfig,
  type CompanyEmbeddingConfig,
} from "./company-config";
import { GEMINI_EMBEDDING_MODEL } from "../llm/types";
import { createSlot } from "../internal/slot";

// "sidecar" is gone from this union (ADR-004 §5): the provider posted to a
// ${SIDECAR_URL}/embed route that no service ever implemented.
export type EmbeddingProvider =
  | "openai"
  | "ollama"
  | "huggingface";

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
 * Registry-wide config injected by the hosting app via createEngine. The
 * hosting app is responsible for populating all fields; there is no
 * process.env fallback.
 */
export interface EmbeddingIndexRegistryConfig {
  ollama?: { embeddingDimension?: number; embeddingVersion?: string };
  huggingface?: { embeddingModel?: string; embeddingDimension?: number; embeddingVersion?: string };
  defaultIndexKey?: string;
}

const registryConfigSlot = createSlot<EmbeddingIndexRegistryConfig>(
  "embeddings/indexRegistry",
);

export function configureEmbeddingIndexRegistry(
  config: EmbeddingIndexRegistryConfig,
): void {
  registryConfigSlot.set(config);
  embeddingIndexEnvChecked = false; // re-check on next access
}

function getRegistryConfig(): EmbeddingIndexRegistryConfig {
  return registryConfigSlot.get() ?? {};
}

/**
 * The original index, and still the fallback.
 *
 * It stays the default deliberately. Every other AI capability in this
 * deployment now runs on Gemini, but embeddings are *persisted*: a vector is
 * only comparable to others from the same model, so changing this key on an
 * existing corpus does not re-route a request — it strands every vector
 * already written. Deployments migrate on purpose, by setting EMBEDDING_INDEX
 * to {@link GEMINI_EMBEDDING_INDEX} and re-embedding, never by upgrading.
 */
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

/**
 * Gemini embeddings — the recommended index for a new deployment.
 *
 * `provider: "openai"` names the *wire protocol*, not the vendor: Gemini
 * serves an OpenAI-shaped `/embeddings`, so it reuses that branch in
 * `factory.ts` unchanged.
 *
 * 768 dimensions because that is what `dimension_table` storage admits, and
 * `gemini-embedding-001` supports Matryoshka truncation down to it. That also
 * keeps these vectors in their own table rather than sharing the legacy
 * 1536-wide column, so the two indexes cannot contaminate each other.
 */
const GEMINI_EMBEDDING_INDEX: EmbeddingIndexConfig = {
  indexKey: "gemini-embedding-768",
  provider: "openai",
  model: GEMINI_EMBEDDING_MODEL,
  dimension: 768,
  supportsMatryoshka: true,
  enabled: true,
  storageKind: "dimension_table",
  version: "v1",
};

function isSupportedDimensionTableDimension(dimension: number): boolean {
  return dimension === 768 || dimension === 1024;
}

function buildDynamicIndexes(config?: CompanyEmbeddingConfig): EmbeddingIndexConfig[] {
  const indexes: EmbeddingIndexConfig[] = [];
  const effectiveConfig = resolveEffectiveEmbeddingConfig(config);
  const registry = getRegistryConfig();

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
  return [
    LEGACY_OPENAI_INDEX,
    GEMINI_EMBEDDING_INDEX,
    ...buildDynamicIndexes(config),
  ];
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
