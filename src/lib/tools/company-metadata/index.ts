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

import { extractCompanyFacts } from "./extractor";
import { mergeCompanyMetadata } from "./merger";
import { createEmptyMetadata } from "./types";
import type { CompanyMetadataJSON, MergeResult } from "./types";

// ============================================================================
// Public types
// ============================================================================

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

// ============================================================================
// Public API
// ============================================================================

/**
 * Run the full extract-then-merge pipeline for a single document.
 *
 * Returns a {@link CompanyMetadataToolResult} with the updated canonical
 * metadata and a diff of what changed. Does not persist anything.
 */
export async function runCompanyMetadataTool(
    input: CompanyMetadataToolInput,
): Promise<CompanyMetadataToolResult> {
    const { documentId, companyId, existingMetadata } = input;

    try {
        // 1. Extract facts from the document's chunks
        const extracted = await extractCompanyFacts({ documentId, companyId });

        if (!extracted) {
            // Not an error — the document simply had no extractable company facts
            return { success: true };
        }

        // 2. Use provided existing metadata or start fresh
        const current = existingMetadata ?? createEmptyMetadata(companyId);

        // 3. Merge extracted facts into canonical metadata
        const mergeResult = mergeCompanyMetadata(current, extracted);

        return { success: true, result: mergeResult };
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error(
            `[CompanyMetadataTool] Failed for document ${documentId}:`,
            error,
        );
        return { success: false, error: message };
    }
}
