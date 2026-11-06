/** Opt-in, citation-use diagnostics only. This is not semantic coverage or entailment validation. */
import { contextSourceKeyV0, type ContextSourceRefV0 } from "../proposals/context-v0";

export interface SourceUsageReportV0 {
    summary: string;
    topics: readonly {
        facts: readonly { refs: readonly (ContextSourceRefV0 | string)[] }[];
        conflicts: readonly { refs: readonly (ContextSourceRefV0 | string)[] }[];
        rationale: string;
    }[];
}

export interface SourceUsageDiagnosticsV0 {
    version: "source-citation-use/v1";
    scope: "topic-facts-and-conflicts";
    semantics: "uncited-does-not-mean-irrelevant-or-unused";
    suppliedSourceKeys: string[];
    citedSourceKeys: string[];
    uncitedSourceKeys: string[];
    /** Review signals are never a verdict that an omitted source is relevant or contradictory. */
    supplyExclusivityReview: {
        path: string;
        assertion: string;
        uncitedSourceKeys: string[];
        reason: "scope-and-source-equivalence-require-semantic-review";
    }[];
}

/**
 * Identify only unquoted, sentence-leading assertions about the supplied evidence inventory.
 * A scoped claim such as "only revenue evidence" may be true despite unrelated uncited docs.
 * Consequently these are review signals, never automatic rejection or factual contradiction.
 * Quoted source text, questions, suggestions and historical interpretations are not inspected.
 */
function supplyAssertions(text: string): string[] {
    return text
        .split(/(?<=[.!?])\s+/u)
        .map(sentence => sentence.trim())
        .filter(sentence =>
            /^(?:(?:This|That|It) is the (?:only|sole)|The (?:only|sole)) (?:[a-z-]+ ){0,5}(?:evidence|source|observation|report)\b[^.!?]{0,100}\b(?:supplied|provided|available)\b[^?]*[.!]?$/iu.test(
                sentence
            )
        );
}

/** Exact citation bookkeeping, not a requirement to mention every authorized source. */
export function inspectSourceUsageV0(
    suppliedRefs: readonly ContextSourceRefV0[],
    report: SourceUsageReportV0
): SourceUsageDiagnosticsV0 {
    const suppliedSourceKeys = [...new Set(suppliedRefs.map(contextSourceKeyV0))].sort();
    const known = new Set(suppliedSourceKeys);
    const citedSourceKeys = [
        ...new Set(
            report.topics
                .flatMap(topic => [...topic.facts, ...topic.conflicts])
                .flatMap(fact => fact.refs)
                .map(ref => (typeof ref === "string" ? ref : contextSourceKeyV0(ref)))
                .filter(key => known.has(key))
        ),
    ].sort();
    const cited = new Set(citedSourceKeys);
    const uncitedSourceKeys = suppliedSourceKeys.filter(key => !cited.has(key));
    const texts = [
        { path: "summary", text: report.summary },
        ...report.topics.map((topic, index) => ({
            path: `topics[${index}].rationale`,
            text: topic.rationale,
        })),
    ];
    return {
        version: "source-citation-use/v1",
        scope: "topic-facts-and-conflicts",
        semantics: "uncited-does-not-mean-irrelevant-or-unused",
        suppliedSourceKeys,
        citedSourceKeys,
        uncitedSourceKeys,
        supplyExclusivityReview: uncitedSourceKeys.length
            ? texts.flatMap(({ path, text }) =>
                  supplyAssertions(text).map(assertion => ({
                      path,
                      assertion,
                      uncitedSourceKeys: [...uncitedSourceKeys],
                      reason: "scope-and-source-equivalence-require-semantic-review" as const,
                  }))
              )
            : [],
    };
}
