import type { FounderWeeklyReviewEvidenceSnapshot } from "./contracts";

export const FOUNDER_WEEKLY_REVIEW_PROMPT_VERSION =
    "founder-weekly-review-generation/v1" as const;

export const FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT = `You generate a structured Founder Weekly Review from supplied evidence only.

Never invent, assume, infer, or embellish customers, dates, metrics, people, decisions, shipped work, blockers, outcomes, or source IDs. Every factual item must cite one or more supplied source IDs exactly as given. Do not create or modify source IDs. Confidence is how strongly the generated claim is supported by its cited supplied evidence; it is not a score for source reliability or truthfulness. Omit unsupported claims or use no_evidence rather than assigning them a low confidence.

founder_context is internal manual input. It must never be represented as customer feedback. whatCustomersSaid may cite only customer_feedback evidence.

When evidence conflicts, return contradictory_evidence with the conflicting source IDs. Do not choose a winner or reconcile it unless supplied evidence explicitly resolves the conflict.

nextPriorities contains recommendations only. Every recommendation must have label "Recommendation" and be grounded in supplied evidence. If a section lacks relevant evidence, return its typed no_evidence state with a concrete CTA. sourceWarnings may inform the CTA but are not factual evidence and cannot be cited.`;

/** Canonical, stable prompt serialization: preserve snapshot item order and avoid wall-clock data. */
export function buildFounderWeeklyReviewPrompt(
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot
): string {
    return JSON.stringify(sortObjectKeysRecursively({
        promptVersion: FOUNDER_WEEKLY_REVIEW_PROMPT_VERSION,
        reportingPeriod: evidenceSnapshot.reportingPeriod,
        workspaceTimezone: evidenceSnapshot.workspaceTimezone,
        evidence: evidenceSnapshot.items.map((item) => ({
            sourceId: item.sourceId,
            sourceType: item.sourceType,
            title: item.title,
            sourceTimestamp: item.sourceTimestamp ?? null,
            excerpt: item.excerpt,
            canonicalUrl: item.canonicalUrl ?? null,
            workspaceDeepLink: item.workspaceDeepLink ?? null,
            metadata: item.metadata,
        })),
        sourceWarnings: evidenceSnapshot.sourceWarnings,
        requiredSections: [
            "whatChanged",
            "whatShipped",
            "whatCustomersSaid",
            "currentBlockers",
            "nextPriorities",
        ],
    }));
}

/** Sort object keys recursively while retaining the exact supplied order of arrays. */
function sortObjectKeysRecursively(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortObjectKeysRecursively);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map((key) => [
                    key,
                    sortObjectKeysRecursively((value as Record<string, unknown>)[key]),
                ])
        );
    }
    return value;
}
