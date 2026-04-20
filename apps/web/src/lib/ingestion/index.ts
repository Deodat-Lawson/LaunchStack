/**
 * Ingestion Layer — Public API
 *
 * Re-exports the router, types, and adapter registry for external consumers.
 */

export { ingestDocument, ingestToNormalized, isSupported } from "./router";
export type { IngestOptions } from "./router";

export {
  detectSourceType,
  toNormalizedDocument,
  ALLOWED_MIME_TYPES,
  MIME_TO_SOURCE_TYPE,
  EXTENSION_TO_SOURCE_TYPE,
} from "@launchstack/core/ingestion/types";

export type {
  SourceType,
  IngestionProvider,
  StandardizedDocument,
  StandardizedPage,
  StandardizedMetadata,
  SourceAdapter,
  SourceAdapterOptions,
} from "@launchstack/core/ingestion/types";

export { findAdapter, getAllAdapters } from "./adapters";
