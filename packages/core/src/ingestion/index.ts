/**
 * Ingestion Layer — Public API.
 * Re-exports types, router, heading-chunker, and adapter registry.
 */

export * from "./types";
export * from "./heading-chunker";
export { ingestDocument, ingestToNormalized, isSupported } from "./router";
export type { IngestOptions } from "./router";
export { findAdapter, getAllAdapters } from "./adapters";
