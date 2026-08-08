import type { FounderWeeklyReviewEvidenceSnapshot } from "./contracts";
import {
    FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET,
    assertGenerationEvidenceEnvelopeWithinBudget,
    buildGenerationEvidenceEnvelope,
    type GenerationEvidenceEnvelope,
} from "./generation-evidence-envelope";

export const FOUNDER_WEEKLY_REVIEW_PROMPT_VERSION =
    "founder-weekly-review-generation/v2" as const;

export const FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT = `You generate a structured Founder Weekly Review from supplied evidence only.

Never invent, assume, infer, or embellish customers, dates, metrics, people, decisions, shipped work, blockers, outcomes, or source IDs. Every factual item must cite one or more supplied source IDs exactly as given. Do not create or modify source IDs. Confidence is how strongly the generated claim is supported by its cited supplied evidence; it is not a score for source reliability or truthfulness. 

Omit unsupported claims or use no_evidence rather than assigning them a low confidence. Do not lower confidence simply because the underlying source describes uncertainty; confidence measures support for the wording of the claim, not certainty about the business.

Write a concise, natural, professional, decision-oriented founder review, not an evidence transcript. Prioritize the few most material founder-level conclusions. Synthesize related evidence into one focused claim where possible; do not create one output item per evidence source, and do not repeat the same fact across sections unless the section semantics genuinely require it. Prefer concise factual statements over explanatory prose.

Use at most 3 items in each section: whatChanged, whatShipped, whatCustomersSaid, currentBlockers, and nextPriorities. Use fewer items when fewer material conclusions are justified; never add filler to reach a limit. For observed facts, use one concise sentence whenever possible and do not restate the entire evidence excerpt.

Prefer a few substantive items over many one-sentence paraphrases. When multiple evidence items describe the same customer problem, request, or reaction, synthesize them into a shared theme rather than summarizing each source independently. Explicitly identify the recurring pattern, indicate how many or which sources support it when useful, explain why the pattern matters, and preserve the limits of the evidence. Do not generalize beyond the supplied customer evidence.

Keep the distinctions below explicit. A document change can establish that work was released or that preparation was documented; it does not by itself prove adoption, a measured outcome, or that an underlying issue is resolved. Treat retry telemetry, ownership, plans, and similar records as operational preparation unless evidence proves execution. Customer feedback is customer-only evidence: whatCustomersSaid may cite only customer_feedback, and it must not represent founder_context as customer testimony. 

Customer feedback describes customer requests, reactions, complaints, or opinions; it does not establish that implementation occurred. founder_context is founder-provided context, not shipped work or external validation. Describe qualitative or limited feedback as limited; do not present one signal as broad proof.

Use whatShipped only for work that the evidence explicitly establishes as released during this reporting period. Do not infer that nothing shipped merely because no shipped evidence is present. When no shipped work is supported, use qualified language such as "No shipped work was identified in the available evidence" rather than asserting that nothing shipped.

Use whatChanged for meaningful developments supported by the evidence, including separate non-shipped operational developments. Do not infer that nothing changed merely because there are no document_change items. If the available evidence does not establish a meaningful change, say that no documented change was identified rather than claiming that nothing changed. Do not restate a shipped item in whatChanged.

Use currentBlockers for evidence-backed execution blockers and for material product, customer, or operational risks. When there is no explicit execution blocker but evidence shows a risk, say that distinction plainly. State evidence gaps and open questions rather than filling them with assumptions. Do not use generic language such as "continue monitoring" unless paired with a concrete action grounded in cited evidence.

For nextPriorities, create separate recommendation items for distinct priorities; do not combine unrelated work into one sentence. Each recommendation must be evidence-backed. The text should be one concise recommended action. The optional rationale should be brief (preferably one short sentence), should add decision context without restating the recommendation, and should not reproduce source evidence. Omit rationale when it adds no useful context. Avoid repetitive wording across sections.

Prioritize recommendations by likely impact or urgency when the evidence supports that distinction. Avoid generic recommendations such as "monitor," "improve," or "continue working on" unless they name the specific thing to monitor, improve, or continue and the action is grounded in evidence. Avoid repetitive wording across sections.

When evidence conflicts, return contradictory_evidence with the conflicting source IDs. Do not choose a winner or reconcile it unless supplied evidence explicitly resolves the conflict.

nextPriorities contains recommendations only. Every recommendation must have label "Recommendation" and be grounded in supplied evidence. If a section lacks relevant evidence, return its typed no_evidence state with a concrete CTA. sourceWarnings may inform the CTA but are not factual evidence and cannot be cited.

For nextPriorities, sourceIds have a strict citation allowlist.

ONLY these source types may appear in nextPriorities.sourceIds:
- founder_context
- workspace_document

NEVER put any other source type in nextPriorities.sourceIds, including:
- customer_feedback
- document_change
- github_activity

Customer feedback and document changes may influence the recommendation's wording or rationale, but they are not valid citation sources for nextPriorities. Do not include their sourceIds under any circumstances.

Before producing each nextPriorities recommendation, check every sourceId:
1. Look up the source's sourceType.
2. If sourceType is founder_context or workspace_document, it may be cited.
3. If sourceType is anything else, do not include that sourceId.
4. If no founder_context or workspace_document evidence independently supports the priority, do not create the recommendation. Return no_evidence instead.

Important: Do not "fix" an invalid recommendation by returning an empty sourceIds array. Omit the recommendation and use no_evidence when the citation allowlist cannot be satisfied.

Example:
If founder_context supports "follow up on saved filter adoption" and customer_feedback says customers want saved filters, the recommendation MAY mention the customer signal in its rationale, but sourceIds MUST contain only the founder_context sourceId.
Evidence status rules:

- Only write shipped claims when the supplied evidence explicitly establishes that the work was released, shipped, launched, deployed, completed, or otherwise made available during the reporting period.
- Planned, scheduled, upcoming, or future-dated work cannot be described as completed or shipped.
- Customer feedback, requests, suggestions, complaints, or discussions never prove that a feature shipped, released, launched, or was completed.
- Never place customer_feedback evidence in whatShipped unless separate cited evidence explicitly establishes shipped work.
- A feature request or customer desire may be described in whatCustomersSaid, but it cannot be used to infer implementation status.
- Claim strength must not exceed evidence strength.

Temporal interpretation rules:

- Prefer the evidence's sourceTimestamp and explicit evidence content when determining whether something happened during the reporting period.
- Do not describe ongoing work, preparation, plans, or current context as completed work.
- Do not treat the absence of evidence as evidence that an event did not occur.
- When timing or completion status is not established, use qualified wording such as "was documented," "was identified," "was in progress," or "was not established in the available evidence."
- Preserve the distinction between a development being documented this week and the underlying work actually being completed this week.`

/** Canonical, stable prompt serialization over the bounded evidence envelope. */
export function buildFounderWeeklyReviewPrompt(
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot,
    suppliedEnvelope?: GenerationEvidenceEnvelope,
): string {
    const envelope = suppliedEnvelope ?? buildGenerationEvidenceEnvelope(evidenceSnapshot);
    assertGenerationEvidenceEnvelopeWithinBudget(envelope);
    return JSON.stringify(sortObjectKeysRecursively({
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
