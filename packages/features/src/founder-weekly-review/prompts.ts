import type { FounderWeeklyReviewEvidenceSnapshot } from "./contracts";
import {
    FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET,
    assertGenerationEvidenceEnvelopeWithinBudget,
    buildGenerationEvidenceEnvelope,
    type GenerationEvidenceEnvelope,
} from "./generation-evidence-envelope";

export const FOUNDER_WEEKLY_REVIEW_PROMPT_VERSION = "founder-weekly-review-generation/v2" as const;

export const FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT = `You generate a structured Founder Weekly Review from supplied evidence only.

Never invent, assume, infer, or embellish customers, dates, metrics, people, decisions, shipped work, blockers, outcomes, or source IDs. Every factual item must cite one or more supplied source IDs exactly as given. Do not create or modify source IDs. Confidence is how strongly the generated claim is supported by its cited supplied evidence; it is not a score for source reliability or truthfulness. Omit unsupported claims or use no_evidence rather than assigning them a low confidence.

Write a concise, decision-oriented founder review, not an evidence transcript. Prioritize the few most material founder-level conclusions. Synthesize related evidence into one focused claim where possible; do not create one output item per evidence source, and do not repeat the same fact across sections unless the section semantics genuinely require it. Prefer concise factual statements over explanatory prose.

Use at most 3 items in each section: whatChanged, whatShipped, whatCustomersSaid, currentBlockers, and nextPriorities. Use fewer items when fewer material conclusions are justified; never add filler to reach a limit. For observed facts, use one concise sentence whenever possible and do not restate the entire evidence excerpt.

Keep the distinctions below explicit. A document change can establish that work was released or that preparation was documented; it does not by itself prove adoption, a measured outcome, or that an underlying issue is resolved. Treat retry telemetry, ownership, plans, and similar records as operational preparation unless evidence proves execution. Customer feedback is customer-only evidence: whatCustomersSaid may cite only customer_feedback, and it must not represent founder_context as customer testimony. founder_context is founder-provided context, not shipped work or external validation. Describe qualitative or limited feedback as limited; do not present one signal as broad proof.

Use whatShipped only for work that the evidence establishes as released during this reporting period. Use whatChanged only for separate, non-shipped developments such as operational preparation; do not restate a shipped item there. Do not turn the administrative processing of a feedback document into a meaningful change when the customer signals themselves are already covered in whatCustomersSaid.

Use currentBlockers for evidence-backed execution blockers and for material product, customer, or operational risks. When there is no explicit execution blocker but evidence shows a risk, say that distinction plainly. State evidence gaps and open questions rather than filling them with assumptions. Do not use generic language such as "continue monitoring" unless paired with a concrete action grounded in cited evidence.

For nextPriorities, create separate recommendation items for distinct priorities; do not combine unrelated work into one sentence. Each recommendation must be evidence-backed. The text should be one concise recommended action. The optional rationale should be brief (preferably one short sentence), should add decision context without restating the recommendation, and should not reproduce source evidence. Omit rationale when it adds no useful context. Avoid repetitive wording across sections.

When evidence conflicts, return contradictory_evidence with the conflicting source IDs. Do not choose a winner or reconcile it unless supplied evidence explicitly resolves the conflict.

nextPriorities contains recommendations only. Every recommendation must have label "Recommendation" and be grounded in supplied evidence. If a section lacks relevant evidence, return its typed no_evidence state with a concrete CTA. sourceWarnings may inform the CTA but are not factual evidence and cannot be cited.`;

/** Canonical, stable prompt serialization over the bounded evidence envelope. */
export function buildFounderWeeklyReviewPrompt(
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot,
    suppliedEnvelope?: GenerationEvidenceEnvelope
): string {
    const envelope = suppliedEnvelope ?? buildGenerationEvidenceEnvelope(evidenceSnapshot);
    assertGenerationEvidenceEnvelopeWithinBudget(envelope);
    return JSON.stringify(
        sortObjectKeysRecursively({
            promptVersion: FOUNDER_WEEKLY_REVIEW_PROMPT_VERSION,
            evidenceEnvelopeVersion: envelope.version,
            evidenceEnvelopeBudget: FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET,
            evidenceEnvelopeDiagnostics: envelope.diagnostics,
            reportingPeriod: evidenceSnapshot.reportingPeriod,
            workspaceTimezone: evidenceSnapshot.workspaceTimezone,
            evidence: envelope.items,
            sourceWarnings: evidenceSnapshot.sourceWarnings,
            requiredSections: [
                "whatChanged",
                "whatShipped",
                "whatCustomersSaid",
                "currentBlockers",
                "nextPriorities",
            ],
        })
    );
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
                .map(key => [
                    key,
                    sortObjectKeysRecursively((value as Record<string, unknown>)[key]),
                ])
        );
    }
    return value;
}
