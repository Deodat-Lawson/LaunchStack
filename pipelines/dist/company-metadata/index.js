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
import { extractCompanyFacts } from "./extractor.js";
import { mergeCompanyMetadata } from "./merger.js";
import { createEmptyMetadata } from "./types.js";
// Re-export the full types surface (CompanyInfo / PersonEntry / ServiceEntry /
// MetadataFact / Visibility / Usage / Priority / etc.) so consumers can import
// everything from a single @launchstack/features/company-metadata path.
export * from "./types.js";
export { extractCompanyFacts } from "./extractor.js";
export { mergeCompanyMetadata } from "./merger.js";
// ============================================================================
// Public API
// ============================================================================
/**
 * Run the full extract-then-merge pipeline for a single document.
 *
 * Returns a {@link CompanyMetadataToolResult} with the updated canonical
 * metadata and a diff of what changed. Does not persist anything.
 */
export async function runCompanyMetadataTool(input) {
    const { documentId, companyId, existingMetadata, generate } = input;
    try {
        // 1. Extract facts from the document's chunks
        const extracted = await extractCompanyFacts({ documentId, companyId, generate });
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
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[CompanyMetadataTool] Failed for document ${documentId}:`, error);
        return { success: false, error: message };
    }
}
//# sourceMappingURL=index.js.map
