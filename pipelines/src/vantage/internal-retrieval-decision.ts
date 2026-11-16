import { createHash } from "node:crypto";

export type InternalRetrievalSource = Readonly<{ ref: string; text: string; title?: string }>;
export type InternalRetrievalRole = Readonly<{
    primaryRole?: string;
    responsibilities?: readonly string[];
    priorities?: readonly string[];
}>;
export type InternalEvidenceGap = Readonly<{
    id: string;
    question: string;
    terms: readonly string[];
    supportingRefs: readonly string[];
}>;
export type InternalRetrievalDecision = Readonly<{
    schemaVersion: "vantage-internal-retrieval-decision/v1";
    plannerKind: "deterministic";
    outcome: "STOP" | "INTERNAL_FOLLOW_UP" | "INSUFFICIENT_EVIDENCE";
    reason: string;
    gaps: readonly InternalEvidenceGap[];
    queries: readonly string[];
    unresolved: readonly InternalEvidenceGap[];
    roundsUsed: number;
    maxRounds: 0 | 1;
}>;
export type InternalRetrievalDecisionInput = Readonly<{
    sources: readonly InternalRetrievalSource[];
    role?: InternalRetrievalRole;
    roundsUsed: number;
    maxRounds: 0 | 1;
    signal?: AbortSignal;
}>;

export const INTERNAL_RETRIEVAL_DECISION_LIMITS = Object.freeze({
    sources: 64,
    sourceTextCharacters: 32_000,
    totalTextCharacters: 256_000,
    // Unicode code points, matching canonical database character limits.
    titleCharacters: 300,
    refCharacters: 200,
    gaps: 3,
    queries: 2,
    queryCharacters: 160,
    rounds: 1,
});

const missingFact =
    /\b(?:unresolved|missing|pending|unknown|undecided|unconfirmed|outstanding|not reconciled|not yet (?:defined|confirmed|approved|available)|to be (?:confirmed|determined|defined)|tbd)\b|\b(?:reconciliation|approval|review) is (?:still )?open\b/i;
const negatedGap =
    /\b(?:no|without) (?:unresolved|missing|pending|unknown)\b|\b(?:nothing|none) (?:is )?(?:missing|pending|unknown|unresolved)\b/i;
const instructions =
    /\b(?:ignore (?:all|previous|prior)|system prompt|execute|run (?:sql|shell|command)|delete from|drop table|https?:\/\/|curl|powershell)\b/i;
const genericTerms = new Set(
    "a an the and or of for to in on at by with from is are was were be been as this that these those it its we our they their has have had will would should may can must no not yet missing unresolved pending unknown undecided unconfirmed tbd evidence information details fact facts document source please find search retrieve ignore instructions previous prior all system prompt definition defined defines means includes include excluding excludes count counts counted counting versus differs different conflict conflicting mismatch inconsistent discrepancy required needed still remains decision status".split(
        " "
    )
);

/** Search terms are literal words. Source content cannot select tools or issue instructions. */
function termsFrom(text: string): string[] {
    return [
        ...new Set(
            (text.toLowerCase().match(/[a-z][a-z0-9-]{1,39}/g) ?? []).filter(
                term => !genericTerms.has(term)
            )
        ),
    ].slice(0, 8);
}

function gapFor(
    question: string,
    terms: readonly string[],
    refs: readonly string[]
): InternalEvidenceGap {
    const boundedQuestion = question.slice(0, 300);
    const supportingRefs = [...new Set(refs)].sort();
    const id = createHash("sha256")
        .update(JSON.stringify([boundedQuestion, terms, supportingRefs]))
        .digest("hex")
        .slice(0, 24);
    return { id, question: boundedQuestion, terms: [...terms], supportingRefs };
}

function result(
    input: InternalRetrievalDecisionInput,
    outcome: InternalRetrievalDecision["outcome"],
    reason: string,
    gaps: readonly InternalEvidenceGap[] = [],
    queries: readonly string[] = []
): InternalRetrievalDecision {
    return {
        schemaVersion: "vantage-internal-retrieval-decision/v1",
        plannerKind: "deterministic",
        outcome,
        reason,
        gaps,
        queries,
        unresolved: outcome === "STOP" ? [] : gaps,
        roundsUsed: input.roundsUsed,
        maxRounds: input.maxRounds,
    };
}

function validInput(input: InternalRetrievalDecisionInput): boolean {
    const limits = INTERNAL_RETRIEVAL_DECISION_LIMITS;
    if (
        !Number.isInteger(input.roundsUsed) ||
        input.roundsUsed < 0 ||
        input.roundsUsed > 1 ||
        (input.maxRounds !== 0 && input.maxRounds !== 1) ||
        !Array.isArray(input.sources as unknown) ||
        input.sources.length > limits.sources
    )
        return false;
    let characters = 0;
    const refs = new Set<string>();
    for (const source of input.sources) {
        if (
            !source ||
            typeof source.ref !== "string" ||
            !source.ref.trim() ||
            source.ref.length > limits.refCharacters ||
            refs.has(source.ref) ||
            typeof source.text !== "string" ||
            source.text.length > limits.sourceTextCharacters ||
            (source.title !== undefined &&
                (typeof source.title !== "string" ||
                    source.title.length > limits.titleCharacters * 2 ||
                    Array.from(source.title).length > limits.titleCharacters))
        )
            return false;
        refs.add(source.ref);
        characters += source.text.length;
    }
    const role = input.role;
    if (
        role &&
        ((role.primaryRole !== undefined &&
            (typeof role.primaryRole !== "string" || role.primaryRole.length > 300)) ||
            [role.responsibilities, role.priorities].some(
                values =>
                    values !== undefined &&
                    (!Array.isArray(values) ||
                        values.length > 20 ||
                        values.some(value => typeof value !== "string" || value.length > 300))
            ))
    )
        return false;
    return characters <= limits.totalTextCharacters;
}

/** Pure bounded lexical policy. The caller supplies already authorized, version-pinned evidence. */
export function decideInternalFollowUp(
    input: InternalRetrievalDecisionInput
): InternalRetrievalDecision {
    if (input.signal?.aborted) return result(input, "INSUFFICIENT_EVIDENCE", "cancelled");
    if (!validInput(input)) return result(input, "INSUFFICIENT_EVIDENCE", "invalid-input");
    if (!input.sources.some(source => source.text.trim()))
        return result(input, "INSUFFICIENT_EVIDENCE", "no-evidence");
    const candidates: InternalEvidenceGap[] = [];
    const definitions = new Map<string, { definition: string; ref: string }[]>();
    for (const source of [...input.sources].sort((left, right) =>
        left.ref.localeCompare(right.ref)
    )) {
        if (input.signal?.aborted) return result(input, "INSUFFICIENT_EVIDENCE", "cancelled");
        for (const sentence of source.text.split(/[\n!?]+|\.(?=\s|$)/)) {
            if (instructions.test(sentence)) continue;
            if (missingFact.test(sentence) && !negatedGap.test(sentence)) {
                const terms = termsFrom(sentence);
                candidates.push(
                    gapFor(
                        terms.length
                            ? `What internal evidence establishes ${terms.join(" ")}?`
                            : "Which internal decision fact remains unresolved?",
                        terms,
                        [source.ref]
                    )
                );
            }
            // Compare explicit definitions of the same named metric across documents.
            const definition =
                /\b([a-z][a-z0-9 -]{1,60}?)\s+(?:is defined as|means|is calculated as|counts as|includes|=)\s+(.{3,300})$/i.exec(
                    sentence.trim()
                );
            if (definition) {
                const metric = definition[1]!
                    .toLowerCase()
                    .replace(/^(?:finance|sales)\s+/, "")
                    .trim();
                const entries = definitions.get(metric) ?? [];
                entries.push({ definition: definition[2]!.toLowerCase().trim(), ref: source.ref });
                definitions.set(metric, entries);
            }
            const measurement =
                /\b((?:(?:january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])\s+)?(?:revenue|arr|mrr|bookings|pipeline))\s+(?:is|was|:)\s*(?:usd|\$)?\s*([\d,]+(?:\.\d+)?)/i.exec(
                    sentence
                );
            if (measurement) {
                const metric = measurement[1]!.toLowerCase();
                const entries = definitions.get(metric) ?? [];
                entries.push({ definition: measurement[2]!.replace(/,/g, ""), ref: source.ref });
                definitions.set(metric, entries);
            }
            if (
                /\b(?:conflict|conflicting|mismatch|inconsistent|discrepancy|differs|versus)\b/i.test(
                    sentence
                ) &&
                /\b(?:definition|metric|finance|sales|revenue|arr|bookings)\b/i.test(sentence)
            ) {
                const terms = termsFrom(sentence);
                candidates.push(
                    gapFor(`Which internal definition reconciles ${terms.join(" ")}?`, terms, [
                        source.ref,
                    ])
                );
            }
        }
    }
    for (const [metric, entries] of definitions) {
        if (
            new Set(entries.map(entry => entry.ref)).size > 1 &&
            new Set(entries.map(entry => entry.definition)).size > 1
        ) {
            const terms = [...termsFrom(metric), "definition"].slice(0, 8);
            candidates.unshift(
                gapFor(
                    `Which internal definition governs ${metric}?`,
                    terms,
                    entries.map(entry => entry.ref)
                )
            );
        }
    }
    const roleTerms = new Set(
        termsFrom(
            [
                input.role?.primaryRole,
                ...(input.role?.responsibilities ?? []),
                ...(input.role?.priorities ?? []),
            ].join(" ")
        )
    );
    const score = (gap: InternalEvidenceGap): number =>
        gap.terms.filter(term => roleTerms.has(term)).length;
    const gaps = [...new Map(candidates.map(gap => [gap.id, gap])).values()]
        .sort((left, right) => score(right) - score(left))
        .slice(0, INTERNAL_RETRIEVAL_DECISION_LIMITS.gaps);
    if (!gaps.length) return result(input, "STOP", "no-detected-gap");
    if (input.roundsUsed >= input.maxRounds)
        return result(input, "INSUFFICIENT_EVIDENCE", "round-limit", gaps);
    const queries = [
        ...new Set(
            gaps.filter(gap => gap.terms.length).map(gap => gap.terms.join(" ").slice(0, 160))
        ),
    ].slice(0, 2);
    if (!queries.length) return result(input, "INSUFFICIENT_EVIDENCE", "no-useful-query", gaps);
    return result(input, "INTERNAL_FOLLOW_UP", "grounded-internal-gap", gaps, queries);
}

/** Retrieval proves availability only. Original questions remain unresolved for downstream review. */
export function finalizeInternalFollowUp(
    previous: InternalRetrievalDecision,
    input: InternalRetrievalDecisionInput
): InternalRetrievalDecision {
    const current = decideInternalFollowUp(input);
    if (current.reason === "invalid-input" || current.reason === "cancelled") return current;
    const authorizedRefs = new Set(input.sources.map(source => source.ref));
    const previousGaps = previous.gaps.filter(gap =>
        gap.supportingRefs.every(ref => authorizedRefs.has(ref))
    );
    const gaps = [
        ...new Map([...previousGaps, ...current.gaps].map(gap => [gap.id, gap])).values(),
    ].slice(0, 3);
    if (!gaps.length) return current;
    return result(input, "INSUFFICIENT_EVIDENCE", "follow-up-requires-evidence-review", gaps);
}
