import type { FounderWeeklyReviewEvidenceSnapshot, ReportingPeriod } from "@launchstack/features/founder-weekly-review";

export interface FounderWeeklyReviewEvidenceCollector {
    collectFounderWeeklyReviewEvidence(input: {
        companyId: bigint;
        reportingPeriod: ReportingPeriod;
        workspaceTimezone: string;
        founderContext?: string;
    }): Promise<FounderWeeklyReviewEvidenceSnapshot>;
}

/** LAU-6 owns collection. This deliberately never creates an empty snapshot. */
export class FounderWeeklyReviewEvidenceCollectorUnavailableError extends Error {
    readonly code = "evidence_collector_unavailable";
    constructor() {
        super("Founder weekly review evidence collection is not configured.");
    }
}

export const unavailableFounderWeeklyReviewEvidenceCollector: FounderWeeklyReviewEvidenceCollector = {
    async collectFounderWeeklyReviewEvidence() {
        throw new FounderWeeklyReviewEvidenceCollectorUnavailableError();
    },
};
