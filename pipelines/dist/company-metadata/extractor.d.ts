/**
 * Company Metadata Extractor — Chunk-Level Extraction + Aggregation
 *
 * Instead of sending the whole document in one LLM call, this extractor:
 *   1. Reads all chunks for a document from the database.
 *   2. Groups them into small batches (configurable).
 *   3. Sends each batch to the LLM in parallel (with concurrency cap).
 *   4. Aggregates and deduplicates the per-batch results:
 *      - Company fields: highest confidence wins.
 *      - People/services/projects: matched by normalised name, fields merged.
 *      - Markets: union of unique values.
 *      - Policies: merge by key, highest confidence wins.
 *      - Facts seen in multiple batches get a confidence boost.
 *   5. Returns a single {@link ExtractedCompanyFacts} — same contract as before.
 *
 * This is a pure extraction step — it does NOT write to the database.
 */
import { z, type ZodType } from "zod";
import type { ExtractedCompanyFacts } from "./types.js";
/**
 * Structured LLM call contract. Shape intentionally mirrors Vercel AI SDK's
 * schema generation helper (system + prompt + schema) so hosts can adapt their
 * existing LLM layer with a thin wrapper. Callers pass a concrete function
 * — apps/web passes its `generateStructured` from ~/lib/llm.
 */
export type GenerateStructuredFn = <TSchema extends ZodType>(input: {
    system?: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
}) => Promise<z.infer<TSchema>>;
export interface ExtractorInput {
    documentId: number;
    companyId: string;
    /**
     * Host-supplied structured-extraction function. The feature has no
     * opinion on which LLM provider to call — apps/web threads its own
     * `generateStructured` through here.
     */
    generate: GenerateStructuredFn;
}
/**
 * Extract company metadata facts from a single document using chunk-level
 * extraction with parallel LLM calls and cross-chunk aggregation.
 *
 * Returns `null` if the document has no chunks or no facts were found.
 */
export declare function extractCompanyFacts(input: ExtractorInput): Promise<ExtractedCompanyFacts | null>;
//# sourceMappingURL=extractor.d.ts.map