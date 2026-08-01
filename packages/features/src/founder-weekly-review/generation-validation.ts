import type {
    FounderWeeklyReviewEvidenceSnapshot,
    FounderWeeklyReviewV2Payload,
} from "./contracts";

export class FounderWeeklyReviewGenerationValidationError extends Error {
    constructor(
        message: string,
        public readonly details: ReadonlyArray<FounderWeeklyReviewValidationDetail> = []
    ) {
        super(message);
        this.name = "FounderWeeklyReviewGenerationValidationError";
    }
}

export interface FounderWeeklyReviewValidationDetail {
    code: string;
    section?: string;
    itemIndex?: number;
    sourceId?: string;
}

export function assertUniqueSnapshotSourceIds(
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot
): void {
    const sourceIds = evidenceSnapshot.items.map((item) => item.sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) {
        throw new FounderWeeklyReviewGenerationValidationError(
            "Evidence snapshot contains duplicate source IDs."
        );
    }
}

export function validateFounderWeeklyReviewV2Citations(
    payload: FounderWeeklyReviewV2Payload,
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot
): FounderWeeklyReviewV2Payload {
    const evidenceBySourceId = new Map(
        evidenceSnapshot.items.map((item) => [item.sourceId, item])
    );
    const factualSections = [
        "whatChanged",
        "whatShipped",
        "whatCustomersSaid",
        "currentBlockers",
    ] as const;

    for (const sectionName of factualSections) {
        const section = payload.sections[sectionName];
        if (section.state === "no_evidence") continue;
        for (const [itemIndex, item] of section.items.entries()) {
            assertCitations(item.sourceIds, evidenceBySourceId, item.kind);
            if (item.kind === "contradictory_evidence" && item.sourceIds.length < 2) {
                throw new FounderWeeklyReviewGenerationValidationError(
                    `${sectionName} contradictory_evidence must cite at least two sources.`
                );
            }
            if (sectionName === "whatCustomersSaid") {
                for (const sourceId of item.sourceIds) {
                    const source = evidenceBySourceId.get(sourceId);
                    if (source?.sourceType === "founder_context") {
                        throw new FounderWeeklyReviewGenerationValidationError(
                            "founder_context must never be presented as customer feedback.",
                            [{ code: "founder_context_used_as_customer_feedback", section: sectionName, itemIndex, sourceId }]
                        );
                    }
                    if (source?.sourceType !== "customer_feedback") {
                        throw new FounderWeeklyReviewGenerationValidationError(
                            `whatCustomersSaid may cite only customer_feedback evidence; received "${sourceId}".`,
                            [{ code: "customer_signals_requires_customer_feedback", section: sectionName, itemIndex, sourceId }]
                        );
                    }
                }
            }
        }
    }

    const priorities = payload.sections.nextPriorities;
    if (priorities.state === "evidence") {
        for (const item of priorities.items) {
            assertCitations(item.sourceIds, evidenceBySourceId, item.kind);
            if (item.kind !== "recommendation") {
                throw new FounderWeeklyReviewGenerationValidationError(
                    "nextPriorities may contain recommendations only."
                );
            }
        }
    }

    return payload;
}

function assertCitations(
    sourceIds: readonly string[],
    evidenceBySourceId: ReadonlyMap<string, unknown>,
    itemKind: string
): void {
    if (sourceIds.length === 0) {
        throw new FounderWeeklyReviewGenerationValidationError(
            `${itemKind} must cite at least one evidence source.`
        );
    }
    if (new Set(sourceIds).size !== sourceIds.length) {
        throw new FounderWeeklyReviewGenerationValidationError(
            `${itemKind} contains duplicate source citations.`
        );
    }
    for (const sourceId of sourceIds) {
        if (!evidenceBySourceId.has(sourceId)) {
            throw new FounderWeeklyReviewGenerationValidationError(
                `${itemKind} cites source ID "${sourceId}" that is absent from the evidence snapshot.`
            );
        }
    }
}
