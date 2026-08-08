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

/** Sources in the current model that can establish a reporting-period event. */
const TEMPORAL_EVIDENCE_SOURCE_TYPES = new Set(["document_change"]);
const isTemporalEvidenceSource = (source: { sourceType?: string } | undefined) =>
    source !== undefined && TEMPORAL_EVIDENCE_SOURCE_TYPES.has(source.sourceType ?? "");

type EvidenceStatus =
    | "planned"
    | "changed"
    | "shipped";

function getEvidenceStatus(
    source: { metadata?: Record<string, unknown> } | undefined
): EvidenceStatus | null {
    const status = source?.metadata?.evidenceStatus;

    if (
        status === "planned" ||
        status === "changed" ||
        status === "shipped"
    ) {
        return status;
    }

    return null;
}

function assertClaimDoesNotOverstateEvidence(
    text: string,
    sources: Array<{ metadata?: Record<string, unknown> } | undefined>,
    section: string,
    itemIndex: number,
    sourceIds: readonly string[]
): void {
    const claim = text.toLowerCase();

    for (const source of sources) {
        const status = getEvidenceStatus(source);

        if (!status) continue;

        if (
            status === "planned" &&
            /\b(shipped|released|launched|completed|delivered)\b/i.test(claim)
        ) {
            throw new FounderWeeklyReviewGenerationValidationError(
                "Claim describes planned work as completed.",
                [{
                    code: "claim_overstates_planned_evidence",
                    section,
                    itemIndex,
                    sourceId: sourceIds[0],
                }]
            );
        }
    }
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

            const citedSources = item.sourceIds.map((sourceId) => evidenceBySourceId.get(sourceId));
            
            assertClaimDoesNotOverstateEvidence(
                item.text,
                citedSources,
                sectionName,
                itemIndex,
                item.sourceIds
            );

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
            if (sectionName === "whatChanged" || sectionName === "whatShipped") {
                const sources = item.sourceIds.map((sourceId) => evidenceBySourceId.get(sourceId) as { sourceType?: string } | undefined);
                const workspaceOnly = sources.length > 0 && sources.every((source) => source?.sourceType === "workspace_document");
                const workspaceWithoutTemporalEvidence = sources.some((source) => source?.sourceType === "workspace_document")
                    && !sources.some(isTemporalEvidenceSource);
                if (workspaceOnly || workspaceWithoutTemporalEvidence) {
                    throw new FounderWeeklyReviewGenerationValidationError(
                        `${sectionName} requires temporal evidence in addition to workspace_document context.`,
                        item.sourceIds.map((sourceId) => ({
                            code: workspaceOnly ? "workspace_document_only_temporal_claim" : `${sectionName === "whatChanged" ? "what_changed" : "what_shipped"}_requires_temporal_evidence`, section: sectionName, itemIndex, sourceId,
                        }))
                    );
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
