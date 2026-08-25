/**
 * Company Metadata Merger
 *
 * Pure function: takes existing canonical metadata + newly extracted facts
 * and produces an updated canonical metadata + a diff for auditing.
 *
 * Merge rules:
 *  1. `manual_override` priority facts are NEVER overwritten by extraction.
 *  2. At the same priority level, higher confidence wins.
 *  3. At equal confidence, newer extraction wins (later `last_updated`).
 *  4. Superseded facts are NOT deleted — they get `status: "deprecated"`,
 *     `valid_to` set, and remain in the array/object for audit.
 *  5. New facts not present in existing metadata are added.
 *  6. People/services/projects are matched by normalised name.
 *  7. Market facts are unioned by normalised value.
 *  8. Policy facts are merged by key.
 */
import type { CompanyMetadataJSON, ExtractedCompanyFacts, MergeResult } from "./types.js";
/**
 * Merge newly extracted facts into the existing canonical metadata.
 *
 * Both inputs are treated as immutable — a new object is returned.
 */
export declare function mergeCompanyMetadata(
    existing: CompanyMetadataJSON,
    extracted: ExtractedCompanyFacts
): MergeResult;
//# sourceMappingURL=merger.d.ts.map
