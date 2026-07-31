import {
    FounderWeeklyReviewEvidenceService,
    FounderWeeklyReviewEvidenceSnapshotSchema,
    type FounderWeeklyReviewEvidenceSnapshot,
    type ReportingPeriod,
} from "@launchstack/features/founder-weekly-review";

export interface FounderWeeklyReviewEvidenceCollector {
    collectFounderWeeklyReviewEvidence(input: {
        companyId: bigint;
        reportingPeriod: ReportingPeriod;
        workspaceTimezone: string;
        founderContext?: string;
        /** LAU-6 records request-time founder context against this actor. */
        actor: { externalUserId: string };
        /** Stable identity makes idempotent founder context source IDs stable. */
        requestKey: string;
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

/**
 * App adapter over LAU-6's canonical workspace collector.  This is kept as an
 * interface boundary deliberately: LAU-8 can compose github_activity here
 * without changing routes, persistence, or the generation worker.
 */
export class CanonicalFounderWeeklyReviewEvidenceCollector implements FounderWeeklyReviewEvidenceCollector {
    // Lazy construction keeps route composition importable in tests and does
    // not open a DB dependency until production collection is actually used.
    constructor(private service?: FounderWeeklyReviewEvidenceService) {}

    async collectFounderWeeklyReviewEvidence(input: {
        companyId: bigint;
        reportingPeriod: ReportingPeriod;
        workspaceTimezone: string;
        founderContext?: string;
        actor: { externalUserId: string };
        requestKey: string;
    }): Promise<FounderWeeklyReviewEvidenceSnapshot> {
        const snapshot = await (this.service ??= new FounderWeeklyReviewEvidenceService()).collectFounderWeeklyReviewEvidence({
            companyId: input.companyId,
            reportingPeriod: input.reportingPeriod,
            workspaceTimezone: input.workspaceTimezone,
            founderContext: input.founderContext,
            actor: input.actor,
            requestKey: input.requestKey,
        });
        return FounderWeeklyReviewEvidenceSnapshotSchema.parse(snapshot);
    }
}

export const canonicalFounderWeeklyReviewEvidenceCollector =
    new CanonicalFounderWeeklyReviewEvidenceCollector();
