/**
 * Company Metadata Tool — Orchestrator
 *
 * Thin glue layer that chains:
 *   1. Extractor  → extract facts from a single document's chunks
 *   2. Merger     → merge extracted facts into the canonical metadata
 *
 * This module does NOT read from or write to the database.
 * The caller (e.g. the Inngest function) is responsible for:
 *   - Loading any existing canonical metadata before calling this
 *   - Persisting the updated metadata + diff afterwards
 */
import { type GenerateStructuredFn } from "./extractor.js";
import type { CompanyMetadataJSON, MergeResult } from "./types.js";
export * from "./types.js";
export { extractCompanyFacts } from "./extractor.js";
export { mergeCompanyMetadata } from "./merger.js";
export type { GenerateStructuredFn } from "./extractor.js";
export interface CompanyMetadataToolInput {
    /** The document to extract metadata from. */
    documentId: number;
    /** The company this document belongs to. */
    companyId: string;
    /**
     * The company's current canonical metadata, if it exists.
     * When omitted, a blank metadata document is created and the
     * extracted facts become the initial state.
     */
    existingMetadata?: CompanyMetadataJSON;
    /**
     * Host-supplied structured-extraction function. See
     * {@link GenerateStructuredFn}. Threaded straight through to the
     * extractor so this package stays provider-agnostic.
     */
    generate: GenerateStructuredFn;
}
export interface CompanyMetadataToolResult {
    success: boolean;
    /**
     * Present when facts were found and merged.
     * `undefined` when the document had no extractable facts (still success).
     */
    result?: MergeResult;
    error?: string;
}
/**
 * Run the full extract-then-merge pipeline for a single document.
 *
 * Returns a {@link CompanyMetadataToolResult} with the updated canonical
 * metadata and a diff of what changed. Does not persist anything.
 */
export declare function runCompanyMetadataTool(input: CompanyMetadataToolInput): Promise<CompanyMetadataToolResult>;
//# sourceMappingURL=index.d.ts.map