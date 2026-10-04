import {
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
    type EnrichedNoteProposal,
    type EnrichmentInput,
} from "@launchstack/pipelines/call-notes";

export type EnrichmentProvenanceIssueCode =
    | "duplicate_transcript_segment_id"
    | "invalid_transcript_timestamp_range";

export interface EnrichmentProvenanceIssue {
    code: EnrichmentProvenanceIssueCode;
    message: string;
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
 * Validates the canonical transcript input before accepting model-produced enrichment.
 * Structural validation runs first; invalid transcript evidence is never removed.
 */
export function validateEnrichmentProvenance(
    rawInput: EnrichmentInput,
    rawProposal: EnrichedNoteProposal
): EnrichedNoteProposal {
    const input = EnrichmentInputSchema.parse(rawInput);
    const proposal = EnrichedNoteProposalSchema.parse(rawProposal);
    const issues: EnrichmentProvenanceIssue[] = [];
    const seenSegmentIds = new Set<string>();

    for (const segment of input.transcript) {
        if (seenSegmentIds.has(segment.id)) {
            issues.push({
                code: "duplicate_transcript_segment_id",
                message: `Transcript segment ID ${segment.id} is duplicated`,
            });
        } else {
            seenSegmentIds.add(segment.id);
        }

        if (
            segment.sourceStartMs !== null &&
            segment.sourceEndMs !== null &&
            segment.sourceEndMs < segment.sourceStartMs
        ) {
            issues.push({
                code: "invalid_transcript_timestamp_range",
                message: `Transcript segment ${segment.id} has an invalid timestamp range`,
            });
        }
    }

    if (issues.length > 0) {
        throw new EnrichmentProvenanceValidationError(issues);
    }
    return proposal;
}
