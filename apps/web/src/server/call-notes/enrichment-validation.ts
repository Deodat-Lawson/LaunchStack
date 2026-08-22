import {
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
    type EnrichedNoteProposal,
    type EnrichmentInput,
} from "@launchstack/features/call-notes";

export type EnrichmentProvenanceIssueCode =
    | "duplicate_bookmark_id"
    | "duplicate_transcript_segment_id"
    | "unknown_bookmark_id"
    | "unknown_transcript_segment_id"
    | "bookmark_segment_mismatch"
    | "speaker_mismatch"
    | "timestamp_mismatch"
    | "invalid_transcript_timestamp_range";

export interface EnrichmentProvenanceIssue {
    code: EnrichmentProvenanceIssueCode;
    message: string;
    passageIndex?: number;
    citationIndex?: number;
}

export class EnrichmentProvenanceValidationError extends Error {
    readonly issues: readonly EnrichmentProvenanceIssue[];

    constructor(issues: readonly EnrichmentProvenanceIssue[]) {
        super(
            `Call Notes enrichment provenance validation failed: ${issues
                .map(issue => issue.message)
                .join("; ")}`
        );
        this.name = "EnrichmentProvenanceValidationError";
        this.issues = issues;
    }
}

/**
 * Validates model-produced Bookmark citations against the canonical input.
 * Structural validation runs first; unsupported citations are never removed.
 */
export function validateEnrichmentProvenance(
    rawInput: EnrichmentInput,
    rawProposal: EnrichedNoteProposal
): EnrichedNoteProposal {
    const input = EnrichmentInputSchema.parse(rawInput);
    const proposal = EnrichedNoteProposalSchema.parse(rawProposal);
    const issues: EnrichmentProvenanceIssue[] = [];

    const segmentsById = indexUnique(
        input.transcript,
        "duplicate_transcript_segment_id",
        "Transcript segment",
        issues
    );
    const bookmarksById = indexUnique(input.bookmarks, "duplicate_bookmark_id", "Bookmark", issues);

    proposal.bookmarkPassages.forEach((passage, passageIndex) => {
        passage.citations.forEach((citation, citationIndex) => {
            const location = { passageIndex, citationIndex };
            const bookmark = bookmarksById.get(citation.bookmarkId);
            if (!bookmark) {
                issues.push({
                    code: "unknown_bookmark_id",
                    message: `citation references unknown Bookmark ${citation.bookmarkId}`,
                    ...location,
                });
            }

            const segment = segmentsById.get(citation.segmentId);
            if (!segment) {
                issues.push({
                    code: "unknown_transcript_segment_id",
                    message: `citation references unknown Transcript segment ${citation.segmentId}`,
                    ...location,
                });
                return;
            }

            if (bookmark && bookmark.segmentId !== citation.segmentId) {
                issues.push({
                    code: "bookmark_segment_mismatch",
                    message: `Bookmark ${bookmark.id} is linked to ${bookmark.segmentId}, not ${citation.segmentId}`,
                    ...location,
                });
            }

            if (citation.speakerName !== segment.speakerName) {
                issues.push({
                    code: "speaker_mismatch",
                    message: `citation speaker does not match Transcript segment ${segment.id}`,
                    ...location,
                });
            }

            if (citation.providerStartMs !== segment.providerStartMs) {
                issues.push({
                    code: "timestamp_mismatch",
                    message: `citation timestamp does not match Transcript segment ${segment.id}`,
                    ...location,
                });
            }

            if (
                segment.providerStartMs !== null &&
                segment.providerEndMs !== null &&
                segment.providerEndMs < segment.providerStartMs
            ) {
                issues.push({
                    code: "invalid_transcript_timestamp_range",
                    message: `Transcript segment ${segment.id} has an invalid timestamp range`,
                    ...location,
                });
            }
        });
    });

    if (issues.length > 0) {
        throw new EnrichmentProvenanceValidationError(issues);
    }
    return proposal;
}

function indexUnique<T extends { id: string }>(
    values: readonly T[],
    code: "duplicate_bookmark_id" | "duplicate_transcript_segment_id",
    label: string,
    issues: EnrichmentProvenanceIssue[]
): Map<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        if (result.has(value.id)) {
            issues.push({ code, message: `${label} ID ${value.id} is duplicated` });
            continue;
        }
        result.set(value.id, value);
    }
    return result;
}
